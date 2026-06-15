import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BROWSER_REQUIRED_IMPORTS,
  createBrowserRuntimeContract,
  createWorkspaceConstructionHandoff,
  createWorkspacePackageConstructionContext,
  createWorkspacePackagesConstructionContext,
  exportWorkspacePackage,
  exportConfig,
  importWorkspacePackage,
  importConfig,
  inspectWorkspacePackage,
  diffConfigs,
  mergeConfigs,
  prepareConstructionIntentWithPackageContext,
  validateWorkspacePackage,
} from '../sharing/index.js';

import { matchTemplate, planWorkspaceConstruction } from '../constructor/index.js';

let BASE_CONFIG = {
  version: '0.2.0',
  name: 'Test Workspace',
  register: 'tool',
  theme: {
    params: { mode: 'dark', hue: 220 },
    overrides: { '--sn-gap': '8px' },
  },
  layout: {
    type: 'panel',
    panelType: 'main',
  },
  components: {
    catalog: ['sn-panel'],
    custom: [{ tagName: 'my-widget', code: 'class X {}' }],
  },
};

let VERIFICATION_REPORTS = [{
  id: 'theme-check',
  check: 'theme',
  status: 'warn',
  severity: 'warning',
  message: 'Contrast fallback required.',
}];

let EXTENDED_CONFIG = {
  ...BASE_CONFIG,
  theme: {
    ...BASE_CONFIG.theme,
    relations: { surfaceStep: 1.15 },
    subtrees: [{
      selector: '.sidebar',
      params: { hue: 180 },
      relations: { radiusScale: 0.8 },
      overrides: { '--sn-node-radius': '4px' },
    }],
  },
  construction: {
    intent: {
      brief: 'Build a media studio.',
      targetRegister: 'tool',
    },
    plan: {
      layoutTemplate: 'video-studio',
      modules: [{ id: 'viewport', role: 'preview' }],
      verification: {
        reports: VERIFICATION_REPORTS,
      },
    },
  },
  validation: {
    reports: VERIFICATION_REPORTS,
  },
};

let PACKAGE_CONFIG = {
  ...EXTENDED_CONFIG,
  components: {
    catalog: ['sn-panel', 'ai-command-composer'],
    modules: [{
      tagName: 'ai-command-composer',
      schemaVersion: '0.1.0',
      provider: 'portable-command-room-pack',
      descriptor: {
        schemaVersion: '0.1.0',
        package: '@acme/command-room-pack',
        component: 'ai-command-composer',
      },
      capabilities: ['room.command'],
      requiredHostServices: ['agent.runtime', 'storage.project'],
      runtimeSlots: [{ id: 'agent-runtime', role: 'command-router', required: true }],
    }],
  },
};

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map((item) => reverseObjectKeys(item));
  if (value && typeof value === 'object') {
    let reversed = {};
    for (let [key, nested] of Object.entries(value).reverse()) {
      reversed[key] = reverseObjectKeys(nested);
    }
    return reversed;
  }
  return value;
}

describe('createBrowserRuntimeContract', () => {
  it('returns host-neutral browser import-map metadata', () => {
    let contract = createBrowserRuntimeContract();

    assert.deepEqual(contract.requiredImports, [...BROWSER_REQUIRED_IMPORTS]);
    assert.equal(contract.importMap.required, true);
    assert.equal(contract.importMap.scriptType, 'importmap');
    assert.equal(contract.importMap.mustLoadBeforeModuleScript, true);
    assert.deepEqual(contract.importMap.unsupportedContexts, ['workers', 'worklets']);
    assert.doesNotMatch(JSON.stringify(contract), /https?:|file:\/\/|\/Users\//);
  });
});

describe('exportConfig', () => {
  it('exports valid config as JSON', () => {
    let result = exportConfig(BASE_CONFIG);
    assert.ok(result.json);
    assert.equal(result.errors.length, 0);
    let parsed = JSON.parse(result.json);
    assert.equal(parsed.name, 'Test Workspace');
  });

  it('rejects invalid config', () => {
    let result = exportConfig({ name: 'No version' });
    assert.equal(result.json, null);
    assert.ok(result.errors.length > 0);
  });

  it('strict mode rejects portability warnings', () => {
    let config = { ...BASE_CONFIG, data: { apiKey: 'secret123' } };
    let result = exportConfig(config, { strict: true });
    assert.equal(result.json, null);
    assert.ok(result.errors.length > 0);
  });

  it('strict mode rejects generic server URLs before sanitizing output', () => {
    let result = exportConfig({
      ...BASE_CONFIG,
      components: {
        ...BASE_CONFIG.components,
        catalog: ['https://cdn.example.com/sn-panel.js'],
      },
    }, { strict: true });

    assert.equal(result.json, null);
    assert.ok(result.errors.some((error) => error.path === 'components.catalog[0]'));
  });

  it('strict mode rejects user identity fields before sanitizing output', () => {
    let result = exportConfig({
      ...BASE_CONFIG,
      runtime: {
        userId: 'user-123',
        accountId: 'account-456',
        profile: { email: 'owner@example.com' },
      },
    }, { strict: true });

    assert.equal(result.json, null);
    assert.ok(result.errors.some((error) => error.path === 'runtime.userId'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.accountId'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.profile'));
  });

  it('strict mode rejects normalized host-only and local fields before sanitizing output', () => {
    let result = exportConfig({
      ...BASE_CONFIG,
      runtime: {
        server_url: 'prod-primary',
        workspace_root: 'local-checkout',
        file_path: 'private-config',
        apiEndpoint: 'internal-api',
      },
    }, { strict: true });

    assert.equal(result.json, null);
    assert.ok(result.errors.some((error) => error.path === 'runtime.server_url'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.workspace_root'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.file_path'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.apiEndpoint'));
  });

  it('preserves construction metadata, validation reports, and theme relations', () => {
    let result = exportConfig(EXTENDED_CONFIG);
    assert.ok(result.json);
    let parsed = JSON.parse(result.json);
    assert.equal(parsed.theme.relations.surfaceStep, 1.15);
    assert.equal(parsed.theme.subtrees[0].relations.radiusScale, 0.8);
    assert.equal(parsed.construction.plan.layoutTemplate, 'video-studio');
    assert.deepEqual(parsed.construction.plan.verification.reports, VERIFICATION_REPORTS);
    assert.deepEqual(parsed.validation.reports, VERIFICATION_REPORTS);
  });

  it('strips host-only and local data from exported packages', () => {
    let result = exportConfig({
      ...EXTENDED_CONFIG,
      host: {
        endpoint: 'https://internal.example.com',
        sessionId: 'abc123',
      },
      construction: {
        ...EXTENDED_CONFIG.construction,
        plan: {
          ...EXTENDED_CONFIG.construction.plan,
          localFile: '/Users/tester/workspace/private.json',
          previewUrl: 'file:///tmp/preview.html',
        },
      },
    });

    assert.ok(result.json);
    let parsed = JSON.parse(result.json);
    assert.equal(parsed.host, undefined);
    assert.equal(parsed.construction.plan.localFile, undefined);
    assert.equal(parsed.construction.plan.previewUrl, undefined);
    assert.equal(parsed.construction.plan.layoutTemplate, 'video-studio');
  });

  it('strips normalized host-only fields while preserving portable module binding paths', () => {
    let result = exportConfig({
      ...PACKAGE_CONFIG,
      runtime: {
        server_url: 'prod-primary',
        workspace_root: 'local-checkout',
        path: 'data.runtime',
      },
      components: {
        ...PACKAGE_CONFIG.components,
        modules: [{
          ...PACKAGE_CONFIG.components.modules[0],
          bindings: [{ id: 'rows', direction: 'input', path: 'data.rows' }],
        }],
      },
    });

    assert.ok(result.json);
    let parsed = JSON.parse(result.json);
    assert.equal(parsed.runtime.server_url, undefined);
    assert.equal(parsed.runtime.workspace_root, undefined);
    assert.equal(parsed.runtime.path, 'data.runtime');
    assert.equal(parsed.components.modules[0].bindings[0].path, 'data.rows');
  });
});

describe('workspace package portability', () => {
  it('exports config, manifest, host contract, dependencies, and permissions', () => {
    let packageConfig = {
      ...PACKAGE_CONFIG,
      engine: {
        packs: ['command-pack'],
        graphs: [{
          id: 'main',
          nodes: [
            { id: 'route-command', type: 'agent/route' },
            { id: 'sync-draft', type: 'state/sync' },
          ],
          connections: [],
        }],
        bindings: [
          {
            id: 'command-action-run',
            panelType: 'command',
            component: 'ai-command-composer',
            surface: 'action',
            sourceId: 'run',
            graphId: 'main',
            nodeId: 'route-command',
            input: 'prompt',
            pack: 'command-pack',
          },
          {
            id: 'command-state-draft',
            panelType: 'command',
            component: 'ai-command-composer',
            surface: 'state',
            sourceId: 'draft',
            graphId: 'main',
            nodeId: 'sync-draft',
          },
        ],
      },
    };
    let result = exportWorkspacePackage(packageConfig, {
      id: 'command-room-package',
      version: '1.2.3',
      description: 'Portable command room package.',
      tags: ['room.command', 'agent.workspace'],
      permissions: ['agent.runtime', 'storage.project'],
      dependencies: {
        plugins: ['@acme/command-room-pack'],
        packages: ['symbiote-ui'],
      },
      assets: {
        docs: ['docs/command-room.md'],
        examples: ['examples/command-room.json'],
        previews: ['previews/command-room.png'],
      },
    });

    assert.ok(result.json);
    assert.deepEqual(result.errors, []);
    assert.equal(result.package.kind, 'symbiote-workspace-package');
    assert.equal(result.package.manifest.id, 'command-room-package');
    assert.equal(result.package.manifest.name, 'Test Workspace');
    assert.equal(result.package.manifest.compatibility.workspaceSchema, '0.2.0');
    assert.deepEqual(result.package.manifest.tags, ['agent.workspace', 'room.command']);
    assert.deepEqual(result.package.manifest.permissions, ['agent.runtime', 'storage.project']);
    assert.deepEqual(result.package.manifest.dependencies.components, [
      'ai-command-composer',
      'sn-panel',
    ]);
    assert.deepEqual(result.package.manifest.dependencies.plugins, [
      '@acme/command-room-pack',
      'portable-command-room-pack',
    ]);
    assert.deepEqual(result.package.manifest.dependencies.packages, ['symbiote-ui']);
    assert.deepEqual(result.package.host.contract.services.required, [
      'agent.runtime',
      'storage.project',
    ]);
    assert.deepEqual(result.package.host.contract.engine, {
      packs: ['command-pack'],
      graphs: [{ id: 'main', nodes: 2, connections: 0 }],
      bindings: [
        {
          id: 'command-action-run',
          panelType: 'command',
          surface: 'action',
          sourceId: 'run',
          graphId: 'main',
          nodeId: 'route-command',
        },
        {
          id: 'command-state-draft',
          panelType: 'command',
          surface: 'state',
          sourceId: 'draft',
          graphId: 'main',
          nodeId: 'sync-draft',
        },
      ],
    });
    assert.equal(result.package.workspace.config.name, 'Test Workspace');
    assert.doesNotMatch(JSON.stringify(result.package), /https?:|file:\/\/|\/Users\//);
  });

  it('imports exported workspace packages with strict config validation', () => {
    let reports = [{
      id: 'package-host-readiness',
      check: 'package-readiness',
      status: 'warn',
      severity: 'warning',
      message: 'Package host capability requires review.',
    }];
    let reportedConfig = {
      ...PACKAGE_CONFIG,
      construction: {
        ...PACKAGE_CONFIG.construction,
        plan: {
          ...PACKAGE_CONFIG.construction.plan,
          verification: { reports },
        },
      },
      validation: { reports },
    };
    let exported = exportWorkspacePackage(reportedConfig, {
      id: 'command-room-package',
      version: '1.2.3',
    });
    let imported = importWorkspacePackage(exported.json);

    assert.ok(imported.package);
    assert.ok(imported.config);
    assert.deepEqual(imported.errors, []);
    assert.equal(imported.package.manifest.id, 'command-room-package');
    assert.equal(imported.config.name, 'Test Workspace');
    assert.deepEqual(imported.package.workspace.config.construction.plan.verification.reports, reports);
    assert.deepEqual(imported.config.construction.plan.verification.reports, reports);
    assert.deepEqual(imported.config.validation.reports, reports);
  });

  it('rejects non-portable package metadata and marketplace service state', () => {
    let result = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
      dependencies: { plugins: ['https://example.com/plugin.js'] },
      marketplace: {
        price: '9.00',
        sellerId: 'seller-123',
      },
      licenseServer: 'https://licenses.example.com',
    });

    assert.equal(result.json, null);
    assert.ok(result.errors.some((error) => error.path === 'manifest.dependencies.plugins[0]'));
    assert.ok(result.errors.some((error) => error.path === 'manifest.marketplace'));
    assert.ok(result.errors.some((error) => error.path === 'manifest.licenseServer'));
  });

  it('returns deep-cloned package data', () => {
    let result = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
    });

    result.package.workspace.config.name = 'Mutated';
    assert.equal(PACKAGE_CONFIG.name, 'Test Workspace');
  });

  it('validates package objects before install', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
    });
    let validation = validateWorkspacePackage(exported.package);

    assert.equal(validation.valid, true);
    assert.deepEqual(validation.errors, []);

    let invalid = validateWorkspacePackage({
      ...exported.package,
      manifest: {
        ...exported.package.manifest,
        id: 'Command Room',
      },
    });

    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some((error) => error.path === 'manifest.id'));
  });

  it('returns structured errors when package host contract is missing', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'missing-host-package',
      version: '1.2.3',
    });
    let pkg = { ...exported.package };
    delete pkg.host;

    let validation = validateWorkspacePackage(pkg);

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((error) => error.path === 'host.contract'));
  });

  it('validates semantically equivalent host contracts with different key order', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'key-order-package',
      version: '1.2.3',
    });
    let pkg = {
      ...exported.package,
      host: {
        contract: reverseObjectKeys(exported.package.host.contract),
      },
    };

    let validation = validateWorkspacePackage(pkg);

    assert.equal(validation.valid, true);
    assert.deepEqual(validation.errors, []);
  });
});

describe('importConfig', () => {
  it('imports valid JSON', () => {
    let json = JSON.stringify(BASE_CONFIG);
    let result = importConfig(json);
    assert.ok(result.config);
    assert.equal(result.errors.length, 0);
    assert.equal(result.config.name, 'Test Workspace');
  });

  it('rejects invalid JSON', () => {
    let result = importConfig('not json');
    assert.equal(result.config, null);
    assert.ok(result.errors.length > 0);
  });

  it('rejects structurally invalid config', () => {
    let result = importConfig(JSON.stringify({ foo: 'bar' }));
    assert.equal(result.config, null);
  });

  it('preserves construction metadata, validation reports, and theme relations on import', () => {
    let result = importConfig(JSON.stringify(EXTENDED_CONFIG));
    assert.ok(result.config);
    assert.equal(result.config.theme.relations.surfaceStep, 1.15);
    assert.equal(result.config.theme.subtrees[0].relations.radiusScale, 0.8);
    assert.equal(result.config.construction.plan.layoutTemplate, 'video-studio');
    assert.equal(result.config.validation.reports[0].check, 'theme');
  });

  it('rejects imported host-only or local data', () => {
    let result = importConfig(JSON.stringify({
      ...EXTENDED_CONFIG,
      host: {
        endpoint: 'https://internal.example.com',
      },
      construction: {
        ...EXTENDED_CONFIG.construction,
        plan: {
          ...EXTENDED_CONFIG.construction.plan,
          localFile: '/Users/tester/workspace/private.json',
        },
      },
    }));

    assert.equal(result.config, null);
    assert.ok(result.errors.some((error) => error.path === 'host'));
    assert.ok(result.errors.some((error) => error.path === 'construction.plan.localFile'));
  });

  it('rejects generic server URLs and local absolute paths', () => {
    let result = importConfig(JSON.stringify({
      ...EXTENDED_CONFIG,
      components: {
        ...EXTENDED_CONFIG.components,
        catalog: [
          'sn-panel',
          'https://cdn.example.com/sn-panel.js',
          '/Users/tester/workspace/sn-panel.js',
        ],
      },
    }));

    assert.equal(result.config, null);
    assert.ok(result.errors.some((error) => error.path === 'components.catalog[1]'));
    assert.ok(result.errors.some((error) => error.path === 'components.catalog[2]'));
  });

  it('rejects user identity fields', () => {
    let result = importConfig(JSON.stringify({
      ...EXTENDED_CONFIG,
      runtime: {
        userId: 'user-123',
        accountId: 'account-456',
        profile: { email: 'owner@example.com' },
      },
    }));

    assert.equal(result.config, null);
    assert.ok(result.errors.some((error) => error.path === 'runtime.userId'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.accountId'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.profile'));
  });

  it('rejects normalized host-only and local fields', () => {
    let result = importConfig(JSON.stringify({
      ...EXTENDED_CONFIG,
      runtime: {
        server_url: 'prod-primary',
        workspace_root: 'local-checkout',
        file_path: 'private-config',
        apiEndpoint: 'internal-api',
      },
    }));

    assert.equal(result.config, null);
    assert.ok(result.errors.some((error) => error.path === 'runtime.server_url'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.workspace_root'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.file_path'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.apiEndpoint'));
  });
});

describe('diffConfigs', () => {
  it('returns empty for identical configs', () => {
    let diffs = diffConfigs(BASE_CONFIG, BASE_CONFIG);
    assert.equal(diffs.length, 0);
  });

  it('detects name change', () => {
    let modified = { ...BASE_CONFIG, name: 'Changed' };
    let diffs = diffConfigs(BASE_CONFIG, modified);
    assert.ok(diffs.some((d) => d.path === 'name' && d.type === 'changed'));
  });

  it('detects added field', () => {
    let modified = { ...BASE_CONFIG, data: { source: 'api' } };
    let diffs = diffConfigs(BASE_CONFIG, modified);
    assert.ok(diffs.some((d) => d.path === 'data' && d.type === 'added'));
  });

  it('detects removed field', () => {
    let { register, ...rest } = BASE_CONFIG;
    let diffs = diffConfigs(BASE_CONFIG, rest);
    assert.ok(diffs.some((d) => d.path === 'register' && d.type === 'removed'));
  });
});

describe('mergeConfigs', () => {
  it('overrides name', () => {
    let merged = mergeConfigs(BASE_CONFIG, { name: 'Merged' });
    assert.equal(merged.name, 'Merged');
  });

  it('merges theme params', () => {
    let merged = mergeConfigs(BASE_CONFIG, {
      theme: { params: { hue: 180, chroma: 50 } },
    });
    assert.equal(merged.theme.params.hue, 180);
    assert.equal(merged.theme.params.chroma, 50);
    assert.equal(merged.theme.params.mode, 'dark');
  });

  it('merges theme overrides', () => {
    let merged = mergeConfigs(BASE_CONFIG, {
      theme: { overrides: { '--sn-radius': '4px' } },
    });
    assert.equal(merged.theme.overrides['--sn-gap'], '8px');
    assert.equal(merged.theme.overrides['--sn-radius'], '4px');
  });

  it('merges theme relations', () => {
    let merged = mergeConfigs(BASE_CONFIG, {
      theme: { relations: { surfaceStep: 1.25 } },
    });
    assert.equal(merged.theme.relations.surfaceStep, 1.25);
  });

  it('replaces layout wholesale', () => {
    let newLayout = { type: 'panel', panelType: 'editor' };
    let merged = mergeConfigs(BASE_CONFIG, { layout: newLayout });
    assert.equal(merged.layout.type, 'panel');
    assert.equal(merged.layout.panelType, 'editor');
  });

  it('adds to component catalog', () => {
    let merged = mergeConfigs(BASE_CONFIG, {
      components: { catalog: ['sn-tree-panel'] },
    });
    assert.ok(merged.components.catalog.includes('sn-panel'));
    assert.ok(merged.components.catalog.includes('sn-tree-panel'));
  });

  it('merges custom components', () => {
    let merged = mergeConfigs(BASE_CONFIG, {
      components: { custom: [{ tagName: 'my-other', code: 'class Y {}' }] },
    });
    assert.equal(merged.components.custom.length, 2);
  });

  it('returns deep clone (no shared references)', () => {
    let merged = mergeConfigs(BASE_CONFIG, { name: 'Clone Test' });
    merged.theme.params.hue = 999;
    assert.notEqual(BASE_CONFIG.theme.params.hue, 999);
  });
});

describe('inspectWorkspacePackage', () => {
  it('returns valid inspection with summary, requirements, and compatibility for a valid package', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
      description: 'Portable command room package.',
      tags: ['room.command', 'agent.workspace'],
      permissions: ['agent.runtime', 'storage.project'],
      dependencies: {
        plugins: ['@acme/command-room-pack'],
        packages: ['symbiote-ui'],
      },
      assets: {
        docs: ['docs/command-room.md'],
        examples: ['examples/command-room.json'],
        previews: ['previews/command-room.png'],
      },
    });

    let inspection = inspectWorkspacePackage(exported.package);

    assert.equal(inspection.valid, true);
    assert.equal(inspection.ready, true);
    assert.ok(inspection.package);
    assert.ok(inspection.config);
    assert.deepEqual(inspection.errors, []);
    assert.deepEqual(inspection.warnings, []);
    assert.equal(inspection.summary.id, 'command-room-package');
    assert.equal(inspection.summary.name, 'Test Workspace');
    assert.equal(inspection.summary.version, '1.2.3');
    assert.equal(inspection.summary.schemaVersion, '0.1.0');
    assert.equal(inspection.summary.kind, 'symbiote-workspace-package');
    assert.equal(inspection.compatibility.compatible, true);
    assert.equal(inspection.compatibility.requiredMajor, '0');
    assert.equal(inspection.compatibility.packageMajor, '0');
    assert.equal(inspection.compatibility.workspaceSchema, '0.2.0');
    assert.deepEqual(inspection.requirements.components, ['ai-command-composer', 'sn-panel']);
    assert.deepEqual(inspection.requirements.plugins, [
      '@acme/command-room-pack',
      'portable-command-room-pack',
    ]);
    assert.deepEqual(inspection.requirements.packages, ['symbiote-ui']);
    assert.deepEqual(inspection.requirements.hostServices, [
      'agent.runtime',
      'storage.project',
    ]);
    assert.deepEqual(inspection.requirements.runtimeSlots, ['agent-runtime']);
    assert.deepEqual(inspection.missing?.components, []);
    assert.deepEqual(inspection.readiness, {
      ready: true,
      valid: true,
      source: null,
      sourceCount: 1,
      missingCount: 0,
      warningCount: 0,
      errorCount: 0,
      status: 'ready',
      nextAction: 'construct',
      summary: inspection.summary,
    });
  });

  it('accepts JSON string input', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
    });

    let inspection = inspectWorkspacePackage(exported.json);

    assert.equal(inspection.valid, true);
    assert.equal(inspection.ready, true);
    assert.ok(inspection.package);
    assert.ok(inspection.config);
    assert.equal(inspection.summary.id, 'command-room-package');
    assert.deepEqual(inspection.errors, []);
    assert.deepEqual(inspection.warnings, []);
  });

  it('rejects invalid JSON with errors and no throw', () => {
    let inspection = inspectWorkspacePackage('invalid json {{{');

    assert.equal(inspection.valid, false);
    assert.equal(inspection.ready, false);
    assert.equal(inspection.package, null);
    assert.equal(inspection.config, null);
    assert.ok(inspection.errors.length > 0);
    assert.match(inspection.errors[0].message, /Invalid JSON/);
  });

  it('rejects non-object input with no throw', () => {
    let inspection = inspectWorkspacePackage([1, 2, 3]);

    assert.equal(inspection.valid, false);
    assert.equal(inspection.ready, false);
    assert.equal(inspection.package, null);
    assert.equal(inspection.config, null);
    assert.ok(inspection.errors.some((e) => /must be an object/.test(e.message)));
  });

  it('rejects wrong package kind', () => {
    let inspection = inspectWorkspacePackage({
      kind: 'not-a-package',
      schemaVersion: '0.1.0',
      workspace: { config: {} },
    });

    assert.equal(inspection.valid, false);
    assert.ok(inspection.errors.some((e) => /kind must be/.test(e.message)));
  });

  it('rejects incompatible schema major version', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
    });

    let pkg = JSON.parse(exported.json);
    pkg.schemaVersion = '5.0.0';

    let inspection = inspectWorkspacePackage(pkg);

    assert.equal(inspection.valid, false);
    assert.ok(inspection.errors.some((e) => /Incompatible package schema major/.test(e.message)));
  });

  it('rejects marketplace state as errors', () => {
    let result = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
    });

    let pkg = JSON.parse(result.json);
    pkg.manifest.marketplace = {
      price: '9.00',
      sellerId: 'seller-123',
    };

    let inspection = inspectWorkspacePackage(pkg);

    assert.equal(inspection.valid, false);
    assert.ok(inspection.errors.some((e) => e.path === 'manifest.marketplace'));
  });

  it('rejects host contract mismatch', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
    });

    let pkg = JSON.parse(exported.json);
    pkg.host.contract.services.required.push('bogus.service');

    let inspection = inspectWorkspacePackage(pkg);

    assert.equal(inspection.valid, false);
    assert.ok(inspection.errors.some((e) =>
      /host.contract does not match/.test(e.message)
    ));
  });

  it('sets ready: false with warnings for missing available capabilities', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
      dependencies: {
        plugins: ['@acme/command-room-pack'],
        packages: ['symbiote-ui'],
      },
    });

    let inspection = inspectWorkspacePackage(exported.package, {
      available: {
        components: [],
        plugins: [],
        packages: [],
        hostServices: [],
        runtimeSlots: [],
      },
    });

    assert.equal(inspection.valid, true);
    assert.equal(inspection.ready, false);
    assert.ok(inspection.warnings.length > 0);
    assert.ok(inspection.warnings.some((w) => /missing.*capabilities/.test(w.message)));
    assert.ok(inspection.missing.components.length > 0);
    assert.ok(inspection.missing.plugins.length > 0);
    assert.ok(inspection.missing.packages.length > 0);
    assert.ok(inspection.missing.hostServices.length > 0);
    assert.ok(inspection.missing.runtimeSlots.length > 0);
  });

  it('sets ready: true when available capabilities cover all requirements', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
      dependencies: {
        plugins: ['@acme/command-room-pack'],
        packages: ['symbiote-ui'],
      },
    });

    let inspection = inspectWorkspacePackage(exported.package, {
      available: {
        components: ['sn-panel', 'ai-command-composer'],
        plugins: ['@acme/command-room-pack', 'portable-command-room-pack'],
        packages: ['symbiote-ui'],
        hostServices: ['agent.runtime', 'storage.project'],
        runtimeSlots: ['agent-runtime'],
      },
    });

    assert.equal(inspection.valid, true);
    assert.equal(inspection.ready, true);
    assert.deepEqual(inspection.warnings, []);
    assert.deepEqual(inspection.missing.components, []);
    assert.deepEqual(inspection.missing.plugins, []);
    assert.deepEqual(inspection.missing.packages, []);
    assert.deepEqual(inspection.missing.hostServices, []);
    assert.deepEqual(inspection.missing.runtimeSlots, []);
  });

  it('does not block readiness for missing optional runtime slots', () => {
    let optionalRuntimeConfig = {
      ...PACKAGE_CONFIG,
      components: {
        ...PACKAGE_CONFIG.components,
        modules: [{
          ...PACKAGE_CONFIG.components.modules[0],
          runtimeSlots: [{ id: 'optional-agent-runtime', role: 'provider' }],
        }],
      },
    };
    let exported = exportWorkspacePackage(optionalRuntimeConfig, {
      id: 'optional-runtime-package',
      version: '1.0.0',
    });

    let inspection = inspectWorkspacePackage(exported.package, {
      available: {
        components: ['sn-panel', 'ai-command-composer'],
        plugins: ['@acme/command-room-pack', 'portable-command-room-pack'],
        packages: [],
        hostServices: ['agent.runtime', 'storage.project'],
        runtimeSlots: [],
      },
    });

    assert.equal(inspection.valid, true);
    assert.equal(inspection.ready, true);
    assert.deepEqual(inspection.warnings, []);
    assert.deepEqual(inspection.requirements.runtimeSlots, []);
    assert.deepEqual(inspection.missing.runtimeSlots, []);
  });

  it('deep clones input and result (mutation-safe)', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
    });

    let inspection = inspectWorkspacePackage(exported.package);

    inspection.package.workspace.config.name = 'Mutated';
    assert.equal(exported.package.workspace.config.name, 'Test Workspace');

    let inspection2 = inspectWorkspacePackage(exported.package);
    inspection2.config.name = 'Mutated Again';
    assert.equal(exported.package.workspace.config.name, 'Test Workspace');
  });

  it('reports invalid workspace config as a blocking package error', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
    });

    let pkg = JSON.parse(exported.json);
    pkg.workspace.config.version = '';

    let inspection = inspectWorkspacePackage(pkg);

    assert.equal(inspection.valid, false);
    assert.ok(inspection.errors.some((e) => e.path.includes('version')));
    assert.equal(inspection.summary, null);
    assert.equal(inspection.requirements, null);
  });
});

describe('createWorkspacePackageConstructionContext', () => {
  let VALID_PACKAGE;

  async function ensurePackage() {
    if (VALID_PACKAGE) return VALID_PACKAGE;
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
      description: 'Portable command room package.',
      tags: ['room.command', 'agent.workspace'],
      permissions: ['agent.runtime', 'storage.project'],
      dependencies: {
        plugins: ['@acme/command-room-pack'],
        packages: ['symbiote-ui'],
      },
    });
    VALID_PACKAGE = exported;
    return exported;
  }

  it('returns valid context with workspaceTemplates, moduleCapabilities, and requiredCapabilities', async () => {
    let exported = await ensurePackage();
    let ctx = createWorkspacePackageConstructionContext(exported.package);

    assert.equal(ctx.valid, true);
    assert.equal(ctx.ready, true);
    assert.deepEqual(ctx.source, {
      type: 'workspace-package',
      packageId: 'command-room-package',
      packageName: 'Test Workspace',
      packageVersion: '1.2.3',
      packageSchemaVersion: '0.1.0',
      workspaceSchema: '0.2.0',
      templateName: 'pkg-command-room-package',
    });
    assert.deepEqual(ctx.errors, []);
    assert.deepEqual(ctx.warnings, []);

    assert.equal(ctx.workspaceTemplates.length, 1);
    let template = ctx.workspaceTemplates[0];
    assert.equal(typeof template.name, 'string');
    assert.ok(template.name.length > 0);
    assert.notEqual(template.name, 'chat');
    assert.notEqual(template.name, 'editor');
    assert.notEqual(template.name, 'graph');
    assert.notEqual(template.name, 'dashboard');
    assert.notEqual(template.name, 'admin');
    assert.deepEqual(template.source, {
      type: 'workspace-package',
      packageId: 'command-room-package',
      packageVersion: '1.2.3',
      packageSchemaVersion: '0.1.0',
    });
    assert.equal(typeof template.description, 'string');
    assert.ok(template.description.includes('Test Workspace'));
    assert.ok(template.config);
    assert.equal(template.config.name, 'Test Workspace');

    assert.equal(ctx.moduleCapabilities.length, 1);
    assert.equal(ctx.moduleCapabilities[0].tagName, 'ai-command-composer');
    assert.deepEqual(ctx.moduleCapabilities[0].capabilities, ['room.command']);

    assert.deepEqual(ctx.requiredCapabilities, []);

    assert.ok(ctx.summary);
    assert.equal(ctx.summary.id, 'command-room-package');
    assert.equal(ctx.readiness.status, 'ready');
    assert.equal(ctx.readiness.nextAction, 'construct');
    assert.equal(ctx.readiness.source.packageId, 'command-room-package');
    assert.ok(ctx.compatibility);
    assert.equal(ctx.compatibility.compatible, true);
    assert.ok(ctx.requirements);
    assert.ok(ctx.missing);
  });

  it('accepts JSON string input', async () => {
    let exported = await ensurePackage();
    let ctx = createWorkspacePackageConstructionContext(exported.json);

    assert.equal(ctx.valid, true);
    assert.equal(ctx.ready, true);
    assert.equal(ctx.source.type, 'workspace-package');
    assert.equal(ctx.workspaceTemplates.length, 1);
    assert.equal(ctx.moduleCapabilities.length, 1);
    assert.equal(ctx.summary.id, 'command-room-package');
  });

  it('returns empty constructor arrays for invalid package (wrong kind)', () => {
    let ctx = createWorkspacePackageConstructionContext({
      kind: 'not-a-package',
      schemaVersion: '0.1.0',
      workspace: { config: {} },
    });

    assert.equal(ctx.valid, false);
    assert.equal(ctx.ready, false);
    assert.equal(ctx.source, null);
    assert.deepEqual(ctx.workspaceTemplates, []);
    assert.deepEqual(ctx.moduleCapabilities, []);
    assert.deepEqual(ctx.requiredCapabilities, []);
    assert.ok(ctx.errors.length > 0);
    assert.ok(ctx.errors.some((e) => /kind must be/.test(e.message)));
  });

  it('returns empty constructor arrays for invalid JSON input', () => {
    let ctx = createWorkspacePackageConstructionContext('invalid json {{{');

    assert.equal(ctx.valid, false);
    assert.equal(ctx.ready, false);
    assert.equal(ctx.source, null);
    assert.deepEqual(ctx.workspaceTemplates, []);
    assert.deepEqual(ctx.moduleCapabilities, []);
    assert.deepEqual(ctx.requiredCapabilities, []);
    assert.ok(ctx.errors.length > 0);
    assert.match(ctx.errors[0].message, /Invalid JSON/);
  });

  it('returns empty constructor arrays for non-object input', () => {
    let ctx = createWorkspacePackageConstructionContext([1, 2, 3]);

    assert.equal(ctx.valid, false);
    assert.equal(ctx.ready, false);
    assert.deepEqual(ctx.workspaceTemplates, []);
    assert.deepEqual(ctx.moduleCapabilities, []);
    assert.deepEqual(ctx.requiredCapabilities, []);
  });

  it('still produces templates and capabilities when host availability gaps exist', async () => {
    let exported = await ensurePackage();
    let ctx = createWorkspacePackageConstructionContext(exported.package, {
      available: {
        components: [],
        plugins: [],
        packages: [],
        hostServices: [],
        runtimeSlots: [],
      },
    });

    assert.equal(ctx.valid, true);
    assert.equal(ctx.ready, false);
    assert.ok(ctx.warnings.length > 0);
    assert.ok(ctx.warnings.some((w) => /missing.*capabilities/.test(w.message)));

    assert.equal(ctx.workspaceTemplates.length, 1);
    assert.equal(ctx.moduleCapabilities.length, 1);
    assert.ok(ctx.missing.components.length > 0);
    assert.ok(ctx.missing.plugins.length > 0);
  });

  it('deep clones output and does not mutate source', async () => {
    let exported = await ensurePackage();
    let ctx = createWorkspacePackageConstructionContext(exported.package);

    ctx.workspaceTemplates[0].config.name = 'Mutated';
    ctx.moduleCapabilities[0].tagName = 'corrupted';
    ctx.workspaceTemplates[0].name = 'overwritten';

    assert.equal(exported.package.workspace.config.name, 'Test Workspace');

    let ctx2 = createWorkspacePackageConstructionContext(exported.package);
    assert.equal(ctx2.workspaceTemplates[0].config.name, 'Test Workspace');
    assert.equal(ctx2.moduleCapabilities[0].tagName, 'ai-command-composer');
  });

  it('accepts portable options.templateName and uses it', async () => {
    let exported = await ensurePackage();
    let ctx = createWorkspacePackageConstructionContext(exported.package, {
      templateName: 'command-room',
    });

    assert.equal(ctx.valid, true);
    assert.equal(ctx.workspaceTemplates[0].name, 'command-room');
  });

  it('rejects non-portable templateName and derives fallback', async () => {
    let exported = await ensurePackage();
    let ctx = createWorkspacePackageConstructionContext(exported.package, {
      templateName: 'Chat', // uppercase — doesn't match portable pattern
    });

    assert.equal(ctx.valid, true);
    assert.notEqual(ctx.workspaceTemplates[0].name, 'Chat');
    assert.notEqual(ctx.workspaceTemplates[0].name, 'chat');
    assert.ok(ctx.workspaceTemplates[0].name.startsWith('pkg-'));
  });

  it('rejects built-in template name override and derives fallback', async () => {
    let exported = await ensurePackage();
    let ctx = createWorkspacePackageConstructionContext(exported.package, {
      templateName: 'dashboard',
    });

    assert.equal(ctx.valid, true);
    assert.notEqual(ctx.workspaceTemplates[0].name, 'dashboard');
    assert.ok(ctx.workspaceTemplates[0].name.startsWith('pkg-'));
  });

  it('rejects every built-in template name override and derives fallback', async () => {
    let exported = await ensurePackage();
    let builtIns = [
      'admin',
      'agent-workspace',
      'chat',
      'dashboard',
      'editor',
      'graph',
      'social-automation',
      'video-studio',
    ];

    for (let name of builtIns) {
      let ctx = createWorkspacePackageConstructionContext(exported.package, {
        templateName: name,
      });

      assert.equal(ctx.valid, true);
      assert.notEqual(ctx.workspaceTemplates[0].name, name);
      assert.ok(ctx.workspaceTemplates[0].name.startsWith('pkg-'));
    }
  });

  it('provides deterministic template name for same package', async () => {
    let exported = await ensurePackage();
    let ctx1 = createWorkspacePackageConstructionContext(exported.package);
    let ctx2 = createWorkspacePackageConstructionContext(exported.package);

    assert.equal(ctx1.workspaceTemplates[0].name, ctx2.workspaceTemplates[0].name);
  });

  it('preserves stable module capability ordering', async () => {
    let exported = await ensurePackage();
    let ctx = createWorkspacePackageConstructionContext(exported.package);

    assert.equal(ctx.moduleCapabilities.length, 1);
    assert.deepEqual(ctx.moduleCapabilities[0].capabilities, ['room.command']);
    assert.equal(ctx.moduleCapabilities[0].requiredHostServices.length, 2);
    assert.ok(ctx.moduleCapabilities[0].runtimeSlots);
  });

  it('returns requiredCapabilities from construction plan when present', async () => {
    let configWithCaps = {
      ...PACKAGE_CONFIG,
      construction: {
        intent: { brief: 'Build.', targetRegister: 'tool' },
        plan: {
          layoutTemplate: 'video-studio',
          modules: [{ id: 'viewport', role: 'preview' }],
          capabilities: {
            required: ['room.command', 'agent.runtime'],
          },
        },
      },
    };

    let exported = exportWorkspacePackage(configWithCaps, {
      id: 'cap-package',
      version: '1.0.0',
    });
    let ctx = createWorkspacePackageConstructionContext(exported.package);

    assert.equal(ctx.valid, true);
    assert.deepEqual(ctx.requiredCapabilities, ['agent.runtime', 'room.command']);
  });

  it('returns requiredCapabilities from intent and construction intent paths', async () => {
    let configWithCaps = {
      ...PACKAGE_CONFIG,
      intent: {
        brief: 'Build a queue workspace.',
        targetRegister: 'tool',
        requiredCapabilities: ['workflow.queue', 'room.command'],
      },
      construction: {
        intent: {
          brief: 'Build a command workflow.',
          targetRegister: 'tool',
          requiredCapabilities: ['agent.runtime', 'room.command'],
        },
        plan: {
          target: {
            requiredCapabilities: ['admin.records'],
          },
          capabilities: {
            required: ['room.video', 'workflow.queue'],
          },
        },
      },
    };

    let exported = exportWorkspacePackage(configWithCaps, {
      id: 'intent-cap-package',
      version: '1.0.0',
    });
    let ctx = createWorkspacePackageConstructionContext(exported.package);

    assert.equal(ctx.valid, true);
    assert.deepEqual(ctx.requiredCapabilities, [
      'admin.records',
      'agent.runtime',
      'room.command',
      'room.video',
      'workflow.queue',
    ]);
  });

  it('feeds constructor matchTemplate and planWorkspaceConstruction without throwing', async () => {
    let exported = await ensurePackage();
    let ctx = createWorkspacePackageConstructionContext(exported.package);

    let matched = matchTemplate('Build a command room for AI agents.', {
      workspaceTemplates: ctx.workspaceTemplates,
    });
    assert.ok(typeof matched === 'string' || matched === null);

    let plan = planWorkspaceConstruction(
      { brief: 'Build a command room for AI agents.', targetRegister: 'tool' },
      {
        workspaceTemplates: ctx.workspaceTemplates,
        moduleCapabilities: ctx.moduleCapabilities,
      },
    );
    assert.ok(plan);
    assert.ok(plan.config);
    assert.equal(typeof plan.config.name, 'string');
  });
});

describe('createWorkspaceConstructionHandoff', () => {
  it('prepares constructor intent with package context required capabilities', () => {
    let context = {
      valid: true,
      requiredCapabilities: ['room.command', 'agent.runtime'],
    };
    let intent = {
      brief: 'Build a command workspace.',
      targetRegister: 'tool',
      requiredCapabilities: ['room.command', 'custom.reporting'],
    };

    let prepared = prepareConstructionIntentWithPackageContext(intent, context);

    assert.deepEqual(prepared, {
      brief: 'Build a command workspace.',
      targetRegister: 'tool',
      requiredCapabilities: ['agent.runtime', 'custom.reporting', 'room.command'],
    });
    assert.deepEqual(intent.requiredCapabilities, ['room.command', 'custom.reporting']);
  });

  it('merges package-required capabilities into constructor intent', () => {
    let configWithCaps = {
      ...PACKAGE_CONFIG,
      intent: {
        brief: 'Build a command workspace.',
        targetRegister: 'tool',
        requiredCapabilities: ['room.command'],
      },
    };
    let exported = exportWorkspacePackage(configWithCaps, {
      id: 'handoff-command-package',
      version: '1.0.0',
    });
    let ctx = createWorkspacePackageConstructionContext(exported.package, {
      templateName: 'handoff-command-room',
    });

    let handoff = createWorkspaceConstructionHandoff(ctx, {
      brief: 'Build a command workspace from a package.',
      targetRegister: 'tool',
      template: 'handoff-command-room',
      requiredCapabilities: ['agent.runtime'],
    });

    assert.equal(handoff.valid, true);
    assert.equal(handoff.ready, true);
    assert.equal(handoff._type, 'workspace-construction-handoff');
    assert.deepEqual(handoff.intent.requiredCapabilities, ['agent.runtime', 'room.command']);
    assert.deepEqual(handoff.options.workspaceTemplates.map((template) => template.name), [
      'handoff-command-room',
    ]);
    assert.deepEqual(handoff.options.moduleCapabilities.map((module) => module.tagName), [
      'ai-command-composer',
    ]);
    assert.equal(handoff.sources.length, 1);
    assert.equal(handoff.sources[0].packageId, 'handoff-command-package');

    let plan = planWorkspaceConstruction(handoff.intent, handoff.options);
    assert.deepEqual(plan.plan.capabilities.required, ['agent.runtime', 'room.command']);
    assert.ok(plan.plan.capabilities.matched.includes('room.command'));
    assert.ok(plan.plan.capabilities.missing.includes('agent.runtime'));

    handoff.options.workspaceTemplates[0].config.name = 'Mutated';
    assert.equal(ctx.workspaceTemplates[0].config.name, 'Test Workspace');
  });

  it('preserves warning-only package readiness metadata through construction planning', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'handoff-gapped-package',
      version: '1.0.0',
    });
    let ctx = createWorkspacePackageConstructionContext(exported.package, {
      templateName: 'handoff-gapped-room',
      available: {
        components: [],
        plugins: [],
        packages: [],
        hostServices: [],
        runtimeSlots: [],
      },
    });

    let handoff = createWorkspaceConstructionHandoff(ctx, {
      brief: 'Build a command workspace from a package with missing host capabilities.',
      template: 'handoff-gapped-room',
    });

    assert.equal(handoff.valid, true);
    assert.equal(handoff.ready, false);
    assert.equal(handoff._type, 'workspace-construction-handoff');
    assert.equal(handoff.options.packageContext.ready, false);
    assert.equal(handoff.options.packageContext.sources.length, 1);
    assert.equal(handoff.options.packageContext.source.packageId, 'handoff-gapped-package');
    assert.ok(handoff.options.packageContext.missing.components.length > 0);
    assert.ok(handoff.options.packageContext.warnings.length > 0);

    let plan = planWorkspaceConstruction(handoff.intent, handoff.options);
    assert.equal(plan.plan.packageContext.ready, false);
    assert.equal(plan.plan.packageContext.source.packageId, 'handoff-gapped-package');
    assert.ok(plan.plan.packageContext.missing.components.length > 0);
    assert.ok(plan.config.construction.packageContext.warnings.length > 0);
  });

  it('does not pass constructor arrays from invalid package contexts', () => {
    let handoff = createWorkspaceConstructionHandoff({
      valid: false,
      ready: false,
      workspaceTemplates: [{ name: 'bad-template' }],
      moduleCapabilities: [{ tagName: 'bad-widget' }],
      requiredCapabilities: ['bad.capability'],
      errors: [{ path: 'kind', message: 'Invalid package kind.', severity: 'error' }],
      warnings: [],
    }, {
      brief: 'Build a fallback workspace.',
      requiredCapabilities: ['host.capability'],
    });

    assert.equal(handoff.valid, false);
    assert.equal(handoff.ready, false);
    assert.equal(handoff._type, 'workspace-construction-handoff');
    assert.deepEqual(handoff.intent.requiredCapabilities, ['host.capability']);
    assert.deepEqual(handoff.options.workspaceTemplates, []);
    assert.deepEqual(handoff.options.moduleCapabilities, []);
    assert.deepEqual(handoff.errors, [
      { path: 'kind', message: 'Invalid package kind.', severity: 'error' },
    ]);
  });

  it('rejects invalid handoff intent capability values', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'handoff-invalid-intent-package',
      version: '1.0.0',
    });
    let ctx = createWorkspacePackageConstructionContext(exported.package);

    for (let requiredCapabilities of [
      ['valid', ''],
      ['valid', '   '],
      ['valid', 42],
      ['valid', ['nested']],
      Array(1),
    ]) {
      assert.throws(
        () => createWorkspaceConstructionHandoff(ctx, { requiredCapabilities }),
        (error) => {
          assert.equal(error.code, 'construction_handoff_intent_invalid');
          assert.equal(error.nextAction, 'fix-construction-intent');
          assert.match(error.message, /requiredCapabilities must contain non-empty strings/);
          return true;
        },
      );
    }

    assert.throws(
      () => createWorkspaceConstructionHandoff(ctx, { requiredCapabilities: 'valid' }),
      (error) => {
        assert.equal(error.code, 'construction_handoff_intent_invalid');
        assert.equal(error.nextAction, 'fix-construction-intent');
        assert.match(error.message, /requiredCapabilities must be an array of strings/);
        return true;
      },
    );
  });
});

describe('createWorkspacePackagesConstructionContext', () => {
  function createPackagedWorkspace({
    id,
    name,
    tagName,
    capabilities,
    requiredCapabilities = [],
    dependencies = {},
  }) {
    let config = {
      ...EXTENDED_CONFIG,
      name,
      intent: {
        brief: `${name} brief.`,
        targetRegister: 'tool',
        requiredCapabilities,
      },
      components: {
        catalog: ['sn-panel', tagName],
        modules: [{
          tagName,
          provider: `${id}-provider`,
          capabilities,
          requiredHostServices: ['storage.project'],
          placement: {
            panelType: `${tagName}-panel`,
            title: name,
            icon: 'extension',
          },
        }],
      },
    };

    return exportWorkspacePackage(config, {
      id,
      version: '1.0.0',
      description: `${name} package.`,
      dependencies: {
        components: [tagName],
        plugins: [`${id}-plugin`],
        packages: [`${id}-runtime`],
        ...dependencies,
      },
    });
  }

  it('returns blocked readiness for empty package collections', () => {
    let ctx = createWorkspacePackagesConstructionContext({ packages: [] });

    assert.equal(ctx.valid, false);
    assert.equal(ctx.ready, false);
    assert.deepEqual(ctx.source, {
      type: 'workspace-package-collection',
      packageCount: 0,
      validPackageCount: 0,
    });
    assert.deepEqual(ctx.workspaceTemplates, []);
    assert.deepEqual(ctx.moduleCapabilities, []);
    assert.deepEqual(ctx.requiredCapabilities, []);
    assert.ok(ctx.errors.some((error) => error.path === 'packages'));
    assert.equal(ctx.readiness.ready, false);
    assert.equal(ctx.readiness.valid, false);
    assert.equal(ctx.readiness.status, 'blocked');
    assert.equal(ctx.readiness.nextAction, 'fix-package-context');
    assert.equal(ctx.readiness.source.packageCount, 0);
    assert.equal(ctx.readiness.source.validPackageCount, 0);
    assert.equal(ctx.readiness.sourceCount, 0);
    assert.equal(ctx.readiness.errorCount, 1);
    assert.equal(ctx.readiness.warningCount, 0);
    assert.equal(ctx.readiness.missingCount, 0);
  });

  it('aggregates object and JSON package entries into constructor-ready arrays', () => {
    let beta = createPackagedWorkspace({
      id: 'beta-package',
      name: 'Beta Workspace',
      tagName: 'beta-widget',
      capabilities: ['beta.capability'],
      requiredCapabilities: ['beta.capability'],
    });
    let alpha = createPackagedWorkspace({
      id: 'alpha-package',
      name: 'Alpha Workspace',
      tagName: 'alpha-widget',
      capabilities: ['alpha.capability'],
      requiredCapabilities: ['alpha.capability'],
    });

    let ctx = createWorkspacePackagesConstructionContext({
      packages: [
        { package: beta.package, templateName: 'beta-room' },
        { json: alpha.json, templateName: 'alpha-room' },
      ],
    });

    assert.equal(ctx.valid, true);
    assert.equal(ctx.ready, true);
    assert.deepEqual(ctx.source, {
      type: 'workspace-package-collection',
      packageCount: 2,
      validPackageCount: 2,
    });
    assert.deepEqual(ctx.workspaceTemplates.map((template) => template.name), [
      'alpha-room',
      'beta-room',
    ]);
    assert.deepEqual(ctx.moduleCapabilities.map((descriptor) => descriptor.tagName), [
      'alpha-widget',
      'beta-widget',
    ]);
    assert.deepEqual(ctx.requiredCapabilities, ['alpha.capability', 'beta.capability']);
    assert.equal(ctx.sources.length, 2);
    assert.equal(ctx.packageResults.length, 2);
    assert.equal(ctx.packageResults[0].source.packageId, 'beta-package');
    assert.equal(ctx.packageResults[1].source.packageId, 'alpha-package');
    assert.deepEqual(ctx.errors, []);
    assert.deepEqual(ctx.conflicts, []);
  });

  it('reports partial invalid package diagnostics without exposing constructor arrays', () => {
    let valid = createPackagedWorkspace({
      id: 'valid-package',
      name: 'Valid Workspace',
      tagName: 'valid-widget',
      capabilities: ['valid.capability'],
    });

    let ctx = createWorkspacePackagesConstructionContext({
      packages: [
        { package: valid.package, templateName: 'valid-room' },
        { package: { kind: 'not-a-package', schemaVersion: '0.1.0', workspace: { config: {} } } },
      ],
    });

    assert.equal(ctx.valid, false);
    assert.equal(ctx.ready, false);
    assert.equal(ctx.source.packageCount, 2);
    assert.equal(ctx.source.validPackageCount, 1);
    assert.equal(ctx.packageResults.length, 2);
    assert.equal(ctx.packageResults[0].valid, true);
    assert.equal(ctx.packageResults[1].valid, false);
    assert.ok(ctx.errors.some((error) => error.path === 'packages[1].kind'));
    assert.deepEqual(ctx.workspaceTemplates, []);
    assert.deepEqual(ctx.moduleCapabilities, []);
    assert.deepEqual(ctx.requiredCapabilities, []);
  });

  it('keeps valid aggregation when availability gaps only produce warnings', () => {
    let alpha = createPackagedWorkspace({
      id: 'gap-alpha-package',
      name: 'Gap Alpha Workspace',
      tagName: 'gap-alpha-widget',
      capabilities: ['gap.alpha'],
    });
    let beta = createPackagedWorkspace({
      id: 'gap-beta-package',
      name: 'Gap Beta Workspace',
      tagName: 'gap-beta-widget',
      capabilities: ['gap.beta'],
    });

    let ctx = createWorkspacePackagesConstructionContext({
      packages: [
        { package: alpha.package, templateName: 'gap-alpha-room' },
        { package: beta.package, templateName: 'gap-beta-room' },
      ],
      available: {
        components: ['sn-panel'],
        plugins: [],
        packages: [],
        hostServices: [],
        runtimeSlots: [],
      },
    });

    assert.equal(ctx.valid, true);
    assert.equal(ctx.ready, false);
    assert.ok(ctx.workspaceTemplates.length > 0);
    assert.ok(ctx.moduleCapabilities.length > 0);
    assert.ok(ctx.warnings.length > 0);
    assert.ok(ctx.missing.components.includes('gap-alpha-widget'));
    assert.ok(ctx.missing.components.includes('gap-beta-widget'));
    assert.ok(ctx.missing.plugins.includes('gap-alpha-package-plugin'));
    assert.ok(ctx.missing.plugins.includes('gap-beta-package-plugin'));
    assert.ok(ctx.missing.hostServices.includes('storage.project'));
    assert.equal(ctx.readiness.ready, false);
    assert.equal(ctx.readiness.valid, true);
    assert.equal(ctx.readiness.status, 'warning');
    assert.equal(ctx.readiness.nextAction, 'review-package-readiness');
    assert.equal(ctx.readiness.source.packageCount, 2);
    assert.equal(ctx.readiness.sourceCount, 2);
    assert.equal(ctx.readiness.errorCount, 0);
    assert.ok(ctx.readiness.warningCount > 0);
    assert.ok(ctx.readiness.missingCount > 0);
  });

  it('blocks duplicate template names as aggregate conflicts', () => {
    let first = createPackagedWorkspace({
      id: 'template-first-package',
      name: 'Template First Workspace',
      tagName: 'template-first-widget',
      capabilities: ['template.first'],
    });
    let second = createPackagedWorkspace({
      id: 'template-second-package',
      name: 'Template Second Workspace',
      tagName: 'template-second-widget',
      capabilities: ['template.second'],
    });

    let ctx = createWorkspacePackagesConstructionContext({
      packages: [
        { package: first.package, templateName: 'duplicate-room' },
        { package: second.package, templateName: 'duplicate-room' },
      ],
    });

    assert.equal(ctx.valid, false);
    assert.equal(ctx.ready, false);
    assert.ok(ctx.conflicts.some((conflict) => conflict.type === 'workspace-template'));
    assert.ok(ctx.errors.some((error) => error.path === 'packages[1].workspaceTemplates[0].name'));
    assert.deepEqual(ctx.workspaceTemplates, []);
    assert.deepEqual(ctx.moduleCapabilities, []);
  });

  it('blocks duplicate module tagName descriptors as aggregate conflicts', () => {
    let first = createPackagedWorkspace({
      id: 'module-first-package',
      name: 'Module First Workspace',
      tagName: 'shared-widget',
      capabilities: ['module.first'],
    });
    let second = createPackagedWorkspace({
      id: 'module-second-package',
      name: 'Module Second Workspace',
      tagName: 'shared-widget',
      capabilities: ['module.second'],
    });

    let ctx = createWorkspacePackagesConstructionContext({
      packages: [
        { package: first.package, templateName: 'module-first-room' },
        { package: second.package, templateName: 'module-second-room' },
      ],
    });

    assert.equal(ctx.valid, false);
    assert.equal(ctx.ready, false);
    assert.ok(ctx.conflicts.some((conflict) => conflict.type === 'module-capability'));
    assert.ok(ctx.errors.some((error) => error.path === 'packages[1].moduleCapabilities[0].tagName'));
    assert.deepEqual(ctx.workspaceTemplates, []);
    assert.deepEqual(ctx.moduleCapabilities, []);
  });

  it('is deterministic, mutation-safe, and consumable by the constructor', () => {
    let zeta = createPackagedWorkspace({
      id: 'zeta-package',
      name: 'Zeta Workspace',
      tagName: 'zeta-widget',
      capabilities: ['zeta.capability'],
    });
    let alpha = createPackagedWorkspace({
      id: 'constructor-alpha-package',
      name: 'Constructor Alpha Workspace',
      tagName: 'constructor-alpha-widget',
      capabilities: ['alpha.construct'],
    });

    let input = {
      packages: [
        { package: zeta.package, templateName: 'zeta-room' },
        { package: alpha.package, templateName: 'alpha-room' },
      ],
    };
    let ctx = createWorkspacePackagesConstructionContext(input);

    assert.deepEqual(ctx.workspaceTemplates.map((template) => template.name), [
      'alpha-room',
      'zeta-room',
    ]);
    assert.deepEqual(ctx.moduleCapabilities.map((descriptor) => descriptor.tagName), [
      'constructor-alpha-widget',
      'zeta-widget',
    ]);

    ctx.workspaceTemplates[0].config.name = 'Mutated';
    ctx.moduleCapabilities[0].tagName = 'mutated-widget';

    let fresh = createWorkspacePackagesConstructionContext(input);
    assert.equal(fresh.workspaceTemplates[0].config.name, 'Constructor Alpha Workspace');
    assert.equal(fresh.moduleCapabilities[0].tagName, 'constructor-alpha-widget');

    let plan = planWorkspaceConstruction({
      brief: 'Construct an alpha workspace.',
      template: 'alpha-room',
      requiredCapabilities: ['alpha.construct'],
    }, {
      workspaceTemplates: fresh.workspaceTemplates,
      moduleCapabilities: fresh.moduleCapabilities,
    });

    assert.ok(plan.config);
    assert.deepEqual(plan.plan.capabilities.missing, []);
  });

  it('creates constructor handoff from aggregate package context', () => {
    let alpha = createPackagedWorkspace({
      id: 'handoff-alpha-package',
      name: 'Handoff Alpha Workspace',
      tagName: 'handoff-alpha-widget',
      capabilities: ['handoff.alpha'],
      requiredCapabilities: ['handoff.alpha'],
    });
    let beta = createPackagedWorkspace({
      id: 'handoff-beta-package',
      name: 'Handoff Beta Workspace',
      tagName: 'handoff-beta-widget',
      capabilities: ['handoff.beta'],
      requiredCapabilities: ['handoff.beta'],
    });

    let ctx = createWorkspacePackagesConstructionContext({
      packages: [
        { package: beta.package, templateName: 'handoff-beta-room' },
        { package: alpha.package, templateName: 'handoff-alpha-room' },
      ],
    });
    let handoff = createWorkspaceConstructionHandoff(ctx, {
      brief: 'Construct an alpha package workspace.',
      template: 'handoff-alpha-room',
    });

    assert.equal(handoff.valid, true);
    assert.equal(handoff.ready, true);
    assert.equal(handoff._type, 'workspace-construction-handoff');
    assert.deepEqual(handoff.intent.requiredCapabilities, ['handoff.alpha', 'handoff.beta']);
    assert.deepEqual(handoff.options.workspaceTemplates.map((template) => template.name), [
      'handoff-alpha-room',
      'handoff-beta-room',
    ]);
    assert.deepEqual(handoff.options.moduleCapabilities.map((descriptor) => descriptor.tagName), [
      'handoff-alpha-widget',
      'handoff-beta-widget',
    ]);
    assert.equal(handoff.sources.length, 2);

    let plan = planWorkspaceConstruction(handoff.intent, handoff.options);
    assert.deepEqual(plan.plan.capabilities.missing, []);
  });
});
