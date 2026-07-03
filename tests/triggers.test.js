import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryTriggerRegistrationStore,
  createTriggerReconciler,
} from '../server/triggers.js';

function enabledDoc(kind = 'ingress', nodeId = 'hook-a') {
  return {
    docAddress: 'doc:graphs:graph_1',
    envelope: { id: 'graph_1', enabled: true },
    body: {
      id: 'graph-doc',
      nodes: [{
        id: nodeId,
        type: `${kind}-trigger`,
        trigger: { kind },
      }],
    },
  };
}

function configWithTrigger(kind = 'ingress') {
  return {
    engine: {
      graphs: [{
        id: 'cfg',
        nodes: [{
          id: 'cfg-trigger',
          type: `${kind}-trigger`,
          trigger: { kind },
        }],
      }],
    },
  };
}

describe('trigger reconciler', () => {
  it('writes the registration record durably before binding transport', async () => {
    let order = [];
    let baseStore = createMemoryTriggerRegistrationStore();
    let store = {
      ...baseStore,
      async set(record, options) {
        order.push(`store:${record.status}`);
        return baseStore.set(record, options);
      },
    };
    let ingressHost = {
      async register(record) {
        order.push(`host:${record.registrationId}`);
        return { bound: true };
      },
      async unregister() {},
    };

    let reconciler = createTriggerReconciler({
      store,
      ingressHost,
      listDocuments: async () => [enabledDoc()],
    });

    await reconciler.reconcile();

    assert.deepEqual(order.slice(0, 3), [
      'store:pending',
      'host:ingress:doc:graphs:graph_1:hook-a',
      'store:registered',
    ]);
  });

  it('is idempotent during steady-state reconcile and replays registrations on restart', async () => {
    let active = new Set();
    let registerCalls = 0;
    let store = createMemoryTriggerRegistrationStore();
    let ingressHost = {
      async register(record) {
        registerCalls += 1;
        active.add(record.registrationId);
        return { active: active.size };
      },
      async unregister(record) {
        active.delete(record.registrationId);
      },
    };
    let options = {
      store,
      ingressHost,
      listDocuments: async () => [enabledDoc()],
    };

    let first = createTriggerReconciler(options);
    await first.reconcile();
    await first.reconcile();

    assert.equal(registerCalls, 1);
    assert.equal(active.size, 1);

    let restarted = createTriggerReconciler(options);
    await restarted.activate();

    assert.equal(registerCalls, 2);
    assert.equal(active.size, 1);
  });

  it('unregisters when envelope.enabled leaves desired state', async () => {
    let enabled = true;
    let unregistered = [];
    let store = createMemoryTriggerRegistrationStore();
    let ingressHost = {
      async register(record) {
        return { id: record.registrationId };
      },
      async unregister(record) {
        unregistered.push(record.registrationId);
      },
    };
    let reconciler = createTriggerReconciler({
      store,
      ingressHost,
      listDocuments: async () => [{
        ...enabledDoc(),
        envelope: { id: 'graph_1', enabled },
      }],
    });

    await reconciler.reconcile();
    assert.equal((await store.list()).length, 1);

    enabled = false;
    await reconciler.handleDocumentChange({ payload: { channel: 'doc:graphs:graph_1' } });

    assert.deepEqual(unregistered, ['ingress:doc:graphs:graph_1:hook-a']);
    assert.equal((await store.list()).length, 0);
  });

  it('binds config-graph triggers on activation and unbinds in reverse order on deactivation', async () => {
    let calls = [];
    let ingressHost = {
      async register(record) {
        calls.push(`register:${record.registrationId}`);
      },
      async unregister(record) {
        calls.push(`unregister:${record.registrationId}`);
      },
    };
    let scheduleHost = {
      async register(record) {
        calls.push(`register:${record.registrationId}`);
      },
      async unregister(record) {
        calls.push(`unregister:${record.registrationId}`);
      },
    };
    let reconciler = createTriggerReconciler({
      config: {
        engine: {
          graphs: [
            configWithTrigger('ingress').engine.graphs[0],
            configWithTrigger('schedule').engine.graphs[0],
          ],
        },
      },
      ingressHost,
      scheduleHost,
    });

    await reconciler.activate();
    await reconciler.deactivate();

    assert.deepEqual(calls, [
      'register:ingress:cfg:cfg-trigger',
      'register:schedule:cfg:cfg-trigger',
      'unregister:schedule:cfg:cfg-trigger',
      'unregister:ingress:cfg:cfg-trigger',
    ]);
  });
});
