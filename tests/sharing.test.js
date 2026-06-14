import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BROWSER_REQUIRED_IMPORTS,
  createBrowserRuntimeContract,
  createWorkspacePackageConstructionContext,
  exportWorkspacePackage,
  exportConfig,
  importWorkspacePackage,
  importConfig,
  inspectWorkspacePackage,
  diffConfigs,
  mergeConfigs,
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
    },
  },
  validation: {
    reports: [{
      id: 'theme-check',
      check: 'theme',
      severity: 'warning',
      message: 'Contrast fallback required.',
    }],
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

  it('preserves construction metadata, validation reports, and theme relations', () => {
    let result = exportConfig(EXTENDED_CONFIG);
    assert.ok(result.json);
    let parsed = JSON.parse(result.json);
    assert.equal(parsed.theme.relations.surfaceStep, 1.15);
    assert.equal(parsed.theme.subtrees[0].relations.radiusScale, 0.8);
    assert.equal(parsed.construction.plan.layoutTemplate, 'video-studio');
    assert.equal(parsed.validation.reports[0].check, 'theme');
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
});

describe('workspace package portability', () => {
  it('exports config, manifest, host contract, dependencies, and permissions', () => {
    let result = exportWorkspacePackage(PACKAGE_CONFIG, {
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
    assert.equal(result.package.workspace.config.name, 'Test Workspace');
    assert.doesNotMatch(JSON.stringify(result.package), /https?:|file:\/\/|\/Users\//);
  });

  it('imports exported workspace packages with strict config validation', () => {
    let exported = exportWorkspacePackage(PACKAGE_CONFIG, {
      id: 'command-room-package',
      version: '1.2.3',
    });
    let imported = importWorkspacePackage(exported.json);

    assert.ok(imported.package);
    assert.ok(imported.config);
    assert.deepEqual(imported.errors, []);
    assert.equal(imported.package.manifest.id, 'command-room-package');
    assert.equal(imported.config.name, 'Test Workspace');
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
