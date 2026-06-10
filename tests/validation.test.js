import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkDesignGuardrails } from '../validation/index.js';

describe('checkDesignGuardrails', () => {
  it('passes for minimal valid config', () => {
    let result = checkDesignGuardrails({
      version: '0.1.0',
      name: 'Test',
      register: 'tool',
      theme: { params: { mode: 'dark', hue: 220 } },
      layout: {
        type: 'split',
        ratio: [0.5, 0.5],
        children: [
          { type: 'single', component: 'sn-panel' },
          { type: 'single', component: 'sn-panel' },
        ],
      },
    });
    assert.equal(result.pass, true);
  });

  it('warns on too many panels for presentation register', () => {
    let children = [];
    for (let i = 0; i < 6; i++) {
      children.push({ type: 'single', component: 'sn-panel' });
    }
    let result = checkDesignGuardrails({
      version: '0.1.0',
      name: 'Test',
      register: 'presentation',
      layout: { type: 'split', children },
    });
    assert.ok(result.issues.some((i) => i.check === 'register-density'));
  });

  it('warns on small ratios for brand register', () => {
    let result = checkDesignGuardrails({
      version: '0.1.0',
      name: 'Test',
      register: 'brand',
      layout: {
        type: 'split',
        ratio: [0.1, 0.9],
        children: [
          { type: 'single', component: 'sn-panel' },
          { type: 'single', component: 'sn-panel' },
        ],
      },
    });
    assert.ok(result.issues.some((i) =>
      i.check === 'register-density' && i.message.includes('ratio')
    ));
  });

  it('warns on deep layout nesting', () => {
    let layout = { type: 'split', children: [{ type: 'split', children: [
      { type: 'split', children: [{ type: 'split', children: [
        { type: 'split', children: [{ type: 'split', children: [
          { type: 'single', component: 'sn-panel' },
        ] }] },
      ] }] },
    ] }] };
    let result = checkDesignGuardrails({
      version: '0.1.0',
      name: 'Test',
      register: 'tool',
      layout,
    });
    assert.ok(result.issues.some((i) => i.check === 'layout-depth'));
  });

  it('reports info on missing theme params', () => {
    let result = checkDesignGuardrails({
      version: '0.1.0',
      name: 'Test',
      register: 'tool',
    });
    assert.ok(result.pass);
    assert.ok(result.issues.some((i) =>
      i.check === 'theme-completeness' && i.severity === 'info'
    ));
  });

  it('tool register allows up to 12 panels', () => {
    let children = [];
    for (let i = 0; i < 12; i++) {
      children.push({ type: 'single', component: 'sn-panel' });
    }
    let result = checkDesignGuardrails({
      version: '0.1.0',
      name: 'Dense Tool UI',
      register: 'tool',
      layout: { type: 'split', children },
    });
    assert.ok(!result.issues.some((i) =>
      i.check === 'register-density' && i.message.includes('panels')
    ));
  });
});
