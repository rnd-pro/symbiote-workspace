import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlink } from 'node:fs/promises';

import { dispatch, TOOLS, isMutating, createSession } from '../runtime/index.js';

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

async function execCli(...args) {
  return exec('node', [CLI, ...args]);
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
