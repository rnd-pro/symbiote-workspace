import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

let exec = promisify(execFile);
let ROOT = resolve(import.meta.dirname, '..');
let TMP_ROOT = resolve(ROOT, 'tmp');

async function withTempConsumer(run) {
  await mkdir(TMP_ROOT, { recursive: true });
  let dir = await mkdtemp(join(TMP_ROOT, 'package-consumer-'));
  try {
    return await run({
      artifactsDir: join(dir, 'artifacts'),
      consumerDir: join(dir, 'consumer'),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function packageRoot(specifier) {
  let entryUrl = import.meta.resolve(specifier);
  return dirname(fileURLToPath(entryUrl));
}

async function run(command, args, options = {}) {
  return exec(command, args, {
    maxBuffer: 1024 * 1024 * 20,
    ...options,
  });
}

async function packPackage(packagePath, artifactsDir) {
  let { stdout } = await run('npm', [
    'pack',
    packagePath,
    '--pack-destination',
    artifactsDir,
    '--json',
  ], { cwd: ROOT });
  let [pack] = JSON.parse(stdout);
  return join(artifactsDir, pack.filename);
}

async function runNode(consumerDir, source) {
  return run('node', ['--input-type=module', '-e', source], { cwd: consumerDir });
}

function parseProtocolResponses(state) {
  let responses = [];
  while (true) {
    let header = state.buffer.match(/Content-Length: (\d+)\r\n\r\n/);
    if (!header) return responses;
    let length = Number(header[1]);
    let start = header[0].length;
    if (state.buffer.length < start + length) return responses;
    responses.push(JSON.parse(state.buffer.slice(start, start + length)));
    state.buffer = state.buffer.slice(start + length);
  }
}

function mcpSession(command, args, messages, timeout = 5000) {
  return new Promise((resolveSession, reject) => {
    let child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let expected = messages.filter((message) => message.id !== undefined).length;
    let responses = [];
    let state = { buffer: '' };
    let timers = [];
    let settled = false;

    function cleanup() {
      for (let timer of timers) clearTimeout(timer);
      if (!child.killed) child.kill();
    }

    function finish() {
      if (settled) return;
      settled = true;
      cleanup();
      resolveSession(responses);
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    child.on('error', fail);
    child.stdout.on('data', (chunk) => {
      state.buffer += chunk.toString();
      responses.push(...parseProtocolResponses(state));
      if (expected > 0 && responses.length >= expected) finish();
    });

    function send(message) {
      let json = JSON.stringify(message);
      child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
    }

    let delay = 0;
    for (let message of messages) {
      timers.push(setTimeout(() => send(message), delay));
      delay += 100;
    }
    timers.push(setTimeout(finish, Math.max(timeout, delay + 500)));
  });
}

describe('packed package consumer', () => {
  it('installs packed workspace with a packed symbiote-ui substitute', async () => {
    await withTempConsumer(async ({ artifactsDir, consumerDir }) => {
      await mkdir(artifactsDir, { recursive: true });
      await mkdir(consumerDir, { recursive: true });

      let workspaceTarball = await packPackage(ROOT, artifactsDir);
      let symbioteUiTarball = await packPackage(await packageRoot('symbiote-ui'), artifactsDir);

      await run('npm', ['init', '-y'], { cwd: consumerDir });
      await run('npm', [
        'install',
        symbioteUiTarball,
        workspaceTarball,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ], { cwd: consumerDir });

      await runNode(consumerDir, `
        let specs = [
          'symbiote-workspace',
          'symbiote-workspace/runtime',
          'symbiote-workspace/constructor',
          'symbiote-workspace/schema',
          'symbiote-workspace/sharing',
          'symbiote-workspace/validation',
          'symbiote-workspace/plugins',
          'symbiote-workspace/server',
          'symbiote-workspace/browser',
          'symbiote-ui/rules/design-policy.js',
        ];
        for (let spec of specs) await import(spec);
      `);

      await runNode(consumerDir, `
        import { collectPluginModuleCapabilities as fromRoot } from 'symbiote-workspace';
        import { collectPluginWorkspaceTemplates as templatesFromRoot } from 'symbiote-workspace';
        import { listPluginWorkspaceTemplates as listTemplatesFromRoot } from 'symbiote-workspace';
        import { collectPluginModuleCapabilities as fromPlugins } from 'symbiote-workspace/plugins';
        import { collectPluginWorkspaceTemplates as templatesFromPlugins } from 'symbiote-workspace/plugins';
        import { listPluginWorkspaceTemplates as listTemplatesFromPlugins } from 'symbiote-workspace/plugins';
        import { collectPluginModuleCapabilities as fromBrowser } from 'symbiote-workspace/browser';
        import { collectPluginWorkspaceTemplates as templatesFromBrowser } from 'symbiote-workspace/browser';
        import { listPluginWorkspaceTemplates as listTemplatesFromBrowser } from 'symbiote-workspace/browser';

        for (let helper of [
          fromRoot,
          templatesFromRoot,
          listTemplatesFromRoot,
          fromPlugins,
          templatesFromPlugins,
          listTemplatesFromPlugins,
          fromBrowser,
          templatesFromBrowser,
          listTemplatesFromBrowser
        ]) {
          if (typeof helper !== 'function') {
            throw new Error('plugin collection export missing');
          }
        }

        try {
          await import('symbiote-workspace/plugins/plugin-capabilities.js');
          throw new Error('plugin internals should not be deep-importable');
        } catch (error) {
          if (error.message === 'plugin internals should not be deep-importable') throw error;
          if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
        }
      `);

      let cli = await run('npx', [
        '--no-install',
        'symbiote-workspace',
        'list-templates',
      ], { cwd: consumerDir });
      let templates = JSON.parse(cli.stdout);
      assert.ok(templates.templates.includes('agent-workspace'));
      assert.ok(templates.templates.includes('social-automation'));

      await runNode(consumerDir, `
        import { createSession, dispatch } from 'symbiote-workspace/runtime';
        import {
          activatePlugin,
          collectPluginModuleCapabilities,
          collectPluginWorkspaceTemplates,
          listPluginWorkspaceTemplates,
          registerPlugin
        } from 'symbiote-workspace/plugins';
        import { planWorkspaceConstruction } from 'symbiote-workspace/constructor';
        import { createHostIntegrationContract } from 'symbiote-workspace/sharing';

        let session = createSession();
        let plugin = {
          name: '@acme/review-pack',
          version: '1.0.0',
          capabilities: ['provider.analytics'],
          components: [
            'acme-legacy-widget',
            {
              tagName: 'acme-sentiment-panel',
              provider: '@acme/review-pack',
              capabilities: ['analysis.sentiment'],
              requiredHostServices: ['storage.project'],
              placement: {
                panelType: 'sentiment',
                title: 'Sentiment',
                icon: 'sentiment_satisfied'
              }
            }
          ],
          workspace: {
            templates: [{
              name: 'sentiment-review-room',
              description: 'Sentiment review room.',
              config: {
                version: '0.1.0',
                name: 'Sentiment Review Room',
                register: 'agent-workspace'
              }
            }]
          }
        };
        let pluginCapabilities = collectPluginModuleCapabilities([plugin]);
        if (!pluginCapabilities.ok) {
          throw new Error(JSON.stringify(pluginCapabilities.errors));
        }
        let pluginTemplates = collectPluginWorkspaceTemplates([plugin]);
        if (!pluginTemplates.ok || pluginTemplates.templates[0].name !== 'sentiment-review-room') {
          throw new Error(JSON.stringify(pluginTemplates.errors));
        }
        if (pluginTemplates.templates[0].source.plugin !== '@acme/review-pack') {
          throw new Error('workspace template source metadata missing');
        }
        let roomPlan = planWorkspaceConstruction({
          brief: 'sentiment review room',
          template: 'sentiment-review-room'
        }, {
          workspaceTemplates: pluginTemplates.templates
        });
        if (roomPlan.intent.template !== 'sentiment-review-room') {
          throw new Error('plugin workspace template was not accepted by constructor');
        }
        if (roomPlan.config.name !== 'Sentiment Review Room') {
          throw new Error('plugin workspace template config was not constructed');
        }
        registerPlugin(plugin);
        registerPlugin({
          name: '@acme/inactive-pack',
          version: '1.0.0',
          workspace: {
            templates: [{
              name: 'inactive-review-room',
              config: {
                version: '0.1.0',
                name: 'Inactive Review Room'
              }
            }]
          }
        });
        await activatePlugin('@acme/review-pack');
        let activeTemplates = listPluginWorkspaceTemplates({ status: 'active' });
        if (
          !activeTemplates.ok ||
          activeTemplates.templates.length !== 1 ||
          activeTemplates.templates[0].name !== 'sentiment-review-room'
        ) {
          throw new Error(JSON.stringify(activeTemplates));
        }

        let constructed = await dispatch('construct_workspace', {
          intent: 'sentiment review workspace',
          template: 'dashboard',
          requiredCapabilities: ['analysis.sentiment'],
          moduleCapabilities: pluginCapabilities.moduleCapabilities,
        }, session);
        if (constructed.status !== 'ok') {
          throw new Error(constructed.hint || 'construct_workspace failed');
        }
        if (constructed.plan.answers.moduleSelection[0] !== 'sentiment') {
          throw new Error('plugin-derived module was not selected');
        }
        if (session.config.panelTypes.sentiment.component !== 'acme-sentiment-panel') {
          throw new Error('plugin-derived module was not materialized');
        }
        let exported = await dispatch('export_workspace', { strict: true }, session);
        if (exported.status !== 'ok') {
          throw new Error(exported.hint || 'export_workspace failed');
        }
        let contract = createHostIntegrationContract(session.config);
        if (contract.status !== 'ok') {
          throw new Error('createHostIntegrationContract failed');
        }
      `);

      let bin = resolve(consumerDir, 'node_modules/.bin/symbiote-workspace');
      let responses = await mcpSession(bin, ['mcp'], [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ]);
      let toolList = responses.find((response) => response.id === 2);
      assert.ok(toolList);
      let toolNames = new Set(toolList.result.tools.map((tool) => tool.name));
      assert.equal(toolNames.has('construct_workspace'), true);
      assert.equal(toolNames.has('export_workspace'), true);
    });
  });
});
