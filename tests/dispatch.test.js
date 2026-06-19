import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { dispatch, TOOLS, isMutating, createSession } from '../runtime/index.js';

let ROOT = resolve(import.meta.dirname, '..');
let TMP_ROOT = resolve(ROOT, 'tmp');
let EXPECTED_TOOL_COUNT = 69;
let WORKFLOW_KANBAN_BOARD = Object.freeze({
  id: 'release-flow',
  title: 'Release Flow',
  columns: [
    { id: 'ready', title: 'Ready', cards: [{ id: 'card-1', title: 'Prepare release notes' }] },
    { id: 'review', title: 'Review', cards: [] },
    { id: 'done', title: 'Done', cards: [] },
  ],
});

async function withTempPath(prefix, filename, run) {
  await mkdir(TMP_ROOT, { recursive: true });
  let dir = await mkdtemp(join(TMP_ROOT, `${prefix}-`));
  try {
    return await run(join(dir, filename));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('TOOLS registry', () => {
  it('contains all tools', () => {
    assert.equal(TOOLS.length, EXPECTED_TOOL_COUNT);
  });

  it('keeps public tool-count docs aligned with the runtime registry', () => {
    for (let file of ['README.md', 'AGENTS.md', 'CHANGELOG.md']) {
      let text = readFileSync(resolve(ROOT, file), 'utf8');
      assert.match(text, new RegExp(`\\b${EXPECTED_TOOL_COUNT} tools\\b`), `${file} must mention ${EXPECTED_TOOL_COUNT} tools`);
    }
  });

  it('all tools have name and inputSchema', () => {
    for (let tool of TOOLS) {
      assert.ok(tool.name, `Tool missing name`);
      assert.ok(tool.inputSchema, `Tool ${tool.name} missing inputSchema`);
      assert.ok(tool.description, `Tool ${tool.name} missing description`);
    }
  });

  it('tool names are unique', () => {
    let names = TOOLS.map((t) => t.name);
    let unique = new Set(names);
    assert.equal(names.length, unique.size, 'Duplicate tool names');
  });

  it('exposes preview import-map controls through the tool schema', () => {
    let preview = TOOLS.find((tool) => tool.name === 'start_preview');

    assert.equal(preview.inputSchema.properties.imports.type, 'object');
    assert.equal(preview.inputSchema.properties.serveRoot.type, 'string');
  });
});

describe('isMutating', () => {
  it('identifies mutating tools', () => {
    assert.equal(isMutating('add_group'), true);
    assert.equal(isMutating('scaffold_workspace'), true);
    assert.equal(isMutating('mount_widget'), true);
    assert.equal(isMutating('save_config'), true);
    assert.equal(isMutating('workflow_kanban'), true);
  });

  it('identifies read-only tools', () => {
    assert.equal(isMutating('list_groups'), false);
    assert.equal(isMutating('describe_workspace'), false);
    assert.equal(isMutating('list_templates'), false);
    assert.equal(isMutating('start_preview'), false);
  });
});

describe('createSession', () => {
  it('creates empty session', () => {
    let session = createSession();
    assert.equal(session.config, null);
    assert.equal(session.configFilePath, null);
  });

  it('ensure creates blank config', () => {
    let session = createSession();
    let config = session.ensure();
    assert.equal(config.version, '0.2.0');
    assert.equal(config.name, 'New Workspace');
    assert.ok(Array.isArray(config.groups));
  });

  it('accepts initial config', () => {
    let session = createSession({ config: { version: '0.2.0', name: 'Pre' } });
    assert.equal(session.config.name, 'Pre');
  });
});

describe('dispatch', () => {
  it('scaffold_from_scratch creates workspace', async () => {
    let session = createSession();
    let result = await dispatch('scaffold_from_scratch', { name: 'Test WS' }, session);
    assert.equal(result.status, 'ok');
    assert.equal(session.config.name, 'Test WS');
  });

  it('scaffold_workspace from template', async () => {
    let session = createSession();
    let result = await dispatch('scaffold_workspace', { template: 'chat', name: 'Chat' }, session);
    assert.equal(result.status, 'ok');
    assert.equal(session.config.name, 'Chat');
    assert.ok(Object.keys(session.config.panelTypes).length > 0);
  });

  it('list_templates returns templates', async () => {
    let session = createSession();
    let result = await dispatch('list_templates', {}, session);
    assert.ok(result.count >= 5);
  });

  it('CRUD groups', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'G Test' }, session);

    let r1 = await dispatch('add_group', { id: 'g1', name: 'Group 1' }, session);
    assert.equal(r1.status, 'ok');

    let r2 = await dispatch('list_groups', {}, session);
    assert.equal(r2.count, 1);

    let r3 = await dispatch('update_group', { groupId: 'g1', updates: { name: 'Updated' } }, session);
    assert.equal(r3.status, 'ok');

    let r4 = await dispatch('remove_group', { groupId: 'g1' }, session);
    assert.equal(r4.status, 'ok');

    let r5 = await dispatch('list_groups', {}, session);
    assert.equal(r5.count, 0);
  });

  it('CRUD sections', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'S Test' }, session);
    await dispatch('add_group', { id: 'g1', name: 'G1' }, session);

    let r1 = await dispatch('add_section', { groupId: 'g1', id: 's1', label: 'Sec 1' }, session);
    assert.equal(r1.status, 'ok');

    let r2 = await dispatch('list_sections', { groupId: 'g1' }, session);
    assert.equal(r2.count, 1);

    let r3 = await dispatch('update_section', { sectionId: 's1', updates: { label: 'Updated' } }, session);
    assert.equal(r3.status, 'ok');

    let r4 = await dispatch('remove_section', { sectionId: 's1' }, session);
    assert.equal(r4.status, 'ok');
  });

  it('CRUD panel types', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', {}, session);

    let r1 = await dispatch('register_panel_type', { name: 'vp', title: 'VP', component: 'sn-vp' }, session);
    assert.equal(r1.status, 'ok');

    let r2 = await dispatch('list_panel_types', {}, session);
    assert.equal(r2.count, 1);

    let r3 = await dispatch('update_panel_type', { name: 'vp', updates: { title: 'Viewport' } }, session);
    assert.equal(r3.status, 'ok');

    let r4 = await dispatch('unregister_panel_type', { name: 'vp' }, session);
    assert.equal(r4.status, 'ok');
  });

  it('CRUD menu actions', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', {}, session);
    await dispatch('register_panel_type', { name: 'vp', title: 'VP', component: 'c' }, session);

    let r1 = await dispatch('add_menu_action', {
      panelType: 'vp',
      id: 'a1',
      label: 'Act 1',
      command: 'viewport.action',
      event: 'viewport-action',
    }, session);
    assert.equal(r1.status, 'ok');

    let r2 = await dispatch('list_menu_actions', { panelType: 'vp' }, session);
    assert.equal(r2.count, 1);
    assert.equal(r2.actions[0].command, 'viewport.action');
    assert.equal(r2.actions[0].event, 'viewport-action');

    let r3 = await dispatch('toggle_menu_action', { panelType: 'vp', actionId: 'a1', active: true }, session);
    assert.equal(r3.status, 'ok');

    let r4 = await dispatch('remove_menu_action', { panelType: 'vp', actionId: 'a1' }, session);
    assert.equal(r4.status, 'ok');
  });

  it('behaviors (set/get/update)', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', {}, session);

    let r1 = await dispatch('set_behavior', { target: 'root', behavior: { responsiveMode: 'drawer' } }, session);
    assert.equal(r1.status, 'ok');

    let r2 = await dispatch('get_behavior', { target: 'root' }, session);
    assert.equal(r2.behavior.responsiveMode, 'drawer');

    let r3 = await dispatch('update_behavior', { target: 'root', updates: { responsiveBreakpoint: 720 } }, session);
    assert.equal(r3.status, 'ok');
  });

  it('widgets (mount/swap/unmount)', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', {}, session);

    let r1 = await dispatch('mount_widget', { panelType: 'main', componentTag: 'sn-chart' }, session);
    assert.equal(r1.status, 'ok');

    let r2 = await dispatch('swap_widget', { panelType: 'main', newComponentTag: 'sn-table' }, session);
    assert.equal(r2.status, 'ok');

    let r3 = await dispatch('unmount_widget', { panelType: 'main' }, session);
    assert.equal(r3.status, 'ok');
  });

  it('events (bridge/list/unbridge)', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', {}, session);

    let r1 = await dispatch('bridge_event', { sourcePanel: 'tl', event: 'frame', targetPanel: 'vp' }, session);
    assert.equal(r1.status, 'ok');

    let r2 = await dispatch('list_bridges', {}, session);
    assert.equal(r2.count, 1);

    let eventId = session.config.events[0].id;
    let r3 = await dispatch('unbridge_event', { eventId }, session);
    assert.equal(r3.status, 'ok');
  });

  it('layout operations', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', {}, session);

    let tree = {
      type: 'split', direction: 'horizontal', ratio: 0.5,
      first: { type: 'panel', panelType: 'a' },
      second: { type: 'panel', panelType: 'b' },
    };
    let r1 = await dispatch('set_layout', { layoutTree: tree }, session);
    assert.equal(r1.status, 'ok');

    let r2 = await dispatch('resize_panel', { firstPanelType: 'a', ratio: 0.3 }, session);
    assert.equal(r2.status, 'ok');

    let r3 = await dispatch('add_panel', { existingPanelType: 'b', newPanelType: 'c' }, session);
    assert.equal(r3.status, 'ok');

    let r4 = await dispatch('remove_panel', { panelType: 'c' }, session);
    assert.equal(r4.status, 'ok');

    let r5 = await dispatch('update_layout_behavior', { behavior: { responsiveMode: 'stack' } }, session);
    assert.equal(r5.status, 'ok');
  });

  it('validate_config', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'editor' }, session);
    let result = await dispatch('validate_config', {}, session);
    assert.equal(result.valid, true);
  });

  it('describe_workspace', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'video-studio' }, session);
    let result = await dispatch('describe_workspace', {}, session);
    assert.ok(result.panelTypes);
  });

  it('list_used_components', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat' }, session);
    let result = await dispatch('list_used_components', {}, session);
    assert.ok(result);
  });

  it('unknown tool returns error', async () => {
    let session = createSession();
    let result = await dispatch('nonexistent_tool', {}, session);
    assert.equal(result.status, 'error');
    assert.equal(session.config, null);
  });

  it('reorder_groups', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', {}, session);
    await dispatch('add_group', { id: 'a', name: 'A' }, session);
    await dispatch('add_group', { id: 'b', name: 'B' }, session);
    await dispatch('add_group', { id: 'c', name: 'C' }, session);

    let r = await dispatch('reorder_groups', { orderedIds: ['c', 'a', 'b'] }, session);
    assert.equal(r.status, 'ok');
    assert.deepEqual(session.config.groups.map(g => g.id), ['c', 'a', 'b']);
  });

  it('reorder_sections', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', {}, session);
    await dispatch('add_group', { id: 'g1', name: 'G' }, session);
    await dispatch('add_section', { groupId: 'g1', id: 's1', label: 'S1' }, session);
    await dispatch('add_section', { groupId: 'g1', id: 's2', label: 'S2' }, session);

    let r = await dispatch('reorder_sections', { groupId: 'g1', orderedIds: ['s2', 's1'] }, session);
    assert.equal(r.status, 'ok');
  });

  it('save_config and load_config', async () => {
    await withTempPath('dispatch-io', 'workspace.json', async (tmpFile) => {
      let session1 = createSession();
      await dispatch('scaffold_from_scratch', { name: 'IO Test' }, session1);
      let r1 = await dispatch('save_config', { filePath: tmpFile }, session1);
      assert.equal(r1.status, 'ok');

      let session2 = createSession();
      let r2 = await dispatch('load_config', { filePath: tmpFile }, session2);
      assert.equal(r2.status, 'ok');
      assert.equal(session2.config.name, 'IO Test');
    });
  });

  it('load_config rejects non-portable relaunch files', async () => {
    await withTempPath('dispatch-host-only', 'host-only.json', async (tmpFile) => {
      let session = createSession();
      await writeFile(tmpFile, JSON.stringify({
        version: '0.2.0',
        name: 'Host Bound',
        host: { sessionId: 'abc123' },
        layout: { type: 'panel', panelType: 'main' },
      }, null, 2));

      let result = await dispatch('load_config', { filePath: tmpFile }, session);

      assert.equal(result.status, 'error');
      assert.equal(session.config, null);
      assert.ok(result.errors.some((error) => error.path === 'host'));
    });
  });

  it('load_config returns structured errors for missing files without initializing session', async () => {
    await withTempPath('dispatch-missing-load', 'workspace.json', async (tmpFile) => {
      let session = createSession();

      let result = await dispatch('load_config', { filePath: tmpFile }, session);

      assert.equal(result.status, 'error');
      assert.equal(result.tool, 'load_config');
      assert.equal(result.code, 'workspace_config_read_failed');
      assert.match(result.hint, /Load failed: cannot read/);
      assert.equal(session.config, null);
    });
  });

  it('multiple bridge events get unique IDs', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', {}, session);

    await dispatch('bridge_event', { sourcePanel: 'a', event: 'e1', targetPanel: 'b' }, session);
    await dispatch('bridge_event', { sourcePanel: 'c', event: 'e2', targetPanel: 'd' }, session);

    let ids = session.config.events.map(e => e.id);
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
  });

  it('workflow_kanban registers a portable kanban board module', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Workflow Desk' }, session);

    let result = await dispatch('workflow_kanban', {
      panelType: 'approvals',
      title: 'Approvals',
      icon: 'fact_check',
      board: WORKFLOW_KANBAN_BOARD,
      layoutId: 'workflow',
      setDefaultLayout: true,
      group: { id: 'workflow', name: 'Workflow' },
      section: { id: 'board', label: 'Board', groupId: 'workflow' },
      eventTarget: { panelType: 'workflow', targetProperty: 'approvalState' },
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.component, 'sn-kanban-board');
    assert.equal(result.boardPath, 'state.approvals.board');
    assert.deepEqual(result.events, [
      'sn-board-card-select',
      'sn-board-card-action',
      'sn-board-card-drop',
    ]);
    assert.equal(session.config.panelTypes.approvals.component, 'sn-kanban-board');
    assert.equal(session.config.panelTypes.approvals.icon, 'fact_check');
    assert.equal(session.config.components.modules[0].placement.icon, 'fact_check');
    assert.deepEqual(session.config.layout, { type: 'panel', panelType: 'approvals' });
    assert.deepEqual(session.config.layouts.workflow, { type: 'panel', panelType: 'approvals' });
    assert.ok(session.config.components.catalog.includes('sn-kanban-board'));
    assert.equal(session.config.components.modules[0].capabilities.includes('workflow.kanban'), true);
    assert.deepEqual(session.config.state.fields.find((field) => field.id === 'board').default, WORKFLOW_KANBAN_BOARD);
    assert.equal(session.config.data.bindings.some((binding) => binding.id === 'move-intent'), true);
    assert.equal(
      session.config.events.find((event) => event.event === 'sn-board-card-drop').targetProperty,
      'approvalState',
    );

    let validation = await dispatch('validate_config', {}, session);
    assert.equal(validation.valid, true);
    let exported = await dispatch('export_config', { strict: true }, session);
    assert.equal(exported.status, 'ok');
  });

  it('workflow_kanban supports multiple boards without duplicate module descriptors', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Workflow Desk' }, session);

    let first = await dispatch('workflow_kanban', {
      panelType: 'release-board',
      board: WORKFLOW_KANBAN_BOARD,
      requiredHostServices: ['storage.project'],
    }, session);
    let second = await dispatch('workflow_kanban', {
      panelType: 'triage-board',
      board: {
        id: 'triage-flow',
        columns: [
          { id: 'new', title: 'New', cards: [{ id: 'bug-1', title: 'Inspect bug' }] },
        ],
      },
      requiredHostServices: ['agent.runtime'],
    }, session);

    assert.equal(first.status, 'ok');
    assert.equal(second.status, 'ok');
    assert.deepEqual(session.config.components.modules.map((module) => module.tagName), [
      'sn-kanban-board',
    ]);
    assert.deepEqual(session.config.components.modules[0].requiredHostServices, [
      'agent.runtime',
      'storage.project',
    ]);
    assert.equal(session.config.panelTypes['release-board'].component, 'sn-kanban-board');
    assert.equal(session.config.panelTypes['triage-board'].component, 'sn-kanban-board');
    assert.equal(
      session.config.state.fields.some((field) => field.path === 'state.release-board.board'),
      true,
    );
    assert.equal(
      session.config.state.fields.some((field) => field.path === 'state.triage-board.board'),
      true,
    );
    assert.equal(
      session.config.events.some((event) => event.id === 'workflow-kanban-triage-board-drop'),
      true,
    );

    let validation = await dispatch('validate_config', {}, session);
    assert.equal(validation.valid, true);
    let exported = await dispatch('export_config', { strict: true }, session);
    assert.equal(exported.status, 'ok');
  });

  it('workflow_kanban keeps canonical provider metadata over stale module descriptors', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Workflow Desk' }, session);
    session.config.components = {
      catalog: ['sn-kanban-board'],
      modules: [{
        tagName: 'sn-kanban-board',
        provider: 'legacy-provider',
        descriptor: { package: 'legacy-pack', component: 'sn-kanban-board' },
        capabilities: ['legacy.kanban'],
        placement: {
          title: 'Legacy Board',
          icon: 'history',
          behavior: { importance: 1 },
          regions: ['legacy'],
          panelType: 'legacy-panel',
          registers: ['legacy-register'],
        },
        requiredHostServices: ['storage.project'],
        actions: [{ id: 'refresh', label: 'Refresh', event: 'workflow.refresh' }],
      }],
    };

    let result = await dispatch('workflow_kanban', {
      panelType: 'approvals',
      icon: 'fact_check',
      behavior: { importance: 80, minInlineSize: 360 },
      board: WORKFLOW_KANBAN_BOARD,
      requiredHostServices: ['agent.runtime'],
    }, session);

    assert.equal(result.status, 'ok');
    let [module] = session.config.components.modules;
    assert.equal(module.provider, 'symbiote-ui');
    assert.equal(module.descriptor.package, 'symbiote-ui');
    assert.deepEqual(module.capabilities, ['workflow.kanban', 'kanban-board', 'workflow.move-intent']);
    assert.deepEqual(module.placement, {
      title: 'Workflow Kanban',
      icon: 'fact_check',
      behavior: { importance: 80, minInlineSize: 360 },
      regions: ['workflow', 'board'],
    });
    assert.deepEqual(module.requiredHostServices, ['agent.runtime', 'storage.project']);
    assert.deepEqual(module.actions, [{ id: 'refresh', label: 'Refresh', event: 'workflow.refresh' }]);

    let exported = await dispatch('export_config', { strict: true }, session);
    assert.equal(exported.status, 'ok');
  });

  it('workflow_kanban rejects invalid boards without mutating session', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Workflow Desk' }, session);
    let before = JSON.stringify(session.config);

    let result = await dispatch('workflow_kanban', {
      panelType: 'approvals',
      board: { id: 'Release Flow', columns: [] },
    }, session);

    assert.equal(result.status, 'error');
    assert.match(result.hint, /board\.id/);
    assert.equal(JSON.stringify(session.config), before);
  });

  it('workflow_kanban rejects non-string board titles without mutating session', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Workflow Desk' }, session);
    let before = JSON.stringify(session.config);

    let result = await dispatch('workflow_kanban', {
      panelType: 'approvals',
      board: {
        id: 'release-flow',
        title: { text: 'Release Flow' },
        columns: [{ id: 'todo', title: 'Todo', cards: [] }],
      },
    }, session);

    assert.equal(result.status, 'error');
    assert.match(result.hint, /board\.title/);
    assert.equal(JSON.stringify(session.config), before);
  });

  it('workflow_kanban rejects invalid event mapping without mutating session', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Workflow Desk' }, session);
    let before = JSON.stringify(session.config);

    let result = await dispatch('workflow_kanban', {
      panelType: 'approvals',
      board: WORKFLOW_KANBAN_BOARD,
      eventTarget: { panelType: 'workflow', mapping: [] },
    }, session);

    assert.equal(result.status, 'error');
    assert.match(result.hint, /eventTarget\.mapping/);
    assert.equal(JSON.stringify(session.config), before);
  });

  it('workflow_kanban rejects behavior outside layout contract without mutating session', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Workflow Desk' }, session);
    let before = JSON.stringify(session.config);

    let result = await dispatch('workflow_kanban', {
      panelType: 'approvals',
      board: WORKFLOW_KANBAN_BOARD,
      behavior: { importance: 200 },
    }, session);

    assert.equal(result.status, 'error');
    assert.match(result.hint, /behavior\.importance/);
    assert.equal(JSON.stringify(session.config), before);
  });

  it('workflow_kanban rejects non-portable host service IDs without mutating session', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Workflow Desk' }, session);
    let before = JSON.stringify(session.config);

    let result = await dispatch('workflow_kanban', {
      panelType: 'approvals',
      board: WORKFLOW_KANBAN_BOARD,
      requiredHostServices: ['storage.project', 'https://example.com/service'],
    }, session);

    assert.equal(result.status, 'error');
    assert.match(result.hint, /requiredHostServices/);
    assert.equal(JSON.stringify(session.config), before);
  });

  it('workflow_kanban requires an active workspace config', async () => {
    let session = createSession();

    let result = await dispatch('workflow_kanban', {
      panelType: 'approvals',
      board: WORKFLOW_KANBAN_BOARD,
    }, session);

    assert.equal(result.status, 'error');
    assert.equal(result.code, 'workspace_config_missing');
    assert.equal(session.config, null);
  });

  it('error handling: catches handler errors gracefully', async () => {
    let session = createSession();
    // discover_components with invalid path should return error (not throw)
    let result = await dispatch('discover_components', { uiPath: '/nonexistent/path' }, session);
    // Should still return without crashing
    assert.ok(result);
  });

  it('find_component returns not_found for unknown tag', async () => {
    let session = createSession();
    let result = await dispatch('find_component', {
      uiPath: import.meta.dirname + '/..', tagName: 'nonexistent-tag-xyz',
    }, session);
    assert.equal(result.status, 'not_found');
  });

  it('list_categories returns wrapped result', async () => {
    let session = createSession();
    let result = await dispatch('list_categories', {
      uiPath: import.meta.dirname + '/..',
    }, session);
    assert.ok(result.categories);
    assert.ok(typeof result.count === 'number');
  });

  it('input validation: rejects missing required args', async () => {
    let session = createSession();
    let result = await dispatch('add_group', {}, session);
    assert.equal(result.status, 'error');
    assert.ok(result.hint.includes('id'));
    assert.ok(result.hint.includes('name'));
  });

  it('input validation: rejects partially missing args', async () => {
    let session = createSession();
    let result = await dispatch('add_group', { id: 'g1' }, session);
    assert.equal(result.status, 'error');
    assert.ok(result.hint.includes('name'));
    assert.ok(!result.hint.includes('id'));
  });

  it('input validation: passes when no required fields', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', {}, session);
    let result = await dispatch('list_groups', {}, session);
    assert.notEqual(result.status, 'error');
  });

  it('read-only current-workspace tools do not initialize a fresh session config', async () => {
    let tools = [
      ['describe_workspace', {}],
      ['list_used_components', {}],
      ['propose_workspace_patch', { overlay: { name: 'Preview' } }],
      ['validate_workspace_patch', { overlay: { name: 'Preview' } }],
      ['export_workspace', {}],
      ['list_groups', {}],
      ['list_sections', {}],
      ['list_panel_types', {}],
      ['list_menu_actions', { panelType: 'main' }],
      ['get_behavior', { target: 'root' }],
      ['list_bridges', {}],
      ['validate_config', {}],
      ['export_workspace_package', {}],
      ['export_config', {}],
      ['diff_configs', { otherJson: '{}' }],
      ['check_guardrails', {}],
    ];

    for (let [toolName, args] of tools) {
      assert.equal(isMutating(toolName), false, `${toolName} must stay read-only`);
      let session = createSession();

      let result = await dispatch(toolName, args, session);

      assert.equal(result.status, 'error', `${toolName} must reject a missing config`);
      assert.equal(result.code, 'workspace_config_missing', `${toolName} must report missing config`);
      assert.equal(session.config, null, `${toolName} must not create a blank config`);
    }
  });

  it('read-only tools without current-workspace dependency do not initialize a fresh session config', async () => {
    let session = createSession();

    let result = await dispatch('list_templates', {}, session);

    assert.ok(result.count >= 5);
    assert.equal(session.config, null);
  });

  it('export_config returns portable JSON', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat' }, session);
    let result = await dispatch('export_config', {}, session);
    assert.equal(result.status, 'ok');
    assert.ok(result.json.length > 0);
    let parsed = JSON.parse(result.json);
    assert.ok(parsed.name);
  });

  it('import_config loads workspace from JSON', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'editor', name: 'Imp Test' }, session);
    let exported = await dispatch('export_config', {}, session);

    let session2 = createSession();
    let result = await dispatch('import_config', { json: exported.json }, session2);
    assert.equal(result.status, 'ok');
    assert.equal(session2.config.name, 'Imp Test');
  });

  it('diff_configs detects changes', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Base' }, session);
    let other = { ...session.config, name: 'Changed' };
    let result = await dispatch('diff_configs', { otherJson: JSON.stringify(other) }, session);
    assert.ok(result.count >= 1);
    assert.ok(result.changes.some(c => c.path === 'name'));
  });

  it('merge_configs applies overlay', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Original' }, session);
    let result = await dispatch('merge_configs', { overlay: { name: 'Overridden' } }, session);
    assert.equal(result.status, 'ok');
    assert.equal(session.config.name, 'Overridden');
  });

  it('check_guardrails passes for valid config', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'dashboard' }, session);
    let result = await dispatch('check_guardrails', {}, session);
    assert.equal(result.pass, true);
  });
});
