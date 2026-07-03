/**
 * Injectable PubSub registry observation seam.
 *
 * The framework-level registry hooks are intentionally not consumed here.
 * Callers may inject this observer, a compatible implementation, or a polling
 * wrapper around a PubSub.globalStore-like Map.
 *
 * @module symbiote-workspace/runtime/registry-observer
 */

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveStore(options = {}) {
  if (options.registry instanceof Map) return options.registry;
  if (options.store instanceof Map) return options.store;
  if (options.PubSub?.globalStore instanceof Map) return options.PubSub.globalStore;
  return new Map();
}

function normalizeEntry(uid, ctx) {
  return { uid, ctx };
}

/**
 * Create an injectable registry observer with manual register/delete methods
 * and an optional polling adapter for PubSub.globalStore-like registries.
 *
 * @param {Object} [options]
 * @param {Map<string|symbol, object>} [options.registry]
 * @param {{ globalStore?: Map<string|symbol, object> }} [options.PubSub]
 * @param {number} [options.pollIntervalMs]
 * @returns {{
 *   entries: () => Array<{ uid: string|symbol, ctx: object }>,
 *   get: (uid: string|symbol) => object|undefined,
 *   onRegister: (callback: Function) => { remove: Function },
 *   onDelete: (callback: Function) => { remove: Function },
 *   registerCtx: (uid: string|symbol, ctx: object) => object,
 *   deleteCtx: (uid: string|symbol) => boolean,
 *   poll: () => void,
 *   close: () => void,
 * }}
 */
export function createRegistryObserver(options = {}) {
  let store = resolveStore(options);
  let registerListeners = new Set();
  let deleteListeners = new Set();
  let known = new Map(store);
  let interval = null;

  let notifyRegister = (uid, ctx) => {
    let entry = normalizeEntry(uid, ctx);
    for (let callback of registerListeners) callback(entry);
  };
  let notifyDelete = (uid, ctx) => {
    let entry = normalizeEntry(uid, ctx);
    for (let callback of deleteListeners) callback(entry);
  };

  let observer = {
    entries() {
      return [...store.entries()].map(([uid, ctx]) => normalizeEntry(uid, ctx));
    },

    get(uid) {
      return store.get(uid);
    },

    onRegister(callback) {
      if (typeof callback !== 'function') {
        throw new Error('registry observer onRegister requires a callback.');
      }
      registerListeners.add(callback);
      return { remove: () => registerListeners.delete(callback) };
    },

    onDelete(callback) {
      if (typeof callback !== 'function') {
        throw new Error('registry observer onDelete requires a callback.');
      }
      deleteListeners.add(callback);
      return { remove: () => deleteListeners.delete(callback) };
    },

    registerCtx(uid, ctx) {
      if (typeof uid !== 'string' && typeof uid !== 'symbol') {
        throw new Error('registry observer registerCtx requires a string or symbol uid.');
      }
      if (!isObject(ctx) && typeof ctx !== 'function') {
        throw new Error('registry observer registerCtx requires a context object.');
      }
      store.set(uid, ctx);
      known.set(uid, ctx);
      notifyRegister(uid, ctx);
      return ctx;
    },

    deleteCtx(uid) {
      let ctx = store.get(uid);
      let existed = store.delete(uid);
      known.delete(uid);
      if (existed) notifyDelete(uid, ctx);
      return existed;
    },

    poll() {
      for (let [uid, ctx] of store.entries()) {
        if (!known.has(uid)) {
          known.set(uid, ctx);
          notifyRegister(uid, ctx);
        } else if (known.get(uid) !== ctx) {
          known.set(uid, ctx);
          notifyRegister(uid, ctx);
        }
      }
      for (let [uid, ctx] of known.entries()) {
        if (!store.has(uid)) {
          known.delete(uid);
          notifyDelete(uid, ctx);
        }
      }
    },

    close() {
      if (interval) clearInterval(interval);
      interval = null;
      registerListeners.clear();
      deleteListeners.clear();
    },
  };

  let pollIntervalMs = Number(options.pollIntervalMs);
  if (Number.isFinite(pollIntervalMs) && pollIntervalMs > 0) {
    interval = setInterval(() => observer.poll(), pollIntervalMs);
    interval.unref?.();
  }

  return observer;
}

/**
 * Alias that makes the deferred framework extension explicit at call sites.
 *
 * @param {Object} [options]
 * @returns {ReturnType<typeof createRegistryObserver>}
 */
export function createPollingRegistryObserver(options = {}) {
  return createRegistryObserver(options);
}
