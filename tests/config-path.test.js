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
    let config = {
      version: '0.2.0',
      name: 'Patch Test',
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        first: { type: 'panel', panelType: 'main' },
        second: { type: 'panel', panelType: 'side' },
      },
      panelTypes: {
        main: { title: 'Main', component: 'sn-main' },
        side: { title: 'Side', component: 'sn-side' },
      },
    };
    let report = await validateWorkspacePatch(config, {
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.01,
        first: { type: 'panel', panelType: 'main' },
        second: { type: 'panel', panelType: 'side' },
      },
    });

    assert.equal(report.status, 'blocked');
    assert.ok(report.diagnostics.some((item) => item.path === '/layout/ratio'));
    assert.ok(report.suggestedPatches.some((item) => item.path === '/layout/ratio'));
  });
});
