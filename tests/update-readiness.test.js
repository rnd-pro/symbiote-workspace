import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  READINESS_CODES,
  READINESS_SEVERITIES,
  assessUpdateReadiness,
  updateRefusedError,
} from '../runtime/update-readiness.js';

// Readiness exists so a host can find out it is not ready *before* it takes an
// update, instead of discovering it on the first update that silently remounts.
// Both release paths need this: whether the fallback is deprecated in a
// preparatory release or removed in the next major, the check is the same.

describe('update readiness', () => {
  it('blocks a host whose runtime offers no update method', () => {
    let result = assessUpdateReadiness({ runtimeUpdateMethods: [] });

    assert.equal(result.ready, false);
    let codes = result.blocking.map((finding) => finding.code);
    assert.ok(codes.includes(READINESS_CODES.noRuntimeUpdate));
  });

  it('blocks a host whose persistence adapter is not atomic', () => {
    let result = assessUpdateReadiness({
      runtimeUpdateMethods: ['updateConfig'],
      persistence: { get: async () => {}, set: async () => {} },
    });

    assert.equal(result.ready, false);
    assert.ok(
      result.blocking.some((finding) => finding.code === READINESS_CODES.persistenceNotAtomic),
      'a non-atomic adapter must block, because an acknowledged write can be lost',
    );
  });

  it('accepts an atomic adapter and a real update', () => {
    let result = assessUpdateReadiness({
      runtimeUpdateMethods: ['updateConfig'],
      runtimeImplementsUpdate: true,
      persistence: { capabilities: { atomicCommit: true } },
    });

    assert.equal(result.ready, true);
    assert.deepEqual(result.blocking, []);
  });

  it('warns rather than blocks when the host has not vouched for its update', () => {
    let result = assessUpdateReadiness({ runtimeUpdateMethods: ['updateConfig'] });

    assert.equal(result.ready, true, 'a present but unvouched method is not blocking');
    let warning = result.findings.find((finding) => finding.code === READINESS_CODES.fallbackWouldRemount);
    assert.equal(warning.severity, READINESS_SEVERITIES.warning);
    assert.ok(warning.remedy.length > 0, 'a finding must say what to do, not only what is wrong');
  });

  it('blocks a missing required host capability', () => {
    let result = assessUpdateReadiness({
      runtimeUpdateMethods: ['updateConfig'],
      runtimeImplementsUpdate: true,
      requiredCapabilities: ['storage.collection.default'],
      availableCapabilities: [],
    });

    assert.equal(result.ready, false);
    assert.ok(result.blocking.some((finding) => finding.code === READINESS_CODES.missingCapability));
  });

  it('gives every finding a code, a severity, and a remedy', () => {
    let result = assessUpdateReadiness({
      runtimeUpdateMethods: [],
      persistence: { get: async () => {} },
      requiredCapabilities: ['a', 'b'],
      availableCapabilities: [],
    });

    assert.ok(result.findings.length >= 3);
    for (let finding of result.findings) {
      assert.ok(finding.code, 'every finding must be classifiable');
      assert.ok(Object.values(READINESS_SEVERITIES).includes(finding.severity));
      assert.ok(finding.detail && finding.detail.length > 0);
      assert.ok(finding.remedy && finding.remedy.length > 0, 'a host needs to know what to do');
    }
  });

  it('distinguishes a refusal from any other failure', () => {
    let error = updateRefusedError();

    assert.equal(error.code, 'workspace_update_refused');
    assert.equal(error.recoverable, true, 'a refusal is not a crash; the host can react');
    assert.match(error.message, /lose state/);
  });
});
