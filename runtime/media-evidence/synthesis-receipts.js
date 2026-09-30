import { isIntegrityString } from '../../schema/canonical-json.js';

export const AUDIO_SYNTHESIS_RECEIPT_VERSION = 'symbiote-audio-synthesis-receipt-v2';
export const MEDIA_SPEAKER_IDENTITY_CLAIMS = Object.freeze([
  'provider-attested+acoustic-cluster',
]);

const SYNTHESIS_KEYS = new Set(['identityClaim', 'turns', 'receipts']);
const TURN_KEYS = new Set(['turnId', 'persona', 'artifactRef', 'receiptRef']);
const RECEIPT_KEYS = new Set([
  'receiptVersion', 'requestHash', 'requestedVoiceRef', 'resolvedVoiceRef',
  'speakerAttestation', 'model', 'language', 'sampleRate', 'durationMs',
  'artifactHash', 'receiptHmac', 'speakerProbe', 'normalization',
]);
const MODEL_KEYS = new Set(['family', 'versionToken']);
const SPEAKER_PROBE_KEYS = new Set([
  'probeFamily', 'probeVersionToken', 'enrollmentRevision',
  'segmentationRevision', 'segmentCount', 'enrolledVoiceMatch',
  'segmentsConsistent', 'maxEnrolledDistance', 'minOtherVoiceMargin',
  'maxSegmentDistance', 'thresholds',
]);
const SPEAKER_THRESHOLD_KEYS = new Set([
  'enrolledDistanceMax', 'otherVoiceMarginMin', 'segmentDistanceMax',
]);
const NORMALIZATION_KEYS = new Set(['version', 'applied', 'targetLufs', 'truePeakLimitDbfs']);
const SHA256_HEX = /^[a-f0-9]{64}$/;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PRIVATE_FIELD = /(?:biometric|vector|embedding|private|raw)/i;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, path) {
  if (!isObject(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function assertKnownKeys(value, keys, path) {
  for (let key of Object.keys(assertObject(value, path))) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported`);
  }
}

function assertPortableFields(value, path) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertPortableFields(child, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (let [key, child] of Object.entries(value)) {
    if (PRIVATE_FIELD.test(key)) throw new TypeError(`${path}.${key} is private and not portable`);
    assertPortableFields(child, `${path}.${key}`);
  }
}

function requiredString(value, path) {
  let text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new TypeError(`${path} is required`);
  return text;
}

function integrity(value, path) {
  let text = requiredString(value, path);
  if (!isIntegrityString(text)) throw new TypeError(`${path} must be a sha256 integrity string`);
  return text;
}

function digest(value, path) {
  let text = requiredString(value, path);
  if (!SHA256_HEX.test(text)) throw new TypeError(`${path} must be a lowercase SHA-256 hex digest`);
  return text;
}

function safeToken(value, path) {
  let text = requiredString(value, path);
  if (!SAFE_TOKEN.test(text)) throw new TypeError(`${path} must be a safe token`);
  return text;
}

function requiredBoolean(value, path) {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`);
  return value;
}

function numberInRange(value, minimum, maximum, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${path} must be a finite number in [${minimum}, ${maximum}]`);
  }
  return value;
}

function digestIntegrity(value) {
  let bytes = [];
  for (let index = 0; index < value.length; index += 2) bytes.push(Number.parseInt(value.slice(index, index + 2), 16));
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    let a = bytes[index];
    let b = bytes[index + 1];
    let c = bytes[index + 2];
    encoded += BASE64_ALPHABET[a >> 2];
    encoded += BASE64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    encoded += b === undefined ? '=' : BASE64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    encoded += c === undefined ? '=' : BASE64_ALPHABET[c & 63];
  }
  return `sha256-${encoded}`;
}

function positiveInteger(value, path) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${path} must be a positive integer`);
  return value;
}

function normalizeSpeakerProbe(value, path) {
  assertKnownKeys(value, SPEAKER_PROBE_KEYS, path);
  assertKnownKeys(value.thresholds, SPEAKER_THRESHOLD_KEYS, `${path}.thresholds`);
  let thresholds = {
    enrolledDistanceMax: numberInRange(value.thresholds.enrolledDistanceMax, 0, 2, `${path}.thresholds.enrolledDistanceMax`),
    otherVoiceMarginMin: numberInRange(value.thresholds.otherVoiceMarginMin, -2, 2, `${path}.thresholds.otherVoiceMarginMin`),
    segmentDistanceMax: numberInRange(value.thresholds.segmentDistanceMax, 0, 2, `${path}.thresholds.segmentDistanceMax`),
  };
  let result = {
    probeFamily: safeToken(value.probeFamily, `${path}.probeFamily`),
    probeVersionToken: digest(value.probeVersionToken, `${path}.probeVersionToken`),
    enrollmentRevision: digest(value.enrollmentRevision, `${path}.enrollmentRevision`),
    segmentationRevision: safeToken(value.segmentationRevision, `${path}.segmentationRevision`),
    segmentCount: positiveInteger(value.segmentCount, `${path}.segmentCount`),
    enrolledVoiceMatch: requiredBoolean(value.enrolledVoiceMatch, `${path}.enrolledVoiceMatch`),
    segmentsConsistent: requiredBoolean(value.segmentsConsistent, `${path}.segmentsConsistent`),
    maxEnrolledDistance: numberInRange(value.maxEnrolledDistance, 0, 2, `${path}.maxEnrolledDistance`),
    minOtherVoiceMargin: numberInRange(value.minOtherVoiceMargin, -2, 2, `${path}.minOtherVoiceMargin`),
    maxSegmentDistance: numberInRange(value.maxSegmentDistance, 0, 2, `${path}.maxSegmentDistance`),
    thresholds,
  };
  if (!result.enrolledVoiceMatch) throw new TypeError(`${path}.enrolledVoiceMatch must be true`);
  if (!result.segmentsConsistent) throw new TypeError(`${path}.segmentsConsistent must be true`);
  if (result.maxEnrolledDistance > thresholds.enrolledDistanceMax) {
    throw new TypeError(`${path}.maxEnrolledDistance must not exceed thresholds.enrolledDistanceMax`);
  }
  if (result.minOtherVoiceMargin < thresholds.otherVoiceMarginMin) {
    throw new TypeError(`${path}.minOtherVoiceMargin must meet thresholds.otherVoiceMarginMin`);
  }
  if (result.maxSegmentDistance > thresholds.segmentDistanceMax) {
    throw new TypeError(`${path}.maxSegmentDistance must not exceed thresholds.segmentDistanceMax`);
  }
  return result;
}

function normalizeNormalization(value, path) {
  assertKnownKeys(value, NORMALIZATION_KEYS, path);
  return {
    version: safeToken(value.version, `${path}.version`),
    applied: requiredBoolean(value.applied, `${path}.applied`),
    targetLufs: numberInRange(value.targetLufs, -40, -5, `${path}.targetLufs`),
    truePeakLimitDbfs: numberInRange(value.truePeakLimitDbfs, -12, 0, `${path}.truePeakLimitDbfs`),
  };
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function languageKey(value) {
  let text = requiredString(value, 'language').toLowerCase().split(/[-_]/u)[0];
  let aliases = {
    chinese: 'zh', english: 'en', french: 'fr', german: 'de', italian: 'it',
    japanese: 'ja', korean: 'ko', portuguese: 'pt', russian: 'ru', spanish: 'es',
  };
  return aliases[text] || text;
}

function normalizeReceipt(value, index) {
  let path = `manifest.synthesisEvidence.receipts[${index}]`;
  assertPortableFields(value, path);
  assertKnownKeys(value, RECEIPT_KEYS, path);
  let receiptVersion = requiredString(value.receiptVersion, `${path}.receiptVersion`);
  if (receiptVersion !== AUDIO_SYNTHESIS_RECEIPT_VERSION) {
    throw new TypeError(`${path}.receiptVersion must equal ${AUDIO_SYNTHESIS_RECEIPT_VERSION}`);
  }
  assertKnownKeys(value.model, MODEL_KEYS, `${path}.model`);
  return {
    receiptVersion,
    requestHash: digest(value.requestHash, `${path}.requestHash`),
    requestedVoiceRef: requiredString(value.requestedVoiceRef, `${path}.requestedVoiceRef`),
    ...(value.resolvedVoiceRef === undefined ? {} : {
      resolvedVoiceRef: requiredString(value.resolvedVoiceRef, `${path}.resolvedVoiceRef`),
    }),
    speakerAttestation: requiredString(value.speakerAttestation, `${path}.speakerAttestation`),
    model: {
      family: requiredString(value.model.family, `${path}.model.family`),
      versionToken: requiredString(value.model.versionToken, `${path}.model.versionToken`),
    },
    language: requiredString(value.language, `${path}.language`),
    sampleRate: positiveInteger(value.sampleRate, `${path}.sampleRate`),
    durationMs: positiveInteger(value.durationMs, `${path}.durationMs`),
    artifactHash: digest(value.artifactHash, `${path}.artifactHash`),
    receiptHmac: digest(value.receiptHmac, `${path}.receiptHmac`),
    speakerProbe: normalizeSpeakerProbe(value.speakerProbe, `${path}.speakerProbe`),
    normalization: normalizeNormalization(value.normalization, `${path}.normalization`),
  };
}

export function createMediaSynthesisEvidence(input = {}, context = {}) {
  assertKnownKeys(input, SYNTHESIS_KEYS, 'manifest.synthesisEvidence');
  let identityClaim = requiredString(input.identityClaim, 'manifest.synthesisEvidence.identityClaim');
  if (!MEDIA_SPEAKER_IDENTITY_CLAIMS.includes(identityClaim)) {
    throw new TypeError(`manifest.synthesisEvidence.identityClaim has unsupported value "${identityClaim}"`);
  }
  if (!Array.isArray(input.turns)) throw new TypeError('manifest.synthesisEvidence.turns must be an array');
  if (!Array.isArray(input.receipts)) throw new TypeError('manifest.synthesisEvidence.receipts must be an array');
  let turns = input.turns.map((value, index) => {
    let path = `manifest.synthesisEvidence.turns[${index}]`;
    assertKnownKeys(value, TURN_KEYS, path);
    return {
      turnId: requiredString(value.turnId, `${path}.turnId`),
      persona: requiredString(value.persona, `${path}.persona`),
      artifactRef: requiredString(value.artifactRef, `${path}.artifactRef`),
      receiptRef: digest(value.receiptRef, `${path}.receiptRef`),
    };
  });
  let receipts = input.receipts.map(normalizeReceipt);
  let audioNodes = (context.artifactGraph?.nodes || []).filter((node) => node.kind === 'audio-turn');
  if (!audioNodes.length) throw new TypeError('audio-enabled media evidence requires at least one audio-turn artifact');
  let audioByRef = new Map(audioNodes.map((node) => [node.logicalId, node]));
  let voices = context.voices || [];
  let voiceByPersona = new Map();
  let voiceRefs = new Set();
  for (let voice of voices) {
    if (voiceByPersona.has(voice.persona)) throw new TypeError(`manifest.provenance.voices contains duplicate persona: ${voice.persona}`);
    if (voiceRefs.has(voice.voiceRef)) throw new TypeError(`manifest.provenance.voices must map each spoken persona to a unique voiceRef: ${voice.voiceRef}`);
    voiceByPersona.set(voice.persona, voice);
    voiceRefs.add(voice.voiceRef);
  }
  let receiptsByRef = new Map();
  for (let receipt of receipts) {
    if (receiptsByRef.has(receipt.requestHash)) throw new TypeError(`duplicate synthesis receipt requestHash: ${receipt.requestHash}`);
    receiptsByRef.set(receipt.requestHash, receipt);
  }
  let turnIds = new Set();
  let artifactRefs = new Set();
  let receiptRefs = new Set();
  for (let turn of turns) {
    if (turnIds.has(turn.turnId)) throw new TypeError(`duplicate synthesis turnId: ${turn.turnId}`);
    if (artifactRefs.has(turn.artifactRef)) throw new TypeError(`duplicate synthesis artifactRef: ${turn.artifactRef}`);
    if (receiptRefs.has(turn.receiptRef)) throw new TypeError(`duplicate synthesis receiptRef: ${turn.receiptRef}`);
    turnIds.add(turn.turnId);
    artifactRefs.add(turn.artifactRef);
    receiptRefs.add(turn.receiptRef);
    let node = audioByRef.get(turn.artifactRef);
    if (!node) throw new TypeError(`synthesis turn ${turn.turnId} references unknown audio-turn artifact: ${turn.artifactRef}`);
    let receipt = receiptsByRef.get(turn.receiptRef);
    if (!receipt) throw new TypeError(`synthesis turn ${turn.turnId} references unknown receipt: ${turn.receiptRef}`);
    let voice = voiceByPersona.get(turn.persona);
    if (!voice) throw new TypeError(`spoken persona ${turn.persona} has no voice provenance`);
    if (receipt.requestedVoiceRef !== voice.voiceRef) throw new TypeError(`synthesis turn ${turn.turnId} requestedVoiceRef does not match voice provenance`);
    if (receipt.resolvedVoiceRef && !voiceRefs.has(receipt.resolvedVoiceRef)) {
      throw new TypeError(`synthesis turn ${turn.turnId} resolvedVoiceRef is absent from voice provenance`);
    }
    if (node.versions.voice !== voice.voiceRef) throw new TypeError(`synthesis turn ${turn.turnId} audio versions.voice does not match voice provenance`);
    if (node.outputHash !== digestIntegrity(receipt.artifactHash)) throw new TypeError(`synthesis turn ${turn.turnId} receipt artifactHash does not match audio outputHash`);
    if (context.language && languageKey(receipt.language) !== languageKey(context.language)) {
      throw new TypeError(`synthesis turn ${turn.turnId} receipt language does not match media settings`);
    }
  }
  if (!sameSet(artifactRefs, new Set(audioByRef.keys()))) {
    throw new TypeError('manifest.synthesisEvidence.turns must cover every audio-turn artifact exactly once');
  }
  if (!sameSet(receiptRefs, new Set(receiptsByRef.keys()))) {
    throw new TypeError('manifest.synthesisEvidence.turns must reference every synthesis receipt exactly once');
  }
  let spokenPersonas = new Set(turns.map((turn) => turn.persona));
  if (!sameSet(spokenPersonas, new Set(voiceByPersona.keys()))) {
    throw new TypeError('spoken personas must equal manifest.provenance.voices personas');
  }
  return { identityClaim, turns, receipts };
}

export function validateMediaSynthesisEvidence(input = {}, context = {}) {
  try {
    createMediaSynthesisEvidence(input, context);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error?.message || String(error)] };
  }
}
