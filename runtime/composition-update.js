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
  return { reported: false, appliedNothing: false, count: null };
}

export const UPDATE_STATUSES = Object.freeze({
  applied: 'applied',
  blocked: 'update_blocked',
  failed: 'failed',
  // The switch reported success but changed nothing. This is its own status
  // rather than a flavour of `failed`, because the distinction is what stops a
  // host from mistaking "the call returned" for "the change landed".
  notApplied: 'update_not_applied',
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
export async function applyCompositionUpdate({ plan, previous, next, prepare, switchMount, release }) {
  if (!plan || plan.status !== 'ready') {
    return { status: plan?.status ?? UPDATE_STATUSES.blocked, reason: plan?.reason ?? 'no-plan' };
  }

  let carried = null;
  try {
    carried = await prepare({
      from: previous,
      to: next,
      slots: plan.slots,
      // Stated explicitly so a module cannot mistake this for a fresh mount.
      replayEffects: false,
    });
  } catch (err) {
    return {
      status: UPDATE_STATUSES.failed,
      stage: 'prepare',
      reason: err?.message || String(err),
      previousStillMounted: true,
    };
  }

  let restored = null;
  try {
    restored = await next.restoration.restore(carried?.session ?? {}, { owner: previous?.state });
  } catch (err) {
    return {
      status: UPDATE_STATUSES.failed,
      stage: 'restore',
      reason: err?.message || String(err),
      previousStillMounted: true,
    };
  }

  let switchReport = null;
  try {
    switchReport = await switchMount({ prepared: carried, restored, definition: next });
  } catch (err) {
    return {
      status: UPDATE_STATUSES.failed,
      stage: 'switch',
      reason: err?.message || String(err),
      previousStillMounted: true,
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
      reason: 'the switch reported success but applied no declared change',
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
    releaseFailure,
  };
}
