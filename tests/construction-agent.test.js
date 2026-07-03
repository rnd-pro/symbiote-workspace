/**
 * Construction-agent contract proof.
 *
 * Verifies the closed step union, the validateStep gate (unknown types, unknown
 * tools, bad arg/display shapes), and the buildCtx assembly (read-only clones of
 * config/intent, the TOOLS slice shape, and history pass-through).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS } from '../runtime/dispatch.js';
import { validateStep, assertStep, buildCtx, toolViews } from '../runtime/construction-agent.js';

describe('validateStep — closed union', () => {
  it('accepts a tool step with a known toolName and object args', () => {
    assert.equal(validateStep({ type: 'tool', toolName: 'construction_classify', args: { intent: 'x' } }).valid, true);
  });

  it('accepts a tool step without args', () => {
    assert.equal(validateStep({ type: 'tool', toolName: 'config_export' }).valid, true);
  });

  it('accepts message and done steps', () => {
    assert.equal(validateStep({ type: 'message', display: 'hi' }).valid, true);
    assert.equal(validateStep({ type: 'done' }).valid, true);
    assert.equal(validateStep({ type: 'done', display: 'bye' }).valid, true);
  });

  it('rejects an unknown step type', () => {
    let r = validateStep({ type: 'explode' });
    assert.equal(r.valid, false);
    assert.match(r.reason, /unknown step type/);
  });

  it('rejects a tool step with an unknown toolName', () => {
    let r = validateStep({ type: 'tool', toolName: 'nuke_everything' });
    assert.equal(r.valid, false);
    assert.match(r.reason, /unknown toolName/);
  });

  it('rejects a tool step with non-object args', () => {
    assert.equal(validateStep({ type: 'tool', toolName: 'construction_classify', args: 'nope' }).valid, false);
    assert.equal(validateStep({ type: 'tool', toolName: 'construction_classify', args: [1, 2] }).valid, false);
  });

  it('rejects a message step without a string display', () => {
    assert.equal(validateStep({ type: 'message' }).valid, false);
    assert.equal(validateStep({ type: 'message', display: 42 }).valid, false);
  });

  it('rejects non-object steps', () => {
    assert.equal(validateStep(null).valid, false);
    assert.equal(validateStep('done').valid, false);
    assert.equal(validateStep(undefined).valid, false);
  });
});

describe('assertStep', () => {
  it('returns the step when valid', () => {
    let step = { type: 'tool', toolName: 'config_export' };
    assert.equal(assertStep(step), step);
  });

  it('throws with a coded error when invalid', () => {
    assert.throws(() => assertStep({ type: 'tool', toolName: 'nope' }), (err) => {
      assert.equal(err.code, 'construction_step_invalid');
      return true;
    });
  });
});

describe('toolViews', () => {
  it('exposes name/description/inputSchema/mutates for every tool, cloned from the registry', () => {
    let views = toolViews();
    assert.equal(views.length, TOOLS.length);
    let construct = views.find((v) => v.name === 'construction_construct');
    assert.equal(construct.mutates, true);
    let describe = views.find((v) => v.name === 'workspace_describe');
    assert.equal(describe.mutates, false);
    // Cloned, not the live registry object.
    let live = TOOLS.find((t) => t.name === 'construction_construct');
    assert.notEqual(construct.inputSchema, live.inputSchema);
  });
});

describe('buildCtx', () => {
  it('assembles a read-only context with cloned config/intent and the tool slice', () => {
    let session = { config: { name: 'WS', groups: [] } };
    let history = [{ toolName: 'construction_classify', args: {}, envelope: { summary: 's', warnings: [], data: {} } }];
    let ctx = buildCtx(session, history, { status: 'ok' }, 'plan-workspace', 'an intent');

    assert.equal(ctx.intent, 'an intent');
    assert.deepEqual(ctx.config, { name: 'WS', groups: [] });
    assert.notEqual(ctx.config, session.config); // cloned
    assert.deepEqual(ctx.history, history);
    assert.notEqual(ctx.history, history); // cloned, not the live loop array
    assert.deepEqual(ctx.lastResult, { status: 'ok' });
    assert.equal(ctx.lastNextAction, 'plan-workspace');
    assert.equal(ctx.tools.length, TOOLS.length);
  });

  it('tolerates a null session config', () => {
    let ctx = buildCtx({ config: null }, [], undefined, undefined, undefined);
    assert.equal(ctx.config, null);
    assert.equal(ctx.lastNextAction, undefined);
    assert.deepEqual(ctx.history, []);
  });
});
