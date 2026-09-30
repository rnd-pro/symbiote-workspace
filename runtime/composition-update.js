// Composition update — switching a live composition without losing state.
//
// The failure this exists to prevent: a runtime that cannot update itself
// reports success by destroying the old mount and mounting the new one, so a
// composition change silently drops whatever was only in memory. "Without a
// page reload" was true; "without losing module state" was not.
//
// The order is the whole point:
//
//   plan -> checkpoint -> prepare -> restore -> switch -> release
//
// Preparation happens while the old mount is still live, so a failed migration
// leaves the previous composition working. The switch happens only after a
// successful restore. The old mount is released last, never first.
//
// What is honest here: only declared persistent state of compatible modules is
// preserved. Undeclared internal state and external resources get no guarantee.
// A dirty slot that cannot be checkpointed blocks the update instead of being
// quietly discarded — losing a user's unsaved work is not an acceptable
// default, even when the alternative is "the update does not happen".

/**
 * Reads what a switch actually claims to have applied.
 *
 * A switch may report in three ways: an explicit list, an explicit `applied`
 * count, or nothing at all. Returning nothing while work was declared is the
 * silent no-op this module exists to reject; a switch that wants to be trusted
 * has to say what it did.
 */
function describeAppliedWork(report) {
  if (report === null || report === undefined) {
    return { reported: false, appliedNothing: true, count: 0 };
  }
  if (Array.isArray(report.applied)) {
    return { reported: true, appliedNothing: report.applied.length === 0, count: report.applied.length };
  }
  if (Number.isInteger(report.appliedCount)) {
    return { reported: true, appliedNothing: report.appliedCount === 0, count: report.appliedCount };
  }
  // A switch that reports something else — `{ installed: true }`, a handle, an
  // opaque result — has not said what it applied. That is not the same as having
  // applied nothing, but it is equally unverifiable, and an unverifiable switch
  // cannot be reported as a landed change. Being silent and being vague fail the
  // same way.
  return { reported: false, appliedNothing: true, count: null, unverifiable: true };
}

/**
 * Releases whatever a half-built candidate acquired. Never throws: it runs on
 * the failure path, where a second failure would hide the first.
 */
async function releaseCandidateResources(carried, registered = []) {
  let list = [...registered];
  for (let release of Array.isArray(carried?.releases) ? carried.releases : []) {
    if (!list.includes(release)) list.push(release);
  }
  if (list.length === 0) return false;
  for (let release of list) {
    try {
      await release();
    } catch {
      // Reported by the caller's own accounting; this is best-effort cleanup.
    }
  }
  return true;
}

/**
 * Reads what a restore actually recovered.
 *
 * A restore may report an explicit `recovered` list, or return the recovered
 * state directly. Returning nothing, or an empty object, while the plan carried
 * declared state is an unreported loss — which is the silent empty state the
 * contract refuses to accept.
 */
function describeRecovery(restored, plan) {
  // Only state that was actually carried is at risk. A slot the plan merely
  // preserves in a no-op update has nothing to lose, so demanding a recovery
  // report for it would make every unchanged update look like a failure.
  let expected = [
    ...(plan.dirty ?? []),
    ...(plan.slots?.migrate ?? []).map((entry) => entry.id),
  ];
  if (expected.length === 0) return { ok: true, recovered: [], expected: [] };

  if (restored === null || restored === undefined) {
    return { ok: false, reason: 'restoration returned nothing', expected, recovered: [] };
  }
  if (Array.isArray(restored.recovered)) {
    let recovered = restored.recovered;
    return {
      ok: recovered.length > 0,
      reason: recovered.length === 0 ? 'restoration reported recovering nothing' : null,
      expected,
      recovered,
    };
  }
  if (typeof restored === 'object' && Object.keys(restored).length === 0) {
    return { ok: false, reason: 'restoration returned an empty state', expected, recovered: [] };
  }
  return { ok: true, recovered: null, expected };
}

export const UPDATE_STATUSES = Object.freeze({
  applied: 'applied',
  blocked: 'update_blocked',
  failed: 'failed',
  // The switch reported success but changed nothing. This is its own status
  // rather than a flavour of `failed`, because the distinction is what stops a
  // host from mistaking "the call returned" for "the change landed".
  notApplied: 'update_not_applied',
  // The world moved while this plan was being prepared: another update or a
  // remount advanced the generation. Applying it now would overwrite newer
  // state with an older reading of it.
  stale: 'update_stale',
  // Restoration succeeded but recovered nothing that was carried forward, and
  // the caller did not explicitly accept losing it. A silent empty state is the
  // outcome this exists to prevent: the workspace would look fine and hold
  // nothing.
  stateLost: 'update_state_lost',
});

/**
 * What to do when restoration cannot recover what the plan carried.
 *
 *   require  refuse the update and keep the old composition (the default)
 *   discard  go ahead, but report exactly what was dropped
 *   migrate  hand the session to the descriptor's migration step and try again
 */
export const RESTORE_POLICIES = Object.freeze({
  require: 'require',
  discard: 'discard',
  migrate: 'migrate',
});

export const UPDATE_STRATEGIES = Object.freeze({
  checkpoint: 'checkpoint',
  deferred: 'deferred',
  restart: 'restart',
});

/**
 * Compares two descriptor state-slot declarations and decides, per slot, what
 * has to happen to it: carry the value across, migrate it, or re-acquire it.
 *
 * A slot that exists in both and keeps its kind is preserved. A slot whose kind
 * changed must migrate. A slot that is new has nothing to carry. A slot that
 * disappeared cannot be preserved and is reported so the caller can say so
 * rather than discovering it at restore time.
 */
export function planSlotMigration(previousSlots = [], nextSlots = []) {
  let previousById = new Map(previousSlots.map((slot) => [slot.id, slot]));
  let nextById = new Map(nextSlots.map((slot) => [slot.id, slot]));
  let preserve = [];
  let migrate = [];
  let reacquire = [];
  let dropped = [];

  for (let slot of nextSlots) {
    let before = previousById.get(slot.id);
    if (!before) {
      reacquire.push(slot.id);
      continue;
    }
    if (before.kind === slot.kind && before.migration === slot.migration) {
      preserve.push(slot.id);
    } else {
      migrate.push({ id: slot.id, from: before.kind, to: slot.kind });
    }
  }

  for (let slot of previousSlots) {
    if (!nextById.has(slot.id)) dropped.push(slot.id);
  }

  return { preserve, migrate, reacquire, dropped };
}

/**
 * Builds the update plan. Refuses rather than degrades: an update that cannot
 * carry a dirty slot is reported as blocked, with the slot named, so a host can
 * offer defer or export instead of quietly losing work.
 */
export function planCompositionUpdate(previous, next, options = {}) {
  let dirty = new Set(options.dirtySlots ?? []);
  let checkpointable = new Set(options.checkpointableSlots ?? []);
  let required = new Set(next.dependencies?.required ?? []);
  let available = new Set(options.available ?? []);
  let missing = [...required].filter((need) => !available.has(need));

  if (missing.length > 0) {
    return {
      status: UPDATE_STATUSES.blocked,
      reason: 'missing-dependency',
      missing,
      retryable: true,
    };
  }

  let slots = planSlotMigration(previous?.state?.slots ?? [], next?.state?.slots ?? []);

  // A dirty slot is only safe if its value can be written down and read back.
  // Anything else is user work that a switch would destroy.
  let unsavable = [...dirty].filter((id) => {
    let slot = (next?.state?.slots ?? []).find((candidate) => candidate.id === id)
      ?? (previous?.state?.slots ?? []).find((candidate) => candidate.id === id);
    if (!slot) return false;
    if (slot.kind === 'ephemeral') return true;
    return !checkpointable.has(id);
  });

  if (unsavable.length > 0) {
    return {
      status: UPDATE_STATUSES.blocked,
      reason: 'unsavable-dirty-state',
      unsavable,
      strategy: UPDATE_STRATEGIES.deferred,
      detail: 'These slots hold unsaved work that cannot be checkpointed. Defer the update, export the work, or restart explicitly.',
    };
  }

  if (previous?.id !== next?.id) {
    return {
      status: UPDATE_STATUSES.blocked,
      reason: 'different-composition',
      detail: 'A different composition is not an update. Close and open it instead.',
    };
  }

  let versionChanged = String(previous?.restoration?.version) !== String(next?.restoration?.version);
  if (versionChanged && !options.allowRestorationMigration) {
    return {
      status: UPDATE_STATUSES.blocked,
      reason: 'restoration-version-changed',
      unsavable: [...dirty],
      strategy: UPDATE_STRATEGIES.deferred,
      detail: 'The restoration contract changed; migrating it has not been authorised.',
    };
  }

  return {
    status: 'ready',
    slots,
    dirty: [...dirty],
    strategy: next.updates?.strategy ?? UPDATE_STRATEGIES.checkpoint,
    requiresMigration: slots.migrate.length > 0,
    // The reading this plan was built from. `applyCompositionUpdate` refuses to
    // act once the live generation has moved past it.
    baseGeneration: options.currentGeneration ?? null,
  };
}

/**
 * Executes a plan against live mounts.
 *
 * `prepare` must not re-run external effects. It receives the state being
 * carried forward and the list of resource handles to re-acquire, and the
 * contract is that a re-acquired handle is a new reference to the same effect,
 * never a second execution of it. Modules that cannot honour that must refuse
 * the update rather than pretend.
 */
export async function applyCompositionUpdate({ plan, previous, next, prepare, switchMount, release, currentGeneration, commitPoint, restorePolicy }) {
  if (!plan || plan.status !== 'ready') {
    return { status: plan?.status ?? UPDATE_STATUSES.blocked, reason: plan?.reason ?? 'no-plan' };
  }

  // A plan is a reading of the world at one generation. If the generation moved
  // while it was being prepared, its reading is out of date and applying it
  // would clobber whatever superseded it. This is checked before any work, so
  // a stale plan costs nothing and touches nothing.
  if (plan.baseGeneration !== undefined && plan.baseGeneration !== null) {
    if (currentGeneration !== undefined && currentGeneration !== null
      && currentGeneration !== plan.baseGeneration) {
      return {
        status: UPDATE_STATUSES.stale,
        reason: 'the generation this plan was built against has moved on',
        plannedAgainst: plan.baseGeneration,
        currentGeneration,
        previousStillMounted: true,
      };
    }
  }

  // The contract owns the release list rather than reading it off the prepared
  // object: a prepare that throws never returns that object, so anything it had
  // already acquired would otherwise be unreachable on the failure path.
  let releases = [];
  let carried = null;
  try {
    carried = await prepare({
      from: previous,
      to: next,
      slots: plan.slots,
      // Stated explicitly so a module cannot mistake this for a fresh mount.
      replayEffects: false,
      // Register every acquired resource as it is acquired, so cleanup does not
      // depend on preparation finishing.
      registerRelease(fn) {
        if (typeof fn === 'function') releases.push(fn);
        return fn;
      },
    });
  } catch (err) {
    // A candidate that got as far as acquiring resources must not keep them
    // because preparation failed. The old composition is untouched either way.
    let released = await releaseCandidateResources(carried, releases);
    return {
      status: UPDATE_STATUSES.failed,
      stage: 'prepare',
      reason: err?.message || String(err),
      previousStillMounted: true,
      candidateReleased: released,
    };
  }

  let restored = null;
  try {
    restored = await next.restoration.restore(carried?.session ?? {}, { owner: previous?.state });
  } catch (err) {
    let released = await releaseCandidateResources(carried, releases);
    return {
      status: UPDATE_STATUSES.failed,
      stage: 'restore',
      reason: err?.message || String(err),
      previousStillMounted: true,
      candidateReleased: released,
    };
  }

  // A restore that returns without throwing is not proof that the state came
  // back. When the plan carried something, an unreported recovery is treated as
  // a loss rather than as a clean switch, unless the caller explicitly accepted
  // discarding it.
  let recovery = describeRecovery(restored, plan);
  if (!recovery.ok) {
    let policy = restorePolicy ?? RESTORE_POLICIES.require;
    if (policy === RESTORE_POLICIES.require) {
      let releasedOnLoss = await releaseCandidateResources(carried, releases);
      return {
        status: UPDATE_STATUSES.stateLost,
        stage: 'restore',
        reason: recovery.reason,
        expected: recovery.expected,
        recovered: recovery.recovered,
        previousStillMounted: true,
        candidateReleased: releasedOnLoss,
      };
    }
  }

  // When the caller supplies a commit point, the switch happens through it, so
  // route, state, and ownership move as one act and readers only ever see a
  // complete generation. Without one, the plain callback is still honoured.
  let switchReport = null;
  try {
    if (commitPoint) {
      let committed = await commitPoint.commit({
        next: { route: next.route ?? null, state: restored, ownership: next.ownership ?? null },
        expectGeneration: plan.baseGeneration ?? undefined,
        reason: 'composition-update',
        apply: async () => switchMount({ prepared: carried, restored, definition: next }),
      });
      if (committed.result !== 'committed') {
        let releasedNow = await releaseCandidateResources(carried, releases);
        return {
          status: committed.result === 'commit_stale' ? UPDATE_STATUSES.stale : UPDATE_STATUSES.failed,
          stage: 'switch',
          reason: committed.reason ?? 'the switch was refused',
          previousStillMounted: true,
          candidateReleased: releasedNow,
        };
      }
      switchReport = { applied: [committed.generation], generation: committed.generation };
    } else {
      switchReport = await switchMount({ prepared: carried, restored, definition: next });
    }
  } catch (err) {
    // The switch did not take, so the candidate is discarded rather than
    // installed. Its acquired resources go with it; the old mount is untouched.
    let released = await releaseCandidateResources(carried, releases);
    return {
      status: UPDATE_STATUSES.failed,
      stage: 'switch',
      reason: err?.message || String(err),
      previousStillMounted: true,
      candidateReleased: released,
    };
  }

  // A switch that claims success while applying nothing must not be reported as
  // an applied update. A host whose `updateConfig` is an empty stub returns
  // undefined here, and that is the exact shape of a silent no-op.
  let declaredWork = plan.slots.migrate.length
    + plan.slots.reacquire.length
    + (plan.dirty?.length ? 1 : 0);
  let appliedWork = describeAppliedWork(switchReport);
  if (declaredWork > 0 && appliedWork.appliedNothing) {
    return {
      status: UPDATE_STATUSES.notApplied,
      stage: 'switch',
      reason: appliedWork.unverifiable
        ? 'the switch did not report what it applied, so the change cannot be verified'
        : 'the switch reported success but applied no declared change',
      declaredWork,
      previousStillMounted: true,
    };
  }

  // Released only after a successful switch, so a failure above never destroys
  // the working mount.
  let releaseFailure = null;
  try {
    await release?.();
  } catch (err) {
    releaseFailure = err?.message || String(err);
  }

  return {
    status: UPDATE_STATUSES.applied,
    migrated: plan.slots.migrate,
    preserved: plan.slots.preserve,
    reacquired: plan.slots.reacquire,
    dropped: plan.slots.dropped,
    stateNotRecovered: recovery.ok ? null : recovery.reason,
    releaseFailure,
  };
}
