import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { TOOLS } from '../runtime/index.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/index.js';

let __dirname = dirname(fileURLToPath(import.meta.url));
let CLI = resolve(__dirname, '../cli.js');
let ROOT = resolve(__dirname, '..');
let TMP_ROOT = resolve(ROOT, 'tmp');
let HELP_ALIASES = {
  describe_workspace: ['describe'],
  discover_components: ['discover'],
  scaffold_workspace: ['scaffold'],
  plan_workspace: ['plan'],
  validate_config: ['validate'],
  construct_workspace: ['construct'],
  start_preview: ['preview'],
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function helpHasCommand(stdout, command) {
  return new RegExp(`^\\s+${escapeRegExp(command)}(?:\\s|$)`, 'm').test(stdout)
    || new RegExp(`^\\s+${escapeRegExp(command)}\\s*->`, 'm').test(stdout);
}

async function exec(...args) {
  let { execFile } = await import('node:child_process');
  let { promisify } = await import('node:util');
  return promisify(execFile)('node', [CLI, ...args]);
}

async function withTempPath(prefix, filename, run) {
  await mkdir(TMP_ROOT, { recursive: true });
  let dir = await mkdtemp(join(TMP_ROOT, `${prefix}-`));
  try {
    return await run(join(dir, filename));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function constructionHandoffJson() {
  return JSON.stringify({
    _type: 'workspace-construction-handoff',
    valid: true,
    ready: true,
    intent: {
      brief: 'CLI handoff room',
      template: 'cli-handoff-room',
    },
    options: {
      packageContext: {
        valid: true,
        ready: true,
        source: { packageId: 'cli-handoff-package' },
        missing: {},
        readiness: {
          ready: true,
          status: 'ready',
          nextAction: 'construct',
          source: { packageId: 'cli-handoff-package' },
        },
        warnings: [],
        errors: [],
        recovery: [],
      },
      workspaceTemplates: [{
        name: 'cli-handoff-room',
        config: {
          version: WORKSPACE_SCHEMA_VERSION,
          name: 'CLI Handoff Room',
          register: 'agent-workspace',
          groups: [{ id: 'room', name: 'Room' }],
          sections: [{ id: 'main', label: 'Main', groupId: 'room' }],
          panelTypes: {
            command: {
              title: 'Command',
              component: 'cli-command-panel',
            },
          },
          layout: { type: 'panel', panelType: 'command' },
          components: {
            catalog: ['cli-command-panel'],
            modules: [{
              tagName: 'cli-command-panel',
              capabilities: ['room.command'],
            }],
          },
        },
      }],
      moduleCapabilities: [],
    },
  });
}

describe('CLI help', () => {
  it('prints usage on --help', async () => {
    let { stdout } = await exec('--help');
    assert.ok(stdout.includes('symbiote-workspace CLI'));
    assert.ok(stdout.includes('scaffold'));
    assert.ok(stdout.includes('mcp'));
    assert.ok(stdout.includes('--config'));
    assert.equal(stdout.includes('Force JSON output'), false);
    assert.ok(stdout.includes('--json <string>'));
  });

  it('lists every tool command or documented CLI alias in help', async () => {
    let { stdout } = await exec('--help');
    let toolNames = new Set(TOOLS.map((tool) => tool.name));

    for (let [toolName, aliases] of Object.entries(HELP_ALIASES)) {
      assert.equal(toolNames.has(toolName), true, `Alias references missing tool ${toolName}`);
      assert.equal(
        aliases.some((alias) => helpHasCommand(stdout, alias)),
        true,
        `Help missing alias for ${toolName}`,
      );
    }

    for (let tool of TOOLS) {
      let command = tool.name.replaceAll('_', '-');
      assert.equal(
        helpHasCommand(stdout, command),
        true,
        `Help missing command for ${tool.name}`,
      );
      assert.equal(
        stdout.includes(tool.description),
        true,
        `Help missing TOOLS description for ${tool.name}`,
      );
    }
  });
});

describe('CLI tool commands', () => {
  it('list-templates returns JSON', async () => {
    let { stdout } = await exec('list-templates');
    let result = JSON.parse(stdout);
    assert.ok(result.count >= 5);
    assert.ok(result.templates.includes('chat'));
  });

  it('scaffold creates workspace', async () => {
    let { stdout } = await exec('scaffold', 'chat', '--name', 'My Chat');
    let result = JSON.parse(stdout);
    assert.equal(result.status, 'ok');
    assert.equal(result.config.name, 'My Chat');
  });

  it('scaffold-from-scratch creates blank workspace', async () => {
    let { stdout } = await exec('scaffold-from-scratch', '--name', 'Blank');
    let result = JSON.parse(stdout);
    assert.equal(result.status, 'ok');
    assert.equal(result.config.name, 'Blank');
  });

  it('plan alias returns a construction plan without scaffolding the session', async () => {
    let { stdout } = await exec('plan', 'chat workspace');
    let result = JSON.parse(stdout);
    assert.equal(result.status, 'ok');
    assert.equal(result.intent.brief, 'chat workspace');
    assert.ok(Array.isArray(result.questions));
    assert.ok(Array.isArray(result.plan.modules));
    assert.ok(Array.isArray(result.plan.verification.targets));
    assert.deepEqual(result.verification, result.plan.verification);
  });

  it('plan alias accepts a full construction handoff JSON positional', async () => {
    let { stdout } = await exec('plan', constructionHandoffJson());
    let result = JSON.parse(stdout);

    assert.equal(result.status, 'ok');
    assert.equal(result.intent.brief, 'CLI handoff room');
    assert.equal(result.intent.template, 'cli-handoff-room');
    assert.equal(result.readiness.ready, true);
    assert.equal(result.readiness.source.packageId, 'cli-handoff-package');
    assert.deepEqual(result.verification, result.plan.verification);
    assert.equal(result.config.name, 'CLI Handoff Room');
  });

  it('construct alias accepts a full construction handoff JSON positional', async () => {
    await withTempPath('cli-handoff', 'workspace.json', async (tmpFile) => {
      let { stdout } = await exec('construct', constructionHandoffJson(), '--config', tmpFile);
      let result = JSON.parse(stdout);
      let saved = JSON.parse(await readFile(tmpFile, 'utf8'));

      assert.equal(result.status, 'ok');
      assert.equal(result.intent.brief, 'CLI handoff room');
      assert.equal(result.intent.template, 'cli-handoff-room');
      assert.equal(result.readiness.ready, true);
      assert.equal(result.readiness.source.packageId, 'cli-handoff-package');
      assert.deepEqual(result.verification, result.plan.verification);
      assert.equal(saved.intent.template, 'cli-handoff-room');
      assert.equal(saved.construction.packageContext.source.packageId, 'cli-handoff-package');
      assert.equal(saved.construction.packageContext.readiness.nextAction, 'construct');
      assert.equal(saved.name, 'CLI Handoff Room');
      assert.deepEqual(saved.validation.reports, result.verification.reports);
    });
  });
});

describe('CLI --config workflow', () => {
  it('scaffold + add-group + list-groups via --config', async () => {
    await withTempPath('cli-config', 'workspace.json', async (tmpFile) => {
      let r1 = await exec('scaffold', 'dashboard', '--config', tmpFile);
      let p1 = JSON.parse(r1.stdout);
      assert.equal(p1.status, 'ok');

      let r2 = await exec(
        'add-group',
        '--config',
        tmpFile,
        '--id',
        'test-g',
        '--name',
        'Test Group',
      );
      let p2 = JSON.parse(r2.stdout);
      assert.equal(p2.status, 'ok');

      let r3 = await exec('list-groups', '--config', tmpFile);
      let p3 = JSON.parse(r3.stdout);
      assert.ok(p3.count >= 2);

      let r4 = await exec('describe', tmpFile);
      let p4 = JSON.parse(r4.stdout);
      assert.ok(p4.panelTypes);

      let r5 = await exec('validate', tmpFile);
      let p5 = JSON.parse(r5.stdout);
      assert.equal(p5.valid, true);

      let previewDir = join(dirname(tmpFile), 'preview');
      let r6 = await exec('preview', tmpFile, '--output-dir', previewDir);
      let p6 = JSON.parse(r6.stdout);
      assert.equal(p6.status, 'ok');
      assert.equal(p6.outputDir, previewDir);
    });
  });

  it('register-panel-type + mount-widget via --config', async () => {
    await withTempPath('cli-config', 'workspace.json', async (tmpFile) => {
      await exec('scaffold-from-scratch', '--name', 'Widget Test', '--config', tmpFile);

      let r1 = await exec(
        'register-panel-type',
        '--config',
        tmpFile,
        '--name',
        'main',
        '--title',
        'Main',
        '--component',
        'sn-card',
      );
      let p1 = JSON.parse(r1.stdout);
      assert.equal(p1.status, 'ok');

      let r2 = await exec(
        'mount-widget',
        '--config',
        tmpFile,
        '--panelType',
        'main',
        '--componentTag',
        'sn-data-table',
      );
      let p2 = JSON.parse(r2.stdout);
      assert.equal(p2.status, 'ok');

      let r3 = await exec('list-panel-types', '--config', tmpFile);
      let p3 = JSON.parse(r3.stdout);
      assert.equal(p3.count, 1);
    });
  });
});

describe('CLI error handling', () => {
  it('exits with error on unknown command', async () => {
    try {
      await exec('unknown-command-xyz');
      assert.fail('Should have exited with error');
    } catch (err) {
      assert.ok(err.code === 1);
    }
  });

  it('validates invalid config file', async () => {
    await withTempPath('cli-invalid', 'invalid.json', async (tmpFile) => {
      await writeFile(tmpFile, JSON.stringify({ invalid: true }));
      let { stdout } = await exec('validate', tmpFile);
      let result = JSON.parse(stdout);
      assert.equal(result.valid, false);
    });
  });

  it('rejects host-only fields when loading --config', async () => {
    await withTempPath('cli-host-only', 'host-only.json', async (tmpFile) => {
      await writeFile(tmpFile, JSON.stringify({
        version: '0.3.0',
        name: 'Host Only',
        server: { url: 'https://example.test' },
      }));

      try {
        await exec('list-groups', '--config', tmpFile);
        assert.fail('Expected --config load to reject host-only fields');
      } catch (err) {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /portable workspace config/);
        assert.match(err.stderr, /server/);
      }
    });
  });

  it('exits nonzero when dispatch returns a structured error', async () => {
    try {
      await exec('add-group');
      assert.fail('Expected missing args to exit with error');
    } catch (err) {
      assert.equal(err.code, 1);
      let result = JSON.parse(err.stdout);
      assert.equal(result.status, 'error');
      assert.equal(result.tool, 'add_group');
      assert.match(result.hint, /Missing required arguments/);
    }
  });

  it('prints structured create handoff intent errors as JSON', async () => {
    try {
      await exec(
        'create-workspace-construction-handoff',
        '--context',
        JSON.stringify({ valid: true, ready: true }),
        '--intent',
        JSON.stringify({
          brief: 'Invalid CLI handoff',
          requiredCapabilities: ['valid', ''],
        }),
      );
      assert.fail('Expected invalid handoff intent to exit with error');
    } catch (err) {
      assert.equal(err.code, 1);
      let result = JSON.parse(err.stdout);
      assert.equal(result.status, 'error');
      assert.equal(result.tool, 'create_workspace_construction_handoff');
      assert.equal(result.code, 'construction_handoff_intent_invalid');
      assert.equal(result.nextAction, 'fix-construction-intent');
      assert.match(result.hint, /requiredCapabilities must contain non-empty strings/);
    }
  });
});
