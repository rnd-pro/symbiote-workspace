import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { clearRegisteredSections } from '../validation/core.js';
import {
  computeFragmentIntegrity,
  loadWorkspaceConfig,
  resolveWorkspaceFragments,
  extractThemeParams,
  extractThemeRelations,
  extractThemeOverrides,
  extractThemeSubtrees,
} from '../loader/index.js';

const VALID_CONFIG = {
  version: '1.0.0',
  name: 'Test',
  panels: {
    tree: { module: 'sn-tree-panel' },
    editor: { module: 'sn-editor' },
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

beforeEach(() => clearRegisteredSections());

describe('loadWorkspaceConfig', () => {
  it('loads a valid config and resolves catalog/custom component sources', () => {
    let catalog = { has: (tag) => tag === 'sn-tree-panel', list: () => ['sn-tree-panel'] };
    let result = loadWorkspaceConfig(VALID_CONFIG, { catalog });

    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.errors.length, 0);
    assert.ok(result.resolvedComponents.some((c) => c.tagName === 'sn-tree-panel' && c.source === 'catalog'));
    assert.ok(result.resolvedComponents.some((c) => c.tagName === 'sn-editor' && c.source === 'custom'));
  });

  it('reports missing components as fallback and fails in strict mode', () => {
    let catalog = { has: () => false, list: () => [] };
    let loose = loadWorkspaceConfig(VALID_CONFIG, { catalog });
    let strict = loadWorkspaceConfig(VALID_CONFIG, { catalog, strict: true });

    assert.equal(loose.valid, true);
    assert.ok(loose.missingComponents.includes('sn-tree-panel'));
    assert.ok(loose.warnings.some((warning) => warning.path === 'components'));
    assert.equal(strict.valid, false);
    assert.ok(strict.errors.some((error) => error.message.includes('Missing components')));
  });

  it('rejects invalid configs after fragment resolution', () => {
    let result = loadWorkspaceConfig({ name: 'No version' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'version'));
  });
});

describe('$fragment resolution', () => {
  it('resolves depth-1 fragments at declared slots before validation', () => {
    let layout = {
      kind: 'bsp',
      root: { type: 'panel', id: 'main-panel', panel: 'main' },
    };
    let config = {
      version: '1.0.0',
      name: 'Fragments',
      layouts: {
        main: { $fragment: { ref: 'layout:main', integrity: computeFragmentIntegrity(layout) } },
      },
    };

    let result = loadWorkspaceConfig(config, {
      fragments: { 'layout:main': layout },
    });

    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.deepEqual(result.config.layouts.main, layout);
    assert.deepEqual(result.fragments.map((item) => item.path), ['layouts.main']);
  });

  it('supports pack/path fragment lookup', () => {
    let entries = [{ id: 'home', fields: { title: 'Home' } }];
    let result = resolveWorkspaceFragments({
      content: {
        collections: [{
          id: 'pages',
          entries: { $fragment: { pack: 'site', path: 'entries.json', integrity: computeFragmentIntegrity(entries) } },
        }],
      },
    }, {
      packs: { site: { 'entries.json': entries } },
    });

    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.deepEqual(result.config.content.collections[0].entries, entries);
  });

  it('fails closed on non-slot, missing integrity, nested, missing, and mismatched fragments', () => {
    let body = { ok: true };
    let cases = [
      [{ panels: { main: { $fragment: { ref: 'x', integrity: computeFragmentIntegrity(body) } } } }, 'loader.fragment.slot'],
      [{ layouts: { main: { $fragment: { ref: 'x' } } } }, 'loader.fragment.integrity'],
      [{ layouts: { main: { $fragment: { ref: 'x', integrity: computeFragmentIntegrity({ $fragment: { ref: 'y' } }) } } } }, 'loader.fragment.nested', { x: { $fragment: { ref: 'y' } } }],
      [{ layouts: { main: { $fragment: { ref: 'missing', integrity: computeFragmentIntegrity(body) } } } }, 'loader.fragment.missing'],
      [{ layouts: { main: { $fragment: { ref: 'x', integrity: computeFragmentIntegrity({ other: true }) } } } }, 'loader.fragment.integrity_mismatch'],
    ];

    for (let [partial, code, fragments = { x: body }] of cases) {
      let result = loadWorkspaceConfig({ version: '1.0.0', name: 'Bad', ...partial }, { fragments });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((error) => error.code === code), `${code}: ${JSON.stringify(result.errors)}`);
    }
  });
});

describe('theme extractors', () => {
  it('extracts params, relations, overrides, and subtrees', () => {
    assert.equal(extractThemeParams(VALID_CONFIG).hue, 220);
    assert.equal(extractThemeRelations(VALID_CONFIG).surfaceStep, 1.15);
    assert.equal(extractThemeOverrides(VALID_CONFIG)['--sn-custom-token'], '10px');
    assert.equal(extractThemeSubtrees(VALID_CONFIG)[0].relations.radiusScale, 0.8);
  });
});
