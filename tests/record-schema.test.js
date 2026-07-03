import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECORD_FIELD_TYPES,
  RECORD_SCALAR_FIELD_TYPES,
  RECORD_COMPOSITE_FIELD_TYPES,
  FIELD_ID_PATTERN,
  isRecordSchema,
  validateRecordSchema,
  validateRecordValue,
} from '../schema/record-schema.js';

function schemaErrors(schema, options) {
  let errors = [];
  validateRecordSchema(schema, 'schema', errors, options);
  return errors;
}

function valueErrors(value, field, options) {
  let errors = [];
  validateRecordValue(value, field, 'value', errors, options);
  return errors;
}

describe('record-schema — the one field vocabulary', () => {
  it('exposes the full vocabulary including R13 composites', () => {
    assert.deepEqual(RECORD_SCALAR_FIELD_TYPES, [
      'string', 'number', 'boolean', 'enum', 'datetime', 'richtext', 'asset', 'ref', 'l10n-string',
    ]);
    assert.deepEqual(RECORD_COMPOSITE_FIELD_TYPES, ['list', 'record']);
    for (let type of [...RECORD_SCALAR_FIELD_TYPES, ...RECORD_COMPOSITE_FIELD_TYPES]) {
      assert.ok(RECORD_FIELD_TYPES.includes(type), `${type} in RECORD_FIELD_TYPES`);
    }
  });

  it('accepts every scalar type in one schema', () => {
    let schema = { fields: RECORD_SCALAR_FIELD_TYPES.map((type, i) => (
      type === 'enum' ? { id: `f${i}`, type, values: ['a', 'b'] } : { id: `f${i}`, type }
    )) };
    assert.equal(schemaErrors(schema).length, 0);
  });

  it('field ids are identifier-shaped (camelCase legal, URLs illegal)', () => {
    assert.ok(FIELD_ID_PATTERN.test('createdAt'));
    assert.ok(FIELD_ID_PATTERN.test('body_text'));
    assert.equal(schemaErrors({ fields: [{ id: 'createdAt', type: 'datetime' }] }).length, 0);
    assert.equal(schemaErrors({ fields: [{ id: '1bad', type: 'string' }] }).length, 1);
    assert.equal(schemaErrors({ fields: [{ id: 'has space', type: 'string' }] }).length, 1);
  });

  it('rejects a non-object schema and a missing fields array', () => {
    assert.equal(schemaErrors(null).length, 1);
    assert.equal(schemaErrors({}).length, 1);
    assert.equal(isRecordSchema({ fields: [] }), true);
    assert.equal(isRecordSchema({}), false);
  });

  it('rejects unknown field types', () => {
    let errors = schemaErrors({ fields: [{ id: 'x', type: 'color' }] });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'record.field.type');
  });

  it('rejects duplicate and missing field ids', () => {
    assert.equal(schemaErrors({ fields: [{ id: 'a', type: 'string' }, { id: 'a', type: 'number' }] }).length, 1);
    assert.equal(schemaErrors({ fields: [{ type: 'string' }] }).length, 1);
  });

  it('enum requires a non-empty, unique values array', () => {
    assert.equal(schemaErrors({ fields: [{ id: 'e', type: 'enum' }] }).length, 1);
    assert.equal(schemaErrors({ fields: [{ id: 'e', type: 'enum', values: [] }] }).length, 1);
    assert.equal(schemaErrors({ fields: [{ id: 'e', type: 'enum', values: ['a', 'a'] }] }).length, 1);
    assert.equal(schemaErrors({ fields: [{ id: 'e', type: 'enum', values: ['a', 'b'] }] }).length, 0);
  });

  it('list requires an items element descriptor and forbids ids on it', () => {
    assert.equal(schemaErrors({ fields: [{ id: 'l', type: 'list' }] }).length, 1);
    assert.equal(schemaErrors({ fields: [{ id: 'l', type: 'list', items: { type: 'string' } }] }).length, 0);
    assert.equal(schemaErrors({ fields: [{ id: 'l', type: 'list', items: { id: 'no', type: 'string' } }] }).length, 1);
    // nested list-of-list
    assert.equal(schemaErrors({ fields: [{ id: 'l', type: 'list', items: { type: 'list', items: { type: 'number' } } }] }).length, 0);
  });

  it('record composite requires nested fields', () => {
    assert.equal(schemaErrors({ fields: [{ id: 'r', type: 'record' }] }).length, 1);
    assert.equal(schemaErrors({ fields: [{ id: 'r', type: 'record', fields: [{ id: 'inner', type: 'string' }] }] }).length, 0);
    assert.equal(schemaErrors({ fields: [{ id: 'r', type: 'record', fields: [{ id: 'bad', type: 'nope' }] }] }).length, 1);
  });
});

describe('record-schema — value validation', () => {
  it('type-checks scalar values', () => {
    assert.equal(valueErrors('hi', { id: 'f', type: 'string' }).length, 0);
    assert.equal(valueErrors(5, { id: 'f', type: 'string' }).length, 1);
    assert.equal(valueErrors(5, { id: 'f', type: 'number' }).length, 0);
    assert.equal(valueErrors(Infinity, { id: 'f', type: 'number' }).length, 1);
    assert.equal(valueErrors(true, { id: 'f', type: 'boolean' }).length, 0);
    assert.equal(valueErrors('yes', { id: 'f', type: 'boolean' }).length, 1);
  });

  it('validates datetime and enum values', () => {
    assert.equal(valueErrors('2026-07-03T12:00:00Z', { id: 'f', type: 'datetime' }).length, 0);
    assert.equal(valueErrors('not-a-date', { id: 'f', type: 'datetime' }).length, 1);
    let enumField = { id: 'f', type: 'enum', values: ['open', 'shipped'] };
    assert.equal(valueErrors('open', enumField).length, 0);
    assert.equal(valueErrors('closed', enumField).length, 1);
  });

  it('asset values must be asset: refs and are surfaced to onRef', () => {
    let refs = [];
    let errors = valueErrors('asset:hero', { id: 'f', type: 'asset' }, { onRef: (kind, ref) => refs.push([kind, ref]) });
    assert.equal(errors.length, 0);
    assert.deepEqual(refs, [['asset', 'asset:hero']]);
    assert.equal(valueErrors('hero', { id: 'f', type: 'asset' }).length, 1);
  });

  it('ref values surface content: refs and reject malformed content refs', () => {
    let refs = [];
    valueErrors('content:blog:post-1', { id: 'f', type: 'ref' }, { onRef: (kind, ref) => refs.push(ref) });
    assert.deepEqual(refs, ['content:blog:post-1']);
    assert.equal(valueErrors('content:', { id: 'f', type: 'ref' }).length, 1);
    assert.equal(valueErrors('', { id: 'f', type: 'ref' }).length, 1);
  });

  it('delegates l10n-string values to the l10n validator', () => {
    let seen = [];
    valueErrors({ default: 'x' }, { id: 'f', type: 'l10n-string' }, { l10n: (v, p, e) => seen.push(v) });
    assert.equal(seen.length, 1);
  });

  it('recurses into list and record composites', () => {
    let listField = { id: 'tags', type: 'list', items: { type: 'string' } };
    assert.equal(valueErrors(['a', 'b'], listField).length, 0);
    assert.equal(valueErrors('nope', listField).length, 1);
    assert.equal(valueErrors(['a', 3], listField).length, 1);

    let recordField = { id: 'meta', type: 'record', fields: [{ id: 'n', type: 'number' }] };
    assert.equal(valueErrors({ n: 1 }, recordField).length, 0);
    assert.equal(valueErrors({ n: 'x' }, recordField).length, 1);
    assert.equal(valueErrors('scalar', recordField).length, 1);
  });
});
