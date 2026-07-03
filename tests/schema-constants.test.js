import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as constants from '../schema/constants.js';

const REPO_ROOT = new URL('../', import.meta.url);

describe('schema constants', () => {
  it('exports frozen id grammars with target runtime-id semantics', () => {
    let structuralAccepted = ['a', 'main', 'main-split', 'view-1'];
    let structuralRejected = ['A', '1-main', 'main--split', 'main_split', 'main.split'];
    for (let id of structuralAccepted) {
      assert.match(id, constants.STRUCTURAL_ID_PATTERN, `${id} should be structural`);
    }
    for (let id of structuralRejected) {
      assert.doesNotMatch(id, constants.STRUCTURAL_ID_PATTERN, `${id} should be rejected`);
    }

    assert.match('symbiote-ui:data-table', constants.MODULE_ID_PATTERN);
    assert.match('acme.video:sequence-editor', constants.MODULE_ID_PATTERN);
    assert.match('acme-video.ops-pack:sequence-editor', constants.MODULE_ID_PATTERN);
    assert.doesNotMatch('local.widget', constants.MODULE_ID_PATTERN);
    assert.match('workspace.session.snapshot.save', constants.CAPABILITY_ID_PATTERN);
    assert.doesNotMatch('workspace:session', constants.CAPABILITY_ID_PATTERN);

    assert.match('run_01H', constants.RUNTIME_ID_PATTERN);
    assert.match('DOC_42', constants.RUNTIME_ID_PATTERN);
    assert.doesNotMatch('run-01H', constants.RUNTIME_ID_PATTERN);
    assert.doesNotMatch('a'.repeat(65), constants.RUNTIME_ID_PATTERN);
    assert.equal(constants.CATALOG_FINGERPRINT_FORMAT, 'sha256-<hex>');
    assert.match('sha256-abc123', constants.CATALOG_FINGERPRINT_PATTERN);
  });

  it('exports target enum vocabularies once as frozen arrays', () => {
    assert.deepEqual(constants.RUN_STATUSES, [
      'queued',
      'running',
      'done',
      'failed',
      'cancelled',
      'partial',
    ]);
    assert.deepEqual(constants.TRIGGER_KINDS, ['manual', 'hook', 'schedule', 'ingress']);
    assert.deepEqual(constants.ENDPOINT_KINDS, ['webhook', 'http']);
    assert.deepEqual(constants.HOOK_CLASSES, [
      'validate',
      'guard',
      'teach',
      'automate',
      'anomaly',
      'assist',
    ]);
    assert.deepEqual(constants.HOOK_ACTION_KINDS, [
      'propose-safe-action',
      'ask-agent',
      'annotate',
      'suggest',
      'invoke',
    ]);
    assert.deepEqual(constants.POLICY_MODES, ['auto', 'confirm', 'silent']);
    assert.deepEqual(constants.PRINCIPAL_KINDS, ['human', 'agent', 'daemon']);
    assert.deepEqual(constants.GRANT_EXPIRIES, ['task', 'session', 'install']);
    assert.deepEqual(constants.VERDICTS, [
      'accepted',
      'blocked',
      'pendingApproval',
      'rolledBack',
    ]);
    assert.deepEqual(constants.DEPLOYMENT_RECORD_STATUSES, [
      'draft',
      'applied',
      'rolledBack',
      'superseded',
    ]);
    assert.deepEqual(constants.COLLECTION_ITEM_KINDS, ['engine-graph', 'custom']);
    assert.deepEqual(constants.RESOURCE_OPERATIONS, ['list', 'get', 'create', 'update', 'delete']);
    assert.deepEqual(constants.I18N_STRATEGIES, ['prefix', 'query', 'none']);
    assert.deepEqual(constants.ROUTE_QUERY_CODECS, [
      'string',
      'int',
      'csv',
      'json',
      'sort-tuple',
      'date-range',
    ]);
    assert.deepEqual(constants.ROUTE_RESERVED_QUERY, ['snap', 'locale']);
    assert.deepEqual(constants.STATE_PERSISTENCE_TIERS, [
      'session',
      'workspace',
      'ephemeral',
      'runtime',
    ]);
    assert.deepEqual(constants.STATE_RESERVED_NAMESPACES, ['route', 'session']);
    assert.deepEqual(constants.TASK_KINDS, ['construction']);
    assert.deepEqual(constants.TASK_STATUSES, [
      'active',
      'interrupted',
      'completed',
      'abandoned',
    ]);
    assert.deepEqual(constants.PARK_STAGES, ['confirmPending', 'pendingApproval']);
    assert.deepEqual(constants.LAYOUT_KINDS, ['bsp', 'stack']);
    assert.deepEqual(constants.SPLIT_RATIO_BOUNDS, { min: 0.05, max: 0.95 });
  });

  it('exports WAS classes, topics, channel names, and capability families', () => {
    assert.ok(constants.WAS_ADDRESS_CLASSES.includes('resource'));
    assert.ok(constants.RESERVED_ADDRESS_CLASSES.includes('resource'));
    assert.deepEqual(constants.RESERVED_ID_CHARACTERS, ['*', '{', '}', '[', ']']);
    assert.equal(constants.RT_PREFIX, 'rt:');
    assert.equal(constants.RT_WORKSPACE_EXECUTION_QUEUE, 'rt:workspace:execution:queue');
    assert.equal(
      constants.RT_WORKSPACE_EXECUTION_NODE_PROGRESS,
      'rt:workspace:execution:node-progress',
    );
    assert.equal(constants.RT_WORKSPACE_EXECUTION_NODE_OUTPUT, 'rt:workspace:execution:node-output');
    assert.equal(constants.RT_WORKSPACE_CAPABILITIES, 'rt:workspace:capabilities');
    assert.equal(constants.RT_WORKSPACE_REGISTRY_UPDATES, 'rt:workspace:registry:updates');
    assert.equal(constants.WORKSPACE_CONFIG_CHANNEL, 'workspace:config');
    assert.equal(constants.WORKSPACE_STATE_CHANNEL, 'workspace:state');
    assert.equal(constants.createDocumentChannelName('work-orders', '42'), 'doc:work-orders:42');

    assert.deepEqual(constants.COLLECTION_CAPABILITIES, [
      'collection.list',
      'collection.query',
      'collection.create',
      'collection.delete',
    ]);
    assert.ok(constants.DOCUMENT_CAPABILITIES.includes('document.presentation.save'));
    assert.ok(constants.WORKSPACE_SESSION_CAPABILITIES.includes('workspace.session.snapshot.list'));
    assert.ok(constants.WORKSPACE_STATE_CAPABILITIES.includes('workspace.state.commit'));
    assert.ok(constants.EXECUTION_CAPABILITIES.includes('execution.history.append'));
    assert.deepEqual(constants.INGRESS_CAPABILITIES, ['ingress.register', 'ingress.unregister']);
    assert.deepEqual(constants.SCHEDULE_CAPABILITIES, ['schedule.register', 'schedule.unregister']);
    assert.deepEqual(constants.ASSET_CAPABILITIES, ['asset.resolve', 'asset.fetch']);
    assert.equal(constants.AGENT_WEBMCP_CAPABILITY, 'agent.webmcp');
    assert.ok(constants.CAPABILITY_FAMILIES.agent.includes('agent.webmcp'));
  });

  it('exports defaults, caps, fragment slots, and classifier prefixes', () => {
    assert.deepEqual(constants.COLLECTION_HISTORY_DEFAULTS, {
      depth: 100,
      coalesceWindowMs: 300,
    });
    assert.deepEqual(constants.EXECUTION_HISTORY_DEFAULTS, {
      maxRecords: 1000,
      maxAgeDays: 30,
    });
    assert.equal(constants.CONTENT_INLINE_ENTRY_MAX_BYTES, 65536);
    assert.equal(constants.CONTENT_SECTION_INLINE_MAX_BYTES, 262144);
    assert.equal(constants.SESSION_GC_DEFAULTS.taskAbandonMs, 14 * 24 * 60 * 60 * 1000);
    assert.equal(constants.SESSION_GC_DEFAULTS.parkedPendingApprovalMs, 14 * 24 * 60 * 60 * 1000);
    assert.equal(constants.SESSION_LAYOUT_UNDO_DEPTH, 50);
    assert.ok(constants.FRAGMENT_SLOTS.includes('content.collections[*].entries'));
    assert.ok(constants.FRAGMENT_SLOTS.includes('narration.timelines[*]'));
    assert.deepEqual(constants.NON_STRUCTURAL_PATH_PREFIXES, [
      'narration.',
      'provenance.',
      'exports.shareKit.listing',
    ]);
  });

  it('freezes every exported object value', () => {
    for (let [name, value] of Object.entries(constants)) {
      assert.equal(Object.isFrozen(value), true, `${name} must be frozen`);
    }
  });

  it('does not introduce duplicate constant export names outside S1.0 legacy exports', async () => {
    let schemaFiles = [
      'schema/constants.js',
      'schema/workspace-schema.js',
    ];
    let exportedNames = new Set(Object.keys(constants));
    let legacyS10Exports = new Set([
      'COLLAPSE_POLICIES',
      'OVERFLOW_POLICIES',
      'RESPONSIVE_MODES',
      'MOBILE_DOCKS',
      'SWIPE_CONTROLS',
    ]);

    for (let file of schemaFiles) {
      if (file === 'schema/constants.js') continue;
      let source = await readFile(new URL(file, REPO_ROOT), 'utf8');
      for (let name of exportedNames) {
        if (legacyS10Exports.has(name)) continue;
        assert.doesNotMatch(
          source,
          new RegExp(`export\\s+const\\s+${name}\\b`),
          `${file} must not re-export ${name}`,
        );
      }
    }
  });
});
