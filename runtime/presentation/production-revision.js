import { canonicalize, computeIntegrity, isIntegrityString } from '../../schema/canonical-json.js';
import { assertPortableValue } from '../portable-value.js';
import { validatePresentationJourney } from '../presentation-journey.js';
import { validatePresentationAlignedSequence } from './align.js';
import { createPresentationTimelineContract } from './contract.js';
import {
  createPresenterActionSchedule,
  getSemanticKey,
  validatePresenterActionSchedule,
} from './presenter-schedule.js';
import { createSemanticScript, createVoicePlan } from './script-lineage.js';
import {
  createTranscriptWordAnchoring,
  resolveTranscriptWordAnchor,
} from './transcript-word-anchoring.js';

export const PRODUCTION_REVISION_SCHEMA_VERSION = 'workspace-production-revision-v1';
export const PRODUCTION_SKELETON_SCHEMA_VERSION = 'workspace-production-skeleton-v1';
export const AUDIO_CLIP_SCHEMA_VERSION = 'workspace-audio-clip-v1';
export const AUDIO_EVIDENCE_SCHEMA_VERSION = 'workspace-audio-evidence-v1';
export const ACTION_RECEIPT_SCHEMA_VERSION = 'workspace-action-receipt-v1';
export const REGISTERED_TARGET_SCHEMA_VERSION = 'workspace-registered-target-v1';
export const OUTCOME_CLAIM_SCHEMA_VERSION = 'workspace-outcome-claim-v1';
export const COVERAGE_ROW_SCHEMA_VERSION = 'workspace-process-coverage-row-v1';
export const CAUSAL_EVIDENCE_SCHEMA_VERSION = 'workspace-causal-evidence-v1';
export const CAUSAL_EVIDENCE_SET_SCHEMA_VERSION = 'workspace-causal-evidence-set-v1';
export const PREVIEW_EVIDENCE_SCHEMA_VERSION = 'workspace-preview-evidence-v1';
export const AGENT_ACCEPTANCE_SCHEMA_VERSION = 'workspace-agent-acceptance-v1';
export const FINAL_EXPORT_ASSERTION_SCHEMA_VERSION = 'workspace-final-export-assertion-v1';
export const MIX_TRANSCRIPT_SEPARATOR = '\n';

const INSPECTION_SCHEMA_VERSION = 'workspace-inspection-v1';
const NEARBY_EMPHASIS_WINDOW_MS = 5000;
const PRE_ACTION_WINDOW_MS = 1500;

const AUDIO_JUDGMENT_KINDS = Object.freeze([
  'correspondence',
  'punctuation-phrasing',
  'contour',
  'pauses',
  'speaker-continuity',
  'dialogue-flow',
]);
const AUDIO_JUDGMENT_KIND_SET = new Set(AUDIO_JUDGMENT_KINDS);

export class ProductionRevisionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductionRevisionError';
  }
}

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

function nonempty(value, path) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new TypeError(`${path} must be nonempty text without edge whitespace`);
  }
  return value.normalize('NFC');
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${path} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function positiveNumber(value, path) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${path} must be a positive finite number`);
  return value;
}

function identity(value, version, path) {
  let prefix = `${version}:`;
  if (typeof value !== 'string' || !value.startsWith(prefix)
    || !isIntegrityString(value.slice(prefix.length))) {
    throw new TypeError(`${path} must be a ${version} canonical identity`);
  }
  return value;
}

function canonical(version, payload, idKey = 'id') {
  return { ...payload, [idKey]: `${version}:${computeIntegrity(payload)}` };
}

function assertCanonical(value, expected, path, idKey = 'id') {
  if (canonicalize(value) !== canonicalize(expected)) {
    throw new TypeError(`${path} does not match its canonical reconstruction`);
  }
  identity(value[idKey], expected.schemaVersion, `${path}.${idKey}`);
  return expected;
}

function unique(values, path) {
  if (new Set(values).size !== values.length) throw new TypeError(`${path} must not contain duplicates`);
  return values;
}

function canonicalJourneyHash(journey) {
  let validation = validatePresentationJourney(journey);
  if (!validation.ok) throw new ProductionRevisionError('production revision journey is invalid');
  return `${journey.schemaVersion}:${journey.contentHash}`;
}

export function createAudioClipDescriptor(input = {}) {
  let source = record(input, 'audioClip');
  exactKeys(source, [
    'schemaVersion', 'turnId', 'text', 'speaker', 'voice', 'language', 'modelName',
    'modelVersion', 'style', 'revision', 'id',
  ], 'audioClip');
  let payload = {
    schemaVersion: AUDIO_CLIP_SCHEMA_VERSION,
    turnId: nonempty(source.turnId, 'audioClip.turnId'),
    text: nonempty(source.text, 'audioClip.text'),
    speaker: nonempty(source.speaker, 'audioClip.speaker'),
    voice: nonempty(source.voice, 'audioClip.voice'),
    language: nonempty(source.language, 'audioClip.language'),
    modelName: nonempty(source.modelName, 'audioClip.modelName'),
    modelVersion: nonempty(source.modelVersion, 'audioClip.modelVersion'),
    style: nonempty(source.style, 'audioClip.style'),
    revision: nonempty(source.revision, 'audioClip.revision'),
  };
  let result = canonical(AUDIO_CLIP_SCHEMA_VERSION, payload);
  if (source.id !== undefined && source.id !== result.id) {
    throw new TypeError('audioClip.id does not match its canonical content');
  }
  return result;
}

export const createAudioClipIdentity = createAudioClipDescriptor;

export function clipInvalidationProjection(oldState = {}, changedClips = []) {
  if (!changedClips.length) return oldState;
  let changedIds = new Set(changedClips.map((clip) => clip?.id || clip));
  return {
    ...oldState,
    clips: (oldState.clips || []).filter((clip) => !changedIds.has(clip.id)),
    clipEvidence: undefined,
    mixEvidence: undefined,
    alignedSequence: undefined,
    skeleton: undefined,
    causalSet: undefined,
    inspection: undefined,
    preview: undefined,
    agentAcceptance: undefined,
    output: undefined,
  };
}

function createAudioWord(input, index, durationMs, priorEndMs) {
  let path = `audioEvidence.words[${index}]`;
  let source = record(input, path);
  exactKeys(source, ['text', 'startMs', 'endMs'], path);
  let startMs = integer(source.startMs, `${path}.startMs`, { min: priorEndMs, max: durationMs });
  let endMs = integer(source.endMs, `${path}.endMs`, { min: startMs + 1, max: durationMs });
  return { text: nonempty(source.text, `${path}.text`), startMs, endMs };
}

function createAudioJudgment(input, index) {
  let path = `audioEvidence.judgments[${index}]`;
  let source = record(input, path);
  exactKeys(source, ['kind', 'providerId', 'agentId', 'passed', 'evidenceHash'], path);
  let kind = nonempty(source.kind, `${path}.kind`);
  if (!AUDIO_JUDGMENT_KIND_SET.has(kind)) throw new TypeError(`${path}.kind is unsupported`);
  if (typeof source.passed !== 'boolean') throw new TypeError(`${path}.passed must be boolean`);
  return {
    kind,
    providerId: nonempty(source.providerId, `${path}.providerId`),
    agentId: nonempty(source.agentId, `${path}.agentId`),
    passed: source.passed,
    evidenceHash: identity(source.evidenceHash, 'workspace-audio-judgment-v1', `${path}.evidenceHash`),
  };
}

export function createAudioEvidence(input = {}) {
  let source = record(input, 'audioEvidence');
  exactKeys(source, [
    'schemaVersion', 'type', 'artifactId', 'artifactHash', 'durationMs', 'clipId',
    'turnId', 'constituentClipIds', 'authoredTranscript', 'whisperTranscript', 'words',
    'judgments', 'accepted', 'id',
  ], 'audioEvidence');
  let type = nonempty(source.type, 'audioEvidence.type');
  if (!['clip', 'mix'].includes(type)) throw new TypeError('audioEvidence.type must be clip or mix');
  let durationMs = positiveNumber(source.durationMs, 'audioEvidence.durationMs');
  if (!Array.isArray(source.words) || !source.words.length) {
    throw new TypeError('audioEvidence.words must contain at least one timed word');
  }
  let words = [];
  let priorEndMs = 0;
  for (let [index, word] of source.words.entries()) {
    let normalized = createAudioWord(word, index, durationMs, priorEndMs);
    words.push(normalized);
    priorEndMs = normalized.endMs;
  }
  if (!Array.isArray(source.judgments) || source.judgments.length !== AUDIO_JUDGMENT_KINDS.length) {
    throw new TypeError('audioEvidence.judgments must contain every required judgment exactly once');
  }
  let judgments = source.judgments.map(createAudioJudgment);
  unique(judgments.map((judgment) => judgment.kind), 'audioEvidence.judgments');
  for (let kind of AUDIO_JUDGMENT_KINDS) {
    if (!judgments.some((judgment) => judgment.kind === kind)) {
      throw new TypeError(`audioEvidence.judgments is missing ${kind}`);
    }
  }
  let authoredTranscript = nonempty(source.authoredTranscript, 'audioEvidence.authoredTranscript');
  let whisperTranscript = nonempty(source.whisperTranscript, 'audioEvidence.whisperTranscript');
  let transcriptAnchoring = createTranscriptWordAnchoring({
    authoredTranscript,
    observedTranscript: whisperTranscript,
    observedWords: words,
  });
  if (!transcriptAnchoring.observedWordsMatch) {
    throw new TypeError('audioEvidence Whisper transcript does not exactly match its timed words');
  }
  let accepted = judgments.every((judgment) => judgment.passed);
  if (source.accepted !== undefined && source.accepted !== accepted) {
    throw new TypeError('audioEvidence.accepted does not match judgment evidence');
  }
  let payload = {
    schemaVersion: AUDIO_EVIDENCE_SCHEMA_VERSION,
    type,
    artifactId: identity(source.artifactId, 'workspace-artifact-v1', 'audioEvidence.artifactId'),
    artifactHash: identity(source.artifactHash, 'workspace-artifact-v1', 'audioEvidence.artifactHash'),
    durationMs,
    ...(type === 'clip' ? {
      clipId: identity(source.clipId, AUDIO_CLIP_SCHEMA_VERSION, 'audioEvidence.clipId'),
      turnId: nonempty(source.turnId, 'audioEvidence.turnId'),
    } : {
      constituentClipIds: unique((source.constituentClipIds || []).map((clipId, index) => (
        identity(clipId, AUDIO_CLIP_SCHEMA_VERSION, `audioEvidence.constituentClipIds[${index}]`)
      )), 'audioEvidence.constituentClipIds'),
    }),
    authoredTranscript,
    whisperTranscript,
    words,
    judgments,
    accepted,
  };
  if (type === 'mix' && !payload.constituentClipIds.length) {
    throw new TypeError('mix audio evidence requires constituentClipIds');
  }
  let result = canonical(AUDIO_EVIDENCE_SCHEMA_VERSION, payload);
  if (source.id !== undefined && source.id !== result.id) {
    throw new TypeError('audioEvidence.id does not match its canonical content');
  }
  return result;
}

export function validateAudioEvidence(value = {}) {
  assertPortableValue(value, 'audioEvidence');
  return assertCanonical(value, createAudioEvidence(value), 'audioEvidence');
}

function resolveExecutableActionFacts(timeline, semanticScriptInput, actionOwnershipInput) {
  let semanticScript = createSemanticScript(semanticScriptInput);
  let executable = timeline.turns.flatMap((turn, turnIndex) => turn.cues
    .map((cue, cueIndex) => ({ cue, turn, cueId: `${turnIndex}.${cueIndex}` }))
    .filter(({ cue }) => cue.kind === 'interaction'));
  if (!Array.isArray(actionOwnershipInput) || actionOwnershipInput.length !== executable.length) {
    throw new ProductionRevisionError('production skeleton requires one action owner per executable interaction');
  }
  let actionOwnership = actionOwnershipInput.map(createActionOwnership);
  unique(actionOwnership.map((action) => action.cueId), 'productionSkeleton.actionOwnership.cueId');
  unique(actionOwnership.map((action) => action.actionId), 'productionSkeleton.actionOwnership.actionId');
  return actionOwnership.map((action, index) => {
    let expected = executable[index];
    let mechanism = nonempty(
      expected.cue.interaction?.type,
      `timeline cue ${expected.cueId}.interaction.type`,
    );
    if (action.cueId !== expected.cueId || action.turnId !== expected.turn.id
      || action.targetId !== expected.cue.targetId || action.interactionType !== mechanism
      || action.visualMechanism !== mechanism) {
      throw new ProductionRevisionError(`production skeleton action ownership does not match executable cue at index ${index}`);
    }
    let semanticTurn = semanticScript.turns.find((turn) => turn.id === action.turnId);
    if (!semanticTurn?.actionRefs.includes(action.actionId)
      || !semanticTurn.targetRefs.includes(action.targetId)) {
      throw new ProductionRevisionError(`production skeleton action ownership is absent from semantic turn ${action.turnId}`);
    }
    return action;
  });
}

function skeletonEventFacts(timeline, alignedSequence, actionOwnership) {
  let actionByCueId = new Map(actionOwnership.map((action) => [action.cueId, action]));
  return alignedSequence.events.map((event) => {
    let [turnIndexText, cueIndexText] = event.cueId.split('.');
    let turnIndex = Number(turnIndexText);
    let cueIndex = Number(cueIndexText);
    let turn = timeline.turns[turnIndex];
    let cue = turn?.cues?.[cueIndex];
    if (!cue) throw new TypeError(`aligned event ${event.cueId} has no authored cue`);
    let semanticKey = getSemanticKey(cue, turn.id);
    let structuralTarget = cue.targetId || cue.tabId || cue.state?.path;
    let action = cue.kind === 'interaction' ? actionByCueId.get(event.cueId) : null;
    if (cue.kind === 'interaction' && !action) {
      throw new ProductionRevisionError(`production skeleton event ${event.cueId} has no semantic action ownership`);
    }
    return {
      cueId: event.cueId,
      turnId: turn.id,
      kind: cue.kind,
      targetId: nonempty(structuralTarget, `timeline cue ${event.cueId}.structuralTarget`),
      actionId: action?.actionId || null,
      semanticIntent: action?.semanticIntent
        || nonempty(semanticKey.variant || cue.kind, `timeline cue ${event.cueId}.intent`),
      visualMechanism: nonempty(semanticKey.variant || cue.kind, `timeline cue ${event.cueId}.mechanism`),
      interactionType: cue.kind === 'interaction' ? nonempty(cue.interaction?.type, `timeline cue ${event.cueId}.interaction.type`) : null,
      startMs: event.startMs,
      endMs: event.endMs,
      resolution: event.resolution,
      confidence: event.confidence,
    };
  });
}

export function createProductionSkeleton(timelineInput, alignedInput, mixInput, options = {}) {
  let timeline = createPresentationTimelineContract(timelineInput);
  let alignedSequence = validatePresentationAlignedSequence(alignedInput, timeline);
  let mixEvidence = validateAudioEvidence(mixInput);
  if (mixEvidence.type !== 'mix' || !mixEvidence.accepted) {
    throw new ProductionRevisionError('production skeleton requires accepted mix evidence');
  }
  if (alignedSequence.media.hash !== mixEvidence.artifactHash
    || alignedSequence.media.durationMs !== mixEvidence.durationMs) {
    throw new ProductionRevisionError('aligned media must exactly match accepted mix artifact and duration');
  }
  let source = record(options, 'productionSkeleton.options');
  exactKeys(source, [
    'pointDurationMs', 'gapMs', 'semanticScript', 'actionOwnership',
  ], 'productionSkeleton.options');
  let scheduleOptions = {
    pointDurationMs: integer(source.pointDurationMs, 'productionSkeleton.options.pointDurationMs', { min: 1 }),
    gapMs: integer(source.gapMs, 'productionSkeleton.options.gapMs', { min: 1 }),
  };
  let schedule = createPresenterActionSchedule(timeline, alignedSequence, scheduleOptions);
  let semanticScript = createSemanticScript(source.semanticScript);
  let actionOwnership = resolveExecutableActionFacts(
    timeline,
    semanticScript,
    source.actionOwnership,
  );
  let payload = {
    schemaVersion: PRODUCTION_SKELETON_SCHEMA_VERSION,
    timelineHash: timeline.hash,
    alignedSequenceHash: alignedSequence.hash,
    audioEvidenceId: mixEvidence.id,
    semanticScriptHash: semanticScript.hash,
    scheduleOptions,
    schedule,
    eventFacts: skeletonEventFacts(timeline, alignedSequence, actionOwnership),
  };
  return canonical(PRODUCTION_SKELETON_SCHEMA_VERSION, payload);
}

export function validateProductionSkeleton(value, timeline, alignedSequence, mixEvidence, authorityInput = {}) {
  let source = record(value, 'productionSkeleton');
  exactKeys(source, [
    'schemaVersion', 'timelineHash', 'alignedSequenceHash', 'audioEvidenceId',
    'semanticScriptHash', 'scheduleOptions', 'schedule', 'eventFacts', 'id',
  ], 'productionSkeleton');
  let authority = record(authorityInput, 'productionSkeleton.authority');
  exactKeys(authority, ['semanticScript', 'actionOwnership'], 'productionSkeleton.authority');
  let expected = createProductionSkeleton(timeline, alignedSequence, mixEvidence, {
    ...source.scheduleOptions,
    semanticScript: authority.semanticScript,
    actionOwnership: authority.actionOwnership,
  });
  validatePresenterActionSchedule(source.schedule, timeline, alignedSequence);
  return assertCanonical(source, expected, 'productionSkeleton');
}

function createActionOwnership(input, index) {
  let path = `productionRevision.actionOwnership[${index}]`;
  let source = record(input, path);
  exactKeys(source, [
    'cueId', 'turnId', 'actionId', 'operatorId', 'targetId', 'interactionType',
    'semanticIntent', 'visualMechanism',
  ], path);
  return {
    cueId: nonempty(source.cueId, `${path}.cueId`),
    turnId: nonempty(source.turnId, `${path}.turnId`),
    actionId: nonempty(source.actionId, `${path}.actionId`),
    operatorId: nonempty(source.operatorId, `${path}.operatorId`),
    targetId: nonempty(source.targetId, `${path}.targetId`),
    interactionType: nonempty(source.interactionType, `${path}.interactionType`),
    semanticIntent: nonempty(source.semanticIntent, `${path}.semanticIntent`),
    visualMechanism: nonempty(source.visualMechanism, `${path}.visualMechanism`),
  };
}

function createTurnOwnership(input, index) {
  let path = `productionRevision.turnOwnership[${index}]`;
  let source = record(input, path);
  exactKeys(source, [
    'turnId', 'persona', 'speaker', 'voice', 'language', 'modelName', 'modelVersion',
    'style', 'revision',
  ], path);
  return {
    turnId: nonempty(source.turnId, `${path}.turnId`),
    persona: nonempty(source.persona, `${path}.persona`),
    speaker: nonempty(source.speaker, `${path}.speaker`),
    voice: nonempty(source.voice, `${path}.voice`),
    language: nonempty(source.language, `${path}.language`),
    modelName: nonempty(source.modelName, `${path}.modelName`),
    modelVersion: nonempty(source.modelVersion, `${path}.modelVersion`),
    style: nonempty(source.style, `${path}.style`),
    revision: nonempty(source.revision, `${path}.revision`),
  };
}

export function createAcceptedReceipt(input = {}) {
  let source = record(input, 'actionReceipt');
  exactKeys(source, [
    'schemaVersion', 'actionId', 'targetId', 'terminalState', 'accepted', 'resultHash', 'id',
  ], 'actionReceipt');
  if (source.terminalState !== 'completed') throw new TypeError('actionReceipt.terminalState must be completed');
  if (source.accepted !== true) throw new TypeError('actionReceipt.accepted must be true');
  let payload = {
    schemaVersion: ACTION_RECEIPT_SCHEMA_VERSION,
    actionId: nonempty(source.actionId, 'actionReceipt.actionId'),
    targetId: nonempty(source.targetId, 'actionReceipt.targetId'),
    terminalState: 'completed',
    accepted: true,
    resultHash: identity(source.resultHash, 'workspace-result-v1', 'actionReceipt.resultHash'),
  };
  let result = canonical(ACTION_RECEIPT_SCHEMA_VERSION, payload);
  if (source.id !== undefined && source.id !== result.id) throw new TypeError('actionReceipt.id is stale');
  return result;
}

export function createRegisteredTarget(input = {}) {
  let source = record(input, 'registeredTarget');
  exactKeys(source, ['schemaVersion', 'targetId', 'registeredState', 'stateHash', 'id'], 'registeredTarget');
  if (source.registeredState !== 'registered') {
    throw new TypeError('registeredTarget.registeredState must be registered');
  }
  let payload = {
    schemaVersion: REGISTERED_TARGET_SCHEMA_VERSION,
    targetId: nonempty(source.targetId, 'registeredTarget.targetId'),
    registeredState: 'registered',
    stateHash: identity(source.stateHash, 'workspace-state-v1', 'registeredTarget.stateHash'),
  };
  let result = canonical(REGISTERED_TARGET_SCHEMA_VERSION, payload);
  if (source.id !== undefined && source.id !== result.id) throw new TypeError('registeredTarget.id is stale');
  return result;
}

export function createOutcomeClaim(input = {}) {
  let source = record(input, 'outcomeClaim');
  exactKeys(source, [
    'schemaVersion', 'claimId', 'turnId', 'actionId', 'receiptId', 'targetId',
    'outcomeAnchor', 'outcomeWordStartMs', 'id',
  ], 'outcomeClaim');
  let anchor = record(source.outcomeAnchor, 'outcomeClaim.outcomeAnchor');
  exactKeys(anchor, ['quote', 'occurrence', 'edge'], 'outcomeClaim.outcomeAnchor');
  if (anchor.edge !== 'start') throw new TypeError('outcomeClaim.outcomeAnchor.edge must be start');
  let payload = {
    schemaVersion: OUTCOME_CLAIM_SCHEMA_VERSION,
    claimId: nonempty(source.claimId, 'outcomeClaim.claimId'),
    turnId: nonempty(source.turnId, 'outcomeClaim.turnId'),
    actionId: nonempty(source.actionId, 'outcomeClaim.actionId'),
    receiptId: identity(source.receiptId, ACTION_RECEIPT_SCHEMA_VERSION, 'outcomeClaim.receiptId'),
    targetId: nonempty(source.targetId, 'outcomeClaim.targetId'),
    outcomeAnchor: {
      quote: nonempty(anchor.quote, 'outcomeClaim.outcomeAnchor.quote'),
      occurrence: integer(anchor.occurrence, 'outcomeClaim.outcomeAnchor.occurrence', { min: 1 }),
      edge: 'start',
    },
    outcomeWordStartMs: integer(source.outcomeWordStartMs, 'outcomeClaim.outcomeWordStartMs'),
  };
  let result = canonical(OUTCOME_CLAIM_SCHEMA_VERSION, payload);
  if (source.id !== undefined && source.id !== result.id) throw new TypeError('outcomeClaim.id is stale');
  return result;
}

export function createCoverageRow(input = {}) {
  let source = record(input, 'coverageRow');
  let type = nonempty(source.type, 'coverageRow.type');
  if (type === 'surface') {
    exactKeys(source, [
      'schemaVersion', 'type', 'surfaceId', 'audienceQuestion', 'reason',
      'operationOrObservation', 'enabledOutcome', 'order', 'id',
    ], 'coverageRow');
  } else if (type === 'synthesis') {
    exactKeys(source, ['schemaVersion', 'type', 'synthesisText', 'order', 'id'], 'coverageRow');
  } else {
    throw new TypeError('coverageRow.type must be surface or synthesis');
  }
  let payload = {
    schemaVersion: COVERAGE_ROW_SCHEMA_VERSION,
    type,
    ...(type === 'surface' ? {
      surfaceId: nonempty(source.surfaceId, 'coverageRow.surfaceId'),
      audienceQuestion: nonempty(source.audienceQuestion, 'coverageRow.audienceQuestion'),
      reason: nonempty(source.reason, 'coverageRow.reason'),
      operationOrObservation: nonempty(source.operationOrObservation, 'coverageRow.operationOrObservation'),
      enabledOutcome: nonempty(source.enabledOutcome, 'coverageRow.enabledOutcome'),
    } : {
      synthesisText: nonempty(source.synthesisText, 'coverageRow.synthesisText'),
    }),
    order: integer(source.order, 'coverageRow.order'),
  };
  let result = canonical(COVERAGE_ROW_SCHEMA_VERSION, payload);
  if (source.id !== undefined && source.id !== result.id) throw new TypeError('coverageRow.id is stale');
  return result;
}

function validateVoiceOwnership(semanticScript, voicePlan, timeline, clips) {
  let arrays = [
    voicePlan.speakerRefs,
    voicePlan.personaRefs,
    voicePlan.voiceRefs,
    voicePlan.deliveryRefs,
  ];
  if (!arrays[0].length || arrays.some((values) => values.length !== arrays[0].length)) {
    throw new ProductionRevisionError('voice plan speaker, persona, and voice counts must match and be nonempty');
  }
  unique(voicePlan.speakerRefs, 'voicePlan.speakerRefs');
  unique(voicePlan.personaRefs, 'voicePlan.personaRefs');
  unique(voicePlan.voiceRefs, 'voicePlan.voiceRefs');
  if (semanticScript.turns.length !== timeline.turns.length || clips.length !== timeline.turns.length) {
    throw new ProductionRevisionError('semantic, timeline, and clip counts must match');
  }
  return timeline.turns.map((turn, index) => {
    let semanticTurn = semanticScript.turns[index];
    let clip = clips[index];
    if (semanticTurn.id !== turn.id || clip.turnId !== turn.id) {
      throw new ProductionRevisionError(`turn identity mismatch at index ${index}`);
    }
    if (semanticTurn.text !== turn.text || clip.text !== turn.text) {
      throw new ProductionRevisionError(`turn text mismatch at index ${index}`);
    }
    let voiceIndex = voicePlan.personaRefs.indexOf(turn.persona);
    if (voiceIndex < 0) throw new ProductionRevisionError(`timeline persona has no voice owner at index ${index}`);
    let speaker = voicePlan.speakerRefs[voiceIndex];
    let voice = voicePlan.voiceRefs[voiceIndex];
    let style = voicePlan.deliveryRefs[voiceIndex];
    if (!speaker || !voice) throw new ProductionRevisionError(`semantic speaker ownership is empty at index ${index}`);
    if (clip.speaker !== speaker || clip.voice !== voice || clip.language !== semanticScript.locale
      || clip.style !== style) {
      throw new ProductionRevisionError(`clip voice ownership mismatch at index ${index}`);
    }
    return {
      turnId: turn.id,
      persona: turn.persona,
      speaker,
      voice,
      language: semanticScript.locale,
      modelName: clip.modelName,
      modelVersion: clip.modelVersion,
      style,
      revision: clip.revision,
    };
  });
}

function validateCoverage(inScopeSurfaceIds, coverage) {
  if (!Array.isArray(inScopeSurfaceIds) || !inScopeSurfaceIds.length) {
    throw new ProductionRevisionError('production revision requires nonempty inScopeSurfaceIds');
  }
  let surfaces = inScopeSurfaceIds.map((surfaceId, index) => (
    nonempty(surfaceId, `productionRevision.inScopeSurfaceIds[${index}]`)
  ));
  unique(surfaces, 'productionRevision.inScopeSurfaceIds');
  if (!Array.isArray(coverage) || coverage.length !== surfaces.length + 1) {
    throw new ProductionRevisionError('coverage requires one row per surface and one final synthesis');
  }
  let rows = coverage.map(createCoverageRow);
  rows.forEach((row, index) => {
    if (row.order !== index) throw new ProductionRevisionError('coverage order must be contiguous from zero');
  });
  let surfaceRows = rows.filter((row) => row.type === 'surface');
  let synthesisRows = rows.filter((row) => row.type === 'synthesis');
  if (synthesisRows.length !== 1 || rows.at(-1).type !== 'synthesis') {
    throw new ProductionRevisionError('coverage requires exactly one final synthesis row');
  }
  if (canonicalize(surfaceRows.map((row) => row.surfaceId)) !== canonicalize(surfaces)) {
    throw new ProductionRevisionError('coverage surface rows must exactly match ordered scope');
  }
  return { surfaces, rows };
}

function resolveClaimWord(claim, timeline, alignedSequence) {
  let turnIndex = timeline.turns.findIndex((turn) => turn.id === claim.turnId);
  if (turnIndex < 0) throw new ProductionRevisionError(`claim ${claim.claimId} references unknown turn`);
  let words = alignedSequence.turns[turnIndex].words;
  let word = resolveTranscriptWordAnchor(
    words,
    claim.outcomeAnchor.quote,
    claim.outcomeAnchor.occurrence,
    claim.outcomeAnchor.edge,
  );
  if (!word || word.startMs !== claim.outcomeWordStartMs) {
    throw new ProductionRevisionError(`claim ${claim.claimId} does not resolve to an exact aligned word boundary`);
  }
  return word;
}

export function createProductionRevision(input = {}) {
  let source = record(input, 'productionRevision');
  exactKeys(source, [
    'schemaVersion', 'journey', 'semanticScript', 'voicePlan', 'timeline', 'clips',
    'clipEvidence', 'mixEvidence', 'alignedSequence', 'skeleton', 'turnOwnership', 'actionOwnership',
    'inScopeSurfaceIds', 'receipts', 'targets', 'claims', 'coverage', 'id',
  ], 'productionRevision');
  let journeyHash = canonicalJourneyHash(source.journey);
  let semanticScript = createSemanticScript(source.semanticScript);
  if (source.semanticScript.hash !== undefined && source.semanticScript.hash !== semanticScript.hash) {
    throw new ProductionRevisionError('semantic script hash does not match content');
  }
  if (semanticScript.journeyHash !== journeyHash) {
    throw new ProductionRevisionError('semantic script journey identity does not match journey contentHash');
  }
  let voicePlan = createVoicePlan(source.voicePlan);
  if (source.voicePlan.hash !== undefined && source.voicePlan.hash !== voicePlan.hash) {
    throw new ProductionRevisionError('voice plan hash does not match content');
  }
  if (voicePlan.semanticHash !== semanticScript.hash) {
    throw new ProductionRevisionError('voice plan semantic identity does not match semantic script');
  }
  let timeline = createPresentationTimelineContract(source.timeline);
  let clips = (source.clips || []).map(createAudioClipDescriptor);
  unique(clips.map((clip) => clip.id), 'productionRevision.clips');
  let expectedTurnOwnership = validateVoiceOwnership(semanticScript, voicePlan, timeline, clips);
  if (!Array.isArray(source.turnOwnership)
    || source.turnOwnership.length !== expectedTurnOwnership.length) {
    throw new ProductionRevisionError('production revision requires one declared voice owner per turn');
  }
  let turnOwnership = source.turnOwnership.map(createTurnOwnership);
  if (canonicalize(turnOwnership) !== canonicalize(expectedTurnOwnership)) {
    throw new ProductionRevisionError('declared turn voice ownership does not match voice plan and clips');
  }

  if (!Array.isArray(source.clipEvidence) || source.clipEvidence.length !== clips.length) {
    throw new ProductionRevisionError('production revision requires one clip evidence per clip');
  }
  let clipEvidence = source.clipEvidence.map(validateAudioEvidence);
  for (let [index, evidence] of clipEvidence.entries()) {
    if (!evidence.accepted || evidence.type !== 'clip' || evidence.clipId !== clips[index].id
      || evidence.turnId !== clips[index].turnId || evidence.authoredTranscript !== clips[index].text) {
      throw new ProductionRevisionError(`clip evidence does not exactly match accepted clip at index ${index}`);
    }
  }
  unique(clipEvidence.map((evidence) => evidence.clipId), 'productionRevision.clipEvidence');
  let mixEvidence = validateAudioEvidence(source.mixEvidence);
  let expectedMixTranscript = clips.map((clip) => clip.text).join(MIX_TRANSCRIPT_SEPARATOR);
  if (!mixEvidence.accepted || mixEvidence.type !== 'mix'
    || canonicalize(mixEvidence.constituentClipIds) !== canonicalize(clips.map((clip) => clip.id))
    || mixEvidence.authoredTranscript !== expectedMixTranscript) {
    throw new ProductionRevisionError('mix evidence does not exactly match ordered accepted clips');
  }

  if (!source.alignedSequence) throw new ProductionRevisionError('production revision requires alignedSequence');
  let alignedSequence = validatePresentationAlignedSequence(source.alignedSequence, timeline);
  if (alignedSequence.turns.some((turn) => !turn.words.length)) {
    throw new ProductionRevisionError('production aligned sequence requires nonempty word boundaries for every turn');
  }
  if (!alignedSequence.voice || alignedSequence.turns.some((turn, index) => (
    turn.speaker !== turnOwnership[index].speaker
  ))) {
    throw new ProductionRevisionError('production aligned sequence speaker ownership must match the voice plan');
  }
  if (alignedSequence.media.hash !== mixEvidence.artifactHash
    || alignedSequence.media.durationMs !== mixEvidence.durationMs) {
    throw new ProductionRevisionError('aligned sequence media must match accepted mix evidence');
  }
  if (!Array.isArray(source.actionOwnership)) {
    throw new ProductionRevisionError('action ownership requires one row per executable interaction');
  }
  let actionOwnership = source.actionOwnership.map(createActionOwnership);
  unique(actionOwnership.map((action) => action.cueId), 'productionRevision.actionOwnership.cueId');
  unique(actionOwnership.map((action) => action.actionId), 'productionRevision.actionOwnership.actionId');
  if (!source.skeleton) throw new ProductionRevisionError('production revision requires production skeleton');
  let skeleton = validateProductionSkeleton(source.skeleton, timeline, alignedSequence, mixEvidence, {
    semanticScript,
    actionOwnership,
  });

  let executableFacts = skeleton.eventFacts.filter((fact) => fact.kind === 'interaction');
  if (actionOwnership.length !== executableFacts.length) {
    throw new ProductionRevisionError('action ownership requires one row per executable interaction');
  }
  for (let [index, action] of actionOwnership.entries()) {
    let fact = executableFacts[index];
    if (action.cueId !== fact.cueId || action.turnId !== fact.turnId
      || action.actionId !== fact.actionId || action.targetId !== fact.targetId
      || action.interactionType !== fact.interactionType
      || action.semanticIntent !== fact.semanticIntent
      || action.visualMechanism !== fact.visualMechanism) {
      throw new ProductionRevisionError(`action ownership does not match executable cue at index ${index}`);
    }
    let semanticTurn = semanticScript.turns.find((turn) => turn.id === action.turnId);
    if (!semanticTurn?.actionRefs.includes(action.actionId)
      || !semanticTurn.targetRefs.includes(action.targetId)) {
      throw new ProductionRevisionError(`action ownership is absent from semantic turn ${action.turnId}`);
    }
  }

  if (!Array.isArray(source.receipts) || source.receipts.length !== actionOwnership.length) {
    throw new ProductionRevisionError('production revision requires one accepted receipt per action');
  }
  let receipts = source.receipts.map(createAcceptedReceipt);
  unique(receipts.map((receipt) => receipt.actionId), 'productionRevision.receipts.actionId');
  let receiptByAction = new Map(receipts.map((receipt) => [receipt.actionId, receipt]));
  for (let action of actionOwnership) {
    let receipt = receiptByAction.get(action.actionId);
    if (!receipt || receipt.targetId !== action.targetId) {
      throw new ProductionRevisionError(`action ${action.actionId} has no exact accepted receipt`);
    }
  }

  let requiredTargetIds = unique(actionOwnership.map((action) => action.targetId), 'action target ids');
  if (!Array.isArray(source.targets) || source.targets.length !== requiredTargetIds.length) {
    throw new ProductionRevisionError('production revision requires one registered target per action target');
  }
  let targets = source.targets.map(createRegisteredTarget);
  if (canonicalize(targets.map((target) => target.targetId)) !== canonicalize(requiredTargetIds)) {
    throw new ProductionRevisionError('registered targets do not exactly match action targets');
  }

  if (!Array.isArray(source.claims) || source.claims.length !== actionOwnership.length) {
    throw new ProductionRevisionError('production revision requires one outcome claim per action');
  }
  let claims = source.claims.map(createOutcomeClaim);
  unique(claims.map((claim) => claim.actionId), 'productionRevision.claims.actionId');
  for (let action of actionOwnership) {
    let claim = claims.find((candidate) => candidate.actionId === action.actionId);
    let receipt = receiptByAction.get(action.actionId);
    if (!claim || claim.receiptId !== receipt.id || claim.targetId !== action.targetId) {
      throw new ProductionRevisionError(`action ${action.actionId} has no exact receipt-target claim join`);
    }
    let semanticTurn = semanticScript.turns.find((turn) => turn.id === claim.turnId);
    if (!semanticTurn?.claimRefs.includes(claim.claimId)) {
      throw new ProductionRevisionError(`claim ${claim.claimId} is absent from semantic turn ${claim.turnId}`);
    }
    resolveClaimWord(claim, timeline, alignedSequence);
  }

  let { surfaces: inScopeSurfaceIds, rows: coverage } = validateCoverage(
    source.inScopeSurfaceIds,
    source.coverage,
  );
  let payload = {
    schemaVersion: PRODUCTION_REVISION_SCHEMA_VERSION,
    journey: source.journey,
    semanticScript,
    voicePlan,
    timeline,
    clips,
    clipEvidence,
    mixEvidence,
    alignedSequence,
    skeleton,
    turnOwnership,
    actionOwnership,
    inScopeSurfaceIds,
    receipts,
    targets,
    claims,
    coverage,
  };
  let result = canonical(PRODUCTION_REVISION_SCHEMA_VERSION, payload);
  if (source.id !== undefined && source.id !== result.id) {
    throw new ProductionRevisionError('production revision id does not match canonical content');
  }
  return result;
}

export function validateProductionRevision(value = {}) {
  return assertCanonical(value, createProductionRevision(value), 'productionRevision');
}

export function createCausalEvidence(input = {}) {
  let source = record(input, 'causalEvidence');
  exactKeys(source, [
    'schemaVersion', 'revisionId', 'cueId', 'actionId', 'receiptId', 'targetId',
    'cursorOwnerCount', 'cursorVisibleFromFirstFrame', 'originArtifactAbsent',
    'overlayCleared', 'gestureCompleted', 'gestureEndMs', 'receiptAcceptedMs',
    'targetRegisteredMs', 'stablePaintMs', 'outcomeWordStartMs', 'derivedMarginMs', 'id',
  ], 'causalEvidence');
  let gestureEndMs = integer(source.gestureEndMs, 'causalEvidence.gestureEndMs');
  let receiptAcceptedMs = integer(source.receiptAcceptedMs, 'causalEvidence.receiptAcceptedMs');
  let targetRegisteredMs = integer(source.targetRegisteredMs, 'causalEvidence.targetRegisteredMs');
  let stablePaintMs = integer(source.stablePaintMs, 'causalEvidence.stablePaintMs');
  let outcomeWordStartMs = integer(source.outcomeWordStartMs, 'causalEvidence.outcomeWordStartMs');
  let boundaryMs = Math.max(gestureEndMs, receiptAcceptedMs, targetRegisteredMs, stablePaintMs);
  let derivedMarginMs = outcomeWordStartMs - boundaryMs;
  if (derivedMarginMs <= 0) throw new ProductionRevisionError('causal evidence requires a positive outcome margin');
  if (source.derivedMarginMs !== undefined && source.derivedMarginMs !== derivedMarginMs) {
    throw new ProductionRevisionError('causal evidence derivedMarginMs does not match boundaries');
  }
  for (let field of [
    'cursorVisibleFromFirstFrame', 'originArtifactAbsent', 'overlayCleared', 'gestureCompleted',
  ]) {
    if (source[field] !== true) throw new ProductionRevisionError(`causalEvidence.${field} must be true`);
  }
  let payload = {
    schemaVersion: CAUSAL_EVIDENCE_SCHEMA_VERSION,
    revisionId: identity(source.revisionId, PRODUCTION_REVISION_SCHEMA_VERSION, 'causalEvidence.revisionId'),
    cueId: nonempty(source.cueId, 'causalEvidence.cueId'),
    actionId: nonempty(source.actionId, 'causalEvidence.actionId'),
    receiptId: identity(source.receiptId, ACTION_RECEIPT_SCHEMA_VERSION, 'causalEvidence.receiptId'),
    targetId: nonempty(source.targetId, 'causalEvidence.targetId'),
    cursorOwnerCount: integer(source.cursorOwnerCount, 'causalEvidence.cursorOwnerCount', { min: 1, max: 1 }),
    cursorVisibleFromFirstFrame: true,
    originArtifactAbsent: true,
    overlayCleared: true,
    gestureCompleted: true,
    gestureEndMs,
    receiptAcceptedMs,
    targetRegisteredMs,
    stablePaintMs,
    outcomeWordStartMs,
    derivedMarginMs,
  };
  let result = canonical(CAUSAL_EVIDENCE_SCHEMA_VERSION, payload);
  if (source.id !== undefined && source.id !== result.id) throw new TypeError('causalEvidence.id is stale');
  return result;
}

export function createCausalEvidenceSet(input = {}, revisionInput = {}) {
  let revision = validateProductionRevision(revisionInput);
  let source = record(input, 'causalEvidenceSet');
  exactKeys(source, [
    'schemaVersion', 'revisionId', 'timelineHash', 'alignedSequenceHash', 'skeletonId',
    'rows', 'id',
  ], 'causalEvidenceSet');
  let rows = (source.rows || []).map(createCausalEvidence);
  if (rows.length !== revision.actionOwnership.length) {
    throw new ProductionRevisionError('causal evidence requires one row per executable action');
  }
  unique(rows.map((row) => row.cueId), 'causalEvidenceSet.rows.cueId');
  unique(rows.map((row) => row.actionId), 'causalEvidenceSet.rows.actionId');
  for (let action of revision.actionOwnership) {
    let row = rows.find((candidate) => candidate.actionId === action.actionId);
    let receipt = revision.receipts.find((candidate) => candidate.actionId === action.actionId);
    let claim = revision.claims.find((candidate) => candidate.actionId === action.actionId);
    if (!row || row.revisionId !== revision.id || row.cueId !== action.cueId
      || row.receiptId !== receipt.id || row.targetId !== action.targetId
      || row.outcomeWordStartMs !== claim.outcomeWordStartMs) {
      throw new ProductionRevisionError(`causal row does not join action ${action.actionId}`);
    }
  }
  let payload = {
    schemaVersion: CAUSAL_EVIDENCE_SET_SCHEMA_VERSION,
    revisionId: revision.id,
    timelineHash: revision.timeline.hash,
    alignedSequenceHash: revision.alignedSequence.hash,
    skeletonId: revision.skeleton.id,
    rows,
  };
  for (let key of ['revisionId', 'timelineHash', 'alignedSequenceHash', 'skeletonId']) {
    if (source[key] !== undefined && source[key] !== payload[key]) {
      throw new ProductionRevisionError(`causalEvidenceSet.${key} does not match revision`);
    }
  }
  let result = canonical(CAUSAL_EVIDENCE_SET_SCHEMA_VERSION, payload);
  if (source.id !== undefined && source.id !== result.id) throw new TypeError('causalEvidenceSet.id is stale');
  return result;
}

export function validateCausalEvidenceSet(value = {}, revision = {}) {
  assertPortableValue(value, 'causalEvidenceSet');
  return assertCanonical(value, createCausalEvidenceSet(value, revision), 'causalEvidenceSet');
}

function inspectionDiagnostic(severity, code, facts) {
  return { severity, code, facts };
}

function inspectionDiagnostics(revision) {
  let diagnostics = [];
  let operators = [...new Set(revision.actionOwnership.map((action) => action.operatorId))];
  if (operators.length !== 1) {
    diagnostics.push(inspectionDiagnostic('error', 'multiple-executable-operators', {
      operatorIds: operators,
      actionIds: revision.actionOwnership.map((action) => action.actionId),
    }));
  }

  let events = [...revision.skeleton.eventFacts]
    .sort((left, right) => left.startMs - right.startMs || left.cueId.localeCompare(right.cueId));
  for (let [index, current] of events.entries()) {
    for (let prior of events.slice(0, index)) {
      if (prior.targetId !== current.targetId) continue;
      let proximityMs = current.startMs - prior.endMs;
      if (proximityMs < 0 || proximityMs > NEARBY_EMPHASIS_WINDOW_MS) continue;

      let semanticallyEquivalent = prior.kind === current.kind
        && prior.semanticIntent === current.semanticIntent
        && prior.visualMechanism === current.visualMechanism
        && prior.interactionType === current.interactionType;
      if (semanticallyEquivalent) {
        diagnostics.push(inspectionDiagnostic('warning', 'repeated-semantic-emphasis', {
          priorCueId: prior.cueId,
          currentCueId: current.cueId,
          targetId: current.targetId,
          proximityMs,
        }));
      }

      if (prior.kind !== 'interaction' && current.kind === 'interaction'
        && proximityMs <= PRE_ACTION_WINDOW_MS) {
        diagnostics.push(inspectionDiagnostic('warning', 'redundant-pre-action-emphasis', {
          emphasisCueId: prior.cueId,
          actionCueId: current.cueId,
          targetId: current.targetId,
          proximityMs,
        }));
      }
    }
  }
  return diagnostics;
}

export function createCanonicalInspectionEvidence(revisionInput = {}, causalSetInput = {}) {
  let revision = validateProductionRevision(revisionInput);
  let causalSet = validateCausalEvidenceSet(causalSetInput, revision);
  let diagnostics = inspectionDiagnostics(revision);
  let payload = {
    schemaVersion: INSPECTION_SCHEMA_VERSION,
    revisionId: revision.id,
    causalSetId: causalSet.id,
    diagnostics,
    ready: diagnostics.length === 0,
  };
  return canonical(INSPECTION_SCHEMA_VERSION, payload);
}

function rendererRecord(value) {
  let source = record(value, 'previewEvidence.renderer');
  exactKeys(source, ['id', 'version'], 'previewEvidence.renderer');
  return {
    id: nonempty(source.id, 'previewEvidence.renderer.id'),
    version: nonempty(source.version, 'previewEvidence.renderer.version'),
  };
}

function jobRecord(value) {
  let source = record(value, 'previewEvidence.job');
  exactKeys(source, ['id', 'status'], 'previewEvidence.job');
  if (source.status !== 'succeeded') throw new TypeError('previewEvidence.job.status must be succeeded');
  return { id: nonempty(source.id, 'previewEvidence.job.id'), status: 'succeeded' };
}

function artifactRecord(value) {
  let source = record(value, 'previewEvidence.artifact');
  exactKeys(source, ['id', 'hash'], 'previewEvidence.artifact');
  return {
    id: identity(source.id, 'workspace-artifact-v1', 'previewEvidence.artifact.id'),
    hash: identity(source.hash, 'workspace-artifact-v1', 'previewEvidence.artifact.hash'),
  };
}

function videoRecord(value) {
  let source = record(value, 'previewEvidence.video');
  exactKeys(source, ['codec', 'durationMs', 'width', 'height'], 'previewEvidence.video');
  return {
    codec: nonempty(source.codec, 'previewEvidence.video.codec'),
    durationMs: positiveNumber(source.durationMs, 'previewEvidence.video.durationMs'),
    width: positiveNumber(source.width, 'previewEvidence.video.width'),
    height: positiveNumber(source.height, 'previewEvidence.video.height'),
  };
}

function audioRecord(value) {
  let source = record(value, 'previewEvidence.audio');
  exactKeys(source, ['codec', 'durationMs', 'sampleRate', 'channels'], 'previewEvidence.audio');
  return {
    codec: nonempty(source.codec, 'previewEvidence.audio.codec'),
    durationMs: positiveNumber(source.durationMs, 'previewEvidence.audio.durationMs'),
    sampleRate: positiveNumber(source.sampleRate, 'previewEvidence.audio.sampleRate'),
    channels: positiveNumber(source.channels, 'previewEvidence.audio.channels'),
  };
}

function acceptedInspectionRecord(value, revision, causalSet) {
  let source = record(value, 'inspectionEvidence');
  exactKeys(source, [
    'schemaVersion', 'revisionId', 'causalSetId', 'diagnostics', 'ready', 'id',
  ], 'inspectionEvidence');
  let expected = createCanonicalInspectionEvidence(revision, causalSet);
  if (canonicalize(source) !== canonicalize(expected)) {
    throw new ProductionRevisionError('inspection evidence does not match canonical recomputation');
  }
  if (!expected.ready || expected.diagnostics.length) {
    throw new ProductionRevisionError('inspection evidence must be ready without diagnostics');
  }
  return expected;
}

export function createPreviewEvidence(input = {}) {
  let source = record(input, 'previewEvidenceInput');
  exactKeys(source, [
    'revision', 'causalSet', 'inspection', 'renderer', 'job', 'artifact', 'video', 'audio',
  ], 'previewEvidenceInput');
  let revision = validateProductionRevision(source.revision);
  let causalSet = validateCausalEvidenceSet(source.causalSet, revision);
  let inspection = acceptedInspectionRecord(source.inspection, revision, causalSet);
  let video = videoRecord(source.video);
  let audio = audioRecord(source.audio);
  if (video.durationMs !== revision.mixEvidence.durationMs
    || audio.durationMs !== revision.mixEvidence.durationMs) {
    throw new ProductionRevisionError('preview audio and video durations must match accepted mix duration');
  }
  let payload = {
    schemaVersion: PREVIEW_EVIDENCE_SCHEMA_VERSION,
    revisionId: revision.id,
    timelineHash: revision.timeline.hash,
    alignedSequenceHash: revision.alignedSequence.hash,
    skeletonId: revision.skeleton.id,
    audioEvidenceId: revision.mixEvidence.id,
    causalSetId: causalSet.id,
    inspectionId: identity(inspection.id, 'workspace-inspection-v1', 'previewEvidence.inspectionId'),
    renderer: rendererRecord(source.renderer),
    job: jobRecord(source.job),
    artifact: artifactRecord(source.artifact),
    video,
    audio,
  };
  return canonical(PREVIEW_EVIDENCE_SCHEMA_VERSION, payload);
}

export function validatePreviewEvidence(value = {}, revision = {}, causalSet = {}, inspection = {}) {
  let source = record(value, 'previewEvidence');
  exactKeys(source, [
    'schemaVersion', 'revisionId', 'timelineHash', 'alignedSequenceHash', 'skeletonId',
    'audioEvidenceId', 'causalSetId', 'inspectionId', 'renderer', 'job', 'artifact',
    'video', 'audio', 'id',
  ], 'previewEvidence');
  let expected = createPreviewEvidence({
    revision,
    causalSet,
    inspection,
    renderer: source.renderer,
    job: source.job,
    artifact: source.artifact,
    video: source.video,
    audio: source.audio,
  });
  return assertCanonical(source, expected, 'previewEvidence');
}

export function createAgentAcceptance(input = {}) {
  let source = record(input, 'agentAcceptanceInput');
  exactKeys(source, [
    'revision', 'causalSet', 'inspection', 'preview', 'agentId', 'evidenceHash', 'accepted',
  ], 'agentAcceptanceInput');
  if (source.accepted !== true) throw new ProductionRevisionError('agent acceptance must be true');
  let revision = validateProductionRevision(source.revision);
  let causalSet = validateCausalEvidenceSet(source.causalSet, revision);
  let inspection = acceptedInspectionRecord(source.inspection, revision, causalSet);
  let preview = validatePreviewEvidence(source.preview, revision, causalSet, inspection);
  let payload = {
    schemaVersion: AGENT_ACCEPTANCE_SCHEMA_VERSION,
    revisionId: revision.id,
    inspectionId: identity(inspection.id, 'workspace-inspection-v1', 'agentAcceptance.inspectionId'),
    previewId: identity(preview.id, PREVIEW_EVIDENCE_SCHEMA_VERSION, 'agentAcceptance.previewId'),
    agentId: nonempty(source.agentId, 'agentAcceptance.agentId'),
    evidenceHash: identity(source.evidenceHash, 'workspace-agent-review-v1', 'agentAcceptance.evidenceHash'),
    accepted: true,
  };
  return canonical(AGENT_ACCEPTANCE_SCHEMA_VERSION, payload);
}

export function validateAgentAcceptance(
  value = {},
  revision = {},
  causalSet = {},
  inspection = {},
  preview = {},
) {
  let source = record(value, 'agentAcceptance');
  exactKeys(source, [
    'schemaVersion', 'revisionId', 'inspectionId', 'previewId', 'agentId',
    'evidenceHash', 'accepted', 'id',
  ], 'agentAcceptance');
  let expected = createAgentAcceptance({
    revision,
    causalSet,
    inspection,
    preview,
    agentId: source.agentId,
    evidenceHash: source.evidenceHash,
    accepted: source.accepted,
  });
  return assertCanonical(source, expected, 'agentAcceptance');
}

export function mediaProjectExportAssertion(input = {}) {
  let source = record(input, 'finalExportInput');
  exactKeys(source, ['revision', 'causalSet', 'inspection', 'preview', 'acceptance'], 'finalExportInput');
  let revision = validateProductionRevision(source.revision);
  let causalSet = validateCausalEvidenceSet(source.causalSet, revision);
  let inspection = record(source.inspection, 'finalExportInput.inspection');
  let preview = validatePreviewEvidence(source.preview, revision, causalSet, inspection);
  let acceptance = validateAgentAcceptance(
    source.acceptance,
    revision,
    causalSet,
    inspection,
    preview,
  );
  let payload = {
    schemaVersion: FINAL_EXPORT_ASSERTION_SCHEMA_VERSION,
    revisionId: revision.id,
    timelineHash: revision.timeline.hash,
    alignedSequenceHash: revision.alignedSequence.hash,
    skeletonId: revision.skeleton.id,
    audioEvidenceId: revision.mixEvidence.id,
    causalSetId: causalSet.id,
    inspectionId: inspection.id,
    previewId: preview.id,
    acceptanceId: acceptance.id,
  };
  return canonical(FINAL_EXPORT_ASSERTION_SCHEMA_VERSION, payload);
}
