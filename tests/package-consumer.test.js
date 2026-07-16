import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { TOOLS } from '../runtime/index.js';

let exec = promisify(execFile);
let ROOT = resolve(import.meta.dirname, '..');
let TMP_ROOT = resolve(ROOT, 'tmp');
let PACKAGE_META = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

it('requires the published engine release that owns caption presentation APIs', () => {
  assert.equal(PACKAGE_META.peerDependencies['symbiote-engine'], '>=0.3.0-alpha.12');
});

async function withTempConsumer(run) {
  await mkdir(TMP_ROOT, { recursive: true });
  let dir = await mkdtemp(join(TMP_ROOT, 'package-consumer-'));
  try {
    return await run({
      artifactsDir: join(dir, 'artifacts'),
      consumerDir: join(dir, 'consumer'),
      npmEnv: {
        ...process.env,
        npm_config_legacy_peer_deps: 'false',
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
  let dir = dirname(fileURLToPath(entryUrl));
  while (dir !== dirname(dir)) {
    try {
      let meta = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (meta.name && meta.version) return dir;
      dir = dirname(dir);
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error(`Unable to locate package root for ${specifier}`);
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
    '--ignore-scripts',
  ], withNpmEnv({ cwd: ROOT }, npmEnv));
  let [pack] = JSON.parse(stdout);
  return {
    pack,
    tarball: join(artifactsDir, pack.filename),
  };
}

async function packDependencyClosure(specifiers, artifactsDir, npmEnv) {
  let pending = [...specifiers];
  let packed = [];
  let seen = new Set();
  while (pending.length) {
    let specifier = pending.shift();
    let root = await packageRoot(specifier);
    let meta = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    let identity = `${meta.name}@${meta.version}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    packed.push(await packPackage(root, artifactsDir, npmEnv));
    pending.push(...Object.keys(meta.dependencies || {}));
  }
  return packed;
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
    assert.equal(file.path.includes('chrome-profile'), false, `${file.path} must not be packed`);
    assert.equal(file.path.includes('visual-demo-browser-smoke/'), false, `${file.path} must not be packed`);
    assert.equal(file.path.endsWith('screenshot.png'), false, `${file.path} must not be packed`);
    assert.equal(file.path.endsWith('dom.html'), false, `${file.path} must not be packed`);
    assert.equal(file.path.endsWith('.mjs'), false, `${file.path} must not be packed`);
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

function assertPackedPublicDocsUsePublicProviderContracts() {
  let docs = [
    'README.md',
    'llms.txt',
    'CHANGELOG.md',
    'docs/architecture.md',
    'docs/getting-started.md',
    'docs/host-contracts.md',
    'docs/plugins-and-templates.md',
    'examples/visual-demo/README.md',
  ];
  let forbidden = [
    {
      pattern: /symbiote-ui\/(?:themes|src|components|layout\/.+\.js|chat\/.+\.js|control\/.+\.js)/,
      reason: 'public docs must reference symbiote-ui package exports, not implementation paths',
    },
    {
      pattern: /(?:preview|browser-smoke)\.mjs/,
      reason: 'public docs must reference the .js visual-demo entrypoints',
    },
  ];

  for (let docPath of docs) {
    let text = readFileSync(resolve(ROOT, docPath), 'utf8');
    for (let { pattern, reason } of forbidden) {
      assert.doesNotMatch(text, pattern, `${docPath}: ${reason}`);
    }
  }
}

function assertWorkspacePackList(pack) {
  let paths = packedPaths(pack);
  assertNoForbiddenPackEntries(pack);
  assertPackedPublicDocsUsePublicProviderContracts();

  for (let target of ['package.json', 'README.md', 'llms.txt', 'LICENSE', 'CHANGELOG.md']) {
    assert.equal(paths.has(target), true, `Package must include ${target}`);
  }

  for (let target of [
    'docs/architecture.md',
    'docs/getting-started.md',
    'docs/host-contracts.md',
    'docs/plugins-and-templates.md',
    'docs/assets/realtime-builder-demo.png',
  ]) {
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

  assert.equal(
    paths.has('examples/visual-demo/preview.js'),
    true,
    'Package must include the visual demo script',
  );
  assert.equal(
    paths.has('examples/visual-demo/server-utils.js'),
    true,
    'Package must include the visual demo server helper',
  );
  assert.equal(
    paths.has('examples/visual-demo/realtime-builder.js'),
    true,
    'Package must include the realtime builder demo script',
  );
  assert.equal(
    paths.has('examples/visual-demo/realtime-builder-state.js'),
    true,
    'Package must include the realtime builder state model',
  );
  assert.equal(
    paths.has('examples/visual-demo/realtime-builder-runtime.js'),
    true,
    'Package must include the realtime builder browser runtime',
  );
  assert.equal(
    paths.has('examples/visual-demo/browser-smoke.js'),
    true,
    'Package must include the opt-in visual demo browser smoke script',
  );
  assert.equal(
    paths.has('scripts/release-preflight.js'),
    true,
    'Package must include the release preflight script referenced by package.json',
  );
  assert.equal(
    paths.has('examples/visual-demo/README.md'),
    true,
    'Package must include the visual demo README',
  );
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

function mcpSession(command, args, messages, timeout = 5000, options = {}) {
  return new Promise((resolveSession, reject) => {
    let child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
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
      let symbioteEnginePack = await packPackage(
        await packageRoot('symbiote-engine'),
        artifactsDir,
        npmEnv,
      );
      let symbioteCoreClosure = await packDependencyClosure(
        ['@symbiotejs/symbiote'],
        artifactsDir,
        npmEnv,
      );
      let wsPack = await packPackage(
        await packageRoot('ws'),
        artifactsDir,
        npmEnv,
      );
      let workspaceTarball = workspacePack.tarball;
      let symbioteUiTarball = symbioteUiPack.tarball;
      let symbioteEngineTarball = symbioteEnginePack.tarball;
      let wsTarball = wsPack.tarball;

      await run('npm', ['init', '-y'], withNpmEnv({ cwd: consumerDir }, npmEnv));
      await run('npm', [
        'install',
        symbioteEngineTarball,
        ...symbioteCoreClosure.map((item) => item.tarball),
        symbioteUiTarball,
        wsTarball,
        workspaceTarball,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--prefer-offline',
      ], withNpmEnv({ cwd: consumerDir }, npmEnv));

      await runNode(consumerDir, `
        let specs = [
          'symbiote-workspace',
          'symbiote-workspace/runtime',
          'symbiote-workspace/constructor',
          'symbiote-workspace/schema',
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
        import {
          createVirtualSequence,
          validateVirtualSequence,
          VIRTUAL_SEQUENCE_SCHEMA_VERSION,
          MEDIA_EVIDENCE_MANIFEST_SCHEMA_VERSION,
        } from 'symbiote-workspace';
        import { projectVirtualSequenceAt, mediaToolFamily } from 'symbiote-workspace/runtime';
        import { invalidateVirtualSequence } from 'symbiote-workspace/browser';

        if (VIRTUAL_SEQUENCE_SCHEMA_VERSION !== 'workspace-virtual-sequence-v1') {
          throw new Error('virtual sequence schema version drift');
        }
        if (MEDIA_EVIDENCE_MANIFEST_SCHEMA_VERSION !== 'workspace-media-evidence-v3') {
          throw new Error('media evidence schema version drift');
        }
        for (let fn of [createVirtualSequence, validateVirtualSequence, projectVirtualSequenceAt, invalidateVirtualSequence]) {
          if (typeof fn !== 'function') throw new Error('virtual sequence export missing');
        }
        if (mediaToolFamily.name !== 'media' || mediaToolFamily.tools.length !== 4) {
          throw new Error('media tool family missing from packed runtime');
        }
        let rejected = validateVirtualSequence({});
        if (rejected.ok !== false) throw new Error('validateVirtualSequence should reject empty input');
      `);

      let demoDir = join(consumerDir, 'visual-demo-preview');
      let demo = await run('node', [
        join(
          consumerDir,
          'node_modules',
          'symbiote-workspace',
          'examples',
          'visual-demo',
          'preview.js',
        ),
        '--write-only',
        '--output-dir',
        demoDir,
      ], withNpmEnv({ cwd: consumerDir }, npmEnv));
      let demoSummary = JSON.parse(demo.stdout);
      assert.equal(demoSummary.status, 'ok');
      assert.equal(demoSummary.template, 'video-studio');
      assert.equal(demoSummary.writeOnly, true);
      assert.equal(demoSummary.panels, 4);
      let previewContract = JSON.parse(await readFile(join(demoDir, 'preview.contract.json'), 'utf8'));
      assert.equal(previewContract.browser.entrypoint, 'symbiote-workspace/browser');
      assert.deepEqual(previewContract.browser.requiredImports, [
        'symbiote-workspace/browser',
        'symbiote-ui/ui',
        'symbiote-engine',
        'symbiote-engine/contracts',
        'symbiote-engine/',
      ]);
      assert.equal(previewContract.browser.themeAdapterModule, 'symbiote-ui/ui');
      assert.equal(previewContract.browser.themeAdapterExport, 'applyCascadeTheme');
      assert.equal(previewContract.browser.themeGeometryAdapterExport, 'applyCascadeGeometryRegister');
      assert.deepEqual(previewContract.browser.themeAdapterExports, ['applyCascadeTheme', 'applyCascadeGeometryRegister']);
      assert.equal(
        previewContract.importMap.imports['symbiote-ui/ui'],
        '/__symbiote_ui__/ui/index.js',
      );
      assert.equal(
        previewContract.importMap.imports['symbiote-engine/contracts'],
        '/__symbiote_engine__/contracts/index.js',
      );
      await readFile(join(demoDir, 'index.html'), 'utf8');
      await readFile(join(demoDir, 'app.js'), 'utf8');
      await readFile(join(demoDir, 'workspace.config.json'), 'utf8');

      await runNode(consumerDir, `
        import packageMeta from 'symbiote-workspace/package.json' with { type: 'json' };
        import { describeWorkspace, setLayout, workflowKanban } from 'symbiote-workspace/handlers';
        import { loadWorkspaceConfig } from 'symbiote-workspace/loader';
        import { validateWorkspaceConfig } from 'symbiote-workspace/schema';
        import { validateWorkspaceConfig as validateViaValidation } from 'symbiote-workspace/validation';
        import { WORKSPACE_CONFIG_SCHEMA } from 'symbiote-workspace/schema/workspace-schema.js';
        import { MODULE_CAPABILITY_DESCRIPTOR_SCHEMA } from 'symbiote-workspace/schema/module-capability.js';

        let sideEffects = packageMeta.sideEffects;
        if (!Array.isArray(sideEffects)) throw new Error('sideEffects metadata must be explicit');
        if (JSON.stringify(sideEffects) !== JSON.stringify(['./cli.js', './mcp/index.js'])) {
          throw new Error('sideEffects metadata drifted');
        }
        if (typeof describeWorkspace !== 'function') throw new Error('handlers describeWorkspace export missing');
        if (typeof setLayout !== 'function') throw new Error('handlers setLayout export missing');
        if (typeof workflowKanban !== 'function') throw new Error('handlers workflowKanban export missing');
        if (typeof loadWorkspaceConfig !== 'function') throw new Error('loader loadWorkspaceConfig export missing');
        if (typeof validateWorkspaceConfig !== 'function') throw new Error('schema validateWorkspaceConfig export missing');
        if (validateViaValidation !== validateWorkspaceConfig) throw new Error('validation entrypoint drifted from schema entrypoint');
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
          version: '1.0.0',
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
        if ((validReportResult.valid ?? validReportResult.ok) !== true) {
          throw new Error('installed validator rejected valid reports');
        }
        let invalidReportResult = validateWorkspaceConfig({
          ...validReportConfig,
          version: '0.0.0',
        });
        if ((invalidReportResult.valid ?? invalidReportResult.ok) === true) {
          throw new Error('installed validator accepted invalid workspace version');
        }
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
        if (rootModuleCapabilitySchemaVersion !== '0.2.0') {
          throw new Error('root MODULE_CAPABILITY_SCHEMA_VERSION export missing');
        }
        if (browserModuleCapabilitySchemaVersion !== '0.2.0') {
          throw new Error('browser MODULE_CAPABILITY_SCHEMA_VERSION export missing');
        }
        if (pluginModuleCapabilitySchemaVersion !== '0.2.0') {
          throw new Error('plugins MODULE_CAPABILITY_SCHEMA_VERSION export missing');
        }
        if (schemaModuleCapabilitySchemaVersion !== '0.2.0') {
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
          version: '1.0.0',
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
        'construction-template-list',
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
          createWorkspaceConstructionHandoff,
          createHostIntegrationContract,
          createWorkspacePackageConstructionContext,
          exportWorkspacePackage,
          importWorkspacePackage,
        } from 'symbiote-workspace/sharing';

        let session = createSession();
        let dispatchMutation = (toolName, args, targetSession) => dispatch(
          toolName,
          { ...args, baseRevision: targetSession.revision ?? 0 },
          targetSession,
        );
        let modulePackage = 'acme-review-pack';
        let cloneJson = (value) => JSON.parse(JSON.stringify(value));
        let targetModuleId = (tagName) => modulePackage + ':' + tagName;
        let hostCommandAction = (id, label, command) => ({
          id,
          label,
          does: { kind: 'command', scope: 'host', command }
        });
        let panelLeaf = (panel) => ({ type: 'panel', id: panel + '-node', panel });
        let splitNode = (id, direction, ratio, first, second) => ({ type: 'split', id, direction, ratio, first, second });
        let targetPanel = (tagName, title, icon) => ({ module: targetModuleId(tagName), title, icon });
        function targetModule(tagName, capabilities, options = {}) {
          return {
            id: targetModuleId(tagName),
            source: { kind: 'package', package: modulePackage },
            tagName,
            provider: modulePackage,
            capabilities,
            hostServices: { required: [], optional: [] },
            ...options
          };
        }
        function requiredHostServicesFor(modules) {
          let services = [];
          for (let module of modules) {
            for (let service of module.hostServices?.required || []) services.push(service);
          }
          return [...new Set(services)].sort((a, b) => a.localeCompare(b));
        }
        function targetTemplateConfig({ name, panels, layout, modules }) {
          return {
            version: '1.0.0',
            name,
            register: 'agent-workspace',
            views: [{ id: 'live', title: 'Live', icon: 'video_call', layout: { $layout: 'main' } }],
            panels,
            layouts: { main: { kind: 'bsp', root: layout } },
            modules,
            requires: {
              packages: [{ id: modulePackage, version: '^1.0.0' }],
              hostServices: { required: requiredHostServicesFor(modules), optional: [] }
            }
          };
        }
        function labelText(value, fallback = '') {
          if (typeof value === 'string') return value;
          if (value?.default) return value.default;
          if (value?.$t) return value.$t;
          return fallback;
        }
        function legacyLayoutNode(node) {
          if (!node) return null;
          if (node.type === 'panel') return { type: 'panel', panelType: node.panel };
          if (node.type === 'split') {
            return {
              type: 'split',
              direction: node.direction,
              ratio: node.ratio,
              first: legacyLayoutNode(node.first),
              second: legacyLayoutNode(node.second)
            };
          }
          return cloneJson(node);
        }
        function constructorTemplateConfig(config) {
          let modules = config.modules || [];
          let modulesById = new Map(modules.map((module) => [module.id, module]));
          let layouts = Object.fromEntries(
            Object.entries(config.layouts || {})
              .map(([id, layout]) => [id, legacyLayoutNode(layout.root || layout)])
              .filter(([, layout]) => layout)
          );
          let firstView = config.views?.[0];
          let defaultLayoutId = firstView?.layout?.$layout || Object.keys(layouts)[0];
          return {
            version: config.version,
            name: config.name,
            register: config.register,
            groups: (config.nav?.groups || []).map((group) => ({
              id: group.id,
              name: labelText(group.title, group.id),
              icon: group.icon,
              ...(group.order !== undefined ? { order: group.order } : {})
            })),
            sections: (config.views || []).map((view) => ({
              id: view.id,
              label: labelText(view.title, view.id),
              icon: view.icon,
              order: view.nav?.order ?? 0,
              groupId: view.nav?.group,
              layoutId: view.layout?.$layout || defaultLayoutId
            })),
            panelTypes: Object.fromEntries(
              Object.entries(config.panels || {}).map(([panelType, panel]) => {
                let module = modulesById.get(panel.module) || {};
                return [panelType, {
                  title: labelText(panel.title, panelType),
                  icon: panel.icon,
                  component: module.tagName || panel.module
                }];
              })
            ),
            ...(defaultLayoutId && layouts[defaultLayoutId] ? { layout: cloneJson(layouts[defaultLayoutId]) } : {}),
            ...(Object.keys(layouts).length ? { layouts } : {}),
            components: {
              catalog: modules.map((module) => module.tagName).filter(Boolean),
              modules: cloneJson(modules)
            }
          };
        }
        function constructorWorkspaceTemplates(templates) {
          return templates.map((template) => ({
            ...template,
            config: constructorTemplateConfig(template.config)
          }));
        }
        function collectDeletedTemplateConfigKeyPaths(config) {
          let paths = [];
          for (let key of ['groups', 'sections', 'panelTypes', 'layout']) {
            if (Object.hasOwn(config, key)) paths.push(key);
          }
          if (Object.hasOwn(config.components || {}, 'catalog')) paths.push('components.catalog');
          if (Object.hasOwn(config.components || {}, 'modules')) paths.push('components.modules');
          function visit(value, path = '') {
            if (Array.isArray(value)) {
              value.forEach((item, index) => visit(item, path + '[' + index + ']'));
              return;
            }
            if (!value || typeof value !== 'object') return;
            for (let [key, child] of Object.entries(value)) {
              let childPath = path ? path + '.' + key : key;
              if (key === 'requiredHostServices') paths.push(childPath);
              visit(child, childPath);
            }
          }
          visit(config);
          return paths;
        }
        function assertNoDeletedTemplateConfigKeys(templates) {
          for (let template of templates) {
            let paths = collectDeletedTemplateConfigKeyPaths(template.config);
            if (paths.length) {
              throw new Error(template.name + ' uses deleted config keys: ' + paths.join(', '));
            }
          }
        }
        let plugin = {
          name: 'acme.review',
          version: '1.0.0',
          contributes: {
            modules: [
              {
                id: 'acme.review:sentiment',
                tagName: 'acme-sentiment-panel',
                provider: 'acme-review-pack',
                capabilities: ['analysis.sentiment'],
                hostServices: { required: ['storage.project'] },
                placement: {
                  panelType: 'sentiment',
                  title: 'Sentiment',
                  icon: 'sentiment_satisfied'
                }
              }
            ],
            templates: [
              {
                name: 'sentiment-review-room',
                description: 'Sentiment review room.',
                config: {
                  version: '1.0.0',
                  name: 'Sentiment Review Room',
                  register: 'agent-workspace'
                }
              },
              {
                name: 'voice-video-room',
                description: 'Portable voice and video AI room.',
                config: targetTemplateConfig({
                  name: 'Voice Video Room',
                  panels: {
                    stage: targetPanel('room-media-stage', 'Stage', 'video_call'),
                    command: targetPanel('room-command-panel', 'Command', 'terminal')
                  },
                  layout: splitNode('live-root', 'horizontal', 0.7, panelLeaf('stage'), panelLeaf('command')),
                  modules: [
                    targetModule('room-media-stage', ['room.video', 'room.audio', 'media.realtime'], {
                      runtimeSlots: [{ id: 'media-session', role: 'provider', required: true }],
                      hostServices: { required: ['media.realtime', 'presence.session'], optional: [] }
                    }),
                    targetModule('room-command-panel', ['room.command', 'agent.command-input'], {
                      actions: [hostCommandAction('send-command', 'Send', 'agent.command.send')],
                      runtimeSlots: [{ id: 'agent-runtime', role: 'provider', required: true }],
                      hostServices: { required: ['agent.runtime'], optional: [] }
                    })
                  ]
                })
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
        if (pluginTemplates.templates[0].source.plugin !== 'acme.review') {
          throw new Error('workspace template source metadata missing');
        }
        assertNoDeletedTemplateConfigKeys(pluginTemplates.templates);
        let constructorTemplates = constructorWorkspaceTemplates(pluginTemplates.templates);
        let roomPlan = planWorkspaceConstruction({
          brief: 'sentiment review room',
          template: 'sentiment-review-room'
        }, {
          workspaceTemplates: constructorTemplates
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
          workspaceTemplates: constructorTemplates
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
        let registered = registerPlugin({
          name: 'acme.active',
          version: '1.0.0',
          contributes: {},
        });
        if (!registered.ok) throw new Error(JSON.stringify(registered.errors));
        let activated = await activatePlugin('acme.active');
        if (!activated.ok) throw new Error(activated.error || 'active plugin activation failed');
        let activeTemplates = listPluginWorkspaceTemplates({ status: 'active' });
        if (!activeTemplates.ok) {
          throw new Error(JSON.stringify(activeTemplates));
        }

        let planned = await dispatch('construction_plan', {
          intent: 'sentiment review workspace',
          template: 'dashboard',
          requiredCapabilities: ['analysis.sentiment'],
          moduleCapabilities: pluginCapabilities.moduleCapabilities,
        }, session);
        if (planned.status !== 'ok') {
          throw new Error(planned.hint || 'construction_plan failed');
        }
        if (session.config !== null) {
          throw new Error('construction_plan mutated consumer session config');
        }
        if (planned.plan.answers.moduleSelection[0] !== 'sentiment') {
          throw new Error('construction_plan did not select plugin-derived module');
        }
        if (JSON.stringify(planned.verification) !== JSON.stringify(planned.plan.verification)) {
          throw new Error('construction_plan did not expose top-level verification');
        }
        if (!Array.isArray(planned.verification.reports) || planned.verification.reports.length === 0) {
          throw new Error('construction_plan did not expose verification reports');
        }

        let constructed = await dispatchMutation('construction_construct', {
          intent: 'sentiment review workspace',
          template: 'dashboard',
          requiredCapabilities: ['analysis.sentiment'],
          moduleCapabilities: pluginCapabilities.moduleCapabilities,
        }, session);
        if (constructed.status !== 'ok') {
          throw new Error(constructed.hint || 'construction_construct failed');
        }
        if (constructed.plan.answers.moduleSelection[0] !== 'sentiment') {
          throw new Error('plugin-derived module was not selected');
        }
        if (JSON.stringify(constructed.verification) !== JSON.stringify(constructed.plan.verification)) {
          throw new Error('construction_construct did not expose top-level verification');
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
        let exported = await dispatch('config_export', { strict: true }, session);
        if (exported.status !== 'ok') {
          throw new Error(exported.hint || 'config_export failed');
        }
        let packageExport = exportWorkspacePackage(session.config, {
          id: 'constructed-report-package',
          version: '1.0.0',
        });
        if (!packageExport.json) throw new Error(JSON.stringify(packageExport.errors));
        let packageContext = createWorkspacePackageConstructionContext(packageExport.json, {
          templateName: 'constructed-report-package',
        });
        if (!packageContext.ready) throw new Error(JSON.stringify(packageContext.readiness));
        let packageHandoff = createWorkspaceConstructionHandoff(packageContext, {
          brief: 'Build from the packed consumer package.',
          template: packageContext.workspaceTemplates[0].name,
        });
        if (!packageHandoff.ready) throw new Error(JSON.stringify(packageHandoff.readiness));
        let handoffSession = createSession();
        let handoffPlan = await dispatch('construction_plan', packageHandoff, handoffSession);
        if (handoffPlan.status !== 'ok') throw new Error(handoffPlan.hint || 'package handoff plan failed');
        if (handoffSession.config !== null) throw new Error('package handoff plan mutated session config');
        if (!handoffPlan.readiness?.ready) throw new Error('package handoff plan did not expose ready top-level readiness');
        if (handoffPlan.readiness.source.packageId !== 'constructed-report-package') {
          throw new Error('package handoff plan readiness source missing package id');
        }
        if (JSON.stringify(handoffPlan.verification) !== JSON.stringify(handoffPlan.plan.verification)) {
          throw new Error('package handoff plan did not expose top-level verification');
        }
        let handoffConstruct = await dispatchMutation('construction_construct', packageHandoff, handoffSession);
        if (handoffConstruct.status !== 'ok') throw new Error(handoffConstruct.hint || 'package handoff construct failed');
        if (!handoffConstruct.readiness?.ready) throw new Error('package handoff construct did not expose ready top-level readiness');
        if (JSON.stringify(handoffConstruct.verification) !== JSON.stringify(handoffConstruct.plan.verification)) {
          throw new Error('package handoff construct did not expose top-level verification');
        }
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

      let subpathResponses = await mcpSession(process.execPath, [
        '--input-type=module',
        '-e',
        "import('symbiote-workspace/mcp')",
      ], [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ], 5000, withNpmEnv({ cwd: consumerDir }, npmEnv));
      let subpathToolList = subpathResponses.find((response) => response.id === 2);
      assert.ok(subpathToolList);
      assert.equal(subpathToolList.result.tools.length, TOOLS.length);
      assert.deepEqual(
        subpathToolList.result.tools.map((tool) => tool.name).sort(),
        [...expectedTools.keys()].sort(),
      );

      // Workspace package: public export availability from sharing + root entry points
      await runNode(consumerDir, `
        import {
          exportWorkspacePackage,
          importWorkspacePackage,
          validateWorkspacePackage,
          BROWSER_REQUIRED_IMPORTS,
          BROWSER_ENGINE_CONTRACTS_IMPORT,
          BROWSER_ENGINE_IMPORT,
          BROWSER_THEME_IMPORT,
          createBrowserRuntimeContract,
          createWorkspaceConstructionHandoff,
          createWorkspacePackageConstructionContext,
          createWorkspacePackagesConstructionContext,
          inspectWorkspacePackage,
          prepareConstructionIntentWithPackageContext,
          WORKSPACE_PACKAGE_KIND,
          WORKSPACE_PACKAGE_SCHEMA_VERSION,
        } from 'symbiote-workspace/sharing';

        if (typeof exportWorkspacePackage !== 'function') throw new Error('exportWorkspacePackage not exported');
        if (typeof importWorkspacePackage !== 'function') throw new Error('importWorkspacePackage not exported');
        if (typeof validateWorkspacePackage !== 'function') throw new Error('validateWorkspacePackage not exported');
        if (!Array.isArray(BROWSER_REQUIRED_IMPORTS)) throw new Error('BROWSER_REQUIRED_IMPORTS not exported from sharing');
        if (!BROWSER_REQUIRED_IMPORTS.includes('symbiote-workspace/browser')) {
          throw new Error('BROWSER_REQUIRED_IMPORTS missing browser entrypoint');
        }
        if (BROWSER_THEME_IMPORT !== 'symbiote-ui/ui') {
          throw new Error('BROWSER_THEME_IMPORT mismatch');
        }
        if (BROWSER_ENGINE_IMPORT !== 'symbiote-engine') {
          throw new Error('BROWSER_ENGINE_IMPORT mismatch');
        }
        if (BROWSER_ENGINE_CONTRACTS_IMPORT !== 'symbiote-engine/contracts') {
          throw new Error('BROWSER_ENGINE_CONTRACTS_IMPORT mismatch');
        }
        if (!BROWSER_REQUIRED_IMPORTS.includes(BROWSER_THEME_IMPORT)) {
          throw new Error('BROWSER_REQUIRED_IMPORTS missing theme entrypoint');
        }
        if (!BROWSER_REQUIRED_IMPORTS.includes(BROWSER_ENGINE_CONTRACTS_IMPORT)) {
          throw new Error('BROWSER_REQUIRED_IMPORTS missing engine contracts entrypoint');
        }
        if (typeof createBrowserRuntimeContract !== 'function') {
          throw new Error('createBrowserRuntimeContract not exported from sharing');
        }
        if (createBrowserRuntimeContract().entrypoint !== 'symbiote-workspace/browser') {
          throw new Error('createBrowserRuntimeContract entrypoint mismatch');
        }
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
        if (typeof prepareConstructionIntentWithPackageContext !== 'function') {
          throw new Error('prepareConstructionIntentWithPackageContext not exported from sharing');
        }
        if (WORKSPACE_PACKAGE_KIND !== 'symbiote-workspace-package') throw new Error('WORKSPACE_PACKAGE_KIND mismatch');
        if (WORKSPACE_PACKAGE_SCHEMA_VERSION !== '0.1.0') throw new Error('WORKSPACE_PACKAGE_SCHEMA_VERSION mismatch');

        let root = await import('symbiote-workspace');
        if (typeof root.exportWorkspacePackage !== 'function') throw new Error('root exportWorkspacePackage missing');
        if (typeof root.importWorkspacePackage !== 'function') throw new Error('root importWorkspacePackage missing');
        if (typeof root.validateWorkspacePackage !== 'function') throw new Error('root validateWorkspacePackage missing');
        if (!Array.isArray(root.BROWSER_REQUIRED_IMPORTS)) throw new Error('root BROWSER_REQUIRED_IMPORTS missing');
        if (root.BROWSER_THEME_IMPORT !== 'symbiote-ui/ui') {
          throw new Error('root BROWSER_THEME_IMPORT missing');
        }
        if (root.BROWSER_ENGINE_CONTRACTS_IMPORT !== 'symbiote-engine/contracts') {
          throw new Error('root BROWSER_ENGINE_CONTRACTS_IMPORT missing');
        }
        if (typeof root.createBrowserRuntimeContract !== 'function') {
          throw new Error('root createBrowserRuntimeContract missing');
        }
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
        if (typeof root.prepareConstructionIntentWithPackageContext !== 'function') {
          throw new Error('root prepareConstructionIntentWithPackageContext missing');
        }

        let browser = await import('symbiote-workspace/browser');
        if (!Array.isArray(browser.BROWSER_REQUIRED_IMPORTS)) throw new Error('browser BROWSER_REQUIRED_IMPORTS missing');
        if (browser.BROWSER_THEME_IMPORT !== 'symbiote-ui/ui') {
          throw new Error('browser BROWSER_THEME_IMPORT missing');
        }
        if (browser.BROWSER_ENGINE_CONTRACTS_IMPORT !== 'symbiote-engine/contracts') {
          throw new Error('browser BROWSER_ENGINE_CONTRACTS_IMPORT missing');
        }
        if (typeof browser.createBrowserRuntimeContract !== 'function') {
          throw new Error('browser createBrowserRuntimeContract missing');
        }
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
        if (typeof browser.prepareConstructionIntentWithPackageContext !== 'function') {
          throw new Error('browser prepareConstructionIntentWithPackageContext missing');
        }

        let prepared = prepareConstructionIntentWithPackageContext({
          requiredCapabilities: ['room.command']
        }, {
          valid: true,
          requiredCapabilities: ['agent.runtime', 'room.command']
        });
        if (JSON.stringify(prepared.requiredCapabilities) !== JSON.stringify(['agent.runtime', 'room.command'])) {
          throw new Error('prepareConstructionIntentWithPackageContext capability merge drifted');
        }
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
          version: '1.0.0',
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
          version: '1.0.0',
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

        let authKey = ['to', 'ken'].join('');
        let privateKey = ['se', 'cret'].join('');
        let sessionKey = ['ses', 'sion'].join('');
        let authManifest = {
          id: 'auth-package',
          version: '1.0.0',
          [authKey]: 'fixture-auth-value',
          [privateKey]: 'fixture-private-value',
          [sessionKey]: 'abc-session-id',
        };

        let result2 = exportWorkspacePackage(config, authManifest);
        if (result2.json !== null) throw new Error('should reject auth state');
        if (!result2.errors.some(e => e.path === \`manifest.\${authKey}\`)) throw new Error('missing auth error');
        if (!result2.errors.some(e => e.path === \`manifest.\${privateKey}\`)) throw new Error('missing private error');
        if (!result2.errors.some(e => e.path === \`manifest.\${sessionKey}\`)) throw new Error('missing session error');
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
          version: '1.0.0',
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
        if (handoff._type !== 'workspace-construction-handoff') {
          throw new Error('handoff _type sentinel missing');
        }
        let plan = planWorkspaceConstruction(handoff.intent, handoff.options);
        if (plan.plan.capabilities.missing.length !== 0) {
          throw new Error('package-derived constructor context did not cover review.queue');
        }
      `);
    });
  });
});
