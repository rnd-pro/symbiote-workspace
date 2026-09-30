/**
 * Plugin connection manager — lifecycle for running plugin connections.
 *
 * The registry stores *definitions*: immutable descriptions of what a plugin
 * is. This module owns the separate question of a *running connection* and
 * *who is currently entitled to use it*.
 *
 * Three objects, deliberately not one:
 *
 *   Definition  immutable description of a plugin version
 *   Connection  a running, activated instance with its own resources
 *   Lease       one consumer's right to use that connection
 *
 * The registry conflates the first two, which produces two defects: concurrent
 * activation runs the plugin's `activate` more than once, and a name that is
 * replaced or unregistered while running is dropped without releasing what it
 * holds. Here, activation is memoised per connection, and the last lease to be
 * released is what deactivates — a consumer leaving never destroys a resource
 * another consumer still holds.
 *
 * @module symbiote-workspace/plugins/connection-manager
 */

import { validatePluginDefinition } from './plugin-schema.js';

/**
 * @typedef {Object} Connection
 * @property {string} name
 * @property {'active' | 'error'} status
 * @property {number} leaseCount
 * @property {string} [error]
 * @property {() => Promise<void>} [close]
 */

/**
 * @typedef {Object} Lease
 * @property {string} name
 * @property {string} leaseId
 * @property {() => Promise<{ ok: boolean, stillActive: boolean }>} release
 * @property {boolean} [released]
 */

export function createConnectionManager(options = {}) {
  let definitions = new Map();
  /** @type {Map<string, { definition: any, promise: Promise<Connection> | null, connection: Connection | null, leases: Set<string> }>} */
  let connections = new Map();
  let leaseSeq = 0;
  let onError = typeof options.onError === 'function' ? options.onError : () => {};

  function define(plugin) {
    let validation = validatePluginDefinition(plugin);
    if (!validation.valid) {
      return { ok: false, errors: validation.errors };
    }
    let previous = connections.get(plugin.name);
    if (previous?.connection?.status === 'active' && previous.leases.size > 0) {
      return {
        ok: false,
        errors: [{
          path: 'name',
          message: `Plugin "${plugin.name}" has ${previous.leases.size} active lease(s); release them before redefining it.`,
        }],
      };
    }
    definitions.set(plugin.name, Object.freeze({ ...plugin }));
    // A redefinition invalidates any previous connection state so the next
    // acquire activates the new definition rather than reviving the old one.
    connections.delete(plugin.name);
    return { ok: true };
  }

  function activateOnce(name, definition, context) {
    let connection = connections.get(name);
    if (!connection) {
      connection = { definition, promise: null, connection: null, leases: new Set() };
      connections.set(name, connection);
    }
    if (connection.connection?.status === 'active') return Promise.resolve(connection.connection);
    if (connection.promise) return connection.promise;

    // The memo is the whole point: concurrent acquires await one activation
    // instead of each running the hook.
    connection.promise = (async () => {
      try {
        let close = typeof definition.activate === 'function'
          ? await definition.activate(context)
          : null;
        connection.connection = {
          name,
          status: 'active',
          leaseCount: 0,
          close: typeof close === 'function' ? close : null,
        };
        return connection.connection;
      } catch (err) {
        // A failed activation owns nothing, so it must not linger: drop the
        // memo and the connection so the next acquire can retry cleanly.
        connection.promise = null;
        connection.connection = null;
        connections.delete(name);
        onError(err, name);
        throw err;
      } finally {
        if (connection.promise && connection.connection?.status !== 'active') connection.promise = null;
      }
    })();

    return connection.promise;
  }

  async function acquire(name, context = {}) {
    let definition = definitions.get(name);
    if (!definition) {
      return { ok: false, error: `Plugin "${name}" is not defined.` };
    }
    let connection;
    try {
      connection = await activateOnce(name, definition, context);
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
    let entry = connections.get(name);
    let leaseId = `lease-${++leaseSeq}`;
    entry.leases.add(leaseId);
    connection.leaseCount = entry.leases.size;
    return {
      ok: true,
      connection,
      lease: {
        name,
        leaseId,
        released: false,
        release: () => release(name, leaseId),
      },
    };
  }

  async function release(name, leaseId) {
    let entry = connections.get(name);
    if (!entry) return { ok: false, stillActive: false, error: `Plugin "${name}" has no connection.` };
    if (!entry.leases.delete(leaseId)) {
      return { ok: false, stillActive: Boolean(entry.connection?.status === 'active') };
    }

    if (entry.leases.size > 0) {
      if (entry.connection) entry.connection.leaseCount = entry.leases.size;
      return { ok: true, stillActive: true };
    }

    // Last lease out turns the light off.
    let connection = entry.connection;
    entry.connection = null;
    entry.promise = null;
    if (connection?.close) {
      try {
        await connection.close();
      } catch (err) {
        onError(err, name);
      }
    }
    return { ok: true, stillActive: false };
  }

  function getConnection(name) {
    return connections.get(name)?.connection ?? null;
  }

  function listConnections() {
    return [...connections.entries()]
      .filter(([, entry]) => entry.connection)
      .map(([name, entry]) => ({
        name,
        status: entry.connection.status,
        leaseCount: entry.leases.size,
      }));
  }

  function listDefinitions() {
    return [...definitions.values()].map((definition) => ({ ...definition }));
  }

  async function clear() {
    for (let [name, entry] of [...connections.entries()]) {
      entry.leases.clear();
      let connection = entry.connection;
      entry.connection = null;
      entry.promise = null;
      if (connection?.close) {
        try {
          await connection.close();
        } catch (err) {
          onError(err, name);
        }
      }
    }
    connections.clear();
  }

  return { define, acquire, release, getConnection, listConnections, listDefinitions, clear };
}
