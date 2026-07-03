import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkDesignGuardrails } from '../validation/design-guardrails.js';

/** Wrap a bsp root node as a single-view workspace config for the guardrails. */
function workspace({ register, root, theme, layouts, views }) {
  if (views) return { version: '0.2.0', name: 'Test', register, theme, layouts, views };
  return {
    version: '0.2.0',
    name: 'Test',
    register,
    theme,
    views: [{ id: 'main', title: 'Main', layout: { kind: 'bsp', root } }],
  };
}

describe('checkDesignGuardrails', () => {
  it('passes for minimal valid config', () => {
    let result = checkDesignGuardrails(workspace({
      register: 'tool',
      theme: { params: { mode: 'dark', hue: 220 } },
      root: {
        type: 'split', id: 's', direction: 'horizontal', ratio: 0.5,
        first: { type: 'panel', id: 'a', panel: 'a' },
        second: { type: 'panel', id: 'b', panel: 'b' },
      },
    }));
    assert.equal(result.pass, true);
  });

  it('warns on too many panels for presentation register', () => {
    // BSP tree with 6 leaf panels; presentation allows 4.
    let root = {
      type: 'split', id: 'r', direction: 'horizontal', ratio: 0.5,
      first: {
        type: 'split', id: 'l', direction: 'vertical', ratio: 0.33,
        first: { type: 'panel', id: 'p1', panel: 'p1' },
        second: {
          type: 'split', id: 'l2', direction: 'vertical', ratio: 0.5,
          first: { type: 'panel', id: 'p2', panel: 'p2' },
          second: { type: 'panel', id: 'p3', panel: 'p3' },
        },
      },
      second: {
        type: 'split', id: 'rr', direction: 'vertical', ratio: 0.33,
        first: { type: 'panel', id: 'p4', panel: 'p4' },
        second: {
          type: 'split', id: 'rr2', direction: 'vertical', ratio: 0.5,
          first: { type: 'panel', id: 'p5', panel: 'p5' },
          second: { type: 'panel', id: 'p6', panel: 'p6' },
        },
      },
    };
    let result = checkDesignGuardrails(workspace({ register: 'presentation', root }));
    assert.ok(result.issues.some((i) => i.check === 'register-density' && i.message.includes('panels')));
  });

  it('warns on small ratios for brand register', () => {
    let result = checkDesignGuardrails(workspace({
      register: 'brand',
      root: {
        type: 'split', id: 's', direction: 'horizontal', ratio: 0.1,
        first: { type: 'panel', id: 'a', panel: 'a' },
        second: { type: 'panel', id: 'b', panel: 'b' },
      },
    }));
    assert.ok(result.issues.some((i) => i.check === 'register-density' && i.message.includes('ratio')));
  });

  it('warns on deep layout nesting', () => {
    let root = { type: 'panel', id: 'deep', panel: 'deep' };
    for (let i = 0; i < 7; i++) {
      root = {
        type: 'split', id: `s${i}`, direction: 'horizontal', ratio: 0.5,
        first: root,
        second: { type: 'panel', id: `p${i}`, panel: `p${i}` },
      };
    }
    let result = checkDesignGuardrails(workspace({ register: 'tool', root }));
    assert.ok(result.issues.some((i) => i.check === 'layout-depth'));
  });

  it('does not derive geometry warnings from a stack layout', () => {
    let result = checkDesignGuardrails(workspace({
      register: 'presentation',
      views: [{
        id: 'docked', title: 'Docked',
        layout: {
          kind: 'stack', id: 'dock',
          children: Array.from({ length: 8 }, (_, index) => ({
            type: 'panel', id: `t${index}`, panel: `p${index}`,
          })),
        },
      }],
    }));
    assert.ok(!result.issues.some((i) => i.check === 'register-density'));
    assert.ok(!result.issues.some((i) => i.check === 'layout-depth'));
  });

  it('reports info on missing theme params', () => {
    let result = checkDesignGuardrails(workspace({
      register: 'tool',
      root: { type: 'panel', id: 'a', panel: 'a' },
    }));
    assert.ok(result.pass);
    assert.ok(result.issues.some((i) => i.check === 'theme-completeness' && i.severity === 'info'));
  });

  it('tool register allows up to 12 panels', () => {
    function buildTree(n, seq = { i: 0 }) {
      if (n <= 1) return { type: 'panel', id: `p${seq.i++}`, panel: `p${n}` };
      let half = Math.ceil(n / 2);
      return {
        type: 'split', id: `s${seq.i++}`, direction: 'horizontal', ratio: 0.5,
        first: buildTree(half, seq),
        second: buildTree(n - half, seq),
      };
    }
    let result = checkDesignGuardrails(workspace({ register: 'tool', root: buildTree(12) }));
    assert.ok(!result.issues.some((i) => i.check === 'register-density' && i.message.includes('panels')));
  });

  it('applies density guardrails for all workspace registers', () => {
    let registers = ['tool', 'admin', 'editor', 'agent-workspace', 'media-studio', 'brand', 'presentation'];
    let root = {
      type: 'split', id: 's', direction: 'horizontal', ratio: 0.03,
      first: { type: 'panel', id: 'a', panel: 'a' },
      second: { type: 'panel', id: 'b', panel: 'b' },
    };
    for (let register of registers) {
      let result = checkDesignGuardrails(workspace({ register, root }));
      assert.ok(
        result.issues.some((i) => i.check === 'register-density' && i.message.includes(register)),
        `Expected density guardrail for ${register}`,
      );
    }
  });

  it('runs density checks across every view', () => {
    let result = checkDesignGuardrails({
      version: '0.2.0', name: 'Multi', register: 'presentation',
      layouts: {
        wide: {
          kind: 'bsp',
          root: {
            type: 'split', id: 's', direction: 'horizontal', ratio: 0.02,
            first: { type: 'panel', id: 'a', panel: 'a' },
            second: { type: 'panel', id: 'b', panel: 'b' },
          },
        },
      },
      views: [
        { id: 'first', title: 'First', layout: { $layout: 'wide' } },
        { id: 'second', title: 'Second', layout: { $layout: 'wide' } },
      ],
    });
    let densityViews = new Set(result.issues.filter((i) => i.check === 'register-density').map((i) => i.view));
    assert.ok(densityViews.has('first'));
    assert.ok(densityViews.has('second'));
  });
});
