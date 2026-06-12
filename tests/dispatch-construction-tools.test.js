import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlink } from 'node:fs/promises';

import { dispatch, TOOLS, isMutating, createSession } from '../runtime/index.js';
import { collectPluginModuleCapabilities } from '../plugins/index.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/index.js';

let exec = promisify(execFile);
let __dirname = dirname(fileURLToPath(import.meta.url));
let CLI = resolve(__dirname, '../cli.js');

let CONSTRUCTION_TOOLS = [
  'classify_workspace',
  'plan_workspace',
  'construct_workspace',
  'propose_workspace_patch',
  'validate_workspace_patch',
  'apply_workspace_patch',
  'export_workspace',
];

let EXTERNAL_SENTIMENT_MODULE = {
  tagName: 'acme-sentiment-panel',
  provider: '@acme/workspace-pack',
  capabilities: ['analysis.sentiment', 'review.queue'],
  actions: [{ id: 'refresh', label: 'Refresh', command: 'sentiment.refresh' }],
  bindings: [{ id: 'items', direction: 'input', path: 'data.sentiment' }],
  requiredHostServices: ['storage.project'],
  placement: {
    panelType: 'sentiment',
    title: 'Sentiment',
    icon: 'sentiment_satisfied',
    behavior: { importance: 72, minInlineSize: 260 },
  },
};

let TEAM_ROOM_TEMPLATE = {
  name: 'team-ai-room',
  description: 'AI team room workspace with shared transcript and command panels.',
  config: {
    version: WORKSPACE_SCHEMA_VERSION,
    name: 'Team AI Room',
    register: 'agent-workspace',
    groups: [{ id: 'room', name: 'Room', icon: 'groups' }],
    sections: [{ id: 'session', label: 'Session', icon: 'forum', order: 0, groupId: 'room' }],
    panelTypes: {
      transcript: { title: 'Transcript', icon: 'chat', component: 'team-room-transcript' },
      command: { title: 'Command', icon: 'terminal', component: 'team-room-command' },
    },
    layout: {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.62,
      first: { type: 'panel', panelType: 'transcript' },
      second: { type: 'panel', panelType: 'command' },
    },
    components: {
      catalog: ['team-room-transcript', 'team-room-command'],
      modules: [
        { tagName: 'team-room-transcript', capabilities: ['room.transcript', 'agent.messages'] },
        { tagName: 'team-room-command', capabilities: ['room.command', 'agent.command-input'] },
      ],
    },
  },
};

async function execCli(...args) {
  return exec('node', [CLI, ...args]);
}

function layoutReferencesPanel(node, panelType) {
  if (!node) return false;
  if (node.type === 'panel') return node.panelType === panelType;
  return layoutReferencesPanel(node.first, panelType) ||
    layoutReferencesPanel(node.second, panelType);
}

describe('construction workflow registry', () => {
  it('registers construction workflow tools', () => {
    let toolNames = new Set(TOOLS.map((tool) => tool.name));
    for (let toolName of CONSTRUCTION_TOOLS) {
      assert.equal(toolNames.has(toolName), true, `Missing tool ${toolName}`);
    }
  });

  it('marks mutating construction flow tools', () => {
    assert.equal(isMutating('classify_workspace'), false);
    assert.equal(isMutating('plan_workspace'), false);
    assert.equal(isMutating('construct_workspace'), true);
    assert.equal(isMutating('propose_workspace_patch'), false);
    assert.equal(isMutating('validate_workspace_patch'), false);
    assert.equal(isMutating('apply_workspace_patch'), true);
    assert.equal(isMutating('export_workspace'), false);
  });
});

describe('construction workflow dispatch', () => {
  it('classify_workspace returns the matched template without creating session state', async () => {
    let session = createSession();
    let result = await dispatch('classify_workspace', { intent: 'video editing studio' }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.templateName, 'video-studio');
    assert.equal(result.fallback, false);
    assert.equal(session.config, null);
  });

  it('classify_workspace can match external workspace templates', async () => {
    let session = createSession();
    let result = await dispatch('classify_workspace', {
      intent: 'team AI room',
      workspaceTemplates: [TEAM_ROOM_TEMPLATE],
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.templateName, 'team-ai-room');
    assert.equal(result.fallback, false);
    assert.equal(session.config, null);
  });

  it('list_templates can include external workspace templates', async () => {
    let session = createSession();
    let result = await dispatch('list_templates', {
      workspaceTemplates: [TEAM_ROOM_TEMPLATE],
    }, session);

    assert.equal(result.status, undefined);
    assert.ok(result.templates.includes('chat'));
    assert.ok(result.templates.includes('team-ai-room'));
  });

  it('plan_workspace returns a plan without mutating session config', async () => {
    let session = createSession();
    let result = await dispatch('plan_workspace', {
      intent: 'chat workspace',
      name: 'Planned Chat',
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.templateName, 'chat');
    assert.equal(result.plan.name, 'Planned Chat');
    assert.equal(session.config, null);
  });

  it('plan_workspace accepts live construction capability arguments without mutating', async () => {
    let session = createSession();
    let result = await dispatch('plan_workspace', {
      intent: 'social automation review desk',
      template: 'social-automation',
      requiredCapabilities: ['automation.reply-template', 'data.import'],
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.templateName, 'social-automation');
    assert.deepEqual(result.plan.answers.moduleSelection, ['imports', 'reply']);
    assert.deepEqual(result.plan.capabilities.missing, []);
    assert.equal(session.config, null);
  });

  it('construct_workspace plans and stores the executable config in session state', async () => {
    let session = createSession();
    let result = await dispatch('construct_workspace', {
      intent: 'social automation review desk',
      template: 'social-automation',
      name: 'Constructed Desk',
      requiredCapabilities: ['automation.reply-template', 'data.import'],
      answers: {
        'theme-mode': 'dark',
      },
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.templateName, 'social-automation');
    assert.equal(session.config.name, 'Constructed Desk');
    assert.equal(session.config.intent.template, 'social-automation');
    assert.deepEqual(result.plan.answers.moduleSelection, ['imports', 'reply']);
    assert.deepEqual(result.plan.capabilities.missing, []);
    assert.equal(session.config.construction.plan.theme.recipe.mode, 'dark');
  });

  it('construct_workspace merges object intent with top-level construction fields', async () => {
    let session = createSession();
    let result = await dispatch('construct_workspace', {
      intent: { brief: 'review desk from object intent' },
      template: 'social-automation',
      targetRegister: 'agent-workspace',
      requiredCapabilities: ['automation.reply-template'],
      preferredTheme: { mode: 'dark' },
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.intent.template, 'social-automation');
    assert.equal(result.intent.targetRegister, 'agent-workspace');
    assert.deepEqual(result.intent.requiredCapabilities, ['automation.reply-template']);
    assert.deepEqual(result.plan.answers.moduleSelection, ['reply']);
    assert.equal(result.plan.theme.recipe.mode, 'dark');
  });

  it('construct_workspace materializes external module descriptors through dispatch', async () => {
    let session = createSession();
    let result = await dispatch('construct_workspace', {
      intent: 'sentiment review operations dashboard',
      template: 'dashboard',
      requiredCapabilities: ['analysis.sentiment'],
      moduleCapabilities: [EXTERNAL_SENTIMENT_MODULE],
    }, session);

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.plan.answers.moduleSelection, ['sentiment']);
    assert.equal(session.config.panelTypes.sentiment.component, 'acme-sentiment-panel');
    assert.ok(session.config.components.catalog.includes('acme-sentiment-panel'));
    assert.ok(layoutReferencesPanel(session.config.layout, 'sentiment'));
    assert.deepEqual(result.plan.capabilities.missing, []);
  });

  it('construct_workspace accepts plugin-neutral external workspace templates through dispatch', async () => {
    let session = createSession();
    let result = await dispatch('construct_workspace', {
      intent: 'team AI room',
      template: 'team-ai-room',
      workspaceTemplates: [TEAM_ROOM_TEMPLATE],
      requiredCapabilities: ['room.command'],
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.templateName, 'team-ai-room');
    assert.equal(session.config.name, 'Team AI Room');
    assert.equal(session.config.intent.template, 'team-ai-room');
    assert.deepEqual(result.plan.answers.moduleSelection, ['command']);
    assert.deepEqual(result.plan.capabilities.missing, []);
  });

  it('construct_workspace accepts module capabilities collected from plugins', async () => {
    let pluginCapabilities = collectPluginModuleCapabilities([{
      name: '@acme/workspace-pack',
      version: '1.0.0',
      capabilities: ['provider.analytics'],
      components: [
        'acme-legacy-widget',
        EXTERNAL_SENTIMENT_MODULE,
      ],
    }]);
    assert.equal(pluginCapabilities.ok, true);

    let session = createSession();
    let result = await dispatch('construct_workspace', {
      intent: 'sentiment review operations dashboard',
      template: 'dashboard',
      requiredCapabilities: ['analysis.sentiment'],
      moduleCapabilities: pluginCapabilities.moduleCapabilities,
    }, session);

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.plan.answers.moduleSelection, ['sentiment']);
    assert.equal(session.config.panelTypes.sentiment.component, 'acme-sentiment-panel');
    assert.equal(
      result.plan.modules[0].capabilities.includes('provider.analytics'),
      false,
    );
    assert.deepEqual(result.plan.capabilities.missing, []);
  });

  it('construct_workspace reports invalid construction input without replacing session state', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Existing Config' }, session);

    let result = await dispatch('construct_workspace', {
      intent: 'broken construction input',
      moduleCapabilities: [{ capabilities: ['admin.records'] }],
    }, session);

    assert.equal(result.status, 'error');
    assert.equal(result.tool, 'construct_workspace');
    assert.match(result.hint, /tagName/);
    assert.equal(session.config.name, 'Existing Config');
  });

  it('propose_workspace_patch previews overlay changes without mutating session', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Base Name' }, session);

    let result = await dispatch('propose_workspace_patch', {
      overlay: { name: 'Preview Name' },
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.count, 1);
    assert.equal(result.preview.name, 'Preview Name');
    assert.equal(session.config.name, 'Base Name');
  });

  it('validate_workspace_patch reports invalid overlays and apply_workspace_patch does not mutate session', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Before Apply' }, session);

    let validation = await dispatch('validate_workspace_patch', {
      overlay: { register: 'broken-register' },
    }, session);

    assert.equal(validation.status, 'invalid');
    assert.equal(validation.valid, false);
    assert.ok(validation.configValidation.errors.some((error) => error.path === 'register'));

    let applyResult = await dispatch('apply_workspace_patch', {
      overlay: { register: 'broken-register' },
    }, session);

    assert.equal(applyResult.status, 'error');
    assert.equal(session.config.register, 'tool');
  });

  it('apply_workspace_patch merges a valid overlay into the active session', async () => {
    let session = createSession();
    await dispatch('scaffold_from_scratch', { name: 'Original Name' }, session);

    let result = await dispatch('apply_workspace_patch', {
      overlay: {
        name: 'Applied Name',
        theme: { params: { mode: 'dark', hue: 220 } },
      },
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.count >= 1, true);
    assert.equal(session.config.name, 'Applied Name');
    assert.equal(session.config.theme.params.hue, 220);
  });

  it('export_workspace mirrors export_config output', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'Export Test' }, session);

    let workflowExport = await dispatch('export_workspace', {}, session);
    let configExport = await dispatch('export_config', {}, session);

    assert.equal(workflowExport.status, 'ok');
    assert.equal(workflowExport.json, configExport.json);
  });

  it('validates required construction workflow arguments', async () => {
    let session = createSession();

    let classifyResult = await dispatch('classify_workspace', {}, session);
    assert.equal(classifyResult.status, 'error');
    assert.ok(classifyResult.hint.includes('intent'));

    let constructResult = await dispatch('construct_workspace', {}, session);
    assert.equal(constructResult.status, 'error');
    assert.ok(constructResult.hint.includes('intent'));

    let applyResult = await dispatch('apply_workspace_patch', {}, session);
    assert.equal(applyResult.status, 'error');
    assert.ok(applyResult.hint.includes('overlay'));
  });
});

describe('construction workflow CLI commands', () => {
  it('lists the construction commands in help output', async () => {
    let { stdout } = await execCli('--help');

    assert.ok(stdout.includes('classify-workspace'));
    assert.ok(stdout.includes('plan-workspace'));
    assert.ok(stdout.includes('construct-workspace'));
    assert.ok(stdout.includes('propose-workspace-patch'));
    assert.ok(stdout.includes('validate-workspace-patch'));
    assert.ok(stdout.includes('apply-workspace-patch'));
    assert.ok(stdout.includes('export-workspace'));
    assert.ok(stdout.includes('--module-capabilities'));
    assert.ok(stdout.includes('--workspace-templates'));
    assert.ok(stdout.includes('--required-capabilities'));
  });

  it('classify-workspace returns the detected template', async () => {
    let { stdout } = await execCli('classify-workspace', 'chat workspace');
    let result = JSON.parse(stdout);

    assert.equal(result.status, 'ok');
    assert.equal(result.templateName, 'chat');
  });

  it('plan-workspace returns a planned config without writing a file', async () => {
    let { stdout } = await execCli('plan-workspace', 'chat workspace', '--name', 'CLI Planned');
    let result = JSON.parse(stdout);

    assert.equal(result.status, 'ok');
    assert.equal(result.plan.name, 'CLI Planned');
  });

  it('plan-workspace carries external module descriptors through CLI JSON args', async () => {
    let { stdout } = await execCli(
      'plan-workspace',
      'sentiment review operations dashboard',
      '--template',
      'dashboard',
      '--required-capabilities',
      '["analysis.sentiment"]',
      '--module-capabilities',
      JSON.stringify([EXTERNAL_SENTIMENT_MODULE]),
    );
    let result = JSON.parse(stdout);

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.plan.answers.moduleSelection, ['sentiment']);
    assert.equal(result.config.panelTypes.sentiment.component, 'acme-sentiment-panel');
    assert.ok(result.config.components.catalog.includes('acme-sentiment-panel'));
    assert.ok(layoutReferencesPanel(result.config.layout, 'sentiment'));
  });

  it('plan-workspace carries external workspace templates through CLI JSON args', async () => {
    let { stdout } = await execCli(
      'plan-workspace',
      'team AI room',
      '--template',
      'team-ai-room',
      '--workspace-templates',
      JSON.stringify([TEAM_ROOM_TEMPLATE]),
      '--required-capabilities',
      '["room.command"]',
    );
    let result = JSON.parse(stdout);

    assert.equal(result.status, 'ok');
    assert.equal(result.templateName, 'team-ai-room');
    assert.equal(result.config.name, 'Team AI Room');
    assert.deepEqual(result.plan.answers.moduleSelection, ['command']);
  });

  it('construct-workspace writes a planned config through the shared session file flow', async () => {
    let tmpFile = resolve(__dirname, '../_test_construct_cli.json');

    try {
      let { stdout } = await execCli(
        'construct-workspace',
        '--config',
        tmpFile,
        'social automation reply queue',
        '--template',
        'social-automation',
        '--name',
        'CLI Constructed',
        '--required-capabilities',
        '["automation.reply-template","data.import"]',
      );
      let result = JSON.parse(stdout);
      assert.equal(result.status, 'ok');
      assert.deepEqual(result.plan.answers.moduleSelection, ['imports', 'reply']);

      let exportResult = await execCli('export-workspace', '--config', tmpFile);
      let parsedExport = JSON.parse(exportResult.stdout);
      let exportedConfig = JSON.parse(parsedExport.json);
      assert.equal(exportedConfig.name, 'CLI Constructed');
      assert.equal(exportedConfig.intent.template, 'social-automation');
      assert.deepEqual(exportedConfig.construction.plan.capabilities.missing, []);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  it('apply-workspace-patch uses the same session file flow as other mutating tools', async () => {
    let tmpFile = resolve(__dirname, '../_test_construction_cli.json');

    try {
      await execCli('scaffold-from-scratch', '--config', tmpFile, '--name', 'CLI Patch Base');

      let patchResult = await execCli(
        'apply-workspace-patch',
        '--config',
        tmpFile,
        '--overlay',
        '{"name":"CLI Patched"}',
      );
      let parsedPatch = JSON.parse(patchResult.stdout);
      assert.equal(parsedPatch.status, 'ok');

      let exportResult = await execCli('export-workspace', '--config', tmpFile);
      let parsedExport = JSON.parse(exportResult.stdout);
      let exportedConfig = JSON.parse(parsedExport.json);
      assert.equal(exportedConfig.name, 'CLI Patched');
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });
});
