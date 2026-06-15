import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { TOOLS } from '../runtime/index.js';

let exec = promisify(execFile);
let ROOT = resolve(import.meta.dirname, '..');
let TMP_ROOT = resolve(ROOT, 'tmp');
let PACKAGE_META = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

async function withTempConsumer(run) {
  await mkdir(TMP_ROOT, { recursive: true });
  let dir = await mkdtemp(join(TMP_ROOT, 'package-consumer-'));
  try {
    return await run({
      artifactsDir: join(dir, 'artifacts'),
      consumerDir: join(dir, 'consumer'),
      npmEnv: {
        ...process.env,
        HOME: join(dir, 'npm-home'),
        XDG_CACHE_HOME: join(dir, 'xdg-cache'),
        npm_config_cache: join(dir, 'npm-cache'),
        npm_config_userconfig: join(dir, 'npmrc'),
      },
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

function withNpmEnv(options, npmEnv) {
  return {
    ...options,
    env: { ...npmEnv, ...options.env },
  };
}

async function packPackage(packagePath, artifactsDir, npmEnv) {
  let { stdout } = await run('npm', [
    'pack',
    packagePath,
    '--pack-destination',
    artifactsDir,
    '--json',
  ], withNpmEnv({ cwd: ROOT }, npmEnv));
  let [pack] = JSON.parse(stdout);
  return {
    pack,
    tarball: join(artifactsDir, pack.filename),
  };
}

function packedPaths(pack) {
  return new Set(pack.files.map((file) => file.path));
}

function assertNoForbiddenPackEntries(pack) {
  for (let file of pack.files) {
    assert.equal(file.path.startsWith('tmp/'), false, `${file.path} must not be packed`);
    assert.equal(file.path.startsWith('.agent-portal/'), false, `${file.path} must not be packed`);
    assert.equal(file.path.startsWith('tests/'), false, `${file.path} must not be packed`);
    assert.equal(file.path.includes('npm-cache'), false, `${file.path} must not be packed`);
    assert.equal(file.path.endsWith('.tgz'), false, `${file.path} must not be packed`);
  }
}

function assertPackIncludesTarget(paths, target) {
  let normalized = target.replace(/^\.\//, '');
  if (normalized.includes('*')) {
    let prefix = normalized.slice(0, normalized.indexOf('*'));
    assert.equal(
      [...paths].some((path) => path.startsWith(prefix)),
      true,
      `Package export pattern ${target} must include files`,
    );
    return;
  }
  assert.equal(paths.has(normalized), true, `Package must include ${normalized}`);
}

function assertWorkspacePackList(pack) {
  let paths = packedPaths(pack);
  assertNoForbiddenPackEntries(pack);

  for (let target of ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
    assert.equal(paths.has(target), true, `Package must include ${target}`);
  }

  for (let value of Object.values(PACKAGE_META.exports)) {
    if (typeof value === 'string') {
      assertPackIncludesTarget(paths, value);
      continue;
    }
    for (let target of Object.values(value)) {
      assertPackIncludesTarget(paths, target);
    }
  }

  for (let target of Object.values(PACKAGE_META.bin)) {
    assertPackIncludesTarget(paths, target);
  }
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
    await withTempConsumer(async ({ artifactsDir, consumerDir, npmEnv }) => {
      await mkdir(artifactsDir, { recursive: true });
      await mkdir(consumerDir, { recursive: true });

      let workspacePack = await packPackage(ROOT, artifactsDir, npmEnv);
      assertWorkspacePackList(workspacePack.pack);

      let symbioteUiPack = await packPackage(
        await packageRoot('symbiote-ui'),
        artifactsDir,
        npmEnv,
      );
      let workspaceTarball = workspacePack.tarball;
      let symbioteUiTarball = symbioteUiPack.tarball;

      await run('npm', ['init', '-y'], withNpmEnv({ cwd: consumerDir }, npmEnv));
      await run('npm', [
        'install',
        symbioteUiTarball,
        workspaceTarball,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ], withNpmEnv({ cwd: consumerDir }, npmEnv));

      await runNode(consumerDir, `
        let specs = [
          'symbiote-workspace',
          'symbiote-workspace/runtime',
          'symbiote-workspace/constructor',
          'symbiote-workspace/schema',
          'symbiote-workspace/schema/validate.js',
          'symbiote-workspace/loader',
          'symbiote-workspace/sharing',
          'symbiote-workspace/validation',
          'symbiote-workspace/plugins',
          'symbiote-workspace/handlers',
          'symbiote-workspace/server',
          'symbiote-workspace/browser',
          'symbiote-ui/rules/design-policy.js',
        ];
        for (let spec of specs) await import(spec);
      `);

      await runNode(consumerDir, `
        import packageMeta from 'symbiote-workspace/package.json' with { type: 'json' };
        import { describeWorkspace, setLayout } from 'symbiote-workspace/handlers';
        import { loadWorkspaceConfig } from 'symbiote-workspace/loader';
        import { validateWorkspaceConfig } from 'symbiote-workspace/schema/validate.js';
        import { WORKSPACE_CONFIG_SCHEMA } from 'symbiote-workspace/schema/workspace-schema.js';
        import { MODULE_CAPABILITY_DESCRIPTOR_SCHEMA } from 'symbiote-workspace/schema/module-capability.js';

        let sideEffects = packageMeta.sideEffects;
        if (!Array.isArray(sideEffects)) throw new Error('sideEffects metadata must be explicit');
        if (!sideEffects.includes('./cli.js')) throw new Error('cli.js side effect metadata missing');
        if (!sideEffects.includes('./mcp/index.js')) throw new Error('mcp/index.js side effect metadata missing');
        if (typeof describeWorkspace !== 'function') throw new Error('handlers describeWorkspace export missing');
        if (typeof setLayout !== 'function') throw new Error('handlers setLayout export missing');
        if (typeof loadWorkspaceConfig !== 'function') throw new Error('loader loadWorkspaceConfig export missing');
        if (typeof validateWorkspaceConfig !== 'function') throw new Error('schema wildcard validateWorkspaceConfig export missing');
        if (!WORKSPACE_CONFIG_SCHEMA?.properties) throw new Error('schema wildcard WORKSPACE_CONFIG_SCHEMA export missing');
        if (!MODULE_CAPABILITY_DESCRIPTOR_SCHEMA?.properties) throw new Error('schema wildcard MODULE_CAPABILITY_DESCRIPTOR_SCHEMA export missing');
        let validationReportSchema = WORKSPACE_CONFIG_SCHEMA.$defs?.validationReport;
        if (!validationReportSchema?.properties) throw new Error('validationReport schema export missing');
        if (JSON.stringify(validationReportSchema.required) !== JSON.stringify(['id', 'check', 'status', 'severity', 'message'])) {
          throw new Error('validationReport required fields drifted');
        }
        if (JSON.stringify(validationReportSchema.properties.status.enum) !== JSON.stringify(['pass', 'warn', 'blocked'])) {
          throw new Error('validationReport status enum drifted');
        }
        if (JSON.stringify(validationReportSchema.properties.severity.enum) !== JSON.stringify(['info', 'warning', 'error'])) {
          throw new Error('validationReport severity enum drifted');
        }
        let validReportConfig = {
          version: '0.3.0',
          name: 'Report Contract',
          validation: {
            reports: [{
              id: 'package-readiness',
              check: 'package-readiness',
              status: 'warn',
              severity: 'warning',
              message: 'Package capability missing.',
            }],
          },
          construction: {
            plan: {
              verification: {
                reports: [{
                  id: 'package-readiness',
                  check: 'package-readiness',
                  status: 'warn',
                  severity: 'warning',
                  message: 'Package capability missing.',
                }],
              },
            },
          },
        };
        let validReportResult = validateWorkspaceConfig(validReportConfig);
        if (!validReportResult.valid) throw new Error('installed validator rejected valid reports');
        let invalidReportResult = validateWorkspaceConfig({
          ...validReportConfig,
          validation: {
            reports: [{
              id: 'bad-report',
              check: 'package-readiness',
              status: 'warning',
              severity: 'warning',
              message: 'Bad status.',
            }],
          },
        });
        if (invalidReportResult.valid) throw new Error('installed validator accepted invalid report status');
      `);

      await runNode(consumerDir, `
        import { applyWorkspacePatch } from 'symbiote-workspace';
        import { checkDesignGuardrails } from 'symbiote-workspace';
        import { collectPluginModuleCapabilities as fromRoot } from 'symbiote-workspace';
        import {
          MODULE_CAPABILITY_DESCRIPTOR_SCHEMA as rootModuleCapabilitySchema,
          MODULE_CAPABILITY_SCHEMA_VERSION as rootModuleCapabilitySchemaVersion,
          validateModuleCapabilityDescriptor as validateRootModuleCapabilityDescriptor,
          validatePortableStringArray as validateRootPortableStringArray,
        } from 'symbiote-workspace';
        import { proposeWorkspacePatch } from 'symbiote-workspace';
        import { collectPluginWorkspaceTemplates as templatesFromRoot } from 'symbiote-workspace';
        import { listPluginWorkspaceTemplates as listTemplatesFromRoot } from 'symbiote-workspace';
        import { collectPluginModuleCapabilities as fromPlugins } from 'symbiote-workspace/plugins';
        import {
          MODULE_CAPABILITY_DESCRIPTOR_SCHEMA as pluginModuleCapabilitySchema,
          MODULE_CAPABILITY_SCHEMA_VERSION as pluginModuleCapabilitySchemaVersion,
          validateModuleCapabilityDescriptor as validatePluginModuleCapabilityDescriptor,
          validatePortableStringArray as validatePluginPortableStringArray,
        } from 'symbiote-workspace/plugins';
        import {
          MODULE_CAPABILITY_DESCRIPTOR_SCHEMA as schemaModuleCapabilitySchema,
          MODULE_CAPABILITY_SCHEMA_VERSION as schemaModuleCapabilitySchemaVersion,
          validateModuleCapabilityDescriptor as validateSchemaModuleCapabilityDescriptor,
          validatePortableStringArray as validateSchemaPortableStringArray,
        } from 'symbiote-workspace/schema';
        import { collectPluginWorkspaceTemplates as templatesFromPlugins } from 'symbiote-workspace/plugins';
        import { listPluginWorkspaceTemplates as listTemplatesFromPlugins } from 'symbiote-workspace/plugins';
        import { collectPluginModuleCapabilities as fromBrowser } from 'symbiote-workspace/browser';
        import {
          MODULE_CAPABILITY_DESCRIPTOR_SCHEMA as browserModuleCapabilitySchema,
          MODULE_CAPABILITY_SCHEMA_VERSION as browserModuleCapabilitySchemaVersion,
          validateModuleCapabilityDescriptor as validateBrowserModuleCapabilityDescriptor,
          validatePortableStringArray as validateBrowserPortableStringArray,
        } from 'symbiote-workspace/browser';
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
        for (let helper of [
          applyWorkspacePatch,
          checkDesignGuardrails,
          proposeWorkspacePatch,
        ]) {
          if (typeof helper !== 'function') {
            throw new Error('root validation helper export missing');
          }
        }
        if (rootModuleCapabilitySchemaVersion !== '0.1.0') {
          throw new Error('root MODULE_CAPABILITY_SCHEMA_VERSION export missing');
        }
        if (browserModuleCapabilitySchemaVersion !== '0.1.0') {
          throw new Error('browser MODULE_CAPABILITY_SCHEMA_VERSION export missing');
        }
        if (pluginModuleCapabilitySchemaVersion !== '0.1.0') {
          throw new Error('plugins MODULE_CAPABILITY_SCHEMA_VERSION export missing');
        }
        if (schemaModuleCapabilitySchemaVersion !== '0.1.0') {
          throw new Error('schema MODULE_CAPABILITY_SCHEMA_VERSION export missing');
        }
        if (!rootModuleCapabilitySchema?.properties?.tagName) {
          throw new Error('root MODULE_CAPABILITY_DESCRIPTOR_SCHEMA export missing');
        }
        if (!browserModuleCapabilitySchema?.properties?.tagName) {
          throw new Error('browser MODULE_CAPABILITY_DESCRIPTOR_SCHEMA export missing');
        }
        if (!pluginModuleCapabilitySchema?.properties?.tagName) {
          throw new Error('plugins MODULE_CAPABILITY_DESCRIPTOR_SCHEMA export missing');
        }
        if (!schemaModuleCapabilitySchema?.properties?.tagName) {
          throw new Error('schema MODULE_CAPABILITY_DESCRIPTOR_SCHEMA export missing');
        }
        for (let helper of [
          validateRootModuleCapabilityDescriptor,
          validateBrowserModuleCapabilityDescriptor,
          validatePluginModuleCapabilityDescriptor,
          validateSchemaModuleCapabilityDescriptor,
          validateRootPortableStringArray,
          validateBrowserPortableStringArray,
          validatePluginPortableStringArray,
          validateSchemaPortableStringArray,
        ]) {
          if (typeof helper !== 'function') {
            throw new Error('module capability validator export missing');
          }
        }

        let config = {
          version: '0.2.0',
          name: 'Packed Validation Helpers',
          register: 'tool',
          layout: { type: 'panel', panelType: 'main' },
          panelTypes: { main: { title: 'Main', component: 'sn-panel' } },
          components: { catalog: ['sn-panel'] },
        };
        let guardrails = checkDesignGuardrails(config);
        if (guardrails.pass !== true) throw new Error('root checkDesignGuardrails failed');
        let proposal = await proposeWorkspacePatch(config, {
          theme: { params: { mode: 'dark' } },
        });
        if (!proposal.accepted || !proposal.overlay?.theme) {
          throw new Error('root proposeWorkspacePatch failed');
        }
        let applied = await applyWorkspacePatch(config, proposal.overlay);
        if (applied.config.theme.params.mode !== 'dark') {
          throw new Error('root applyWorkspacePatch failed');
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
      ], withNpmEnv({ cwd: consumerDir }, npmEnv));
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
        import {
          createHostIntegrationContract,
          exportWorkspacePackage,
          importWorkspacePackage,
        } from 'symbiote-workspace/sharing';

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
            templates: [
              {
                name: 'sentiment-review-room',
                description: 'Sentiment review room.',
                config: {
                  version: '0.1.0',
                  name: 'Sentiment Review Room',
                  register: 'agent-workspace'
                }
              },
              {
                name: 'voice-video-room',
                description: 'Portable voice and video AI room.',
                config: {
                  version: '0.1.0',
                  name: 'Voice Video Room',
                  register: 'agent-workspace',
                  panelTypes: {
                    stage: { title: 'Stage', icon: 'video_call', component: 'room-media-stage' },
                    command: { title: 'Command', icon: 'terminal', component: 'room-command-panel' }
                  },
                  layout: {
                    type: 'split',
                    direction: 'horizontal',
                    ratio: 0.7,
                    first: { type: 'panel', panelType: 'stage' },
                    second: { type: 'panel', panelType: 'command' }
                  },
                  components: {
                    catalog: ['room-media-stage', 'room-command-panel'],
                    modules: [
                      {
                        tagName: 'room-media-stage',
                        capabilities: ['room.video', 'room.audio', 'media.realtime'],
                        runtimeSlots: [{ id: 'media-session', role: 'provider', required: true }],
                        requiredHostServices: ['media.realtime', 'presence.session']
                      },
                      {
                        tagName: 'room-command-panel',
                        capabilities: ['room.command', 'agent.command-input'],
                        runtimeSlots: [{ id: 'agent-runtime', role: 'provider', required: true }],
                        requiredHostServices: ['agent.runtime']
                      }
                    ]
                  }
                }
              }
            ]
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
        let callPlan = planWorkspaceConstruction({
          brief: 'voice video AI room',
          template: 'voice-video-room',
          requiredCapabilities: ['room.video', 'room.command']
        }, {
          workspaceTemplates: pluginTemplates.templates
        });
        if (callPlan.plan.capabilities.missing.length !== 0) {
          throw new Error('voice/video room capabilities were not covered');
        }
        let callContract = createHostIntegrationContract(callPlan.config);
        if (
          callContract.status !== 'ok' ||
          !callContract.contract.services.required.includes('media.realtime') ||
          !callContract.contract.runtimeSlots.required.some((slot) => slot.id === 'media-session')
        ) {
          throw new Error('voice/video room host contract missing media requirements');
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
          activeTemplates.templates.length !== 2 ||
          !activeTemplates.templates.some((template) => template.name === 'sentiment-review-room') ||
          !activeTemplates.templates.some((template) => template.name === 'voice-video-room')
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
        let generatedReports = session.config.construction.plan.verification.reports;
        if (!Array.isArray(generatedReports) || generatedReports.length === 0) {
          throw new Error('constructed workspace did not generate verification reports');
        }
        if (JSON.stringify(session.config.validation.reports) !== JSON.stringify(generatedReports)) {
          throw new Error('constructed workspace validation reports do not mirror construction reports');
        }
        let exported = await dispatch('export_workspace', { strict: true }, session);
        if (exported.status !== 'ok') {
          throw new Error(exported.hint || 'export_workspace failed');
        }
        let packageExport = exportWorkspacePackage(session.config, {
          id: 'constructed-report-package',
          version: '1.0.0',
        });
        if (!packageExport.json) throw new Error(JSON.stringify(packageExport.errors));
        let packageImport = importWorkspacePackage(packageExport.json);
        if (!packageImport.config) throw new Error(JSON.stringify(packageImport.errors));
        if (JSON.stringify(packageImport.config.construction.plan.verification.reports) !== JSON.stringify(generatedReports)) {
          throw new Error('package import dropped generated construction verification reports');
        }
        if (JSON.stringify(packageImport.config.validation.reports) !== JSON.stringify(generatedReports)) {
          throw new Error('package import dropped generated validation reports');
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
      assert.equal(toolList.result.tools.length, TOOLS.length);
      let expectedTools = new Map(TOOLS.map((tool) => [tool.name, tool]));
      let toolNames = new Set(toolList.result.tools.map((tool) => tool.name));
      assert.deepEqual([...toolNames].sort(), [...expectedTools.keys()].sort());
      for (let tool of toolList.result.tools) {
        let expected = expectedTools.get(tool.name);
        assert.equal(tool.description, expected.description, `${tool.name} description mismatch`);
        assert.deepEqual(tool.inputSchema, expected.inputSchema, `${tool.name} inputSchema mismatch`);
        assert.equal(tool.mutates, undefined, `Tool ${tool.name} leaked 'mutates' field`);
        assert.equal(tool.writesFiles, undefined, `Tool ${tool.name} leaked 'writesFiles' field`);
        assert.equal(
          tool.annotations?.readOnlyHint,
          expected.mutates !== true && expected.writesFiles !== true,
          `Tool ${tool.name} readOnlyHint mismatch`,
        );
      }

      // Workspace package: public export availability from sharing + root entry points
      await runNode(consumerDir, `
        import {
          exportWorkspacePackage,
          importWorkspacePackage,
          validateWorkspacePackage,
          createWorkspaceConstructionHandoff,
          createWorkspacePackageConstructionContext,
          createWorkspacePackagesConstructionContext,
          inspectWorkspacePackage,
          WORKSPACE_PACKAGE_KIND,
          WORKSPACE_PACKAGE_SCHEMA_VERSION,
        } from 'symbiote-workspace/sharing';

        if (typeof exportWorkspacePackage !== 'function') throw new Error('exportWorkspacePackage not exported');
        if (typeof importWorkspacePackage !== 'function') throw new Error('importWorkspacePackage not exported');
        if (typeof validateWorkspacePackage !== 'function') throw new Error('validateWorkspacePackage not exported');
        if (typeof createWorkspaceConstructionHandoff !== 'function') {
          throw new Error('createWorkspaceConstructionHandoff not exported from sharing');
        }
        if (typeof createWorkspacePackageConstructionContext !== 'function') {
          throw new Error('createWorkspacePackageConstructionContext not exported from sharing');
        }
        if (typeof createWorkspacePackagesConstructionContext !== 'function') {
          throw new Error('createWorkspacePackagesConstructionContext not exported from sharing');
        }
        if (typeof inspectWorkspacePackage !== 'function') throw new Error('inspectWorkspacePackage not exported from sharing');
        if (WORKSPACE_PACKAGE_KIND !== 'symbiote-workspace-package') throw new Error('WORKSPACE_PACKAGE_KIND mismatch');
        if (WORKSPACE_PACKAGE_SCHEMA_VERSION !== '0.1.0') throw new Error('WORKSPACE_PACKAGE_SCHEMA_VERSION mismatch');

        let root = await import('symbiote-workspace');
        if (typeof root.exportWorkspacePackage !== 'function') throw new Error('root exportWorkspacePackage missing');
        if (typeof root.importWorkspacePackage !== 'function') throw new Error('root importWorkspacePackage missing');
        if (typeof root.validateWorkspacePackage !== 'function') throw new Error('root validateWorkspacePackage missing');
        if (typeof root.createWorkspaceConstructionHandoff !== 'function') {
          throw new Error('root createWorkspaceConstructionHandoff missing');
        }
        if (typeof root.createWorkspacePackageConstructionContext !== 'function') {
          throw new Error('root createWorkspacePackageConstructionContext missing');
        }
        if (typeof root.createWorkspacePackagesConstructionContext !== 'function') {
          throw new Error('root createWorkspacePackagesConstructionContext missing');
        }
        if (typeof root.inspectWorkspacePackage !== 'function') throw new Error('root inspectWorkspacePackage missing');

        let browser = await import('symbiote-workspace/browser');
        if (typeof browser.createWorkspaceConstructionHandoff !== 'function') {
          throw new Error('browser createWorkspaceConstructionHandoff missing');
        }
        if (typeof browser.createWorkspacePackageConstructionContext !== 'function') {
          throw new Error('browser createWorkspacePackageConstructionContext missing');
        }
        if (typeof browser.createWorkspacePackagesConstructionContext !== 'function') {
          throw new Error('browser createWorkspacePackagesConstructionContext missing');
        }
        if (typeof browser.inspectWorkspacePackage !== 'function') throw new Error('browser inspectWorkspacePackage missing');
      `);

      // Workspace package: round-trip export → import → validate through packed consumer
      await runNode(consumerDir, `
        import {
          exportWorkspacePackage,
          importWorkspacePackage,
          validateWorkspacePackage,
        } from 'symbiote-workspace/sharing';

        let reports = [{
          id: 'package-host-readiness',
          check: 'package-readiness',
          status: 'warn',
          severity: 'warning',
          message: 'Package host capability requires review.',
        }];
        let config = {
          version: '0.2.0',
          name: 'Packed Consumer Package',
          register: 'tool',
          theme: { params: { mode: 'dark' } },
          layout: { type: 'panel', panelType: 'main' },
          components: { catalog: ['sn-panel'] },
          construction: {
            plan: {
              verification: { reports },
            },
          },
          validation: { reports },
        };

        let manifest = {
          id: 'packed-consumer-pkg',
          version: '1.0.0',
          description: 'Package verified from packed consumer.',
          tags: ['test.consumer'],
          permissions: ['agent.runtime'],
          dependencies: { packages: ['symbiote-ui'] },
          assets: { docs: ['docs/readme.md'] },
        };

        let exported = exportWorkspacePackage(config, manifest);
        if (!exported.json) throw new Error(JSON.stringify(exported.errors));
        if (exported.package.kind !== 'symbiote-workspace-package') throw new Error('kind mismatch');
        if (exported.package.schemaVersion !== '0.1.0') throw new Error('schemaVersion mismatch');
        if (exported.package.manifest.id !== 'packed-consumer-pkg') throw new Error('manifest id mismatch');
        if (exported.package.manifest.version !== '1.0.0') throw new Error('manifest version mismatch');
        if (!exported.package.host.contract) throw new Error('host contract missing');
        if (!exported.package.manifest.dependencies.packages.includes('symbiote-ui')) {
          throw new Error('package dependency missing');
        }
        if (JSON.stringify(exported.package.workspace.config.construction.plan.verification.reports) !== JSON.stringify(reports)) {
          throw new Error('exported package dropped construction verification reports');
        }
        if (JSON.stringify(exported.package.workspace.config.validation.reports) !== JSON.stringify(reports)) {
          throw new Error('exported package dropped validation reports');
        }

        let imported = importWorkspacePackage(exported.json);
        if (!imported.package) throw new Error(JSON.stringify(imported.errors));
        if (imported.package.manifest.id !== 'packed-consumer-pkg') throw new Error('imported id mismatch');
        if (imported.config.name !== 'Packed Consumer Package') throw new Error('imported config name mismatch');
        if (JSON.stringify(imported.config.construction.plan.verification.reports) !== JSON.stringify(reports)) {
          throw new Error('imported config dropped construction verification reports');
        }
        if (JSON.stringify(imported.config.validation.reports) !== JSON.stringify(reports)) {
          throw new Error('imported config dropped validation reports');
        }

        let validation = validateWorkspacePackage(imported.package);
        if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
      `);

      // Workspace package: reject marketplace and private/host manifest state
      await runNode(consumerDir, `
        import { exportWorkspacePackage } from 'symbiote-workspace/sharing';

        let config = {
          version: '0.2.0',
          name: 'Rejection Test',
          register: 'tool',
          theme: { params: { mode: 'dark' } },
          layout: { type: 'panel', panelType: 'main' },
          components: { catalog: ['sn-panel'] },
        };

        let marketManifest = {
          id: 'market-package',
          version: '1.0.0',
          marketplace: { price: '9.00', sellerId: 'seller-123' },
          licenseServer: 'https://licenses.example.com',
          purchase: { id: 'p-123', status: 'active' },
        };

        let result = exportWorkspacePackage(config, marketManifest);
        if (result.json !== null) throw new Error('should reject marketplace state');
        if (!result.errors.some(e => e.path === 'manifest.marketplace')) throw new Error('missing marketplace error');
        if (!result.errors.some(e => e.path === 'manifest.licenseServer')) throw new Error('missing licenseServer error');
        if (!result.errors.some(e => e.path === 'manifest.purchase')) throw new Error('missing purchase error');

        let authManifest = {
          id: 'auth-package',
          version: '1.0.0',
          token: 'redacted-token-placeholder',
          secret: 'redacted-secret-placeholder',
          session: 'abc-session-id',
        };

        let result2 = exportWorkspacePackage(config, authManifest);
        if (result2.json !== null) throw new Error('should reject auth state');
        if (!result2.errors.some(e => e.path === 'manifest.token')) throw new Error('missing token error');
        if (!result2.errors.some(e => e.path === 'manifest.secret')) throw new Error('missing secret error');
        if (!result2.errors.some(e => e.path === 'manifest.session')) throw new Error('missing session error');
      `);

      // Workspace package: inspect with default valid/ready and available inventory
      await runNode(consumerDir, `
        import {
          createWorkspaceConstructionHandoff,
          createWorkspacePackageConstructionContext,
          exportWorkspacePackage,
          inspectWorkspacePackage,
        } from 'symbiote-workspace/sharing';
        import { planWorkspaceConstruction } from 'symbiote-workspace/constructor';

        let config = {
          version: '0.2.0',
          name: 'Inspect Test',
          register: 'tool',
          intent: {
            brief: 'Review queue workspace',
            targetRegister: 'tool',
            requiredCapabilities: ['review.queue'],
          },
          theme: { params: { mode: 'dark' } },
          panelTypes: {
            main: { title: 'Main', icon: 'dashboard', component: 'sn-panel' },
          },
          layout: { type: 'panel', panelType: 'main' },
          components: {
            catalog: ['sn-panel', 'acme-legacy-widget'],
            modules: [{
              tagName: 'acme-legacy-widget',
              provider: '@acme/review-pack',
              capabilities: ['review.queue'],
              placement: {
                panelType: 'review',
                title: 'Review',
                icon: 'fact_check',
              },
            }],
          },
        };

        let manifest = {
          id: 'inspect-pkg',
          version: '1.0.0',
          description: 'Valid package for inspection.',
          dependencies: {
            components: ['sn-panel', 'acme-legacy-widget'],
            plugins: ['@acme/review-pack'],
            packages: ['symbiote-ui'],
          },
        };

        let exported = exportWorkspacePackage(config, manifest);
        if (!exported.json) throw new Error(JSON.stringify(exported.errors));

        let result = inspectWorkspacePackage(exported.json);
        if (result.valid !== true) throw new Error('valid must be true, got ' + JSON.stringify(result.errors));
        if (result.ready !== true) throw new Error('ready must be true when no available filter is set, got ' + result.ready);
        if (!result.summary) throw new Error('summary missing');
        if (result.summary.id !== 'inspect-pkg') throw new Error('summary id mismatch');
        if (!result.requirements) throw new Error('requirements missing');
        if (!result.requirements.components.includes('sn-panel')) throw new Error('requirements components missing sn-panel');
        if (!result.requirements.plugins.includes('@acme/review-pack')) throw new Error('requirements plugins missing @acme/review-pack');
        if (!result.requirements.packages.includes('symbiote-ui')) throw new Error('requirements packages missing symbiote-ui');
        if (!result.package) throw new Error('inspect result package missing');
        if (!result.config) throw new Error('inspect result config missing');

        let partial = inspectWorkspacePackage(exported.json, {
          available: { components: ['sn-panel'] },
        });
        if (partial.ready !== false) throw new Error('ready must be false when dependencies are missing');
        if (!partial.missing) throw new Error('missing object absent');
        if (!partial.missing.components.includes('acme-legacy-widget')) {
          throw new Error('missing components must include acme-legacy-widget');
        }
        if (!partial.missing.plugins.includes('@acme/review-pack')) {
          throw new Error('missing plugins must include @acme/review-pack');
        }
        if (!partial.missing.packages.includes('symbiote-ui')) {
          throw new Error('missing packages must include symbiote-ui');
        }
        if (partial.warnings.length === 0) throw new Error('warnings must report missing capabilities');
        if (partial.valid !== true) throw new Error('valid must still be true even when deps are missing');
        if (!partial.summary) throw new Error('summary still present when deps are missing');

        let allAvailable = inspectWorkspacePackage(exported.json, {
          available: {
            components: ['sn-panel', 'acme-legacy-widget'],
            plugins: ['@acme/review-pack'],
            packages: ['symbiote-ui'],
          },
        });
        if (allAvailable.ready !== true) {
          throw new Error('ready must be true when all deps are available, got ' + allAvailable.ready);
        }
        if (allAvailable.warnings.length !== 0) {
          throw new Error('warnings must be empty when all deps are available, got ' + JSON.stringify(allAvailable.warnings));
        }

        let context = createWorkspacePackageConstructionContext(exported.json, {
          templateName: 'review-package',
        });
        if (context.valid !== true) throw new Error('package construction context must be valid');
        if (context.workspaceTemplates[0].name !== 'review-package') {
          throw new Error('templateName override not applied');
        }
        if (context.workspaceTemplates[0].source.packageId !== 'inspect-pkg') {
          throw new Error('template source package id missing');
        }
        if (context.source.type !== 'workspace-package') {
          throw new Error('context source type missing');
        }
        if (context.moduleCapabilities[0].tagName !== 'acme-legacy-widget') {
          throw new Error('module capabilities missing from package context');
        }

        let handoff = createWorkspaceConstructionHandoff(context, {
          brief: 'Review queue workspace',
          template: 'review-package',
        });
        let plan = planWorkspaceConstruction(handoff.intent, handoff.options);
        if (plan.plan.capabilities.missing.length !== 0) {
          throw new Error('package-derived constructor context did not cover review.queue');
        }
      `);
    });
  });
});
