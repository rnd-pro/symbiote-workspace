/**
 * Ensure / reconciliation engine for live application state (Slice B).
 *
 * Semantics over the Slice A observation contract:
 *
 *   observe(targetId) → state, presence, capabilities (supported /
 *   available / effects)
 *   compare           → which requested state keys differ
 *   invoke            → exactly one available transition whose declared
 *                       `effects` cover the missing keys; never guessed
 *   verify            → re-observe until the requested keys match or the
 *                       settle budget expires
 *
 * The controller never fabricates success: it returns an explicit status
 * ('already-satisfied' | 'achieved' | 'failed' | 'no-transition' |
 * 'target-unknown') with the observations it actually read. Unknown or
 * unmounted targets are never invoked.
 */

export const ENSURE_STATUS = Object.freeze({
  ALREADY_SATISFIED: 'already-satisfied',
  ACHIEVED: 'achieved',
  FAILED: 'failed',
  NO_TRANSITION: 'no-transition',
  TARGET_UNKNOWN: 'target-unknown',
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function missingKeys(state, desired) {
  return Object.entries(desired).filter(([key, value]) => state?.[key] !== value)
    .map(([key]) => key);
}

function coveringTransition(observation, keys) {
  const capabilities = observation?.capabilities || {};
  const available = new Set(capabilities.available || []);
  const effects = isRecord(capabilities.effects) ? capabilities.effects : {};
  for (const id of available) {
    const effect = effects[id];
    if (!isRecord(effect)) continue;
    // The transition is usable only when its declared postconditions name a
    // value for every still-missing key — anything else would be guessing.
    if (keys.every((key) => Object.hasOwn(effect, key))) return { id, effect };
  }
  return null;
}

/**
 * @param {object} options
 * @param {(request: { targetId: string }) => { observation: object, freshness: object }} options.observe
 * @param {(input: { targetId: string, transitionId: string }) => Promise<object|void>} options.invokeTransition
 * @param {number} [options.maxAttempts]
 * @param {number} [options.settleBudgetMs]
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createEnsureController({
  observe,
  invokeTransition,
  maxAttempts = 2,
  settleBudgetMs = 500,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof observe !== 'function') {
    throw new TypeError('createEnsureController requires an observe() function');
  }
  const result = ({ status, targetId, observations, transition, attempts }) => Object.freeze({
    status,
    targetId,
    attempts,
    observations: Object.freeze(observations),
    ...(transition ? { transition: Object.freeze(transition) } : {}),
  });

  /**
   * @param {string} targetId
   * @param {Record<string, unknown>} desiredState
   * @param {{ sync?: string }} [options]
   */
  async function ensure(targetId, desiredState = {}, options = {}) {
    const target = String(targetId || '').trim();
    if (!target || !isRecord(desiredState) || Object.keys(desiredState).length === 0) {
      return result({
        status: ENSURE_STATUS.FAILED,
        targetId: target,
        observations: [],
        attempts: 0,
      });
    }
    const observations = [];
    for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
      const snapshot = observe({ targetId: target });
      const observation = snapshot?.observation;
      if (observation && observations.at(-1) !== observation) observations.push(observation);
      const presence = observation?.presence || 'unknown';
      if (presence === 'unknown' || presence === 'unmounted') {
        return result({
          status: ENSURE_STATUS.TARGET_UNKNOWN,
          targetId: target,
          observations,
          attempts: attempt + 1,
        });
      }
      const missing = missingKeys(observation?.state, desiredState);
      if (missing.length === 0) {
        return result({
          status: ENSURE_STATUS.ALREADY_SATISFIED,
          targetId: target,
          observations,
          attempts: attempt + 1,
        });
      }
      if (typeof invokeTransition !== 'function') {
        return result({
          status: ENSURE_STATUS.NO_TRANSITION,
          targetId: target,
          observations,
          attempts: attempt + 1,
        });
      }
      const transition = coveringTransition(observation, missing);
      if (!transition) {
        return result({
          status: ENSURE_STATUS.NO_TRANSITION,
          targetId: target,
          observations,
          attempts: attempt + 1,
        });
      }
      const receipt = await invokeTransition({
        targetId: target,
        transitionId: transition.id,
        effect: transition.effect,
        sync: options.sync,
      });
      // Verify: re-observe within the settle budget until the desired keys hold.
      const deadline = now() + settleBudgetMs;
      let verified = null;
      do {
        const check = observe({ targetId: target });
        verified = check?.observation;
        if (verified && observations.at(-1) !== verified) observations.push(verified);
        if (missingKeys(verified?.state, desiredState).length === 0) {
          return result({
            status: ENSURE_STATUS.ACHIEVED,
            targetId: target,
            observations,
            attempts: attempt + 1,
            transition: {
              id: transition.id,
              ...(receipt && typeof receipt === 'object' ? { receipt } : {}),
            },
          });
        }
        if (now() < deadline) await sleep(Math.min(25, Math.max(1, deadline - now())));
      } while (now() < deadline);
    }
    return result({
      status: ENSURE_STATUS.FAILED,
      targetId: target,
      observations,
      attempts: Math.max(1, maxAttempts),
    });
  }

  return Object.freeze({ ensure });
}
