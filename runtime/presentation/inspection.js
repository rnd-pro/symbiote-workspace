import { canonicalize, isIntegrityString } from '../../schema/canonical-json.js';
import { assertPortableValue } from '../portable-value.js';
import { createCanonicalInspectionEvidence } from './production-revision.js';

export const INSPECTION_SCHEMA_VERSION = 'workspace-inspection-v1';

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function exactKeys(value, allowed, path) {
  for (let key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${path}.${key} is not supported`);
  }
}

function inspectionIdentity(value) {
  let prefix = `${INSPECTION_SCHEMA_VERSION}:`;
  if (typeof value !== 'string' || !value.startsWith(prefix)
    || !isIntegrityString(value.slice(prefix.length))) {
    throw new TypeError('inspectionEvidence.id must be a canonical inspection identity');
  }
}

export function inspectProductionRevision(revision = {}, causalSet = {}) {
  return createCanonicalInspectionEvidence(revision, causalSet);
}

export function validateInspectionEvidence(value = {}, revision = {}, causalSet = {}) {
  let source = record(value, 'inspectionEvidence');
  exactKeys(source, [
    'schemaVersion', 'revisionId', 'causalSetId', 'diagnostics', 'ready', 'id',
  ], 'inspectionEvidence');
  assertPortableValue(source, 'inspectionEvidence');
  inspectionIdentity(source.id);
  let expected = inspectProductionRevision(revision, causalSet);
  if (canonicalize(source) !== canonicalize(expected)) {
    throw new TypeError('inspection evidence does not match its canonical recomputation');
  }
  if (!expected.ready || expected.diagnostics.length) {
    throw new Error('inspection evidence contains an unresolved warning or error');
  }
  return expected;
}
