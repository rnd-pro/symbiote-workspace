// Composition registry — resolves an address to a composition instance.
//
// The routing seam that used to be a closed list of one product's surfaces.
// Here a composition is whatever the host registered, and an address that
// matches nothing is an explicit `no-match` rather than a silent null that the
// caller has to guess about.

import {
  COMPOSITION_ROUTE_RESULTS,
  assertRouteRoundTrip,
  normalizeRouteResult,
  validateCompositionDefinition,
} from '../schema/composition-descriptor.js';

export const RESOLUTION_STATUSES = Object.freeze({
  ready: 'ready',
  blocked: 'blocked',
  noMatch: 'no-match',
  invalid: 'invalid',
});

export function createCompositionRegistry(options = {}) {
  let definitions = new Map();
  let onBlocked = typeof options.onBlocked === 'function' ? options.onBlocked : () => {};

  function register(definition) {
    let validation = validateCompositionDefinition(definition);
    if (!validation.valid) return { ok: false, errors: validation.errors };
    definitions.set(definition.id, Object.freeze({ ...definition }));
    return { ok: true };
  }

  function list() {
    return [...definitions.keys()].sort();
  }

  function get(id) {
    return definitions.get(id) ?? null;
  }

  function has(id) {
    return definitions.has(id);
  }

  /**
   * Resolves a URL against every registered composition. Resolution never
   * touches the network and never creates an instance — creating is the host's
   * call once it has a decision.
   */
  function resolveRoute(url) {
    let text = typeof url === 'string' ? url.trim() : '';
    if (!text) {
      return { status: RESOLUTION_STATUSES.invalid, reason: 'an address is required' };
    }
    for (let definition of definitions.values()) {
      let result = normalizeRouteResult(definition.route.parseRoute(text));
      if (result.status === COMPOSITION_ROUTE_RESULTS.match) {
        return { status: RESOLUTION_STATUSES.ready, compositionId: definition.id, target: result.target };
      }
    }
    return { status: RESOLUTION_STATUSES.noMatch, url: text };
  }

  /**
   * Reports whether every required dependency of a composition is available.
   * A missing requirement is not an error to swallow: the instance opens in an
   * addressable `blocked` state that still carries its restoration descriptor,
   * so the address survives a reload and a later retry can still resolve it.
   */
  function checkDependencies(id, available = []) {
    let definition = definitions.get(id);
    if (!definition) return { status: RESOLUTION_STATUSES.noMatch, reason: `no composition "${id}"` };

    let provided = new Set(available);
    let missing = (definition.dependencies?.required ?? []).filter((need) => !provided.has(need));
    let degraded = (definition.dependencies?.optional ?? []).filter((need) => !provided.has(need));

    if (missing.length > 0) {
      let blocked = {
        status: RESOLUTION_STATUSES.blocked,
        compositionId: id,
        missing,
        degraded,
        retryable: true,
      };
      onBlocked(blocked);
      return blocked;
    }
    return { status: RESOLUTION_STATUSES.ready, compositionId: id, degraded };
  }

  /**
   * Full preflight before an instance is created: the definition must be
   * registered, its route must round-trip, and its requirements must be met.
   * A route that does not round-trip cannot be used for restoration, so it is
   * rejected here rather than at reload time.
   */
  function preflight(id, target, available = []) {
    let definition = definitions.get(id);
    if (!definition) return { status: RESOLUTION_STATUSES.noMatch, reason: `no composition "${id}"` };

    let route = assertRouteRoundTrip(definition, target);
    if (!route.ok) {
      return { status: RESOLUTION_STATUSES.invalid, compositionId: id, reason: route.reason };
    }
    let dependencies = checkDependencies(id, available);
    if (dependencies.status !== RESOLUTION_STATUSES.ready) return dependencies;
    return { ...dependencies, url: route.url };
  }

  function forget(id) {
    return definitions.delete(id);
  }

  function clear() {
    definitions.clear();
  }

  return { register, resolveRoute, checkDependencies, preflight, list, get, has, forget, clear };
}
