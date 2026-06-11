import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  exportConfig,
  importConfig,
  diffConfigs,
  mergeConfigs,
} from '../sharing/index.js';

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
