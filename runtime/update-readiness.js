// Update readiness — what a host can check before it takes the update.
//
// Both release paths need this. Whether the fallback is deprecated in a
// preparatory release or removed in the next major, the host has to be able to
// find out in advance that it is not ready, rather than discovering it on the
// first update that silently remounts instead of updating.
//
// A readiness result is a list of findings with severities, not a boolean. A host
// that only cares about the blocking ones should not have to parse prose, and a
// host that wants to warn early should be able to see the rest.

export const READINESS_SEVERITIES = Object.freeze({
  blocking: 'blocking',
  warning: 'warning',
});

export const READINESS_CODES = Object.freeze({
  noRuntimeUpdate: 'runtime-update-unavailable',
  persistenceNotAtomic: 'persistence-not-atomic',
  missingCapability: 'host-capability-missing',
  fallbackWouldRemount: 'update-would-remount',
});

/**
 * Assesses whether this host can take a composition update without losing state.
 *
 * `probeRuntimeUpdate` lets a host state what its runtime offers, because the
 * check cannot safely call an update to find out — doing so would perform one.
 * A host that passes nothing is assumed to be uninformed, which is reported as a
 * warning rather than assumed to be ready.
 */
export function assessUpdateReadiness({
  runtimeUpdateMethods = [],
  persistence = null,
  requiredCapabilities = [],
  availableCapabilities = [],
  runtimeImplementsUpdate = null,
} = {}) {
  let findings = [];

  let canUpdate = runtimeUpdateMethods.length > 0
    || runtimeImplementsUpdate === true;
  if (!canUpdate) {
    findings.push({
      code: READINESS_CODES.noRuntimeUpdate,
      severity: READINESS_SEVERITIES.blocking,
      detail: 'The runtime offers no updateConfig/updateWorkspace/applyConfig, so an update would destroy the mount and build a new one, losing state that lived only in the old one.',
      remedy: 'Implement a real update on the runtime that reports what it applied.',
    });
  } else if (runtimeImplementsUpdate === null) {
    findings.push({
      code: READINESS_CODES.fallbackWouldRemount,
      severity: READINESS_SEVERITIES.warning,
      detail: 'An update method is present but the host has not stated that it is a real one. A no-op update method reports success while changing nothing.',
      remedy: 'Pass runtimeImplementsUpdate once the update is known to apply its changes.',
    });
  }

  if (persistence && persistence.capabilities?.atomicCommit !== true) {
    findings.push({
      code: READINESS_CODES.persistenceNotAtomic,
      severity: READINESS_SEVERITIES.blocking,
      detail: 'The persistence adapter does not declare capabilities.atomicCommit, so an acknowledged document write can be lost under concurrency.',
      remedy: 'Implement compareAndSet and declare capabilities.atomicCommit, or run the atomic persistence conformance suite against the adapter.',
    });
  }

  let available = new Set(availableCapabilities);
  for (let capability of requiredCapabilities) {
    if (!available.has(capability)) {
      findings.push({
        code: READINESS_CODES.missingCapability,
        severity: READINESS_SEVERITIES.blocking,
        detail: `Required host capability "${capability}" is not available.`,
        remedy: `Provide ${capability} before updating.`,
      });
    }
  }

  return {
    ready: findings.every((finding) => finding.severity !== READINESS_SEVERITIES.blocking),
    blocking: findings.filter((finding) => finding.severity === READINESS_SEVERITIES.blocking),
    findings,
  };
}

/**
 * The error a strict host raises instead of remounting.
 *
 * Kept as a distinct code so a host can tell "I refuse to lose your state" from
 * any other failure, and so the message can say what to do rather than only what
 * went wrong.
 */
export function updateRefusedError(detail) {
  let error = new Error(
    detail
      ?? 'This host cannot update the workspace in place: the runtime offers no update method, and remounting would lose state. Implement a real update, or run without strict updates to accept the remount.',
  );
  error.code = 'workspace_update_refused';
  error.recoverable = true;
  return error;
}
