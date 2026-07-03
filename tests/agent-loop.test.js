import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSession } from '../runtime/session.js';
import { buildDataChangeMessage, isDataChangeMessage } from '../runtime/data-change.js';
import { runConstructionLoop } from '../runtime/agent-loop.js';
import { commandFingerprintFor, mintConsentToken } from '../runtime/tool-policy.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/index.js';

const AGENT = Object.freeze({ kind: 'agent', id: 'agent-1' });
const USER = Object.freeze({ kind: 'human', id: 'user-1' });

function createTrace(confirmDecision = { action: 'confirm' }, onConfirm) {
  let messages = [];
  let confirms = [];
  return {
    messages,
    confirms,
    emit(message) {
      messages.push(message);
    },
    async confirm(request) {
      if (typeof onConfirm === 'function') onConfirm(request);
      confirms.push(request);
      return confirmDecision;
    },
  };
}

function onceTool(toolName, args = {}) {
  let index = 0;
  return {
    async nextStep(ctx) {
      index += 1;
      if (index === 1) return { type: 'tool', toolName, args, display: `Run ${toolName}` };
      return { type: 'done', display: 'Done.' };
    },
  };
}

function origin(reason, verdictId = 'verdict-1') {
  return {
    principal: AGENT,
    actor: 'agent-gated',
    reason,
    sessionId: 'session-1',
    baseRevision: 0,
    verdictId,
  };
}

describe('runConstructionLoop policy gate ordering', () => {
  it('evaluates board verdict before confirm, mints a consent token, then dispatches with an origin broadcast', async () => {
    let order = [];
    let broadcasts = [];
    let session = createSession({
      principal: AGENT,
      actor: 'agent-gated',
      sessionId: 'session-1',
    });
    let trace = createTrace({ action: 'confirm' }, () => order.push('confirm'));

    let result = await runConstructionLoop({
      adapter: onceTool('construction_scaffold_blank', { name: 'Granted', scope: ['config'] }),
      session,
      trace,
      contextId: 'ctx-1',
      evaluateIntent(intent, context) {
        order.push('gate');
        assert.equal(intent.intentId, 'command.invoke.agent:construction_scaffold_blank');
        assert.equal(intent.originContext, 'construction');
        assert.deepEqual(context.grants, undefined);
        return { status: 'accepted', verdictId: 'verdict-1' };
      },
      async dispatch(toolName, args) {
        order.push('dispatch');
        assert.equal(toolName, 'construction_scaffold_blank');
        assert.equal(args.baseRevision, 0);
        assert.equal(args.consentToken.verdictId, 'verdict-1');
        session.config = { version: WORKSPACE_SCHEMA_VERSION, name: args.name };
        session.revision = 1;
        return {
          status: 'ok',
          config: session.config,
          revision: 1,
          baseRevision: 0,
          changedPaths: ['config'],
          origin: origin('tool:construction_scaffold_blank'),
        };
      },
      broadcast(message) {
        broadcasts.push(message);
      },
    });

    assert.equal(result.stoppedReason, 'done');
    assert.deepEqual(order, ['gate', 'confirm', 'dispatch']);
    assert.equal(trace.confirms.length, 1);
    assert.equal(trace.confirms[0].confirmId, 'ctx-1:confirm:1:construction_scaffold_blank');
    assert.equal(trace.confirms[0].contextId, 'ctx-1');
    assert.equal(trace.confirms[0].originContext, 'construction');
    assert.equal(trace.confirms[0].verdictId, 'verdict-1');
    assert.equal(broadcasts.length, 1);
    assert.equal(isDataChangeMessage(broadcasts[0]), true);
    assert.deepEqual(broadcasts[0].payload.origin, origin('tool:construction_scaffold_blank'));
  });

  it('holds blocked verdicts without confirm or dispatch', async () => {
    let dispatched = false;
    let trace = createTrace();
    let session = createSession({ principal: AGENT, actor: 'agent-gated', sessionId: 'session-1' });

    let result = await runConstructionLoop({
      adapter: onceTool('construction_scaffold_blank', { name: 'Blocked', scope: ['config'] }),
      session,
      trace,
      evaluateIntent() {
        return { status: 'blocked', verdictId: 'verdict-block', reason: 'board blocked' };
      },
      async dispatch() {
        dispatched = true;
        return { status: 'ok' };
      },
    });

    assert.equal(result.stoppedReason, 'gate-blocked: construction_scaffold_blank');
    assert.equal(trace.confirms.length, 0);
    assert.equal(dispatched, false);
    assert.equal(trace.messages[0].parts[0].event.verdict, 'blocked');
  });
});

describe('runConstructionLoop config-changed-under-you protocol event', () => {
  it('surfaces workspace:config changes between tool calls as protocol history, not a tool failure', async () => {
    let seenContexts = [];
    let handler;
    let unsubscribed = false;
    let trace = createTrace();
    let session = createSession({ principal: AGENT, actor: 'agent-gated', sessionId: 'session-1' });
    let adapter = {
      async nextStep(ctx) {
        seenContexts.push(ctx);
        if (seenContexts.length === 1) {
          return { type: 'tool', toolName: 'construction_template_list', args: {}, display: 'List templates.' };
        }
        assert.equal(ctx.history.at(-1).event.type, 'config-changed-under-you');
        return { type: 'done', display: 'Done.' };
      },
    };

    let result = await runConstructionLoop({
      adapter,
      session,
      trace,
      subscribeConfigChanges(next) {
        handler = next;
        return () => { unsubscribed = true; };
      },
      evaluateIntent() {
        return { status: 'accepted', verdictId: 'verdict-read' };
      },
      async dispatch() {
        handler(buildDataChangeMessage('workspace:config', {
          revision: 3,
          changedPaths: ['config.modules.chat'],
          origin: {
            principal: USER,
            actor: 'user-direct',
            reason: 'manual edit',
            sessionId: 'session-2',
          },
        }));
        return { status: 'ok', templates: [] };
      },
    });

    assert.equal(result.stoppedReason, 'done');
    assert.equal(unsubscribed, true);
    let protocolEntry = result.history.find((entry) => entry.type === 'protocol');
    assert.equal(protocolEntry.event.type, 'config-changed-under-you');
    assert.equal(protocolEntry.event.revision, 3);
    assert.deepEqual(protocolEntry.event.changedPaths, ['config.modules.chat']);
    assert.deepEqual(protocolEntry.event.principal, USER);
    assert.equal(trace.messages.some((message) => message.parts?.[0]?.type === 'protocol_event'), true);
    assert.equal(result.history.filter((entry) => entry.status === 'error').length, 0);
  });
});

describe('runConstructionLoop consent-token confirm suppression', () => {
  it('does not re-prompt when a valid token covers the command footprint', async () => {
    let dispatchedArgs;
    let session = createSession({ principal: AGENT, actor: 'agent-gated', sessionId: 'session-1' });
    let footprint = ['config'];
    let args = { name: 'Tokened', scope: footprint, baseRevision: 0 };
    let commandFingerprint = commandFingerprintFor('construction_scaffold_blank', {
      args,
      footprint,
      baseRevision: 0,
    });
    let consentToken = mintConsentToken({
      confirmId: 'confirm-tokened',
      commandFingerprint,
      baseRevision: 0,
      footprint,
      originContext: 'construction',
      verdictId: 'verdict-tokened',
    });
    let trace = createTrace();

    let result = await runConstructionLoop({
      adapter: onceTool('construction_scaffold_blank', { ...args, consentToken }),
      session,
      trace,
      evaluateIntent() {
        return { status: 'accepted', verdictId: 'verdict-current' };
      },
      async dispatch(_toolName, nextArgs) {
        dispatchedArgs = nextArgs;
        session.config = { version: WORKSPACE_SCHEMA_VERSION, name: nextArgs.name };
        session.revision = 1;
        return {
          status: 'ok',
          config: session.config,
          revision: 1,
          baseRevision: 0,
          changedPaths: ['config'],
          origin: origin('tool:construction_scaffold_blank', 'verdict-current'),
        };
      },
    });

    assert.equal(result.stoppedReason, 'done');
    assert.equal(trace.confirms.length, 0);
    assert.deepEqual(dispatchedArgs.consentToken, consentToken);
  });
});
