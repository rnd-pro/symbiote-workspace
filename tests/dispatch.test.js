import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WorkspaceState,
  createDocumentRuntime,
  createMemoryDocumentPersistence,
  createMemorySessionPersistence,
  createRouter,
  createSession,
  dispatch,
  isMutating,
  TOOLS,
} from '../runtime/index.js';
import { createCatalog } from '../catalog/index.js';
import { createToolRegistry, defineToolFamily } from '../runtime/tools/registry.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/value-classes.js';

const legacyToolNames = [
  'bridge_event',
  'add_group',
  'add_section',
  'add_menu_action',
  'register_panel_type',
];

function withBase(session, args = {}) {
  return { ...args, baseRevision: session.revision };
}

function documentConfig() {
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    name: 'Dispatch Documents',
    data: {
      collections: [{
        id: 'notes',
        itemSchema: { kind: 'custom', schemaRef: 'note' },
      }],
    },
  };
}

function catalogConfig() {
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    name: 'Dispatch Catalog',
    modules: [{
      id: 'acme:data-table',
      source: { kind: 'package', package: 'acme' },
      tagName: 'acme-data-table',
      title: 'Data Table',
      capabilities: ['data.table'],
    }],
  };
}

describe('dispatch registry composition', () => {
  it('merges family registries into one unique source of truth', () => {
    let names = TOOLS.map((tool) => tool.name);
    assert.equal(names.length, new Set(names).size);
    assert.ok(names.includes('workspace_describe'));
    assert.ok(names.includes('construction_scaffold_blank'));
    assert.ok(names.includes('module_register'));
    assert.ok(names.includes('config_export'));
    assert.ok(names.includes('pack_export'));
    assert.ok(names.includes('navigate'));
    assert.ok(names.includes('document.commit'));
    assert.ok(names.includes('workspace.session.commit'));
    assert.ok(names.includes('hook_add'));
    assert.ok(names.includes('grant_revoke'));
    assert.ok(names.includes('execution_submit'));
    assert.ok(names.includes('catalog_search'));
  });

  it('fails loudly on duplicate tool names across families', () => {
    let tool = {
      name: 'duplicate_tool',
      description: 'Duplicate fixture.',
      inputSchema: { type: 'object', properties: {} },
    };
    let familyA = defineToolFamily('a', [tool], { duplicate_tool: () => ({ status: 'ok' }) });
    let familyB = defineToolFamily('b', [tool], { duplicate_tool: () => ({ status: 'ok' }) });

    assert.throws(() => createToolRegistry([familyA, familyB]), /Duplicate dispatch tool name/);
  });

  it('requires every mutating tool to accept baseRevision', () => {
    for (let tool of TOOLS.filter((entry) => entry.mutates === true)) {
      assert.ok(tool.inputSchema.properties.baseRevision, `${tool.name} must accept baseRevision`);
    }
  });

  it('does not resolve removed legacy tool names', async () => {
    let names = new Set(TOOLS.map((tool) => tool.name));
    let session = createSession();

    for (let name of legacyToolNames) {
      assert.equal(names.has(name), false, `${name} must not be registered`);
      let result = await dispatch(name, {}, session, { actor: 'agent-gated' });
      assert.equal(result.status, 'error');
      assert.equal(result.code, 'unknown-tool');
    }
  });
});

describe('session and mutation contract', () => {
  it('creates sessions with revision and principal context', () => {
    let session = createSession({ principal: { kind: 'human', id: 'u1' }, actor: 'user-direct' });

    assert.equal(session.revision, 0);
    assert.equal(session.actor, 'user-direct');
    assert.deepEqual(session.principal, { kind: 'human', id: 'u1' });
    assert.equal(typeof session.sessionId, 'string');
  });

  it('identifies mutating tools under renamed names only', () => {
    assert.equal(isMutating('construction_scaffold_blank'), true);
    assert.equal(isMutating('module_register'), true);
    assert.equal(isMutating('document.commit'), true);
    assert.equal(isMutating('workspace.session.commit'), true);
    assert.equal(isMutating('grant_revoke'), true);
    assert.equal(isMutating('config_import'), true);
    assert.equal(isMutating('catalog_search'), false);
    assert.equal(isMutating('workspace_describe'), false);
    assert.equal(isMutating('navigate'), false);
    assert.equal(isMutating('component_discover'), false);
    assert.equal(isMutating('add_group'), false);
  });

  it('rejects mutating calls without baseRevision', async () => {
    let session = createSession();
    let result = await dispatch('construction_scaffold_blank', { name: 'Missing Base' }, session, {
      actor: 'agent-gated',
    });

    assert.equal(result.status, 'error');
    assert.equal(result.code, 'tool-contract');
    assert.match(result.hint, /baseRevision/);
    assert.equal(session.config, null);
    assert.equal(session.revision, 0);
  });

  it('rejects stale baseRevision before mutating', async () => {
    let session = createSession();
    await dispatch('construction_scaffold_blank', withBase(session, { name: 'Base' }), session, {
      actor: 'agent-gated',
    });

    let result = await dispatch('module_register', {
      baseRevision: 0,
      name: 'main',
      title: 'Main',
      component: 'sn-main',
    }, session, { actor: 'agent-gated' });

    assert.equal(result.status, 'error');
    assert.equal(result.code, 'revision_conflict');
    assert.equal(result.currentRevision, 1);
    assert.equal(session.config.panelTypes.main, undefined);
  });

  it('threads actor from dispatch options and ignores args.actor', async () => {
    let session = createSession({
      principal: { kind: 'human', id: 'cli-user' },
      actor: 'user-direct',
      sessionId: 's-test',
    });

    let result = await dispatch(
      'construction_scaffold_blank',
      withBase(session, { name: 'Actor Test', actor: 'agent-gated' }),
      session,
      { actor: 'user-direct' },
    );

    assert.equal(result.status, 'ok');
    assert.equal(result.revision, 1);
    assert.equal(result.baseRevision, 0);
    assert.equal(result.origin.actor, 'user-direct');
    assert.deepEqual(result.origin.principal, { kind: 'human', id: 'cli-user' });
    assert.equal(result.origin.sessionId, 's-test');
    assert.equal(session.config.name, 'Actor Test');
  });

  it('does not initialize config for current-workspace read-only tools', async () => {
    let session = createSession();
    let result = await dispatch('workspace_describe', {}, session, { actor: 'agent-gated' });

    assert.equal(result.status, 'error');
    assert.equal(result.code, 'workspace_config_missing');
    assert.equal(session.config, null);
  });
});

describe('W2 dispatch integration', () => {
  it('routes navigation through the composed registry context', async () => {
    let router = createRouter({
      views: [{
        id: 'item',
        route: {
          pattern: '/items/:id',
          params: [{ name: 'id', type: 'string' }],
        },
      }],
    }, { mode: 'memory' });
    let session = createSession({
      principal: { kind: 'agent', id: 'navigator' },
      actor: 'agent-gated',
    });
    session.router = router;

    let result = await dispatch('navigate', {
      to: { view: 'item', params: { id: 'tool' } },
    }, session, { actor: 'agent-gated' });

    assert.equal(result.ok, true);
    assert.equal(result.view, 'item');
    assert.match(result.intentId, /^navigate\.agent:/);
  });

  it('keeps document CAS independent from workspace session revision', async () => {
    let config = documentConfig();
    let documentRuntime = createDocumentRuntime({
      config,
      persistence: createMemoryDocumentPersistence(),
    });
    let session = createSession({ config });
    session.documentRuntime = documentRuntime;

    let created = await dispatch('collection.create', {
      baseRevision: 0,
      collectionId: 'notes',
      id: 'note_1',
      body: { text: 'draft' },
    }, session, { actor: 'agent-gated' });
    assert.equal(created.docAddress, 'doc:notes:note_1');
    assert.equal(session.revision, 0);

    let committed = await dispatch('document.commit', {
      baseRevision: 0,
      docAddress: 'doc:notes:note_1',
      ops: [{ op: 'set', path: 'body.text', value: 'updated' }],
    }, session, { actor: 'agent-gated' });
    assert.deepEqual(committed, { revision: 1 });
    assert.equal(session.revision, 0);
  });

  it('settles session-layout restoreOverlay before returning through dispatch', async () => {
    let configStack = new WorkspaceState({
      version: WORKSPACE_SCHEMA_VERSION,
      layout: { left: { ratio: 0.5 } },
    });
    let session = createSession({
      workspaceId: 'dispatch-layout',
      principal: { kind: 'human', id: 'u1' },
      actor: 'user-direct',
      sessionPersistence: createMemorySessionPersistence(),
    });
    session.workspaceState = configStack;

    await dispatch('workspace.session.commit', {
      baseRevision: 0,
      ops: [{ op: 'replace', path: '/geometry', value: { main: { left: { ratio: 0.35 } } } }],
    }, session, { actor: 'user-direct' });

    let promoted = await dispatch('layout_promote_geometry', {
      baseRevision: 0,
      sessionBaseRevision: 1,
      ops: [{ op: 'replace', path: 'layout.left.ratio', value: 0.35 }],
    }, session, { actor: 'user-direct' });
    assert.equal(promoted.status, 'ok');
    assert.deepEqual(promoted.restoreOverlay, { main: { left: { ratio: 0.35 } } });

    let undo = await dispatch('session.layout.undo', {
      baseRevision: 0,
      action: 'undo',
    }, session, { actor: 'user-direct' });
    assert.equal(undo.status, 'ok');
    assert.deepEqual(undo.restoreOverlayResult.restored, promoted.restoreOverlay);
    assert.equal(JSON.parse(JSON.stringify(undo)).restoreOverlayResult.restored.main.left.ratio, 0.35);
  });
});

describe('S4 catalog dispatch integration', () => {
  it('searches the session config catalog through the composed registry', async () => {
    let session = createSession({ config: catalogConfig() });

    let result = await dispatch('catalog_search', {
      capabilities: ['data.table'],
    }, session, { actor: 'agent-gated' });

    assert.equal(result.status, 'ok');
    assert.equal(result.hits[0].id, 'acme:data-table');
    assert.equal(result.hits[0].contributes.summary.tagName, undefined);
  });

  it('accepts an injected catalog for registry prior-art proof checks', async () => {
    let session = createSession();
    let catalog = createCatalog({
      registry: 'market',
      registryListings: [{
        id: 'timeline',
        version: '1.0.0',
        contributes: {
          modules: [{
            id: 'market:timeline',
            tagName: 'market-timeline',
            title: 'Timeline',
            capabilities: ['video.timeline'],
          }],
        },
      }],
    });

    let proof = await dispatch('catalog_proof', {
      capabilities: ['video.timeline'],
    }, session, { actor: 'agent-gated', catalog });

    assert.equal(proof.kind, 'catalogProof');
    assert.equal(proof.hits[0].id, 'market:timeline');
  });
});

describe('renamed dispatch tools', () => {
  it('runs surviving structure and config tools through the composed registry', async () => {
    let session = createSession();

    let created = await dispatch('construction_scaffold_blank', withBase(session, { name: 'Composed' }), session, {
      actor: 'agent-gated',
    });
    assert.equal(created.status, 'ok');

    let registered = await dispatch('module_register', withBase(session, {
      name: 'main',
      title: 'Main',
      component: 'sn-main',
    }), session, { actor: 'agent-gated' });
    assert.equal(registered.status, 'ok');

    let listed = await dispatch('module_list', {}, session, { actor: 'agent-gated' });
    assert.equal(listed.count, 1);
    assert.equal(listed.panelTypes.main.component, 'sn-main');

    let described = await dispatch('workspace_describe', {}, session, { actor: 'agent-gated' });
    assert.equal(described.name, 'Composed');

    let exported = await dispatch('config_export', {}, session, { actor: 'agent-gated' });
    assert.equal(exported.status, 'ok');
    assert.equal(JSON.parse(exported.json).name, 'Composed');
  });

  it('validates required arguments from the merged registry', async () => {
    let session = createSession();
    await dispatch('construction_scaffold_blank', withBase(session), session, { actor: 'agent-gated' });

    let result = await dispatch('module_register', withBase(session, { name: 'main' }), session, {
      actor: 'agent-gated',
    });

    assert.equal(result.status, 'error');
    assert.equal(result.code, 'tool-contract');
    assert.match(result.hint, /title/);
    assert.match(result.hint, /component/);
  });
});
