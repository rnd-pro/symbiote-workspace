import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildToolResultEnvelope,
  parseToolResultEnvelope,
  isToolResultEnvelope,
} from '../runtime/tool-result.js';
import { buildToolResultEnvelope as fromRoot } from '../index.js';
import { parseToolResultEnvelope as fromBrowser } from '../browser.js';

describe('tool-result envelope', () => {
  it('builds a stable envelope with summary, warnings, and data', () => {
    let env = buildToolResultEnvelope({
      summary: '3 items',
      warnings: ['stale cache'],
      data: { items: [1, 2, 3] },
    });
    assert.equal(env._kind, 'tool-result/v1');
    assert.equal(env.summary, '3 items');
    assert.deepEqual(env.warnings, ['stale cache']);
    assert.deepEqual(env.data, { items: [1, 2, 3] });
  });

  it('defaults summary and warnings when omitted', () => {
    let env = buildToolResultEnvelope({ data: 42 });
    assert.equal(env.summary, '');
    assert.deepEqual(env.warnings, []);
    assert.equal(env.data, 42);
  });

  it('normalizes a single warning string into a list', () => {
    let env = buildToolResultEnvelope({ data: null, warnings: 'just one' });
    assert.deepEqual(env.warnings, ['just one']);
  });

  it('round-trips through parse', () => {
    let env = buildToolResultEnvelope({ summary: 'ok', warnings: ['w'], data: { a: 1 } });
    let parsed = parseToolResultEnvelope(env);
    assert.equal(parsed.summary, 'ok');
    assert.deepEqual(parsed.warnings, ['w']);
    assert.deepEqual(parsed.data, { a: 1 });
  });

  it('parses a JSON-stringified envelope', () => {
    let json = JSON.stringify(buildToolResultEnvelope({ summary: 's', data: [1] }));
    let parsed = parseToolResultEnvelope(json);
    assert.equal(parsed.summary, 's');
    assert.deepEqual(parsed.data, [1]);
  });

  it('back-compat: a raw object parses to { data: <raw> }', () => {
    let raw = { board: 'x', count: 2 };
    let parsed = parseToolResultEnvelope(raw);
    assert.equal(parsed.summary, '');
    assert.deepEqual(parsed.warnings, []);
    assert.deepEqual(parsed.data, raw);
  });

  it('back-compat: a raw non-JSON string parses to { data: <raw> }', () => {
    let parsed = parseToolResultEnvelope('plain text result');
    assert.equal(parsed.summary, '');
    assert.equal(parsed.data, 'plain text result');
  });

  it('isToolResultEnvelope detects envelopes and rejects raw values', () => {
    assert.equal(isToolResultEnvelope(buildToolResultEnvelope({ data: 1 })), true);
    assert.equal(
      isToolResultEnvelope(JSON.stringify(buildToolResultEnvelope({ data: 1 }))),
      true,
    );
    assert.equal(isToolResultEnvelope({ data: 1 }), false);
    assert.equal(isToolResultEnvelope('nope'), false);
    assert.equal(isToolResultEnvelope(null), false);
  });

  it('is re-exported from root and browser entrypoints', () => {
    assert.equal(typeof fromRoot, 'function');
    assert.equal(typeof fromBrowser, 'function');
    let env = fromRoot({ data: 1 });
    assert.deepEqual(fromBrowser(env).data, 1);
  });
});
