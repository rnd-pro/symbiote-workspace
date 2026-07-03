import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIntentId,
  commandFingerprintFor,
  consentTokenMatches,
  evaluateToolIntent,
  findMatchingGrant,
  grantMatches,
  mintConsentToken,
  needsConfirm,
  toolConfirmPolicy,
  validateConsentToken,
  validateGrantRecord,
} from '../runtime/tool-policy.js';
import { createToolRegistry } from '../runtime/tools/registry.js';
import { grantHandlers, grantToolFamily } from '../runtime/tools/grant-tools.js';

const AGENT = Object.freeze({ kind: 'agent', id: 'agent-1' });
const USER = Object.freeze({ kind: 'human', id: 'user-1' });
const MINTED_BY = Object.freeze({
  kind: 'plan-approval',
  verdictId: 'verdict-1',
  confirmId: 'confirm-1',
});

function grant(overrides = {}) {
  return {
    id: 'grant_1',
    principal: AGENT,
    scope: ['config.modules'],
    kinds: ['module_register'],
    expiry: 'session',
    mintedBy: MINTED_BY,
    mintedAt: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

describe('tool policy actor lanes', () => {
  it('confirms agent mutations but not direct human gestures', () => {
    let agent = evaluateToolIntent('module_register', {
      actor: AGENT,
      footprint: ['config.modules.chat'],
      gateVerdict: { status: 'accepted', verdictId: 'v-agent' },
    });
    let human = evaluateToolIntent('module_register', {
      actor: USER,
      footprint: ['config.modules.chat'],
      gateVerdict: { status: 'accepted', verdictId: 'v-user' },
    });

    assert.equal(agent.policy, 'confirm');
    assert.equal(agent.needsConfirm, true);
    assert.equal(agent.intentId, 'command.invoke.agent:module_register');
    assert.equal(human.policy, 'auto');
    assert.equal(human.needsConfirm, false);
    assert.equal(human.intentId, 'command.invoke.user:module_register');
    assert.equal(toolConfirmPolicy('module_register', { actor: AGENT, footprint: ['config'] }), 'confirm');
    assert.equal(needsConfirm('module_register', { actor: USER, footprint: ['config'] }), false);
  });

  it('uses per-principal intent id stems for command, execution, and navigation intents', () => {
    assert.equal(buildIntentId('module_register', AGENT), 'command.invoke.agent:module_register');
    assert.equal(buildIntentId('module_register', USER), 'command.invoke.user:module_register');
    assert.equal(buildIntentId('execution.submit', AGENT), 'execution.submit.agent:execution.submit');
    assert.equal(buildIntentId('navigate', USER), 'navigate.user:navigate');
  });

  it('keeps unknown tools fail-safe', () => {
    let policy = evaluateToolIntent('not_a_real_tool', { actor: USER });
    assert.equal(policy.known, false);
    assert.equal(policy.policy, 'confirm');
    assert.equal(policy.reason, 'unknown-tool');
  });
});

describe('tool policy grants', () => {
  it('validates grant shape and matches by principal, tool kind, and scope prefix', () => {
    let record = grant();
    assert.equal(validateGrantRecord(record).ok, true);
    assert.equal(validateGrantRecord({ ...record, mintedBy: { kind: 'plan-approval' } }).ok, false);

    let match = grantMatches(record, {
      actor: AGENT,
      toolName: 'module_register',
      footprint: ['config.modules.chat.title'],
    });
    assert.equal(match.ok, true);

    assert.equal(grantMatches(record, {
      actor: USER,
      toolName: 'module_register',
      footprint: ['config.modules.chat.title'],
    }).reason, 'principal-mismatch');
    assert.equal(grantMatches(record, {
      actor: AGENT,
      toolName: 'layout_set',
      footprint: ['config.modules.chat.title'],
    }).reason, 'kind-mismatch');
    assert.equal(grantMatches(record, {
      actor: AGENT,
      toolName: 'module_register',
      footprint: ['config.routes.main'],
    }).reason, 'scope-mismatch');
  });

  it('auto-approves grant-covered agent mutations and confirms uncovered writes', () => {
    let covered = evaluateToolIntent('module_register', {
      actor: AGENT,
      footprint: ['config.modules.chat'],
      grants: [grant()],
      gateVerdict: { status: 'accepted', verdictId: 'v-1' },
    });
    let uncovered = evaluateToolIntent('module_register', {
      actor: AGENT,
      footprint: ['config.routes.main'],
      grants: [grant()],
      gateVerdict: { status: 'accepted', verdictId: 'v-1' },
    });

    assert.equal(covered.policy, 'auto');
    assert.equal(covered.reason, 'grant-covered');
    assert.equal(covered.grant.id, 'grant_1');
    assert.equal(uncovered.policy, 'confirm');
    assert.equal(findMatchingGrant([grant()], {
      actor: AGENT,
      toolName: 'module_register',
      footprint: ['config.modules.chat'],
    }).ok, true);
  });
});

describe('tool policy consent tokens', () => {
  it('accepts matching consent tokens and blocks writes outside token footprint', () => {
    let args = { name: 'chat', baseRevision: 4 };
    let footprint = ['config.modules.chat'];
    let commandFingerprint = commandFingerprintFor('module_register', {
      args,
      footprint,
      baseRevision: 4,
    });
    let token = mintConsentToken({
      confirmId: 'confirm-2',
      commandFingerprint,
      baseRevision: 4,
      footprint,
      originContext: 'construction',
      verdictId: 'verdict-2',
    });

    assert.equal(validateConsentToken(token).ok, true);
    assert.equal(consentTokenMatches(token, {
      commandFingerprint,
      baseRevision: 4,
      footprint,
    }).ok, true);

    let accepted = evaluateToolIntent('module_register', {
      actor: AGENT,
      args,
      footprint,
      baseRevision: 4,
      commandFingerprint,
      consentToken: token,
      gateVerdict: { status: 'accepted', verdictId: 'verdict-3' },
    });
    let outside = evaluateToolIntent('module_register', {
      actor: AGENT,
      args,
      footprint: ['config.routes.main'],
      baseRevision: 4,
      commandFingerprint,
      consentToken: token,
      gateVerdict: { status: 'accepted', verdictId: 'verdict-3' },
    });

    assert.equal(accepted.policy, 'auto');
    assert.equal(accepted.reason, 'consent-token');
    assert.equal(outside.policy, 'blocked');
    assert.equal(outside.reason, 'consent-footprint-exceeded');
  });

  it('rebases only when the new footprint stays inside the token and concurrent changes do not overlap', () => {
    let footprint = ['config.modules.chat'];
    let commandFingerprint = commandFingerprintFor('module_register', {
      args: { name: 'chat', baseRevision: 4 },
      footprint,
      baseRevision: 4,
    });
    let token = mintConsentToken({
      confirmId: 'confirm-3',
      commandFingerprint,
      baseRevision: 4,
      footprint,
      originContext: 'construction',
      verdictId: 'verdict-3',
    });

    let cleanRebase = consentTokenMatches(token, {
      commandFingerprint,
      baseRevision: 5,
      footprint,
      allowRebase: true,
      changedPathsSinceBase: ['config.routes.main'],
    });
    let overlapped = evaluateToolIntent('module_register', {
      actor: AGENT,
      footprint,
      baseRevision: 5,
      commandFingerprint,
      consentToken: token,
      allowRebase: true,
      changedPathsSinceBase: ['config.modules.chat.title'],
      gateVerdict: { status: 'accepted', verdictId: 'verdict-4' },
    });

    assert.equal(cleanRebase.ok, true);
    assert.equal(cleanRebase.rebased, true);
    assert.equal(overlapped.policy, 'confirm');
    assert.equal(overlapped.reason, 'consent-concurrent-overlap');
  });
});

describe('tool policy verdict-first ordering and R16', () => {
  it('lets board verdicts override live grants before confirm policy is considered', () => {
    let blocked = evaluateToolIntent('module_register', {
      actor: AGENT,
      footprint: ['config.modules.chat'],
      grants: [grant()],
      gateVerdict: { status: 'blocked', verdictId: 'verdict-block', reason: 'board-block' },
    });
    let pending = evaluateToolIntent('module_register', {
      actor: AGENT,
      footprint: ['config.modules.chat'],
      grants: [grant()],
      gateVerdict: { status: 'pendingApproval', verdictId: 'verdict-pending' },
    });

    assert.equal(blocked.policy, 'blocked');
    assert.equal(blocked.reason, 'board-block');
    assert.equal(blocked.grantInvalidated, true);
    assert.equal(pending.policy, 'pendingApproval');
    assert.equal(pending.needsConfirm, false);
  });
});

describe('grant tool family', () => {
  it('defines read-only list and mutating revoke tools for later dispatch integration', () => {
    let registry = createToolRegistry([grantToolFamily]);
    let list = registry.toolMap.get('grant_list');
    let revoke = registry.toolMap.get('grant_revoke');

    assert.equal(list.mutates, undefined);
    assert.equal(revoke.mutates, true);
    assert.ok(revoke.inputSchema.properties.baseRevision);
  });

  it('lists and revokes grants through the injected session store shape', async () => {
    let session = { grants: [grant(), grant({ id: 'grant_2', principal: USER })] };

    let listed = await grantHandlers.grant_list({ principalKind: 'agent' }, { session });
    assert.equal(listed.status, 'ok');
    assert.deepEqual(listed.grants.map((entry) => entry.id), ['grant_1']);

    let revoked = await grantHandlers.grant_revoke({ grantId: 'grant_1' }, { session });
    assert.equal(revoked.status, 'ok');
    assert.deepEqual(session.grants.map((entry) => entry.id), ['grant_2']);
  });
});
