import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSession, dispatch, isMutating, TOOLS } from '../runtime/index.js';
import { createToolRegistry, defineToolFamily } from '../runtime/tools/registry.js';

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

describe('dispatch registry composition', () => {
  it('merges family registries into one unique source of truth', () => {
    let names = TOOLS.map((tool) => tool.name);
    assert.equal(names.length, new Set(names).size);
    assert.ok(names.includes('workspace_describe'));
    assert.ok(names.includes('construction_scaffold_blank'));
    assert.ok(names.includes('module_register'));
    assert.ok(names.includes('config_export'));
    assert.ok(names.includes('pack_export'));
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
    assert.equal(isMutating('config_import'), true);
    assert.equal(isMutating('workspace_describe'), false);
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
