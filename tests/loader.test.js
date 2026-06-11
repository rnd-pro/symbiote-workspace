import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadWorkspaceConfig,
  extractThemeParams,
  extractThemeRelations,
  extractThemeOverrides,
  extractThemeSubtrees,
} from '../loader/index.js';

let VALID_CONFIG = {
  version: '0.2.0',
  name: 'Test',
  register: 'tool',
  layout: {
    type: 'split',
    direction: 'horizontal',
    ratio: 0.3,
    first: { type: 'panel', panelType: 'tree' },
    second: { type: 'panel', panelType: 'editor' },
  },
  components: {
    catalog: ['sn-tree-panel'],
    custom: [{ tagName: 'sn-editor', code: 'class X extends HTMLElement {}' }],
  },
  theme: {
    params: { mode: 'dark', hue: 220 },
    relations: { surfaceStep: 1.15 },
    overrides: { '--sn-custom-token': '10px' },
    subtrees: [{ selector: '.sidebar', params: { hue: 180 }, relations: { radiusScale: 0.8 } }],
  },
};

describe('loadWorkspaceConfig', () => {
  it('loads valid config successfully', () => {
    let result = loadWorkspaceConfig(VALID_CONFIG);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('resolves catalog and custom components', () => {
    let catalog = { has: (tag) => tag === 'sn-tree-panel', list: () => ['sn-tree-panel'] };
    let result = loadWorkspaceConfig(VALID_CONFIG, { catalog });
    assert.equal(result.valid, true);
    assert.ok(result.resolvedComponents.some((c) => c.tagName === 'sn-tree-panel' && c.source === 'catalog'));
    assert.ok(result.resolvedComponents.some((c) => c.tagName === 'sn-editor' && c.source === 'custom'));
  });

  it('reports missing components as fallback', () => {
    let catalog = { has: () => false, list: () => [] };
    let result = loadWorkspaceConfig(VALID_CONFIG, { catalog });
    assert.equal(result.valid, true);
    assert.ok(result.missingComponents.includes('sn-tree-panel'));
    assert.ok(result.warnings.some((w) => w.message.includes('fallback')));
  });

  it('fails in strict mode on missing components', () => {
    let catalog = { has: () => false, list: () => [] };
    let result = loadWorkspaceConfig(VALID_CONFIG, { catalog, strict: true });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes('Missing components')));
  });

  it('rejects invalid config', () => {
    let result = loadWorkspaceConfig({ name: 'No version' });
    assert.equal(result.valid, false);
  });
});

describe('extractThemeParams', () => {
  it('extracts params from config', () => {
    let params = extractThemeParams(VALID_CONFIG);
    assert.equal(params.mode, 'dark');
    assert.equal(params.hue, 220);
  });

  it('returns empty object for missing theme', () => {
    let params = extractThemeParams({ version: '0.1.0', name: 'X' });
    assert.deepEqual(params, {});
  });
});

describe('extractThemeOverrides', () => {
  it('extracts overrides from config', () => {
    let overrides = extractThemeOverrides(VALID_CONFIG);
    assert.equal(overrides['--sn-custom-token'], '10px');
  });
});

describe('extractThemeRelations', () => {
  it('extracts relations from config', () => {
    let relations = extractThemeRelations(VALID_CONFIG);
    assert.equal(relations.surfaceStep, 1.15);
  });

  it('returns empty object for missing relations', () => {
    let relations = extractThemeRelations({ version: '0.1.0', name: 'X' });
    assert.deepEqual(relations, {});
  });
});

describe('extractThemeSubtrees', () => {
  it('extracts subtrees from config', () => {
    let subtrees = extractThemeSubtrees(VALID_CONFIG);
    assert.equal(subtrees.length, 1);
    assert.equal(subtrees[0].selector, '.sidebar');
    assert.equal(subtrees[0].relations.radiusScale, 0.8);
  });
});
