import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerSection,
  clearRegisteredSections,
  validateWorkspaceConfig,
} from '../validation/core.js';
import { serverSection } from '../schema/sections/server.js';

const VERSION = '1.0.0';

function run(server, extra = {}) {
  clearRegisteredSections();
  registerSection(serverSection);
  return validateWorkspaceConfig({ version: VERSION, name: 'Server Workspace', ...extra, server });
}

function codes(result) {
  return result.errors.map((error) => error.code);
}

function has(result, code) {
  return result.errors.some((error) => error.code === code);
}

const INGRESS_REQUIRES = { hostServices: ['ingress.register', 'ingress.unregister'] };

function webhook(overrides = {}) {
  return {
    id: 'wf-webhooks',
    kind: 'webhook',
    methods: ['POST'],
    binding: { trigger: { pack: 'flow.triggers', nodeType: 'trigger.webhook' } },
    auth: 'public',
    ...overrides,
  };
}

describe('server section contract', () => {
  it('exports a registerable { id, validate, refProviders, refConsumers } section', () => {
    assert.equal(serverSection.id, 'server');
    assert.equal(typeof serverSection.validate, 'function');
    assert.equal(typeof serverSection.refProviders, 'function');
    assert.equal(typeof serverSection.refConsumers, 'function');
  });

  it('validates an absent and empty server subtree cleanly', () => {
    clearRegisteredSections();
    registerSection(serverSection);
    assert.equal(validateWorkspaceConfig({ version: VERSION }).ok, true);

    let result = run(undefined);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it('accepts a full portable server subtree', () => {
    let result = run(
      {
        endpoints: [
          webhook(),
          {
            id: 'orders-bulk',
            kind: 'http',
            methods: ['POST'],
            binding: { handler: { hostService: 'data.resource.orders', method: 'bulkUpdate' } },
            auth: 'auth.policy',
          },
          {
            id: 'pipeline-kick',
            kind: 'http',
            methods: ['POST'],
            binding: { graph: 'nightly-etl', node: 'ingest' },
            auth: 'public',
          },
        ],
        jobs: { groups: [{ id: 'render', title: { $t: 'jobs.render' } }, { id: 'export', title: 'Export' }] },
      },
      {
        requires: {
          packs: [{ id: 'flow.triggers' }],
          hostServices: ['ingress.register', 'auth.policy', 'data.resource.orders'],
        },
        engine: { graphs: [{ id: 'nightly-etl', nodes: [{ id: 'ingest' }] }] },
      },
    );
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });
});

describe('server.endpoints shape', () => {
  beforeEach(clearRegisteredSections);

  it('requires a portable id and rejects duplicates', () => {
    let missing = run({ endpoints: [webhook({ id: 'Bad Id' })] }, { requires: INGRESS_REQUIRES });
    assert.ok(has(missing, 'server.endpoint.id.invalid'));

    let dup = run(
      { endpoints: [webhook(), webhook()] },
      { requires: INGRESS_REQUIRES },
    );
    assert.ok(has(dup, 'server.endpoint.id.duplicate'), codes(dup).join(','));
  });

  it('rejects unknown kinds', () => {
    let result = run({ endpoints: [webhook({ kind: 'grpc' })] }, { requires: INGRESS_REQUIRES });
    assert.ok(has(result, 'server.endpoint.kind.unknown'));
  });

  it('rejects invalid methods and empty method lists', () => {
    let bad = run({ endpoints: [webhook({ methods: ['FETCH'] })] }, { requires: INGRESS_REQUIRES });
    assert.ok(has(bad, 'server.endpoint.methods.invalid'));

    let empty = run({ endpoints: [webhook({ methods: [] })] }, { requires: INGRESS_REQUIRES });
    assert.ok(has(empty, 'server.endpoint.methods.empty'));
  });

  it('defaults methods to ["POST"] for webhook but requires them for http', () => {
    let webhookOk = run({ endpoints: [webhook({ methods: undefined })] }, { requires: INGRESS_REQUIRES });
    assert.ok(!has(webhookOk, 'server.endpoint.methods.required'), codes(webhookOk).join(','));

    let httpMissing = run(
      { endpoints: [{ id: 'orders-bulk', kind: 'http', binding: { handler: { hostService: 'svc.orders', method: 'do' } }, auth: 'public' }] },
      { requires: { hostServices: ['ingress.register', 'svc.orders'] } },
    );
    assert.ok(has(httpMissing, 'server.endpoint.methods.required'));
  });

  it('rejects a config-level exposure key as an unknown key', () => {
    let result = run({ endpoints: [webhook({ exposed: true })] }, { requires: INGRESS_REQUIRES });
    assert.ok(has(result, 'server.endpoint.unknown_key'), codes(result).join(','));
  });
});

describe('server.endpoints binding union', () => {
  beforeEach(clearRegisteredSections);

  it('requires exactly one discriminant', () => {
    let empty = run({ endpoints: [webhook({ binding: {} })] }, { requires: INGRESS_REQUIRES });
    assert.ok(has(empty, 'server.endpoint.binding.empty'));

    let ambiguous = run(
      { endpoints: [webhook({ binding: { trigger: { pack: 'flow.triggers', nodeType: 'trigger.webhook' }, graph: 'g', node: 'n' } })] },
      { requires: INGRESS_REQUIRES },
    );
    assert.ok(has(ambiguous, 'server.endpoint.binding.ambiguous'));
  });

  it('resolves trigger.pack against requires.packs / plugins', () => {
    let unresolved = run({ endpoints: [webhook()] }, { requires: INGRESS_REQUIRES });
    assert.ok(has(unresolved, 'server.endpoint.binding.trigger.pack.unresolved'), codes(unresolved).join(','));

    let viaPlugins = run(
      { endpoints: [webhook()] },
      { requires: { hostServices: ['ingress.register'], plugins: ['flow.triggers'] } },
    );
    assert.ok(!has(viaPlugins, 'server.endpoint.binding.trigger.pack.unresolved'), codes(viaPlugins).join(','));
  });

  it('resolves graph bindings against config engine.graphs', () => {
    let brokenGraph = run(
      { endpoints: [{ id: 'kick', kind: 'http', methods: ['POST'], binding: { graph: 'missing', node: 'n' }, auth: 'public' }] },
      { requires: INGRESS_REQUIRES },
    );
    assert.ok(has(brokenGraph, 'server.endpoint.binding.graph.unresolved'));

    let brokenNode = run(
      { endpoints: [{ id: 'kick', kind: 'http', methods: ['POST'], binding: { graph: 'etl', node: 'missing' }, auth: 'public' }] },
      { requires: INGRESS_REQUIRES, engine: { graphs: [{ id: 'etl', nodes: [{ id: 'ingest' }] }] } },
    );
    assert.ok(has(brokenNode, 'server.endpoint.binding.graph.node.unresolved'));
  });

  it('resolves handler.hostService against requires.hostServices', () => {
    let result = run(
      { endpoints: [{ id: 'bulk', kind: 'http', methods: ['POST'], binding: { handler: { hostService: 'svc.missing', method: 'do' } }, auth: 'public' }] },
      { requires: INGRESS_REQUIRES },
    );
    assert.ok(has(result, 'server.endpoint.binding.handler.hostService.unresolved'));
  });

  it('rejects unknown keys inside a binding variant', () => {
    let result = run(
      { endpoints: [webhook({ binding: { trigger: { pack: 'flow.triggers', nodeType: 'trigger.webhook' }, extra: 1 } })] },
      { requires: { hostServices: ['ingress.register'], packs: ['flow.triggers'] } },
    );
    assert.ok(has(result, 'server.endpoint.binding.unknown_key'), codes(result).join(','));
  });
});

describe('server.endpoints auth (fail-closed)', () => {
  beforeEach(clearRegisteredSections);

  it('requires auth and never defaults open', () => {
    let result = run({ endpoints: [webhook({ auth: undefined })] }, { requires: INGRESS_REQUIRES });
    assert.ok(has(result, 'server.endpoint.auth.required'));
  });

  it('accepts the reserved "public" literal', () => {
    let result = run(
      { endpoints: [webhook({ auth: 'public' })] },
      { requires: { hostServices: ['ingress.register'], packs: ['flow.triggers'] } },
    );
    assert.ok(!has(result, 'server.endpoint.auth.required'));
    assert.ok(!has(result, 'server.endpoint.auth.unresolved'));
  });

  it('requires non-public auth ids to be declared in requires.hostServices', () => {
    let result = run(
      { endpoints: [webhook({ auth: 'auth.ingress.token' })] },
      { requires: { hostServices: ['ingress.register'], packs: ['flow.triggers'] } },
    );
    assert.ok(has(result, 'server.endpoint.auth.unresolved'));
  });

  it('rejects a non-portable auth value shape', () => {
    let result = run({ endpoints: [webhook({ auth: 'Bearer sk-secret' })] }, { requires: INGRESS_REQUIRES });
    assert.ok(has(result, 'server.endpoint.auth.invalid'));
  });

  it('flags URLs anywhere in the server subtree via value classes', () => {
    let result = run(
      { endpoints: [webhook({ id: 'https://example.com/hook' })] },
      { requires: INGRESS_REQUIRES },
    );
    assert.ok(has(result, 'server.value.non_portable'), codes(result).join(','));
  });
});

describe('server.jobs.groups (ids only)', () => {
  beforeEach(clearRegisteredSections);

  it('accepts { id, title? } and rejects duplicate ids', () => {
    let ok = run({ jobs: { groups: [{ id: 'render' }, { id: 'export', title: 'Export' }] } });
    assert.ok(!has(ok, 'server.jobs.group.id.duplicate'), codes(ok).join(','));

    let dup = run({ jobs: { groups: [{ id: 'render' }, { id: 'render' }] } });
    assert.ok(has(dup, 'server.jobs.group.id.duplicate'));
  });

  it('rejects any concurrency/limit/policy field as an unknown key', () => {
    let result = run({ jobs: { groups: [{ id: 'render', maxConcurrency: 4 }] } });
    assert.ok(has(result, 'server.jobs.group.unknown_key'), codes(result).join(','));
  });

  it('rejects an unknown key on server.jobs itself', () => {
    let result = run({ jobs: { groups: [{ id: 'render' }], limits: {} } });
    assert.ok(has(result, 'server.jobs.unknown_key'));
  });

  it('publishes portable job-group provider vocabulary', () => {
    let providers = serverSection.refProviders({ server: { jobs: { groups: [{ id: 'render' }, { id: 'render' }, { id: 'export' }] } } });
    assert.deepEqual(providers.map((provider) => provider.id), ['jobs.group:render', 'jobs.group:export']);
  });
});

describe('server unknown keys (declaration-home split)', () => {
  beforeEach(clearRegisteredSections);

  it('rejects a config-level endpoint exposure map on the server object', () => {
    let result = run({ endpoints: [webhook()], exposure: { 'wf-webhooks': 'exposed' } }, {
      requires: { hostServices: ['ingress.register'], packs: ['flow.triggers'] },
    });
    assert.ok(has(result, 'server.unknown_key'), codes(result).join(','));
  });
});

describe('S2.3 config-graph trigger cross-checks', () => {
  beforeEach(clearRegisteredSections);

  it('errors when endpoints are declared without an ingress.* host service', () => {
    let result = run(
      { endpoints: [webhook()] },
      { requires: { hostServices: ['auth.policy'], packs: ['flow.triggers'] } },
    );
    assert.ok(has(result, 'server.ingress.host_service.missing'), codes(result).join(','));
  });

  it('errors on an uncovered config-graph ingress trigger node', () => {
    let result = run(
      { endpoints: [] },
      {
        requires: { hostServices: ['ingress.register'] },
        engine: { graphs: [{ id: 'infra', nodes: [{ id: 'hook', type: 'trigger.webhook', trigger: { kind: 'ingress' } }] }] },
      },
    );
    assert.ok(has(result, 'server.ingress.trigger.uncovered'), codes(result).join(','));
  });

  it('accepts a config-graph ingress trigger node covered by a type-level endpoint binding', () => {
    let result = run(
      { endpoints: [webhook()] },
      {
        requires: { hostServices: ['ingress.register'], packs: ['flow.triggers'] },
        engine: { graphs: [{ id: 'infra', nodes: [{ id: 'hook', type: 'trigger.webhook', trigger: { kind: 'ingress' } }] }] },
      },
    );
    assert.ok(!has(result, 'server.ingress.trigger.uncovered'), codes(result).join(','));
  });

  it('errors when a schedule trigger node is present without a schedule.* host service', () => {
    let result = run(undefined, {
      requires: { hostServices: [] },
      engine: { graphs: [{ id: 'infra', nodes: [{ id: 'cron', type: 'trigger.cron', trigger: { kind: 'schedule' } }] }] },
    });
    assert.ok(has(result, 'server.schedule.host_service.missing'), codes(result).join(','));
  });
});
