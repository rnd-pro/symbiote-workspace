import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerSection,
  clearRegisteredSections,
  validateWorkspaceConfig,
} from '../validation/core.js';
import {
  dataSection,
  DATA_SECTION_ID,
  RESOURCE_CRUD_SOCKET_TYPES,
  DOCUMENT_ENVELOPE_SCHEMA,
  DOCUMENT_HISTORY_ENTRY_SCHEMA,
  EXECUTION_RECORD_SCHEMA,
  validateEngineGraphImportBody,
} from '../schema/sections/data.js';
import { RUN_STATUSES, TRIGGER_KINDS } from '../schema/constants.js';

function validate(config) {
  clearRegisteredSections();
  registerSection(dataSection);
  return validateWorkspaceConfig(config);
}

function codesFor(config) {
  return validate(config).errors.map((error) => error.code);
}

function baseConfig() {
  return {
    version: '1.0.0',
    name: 'demo',
    requires: {
      hostServices: {
        required: ['storage.collection.default'],
        optional: ['data.resource.orders'],
      },
    },
    i18n: {
      locales: ['en', 'ru'],
      defaultLocale: 'en',
      strategy: 'prefix',
      messages: { 'actions.save': { default: 'Save', locales: { ru: 'Сохранить' } } },
    },
    data: {
      collections: [
        { id: 'workflows', title: { default: 'Workflows' }, itemSchema: { kind: 'engine-graph' }, persistence: 'storage.collection.default' },
        { id: 'notes', itemSchema: { kind: 'custom', schema: { fields: [{ id: 'body', type: 'richtext' }] } }, persistence: 'storage.collection.default' },
      ],
      resources: [
        {
          id: 'orders',
          entity: { schema: { fields: [{ id: 'status', type: 'enum', values: ['open', 'shipped'] }, { id: 'createdAt', type: 'datetime' }] } },
          collection: { pagination: 'cursor', filterable: ['status', 'createdAt'], sortable: ['createdAt'], defaultSort: { field: 'createdAt', dir: 'desc' }, pageSizeMax: 200 },
          operations: ['list', 'get', 'create', 'update', 'delete'],
          hostCapability: 'data.resource.orders',
        },
      ],
    },
    assets: [
      { id: 'hero-video', kind: 'video', integrity: 'sha384-abcDEF123+/456==', sizeBytes: 10485760, source: { kind: 'registry', ref: 'acme.media/hero@1.2.0' } },
    ],
    content: {
      collections: [
        {
          id: 'testimonials',
          schema: { fields: [{ id: 'quote', type: 'l10n-string' }, { id: 'author', type: 'string' }, { id: 'photo', type: 'asset' }] },
          entries: [{ id: 't1', quote: { default: 'Great tool', locales: { ru: 'Отлично' } }, author: 'J. Chen', photo: 'asset:hero-video' }],
        },
      ],
    },
  };
}

describe('data section — registration + baseline', () => {
  beforeEach(() => clearRegisteredSections());

  it('registers under the "data" id and conforms to the section contract', () => {
    assert.equal(dataSection.id, DATA_SECTION_ID);
    assert.equal(typeof dataSection.validate, 'function');
    assert.equal(typeof dataSection.refProviders, 'function');
    assert.equal(typeof dataSection.refConsumers, 'function');
  });

  it('validates the empty envelope and a fully-populated config clean', () => {
    assert.equal(validate({ version: '1.0.0', name: 'x' }).ok, true);
    assert.equal(validate(baseConfig()).ok, true);
  });
});

describe('data section — D1 collections', () => {
  it('flags duplicate collection ids', () => {
    let cfg = baseConfig();
    cfg.data.collections[1].id = 'workflows';
    assert.ok(codesFor(cfg).includes('data.id.duplicate'));
  });

  it('flags unknown itemSchema.kind', () => {
    let cfg = baseConfig();
    cfg.data.collections[0].itemSchema.kind = 'spreadsheet';
    assert.ok(codesFor(cfg).includes('data.collections.kind'));
  });

  it('requires schema or schemaRef for a custom collection', () => {
    let cfg = baseConfig();
    cfg.data.collections[1].itemSchema = { kind: 'custom' };
    assert.ok(codesFor(cfg).includes('data.collections.custom'));
  });

  it('accepts a custom collection using schemaRef', () => {
    let cfg = baseConfig();
    cfg.data.collections[1].itemSchema = { kind: 'custom', schemaRef: 'notes-schema' };
    assert.equal(validate(cfg).ok, true);
  });

  it('requires the persistence capability to be declared in requires.hostServices', () => {
    let cfg = baseConfig();
    cfg.data.collections[0].persistence = 'storage.collection.undeclared';
    assert.ok(codesFor(cfg).includes('data.collections.persistence'));
  });

  it('rejects a non-boolean readOnly and a malformed history', () => {
    let cfg = baseConfig();
    cfg.data.collections[0].readOnly = 'yes';
    cfg.data.collections[0].history = { depth: -1 };
    let codes = codesFor(cfg);
    assert.ok(codes.includes('data.collections.readOnly'));
    assert.ok(codes.includes('data.collections.history'));
  });

  it('R4: exports the document ENVELOPE schema {id,name,tags,enabled?,folder?,revision}', () => {
    assert.deepEqual(DOCUMENT_ENVELOPE_SCHEMA.required, ['id', 'name', 'tags', 'revision']);
    for (let key of ['id', 'name', 'tags', 'enabled', 'folder', 'revision']) {
      assert.ok(key in DOCUMENT_ENVELOPE_SCHEMA.properties, `${key} in envelope`);
    }
  });

  it('R1: engine-graph body may carry ui.positions but not ui.viewport', () => {
    assert.equal(validateEngineGraphImportBody({ ui: { positions: { n1: [0, 0] } } }).length, 0);
    let errors = validateEngineGraphImportBody({ ui: { viewport: { zoom: 1, pan: [0, 0] } } });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'data.collections.body');
  });
});

describe('data section — D2 assets', () => {
  it('requires a mandatory well-formed SRI integrity', () => {
    let cfg = baseConfig();
    delete cfg.assets[0].integrity;
    assert.ok(codesFor(cfg).includes('data.assets.integrity'));
    cfg = baseConfig();
    cfg.assets[0].integrity = 'md5-nope';
    assert.ok(codesFor(cfg).includes('data.assets.integrity'));
  });

  it('requires a positive integer sizeBytes', () => {
    let cfg = baseConfig();
    delete cfg.assets[0].sizeBytes;
    assert.ok(codesFor(cfg).includes('data.assets.sizeBytes'));
    cfg = baseConfig();
    cfg.assets[0].sizeBytes = -5;
    assert.ok(codesFor(cfg).includes('data.assets.sizeBytes'));
  });

  it('accepts pack-minted dotted kinds and rejects malformed kinds', () => {
    let cfg = baseConfig();
    cfg.assets[0].kind = 'model.checkpoint';
    assert.equal(validate(cfg).ok, true);
    cfg = baseConfig();
    cfg.assets[0].kind = 'Video File';
    assert.ok(codesFor(cfg).includes('data.assets.kind'));
  });

  it('rejects URL-shaped source values and unknown source kinds', () => {
    let cfg = baseConfig();
    cfg.assets[0].source = { kind: 'registry', ref: 'https://cdn.example.com/hero.mp4' };
    assert.ok(codesFor(cfg).includes('data.assets.source'));
    cfg = baseConfig();
    cfg.assets[0].source = { kind: 'ipfs', cid: 'bafy' };
    assert.ok(codesFor(cfg).includes('data.assets.source'));
  });

  it('accepts a pack source and reports a broken asset: ref', () => {
    let cfg = baseConfig();
    cfg.assets[0].source = { kind: 'pack', pack: 'acme.brand', path: 'fonts/inter.woff2' };
    assert.equal(validate(cfg).ok, true);
    cfg = baseConfig();
    cfg.content.collections[0].entries[0].photo = 'asset:missing';
    assert.ok(codesFor(cfg).includes('data.ref.unresolved'));
  });
});

describe('data section — D3 resources', () => {
  it('reserves the CRUD socket-type names', () => {
    assert.deepEqual(RESOURCE_CRUD_SOCKET_TYPES, ['filter', 'sort', 'cursor', 'record', 'recordList']);
  });

  it('flags filterable/sortable/defaultSort naming undeclared fields', () => {
    let cfg = baseConfig();
    cfg.data.resources[0].collection.filterable = ['status', 'ghost'];
    cfg.data.resources[0].collection.defaultSort = { field: 'ghost', dir: 'desc' };
    let codes = codesFor(cfg).filter((c) => c === 'data.resources.collection');
    assert.ok(codes.length >= 2);
  });

  it('flags unknown operation verbs', () => {
    let cfg = baseConfig();
    cfg.data.resources[0].operations = ['list', 'purge'];
    assert.ok(codesFor(cfg).includes('data.resources.operations'));
  });

  it('requires hostCapability to be declared and accepts per-resource requires (R7)', () => {
    let cfg = baseConfig();
    cfg.data.resources[0].hostCapability = 'data.resource.unknown';
    assert.ok(codesFor(cfg).includes('data.resources.hostCapability'));
    cfg = baseConfig();
    cfg.data.resources[0].requires = 'auth.orders.read';
    assert.equal(validate(cfg).ok, true);
  });

  it('accepts entity.schemaRef in place of an inline schema', () => {
    let cfg = baseConfig();
    cfg.data.resources[0].entity = { schemaRef: 'orders-entity' };
    // filterable/sortable can no longer resolve fields -> expected errors, but schemaRef itself is accepted
    cfg.data.resources[0].collection = { pagination: 'cursor' };
    assert.equal(validate(cfg).ok, true);
  });
});

describe('data section — D4 content plane', () => {
  it('flags entry values violating the schema and unknown fields', () => {
    let cfg = baseConfig();
    cfg.content.collections[0].entries[0].author = 42;
    assert.ok(codesFor(cfg).includes('record.value.type'));
    cfg = baseConfig();
    cfg.content.collections[0].entries[0].mystery = 'x';
    assert.ok(codesFor(cfg).includes('data.content.entries'));
  });

  it('enforces the per-entry inline size cap and names $fragment', () => {
    let cfg = baseConfig();
    cfg.content.collections[0].entries[0].author = 'x'.repeat(70000);
    let report = validate(cfg);
    let sizeError = report.errors.find((e) => e.code === 'data.content.size');
    assert.ok(sizeError);
    assert.match(sizeError.message, /\$fragment/);
  });

  it('enforces the section-wide inline size cap', () => {
    let cfg = baseConfig();
    let entries = [];
    for (let i = 0; i < 8; i++) {
      entries.push({ id: `bulk${i}`, quote: { default: 'x' }, author: 'y'.repeat(40000), photo: 'asset:hero-video' });
    }
    cfg.content.collections[0].entries = entries;
    let codes = codesFor(cfg);
    assert.ok(codes.includes('data.content.size'));
  });

  it('resolves a content: ref between entries and reports a broken one', () => {
    let cfg = baseConfig();
    cfg.content.collections[0].schema.fields.push({ id: 'related', type: 'ref' });
    cfg.content.collections[0].entries[0].related = 'content:testimonials:t1';
    assert.equal(validate(cfg).ok, true);
    cfg.content.collections[0].entries[0].related = 'content:testimonials:ghost';
    assert.ok(codesFor(cfg).includes('data.ref.unresolved'));
  });
});

describe('data section — D5 i18n / L10N', () => {
  it('accepts the $t catalog form and the inline default/locales form', () => {
    let cfg = baseConfig();
    cfg.data.collections[0].title = { $t: 'actions.save' };
    assert.equal(validate(cfg).ok, true);
  });

  it('rejects the corrected msg/$loc/$i18n spellings (C1)', () => {
    for (let banned of ['msg', '$loc', '$i18n']) {
      let cfg = baseConfig();
      cfg.data.collections[0].title = { [banned]: 'actions.save' };
      assert.ok(codesFor(cfg).includes('data.l10n.form'), `${banned} rejected`);
    }
  });

  it('rejects a $t key absent from i18n.messages', () => {
    let cfg = baseConfig();
    cfg.data.collections[0].title = { $t: 'actions.missing' };
    assert.ok(codesFor(cfg).includes('data.l10n.catalog'));
  });

  it('rejects undeclared and non-BCP-47 locale tags', () => {
    let cfg = baseConfig();
    cfg.data.collections[0].title = { default: 'x', locales: { de: 'x' } };
    assert.ok(codesFor(cfg).includes('data.l10n.locales'));
    cfg = baseConfig();
    cfg.data.collections[0].title = { default: 'x', locales: { 'not a tag': 'x' } };
    assert.ok(codesFor(cfg).includes('data.l10n.locales'));
  });

  it('rejects locale variants when no top-level i18n exists', () => {
    let cfg = baseConfig();
    delete cfg.i18n;
    cfg.data.collections[0].title = { default: 'x', locales: { ru: 'x' } };
    assert.ok(codesFor(cfg).includes('data.l10n.locales'));
  });

  it('rejects defaultLocale outside locales and an unknown strategy', () => {
    let cfg = baseConfig();
    cfg.i18n.defaultLocale = 'fr';
    assert.ok(codesFor(cfg).includes('data.i18n.defaultLocale'));
    cfg = baseConfig();
    cfg.i18n.strategy = 'subdomain';
    assert.ok(codesFor(cfg).includes('data.i18n.strategy'));
  });

  it('rejects $t recursion inside the message catalog', () => {
    let cfg = baseConfig();
    cfg.i18n.messages['actions.save'] = { $t: 'actions.other' };
    assert.ok(codesFor(cfg).includes('data.l10n.form'));
  });
});

describe('data section — D6 $fragment', () => {
  it('accepts a $fragment at a declared slot with mandatory integrity', () => {
    let cfg = baseConfig();
    cfg.content.collections[0].entries = { $fragment: { pack: 'acme.site', path: 'fragments/e.json', integrity: 'sha384-abcDEF123+/456==' } };
    assert.equal(validate(cfg).ok, true);
  });

  it('rejects a $fragment at a non-slot position', () => {
    let cfg = baseConfig();
    cfg.data.collections[0].persistence = { $fragment: { ref: 'x@1', integrity: 'sha384-abcDEF123+/456==' } };
    assert.ok(codesFor(cfg).includes('data.fragment.slot'));
  });

  it('requires mandatory integrity and a valid ref shape', () => {
    let cfg = baseConfig();
    cfg.content.collections[0].entries = { $fragment: { pack: 'acme.site', path: 'fragments/e.json' } };
    assert.ok(codesFor(cfg).includes('data.fragment.integrity'));
    cfg = baseConfig();
    cfg.content.collections[0].entries = { $fragment: { integrity: 'sha384-abcDEF123+/456==' } };
    assert.ok(codesFor(cfg).includes('data.fragment.ref'));
  });

  it('rejects nested fragments (depth 1)', () => {
    let cfg = baseConfig();
    cfg.content.collections[0].entries = {
      $fragment: { pack: 'acme.site', path: 'e.json', integrity: 'sha384-abcDEF123+/456==', $fragment: { ref: 'y@1', integrity: 'sha384-abcDEF123+/456==' } },
    };
    assert.ok(codesFor(cfg).includes('data.fragment.nested'));
  });
});

describe('data section — D7 execution + history record schemas', () => {
  it('exports EXECUTION_RECORD_SCHEMA bound to RUN_STATUSES and TRIGGER_KINDS', () => {
    assert.equal(EXECUTION_RECORD_SCHEMA.statuses, RUN_STATUSES);
    assert.equal(EXECUTION_RECORD_SCHEMA.triggers, TRIGGER_KINDS);
    for (let key of ['runId', 'graphId', 'doc', 'status', 'nodes', 'actor', 'replay']) {
      assert.ok(key in EXECUTION_RECORD_SCHEMA.properties, `${key} in execution record`);
    }
  });

  it('exports DOCUMENT_HISTORY_ENTRY_SCHEMA {ops,inverseOps,actor,at,label,coalesceKey}', () => {
    assert.deepEqual(DOCUMENT_HISTORY_ENTRY_SCHEMA.required, ['ops', 'inverseOps', 'actor', 'at']);
    for (let key of ['ops', 'inverseOps', 'actor', 'at', 'label', 'coalesceKey']) {
      assert.ok(key in DOCUMENT_HISTORY_ENTRY_SCHEMA.properties, `${key} in history entry`);
    }
  });
});
