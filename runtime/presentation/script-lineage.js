import {
  canonicalize,
  computeIntegrity,
  isIntegrityString,
} from '../../schema/canonical-json.js';
import { assertPortableValue } from '../portable-value.js';

export const SEMANTIC_SCRIPT_SCHEMA_VERSION = 'semantic-script-v1';
export const VOICE_PLAN_SCHEMA_VERSION = 'voice-plan-v1';
export const COMPOSITION_SCHEMA_VERSION = 'composition-v1';
export const PRESENTATION_SEMANTIC_SCRIPT_MISMATCH = 'PRESENTATION_SEMANTIC_SCRIPT_MISMATCH';

const ALLOWED_LOCALES = Object.freeze(['en-US', 'ru-RU', 'es-ES']);
const ALLOWED_LOCALE_SET = new Set(ALLOWED_LOCALES);

export class PresentationSemanticScriptMismatchError extends Error {
  constructor(expectedHash, actualHash) {
    super(`Semantic script mismatch: expected ${expectedHash}, received ${actualHash}. Regenerate from the approved semantic script.`);
    this.name = 'PresentationSemanticScriptMismatchError';
    this.code = PRESENTATION_SEMANTIC_SCRIPT_MISMATCH;
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredObject(value, path) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function requiredArray(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value;
}

function normalizedString(value, path) {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`);
  let normalized = value.normalize('NFC');
  if (!normalized || normalized !== normalized.trim()) {
    throw new TypeError(`${path} is required and must not contain edge whitespace`);
  }
  return normalized;
}

function normalizedText(value, path) {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`);
  let normalized = value.replace(/\r\n/g, '\n').normalize('NFC');
  if (!normalized || normalized !== normalized.trim()) {
    throw new TypeError(`${path} is required and must not contain edge whitespace`);
  }
  return normalized;
}

function optionalReference(value, path) {
  if (value === undefined || value === null) return null;
  return normalizedString(value, path);
}

function sortedReferenceSet(value, path) {
  let refs = requiredArray(value, path)
    .map((item, index) => normalizedString(item, `${path}[${index}]`));
  return [...new Set(refs)].sort();
}

function orderedReferences(value, path) {
  return requiredArray(value, path)
    .map((item, index) => normalizedString(item, `${path}[${index}]`));
}

function portableClone(value, path) {
  assertPortableValue(value, path);
  return JSON.parse(canonicalize(value));
}

function hashRecord(version, value) {
  return { ...value, hash: `${version}:${computeIntegrity(value)}` };
}

function identityHash(value, version, path) {
  let prefix = `${version}:`;
  if (typeof value !== 'string' || !value.startsWith(prefix) || !isIntegrityString(value.slice(prefix.length))) {
    throw new TypeError(`${path} must be a ${version} canonical identity hash`);
  }
  return value;
}

function approvedSemanticHash(value, path) {
  if (typeof value === 'string') {
    return identityHash(value, SEMANTIC_SCRIPT_SCHEMA_VERSION, path);
  }
  let canonical = createSemanticScript(requiredObject(value, path));
  if (value.hash !== undefined && value.hash !== canonical.hash) {
    throw new TypeError(`${path}.hash does not match its semantic content`);
  }
  return canonical.hash;
}

function candidateSemanticHash(value, path) {
  let source = requiredObject(value, path);
  if (source.semanticHash !== undefined && source.turns === undefined) {
    throw new TypeError(`${path} must contain actual semantic turns, not an echoed semanticHash`);
  }
  let canonical = createSemanticScript(source);
  if (source.hash !== undefined && source.hash !== canonical.hash) {
    throw new TypeError(`${path}.hash does not match its semantic content`);
  }
  return canonical.hash;
}

export function createSemanticScript(input) {
  let source = requiredObject(input, 'semanticScript');
  if (!ALLOWED_LOCALE_SET.has(source.locale)) {
    throw new TypeError(`semanticScript.locale must be one of exactly ${ALLOWED_LOCALES.join(', ')}`);
  }
  requiredArray(source.turns, 'semanticScript.turns');
  if (source.turns.length === 0) throw new TypeError('semanticScript.turns must contain at least one turn');
  requiredArray(source.styleRefs, 'semanticScript.styleRefs');
  requiredArray(source.profileRefs, 'semanticScript.profileRefs');
  assertPortableValue(source, 'semanticScript');

  let seenTurnIds = new Set();
  let turns = source.turns.map((value, index) => {
    let path = `semanticScript.turns[${index}]`;
    let turn = requiredObject(value, path);
    let id = normalizedString(turn.id, `${path}.id`);
    if (seenTurnIds.has(id)) throw new TypeError(`${path}.id must be unique`);
    seenTurnIds.add(id);
    return {
      id,
      text: normalizedText(turn.text, `${path}.text`),
      semanticAct: normalizedString(turn.semanticAct, `${path}.semanticAct`),
      replyToTurnId: optionalReference(turn.replyToTurnId, `${path}.replyToTurnId`),
      factRefs: sortedReferenceSet(turn.factRefs, `${path}.factRefs`),
      claimRefs: sortedReferenceSet(turn.claimRefs, `${path}.claimRefs`),
      targetRefs: sortedReferenceSet(turn.targetRefs, `${path}.targetRefs`),
      actionRefs: sortedReferenceSet(turn.actionRefs, `${path}.actionRefs`),
    };
  });

  let journeyHash = null;
  if (source.journeyHash) {
    journeyHash = identityHash(source.journeyHash, 'workspace-presentation-journey-v1', 'semanticScript.journeyHash');
  }

  return hashRecord(SEMANTIC_SCRIPT_SCHEMA_VERSION, {
    schemaVersion: SEMANTIC_SCRIPT_SCHEMA_VERSION,
    journeyHash,
    locale: source.locale,
    turns,
    styleRefs: orderedReferences(source.styleRefs, 'semanticScript.styleRefs'),
    profileRefs: orderedReferences(source.profileRefs, 'semanticScript.profileRefs'),
  });
}

export function createVoicePlan(input) {
  let source = requiredObject(input, 'voicePlan');
  let semanticHash = identityHash(source.semanticHash, SEMANTIC_SCRIPT_SCHEMA_VERSION, 'voicePlan.semanticHash');
  let sequenceMode = normalizedString(source.sequenceMode, 'voicePlan.sequenceMode');
  for (let field of ['speakerRefs', 'personaRefs', 'voiceRefs', 'deliveryRefs']) {
    requiredArray(source[field], `voicePlan.${field}`);
  }
  assertPortableValue(source, 'voicePlan');

  return hashRecord(VOICE_PLAN_SCHEMA_VERSION, {
    schemaVersion: VOICE_PLAN_SCHEMA_VERSION,
    semanticHash,
    sequenceMode,
    speakerRefs: orderedReferences(source.speakerRefs, 'voicePlan.speakerRefs'),
    personaRefs: orderedReferences(source.personaRefs, 'voicePlan.personaRefs'),
    voiceRefs: orderedReferences(source.voiceRefs, 'voicePlan.voiceRefs'),
    deliveryRefs: orderedReferences(source.deliveryRefs, 'voicePlan.deliveryRefs'),
  });
}

export function createComposition(input) {
  let source = requiredObject(input, 'composition');
  let semanticHash = identityHash(source.semanticHash, SEMANTIC_SCRIPT_SCHEMA_VERSION, 'composition.semanticHash');
  let voiceHash = identityHash(source.voiceHash, VOICE_PLAN_SCHEMA_VERSION, 'composition.voiceHash');
  requiredArray(source.cues, 'composition.cues');
  requiredArray(source.targets, 'composition.targets');
  requiredObject(source.appearance, 'composition.appearance');
  requiredObject(source.output, 'composition.output');
  assertPortableValue(source, 'composition');

  return hashRecord(COMPOSITION_SCHEMA_VERSION, {
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    semanticHash,
    voiceHash,
    cues: portableClone(source.cues, 'composition.cues'),
    targets: portableClone(source.targets, 'composition.targets'),
    appearance: portableClone(source.appearance, 'composition.appearance'),
    output: portableClone(source.output, 'composition.output'),
  });
}

export function assertPresentationSemanticScriptEquality(expected, actual) {
  let expectedHash = approvedSemanticHash(expected, 'expectedSemanticScript');
  let actualHash = candidateSemanticHash(actual, 'actualSemanticScript');
  if (expectedHash !== actualHash) {
    throw new PresentationSemanticScriptMismatchError(expectedHash, actualHash);
  }
  return actualHash;
}
