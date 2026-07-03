import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  bindConfigHooks,
  composeHookPolicy,
  dismissalKeyForHook,
  filterHookContext,
  previewHookMatches,
} from '../runtime/hook-bridge.js';
import { handlers as hookToolHandlers, hookToolFamily } from '../runtime/tools/hook-tools.js';

function hook(id, hookClass, extra = {}) {
  return {
    id,
    class: hookClass,
    trigger: { subject: 'event:w-main' },
    action: { kind: 'suggest', suggestion: { id } },
    policy: { mode: 'auto' },
    ...extra,
  };
}

function store() {
  let records = new Map();
  return {
    records,
    get: (key) => records.get(key),
    set: (key, value) => records.set(key, value),
  };
}

describe('hook bridge scheduling', () => {
  it('awaits guards by priority/id before non-guards run after the action', async () => {
    let calls = [];
    let bridge = bindConfigHooks({
      hooks: [
        hook('teach-b', 'teach', { priority: 10 }),
        hook('assist-a', 'assist', { priority: 1 }),
        hook('guard-b', 'guard', { priority: 1 }),
        hook('guard-a', 'guard', { priority: 5 }),
        hook('validate-a', 'validate', { priority: 0 }),
      ],
    }, {
      runHook: async ({ hook: activeHook }) => {
        calls.push(activeHook.id);
        return { status: 'ok' };
      },
    });

    let result = await bridge.fire('event:w-main', { row: 1 }, {
      action: () => calls.push('action'),
    });

    assert.equal(result.status, 'ok');
    assert.deepEqual(calls, ['guard-a', 'guard-b', 'action', 'validate-a', 'assist-a', 'teach-b']);
    bridge.close();
  });

  it('short-circuits on the first denying guard and emits deny telemetry', async () => {
    let telemetry = [];
    let bridge = bindConfigHooks({
      hooks: [
        hook('guard-a', 'guard', { priority: 5 }),
        hook('guard-b', 'guard', { priority: 1 }),
        hook('assist-a', 'assist'),
      ],
    }, {
      telemetry,
      runHook: async ({ hook: activeHook }) => activeHook.id === 'guard-a'
        ? { allow: false, reason: 'nope' }
        : { status: 'ok' },
    });

    let result = await bridge.fire('event:w-main', { row: 1 });

    assert.equal(result.status, 'denied');
    assert.deepEqual(telemetry.map((entry) => [entry.action, entry.hookId]), [
      ['fire', 'guard-a'],
      ['deny', 'guard-a'],
    ]);
    bridge.close();
  });

  it('runs non-guards from PubSub-style observer subscriptions after settled wire observation', async () => {
    let callbacks = new Map();
    let observation = {
      sub(subject, callback) {
        callbacks.set(subject, callback);
        return { remove: () => callbacks.delete(subject) };
      },
    };
    let calls = [];
    let bridge = bindConfigHooks({
      hooks: [
        hook('guard-a', 'guard'),
        hook('assist-a', 'assist'),
      ],
    }, {
      wireObservation: observation,
      runHook: async ({ hook: activeHook }) => calls.push(activeHook.id),
    });

    callbacks.get('event:w-main')({ wireId: 'w-main', value: { row: 1 } });
    await bridge.lastObservation;
    await Promise.resolve();

    assert.deepEqual(calls, ['assist-a']);
    bridge.close();
  });
});

describe('hook bridge policy and actions', () => {
  it('tightens hook policy monotonically and preserves grant-covered auto', () => {
    assert.equal(composeHookPolicy(
      hook('h', 'assist', { action: { kind: 'suggest' }, policy: { mode: 'silent' } }),
      { downstreamPolicy: 'confirm' },
    ).mode, 'confirm');
    assert.equal(composeHookPolicy(
      hook('h', 'assist', { action: { kind: 'invoke', effect: 'write' }, policy: { mode: 'auto' } }),
      { downstreamPolicy: 'auto', grantCovered: false },
    ).mode, 'confirm');
    assert.equal(composeHookPolicy(
      hook('h', 'assist', { action: { kind: 'invoke', effect: 'write' }, policy: { mode: 'auto' } }),
      { downstreamPolicy: 'auto', grantCovered: true },
    ).mode, 'auto');
    assert.equal(composeHookPolicy(
      hook('h', 'assist', { action: { kind: 'ask-agent' }, policy: { mode: 'silent' } }),
      { downstreamPolicy: 'silent' },
    ).mode, 'auto');
    assert.equal(composeHookPolicy(
      hook('h', 'assist', { action: { kind: 'invoke', effect: 'read' }, policy: { mode: 'silent' } }),
      { downstreamPolicy: 'auto', grantCovered: false },
    ).mode, 'silent');
    assert.equal(composeHookPolicy(
      hook('h', 'assist', { action: { kind: 'suggest' } }),
      { downstreamPolicy: 'auto' },
    ).mode, 'auto');
  });

  it('filters context.allow before leaving the page and enforces maxBytes', () => {
    assert.deepEqual(filterHookContext(
      { id: '1', secret: 'no', nested: { ok: true, nope: true } },
      { allow: ['$entry.id', '$entry.nested.ok'], maxBytes: 1024 },
    ), {
      entry: { id: '1', nested: { ok: true } },
    });

    assert.throws(
      () => filterHookContext({ id: '1' }, { allow: ['$entry.id'], maxBytes: 5 }),
      /maxBytes/,
    );
  });

  it('queues ask-agent by default during a running construction loop', async () => {
    let invoked = [];
    let bridge = bindConfigHooks({
      hooks: [
        hook('ask-a', 'assist', {
          action: { kind: 'ask-agent', prompt: 'inspect' },
          context: { allow: ['$entry.id'], maxBytes: 512 },
          policy: { mode: 'auto' },
        }),
      ],
    }, {
      constructionLoopRunning: true,
      agentChannel: {
        invoke: async (request) => {
          invoked.push(request);
          return { status: 'ok' };
        },
      },
    });

    let results = await bridge.scheduleHooks('event:w-main', { id: 'r1' }, { contextId: 'ctx-1' });

    assert.equal(results[0].result.status, 'queued');
    assert.equal(bridge.askAgentQueue.length, 1);
    assert.equal(invoked.length, 0);
    bridge.close();
  });

  it('uses subject-scoped dismissal through the injected teach store', async () => {
    let teachStore = store();
    let calls = 0;
    let subjectHook = hook('teach-a', 'teach', {
      dismissal: { scope: 'subject', subjectKey: '$entry.id' },
      context: { allow: ['$entry.id'], maxBytes: 512 },
      trigger: { subject: 'event:w-main', once: true },
      action: { kind: 'annotate' },
    });
    let bridge = bindConfigHooks({ hooks: [subjectHook] }, {
      teachStore,
      runHook: async () => {
        calls += 1;
        return { status: 'ok' };
      },
    });

    let key = dismissalKeyForHook(subjectHook, { id: 'r1' });
    teachStore.set(key, { status: 'dismissed', updatedAt: '2026-07-03T00:00:00.000Z' });
    await bridge.scheduleHooks('event:w-main', { id: 'r1' });
    await bridge.scheduleHooks('event:w-main', { id: 'r2' });

    assert.equal(calls, 1);
    assert.match(key, /^teach-a:sha256-/);
    bridge.close();
  });

  it('parks pack hook pendingApproval to hook activity instead of a modal path', async () => {
    let telemetry = [];
    let bridge = bindConfigHooks({
      hooks: [
        hook('pack-guard', 'guard', {
          action: { kind: 'propose-safe-action' },
          policy: { mode: 'confirm' },
        }),
      ],
    }, {
      telemetry,
      gate: () => ({ verdict: 'pendingApproval', reason: 'pack-review' }),
    });

    let result = await bridge.runGuards('event:w-main', { id: 'pack' }, {
      provenance: { kind: 'pack', id: 'p1' },
    });

    assert.equal(result.status, 'parked');
    assert.deepEqual(telemetry.map((entry) => entry.action), ['fire', 'park']);
    bridge.close();
  });

  it('emits retraction telemetry from the injected governor interface', () => {
    let listener;
    let telemetry = [];
    let bridge = bindConfigHooks({ hooks: [] }, {
      telemetry,
      governor: {
        getEpoch: () => 2,
        onRetract(callback) {
          listener = callback;
          return { remove() {} };
        },
      },
    });

    listener({ hookId: 'h1', subject: 'event:w-main', correlationId: 'c1' });

    assert.deepEqual(telemetry, [{
      type: 'hook-activity',
      action: 'retract',
      hookId: 'h1',
      subject: 'event:w-main',
      correlationId: 'c1',
      epoch: 2,
    }]);
    bridge.close();
  });
});

describe('hook tool family', () => {
  it('declares hook mutation tools and read-only preview tool', () => {
    let tools = new Map(hookToolFamily.tools.map((tool) => [tool.name, tool]));
    for (let name of ['hook_add', 'hook_update', 'hook_remove']) {
      assert.equal(tools.get(name).mutates, true);
    }
    assert.equal(tools.get('hook_list').mutates, undefined);
    assert.equal(tools.get('preview_hook_matches').mutates, undefined);
  });

  it('adds, lists, updates, removes, and previews hooks without dispatch integration', async () => {
    let config = { version: '1.0.0', name: 'Hooks', hooks: [] };
    let context = { config, session: {} };

    let added = await hookToolHandlers.hook_add({
      hook: hook('assist-a', 'assist'),
    }, { ...context, toolName: 'hook_add' });
    assert.equal(added.status, 'ok');
    config = added.config;

    let listed = await hookToolHandlers.hook_list({}, { config, toolName: 'hook_list' });
    assert.equal(listed.count, 1);

    let updated = await hookToolHandlers.hook_update({
      id: 'assist-a',
      patch: { priority: 3 },
    }, { config, toolName: 'hook_update' });
    assert.equal(updated.hook.priority, 3);
    config = updated.config;

    let preview = await hookToolHandlers.preview_hook_matches({
      subject: 'event:w-main',
      entry: { id: 'r1' },
    }, { config, session: {}, toolName: 'preview_hook_matches' });
    assert.deepEqual(preview.matches.map((match) => match.hookId), ['assist-a']);

    let removed = await hookToolHandlers.hook_remove({
      id: 'assist-a',
    }, { config, toolName: 'hook_remove' });
    assert.equal(removed.config.hooks.length, 0);
  });

  it('previews observer recent entries read-only', () => {
    let result = previewHookMatches({
      hooks: [hook('assist-a', 'assist')],
    }, {
      recent: [{ subject: 'event:w-main', entry: { id: 'r1' } }],
    });

    assert.deepEqual(result.matches.map((match) => match.hookId), ['assist-a']);
  });
});
