import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeConfigPathSegment,
  escapePointerSegment,
  normalizeConfigPath,
  pathToPointer,
  pointerToPath,
  prefixPointer,
  splitConfigPath,
  splitJsonPointer,
  unescapePointerSegment,
} from '../schema/config-path.js';
import { assembleWorkspaceSchema, WORKSPACE_SCHEMA_VERSION } from '../schema/index.js';
import { validateWorkspacePatch } from '../validation/workspace-patches.js';

describe('config path dialect', () => {
  it('converts dotted paths and array indices to JSON Pointer', () => {
    assert.equal(pathToPointer(''), '/');
    assert.equal(pathToPointer('layout.ratio'), '/layout/ratio');
    assert.equal(pathToPointer('content.collections[0].entries[12].title'), (
      '/content/collections/0/entries/12/title'
    ));
    assert.equal(pathToPointer('/layout/ratio'), '/layout/ratio');
  });

  it('round-trips escaped dotted segments and pointer escapes', () => {
    let path = 'content.collections[0].entries.weird\\.key.slash\\/value.tilde~value';
    let pointer = '/content/collections/0/entries/weird.key/slash~1value/tilde~0value';
    assert.deepEqual(splitConfigPath(path), [
      'content',
      'collections',
      '0',
      'entries',
      'weird.key',
      'slash/value',
      'tilde~value',
    ]);
    assert.equal(pathToPointer(path), pointer);
    assert.equal(pointerToPath(pointer), path);
    assert.equal(normalizeConfigPath(path), path);
  });

  it('exposes JSON Pointer segment helpers', () => {
    assert.equal(escapePointerSegment('a/b~c'), 'a~1b~0c');
    assert.equal(unescapePointerSegment('a~1b~0c'), 'a/b~c');
    assert.equal(escapeConfigPathSegment('a.b/c[0]'), 'a\\.b\\/c\\[0\\]');
    assert.deepEqual(splitJsonPointer('/a~1b/c~0d'), ['a/b', 'c~d']);
  });

  it('prefixes pointers without double-prefixing already scoped paths', () => {
    assert.equal(prefixPointer('/theme', 'params.hue'), '/theme/params/hue');
    assert.equal(prefixPointer('/theme', '/theme/params.hue'), '/theme/params.hue');
    assert.equal(prefixPointer('/theme', '/'), '/theme');
  });

  it('keeps workspace-patches pointer behavior compatible', async () => {
    assembleWorkspaceSchema();
    let config = {
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Patch Test',
      register: 'tool',
      requires: {
        packages: [{ id: 'symbiote-ui', version: '^1.0.0' }],
      },
      modules: [
        {
          id: 'symbiote-ui:main',
          source: { kind: 'package', package: 'symbiote-ui' },
          tagName: 'sn-main',
          capabilities: ['workspace.main'],
        },
        {
          id: 'symbiote-ui:side',
          source: { kind: 'package', package: 'symbiote-ui' },
          tagName: 'sn-side',
          capabilities: ['workspace.side'],
        },
      ],
      panels: {
        main: { module: 'symbiote-ui:main', title: 'Main' },
        side: { module: 'symbiote-ui:side', title: 'Side' },
      },
      layouts: {
        main: {
          kind: 'bsp',
          root: {
            type: 'split',
            id: 'root',
            direction: 'horizontal',
            ratio: 0.5,
            first: { type: 'panel', id: 'main-node', panel: 'main' },
            second: { type: 'panel', id: 'side-node', panel: 'side' },
          },
        },
      },
      views: [{ id: 'main', title: 'Main', layout: { $layout: 'main' } }],
    };
    let report = await validateWorkspacePatch(config, {
      layouts: {
        main: {
          kind: 'bsp',
          root: {
            type: 'split',
            id: 'root',
            direction: 'horizontal',
            ratio: 0.01,
            first: { type: 'panel', id: 'main-node', panel: 'main' },
            second: { type: 'panel', id: 'side-node', panel: 'side' },
          },
        },
      },
    });

    assert.equal(report.status, 'blocked');
    assert.ok(report.diagnostics.some((item) => item.path === '/layouts/main/root/ratio'));
    assert.ok(report.suggestedPatches.some((item) => item.path === '/layouts/main/root/ratio'));
  });
});
