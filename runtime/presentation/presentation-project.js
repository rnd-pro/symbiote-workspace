import { canonicalize } from '../../schema/canonical-json.js';
import { createPresentationTimelineHash, normalizePresentationTimeline } from './contract.js';
import {
  WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION,
  PRESENTATION_NARRATION_PROJECTION_VERSION,
  text,
  normalizeSemanticSkeleton,
  createNarrationProjection,
  verifyIntegrity,
  hashRecord,
} from './semantic-skeleton.js';

export const WORKSPACE_PRESENTATION_PROJECT_VERSION = 'workspace-presentation-project-v7';
export const WORKSPACE_PRESENTATION_WARNING_PROJECT_VERSION = 'workspace-presentation-warning-project-v1';
export const PRESENTATION_WARNING_NARRATION_VERSION = 'presentation-warning-narration-v1';
export const PRESENTATION_PRE_AUDIO_INSPECTION_VERSION = 'presentation-pre-audio-inspection-v1';
export const PRESENTATION_NARRATION_QUALITY_INSPECTION_VERSION = 'presentation-narration-quality-inspection-v1';
export const PRESENTATION_PRE_AUDIO_INSPECTION_BUNDLE_VERSION = 'presentation-pre-audio-inspection-bundle-v1';
export const PRESENTATION_MEDIA_ANCESTRY_ASSERTION_VERSION = 'presentation-media-ancestry-assertion-v1';

function clone(value) { return JSON.parse(canonicalize(value)); }
function known(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  for (let key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`Unrecognized field "${key}" in ${path}`);
}
function occurrences(text, quote) {
  let count = 0; let cursor = 0;
  while (cursor <= text.length - quote.length) { let next = text.indexOf(quote, cursor); if (next < 0) break; count += 1; cursor = next + Math.max(1, quote.length); }
  return count;
}
function unicodeTokens(value) {
  return (String(value || '').normalize('NFC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((token) => token.length > 1);
}
function tokenSignature(value) {
  return [...new Set(unicodeTokens(value))].sort();
}
function jaccard(left, right) {
  let a = new Set(left); let b = new Set(right); let shared = [...a].filter((item) => b.has(item)).length;
  return { shared, score: shared / Math.max(1, new Set([...a, ...b]).size) };
}

function normalizeProjectionForProviderUse(skeleton, projectionRaw) {
  if (projectionRaw?.schemaVersion !== PRESENTATION_NARRATION_PROJECTION_VERSION || !projectionRaw?.hash) return createNarrationProjection(projectionRaw, skeleton);
  verifyIntegrity(PRESENTATION_NARRATION_PROJECTION_VERSION, projectionRaw);
  let candidate = {
    narrations: projectionRaw.narrations.map((narration) => ({
      slotId: narration.slotId, text: narration.text,
    })),
  };
  let reconstructed = createNarrationProjection(candidate, skeleton);
  if (canonicalize(reconstructed) !== canonicalize(projectionRaw)) throw new TypeError('Accepted narration projection does not match deterministic text-derived proof');
  return reconstructed;
}

function annotationForDeclaredIntent(intent) {
  return intent === 'pointer'
    ? { intent, marker: 'arrow', placement: 'before' }
    : { intent };
}

/** Rebuilds the v3 timeline from the immutable semantic inputs; it never accepts model topology. */
export function materializePresentationTimeline(skeletonRaw, projectionRaw) {
  let skeleton = normalizeSemanticSkeleton(skeletonRaw);
  let projection = normalizeProjectionForProviderUse(skeleton, projectionRaw);
  if (projection.skeletonHash !== skeleton.hash) throw new TypeError('Projection skeletonHash does not match skeleton');
  let turns = skeleton.slots.map((slot, index) => {
    let narration = projection.narrations[index];
    let cues = [];
    let actionAnchorIndex = slot.anchors.findIndex((anchor) => anchor.intent === 'action');
    let actionAnchor = actionAnchorIndex >= 0 ? narration.anchors[actionAnchorIndex] : null;
    let actionAt = actionAnchor
      ? (actionAnchor.event === 'turn-start'
        ? { anchor: 'turn-start', offsetMs: 0 }
        : { anchor: 'speech', quote: actionAnchor.quote, occurrence: actionAnchor.occurrence, edge: 'start', offsetMs: 0 })
      : null;
    let hasAnchoredFocus = slot.anchors.some((anchor) => anchor.intent === 'focus');
    // A visual frame is only a declared independent emphasis. Interaction owns its own cursor.
    if (slot.focusMode === 'frame' && !slot.action && !hasAnchoredFocus) cues.push({
      kind: 'focus', targetId: slot.targetId, tabId: slot.tabId,
      at: { anchor: 'turn-start', offsetMs: 0 }, focus: { mode: 'frame' },
    });
    slot.anchors.forEach((declared, anchorIndex) => {
      let anchor = narration.anchors[anchorIndex];
      let at = anchor.event === 'turn-start'
        ? { anchor: 'turn-start', offsetMs: 0 }
        : { anchor: 'speech', quote: anchor.quote, occurrence: anchor.occurrence, edge: 'start', offsetMs: 0 };
      if (declared.intent === 'action') {
        if (!slot.action) throw new TypeError(`Action anchor declared without registered action in ${slot.slotId}`);
        cues.push({ kind: 'interaction', targetId: slot.targetId, tabId: slot.tabId,
          at,
          interaction: { type: slot.action.interactionType, binding: { source: slot.action.source, tool: slot.action.tool, input: slot.action.input }, reversible: slot.action.reversible === true ? true : undefined },
        });
      } else if (declared.intent === 'focus') {
        cues.push({ kind: 'focus', targetId: slot.targetId, tabId: slot.tabId,
          at, focus: { mode: 'frame' },
        });
      } else {
        cues.push({ kind: 'annotation', targetId: slot.targetId, tabId: slot.tabId,
          at,
          ...(declared.intent === 'pointer' && actionAt?.anchor === 'speech' ? { until: actionAt } : {}),
          annotation: annotationForDeclaredIntent(declared.intent),
        });
      }
    });
    return {
      id: slot.slotId, persona: slot.persona, addressee: slot.addressee,
      dialogueAct: slot.semanticAct, replyTo: slot.replyToSlotId, text: narration.text,
      sourceRefs: slot.sourceRefs.map((sourceId) => ({ sourceId, targetId: slot.targetId })),
      claims: narration.claimTexts.map((claim) => {
        let contract = slot.claimRefs.find((item) => item.id === claim.claimId);
        return { id: claim.claimId, kind: contract.kind, text: claim.text, factRefs: contract.factRefs, evidenceRefs: contract.evidenceRefs, targetRefs: [slot.targetId] };
      }),
      transition: slot.transition, cues,
    };
  });
  let grounding = skeleton.grounding?.sources ? { sources: skeleton.grounding.sources } : { sources: [] };
  return normalizePresentationTimeline({
    contractVersion: 'presentation-timeline-v3', id: skeleton.hash.slice(-32), title: skeleton.title,
    locale: skeleton.locale, profile: skeleton.profile, personas: skeleton.personas, grounding, turns,
  });
}

/**
 * Materializes an explicitly unverified warning timeline from the exact
 * text-only candidate envelope. It deliberately carries no claims, proofs,
 * or word anchors: none of those may be inferred when factual narration did
 * not pass provider validation. Fixed non-destructive actions remain part of
 * the immutable skeleton and therefore retain a turn-start cue.
 */
export function materializeLiveWarningPresentationTimeline(skeletonRaw, candidateRaw) {
  const skeleton = normalizeSemanticSkeleton(skeletonRaw);
  known(candidateRaw, ['narrations'], 'liveWarningNarration');
  if (!Array.isArray(candidateRaw.narrations) || candidateRaw.narrations.length !== skeleton.slots.length) {
    throw new TypeError('live warning narration must provide every declared slot exactly once');
  }
  const narrations = candidateRaw.narrations.map((raw, index) => {
    known(raw, ['slotId', 'text'], `liveWarningNarration.narrations[${index}]`);
    const slot = skeleton.slots[index];
    if (raw.slotId !== slot.slotId) throw new TypeError('live warning narration slot order does not match the semantic skeleton');
    const value = String(raw.text || '').normalize('NFC').trim();
    if (!value) throw new TypeError(`live warning narration text is required for ${slot.slotId}`);
    return Object.freeze({ slot, text: value });
  });
  const turns = narrations.map(({ slot, text: narration }) => {
    const hasAnchoredFocus = slot.anchors.some((anchor) => anchor.intent === 'focus');
    const cues = slot.focusMode === 'frame' && !slot.action && !hasAnchoredFocus
      ? [{
        kind: 'focus', targetId: slot.targetId, tabId: slot.tabId,
        at: { anchor: 'turn-start', offsetMs: 0 }, focus: { mode: 'frame' },
      }]
      : [];
    slot.anchors.forEach((declared) => {
      if (declared.intent === 'action') {
        if (!slot.action) throw new TypeError(`Action anchor declared without registered action in ${slot.slotId}`);
        cues.push({
          kind: 'interaction', targetId: slot.targetId, tabId: slot.tabId,
          at: { anchor: 'turn-start', offsetMs: 0 },
          interaction: { type: slot.action.interactionType, binding: { source: slot.action.source, tool: slot.action.tool, input: slot.action.input }, reversible: slot.action.reversible === true ? true : undefined },
        });
      } else if (declared.intent === 'focus') {
        cues.push({
          kind: 'focus', targetId: slot.targetId, tabId: slot.tabId,
          at: { anchor: 'turn-start', offsetMs: 0 }, focus: { mode: 'frame' },
        });
      } else {
        cues.push({
          kind: 'annotation', targetId: slot.targetId, tabId: slot.tabId,
          at: { anchor: 'turn-start', offsetMs: 0 }, annotation: annotationForDeclaredIntent(declared.intent),
        });
      }
    });
    return {
      id: slot.slotId, persona: slot.persona, addressee: slot.addressee,
      dialogueAct: slot.semanticAct, replyTo: slot.replyToSlotId, text: narration,
      sourceRefs: slot.sourceRefs.map((sourceId) => ({ sourceId, targetId: slot.targetId })),
      claims: [], transition: slot.transition, cues,
    };
  });
  const grounding = skeleton.grounding?.sources ? { sources: skeleton.grounding.sources } : { sources: [] };
  return normalizePresentationTimeline({
    contractVersion: 'presentation-timeline-v3', id: skeleton.hash.slice(-32), title: skeleton.title,
    locale: skeleton.locale, profile: skeleton.profile, personas: skeleton.personas, grounding, turns,
  });
}

function inspectionReport(skeletonHash, projectionHash, findings) {
  return hashRecord(PRESENTATION_PRE_AUDIO_INSPECTION_VERSION, {
    schemaVersion: PRESENTATION_PRE_AUDIO_INSPECTION_VERSION, skeletonHash, projectionHash,
    stage: 'pre-audio', findings: findings.map((finding) => ({ code: finding.code, message: finding.message })),
  });
}

export function inspectPresentationProject(skeletonRaw, projectionRaw) {
  let diagnostics = [];
  let skeleton; let projection;
  try { skeleton = normalizeSemanticSkeleton(skeletonRaw); projection = normalizeProjectionForProviderUse(skeleton, projectionRaw); }
  catch (error) { return inspectionReport('', '', [{ code: 'invalid-authority-input', message: error.message }]); }
  let slots = new Set(); let targets = new Set(); let results = new Set(); let actions = new Set(); let operator = null;
  skeleton.slots.forEach((slot, index) => {
    if (slots.has(slot.slotId)) diagnostics.push({ code: 'duplicate-slot', message: slot.slotId });
    slots.add(slot.slotId); targets.add(slot.targetId);
    if (slot.replyToSlotId && !skeleton.slots.slice(0, index).some((item) => item.slotId === slot.replyToSlotId)) diagnostics.push({ code: 'invalid-reply-order', message: slot.slotId });
    if (slot.action) {
      let actionInput = slot.action.input === undefined ? '' : canonicalize(slot.action.input);
      let key = `${slot.targetId}:${slot.action.source}:${slot.action.tool}:${actionInput}`;
      if (actions.has(key)) diagnostics.push({ code: 'duplicate-action', message: key }); actions.add(key);
      if (slot.resultRefs.length !== 1) diagnostics.push({ code: 'action-without-single-result', message: slot.slotId });
      operator ||= slot.persona; if (operator !== slot.persona) diagnostics.push({ code: 'multiple-operator', message: slot.slotId });
      if (slot.focusMode !== 'none') diagnostics.push({ code: 'focus-before-action', message: slot.slotId });
    }
    for (let result of slot.resultRefs) { if (results.has(result)) diagnostics.push({ code: 'duplicate-result', message: result }); results.add(result); }
    if (index && slot.targetId === skeleton.slots[index - 1].targetId && !slot.action && slot.focusMode !== 'none') diagnostics.push({ code: 'repeated-visual-emphasis', message: slot.slotId });
    projection.narrations[index].anchors.forEach((anchor) => { if (!anchor.event && occurrences(projection.narrations[index].text, anchor.quote) < anchor.occurrence) diagnostics.push({ code: 'invalid-word-anchor', message: slot.slotId }); });
  });
  for (let required of skeleton.requiredTargets) if (!targets.has(required.targetId)) diagnostics.push({ code: 'missing-target-coverage', message: required.targetId });
  return inspectionReport(skeleton.hash, projection.hash, diagnostics);
}

/** Language-neutral prose quality review. It is intentionally pre-audio: cursor/origin evidence belongs to capture review. */
export function inspectPresentationNarrationQuality(skeletonRaw, projectionRaw) {
  let skeleton; let projection;
  try { skeleton = normalizeSemanticSkeleton(skeletonRaw); projection = normalizeProjectionForProviderUse(skeleton, projectionRaw); }
  catch (error) {
    return hashRecord(PRESENTATION_NARRATION_QUALITY_INSPECTION_VERSION, {
      schemaVersion: PRESENTATION_NARRATION_QUALITY_INSPECTION_VERSION, stage: 'pre-audio', skeletonHash: '', projectionHash: '',
      findings: [{ category: 'narration', code: text(error?.code, 'invalid-narration-authority'), severity: 'error', message: error.message, slotIds: [] }],
    });
  }
  let findings = [];
  let spokenAtoms = new Map();
  for (let index = 0; index < projection.narrations.length; index += 1) {
    let current = projection.narrations[index];
    let currentAtoms = new Map();
    current.claimTexts.forEach((claim) => claim.groundingProof?.atoms.forEach((atom) => {
      let claims = currentAtoms.get(atom.atomId) || new Set(); claims.add(claim.claimId); currentAtoms.set(atom.atomId, claims);
    }));
    currentAtoms.forEach((claimIds, atomId) => {
      let earlier = spokenAtoms.get(atomId);
      if (earlier) findings.push({ category: 'narration', code: 'duplicate-substantive-atom', severity: 'error', message: `Slot ${current.slotId} repeats an already spoken substantive proof atom`, slotIds: [earlier, current.slotId] });
    });
    currentAtoms.forEach((claimIds, atomId) => { if (!spokenAtoms.has(atomId)) spokenAtoms.set(atomId, current.slotId); });
    let currentSignature = tokenSignature(current.text);
    for (let earlier = 0; earlier < index; earlier += 1) {
      let prior = projection.narrations[earlier];
      let comparison = jaccard(currentSignature, tokenSignature(prior.text));
      if (current.text.normalize('NFC') === prior.text.normalize('NFC') || (comparison.shared >= 3 && comparison.score >= 0.78)) {
        findings.push({ category: 'narration', code: 'repeated-narration', severity: 'error', message: `Narration in ${current.slotId} duplicates an earlier semantic turn`, slotIds: [prior.slotId, current.slotId] });
      }
    }
    let resolvedAnchors = new Set();
    current.anchors.forEach((anchor) => {
      if (anchor.event) return;
      let count = occurrences(current.text, anchor.quote);
      if (count < anchor.occurrence) findings.push({ category: 'narration', code: 'missing-word-anchor', severity: 'error', message: `Anchor is absent from ${current.slotId}`, slotIds: [current.slotId] });
      let resolvedKey = `${anchor.quote}\u0000${anchor.occurrence}`;
      if (resolvedAnchors.has(resolvedKey)) findings.push({ category: 'narration', code: 'ambiguous-word-anchor', severity: 'error', message: `Multiple anchors resolve to the same words in ${current.slotId}`, slotIds: [current.slotId] });
      resolvedAnchors.add(resolvedKey);
    });
    let slot = skeleton.slots[index];
    if (slot.semanticAct === 'ask') {
      let reply = skeleton.slots.slice(index + 1).find((candidate) => candidate.replyToSlotId === slot.slotId);
      if (!reply || reply.persona === slot.persona) findings.push({ category: 'narration', code: 'unanswered-dialogue-question', severity: 'error', message: `Question slot ${slot.slotId} has no distinct responder`, slotIds: [slot.slotId] });
    }
    if (index > 0 && slot.targetId === skeleton.slots[index - 1].targetId) {
      let priorSlot = skeleton.slots[index - 1];
      if ((priorSlot.focusMode === 'frame' || priorSlot.action) && (slot.focusMode === 'frame' || slot.action)) findings.push({ category: 'narration', code: 'redundant-visual-emphasis', severity: 'error', message: `Adjacent turns repeat visual emphasis on ${slot.targetId}`, slotIds: [priorSlot.slotId, slot.slotId] });
    }
  }
  let usedPersonas = new Set(skeleton.slots.map((slot) => slot.persona));
  let asks = skeleton.slots.filter((slot) => slot.semanticAct === 'ask');
  if (Object.keys(skeleton.personas).length > 1 && asks.length && usedPersonas.size < 2) findings.push({ category: 'narration', code: 'speaker-imbalance', severity: 'error', message: 'Dialogue asks are narrated by one persona only', slotIds: asks.map((slot) => slot.slotId) });
  return hashRecord(PRESENTATION_NARRATION_QUALITY_INSPECTION_VERSION, {
    schemaVersion: PRESENTATION_NARRATION_QUALITY_INSPECTION_VERSION, stage: 'pre-audio', skeletonHash: skeleton.hash, projectionHash: projection.hash, findings,
  });
}

export function inspectPresentationPreAudio(skeletonRaw, projectionRaw) {
  let structural = inspectPresentationProject(skeletonRaw, projectionRaw);
  let narration = inspectPresentationNarrationQuality(skeletonRaw, projectionRaw);
  return hashRecord(PRESENTATION_PRE_AUDIO_INSPECTION_BUNDLE_VERSION, {
    schemaVersion: PRESENTATION_PRE_AUDIO_INSPECTION_BUNDLE_VERSION, stage: 'pre-audio', structural, narration,
    skeletonHash: structural.skeletonHash || narration.skeletonHash, projectionHash: structural.projectionHash || narration.projectionHash,
  });
}

export function createPresentationProject(input = {}) {
  known(input, ['skeleton', 'projection'], 'projectInput');
  let skeleton = normalizeSemanticSkeleton(input.skeleton);
  let projection = normalizeProjectionForProviderUse(skeleton, input.projection);
  let inspection = inspectPresentationPreAudio(skeleton, projection);
  let findings = [...inspection.structural.findings, ...inspection.narration.findings];
  if (findings.length) throw new Error(`Project inspection failed: ${findings.map((item) => item.code).join(', ')}`);
  let timeline = materializePresentationTimeline(skeleton, projection);
  return hashRecord(WORKSPACE_PRESENTATION_PROJECT_VERSION, {
    schemaVersion: WORKSPACE_PRESENTATION_PROJECT_VERSION, skeletonHash: skeleton.hash, projectionHash: projection.hash,
    skeleton, projection, inspection, timelineHash: createPresentationTimelineHash(timeline), timeline,
  });
}

function normalizeQualityWarnings(value, skeleton) {
  if (!Array.isArray(value) || !value.length) throw new TypeError('warning presentation project requires quality warnings');
  const knownSlots = new Set(skeleton.slots.map((slot) => slot.slotId));
  const seen = new Set();
  return value.map((warning, index) => {
    known(warning, ['code', 'slotId'], `warningProject.qualityWarnings[${index}]`);
    const code = String(warning.code || '').normalize('NFC').trim();
    const slotId = String(warning.slotId || '').normalize('NFC').trim();
    if (!code || !slotId || !knownSlots.has(slotId)) throw new TypeError('warning presentation project has an invalid quality warning');
    const key = `${code}\u0000${slotId}`;
    if (seen.has(key)) throw new TypeError('warning presentation project repeats a quality warning');
    seen.add(key);
    return { code, slotId };
  });
}

/**
 * A warning project is immutable provenance for a user-approved best-effort
 * tour. It is intentionally distinct from a fully verified presentation
 * project: it has no derived claim/proof authority, while retaining the same
 * skeleton-bound timeline and server-held receipt/ancestry chain for a user
 * who chooses to continue to media rendering.
 */
export function createPresentationWarningProject(input = {}) {
  known(input, ['skeleton', 'narration', 'qualityWarnings'], 'warningProjectInput');
  const skeleton = normalizeSemanticSkeleton(input.skeleton);
  const timeline = materializeLiveWarningPresentationTimeline(skeleton, input.narration);
  const narration = hashRecord(PRESENTATION_WARNING_NARRATION_VERSION, {
    schemaVersion: PRESENTATION_WARNING_NARRATION_VERSION,
    skeletonHash: skeleton.hash,
    narrations: input.narration.narrations.map((item) => ({ slotId: item.slotId, text: String(item.text || '').normalize('NFC').trim() })),
  });
  const qualityWarnings = normalizeQualityWarnings(input.qualityWarnings, skeleton);
  return hashRecord(WORKSPACE_PRESENTATION_WARNING_PROJECT_VERSION, {
    schemaVersion: WORKSPACE_PRESENTATION_WARNING_PROJECT_VERSION,
    projectKind: 'quality-warning',
    skeletonHash: skeleton.hash,
    projectionHash: narration.hash,
    skeleton,
    narration,
    qualityWarnings,
    timelineHash: createPresentationTimelineHash(timeline),
    timeline,
  });
}

export function normalizePresentationProject(raw = {}) {
  known(raw, ['schemaVersion', 'skeletonHash', 'projectionHash', 'skeleton', 'projection', 'inspection', 'timelineHash', 'timeline', 'hash'], 'presentationProject');
  verifyIntegrity(WORKSPACE_PRESENTATION_PROJECT_VERSION, raw);
  if (raw.schemaVersion !== WORKSPACE_PRESENTATION_PROJECT_VERSION) throw new TypeError('Unsupported presentation project schemaVersion');
  let reconstructed = createPresentationProject({ skeleton: raw.skeleton, projection: raw.projection });
  if (reconstructed.hash !== raw.hash || reconstructed.skeletonHash !== raw.skeletonHash || reconstructed.projectionHash !== raw.projectionHash || reconstructed.timelineHash !== raw.timelineHash || canonicalize(reconstructed.timeline) !== canonicalize(raw.timeline) || canonicalize(reconstructed.inspection) !== canonicalize(raw.inspection)) throw new TypeError('Project reconstruction does not match immutable project');
  return reconstructed;
}

export function normalizePresentationWarningProject(raw = {}) {
  known(raw, ['schemaVersion', 'projectKind', 'skeletonHash', 'projectionHash', 'skeleton', 'narration', 'qualityWarnings', 'timelineHash', 'timeline', 'hash'], 'warningPresentationProject');
  verifyIntegrity(WORKSPACE_PRESENTATION_WARNING_PROJECT_VERSION, raw);
  if (raw.schemaVersion !== WORKSPACE_PRESENTATION_WARNING_PROJECT_VERSION || raw.projectKind !== 'quality-warning') {
    throw new TypeError('Unsupported warning presentation project schemaVersion');
  }
  const reconstructed = createPresentationWarningProject({ skeleton: raw.skeleton, narration: { narrations: raw.narration?.narrations }, qualityWarnings: raw.qualityWarnings });
  if (canonicalize(reconstructed) !== canonicalize(raw)) throw new TypeError('Warning presentation project reconstruction does not match immutable project');
  return reconstructed;
}

export function normalizePresentationRenderableProject(raw = {}) {
  if (raw?.schemaVersion === WORKSPACE_PRESENTATION_PROJECT_VERSION) return normalizePresentationProject(raw);
  if (raw?.schemaVersion === WORKSPACE_PRESENTATION_WARNING_PROJECT_VERSION) return normalizePresentationWarningProject(raw);
  throw new TypeError('Unsupported renderable presentation project schemaVersion');
}

export function createLivePresentationProjection(projectRaw) {
  const project = normalizePresentationRenderableProject(projectRaw);
  return Object.freeze({
    schemaVersion: 'presentation-live-projection-v1', projectHash: project.hash, skeletonHash: project.skeletonHash,
    projectionHash: project.projectionHash, timelineHash: project.timelineHash, timeline: clone(project.timeline),
    ...(project.inspection ? { inspection: clone(project.inspection) } : {}),
    ...(project.projectKind === 'quality-warning' ? { projectKind: project.projectKind, qualityWarnings: clone(project.qualityWarnings) } : {}),
  });
}

export function createMediaPresentationAncestryAssertion(projectRaw, kind = 'preparation') {
  let project = normalizePresentationRenderableProject(projectRaw);
  return hashRecord(PRESENTATION_MEDIA_ANCESTRY_ASSERTION_VERSION, {
    schemaVersion: PRESENTATION_MEDIA_ANCESTRY_ASSERTION_VERSION,
    kind: String(kind || 'preparation').normalize('NFC').trim(),
    projectHash: project.hash, timelineHash: project.timelineHash,
    skeletonHash: project.skeletonHash, projectionHash: project.projectionHash,
  });
}

export function validateMediaPresentationAncestry(projectRaw, mediaPreparation = {}) {
  let project = normalizePresentationRenderableProject(projectRaw);
  known(mediaPreparation, ['schemaVersion', 'projectHash', 'timelineHash', 'skeletonHash', 'projectionHash', 'kind', 'hash'], 'mediaPreparation');
  if (mediaPreparation.schemaVersion !== PRESENTATION_MEDIA_ANCESTRY_ASSERTION_VERSION) throw new TypeError('Media ancestry assertion has unsupported schemaVersion');
  verifyIntegrity(PRESENTATION_MEDIA_ANCESTRY_ASSERTION_VERSION, mediaPreparation);
  let expected = { projectHash: project.hash, timelineHash: project.timelineHash, skeletonHash: project.skeletonHash, projectionHash: project.projectionHash };
  for (let key of Object.keys(expected)) if (mediaPreparation[key] !== expected[key]) throw new TypeError(`Media ancestry rejects a different immutable ${key}`);
  return true;
}
