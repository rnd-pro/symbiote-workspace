import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { dispatch, TOOLS, isMutating, createSession } from '../runtime/index.js';

let ROOT = resolve(import.meta.dirname, '..');
let TMP_ROOT = resolve(ROOT, 'tmp');
let EXPECTED_TOOL_COUNT = 66;

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

  it('multiple bridge events get unique IDs', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', {}, session);

    await dispatch('bridge_event', { sourcePanel: 'a', event: 'e1', targetPanel: 'b' }, session);
    await dispatch('bridge_event', { sourcePanel: 'c', event: 'e2', targetPanel: 'd' }, session);

    let ids = session.config.events.map(e => e.id);
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
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
    let result = await dispatch('list_groups', {}, session);
    assert.notEqual(result.status, 'error');
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
