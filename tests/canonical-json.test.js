import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  canonicalize,
  computeIntegrity,
  isIntegrityString,
  INTEGRITY_PATTERN,
} from '../schema/canonical-json.js';

describe('canonicalize', () => {
  it('sorts object keys by code unit and strips whitespace', () => {
    assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
    assert.equal(canonicalize({ a: { d: 4, c: 3 }, b: 2 }), '{"a":{"c":3,"d":4},"b":2}');
  });

  it('is key-order-independent', () => {
    let a = { name: 'x', version: '1.0.0', nested: { z: 1, a: 2 } };
    let b = { nested: { a: 2, z: 1 }, version: '1.0.0', name: 'x' };
    assert.equal(canonicalize(a), canonicalize(b));
  });

  it('preserves array order but canonicalizes members', () => {
    assert.equal(canonicalize([{ b: 1, a: 2 }, 3]), '[{"a":2,"b":1},3]');
  });

  it('serializes primitives per the JSON data model', () => {
    assert.equal(canonicalize(null), 'null');
    assert.equal(canonicalize(true), 'true');
    assert.equal(canonicalize(false), 'false');
    assert.equal(canonicalize('a"b\\c'), '"a\\"b\\\\c"');
  });

  it('normalizes negative zero to 0 and keeps ECMAScript number form', () => {
    assert.equal(canonicalize(-0), '0');
    assert.equal(canonicalize(0), '0');
    assert.equal(canonicalize(1.5), '1.5');
    assert.equal(canonicalize(1e21), '1e+21');
  });

  it('omits undefined and function object properties, nulls array holes', () => {
    assert.equal(canonicalize({ a: 1, b: undefined }), '{"a":1}');
    assert.equal(canonicalize([1, undefined, 2]), '[1,null,2]');
  });

  it('rejects non-finite numbers, bigint, and undefined roots', () => {
    assert.throws(() => canonicalize(NaN), TypeError);
    assert.throws(() => canonicalize(Infinity), TypeError);
    assert.throws(() => canonicalize(10n), TypeError);
    assert.throws(() => canonicalize(undefined), TypeError);
  });

  it('applies toJSON before serializing', () => {
    let value = { toJSON() { return { b: 2, a: 1 }; } };
    assert.equal(canonicalize(value), '{"a":1,"b":2}');
  });
});

describe('computeIntegrity', () => {
  it('returns sha256-<base64>', () => {
    let integrity = computeIntegrity({ code: 'export default 1;' });
    assert.match(integrity, INTEGRITY_PATTERN);
    assert.ok(integrity.startsWith('sha256-'));
  });

  it('matches an independent sha256 over the canonical form', () => {
    let value = { b: 2, a: 1 };
    let expected = 'sha256-' + createHash('sha256').update(canonicalize(value), 'utf8').digest('base64');
    assert.equal(computeIntegrity(value), expected);
  });

  it('is invariant to source key order', () => {
    assert.equal(
      computeIntegrity({ code: 'x', template: 't', styles: 's' }),
      computeIntegrity({ styles: 's', code: 'x', template: 't' }),
    );
  });

  it('changes when content changes', () => {
    assert.notEqual(computeIntegrity({ code: 'a' }), computeIntegrity({ code: 'b' }));
  });
});

describe('isIntegrityString', () => {
  it('accepts well-formed integrity strings and rejects others', () => {
    assert.equal(isIntegrityString(computeIntegrity({ a: 1 })), true);
    assert.equal(isIntegrityString('sha256-not base64!'), false);
    assert.equal(isIntegrityString('md5-abc'), false);
    assert.equal(isIntegrityString(42), false);
  });
});
