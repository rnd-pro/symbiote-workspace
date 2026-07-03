import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearRegisteredSections,
  registerSection,
  validateWorkspaceConfig,
} from '../validation/core.js';
import {
  getStatePersistenceTier,
  refProviders,
  resolveStatePath,
  stateSection,
} from '../schema/sections/state.js';

const VERSION = '1.0.0';

function run(config) {
  clearRegisteredSections();
  registerSection(stateSection);
  return validateWorkspaceConfig({ version: VERSION, name: 'state-test', ...config });
}

function codes(report) {
  return report.errors.map((error) => error.code);
}

function assertCode(report, code) {
  assert.ok(codes(report).includes(code), `expected ${code}, got ${JSON.stringify(report.errors)}`);
}

function validFields() {
  return [
    {
      id: 'workbench.open-files',
      type: 'list',
      items: {
        type: 'record',
        fields: [
          { id: 'key', type: 'string' },
          { id: 'path', type: 'string' },
        ],
      },
      persistence: 'session',
      default: [],
    },
    { id: 'workbench.active-file', type: 'string', persistence: 'session', default: '' },
    { id: 'chat.draft', type: 'string', persistence: 'ephemeral', default: '' },
    { id: 'live.tick', type: 'number', persistence: 'runtime' },
    {
      id: 'live.summary',
      type: 'string',
      persistence: 'runtime',
      kind: 'computed',
      deps: ['live.tick'],
      'fn-ref': 'acme:derive-summary',
    },
  ];
}

describe('state section registration', () => {
  beforeEach(clearRegisteredSections);

  it('exports a registerable {id, validate, refProviders, refConsumers} section', () => {
    assert.equal(stateSection.id, 'state');
    assert.equal(typeof stateSection.validate, 'function');
    assert.equal(typeof stateSection.refProviders, 'function');
    assert.equal(typeof stateSection.refConsumers, 'function');
    assert.doesNotThrow(() => registerSection(stateSection));
  });

  it('validates an empty envelope and a fully declared state section', () => {
    assert.equal(run({}).ok, true);
    let report = run({ state: { fields: validFields() } });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  });
});

describe('state.fields[] declaration rules', () => {
  it('rejects bad ids, duplicate ids, prefix collisions, and reserved namespaces', () => {
    let report = run({
      state: {
        fields: [
          { id: 'workbench.open--files', type: 'string', persistence: 'session' },
          { id: 'chat.draft', type: 'string', persistence: 'ephemeral' },
          { id: 'chat.draft', type: 'string', persistence: 'ephemeral' },
          { id: 'route.view', type: 'string', persistence: 'runtime' },
          { id: 'app', type: 'record', fields: [{ id: 'value', type: 'string' }], persistence: 'session' },
          { id: 'app.status', type: 'string', persistence: 'session' },
        ],
      },
    });
    assertCode(report, 'state.field.id');
    assertCode(report, 'state.field.duplicate');
    assertCode(report, 'state.field.reserved_namespace');
    assertCode(report, 'state.field.prefix_collision');
  });

  it('uses the record-schema grammar for field types and default values', () => {
    let report = run({
      state: {
        fields: [
          { id: 'bad.type', type: 'object', persistence: 'session' },
          { id: 'bad.default', type: 'string', persistence: 'session', default: 42 },
        ],
      },
    });
    assertCode(report, 'record.field.type');
    assertCode(report, 'state.field.default');
  });

  it('validates persistence tiers, scopes, and computed field rules', () => {
    let report = run({
      state: {
        fields: [
          { id: 'base.value', type: 'number', persistence: 'ephemeral' },
          { id: 'bad.tier', type: 'string', persistence: 'disk' },
          { id: 'bad.scope', type: 'string', persistence: 'session', scope: 'panel' },
          {
            id: 'bad.computed',
            type: 'string',
            persistence: 'workspace',
            kind: 'computed',
            deps: ['missing.value'],
          },
        ],
      },
    });
    assertCode(report, 'state.field.persistence');
    assertCode(report, 'state.field.scope');
    assertCode(report, 'state.computed.persistence');
    assertCode(report, 'state.computed.deps');
    assertCode(report, 'state.computed.fn_ref');
  });
});

describe('state reference resolution and tier lookup', () => {
  it('publishes exact declared fields and valid record/list subpaths', () => {
    let config = {
      state: { fields: validFields() },
      wires: [
        { id: 'w1', from: 'state:workbench.open-files.path', to: 'state:chat.draft' },
        { id: 'w2', from: 'state:route.params.file_id', to: 'state:session.docPresentation.notes.doc_1.zoom' },
      ],
    };
    let providers = refProviders({ version: VERSION, ...config }).map((entry) => entry.id);
    assert.ok(providers.includes('state:workbench.open-files'));
    assert.ok(providers.includes('state:workbench.open-files.path'));
    assert.ok(providers.includes('state:route.params.file_id'));
    assert.ok(providers.includes('state:session.docPresentation.notes.doc_1.zoom'));
  });

  it('reports undeclared paths and subpaths under scalar fields', () => {
    let report = run({
      state: { fields: validFields() },
      probes: ['state:missing.path', 'state:chat.draft.length'],
    });
    assertCode(report, 'state.ref.undeclared');
    assertCode(report, 'state.ref.scalar_path');
  });

  it('exposes the persistence tier for declared fields and nested state refs', () => {
    let config = { state: { fields: validFields() } };
    assert.equal(getStatePersistenceTier(config, 'state:workbench.open-files.path'), 'session');
    assert.equal(getStatePersistenceTier(config, 'state:live.tick'), 'runtime');
    assert.equal(getStatePersistenceTier(config, 'state:missing'), null);
    assert.equal(resolveStatePath(config, 'state:chat.draft').ok, true);
  });
});

describe('state write bans and stack binding checks', () => {
  it('rejects writes to route/session reserved namespaces except docPresentation', () => {
    let report = run({
      state: { fields: validFields() },
      wires: [
        { id: 'route-write', from: 'state:chat.draft', to: 'state:route.view' },
        { id: 'session-write', from: 'state:chat.draft', to: 'state:session.tasks' },
        { id: 'doc-presentation', from: 'state:chat.draft', to: 'state:session.docPresentation.notes.doc_1.zoom' },
      ],
    });
    let writeErrors = report.errors.filter((error) => error.code === 'state.reserved.write');
    assert.equal(writeErrors.length, 2, JSON.stringify(report.errors));
  });

  it('checks dynamic stack itemsBinding and activeBinding targets', () => {
    let report = run({
      state: {
        fields: [
          { id: 'bad.items', type: 'list', items: { type: 'record', fields: [{ id: 'path', type: 'string' }] }, persistence: 'session' },
          { id: 'bad.active', type: 'number', persistence: 'session' },
        ],
      },
      layouts: {
        main: {
          kind: 'stack',
          id: 'editors',
          itemsBinding: 'state:bad.items',
          activeBinding: 'state:bad.active',
        },
      },
    });
    assertCode(report, 'state.binding.items_key');
    assertCode(report, 'state.binding.active_type');
  });
});
