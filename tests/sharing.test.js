import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  exportConfig,
  importConfig,
  diffConfigs,
  mergeConfigs,
} from '../sharing/index.js';

let BASE_CONFIG = {
  version: '0.1.0',
  name: 'Test Workspace',
  register: 'tool',
  theme: {
    params: { mode: 'dark', hue: 220 },
    overrides: { '--sn-gap': '8px' },
  },
  layout: {
    type: 'split',
    children: [
      { type: 'single', component: 'sn-panel' },
    ],
  },
  components: {
    catalog: ['sn-panel'],
    custom: [{ tagName: 'my-widget', code: 'class X {}' }],
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

  it('replaces layout wholesale', () => {
    let newLayout = { type: 'single', component: 'sn-editor' };
    let merged = mergeConfigs(BASE_CONFIG, { layout: newLayout });
    assert.equal(merged.layout.type, 'single');
    assert.equal(merged.layout.children, undefined);
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
