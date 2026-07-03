import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateWorkspaceConfig } from '../validation/core.js';
import { assembleWorkspaceSchema, WORKSPACE_SCHEMA_VERSION } from '../schema/index.js';
import {
  applyWorkspacePatch,
  loadWorkspaceDesignPolicy,
  normalizeWorkspacePatchReport,
  proposeWorkspacePatch,
  validateWorkspaceDesignPatch,
  validateWorkspacePatch,
  validateWorkspaceThemePatch,
} from '../validation/index.js';

function createBaseConfig() {
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    name: 'Builder',
    register: 'tool',
    theme: {
      recipe: 'agent-console',
      params: {
        mode: 'dark',
        hue: 218,
        contrast: 72,
      },
    },
    requires: {
      packages: [{ id: 'symbiote-ui', version: '^1.0.0' }],
    },
    modules: [{
      id: 'symbiote-ui:card',
      source: { kind: 'package', package: 'symbiote-ui' },
      tagName: 'sn-card',
      capabilities: ['dashboard.card'],
    }],
    panels: {
      source: {
        module: 'symbiote-ui:card',
        title: 'Source',
      },
    },
    layouts: {
      main: {
        kind: 'bsp',
        root: {
          type: 'panel',
          id: 'source-node',
          panel: 'source',
        },
      },
    },
    views: [{ id: 'main', title: 'Main', layout: { $layout: 'main' } }],
  };
}

describe('workspace construction patch validation', () => {
  beforeEach(() => {
    assembleWorkspaceSchema();
  });

  it('loads the Node-safe symbiote-ui design policy bridge', async () => {
    let policy = await loadWorkspaceDesignPolicy();
    assert.equal(typeof policy.deriveDesignConstraints, 'function');
    assert.equal(typeof policy.validateThemePatch, 'function');
    assert.equal(typeof policy.validateDesignPatch, 'function');
  });

  it('blocks invalid theme proposals without mutating inputs', async () => {
    let config = createBaseConfig();
    let originalConfig = structuredClone(config);
    let patch = {
      theme: {
        params: {
          mode: 'system',
        },
      },
    };
    let originalPatch = structuredClone(patch);

    let report = await validateWorkspaceThemePatch(config, patch.theme);

    assert.equal(report.status, 'blocked');
    assert.equal(report.accepted, false);
    assert.equal(report.diagnostics.some((item) =>
      item.surface === 'theme' &&
      item.path === '/theme/params/mode' &&
      item.severity === 'hard'
    ), true);
    assert.deepEqual(
      report.suggestedPatches.find((item) => item.path === '/theme/params/mode'),
      {
        op: 'replace',
        path: '/theme/params/mode',
        value: 'dark',
        reason: 'Use a supported mode value.',
      }
    );
    assert.deepEqual(config, originalConfig);
    assert.deepEqual(patch, originalPatch);
  });

  it('returns soft warnings and suggested patches for recipe drift', async () => {
    let config = createBaseConfig();
    config.theme.recipe = 'editor-pro';

    let report = await validateWorkspacePatch(config, {
      theme: {
        params: {
          chroma: 92,
          density: 110,
        },
      },
    });

    assert.equal(report.status, 'warn');
    assert.equal(report.accepted, true);
    assert.equal(report.diagnostics.every((item) => item.severity !== 'hard'), true);
    assert.equal(report.suggestedPatches.some((item) =>
      item.path === '/theme/params/chroma' && item.value === 72
    ), true);
    assert.equal(report.suggestedPatches.some((item) =>
      item.path === '/theme/params/density' && item.value === 100
    ), true);
  });

  it('blocks host-disallowed design register patches with a replacement hint', async () => {
    let config = createBaseConfig();

    let report = await validateWorkspaceDesignPatch(
      config,
      { register: 'brand' },
      { context: { hostPolicy: { allowedRegisters: ['tool'] } } },
    );

    assert.equal(report.status, 'blocked');
    assert.equal(report.accepted, false);
    assert.equal(report.diagnostics.some((item) =>
      item.surface === 'design' &&
      item.path === '/design/register' &&
      item.severity === 'hard'
    ), true);
    assert.deepEqual(
      report.suggestedPatches.find((item) => item.path === '/design/register'),
      {
        op: 'replace',
        path: '/design/register',
        value: 'tool',
        reason: 'Use a host-approved design register.',
      }
    );
  });

  it('blocks invalid layout patches and preserves the original workspace', async () => {
    let config = createBaseConfig();
    let originalConfig = structuredClone(config);

    let report = await proposeWorkspacePatch(config, {
      layouts: {
        main: {
          kind: 'bsp',
          root: {
            type: 'split',
            id: 'root',
            direction: 'horizontal',
            ratio: 0.01,
            first: { type: 'panel', id: 'source-node', panel: 'source' },
            second: { type: 'panel', id: 'preview-node', panel: 'preview' },
          },
        },
      },
    });

    assert.equal(report.status, 'blocked');
    assert.equal(report.accepted, false);
    assert.equal(report.nextConfig, null);
    assert.equal(report.diagnostics.some((item) =>
      item.surface === 'layout' &&
      item.path === '/layouts/main/root/ratio' &&
      item.severity === 'hard'
    ), true);
    assert.equal(report.diagnostics.some((item) =>
      item.path === '/layouts/main/root/second/panel' &&
      item.severity === 'hard'
    ), true);
    assert.deepEqual(config, originalConfig);
  });

  it('blocks module patches that use invalid custom element names', async () => {
    let config = createBaseConfig();

    let report = await validateWorkspacePatch(config, {
      overlay: {
        modules: [
          ...config.modules,
          {
            id: 'symbiote-ui:preview',
            source: { kind: 'package', package: 'symbiote-ui' },
            tagName: 'PreviewPanel',
            capabilities: ['dashboard.preview'],
          },
        ],
      },
    });

    assert.equal(report.status, 'blocked');
    assert.equal(report.accepted, false);
    assert.equal(report.diagnostics.some((item) =>
      item.surface === 'config' &&
      item.path === '/modules/1/tagName' &&
      item.severity === 'hard'
    ), true);
  });

  it('records accepted workspace patch validation in the applied config', async () => {
    let config = createBaseConfig();
    let originalConfig = structuredClone(config);

    let result = await applyWorkspacePatch(config, {
      overlay: {
        name: 'Patched Builder',
        theme: {
          params: {
            mode: 'dark',
            hue: 220,
          },
        },
      },
    });

    assert.equal(result.status, 'ok');
    assert.equal(result.config.name, 'Patched Builder');
    assert.equal(result.config.theme.params.hue, 220);
    assert.equal(result.config.patches.length, 1);
    assert.equal(result.config.patches[0].id, 'workspace-patch-validation');
    assert.equal(result.config.patches[0].status, 'pass');
    assert.equal(result.config.patches[0].report.status, 'pass');
    assert.equal(result.config.patches[0].report.severity, 'info');
    assert.equal(result.config.patches[0].report.nextConfig, undefined);
    assert.equal(result.config.validation.reports.length, 1);
    assert.equal(result.config.validation.reports[0].check, 'workspace-patch-validation');
    assert.equal(result.config.validation.reports[0].status, 'pass');
    assert.equal(validateWorkspaceConfig(result.config, { strict: true }).ok, true);
    assert.deepEqual(config, originalConfig);
  });

  it('normalizes aggregate patch reports for downstream tooling', async () => {
    let config = createBaseConfig();
    let raw = await validateWorkspacePatch(config, {
      theme: {
        params: {
          mode: 'system',
        },
      },
    });
    let report = normalizeWorkspacePatchReport(raw);

    assert.equal(report.version, 'workspace-patch-report-v1');
    assert.equal(report.summary.blocked > 0, true);
    assert.equal(report.summary.totalDiagnostics, report.diagnostics.length);
  });
});
