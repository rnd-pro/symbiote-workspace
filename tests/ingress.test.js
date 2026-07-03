import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createIngressRouter } from '../server/ingress.js';
import { createJobRuntime } from '../server/jobs.js';

function configWithEndpoints() {
  return {
    server: {
      endpoints: [
        {
          id: 'public-graph',
          kind: 'webhook',
          auth: 'public',
          binding: { graph: 'orders', node: 'receive' },
        },
        {
          id: 'private-handler',
          kind: 'http',
          methods: ['POST'],
          auth: 'auth.check',
          binding: { handler: { hostService: 'svc.echo', method: 'handle' } },
        },
        {
          id: 'closed',
          kind: 'webhook',
          binding: { graph: 'orders', node: 'closed' },
        },
        {
          id: 'disabled-endpoint',
          kind: 'webhook',
          auth: 'public',
          binding: { graph: 'orders', node: 'disabled' },
        },
      ],
    },
  };
}

describe('ingress router', () => {
  it('dispatches public graph bindings as daemon-stamped execution jobs', async () => {
    let executionRuntime = createJobRuntime({ config: configWithEndpoints(), autoStart: false });
    let router = createIngressRouter({
      config: configWithEndpoints(),
      executionRuntime,
      mintToken: (endpoint) => `${endpoint.id}-token`,
    });
    let registrations = router.registerAll();
    let graph = registrations.find((registration) => registration.endpointId === 'public-graph');

    let response = await router.route({
      method: 'POST',
      path: graph.path,
      headers: { 'x-request-id': 'evt-1' },
      body: { id: 1 },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(typeof response.body.runId, 'string');

    let record = await executionRuntime.record(response.body.runId);
    assert.equal(record.status, 'queued');
    assert.equal(record.mode, 'job');
    assert.equal(record.trigger.kind, 'ingress');
    assert.equal(record.target.graphId, 'orders');
    assert.equal(record.target.nodeId, 'receive');
    assert.deepEqual(record.actor.principal, { kind: 'daemon', id: 'public-graph' });
    assert.equal(record.actor.actor, 'system');
  });

  it('keeps auth fail-closed and never defaults missing auth to public', async () => {
    let router = createIngressRouter({
      config: configWithEndpoints(),
      executionRuntime: createJobRuntime({ autoStart: false }),
      mintToken: (endpoint) => `${endpoint.id}-token`,
    });
    let closed = router.registerAll().find((registration) => registration.endpointId === 'closed');

    await assert.rejects(
      () => router.route({ method: 'POST', path: closed.path }),
      (err) => err.code === 'ingress_auth_required' && err.statusCode === 403,
    );
  });

  it('respects deployment exposure before dispatching a binding', async () => {
    let submitCalls = 0;
    let router = createIngressRouter({
      config: configWithEndpoints(),
      exposureMap: { 'disabled-endpoint': 'disabled' },
      submitExecution: async () => {
        submitCalls += 1;
        return { runId: 'run_disabled' };
      },
      mintToken: (endpoint) => `${endpoint.id}-token`,
    });
    let disabled = router.registerAll().find((registration) => registration.endpointId === 'disabled-endpoint');

    await assert.rejects(
      () => router.route({ method: 'POST', path: disabled.path }),
      (err) => err.code === 'ingress_disabled' && err.statusCode === 404,
    );
    assert.equal(submitCalls, 0);
  });

  it('dispatches handler bindings through auth and host-service seams', async () => {
    let seen = {};
    let router = createIngressRouter({
      config: configWithEndpoints(),
      mintToken: (endpoint) => `${endpoint.id}-token`,
      authenticate: async (capability, request) => {
        assert.equal(capability, 'auth.check');
        assert.equal(request.headers.authorization, 'Bearer ok');
        return { accepted: true, principal: { kind: 'human', id: 'u1' } };
      },
      invokeHostService: async (hostService, method, payload, context) => {
        seen = { hostService, method, payload, context };
        return { ok: true, echoed: payload.request.body };
      },
    });
    let handler = router.registerAll().find((registration) => registration.endpointId === 'private-handler');

    let response = await router.route({
      method: 'POST',
      path: handler.path,
      headers: { authorization: 'Bearer ok' },
      body: { hello: 'world' },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true, echoed: { hello: 'world' } });
    assert.deepEqual(seen.hostService, 'svc.echo');
    assert.deepEqual(seen.method, 'handle');
    assert.deepEqual(seen.payload.principal, { kind: 'daemon', id: 'private-handler' });
    assert.deepEqual(seen.payload.authPrincipal, { kind: 'human', id: 'u1' });
    assert.equal(seen.context.actor, 'system');
  });
});
