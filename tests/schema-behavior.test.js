import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerSection,
  clearRegisteredSections,
  validateWorkspaceConfig,
} from '../validation/core.js';
import behaviorSection, {
  behaviorSection as namedBehaviorSection,
  compareHookSchedule,
  isStructuralChangePath,
  validateGrantRecord,
  validateConsentToken,
  validateDeploymentRecord,
  validateDeploymentRecords,
  HOOK_CLASS_PRECEDENCE,
  MAX_CONCURRENT_MODALS,
  AGENT_CHANNEL_INVOKE_REQUIRED_FIELDS,
} from '../schema/sections/behavior.js';

const VERSION = '1.0.0';
const INTEGRITY = 'sha256-abc123';

function base(extra = {}) {
  return { version: VERSION, name: 'Behavior Workspace', ...extra };
}

/** Registers a stub provider section so WAS-subject consumers resolve in isolation. */
function provide(ids) {
  registerSection({
    id: 'stub-providers',
    refProviders: () => ids.map((id, index) => ({ id, path: `stub[${index}]` })),
  });
}

function run(extra, providerIds = []) {
  registerSection(behaviorSection);
  if (providerIds.length) provide(providerIds);
  return validateWorkspaceConfig(base(extra));
}

function codes(result) {
  return result.errors.map((error) => error.code);
}

function baseHook(extra = {}) {
  return {
    id: 'h1',
    class: 'assist',
    title: { default: 'Hook' },
    trigger: { subject: 'state:selected' },
    action: { kind: 'suggest' },
    policy: { mode: 'confirm' },
    ...extra,
  };
}

describe('behavior section registration', () => {
  beforeEach(clearRegisteredSections);

  it('exports a registerable {id, validate, refProviders, refConsumers} section', () => {
    assert.equal(behaviorSection.id, 'behavior');
    assert.equal(namedBehaviorSection, behaviorSection);
    assert.equal(typeof behaviorSection.validate, 'function');
    assert.equal(typeof behaviorSection.refProviders, 'function');
    assert.equal(typeof behaviorSection.refConsumers, 'function');
  });

  it('validates an empty behavior config cleanly', () => {
    let result = run({}, []);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });
});

describe('behavior hooks', () => {
  beforeEach(clearRegisteredSections);

  it('accepts a well-formed hook when its subject resolves', () => {
    let result = run({ hooks: [baseHook()] }, ['state:selected']);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it('flags a bad class and a non-portable id', () => {
    let result = run({ hooks: [baseHook({ id: 'Bad Id', class: 'nope' })] }, ['state:selected']);
    assert.ok(codes(result).includes('behavior.hook.class'));
    assert.ok(codes(result).includes('behavior.hook.id'));
  });

  it('flags duplicate hook ids', () => {
    let result = run({ hooks: [baseHook(), baseHook()] }, ['state:selected']);
    assert.ok(codes(result).includes('behavior.hook.id.duplicate'));
  });

  it('rejects a malformed trigger subject and an out-of-class subject', () => {
    let malformed = run({ hooks: [baseHook({ trigger: { subject: 'not a subject' } })] });
    assert.ok(codes(malformed).includes('behavior.hook.subject.malformed'));

    clearRegisteredSections();
    let wrongClass = run({ hooks: [baseHook({ trigger: { subject: 'view:dashboard' } })] }, ['view:dashboard']);
    assert.ok(codes(wrongClass).includes('behavior.hook.subject.class'));
  });

  it('requires subjectKey in context.allow for subject-scoped dismissal', () => {
    let result = run({
      hooks: [baseHook({
        dismissal: { scope: 'subject', subjectKey: '$entry.workOrderId' },
        context: { allow: ['$entry.status'] },
      })],
    }, ['state:selected']);
    assert.ok(codes(result).includes('behavior.hook.dismissal.uncollected'));

    clearRegisteredSections();
    let ok = run({
      hooks: [baseHook({
        dismissal: { scope: 'subject', subjectKey: '$entry.workOrderId' },
        context: { allow: ['$entry.workOrderId'] },
      })],
    }, ['state:selected']);
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  });

  it('rejects non-$entry context.allow paths', () => {
    let result = run({ hooks: [baseHook({ context: { allow: ['workOrderId'] } })] }, ['state:selected']);
    assert.ok(codes(result).includes('behavior.hook.context.allow.entry'));
  });

  it('requires context.maxBytes for ask-agent and forbids silent ask-agent', () => {
    let missing = run({
      hooks: [baseHook({ action: { kind: 'ask-agent' }, policy: { mode: 'confirm' } })],
    }, ['state:selected']);
    assert.ok(codes(missing).includes('behavior.hook.askAgent.maxBytes'));

    clearRegisteredSections();
    let silent = run({
      hooks: [baseHook({
        action: { kind: 'ask-agent' },
        context: { allow: [], maxBytes: 4096 },
        policy: { mode: 'silent' },
      })],
    }, ['state:selected']);
    assert.ok(codes(silent).includes('behavior.hook.askAgent.silent'));
  });

  it('enforces the monotonic auto rule on mutating action kinds', () => {
    let result = run({
      hooks: [baseHook({ action: { kind: 'propose-safe-action' }, policy: { mode: 'auto' } })],
    }, ['state:selected']);
    assert.ok(codes(result).includes('behavior.hook.policy.monotonic'));
  });

  it('resolves invoke targets against requires.hostServices and validates args', () => {
    let hook = baseHook({
      action: {
        kind: 'invoke',
        target: { hostService: 'storage.document', method: 'save' },
        args: { docRef: '$entry.docRef' },
      },
      context: { allow: ['$entry.docRef'] },
      policy: { mode: 'confirm' },
    });
    let missing = run({ hooks: [hook] }, ['state:selected']);
    assert.ok(codes(missing).includes('behavior.hook.invoke.hostService'));

    clearRegisteredSections();
    let ok = run({
      hooks: [hook],
      requires: { hostServices: { required: ['storage.document'], optional: [] } },
    }, ['state:selected']);
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));

    clearRegisteredSections();
    let badArg = run({
      hooks: [baseHook({
        action: {
          kind: 'invoke',
          target: { hostService: 'storage.document', method: 'save' },
          args: { docRef: '$entry.missing' },
        },
        context: { allow: ['$entry.docRef'] },
        policy: { mode: 'confirm' },
      })],
      requires: { hostServices: { required: ['storage.document'] } },
    }, ['state:selected']);
    assert.ok(codes(badArg).includes('behavior.hook.invoke.args.source'));
  });

  it("requires trigger.once:true for class:'teach'", () => {
    let result = run({
      hooks: [baseHook({ class: 'teach', action: { kind: 'annotate' }, trigger: { subject: 'state:x' } })],
    }, ['state:x']);
    assert.ok(codes(result).includes('behavior.hook.teach.once'));
  });

  it('allows concurrent:true only for suggestion-only actions', () => {
    let bad = run({
      hooks: [baseHook({ concurrent: true, action: { kind: 'invoke', target: { hostService: 'x' } } })],
      requires: { hostServices: { required: ['x'] } },
    }, ['state:selected']);
    assert.ok(codes(bad).includes('behavior.hook.concurrent'));

    clearRegisteredSections();
    let ok = run({ hooks: [baseHook({ concurrent: true, action: { kind: 'suggest' } })] }, ['state:selected']);
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  });

  it('reports an unresolved hook subject as a broken reference', () => {
    let result = run({ hooks: [baseHook({ trigger: { subject: 'binding:missing-wire' } })] });
    let unresolved = result.errors.filter((error) => error.code === 'behavior.hook.subject.unresolved');
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].path, 'hooks[0].trigger.subject');
  });
});

describe('behavior provenance and decisions', () => {
  beforeEach(clearRegisteredSections);

  it('rejects unknown provenance fields (deleted session-tier logs)', () => {
    let result = run({ provenance: { brief: 'x', patches: [] } });
    assert.ok(codes(result).includes('behavior.provenance.unknown'));
  });

  it('validates the lineage sixth field and rejects extra identity fields', () => {
    let ok = run({
      provenance: {
        lineage: { source: { kind: 'workspace-package', id: 'ops-board', version: '2.0.0', integrity: INTEGRITY }, baseRevision: 40 },
      },
    });
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));

    clearRegisteredSections();
    let extra = run({
      provenance: {
        lineage: {
          source: { kind: 'workspace-package', id: 'ops-board', version: '2.0.0', integrity: INTEGRITY, author: 'me' },
          baseRevision: 40,
        },
      },
    });
    assert.ok(codes(extra).includes('behavior.lineage.source.unknown'));
  });

  it('errors on an active dangling decision and suggests flipping to orphaned', () => {
    let result = run({
      provenance: { decisions: [{ id: 'd1', subject: 'panel:main:chart', status: 'active', title: { default: 'x' } }] },
    });
    let dangling = result.errors.filter((error) => error.code === 'behavior.decision.subject.dangling');
    assert.equal(dangling.length, 1);
    assert.ok(result.suggestedPatches.some((patch) => patch.value === 'orphaned'));
  });

  it('allows an orphaned decision with a dangling subject (history tombstone)', () => {
    let result = run({
      provenance: { decisions: [{ id: 'd1', subject: 'panel:main:chart', status: 'orphaned', title: { default: 'x' } }] },
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it('rejects a malformed decision subject and a bad status', () => {
    let result = run({
      provenance: { decisions: [{ id: 'd1', subject: 'nonsense subject', status: 'live' }] },
    });
    assert.ok(codes(result).includes('behavior.decision.subject.malformed'));
    assert.ok(codes(result).includes('behavior.decision.status'));
  });
});

describe('behavior narration', () => {
  beforeEach(clearRegisteredSections);

  it('rejects the deleted narration.locales island', () => {
    let result = run({ narration: { locales: ['en'] } });
    assert.ok(codes(result).includes('behavior.narration.locales.deleted'));
  });

  it('validates timelines[].source vocabulary', () => {
    let bad = run({ narration: { timelines: [{ id: 't1', source: 'remote', revision: 5 }] } });
    assert.ok(codes(bad).includes('behavior.timeline.source'));

    clearRegisteredSections();
    let ok = run({ narration: { timelines: [{ id: 't1', source: 'workspaceRef', revision: 5 }] } });
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  });
});

describe('behavior exports.shareKit', () => {
  beforeEach(clearRegisteredSections);

  it('rejects a URL-shaped workspaceRef', () => {
    let result = run({ exports: { shareKit: { workspaceRef: { kind: 'registry', ref: 'https://example.com/x' } } } });
    assert.ok(codes(result).includes('behavior.workspaceRef.url'));
  });

  it('rejects an incomplete or URL-shaped listing backflow', () => {
    let incomplete = run({ exports: { shareKit: { listing: { registry: 'team', listingId: 'ops' } } } });
    assert.ok(codes(incomplete).includes('behavior.listing.incomplete'));

    clearRegisteredSections();
    let ok = run({
      exports: {
        shareKit: {
          listing: {
            registry: 'team', listingId: 'ops', version: '1.0.0',
            publishedAt: '2026-07-01T12:00:00Z', integrity: INTEGRITY,
          },
        },
      },
    });
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  });
});

describe('behavior grant-in-portable-config', () => {
  beforeEach(clearRegisteredSections);

  const grant = {
    id: 'g-7',
    principal: { kind: 'agent', id: 'construction' },
    scope: ['views[dashboard].*'],
    kinds: ['config_patch'],
    expiry: 'task',
  };

  it('errors on a grant object anywhere in portable config', () => {
    let top = run({ grants: [grant] });
    assert.ok(codes(top).includes('behavior.grant.embedded'));

    clearRegisteredSections();
    let nested = run({ hooks: [baseHook({ meta: { standingGrant: grant } })] }, ['state:selected']);
    assert.ok(codes(nested).includes('behavior.grant.embedded'));
  });
});

describe('behavior exported contracts', () => {
  it('orders non-guard hooks by class precedence, priority desc, then id', () => {
    assert.deepEqual(HOOK_CLASS_PRECEDENCE, ['validate', 'anomaly', 'assist', 'automate', 'teach']);
    let hooks = [
      { class: 'teach', id: 'b', priority: 0 },
      { class: 'validate', id: 'a', priority: 0 },
      { class: 'assist', id: 'z', priority: 1 },
      { class: 'assist', id: 'y', priority: 5 },
    ];
    let ordered = [...hooks].sort(compareHookSchedule).map((hook) => hook.id);
    assert.deepEqual(ordered, ['a', 'y', 'z', 'b']);
    assert.equal(MAX_CONCURRENT_MODALS, 1);
    assert.deepEqual(AGENT_CHANNEL_INVOKE_REQUIRED_FIELDS, ['contextId', 'signal']);
  });

  it('classifies structural vs non-structural change paths from the shared constant', () => {
    assert.equal(isStructuralChangePath('views[0].layout'), true);
    assert.equal(isStructuralChangePath('narration.timelines[0]'), false);
    assert.equal(isStructuralChangePath('provenance.revision'), false);
    assert.equal(isStructuralChangePath('exports.shareKit.listing.version'), false);
  });

  it('validates grant records', () => {
    assert.equal(validateGrantRecord({
      id: 'g-7', principal: { kind: 'agent', id: 'construction' },
      scope: ['a.*'], kinds: ['config_patch'], expiry: 'task', taskId: 't-1',
      mintedBy: { kind: 'plan-approval' }, mintedAt: '2026-07-01T00:00:00Z',
    }).ok, true);
    assert.equal(validateGrantRecord({ id: 'g', principal: { kind: 'agent' }, scope: [], kinds: [], expiry: 'never' }).ok, false);
    assert.equal(validateGrantRecord({ id: 'g', principal: { kind: 'agent' }, scope: ['a'], kinds: ['k'], expiry: 'task', mintedBy: {}, mintedAt: 'now' }).ok, false);
  });

  it('validates consent tokens', () => {
    assert.equal(validateConsentToken({
      confirmId: 'c-14', commandFingerprint: INTEGRITY, baseRevision: 42,
      footprint: ['views[main].layout.*'], originContext: 'hook:p1-escalation', verdictId: 'v-91',
    }).ok, true);
    assert.equal(validateConsentToken({
      confirmId: 'c', commandFingerprint: 'nope', baseRevision: 1.5,
      footprint: [], originContext: 'elsewhere', verdictId: 'v',
    }).ok, false);
  });

  it('validates deployment records and the rolledBack-successor rule', () => {
    let applied = {
      recordId: 'rel-17', status: 'applied', manifestHash: INTEGRITY, configFingerprint: 'F3',
      packHashes: [INTEGRITY], shellVersion: 'S1', verdictId: 'v-102',
      principal: { kind: 'human', id: 'op-1' }, appliedAt: '2026-07-01T00:00:00Z',
    };
    assert.equal(validateDeploymentRecord(applied).ok, true);
    assert.equal(validateDeploymentRecord({ recordId: 'rel-1', status: 'applied' }).ok, false);
    assert.equal(validateDeploymentRecord({ recordId: 'r', status: 'applied', ...appliedRest(applied), expedited: true }).ok, false);

    let rolledBackAlone = validateDeploymentRecords([{ recordId: 'rel-16', status: 'rolledBack' }]);
    assert.equal(rolledBackAlone.ok, false);
    let withSuccessor = validateDeploymentRecords([
      { recordId: 'rel-16', status: 'rolledBack' },
      { ...applied, recordId: 'rel-18', previousRecordId: 'rel-16' },
    ]);
    assert.equal(withSuccessor.ok, true, JSON.stringify(withSuccessor.errors));
  });
});

function appliedRest(applied) {
  let { recordId, status, ...rest } = applied;
  return rest;
}
