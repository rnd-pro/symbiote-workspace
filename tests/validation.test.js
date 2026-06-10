import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkDesignGuardrails } from '../validation/index.js';

describe('checkDesignGuardrails', () => {
  it('passes for minimal valid config', () => {
    let result = checkDesignGuardrails({
      version: '0.2.0',
      name: 'Test',
      register: 'tool',
      theme: { params: { mode: 'dark', hue: 220 } },
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        first: { type: 'panel', panelType: 'a' },
        second: { type: 'panel', panelType: 'b' },
      },
    });
    assert.equal(result.pass, true);
  });

  it('warns on too many panels for presentation register', () => {
    // Build a BSP tree with 6 leaf panels
    let layout = {
      type: 'split', direction: 'horizontal', ratio: 0.5,
      first: {
        type: 'split', direction: 'vertical', ratio: 0.33,
        first: { type: 'panel', panelType: 'p1' },
        second: {
          type: 'split', direction: 'vertical', ratio: 0.5,
          first: { type: 'panel', panelType: 'p2' },
          second: { type: 'panel', panelType: 'p3' },
        },
      },
      second: {
        type: 'split', direction: 'vertical', ratio: 0.33,
        first: { type: 'panel', panelType: 'p4' },
        second: {
          type: 'split', direction: 'vertical', ratio: 0.5,
          first: { type: 'panel', panelType: 'p5' },
          second: { type: 'panel', panelType: 'p6' },
        },
      },
    };
    let result = checkDesignGuardrails({
      version: '0.2.0',
      name: 'Test',
      register: 'presentation',
      layout,
    });
    assert.ok(result.issues.some((i) => i.check === 'register-density'));
  });

  it('warns on small ratios for brand register', () => {
    let result = checkDesignGuardrails({
      version: '0.2.0',
      name: 'Test',
      register: 'brand',
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.1,
        first: { type: 'panel', panelType: 'a' },
        second: { type: 'panel', panelType: 'b' },
      },
    });
    assert.ok(result.issues.some((i) =>
      i.check === 'register-density' && i.message.includes('ratio')
    ));
  });

  it('warns on deep layout nesting', () => {
    // Build deeply nested BSP tree (7 levels)
    let deepPanel = { type: 'panel', panelType: 'deep' };
    let layout = deepPanel;
    for (let i = 0; i < 7; i++) {
      layout = {
        type: 'split', direction: 'horizontal', ratio: 0.5,
        first: layout,
        second: { type: 'panel', panelType: `p${i}` },
      };
    }
    let result = checkDesignGuardrails({
      version: '0.2.0',
      name: 'Test',
      register: 'tool',
      layout,
    });
    assert.ok(result.issues.some((i) => i.check === 'layout-depth'));
  });

  it('reports info on missing theme params', () => {
    let result = checkDesignGuardrails({
      version: '0.2.0',
      name: 'Test',
      register: 'tool',
    });
    assert.ok(result.pass);
    assert.ok(result.issues.some((i) =>
      i.check === 'theme-completeness' && i.severity === 'info'
    ));
  });

  it('tool register allows up to 12 panels', () => {
    // Build BSP tree with exactly 12 leaf panels (perfectly balanced binary tree of depth 4 = 16, but we use 12)
    function buildTree(n) {
      if (n <= 1) return { type: 'panel', panelType: `p${n}` };
      let half = Math.ceil(n / 2);
      return {
        type: 'split', direction: 'horizontal', ratio: 0.5,
        first: buildTree(half),
        second: buildTree(n - half),
      };
    }
    let layout = buildTree(12);
    let result = checkDesignGuardrails({
      version: '0.2.0',
      name: 'Dense Tool UI',
      register: 'tool',
      layout,
    });
    assert.ok(!result.issues.some((i) =>
      i.check === 'register-density' && i.message.includes('panels')
    ));
  });
});
