import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createJobRuntime,
  createMemoryExecutionStore,
} from '../server/jobs.js';
import { WORKSPACE_EXECUTION_CHANNELS } from '../schema/constants.js';
import { handlers as executionHandlers } from '../runtime/tools/execution-tools.js';

function configWithGroups() {
  return {
    server: {
      jobs: {
        groups: [
          { id: 'main' },
          { id: 'slow' },
        ],
      },
    },
  };
}

function waitFor(check) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    let timer = setInterval(() => {
      attempts += 1;
      try {
        if (check()) {
          clearInterval(timer);
          resolve();
        } else if (attempts > 100) {
          clearInterval(timer);
          reject(new Error('Timed out waiting for condition.'));
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
      }
    }, 1);
  });
}

describe('job runtime', () => {
  it('admits idempotently and persists queued before any runner side effect', async () => {
    let order = [];
    let baseStore = createMemoryExecutionStore();
    let store = {
      ...baseStore,
      async putRecord(record, options) {
        order.push(`store:${record.status}`);
        return baseStore.putRecord(record, options);
      },
    };
    let runtime = createJobRuntime({
      store,
      runner: async () => {
        order.push('runner');
        return { status: 'done' };
      },
    });

    let first = await runtime.submit({
      target: { graphId: 'orders' },
      jobKey: 'same-work',
    });
    let second = await runtime.submit({
      target: { graphId: 'orders' },
      jobKey: 'same-work',
    });

    assert.equal(first.runId, second.runId);
    assert.equal(second.idempotent, true);
    assert.ok(order.indexOf('store:queued') > -1);
    assert.ok(order.indexOf('runner') > order.indexOf('store:queued'));
    assert.equal((await runtime.list()).records.length, 1);
  });

  it('rejects writes from a superseded epoch', async () => {
    let store = createMemoryExecutionStore();
    let stale = createJobRuntime({ store, autoStart: false });
    createJobRuntime({ store, autoStart: false });

    await assert.rejects(
      () => stale.submit({ target: { graphId: 'orders' } }),
      (err) => err.code === 'execution_epoch_superseded',
    );
  });

  it('validates capacity group ids against server.jobs.groups[]', async () => {
    let runtime = createJobRuntime({ config: configWithGroups(), autoStart: false });

    await assert.rejects(
      () => runtime.submit({ target: { graphId: 'orders' }, groupId: 'missing' }),
      (err) => err.code === 'execution_group_unresolved',
    );

    let submitted = await runtime.submit({ target: { graphId: 'orders' }, groupId: 'main' });
    assert.equal(submitted.status, 'ok');
    assert.equal(submitted.record.groupId, 'main');
  });

  it('enforces monotonic statuses and idempotent cancellation', async () => {
    let runtime = createJobRuntime({ autoStart: false });
    let submitted = await runtime.submit({ target: { graphId: 'orders' } });

    await assert.rejects(
      () => runtime.transition(submitted.runId, 'done'),
      (err) => err.code === 'execution_status_transition_illegal',
    );

    let cancelled = await runtime.cancel({ runId: submitted.runId, reason: 'test' });
    assert.equal(cancelled.record.status, 'cancelled');

    let secondCancel = await runtime.cancel({ runId: submitted.runId, reason: 'again' });
    assert.equal(secondCancel.idempotent, true);

    await assert.rejects(
      () => runtime.transition(submitted.runId, 'running'),
      (err) => err.code === 'execution_status_transition_illegal',
    );
  });

  it('keeps progress topics under runtime custody', async () => {
    let messages = [];
    let runtime = createJobRuntime({
      broadcast: (message) => messages.push(message),
      runner: async ({ emitNodeProgress, emitNodeOutput }) => {
        emitNodeProgress('n1', { pct: 50 });
        emitNodeOutput('n1', { value: 42 });
        return { status: 'done', nodes: [{ nodeId: 'n1', status: 'done' }] };
      },
    });

    let submitted = await runtime.submit({ target: { graphId: 'orders' }, mode: 'job' });
    await runtime.drain();

    let record = await runtime.record(submitted.runId);
    assert.equal(record.status, 'done');
    assert.ok(messages.some((message) => message.type === WORKSPACE_EXECUTION_CHANNELS.queue));
    assert.ok(messages.some((message) => message.type === WORKSPACE_EXECUTION_CHANNELS.nodeProgress));
    assert.ok(messages.some((message) => message.type === WORKSPACE_EXECUTION_CHANNELS.nodeOutput));
  });

  it('leashes interactive runs to the session signal but leaves detached jobs running', async () => {
    let interactiveSignal = null;
    let interactiveController = new AbortController();
    let interactive = createJobRuntime({
      runner: async ({ signal }) => {
        interactiveSignal = signal;
        return new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
        });
      },
    });

    let interactivePromise = interactive.submit({
      target: { graphId: 'orders' },
      mode: 'interactive',
      signal: interactiveController.signal,
    });
    await waitFor(() => interactiveSignal !== null);
    interactiveController.abort('disconnect');
    let interactiveResult = await interactivePromise;
    assert.equal(interactiveResult.record.status, 'cancelled');

    let detachedController = new AbortController();
    detachedController.abort('disconnect');
    let detached = createJobRuntime({
      runner: async () => ({ status: 'done' }),
    });
    let job = await detached.submit({
      target: { graphId: 'orders' },
      mode: 'job',
      signal: detachedController.signal,
    });
    await detached.drain();
    assert.equal((await detached.record(job.runId)).status, 'done');
  });

  it('exposes submit/cancel/reorder/attach/list through execution tool handlers', async () => {
    let runtime = createJobRuntime({
      config: configWithGroups(),
      autoStart: false,
    });
    let context = { session: { executionRuntime: runtime } };

    let first = await executionHandlers.execution_submit({
      target: { graphId: 'orders' },
      jobKey: 'a',
      groupId: 'main',
    }, context);
    let second = await executionHandlers.execution_submit({
      target: { graphId: 'orders' },
      jobKey: 'b',
      groupId: 'main',
    }, context);

    let reordered = await executionHandlers.execution_reorder({
      runId: second.runId,
      beforeRunId: first.runId,
    }, context);
    assert.deepEqual(reordered.queue.map((item) => item.runId), [second.runId, first.runId]);

    let attached = await executionHandlers.execution_attach({ runId: first.runId }, context);
    assert.equal(attached.snapshotTruth, true);
    assert.equal(attached.topics.queue, WORKSPACE_EXECUTION_CHANNELS.queue);

    let listed = await executionHandlers.execution_list({ groupId: 'main' }, context);
    assert.deepEqual(listed.records.map((record) => record.runId).sort(), [first.runId, second.runId].sort());

    let cancelled = await executionHandlers.execution_cancel({ runId: first.runId }, context);
    assert.equal(cancelled.record.status, 'cancelled');
  });
});
