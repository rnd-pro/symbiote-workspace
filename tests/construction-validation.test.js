import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateWorkspaceConfig } from '../validation/core.js';
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
    version: '0.2.0',
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
    panelTypes: {
      source: {
        title: 'Source',
        component: 'sn-card',
      },
    },
    layout: {
      type: 'panel',
      panelType: 'source',
    },
    components: {
      catalog: ['sn-card'],
    },
  };
}

describe('workspace construction patch validation', () => {
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
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.01,
        first: { type: 'panel', panelType: 'source' },
        second: { type: 'panel', panelType: 'preview' },
      },
    });

    assert.equal(report.status, 'blocked');
    assert.equal(report.accepted, false);
    assert.equal(report.nextConfig, null);
    assert.equal(report.diagnostics.some((item) =>
      item.surface === 'layout' &&
      item.path === '/layout/ratio' &&
      item.severity === 'hard'
    ), true);
    assert.deepEqual(
      report.suggestedPatches.find((item) => item.path === '/layout/ratio'),
      {
        op: 'replace',
        path: '/layout/ratio',
        value: 0.05,
        reason: 'Use a legal split ratio within the workspace schema range.',
      }
    );
    assert.deepEqual(config, originalConfig);
  });

  it('warns on module patches that use invalid custom element names', async () => {
    let config = createBaseConfig();

    let report = await validateWorkspacePatch(config, {
      modules: {
        panelTypes: {
          preview: {
            title: 'Preview',
            component: 'PreviewPanel',
          },
        },
      },
    });

    assert.equal(report.status, 'warn');
    assert.equal(report.accepted, true);
    assert.equal(report.diagnostics.some((item) =>
      item.surface === 'modules' &&
      item.path === '/modules/panelTypes/preview/component' &&
      item.severity === 'soft'
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
    assert.equal(validateWorkspaceConfig(result.config, { strict: true }).valid, true);
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
