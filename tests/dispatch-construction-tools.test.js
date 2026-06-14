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
import { WORKSPACE_PACKAGE_KIND, WORKSPACE_PACKAGE_SCHEMA_VERSION as PACKAGE_SCHEMA_VERSION } from '../sharing/index.js';

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

    let exported = await dispatch('export_workspace', { strict: true }, session);
    let exportedConfig = JSON.parse(exported.json);
    assert.equal(exported.status, 'ok');
    assert.equal(exportedConfig.intent.template, 'team-ai-room');
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

describe('workspace package dispatch', () => {
  it('export_workspace_package produces a valid package with kind and schema fields', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'Package Test' }, session);

    let result = await dispatch('export_workspace_package', {
      manifest: { id: 'com.example.package-test' },
    }, session);

    assert.equal(result.status, 'ok');
    assert.ok(result.json);
    assert.ok(result.package);
    assert.equal(result.package.kind, WORKSPACE_PACKAGE_KIND);
    assert.equal(result.package.schemaVersion, PACKAGE_SCHEMA_VERSION);
    assert.ok(result.package.manifest);
    assert.equal(result.package.manifest.id, 'com.example.package-test');
    assert.equal(result.package.manifest.name, 'Package Test');
    assert.ok(result.package.workspace);
    assert.ok(result.package.host);
    assert.ok(result.package.host.contract);
    assert.equal(result.package.host.contract.schemaVersion, '0.1.0');
  });

  it('export_workspace_package carries manifest fields through to the package', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'Manifest Test' }, session);

    let result = await dispatch('export_workspace_package', {
      manifest: {
        id: 'com.example.manifest',
        description: 'A test workspace package for dispatch.',
        tags: ['chat', 'dispatch'],
        permissions: ['storage.project'],
      },
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.package.manifest.description, 'A test workspace package for dispatch.');
    assert.deepEqual(result.package.manifest.tags, ['chat', 'dispatch']);
    assert.deepEqual(result.package.manifest.permissions, ['storage.project']);
  });

  it('import_workspace_package restores session config from a full package', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'Export Source' }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: { id: 'com.example.import-test' },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let freshSession = createSession();
    let importResult = await dispatch('import_workspace_package', {
      json: exportResult.json,
    }, freshSession);

    assert.equal(importResult.status, 'ok');
    assert.equal(importResult.config.name, 'Export Source');
    assert.ok(importResult.package);
    assert.equal(freshSession.config.name, 'Export Source');
    assert.equal(freshSession.config.version, '0.2.0');
  });

  it('import_workspace_package rejects invalid JSON', async () => {
    let session = createSession();
    let result = await dispatch('import_workspace_package', {
      json: '{invalid',
    }, session);

    assert.equal(result.status, 'error');
    assert.ok(result.hint.includes('invalid package'));
    assert.equal(session.config.name, 'New Workspace');
  });

  it('import_workspace_package rejects a well-formed JSON that is not a valid package', async () => {
    let session = createSession();
    let result = await dispatch('import_workspace_package', {
      json: JSON.stringify({ kind: 'not-a-package', version: '1.0' }),
    }, session);

    assert.equal(result.status, 'error');
    assert.ok(result.errors.length > 0);
    assert.equal(session.config.name, 'New Workspace');
  });

  it('validate_workspace_package accepts a valid package', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'Validate Test' }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: { id: 'com.example.validate-ok' },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let packageObj = JSON.parse(exportResult.json);
    let validateResult = await dispatch('validate_workspace_package', {
      package: packageObj,
    }, session);

    assert.equal(validateResult.valid, true);
    assert.equal(validateResult.errors.length, 0);
  });

  it('validate_workspace_package rejects a package with invalid kind', async () => {
    let session = createSession();
    let result = await dispatch('validate_workspace_package', {
      package: { kind: 'other-kind', schemaVersion: PACKAGE_SCHEMA_VERSION },
    }, session);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'kind'));
  });

  it('validate_workspace_package rejects a package with non-matching host contract', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'Contract Test' }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: { id: 'com.example.contract-fail' },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let packageObj = JSON.parse(exportResult.json);
    packageObj.host.contract = { status: 'garbage' };

    let validateResult = await dispatch('validate_workspace_package', {
      package: packageObj,
    }, session);

    assert.equal(validateResult.valid, false);
    assert.ok(validateResult.errors.some((e) => e.path === 'host.contract'));
  });

  it('validates required workspace package arguments', async () => {
    let session = createSession();

    let importResult = await dispatch('import_workspace_package', {}, session);
    assert.equal(importResult.status, 'error');
    assert.ok(importResult.hint.includes('json'));

    let validateResult = await dispatch('validate_workspace_package', {}, session);
    assert.equal(validateResult.status, 'error');
    assert.ok(validateResult.hint.includes('package'));
  });

  it('marks workspace package mutating tools correctly', () => {
    assert.equal(isMutating('export_workspace_package'), false);
    assert.equal(isMutating('import_workspace_package'), true);
    assert.equal(isMutating('validate_workspace_package'), false);
    assert.equal(isMutating('inspect_workspace_package'), false);
  });
});

describe('workspace package CLI commands', () => {
  it('lists workspace package commands in help output', async () => {
    let { stdout } = await execCli('--help');

    assert.ok(stdout.includes('export-workspace-package'));
    assert.ok(stdout.includes('import-workspace-package'));
    assert.ok(stdout.includes('validate-workspace-package'));
    assert.ok(stdout.includes('--manifest'));
  });

  it('export-workspace-package produces portable JSON with manifest', async () => {
    let tmpFile = resolve(__dirname, '../_test_pkg_export.json');

    try {
      await execCli('scaffold', '--config', tmpFile, '--name', 'CLI Pkg Export', 'chat workspace');

      let { stdout } = await execCli(
        'export-workspace-package',
        '--config',
        tmpFile,
        '--manifest',
        JSON.stringify({ id: 'com.example.cli-export' }),
      );
      let result = JSON.parse(stdout);

      assert.equal(result.status, 'ok');
      let pkg = JSON.parse(result.json);
      assert.equal(pkg.kind, WORKSPACE_PACKAGE_KIND);
      assert.equal(pkg.manifest.id, 'com.example.cli-export');
      assert.equal(pkg.manifest.name, 'CLI Pkg Export');
      assert.ok(pkg.host.contract);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  it('import-workspace-package restores session from a package', async () => {
    let exportFile = resolve(__dirname, '../_test_pkg_export_source.json');
    let importFile = resolve(__dirname, '../_test_pkg_import_target.json');

    try {
      await execCli('scaffold', '--config', exportFile, '--name', 'CLI Import Source', 'chat workspace');
      let exportOut = await execCli(
        'export-workspace-package',
        '--config',
        exportFile,
        '--manifest',
        JSON.stringify({ id: 'com.example.cli-import' }),
      );
      let exportResult = JSON.parse(exportOut.stdout);
      assert.equal(exportResult.status, 'ok');

      let { stdout } = await execCli(
        'import-workspace-package',
        '--config',
        importFile,
        '--json',
        exportResult.json,
      );
      let importResult = JSON.parse(stdout);
      assert.equal(importResult.status, 'ok');
      assert.equal(importResult.config.name, 'CLI Import Source');
    } finally {
      await unlink(exportFile).catch(() => {});
      await unlink(importFile).catch(() => {});
    }
  });

  it('round-trip export-workspace-package -> import-workspace-package preserves config', async () => {
    let fileA = resolve(__dirname, '../_test_pkg_roundtrip_a.json');
    let fileB = resolve(__dirname, '../_test_pkg_roundtrip_b.json');

    try {
      await execCli('scaffold', '--config', fileA, '--name', 'Roundtrip', 'chat workspace');

      let exportOut = await execCli(
        'export-workspace-package',
        '--config',
        fileA,
        '--manifest',
        JSON.stringify({ id: 'com.example.roundtrip', tags: ['roundtrip'] }),
      );
      let exportResult = JSON.parse(exportOut.stdout);
      assert.equal(exportResult.status, 'ok');

      let importOut = await execCli('import-workspace-package', '--config', fileB, '--json', exportResult.json);
      let importResult = JSON.parse(importOut.stdout);
      assert.equal(importResult.status, 'ok');

      let reExport = await execCli(
        'export-workspace-package',
        '--config',
        fileB,
        '--manifest',
        JSON.stringify({ id: 'com.example.roundtrip' }),
      );
      let reExportResult = JSON.parse(reExport.stdout);
      assert.equal(reExportResult.status, 'ok');

      let originalPkg = JSON.parse(exportResult.json);
      let roundtripPkg = JSON.parse(reExportResult.json);
      assert.equal(roundtripPkg.manifest.id, 'com.example.roundtrip');
      assert.equal(roundtripPkg.workspace.config.name, 'Roundtrip');
      assert.deepEqual(roundtripPkg.workspace.config, originalPkg.workspace.config);
      assert.equal(roundtripPkg.host.contract.schemaVersion, '0.1.0');
    } finally {
      await unlink(fileA).catch(() => {});
      await unlink(fileB).catch(() => {});
    }
  });

  it('inspect-workspace-package is listed in help', async () => {
    let { stdout } = await execCli('--help');
    assert.ok(stdout.includes('inspect-workspace-package'));
    assert.ok(stdout.includes('--available'));
  });

  it('inspect-workspace-package accepts --package, --json, and --available args', async () => {
    let tmpFile = resolve(__dirname, '../_test_pkg_inspect_cli.json');

    try {
      await execCli('scaffold', '--config', tmpFile, '--name', 'CLI Inspect', 'chat workspace');
      let exportOut = await execCli(
        'export-workspace-package',
        '--config',
        tmpFile,
        '--manifest',
        JSON.stringify({
          id: 'com.example.cli-inspect',
          dependencies: {
            components: ['cli-missing-component'],
            plugins: ['cli-missing-plugin'],
          },
        }),
      );
      let exportResult = JSON.parse(exportOut.stdout);
      assert.equal(exportResult.status, 'ok');
      let packageObject = JSON.parse(exportResult.json);

      let packageInspect = await execCli(
        'inspect-workspace-package',
        '--package',
        JSON.stringify(packageObject),
      );
      let packageResult = JSON.parse(packageInspect.stdout);
      assert.equal(packageResult.status, 'ok');
      assert.equal(packageResult.valid, true);
      assert.equal(packageResult.ready, true);
      assert.equal(packageResult.summary.id, 'com.example.cli-inspect');

      let jsonInspect = await execCli('inspect-workspace-package', '--json', exportResult.json);
      let jsonResult = JSON.parse(jsonInspect.stdout);
      assert.equal(jsonResult.status, 'ok');
      assert.equal(jsonResult.valid, true);
      assert.equal(jsonResult.ready, true);

      let availableInspect = await execCli(
        'inspect-workspace-package',
        '--json',
        exportResult.json,
        '--available',
        JSON.stringify({
          components: [],
          plugins: [],
          packages: [],
          hostServices: [],
          runtimeSlots: [],
        }),
      );
      let availableResult = JSON.parse(availableInspect.stdout);
      assert.equal(availableResult.status, 'ok');
      assert.equal(availableResult.valid, true);
      assert.equal(availableResult.ready, false);
      assert.ok(availableResult.missing.components.includes('cli-missing-component'));
      assert.ok(availableResult.missing.plugins.includes('cli-missing-plugin'));
      assert.ok(availableResult.warnings.length > 0);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  it('create-workspace-package-construction-context accepts --package, --json, and --available args', async () => {
    let tmpFile = resolve(__dirname, '../_test_pkg_construction_context_cli.json');

    try {
      await execCli('scaffold', '--config', tmpFile, '--name', 'CLI Construction Context', 'chat workspace');
      let exportOut = await execCli(
        'export-workspace-package',
        '--config',
        tmpFile,
        '--manifest',
        JSON.stringify({
          id: 'com.example.cli-construction-context',
          dependencies: {
            components: ['cli-construction-component'],
            plugins: ['cli-construction-plugin'],
          },
        }),
      );
      let exportResult = JSON.parse(exportOut.stdout);
      assert.equal(exportResult.status, 'ok');
      let packageObject = JSON.parse(exportResult.json);

      let packageContext = await execCli(
        'create-workspace-package-construction-context',
        '--package',
        JSON.stringify(packageObject),
        '--template-name',
        'cli-review-package',
      );
      let packageResult = JSON.parse(packageContext.stdout);
      assert.equal(packageResult.status, 'ok');
      assert.equal(packageResult.valid, true);
      assert.equal(packageResult.ready, true);
      assert.equal(packageResult.workspaceTemplates[0].name, 'cli-review-package');
      assert.equal(packageResult.source.packageId, 'com.example.cli-construction-context');

      let jsonContext = await execCli(
        'create-workspace-package-construction-context',
        '--json',
        JSON.stringify(exportResult.json),
        '--available',
        JSON.stringify({
          components: [],
          plugins: [],
          packages: [],
          hostServices: [],
          runtimeSlots: [],
        }),
      );
      let jsonResult = JSON.parse(jsonContext.stdout);
      assert.equal(jsonResult.status, 'ok');
      assert.equal(jsonResult.valid, true);
      assert.equal(jsonResult.ready, false);
      assert.equal(jsonResult.workspaceTemplates[0].name, 'pkg-com.example.cli-construction-context');
      assert.ok(jsonResult.missing.components.includes('cli-construction-component'));
      assert.ok(jsonResult.missing.plugins.includes('cli-construction-plugin'));
      assert.ok(jsonResult.warnings.length > 0);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });
});

describe('inspect workspace package dispatch', () => {
  it('inspect_workspace_package accepts a valid package object and returns valid/ready/summary/missing', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'Inspect Test' }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: { id: 'com.example.inspect' },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let packageObj = JSON.parse(exportResult.json);
    let result = await dispatch('inspect_workspace_package', {
      package: packageObj,
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.valid, true);
    assert.equal(result.ready, true);
    assert.ok(result.summary);
    assert.equal(result.summary.id, 'com.example.inspect');
    assert.equal(result.summary.name, 'Inspect Test');
    assert.ok(result.compatibility);
    assert.equal(result.compatibility.compatible, true);
    assert.ok(result.requirements);
    assert.ok(result.missing);
    assert.equal(result.errors.length, 0);
  });

  it('inspect_workspace_package accepts a JSON string', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'JSON Inspect' }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: { id: 'com.example.json-inspect' },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let result = await dispatch('inspect_workspace_package', {
      json: exportResult.json,
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.valid, true);
    assert.equal(result.summary.id, 'com.example.json-inspect');
  });

  it('inspect_workspace_package with available reports missing capabilities', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'Available Gap' }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: {
        id: 'com.example.gap-test',
        dependencies: { plugins: ['missing-plugin'], components: ['missing-component'] },
      },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let packageObj = JSON.parse(exportResult.json);
    let result = await dispatch('inspect_workspace_package', {
      package: packageObj,
      available: { plugins: ['present-plugin'], components: [] },
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.valid, true);
    assert.equal(result.ready, false);
    assert.ok(result.missing.plugins.includes('missing-plugin'));
    assert.ok(result.missing.components.includes('missing-component'));
    assert.ok(result.warnings.length > 0);
  });

  it('inspect_workspace_package with available reports ready when all deps present', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'All Present' }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: {
        id: 'com.example.all-present',
        dependencies: { plugins: ['ready-plugin'], components: ['ready-component'] },
      },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let packageObj = JSON.parse(exportResult.json);
    let result = await dispatch('inspect_workspace_package', {
      package: packageObj,
      available: {
        components: ['chat-composer', 'chat-transcript', 'ready-component', 'sn-tree-panel'],
        plugins: ['ready-plugin', 'symbiote-ui'],
        packages: [],
        hostServices: ['agent.runtime'],
        runtimeSlots: [],
      },
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.valid, true);
    assert.equal(result.ready, true);
    assert.equal(result.warnings.length, 0);
  });

  it('inspect_workspace_package preserves inspection errors in the payload', async () => {
    let session = createSession();
    let result = await dispatch('inspect_workspace_package', {
      package: { kind: 'not-a-workspace-package' },
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.valid, false);
    assert.equal(result.ready, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((e) => e.path === 'kind'));
  });

  it('inspect_workspace_package rejects missing input with validateArgs-style error', async () => {
    let session = createSession();
    let result = await dispatch('inspect_workspace_package', {}, session);

    assert.equal(result.status, 'error');
    assert.ok(result.hint.includes('package or json'));
  });

  it('isMutating for inspect_workspace_package is false', () => {
    assert.equal(isMutating('inspect_workspace_package'), false);
  });
});

describe('create_workspace_package_construction_context dispatch', () => {
  it('marked non-mutating in TOOLS registry', () => {
    assert.equal(isMutating('create_workspace_package_construction_context'), false);
    let tool = TOOLS.find((t) => t.name === 'create_workspace_package_construction_context');
    assert.ok(tool);
    assert.equal(tool.mutates, undefined);
  });

  it('accepts a package object and returns workspaceTemplates plus module/required capabilities', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'Construction Context Object' }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: { id: 'com.example.construction-obj' },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let packageObj = JSON.parse(exportResult.json);
    let result = await dispatch('create_workspace_package_construction_context', {
      package: packageObj,
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.valid, true);
    assert.equal(result.ready, true);
    assert.ok(result.workspaceTemplates.length > 0);
    assert.equal(result.workspaceTemplates[0].name, 'pkg-com.example.construction-obj');
    assert.ok(result.workspaceTemplates[0].config);
    assert.ok(result.source);
    assert.equal(result.source.type, 'workspace-package');
    assert.ok(result.summary);
    assert.equal(result.errors.length, 0);
  });

  it('accepts a JSON string input', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'Construction Context JSON' }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: { id: 'com.example.construction-json' },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let result = await dispatch('create_workspace_package_construction_context', {
      json: exportResult.json,
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.valid, true);
    assert.ok(result.workspaceTemplates.length > 0);
    assert.equal(result.source.packageId, 'com.example.construction-json');
  });

  it('reports availability gaps when available map is provided', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'Construction Gap' }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: {
        id: 'com.example.construction-gap',
        dependencies: { plugins: ['gap-plugin'], components: ['gap-component'] },
      },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let packageObj = JSON.parse(exportResult.json);
    let result = await dispatch('create_workspace_package_construction_context', {
      package: packageObj,
      available: { plugins: [], components: [] },
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.valid, true);
    assert.equal(result.ready, false);
    assert.ok(result.missing);
    assert.ok(result.missing.plugins.includes('gap-plugin'));
    assert.ok(result.missing.components.includes('gap-component'));
    assert.ok(result.warnings.length > 0);
  });

  it('uses explicit templateName when provided', async () => {
    let session = createSession();
    await dispatch('scaffold_workspace', { template: 'chat', name: 'TemplateName Test' }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: { id: 'com.example.template-name' },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let packageObj = JSON.parse(exportResult.json);
    let result = await dispatch('create_workspace_package_construction_context', {
      package: packageObj,
      templateName: 'custom-studio',
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.workspaceTemplates[0].name, 'custom-studio');
    assert.equal(result.source.templateName, 'custom-studio');
  });

  it('returns requiredCapabilities from package construction intent paths', async () => {
    let session = createSession();
    await dispatch('construct_workspace', {
      intent: 'sentiment review operations dashboard',
      template: 'dashboard',
      requiredCapabilities: ['analysis.sentiment', 'review.queue'],
      moduleCapabilities: [EXTERNAL_SENTIMENT_MODULE],
    }, session);

    let exportResult = await dispatch('export_workspace_package', {
      manifest: { id: 'com.example.required-caps' },
    }, session);
    assert.equal(exportResult.status, 'ok');

    let packageObj = JSON.parse(exportResult.json);
    packageObj.workspace.config.construction.intent = {
      brief: 'Review queue workspace',
      targetRegister: 'tool',
      requiredCapabilities: ['agent.runtime', 'analysis.sentiment'],
    };
    let result = await dispatch('create_workspace_package_construction_context', {
      package: packageObj,
    }, session);

    assert.equal(result.status, 'ok');
    assert.equal(result.valid, true);
    assert.deepEqual(result.requiredCapabilities, [
      'agent.runtime',
      'analysis.sentiment',
      'review.queue',
    ]);
  });

  it('rejects missing input with validateArgs-style error', async () => {
    let session = createSession();
    let result = await dispatch('create_workspace_package_construction_context', {}, session);

    assert.equal(result.status, 'error');
    assert.ok(result.hint.includes('package or json'));
  });
});
