// Composition commit point — the single act at which a live composition changes.
//
// The update sequence guarantees that the old composition stays active until the
// new one is ready. This module is where "ready" becomes "active", and it exists
// because three things must move together or not at all:
//
//   the route a reader is on
//   the state that route resolves against
//   the ownership of the resources backing both
//
// Committing them in sequence lets an observer land between steps and see a
// generation that never existed: a route that points at state the new generation
// does not have, or state owned by a runtime that has already been released. A
// single swap of one coherent snapshot removes that window by construction rather
// than by trying to make three writes fast.
//
// A reader never blocks and never sees a partial snapshot. It gets the old
// complete generation or the new complete one.

export const COMMIT_RESULTS = Object.freeze({
  committed: 'committed',
  rejected: 'rejected',
  stale: 'commit_stale',
});

/**
 * @typedef {Object} Generation
 * @property {number} generation
 * @property {*} route
 * @property {*} state
 * @property {*} ownership
 * @property {number} [committedAt]
 */

export function createCompositionCommitPoint(initial) {
  let current = normalizeGeneration(initial);
  let history = [current];
  let lastCommit = null;

  function read() {
    // Returned by reference to the frozen snapshot, so a reader cannot observe a
    // half-swapped generation no matter when it looks.
    return current;
  }

  /**
   * Swaps the whole generation in one act.
   *
   * `apply` performs the side that cannot be atomic — installing the mount,
   * moving the router. It runs *before* the swap, while readers still see the old
   * generation, so a failure leaves nothing to undo here. The swap itself is a
   * single assignment.
   *
   * `expectGeneration` refuses a commit planned against a superseded generation,
   * which is the same staleness rule the update plan uses, applied at the last
   * possible moment.
   */
  async function commit({ next, apply, expectGeneration, reason } = {}) {
    if (expectGeneration !== undefined && expectGeneration !== current.generation) {
      const rejected = {
        result: COMMIT_RESULTS.stale,
        reason: 'the generation moved on before the commit',
        expected: expectGeneration,
        actual: current.generation,
      };
      lastCommit = rejected;
      return rejected;
    }

    let applied = null;
    if (typeof apply === 'function') {
      try {
        applied = await apply({ next, from: current });
      } catch (err) {
        const rejected = {
          result: COMMIT_RESULTS.rejected,
          reason: err?.message || String(err),
          previous: current,
        };
        lastCommit = rejected;
        return rejected;
      }
    }

    // The whole generation moves here, as one assignment. Route, state, and
    // ownership are never momentarily out of step with each other.
    current = normalizeGeneration({ ...next, generation: current.generation + 1 });
    history.push(current);

    const committed = {
      result: COMMIT_RESULTS.committed,
      generation: current.generation,
      reason: reason ?? null,
      applied,
    };
    lastCommit = committed;
    return committed;
  }

  return {
    read,
    commit,
    getLastCommit: () => lastCommit,
    getGeneration: () => current.generation,
    getHistory: () => history.slice(),
  };
}

function normalizeGeneration(generation) {
  let value = generation ?? {};
  return Object.freeze({
    generation: Number.isInteger(value.generation) ? value.generation : 0,
    route: value.route ?? null,
    state: value.state ?? null,
    ownership: value.ownership ?? null,
    committedAt: value.committedAt ?? null,
  });
}
