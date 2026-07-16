import { computeIntegrity } from '../schema/canonical-json.js';
import { buildCaptionPlacementTrack, resolveCaptionProfile } from 'symbiote-engine/render-captions';
import { validatePresentationAlignedSequence } from './presentation/align.js';
import { createPresentationTimelineContract } from './presentation/contract.js';

export const PRESENTATION_OUTPUT_SPEC_SCHEMA_VERSION = 'workspace-presentation-output-v3';
export const PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION = 'workspace-presentation-composition-v3';
export const PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION = 'presentation-context-snapshot-v2';
export const PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION = 'presentation-replan-request-v2';
export const PRESENTATION_REPLAN_RESULT_SCHEMA_VERSION = 'presentation-replan-result-v2';
export const PRESENTATION_CAPTION_COMPOSITION_SCHEMA_VERSION = 'workspace-presentation-caption-composition-v1';
export const PRESENTATION_CAPTION_TIMING_TOLERANCE_MS = 50;
export const PRESENTATION_COMPOSITION_CUE_KINDS = Object.freeze(['focus', 'interaction', 'annotation']);

const PRESENTATION_COMPOSITION_CUE_KIND_SET = new Set(PRESENTATION_COMPOSITION_CUE_KINDS);

export function presentationReplanRequestHash(request = {}) {
  let projection = { ...request };
  delete projection.hash;
  return `${PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION}:${computeIntegrity(projection)}`;
}

export const PRESENTATION_COMPOSITION_ISSUE_CODES = Object.freeze([
  'output-viewport-mismatch',
  'composition-required',
  'composition-restore-mismatch',
  'composition-simulation-active',
  'composition-step-missing',
  'composition-scroll-failed',
  'target-hidden',
  'target-clipped',
  'target-occluded',
  'target-unreachable',
  'target-unreadable',
  'annotation-placement-unavailable',
  'output-context-stale',
  'composition-repair-stale',
  'lesson-intent-mismatch',
]);

const ISSUE_CODE_SET = new Set(PRESENTATION_COMPOSITION_ISSUE_CODES);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePortable(value, depth = 0) {
  if (depth > 12 || value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => clonePortable(item, depth + 1)).filter((item) => item !== undefined);
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    let portable = clonePortable(child, depth + 1);
    if (portable !== undefined) result[key] = portable;
  }
  return result;
}

function cleanText(value, fallback = '') {
  let text = String(value ?? fallback ?? '').replace(/\s+/g, ' ').trim();
  return text && text !== 'undefined' && text !== 'null' ? text : String(fallback || '').trim();
}

export function listPresentationCompositionCueSlots(timeline = {}) {
  return (Array.isArray(timeline?.turns) ? timeline.turns : []).flatMap((turn, turnIndex) => {
    let slotIndex = 0;
    return (Array.isArray(turn?.cues) ? turn.cues : []).flatMap((cue, cueIndex) => {
      if (!PRESENTATION_COMPOSITION_CUE_KIND_SET.has(cue?.kind)) return [];
      let targetId = cleanText(cue.targetId);
      if (!targetId) return [];
      let slot = {
        turnId: cleanText(turn.id, `turn-${turnIndex + 1}`),
        turnIndex,
        slotIndex,
        cueIndex,
        kind: cue.kind,
        targetId,
      };
      slotIndex += 1;
      return [slot];
    });
  });
}

function positiveInteger(value, fallback) {
  let number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteNumber(value, fallback = 0) {
  let number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rounded(value) {
  return Math.round(finiteNumber(value) * 1000) / 1000;
}

function uniqueSorted(values) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((item) => cleanText(item)).filter(Boolean))].sort();
}

function gcd(left, right) {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function normalizedAspectRatio(width, height) {
  let divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

export function presentationOutputOrientation(width, height) {
  if (width === height) return 'square';
  return width < height ? 'vertical' : 'horizontal';
}

function normalizeInsets(input, fallback) {
  let source = isObject(input) ? input : {};
  return {
    top: Math.max(0, Math.round(finiteNumber(source.top, fallback))),
    right: Math.max(0, Math.round(finiteNumber(source.right, fallback))),
    bottom: Math.max(0, Math.round(finiteNumber(source.bottom, fallback))),
    left: Math.max(0, Math.round(finiteNumber(source.left, fallback))),
  };
}

function rect(x, y, width, height) {
  return {
    x: rounded(x),
    y: rounded(y),
    width: Math.max(0, rounded(width)),
    height: Math.max(0, rounded(height)),
  };
}

function translateRect(input, dx, dy) {
  let source = isObject(input) ? input : {};
  return rect(finiteNumber(source.x) + dx, finiteNumber(source.y) + dy, source.width, source.height);
}

function normalizeFrameInsets(input) {
  let source = isObject(input) ? input : {};
  let result = {};
  for (let side of ['top', 'right', 'bottom', 'left']) {
    let raw = source[side];
    let number = raw === undefined || raw === null || raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(number)) throw new TypeError(`presentation output frame inset ${side} must be a finite number`);
    if (number < 0) throw new TypeError(`presentation output frame inset ${side} must not be negative`);
    result[side] = Math.round(number);
  }
  return result;
}

function rectRight(value) {
  return finiteNumber(value?.x) + finiteNumber(value?.width);
}

function rectBottom(value) {
  return finiteNumber(value?.y) + finiteNumber(value?.height);
}

function rectContains(outer, inner, tolerance = 0) {
  return finiteNumber(inner?.x) >= finiteNumber(outer?.x) - tolerance
    && finiteNumber(inner?.y) >= finiteNumber(outer?.y) - tolerance
    && rectRight(inner) <= rectRight(outer) + tolerance
    && rectBottom(inner) <= rectBottom(outer) + tolerance;
}

function rectIntersects(left, right) {
  return finiteNumber(left?.width) > 0
    && finiteNumber(left?.height) > 0
    && finiteNumber(right?.width) > 0
    && finiteNumber(right?.height) > 0
    && finiteNumber(left?.x) < rectRight(right)
    && rectRight(left) > finiteNumber(right?.x)
    && finiteNumber(left?.y) < rectBottom(right)
    && rectBottom(left) > finiteNumber(right?.y);
}

export function normalizePresentationRect(input = {}) {
  let source = isObject(input) ? input : {};
  return rect(source.x ?? source.left, source.y ?? source.top, source.width, source.height);
}

export function normalizePresentationOutputSpec(input = {}) {
  let source = isObject(input) ? input : {};
  if (source.schemaVersion !== undefined && source.schemaVersion !== PRESENTATION_OUTPUT_SPEC_SCHEMA_VERSION) {
    throw new TypeError(`unsupported presentation output schema version: ${source.schemaVersion}`);
  }
  let viewport = isObject(source.viewport) ? source.viewport : {};
  let resolution = isObject(source.resolution) ? source.resolution : {};
  let width = positiveInteger(source.width ?? resolution.width ?? viewport.width, 1920);
  let height = positiveInteger(source.height ?? resolution.height ?? viewport.height, 1080);
  let fps = positiveInteger(source.fps ?? source.frameRate ?? viewport.fps, 30);
  if (fps !== 30) throw new TypeError('presentation output requires constant 30 fps');
  let dpr = finiteNumber(source.dpr ?? source.deviceScaleFactor ?? viewport.dpr, 1);
  if (dpr !== 1) throw new TypeError('presentation output proof requires DPR 1');
  let orientation = presentationOutputOrientation(width, height);
  let aspectRatio = normalizedAspectRatio(width, height);
  let frameInsets = normalizeFrameInsets(source.frameInsets);
  let viewportWidth = width - frameInsets.left - frameInsets.right;
  let viewportHeight = height - frameInsets.top - frameInsets.bottom;
  if (viewportWidth <= 0 || viewportHeight <= 0) throw new TypeError('presentation output frame insets leave no positive presentation viewport');
  let presentationViewport = rect(frameInsets.left, frameInsets.top, viewportWidth, viewportHeight);
  let edgeInset = Math.round(Math.min(viewportWidth, viewportHeight) * 0.05);
  let safeArea = normalizeInsets(source.safeArea, edgeInset);
  let captionsSource = isObject(source.captions) ? source.captions : {};
  let captionsMode = cleanText(captionsSource.mode ?? source.captionsMode, source.captionsEnabled === false ? 'off' : 'karaoke');
  let captionsEnabled = captionsSource.enabled === undefined
    ? source.captionsEnabled === undefined ? captionsMode !== 'off' : source.captionsEnabled !== false
    : captionsSource.enabled !== false;
  if (!captionsEnabled) captionsMode = 'off';
  let defaultCaptionPreset = orientation === 'vertical' ? 'tiktok' : orientation === 'square' ? 'square' : 'youtube';
  let captionPreset = cleanText(captionsSource.stylePreset || captionsSource.preset, defaultCaptionPreset);
  let requestedPlacement = cleanText(captionsSource.placement ?? source.captionPlacement);
  let preferredZones = Array.isArray(captionsSource.preferredZones)
    ? captionsSource.preferredZones
    : requestedPlacement === 'top' ? ['top', 'bottom']
      : requestedPlacement === 'middle' ? ['middle', 'bottom', 'top']
        : requestedPlacement === 'bottom' ? ['bottom', 'top']
          : null;
  let captionProfile = resolveCaptionProfile({
    ...(isObject(captionsSource.style) ? captionsSource.style : {}),
    preset: captionPreset,
    fontName: captionsSource.fontName ?? captionsSource.font,
    fontSize: captionsSource.fontSize,
    maxLines: captionsSource.maxLines,
    maxLineWidthPct: captionsSource.maxLineWidthPct,
    primaryColor: captionsSource.color ?? captionsSource.primaryColor,
    highlightColor: captionsSource.highlightColor,
    outlineColor: captionsSource.outlineColor,
    backColor: captionsSource.backgroundColor ?? captionsSource.backColor,
    speakerTreatment: captionsSource.speakerTreatment,
    ...(preferredZones ? { preferredZones } : {}),
  }, width, height);
  let contentTop = presentationViewport.y + safeArea.top;
  let contentBottom = presentationViewport.y + viewportHeight - safeArea.bottom;
  let contentRect = rect(presentationViewport.x + safeArea.left, contentTop, viewportWidth - safeArea.left - safeArea.right, contentBottom - contentTop);
  if (contentRect.width < 24 || contentRect.height < 16) throw new TypeError('presentation output safe area leaves no readable content rectangle');
  let voiceSource = isObject(source.voice) ? source.voice : {};
  let speakerMode = cleanText(voiceSource.mode ?? source.speakerMode ?? source.voiceMode, 'dialogue');
  speakerMode = speakerMode === 'single' || speakerMode === 'single-narrator' ? 'single' : 'dialogue';
  let speakerId = cleanText(voiceSource.speakerId ?? source.speakerId ?? source.narratorId);
  if (speakerMode === 'single' && !speakerId) throw new TypeError('single-speaker presentation output requires voice.speakerId');
  let sequenceMode = cleanText(voiceSource.sequenceMode ?? source.sequenceMode, 'sequential') === 'overlap' ? 'overlap' : 'sequential';
  let locale = cleanText(source.locale ?? source.language ?? voiceSource.language, 'en-US');
  let durationSource = isObject(source.duration) ? source.duration : {};
  let targetMs = positiveInteger(durationSource.targetMs ?? source.durationMs, 60000);
  let minMs = positiveInteger(durationSource.minMs ?? source.minDurationMs, Math.round(targetMs * 0.8));
  let maxMs = positiveInteger(durationSource.maxMs ?? source.maxDurationMs, Math.round(targetMs * 1.2));
  if (minMs > targetMs || maxMs < targetMs || minMs > maxMs) throw new TypeError('presentation output duration bounds are inconsistent');
  let normalized = {
    schemaVersion: PRESENTATION_OUTPUT_SPEC_SCHEMA_VERSION,
    format: orientation,
    orientation,
    aspectRatio,
    width,
    height,
    fps,
    dpr,
    frameInsets,
    presentationViewport,
    safeArea,
    contentRect,
    captions: {
      enabled: captionsEnabled,
      mode: captionsMode,
      profile: captionProfile,
    },
    voice: {
      mode: speakerMode,
      sequenceMode,
      language: locale,
      ...(speakerMode === 'single' ? { speakerId } : {}),
    },
    locale,
    duration: { targetMs, minMs, maxMs },
  };
  return { ...normalized, hash: `${PRESENTATION_OUTPUT_SPEC_SCHEMA_VERSION}:${computeIntegrity(normalized)}` };
}

export function normalizePresentationTargetComposition(input = {}) {
  let source = isObject(input) ? input : {};
  return {
    targetRect: normalizePresentationRect(source.targetRect || source.rect),
    focusRect: normalizePresentationRect(source.focusRect || source.targetRect || source.rect),
    visibleRect: normalizePresentationRect(source.visibleRect || source.focusRect || source.targetRect || source.rect),
    visibleRatio: Math.max(0, Math.min(1, rounded(source.visibleRatio ?? 0))),
    visible: source.visible === true,
    reachable: source.reachable === true,
    hasText: source.hasText === true,
    fontSizePx: Math.max(0, rounded(source.fontSizePx)),
    textTruncated: source.textTruncated === true,
    occluders: uniqueSorted(source.occluders),
    pointerTransparentOccluders: uniqueSorted(source.pointerTransparentOccluders),
    revealable: source.revealable === true,
    scrollable: source.scrollable === true,
  };
}

function normalizeScrollProjection(input = {}) {
  let source = isObject(input) ? input : {};
  return {
    id: cleanText(source.id || source.containerId),
    before: { left: rounded(source.before?.left), top: rounded(source.before?.top) },
    after: { left: rounded(source.after?.left), top: rounded(source.after?.top) },
    changed: source.changed === true,
    applied: source.applied === true,
  };
}

function normalizeCompositionStep(input = {}, index = 0) {
  let source = isObject(input) ? input : {};
  let turnId = cleanText(source.turnId, `turn-${index + 1}`);
  let slotIndex = Math.max(0, Math.floor(finiteNumber(source.slotIndex, 0)));
  let annotation = isObject(source.annotation) ? {
    placement: cleanText(source.annotation.placement),
    rect: normalizePresentationRect(source.annotation.rect),
  } : null;
  return {
    id: cleanText(source.id, `${turnId}:${slotIndex}`),
    turnId,
    slotIndex,
    targetId: cleanText(source.targetId || source.target),
    stateActions: clonePortable(Array.isArray(source.stateActions) ? source.stateActions : []),
    scroll: (Array.isArray(source.scroll) ? source.scroll : []).map(normalizeScrollProjection),
    measurement: normalizePresentationTargetComposition(source.measurement || source.composition),
    annotation,
  };
}

export function createLessonIntentHash(lessonContext = {}, timeline = {}) {
  let lesson = isObject(lessonContext.lesson) ? lessonContext.lesson : {};
  let intent = {
    lessonType: cleanText(lesson.type),
    objective: cleanText(lesson.objective).toLowerCase(),
    locale: cleanText(lesson.locale || lessonContext.locale || timeline.locale).toLowerCase(),
    requiredFactIds: uniqueSorted(lesson.requiredFactIds),
    requiredTargetIds: uniqueSorted(lesson.requiredTargetIds),
  };
  return `workspace-lesson-intent-v1:${computeIntegrity(intent)}`;
}

export function createPresentationCompositionPlan(input = {}) {
  if (input.schemaVersion !== undefined && input.schemaVersion !== PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION) {
    throw new TypeError(`unsupported presentation composition schema version: ${input.schemaVersion}`);
  }
  let output = normalizePresentationOutputSpec(input.output || input.outputSpec || {});
  let steps = (Array.isArray(input.steps) ? input.steps : []).map(normalizeCompositionStep);
  let plan = {
    schemaVersion: PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION,
    output,
    outputSpecHash: output.hash,
    structuralHash: cleanText(input.structuralHash || input.targetSnapshotHash),
    sourceCompositionHash: cleanText(input.sourceCompositionHash),
    targetCompositionHash: cleanText(input.targetCompositionHash),
    timelineHash: cleanText(input.timelineHash),
    lessonIntentHash: cleanText(input.lessonIntentHash),
    measuredViewport: {
      width: positiveInteger(input.measuredViewport?.width, 0),
      height: positiveInteger(input.measuredViewport?.height, 0),
      visualWidth: positiveInteger(input.measuredViewport?.visualWidth, 0),
      visualHeight: positiveInteger(input.measuredViewport?.visualHeight, 0),
      dpr: finiteNumber(input.measuredViewport?.dpr, 0),
    },
    baselineStructuralHash: cleanText(input.baselineStructuralHash),
    restoredStructuralHash: cleanText(input.restoredStructuralHash),
    simulationFrozen: input.simulationFrozen === true,
    overlayIgnoreIds: uniqueSorted(input.overlayIgnoreIds),
    steps,
  };
  return { ...plan, hash: `${PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION}:${computeIntegrity(plan)}` };
}

function auditIssue(code, path, message) {
  if (!ISSUE_CODE_SET.has(code)) throw new TypeError(`unregistered presentation composition issue code: ${code}`);
  return { code, severity: 'error', path, message };
}

export function auditPresentationCompositionPlan(plan = {}, expectations = {}) {
  let issues = [];
  let add = (code, path, message) => issues.push(auditIssue(code, path, message));
  if (!isObject(plan) || plan.schemaVersion !== PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION) {
    add('composition-required', 'schemaVersion', 'a current presentation composition plan is required');
    return { verdict: 'reject', issueCodes: issues.map((issue) => issue.code), issues, coverage: {} };
  }
  let normalizedPlan = createPresentationCompositionPlan(plan);
  if (plan.hash !== normalizedPlan.hash) {
    add('composition-repair-stale', 'hash', 'composition measurements changed after the plan was signed');
  }
  plan = normalizedPlan;
  let output;
  try {
    output = normalizePresentationOutputSpec(plan.output || {});
  } catch (cause) {
    add('output-context-stale', 'output', cause.message);
    return { verdict: 'reject', issueCodes: issues.map((issue) => issue.code), issues, coverage: {} };
  }
  if (plan.outputSpecHash !== output.hash || (expectations.outputSpecHash && expectations.outputSpecHash !== output.hash)) {
    add('output-context-stale', 'outputSpecHash', 'composition output does not match the selected output spec');
  }
  if (expectations.structuralHash && plan.structuralHash !== expectations.structuralHash) add('output-context-stale', 'structuralHash', 'composition targets a stale structural snapshot');
  let expectedSourceCompositionHash = cleanText(expectations.sourceCompositionHash);
  let expectedTargetCompositionHash = cleanText(expectations.targetCompositionHash);
  if (!expectedSourceCompositionHash) {
    add('output-context-stale', 'sourceCompositionHash', 'an external source composition identity is required');
  } else if (plan.sourceCompositionHash !== expectedSourceCompositionHash) {
    add('output-context-stale', 'sourceCompositionHash', 'composition targets a stale source layout');
  }
  if (!expectedTargetCompositionHash) {
    add('output-context-stale', 'targetCompositionHash', 'an external target composition identity is required');
  } else if (plan.targetCompositionHash !== expectedTargetCompositionHash) {
    add('output-context-stale', 'targetCompositionHash', 'composition targets a stale output layout');
  }
  if (expectations.timelineHash && plan.timelineHash !== expectations.timelineHash) add('composition-repair-stale', 'timelineHash', 'composition targets a stale or unrepaired timeline');
  if (expectations.lessonIntentHash && plan.lessonIntentHash !== expectations.lessonIntentHash) add('lesson-intent-mismatch', 'lessonIntentHash', 'composition changed the lesson intent');
  let presentationViewport = output.presentationViewport;
  let measured = plan.measuredViewport || {};
  if (
    measured.width !== presentationViewport.width
    || measured.height !== presentationViewport.height
    || measured.visualWidth !== presentationViewport.width
    || measured.visualHeight !== presentationViewport.height
    || measured.dpr !== output.dpr
  ) add('output-viewport-mismatch', 'measuredViewport', 'measured browser viewport does not match the presentation viewport and DPR');
  if (!plan.simulationFrozen) add('composition-simulation-active', 'simulationFrozen', 'live simulation was active during composition measurement');
  if (!plan.baselineStructuralHash || plan.baselineStructuralHash !== plan.restoredStructuralHash) add('composition-restore-mismatch', 'restoredStructuralHash', 'workspace state was not restored after composition preflight');
  let stepByTarget = new Map();
  let stepIds = new Set();
  for (let [index, step] of (Array.isArray(plan.steps) ? plan.steps : []).entries()) {
    let path = `steps[${index}]`;
    if (!step.id || stepIds.has(step.id)) add('composition-step-missing', `${path}.id`, 'composition step ID is missing or duplicated');
    stepIds.add(step.id);
    if (!step.targetId) add('composition-step-missing', `${path}.targetId`, 'composition step has no target');
    if (step.targetId && !stepByTarget.has(step.targetId)) stepByTarget.set(step.targetId, []);
    if (step.targetId) stepByTarget.get(step.targetId).push(step);
    let measurement = normalizePresentationTargetComposition(step.measurement || {});
    let focusRect = translateRect(measurement.focusRect, presentationViewport.x, presentationViewport.y);
    let annotationRect = step.annotation?.rect ? translateRect(step.annotation.rect, presentationViewport.x, presentationViewport.y) : null;
    if (!measurement.reachable) add('target-unreachable', path, 'target cannot be reached by declared reversible actions');
    if (!measurement.visible) add('target-hidden', path, 'target remains hidden after composition actions');
    if (
      focusRect.width < 24
      || focusRect.height < 16
      || measurement.visibleRatio < 0.995
      || !rectContains(output.contentRect, focusRect, 1)
    ) add('target-clipped', path, 'target focus rectangle is clipped or outside usable content');
    if (measurement.occluders.length || measurement.pointerTransparentOccluders.length) add('target-occluded', path, 'target focus rectangle is occluded');
    if (measurement.hasText && (measurement.fontSizePx < 12 || measurement.textTruncated)) add('target-unreadable', path, 'target text is too small or truncated');
    if ((Array.isArray(step.scroll) ? step.scroll : []).some((scroll) => scroll.changed && !scroll.applied)) add('composition-scroll-failed', `${path}.scroll`, 'absolute scroll projection was not applied');
    if (!step.annotation?.placement || !annotationRect || !rectContains(output.contentRect, annotationRect, 1)
      || rectIntersects(annotationRect, focusRect)) {
      add('annotation-placement-unavailable', `${path}.annotation`, 'no collision-free annotation placement is available');
    }
  }
  let requiredTargetIds = uniqueSorted(expectations.requiredTargetIds);
  for (let targetId of requiredTargetIds) if (!stepByTarget.has(targetId)) add('composition-step-missing', 'steps', `missing composition step for target: ${targetId}`);
  return {
    schemaVersion: `${PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION}:audit-v1`,
    verdict: issues.length ? 'reject' : 'accept',
    issueCodes: uniqueSorted(issues.map((issue) => issue.code)),
    issues,
    coverage: {
      requiredTargetCount: requiredTargetIds.length,
      coveredTargetCount: requiredTargetIds.filter((id) => stepByTarget.has(id)).length,
      stepCount: Array.isArray(plan.steps) ? plan.steps.length : 0,
    },
  };
}

export function presentationRectsIntersect(left, right) {
  return rectIntersects(normalizePresentationRect(left), normalizePresentationRect(right));
}

function timedAvoidRegion(id, kind, value, startMs, endMs, offsetX, offsetY) {
  let region = normalizePresentationRect(value);
  if (region.width <= 0 || region.height <= 0 || endMs <= startMs) return null;
  return {
    id,
    kind,
    ...translateRect(region, offsetX, offsetY),
    startSec: startMs / 1000,
    endSec: endMs / 1000,
  };
}

function compositionAvoidRegions(timeline, alignedSequence, compositionPlan, presentationViewport) {
  let turnIndexById = new Map((timeline.turns || []).map((turn, index) => [turn.id, index]));
  let regions = [];
  for (let [stepIndex, step] of (compositionPlan.steps || []).entries()) {
    let turnIndex = turnIndexById.get(step.turnId);
    let span = alignedSequence.turns?.[turnIndex];
    if (turnIndex === undefined || !span) throw new TypeError(`composition step ${stepIndex} has no aligned turn span`);
    let measurement = normalizePresentationTargetComposition(step.measurement || {});
    let focus = timedAvoidRegion(
      `focus:${step.id || stepIndex}`,
      'focus',
      measurement.focusRect,
      span.startMs,
      span.endMs,
      presentationViewport.x,
      presentationViewport.y,
    );
    if (focus) regions.push(focus);
    let annotation = timedAvoidRegion(
      `annotation:${step.id || stepIndex}`,
      'annotation',
      step.annotation?.rect,
      span.startMs,
      span.endMs,
      presentationViewport.x,
      presentationViewport.y,
    );
    if (annotation) regions.push(annotation);
    let hasAction = (timeline.turns[turnIndex]?.cues || []).some((cue) => cue.kind === 'interaction');
    if (hasAction && focus) regions.push({ ...focus, id: `action:${step.id || stepIndex}`, kind: 'action' });
  }
  return regions;
}

function captionCueText(cue) {
  if (cleanText(cue?.text)) return cleanText(cue.text);
  return cleanText((Array.isArray(cue?.words) ? cue.words : []).map((word) => (
    typeof word === 'string' ? word : word?.text || word?.word
  )).join(' '));
}

function captionCueTurnIndex(cue, turnCount) {
  for (let value of [cue?.turnIndex, cue?.cueIndex]) {
    let index = Number(value);
    if (Number.isInteger(index) && index >= 0 && index < turnCount) return index;
  }
  if (turnCount === 1) return 0;
  return -1;
}

export function bindCaptionCuesToAlignedSequence(cues = [], alignedSequence = {}) {
  if (!Array.isArray(cues)) throw new TypeError('caption timing binding requires caption cues');
  let spans = Array.isArray(alignedSequence?.turns) ? alignedSequence.turns : [];
  if (!spans.length) throw new TypeError('caption timing binding requires aligned turn spans');
  let bound = cues.map((cue) => ({ ...cue }));
  let byTurn = new Map();
  for (let [cueIndex, cue] of bound.entries()) {
    let turnIndex = captionCueTurnIndex(cue, spans.length);
    if (turnIndex < 0) throw new TypeError(`caption cue ${cueIndex} is not bound to an aligned turn`);
    let startSec = Number(cue.startSec);
    let endSec = Number(cue.endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      throw new TypeError(`caption cue ${cueIndex} has invalid timing`);
    }
    if (!byTurn.has(turnIndex)) byTurn.set(turnIndex, []);
    byTurn.get(turnIndex).push({ cue, cueIndex, startSec, endSec });
  }
  for (let [turnIndex, span] of spans.entries()) {
    let turnCues = (byTurn.get(turnIndex) || [])
      .sort((left, right) => left.startSec - right.startSec || left.cueIndex - right.cueIndex);
    if (!turnCues.length) throw new TypeError(`caption timing binding has no cue for turn ${turnIndex}`);
    let spanStartSec = Number(span.startMs) / 1000;
    let spanEndSec = Number(span.endMs) / 1000;
    if (!Number.isFinite(spanStartSec) || !Number.isFinite(spanEndSec) || spanEndSec <= spanStartSec) {
      throw new TypeError(`caption timing binding has an invalid span for turn ${turnIndex}`);
    }
    turnCues[0].cue.startSec = spanStartSec;
    turnCues.at(-1).cue.endSec = spanEndSec;
    for (let index = 1; index < turnCues.length; index += 1) {
      let previous = turnCues[index - 1].cue;
      let current = turnCues[index].cue;
      let lower = Number(previous.startSec) + 0.001;
      let upper = Number(current.endSec) - 0.001;
      let boundary = Math.min(
        upper,
        Math.max(lower, (Number(previous.endSec) + Number(current.startSec)) / 2),
      );
      if (!Number.isFinite(boundary) || boundary <= lower - 0.001 || boundary >= upper + 0.001) {
        throw new TypeError(`caption timing binding cannot join cues in turn ${turnIndex}`);
      }
      previous.endSec = boundary;
      current.startSec = boundary;
    }
  }
  return bound;
}

function captionTimingDeltaMicros(leftSec, rightSec) {
  return Math.round(Math.abs(Number(leftSec) - Number(rightSec)) * 1000000);
}

function captionTimingOutsideTolerance(leftSec, rightSec) {
  return captionTimingDeltaMicros(leftSec, rightSec) > PRESENTATION_CAPTION_TIMING_TOLERANCE_MS * 1000;
}

function assertCaptionCueBinding(cues, timeline, alignedSequence, { speakerMode = 'dialogue', speakerId = '' } = {}) {
  let byTurn = new Map();
  let speakerIdentities = new Set();
  for (let [cueIndex, cue] of cues.entries()) {
    let turnIndex = captionCueTurnIndex(cue, timeline.turns.length);
    if (turnIndex < 0) throw new TypeError(`caption cue ${cueIndex} is not bound to an authored turn`);
    let span = alignedSequence.turns[turnIndex];
    let startSec = Number(cue?.startSec);
    let endSec = Number(cue?.endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) {
      throw new TypeError(`caption cue ${cueIndex} has invalid timing`);
    }
    let spanStartSec = span.startMs / 1000;
    let spanEndSec = span.endMs / 1000;
    if (
      (startSec < spanStartSec && captionTimingOutsideTolerance(startSec, spanStartSec))
      || (endSec > spanEndSec && captionTimingOutsideTolerance(endSec, spanEndSec))
    ) {
      throw new TypeError(`caption cue ${cueIndex} falls outside authored turn ${turnIndex}`);
    }
    let text = captionCueText(cue);
    if (!text) throw new TypeError(`caption cue ${cueIndex} has no text`);
    let speaker = cleanText(cue?.speaker);
    if (!speaker) throw new TypeError(`caption cue ${cueIndex} has no speaker identity`);
    speakerIdentities.add(speaker);
    if (speakerMode === 'dialogue' && speaker !== timeline.turns[turnIndex].persona) {
      throw new TypeError(`caption cue ${cueIndex} speaker does not match authored turn ${turnIndex}`);
    }
    if (speakerMode === 'single' && speaker !== speakerId) {
      throw new TypeError(`caption cue ${cueIndex} speaker does not match the declared single speaker`);
    }
    if (!byTurn.has(turnIndex)) byTurn.set(turnIndex, []);
    byTurn.get(turnIndex).push({ startSec, endSec, text });
  }
  if (speakerMode === 'single' && speakerIdentities.size !== 1) {
    throw new TypeError('single narrator captions require one consistent speaker identity');
  }
  for (let [turnIndex, turn] of timeline.turns.entries()) {
    let authoredCues = (byTurn.get(turnIndex) || [])
      .sort((left, right) => left.startSec - right.startSec);
    let reconstructed = cleanText(authoredCues
      .map((cue) => cue.text)
      .join(' '));
    if (reconstructed !== cleanText(turn.text)) {
      throw new TypeError(`caption cues do not reproduce authored turn ${turnIndex}`);
    }
    let span = alignedSequence.turns[turnIndex];
    let expectedStartSec = span.startMs / 1000;
    let expectedEndSec = span.endMs / 1000;
    if (
      !authoredCues.length
      || captionTimingOutsideTolerance(authoredCues[0].startSec, expectedStartSec)
      || captionTimingOutsideTolerance(authoredCues.at(-1).endSec, expectedEndSec)
    ) {
      throw new TypeError(`caption cues do not cover the authored timing of turn ${turnIndex}`);
    }
    for (let index = 1; index < authoredCues.length; index += 1) {
      if (captionTimingOutsideTolerance(authoredCues[index].startSec, authoredCues[index - 1].endSec)) {
        throw new TypeError(`caption cues have a timing gap or overlap in authored turn ${turnIndex}`);
      }
    }
  }
}

export function planCaptionPlacements(input = {}) {
  let timeline = createPresentationTimelineContract(isObject(input.timeline) ? input.timeline : {});
  let alignedSequence = isObject(input.alignedSequence) ? input.alignedSequence : {};
  let compositionPlan = isObject(input.compositionPlan) ? input.compositionPlan : {};
  if (!Array.isArray(timeline.turns) || timeline.turns.length === 0) {
    throw new TypeError('caption composition requires an authored timeline');
  }
  if (!Array.isArray(alignedSequence.turns) || alignedSequence.turns.length !== timeline.turns.length) {
    throw new TypeError('caption composition requires one aligned span for every timeline turn');
  }
  if (!Array.isArray(input.cues)) throw new TypeError('caption composition requires timed caption cues');
  validatePresentationAlignedSequence(alignedSequence, timeline);
  if (compositionPlan.schemaVersion !== PRESENTATION_COMPOSITION_PLAN_SCHEMA_VERSION) {
    throw new TypeError('caption composition requires a current presentation composition plan');
  }
  let normalizedPlan = createPresentationCompositionPlan(compositionPlan);
  if (compositionPlan.hash !== normalizedPlan.hash) throw new TypeError('caption composition plan hash is stale');
  let sourceCompositionHash = cleanText(input.sourceCompositionHash);
  let targetCompositionHash = cleanText(input.targetCompositionHash);
  if (!sourceCompositionHash || !targetCompositionHash) {
    throw new TypeError('caption composition requires external source and target composition identities');
  }
  if (
    normalizedPlan.sourceCompositionHash !== sourceCompositionHash
    || normalizedPlan.targetCompositionHash !== targetCompositionHash
  ) {
    throw new TypeError('caption composition plan targets stale source or target layout evidence');
  }
  let output = normalizePresentationOutputSpec(input.output || input.outputSpec || compositionPlan.output || {});
  if (
    alignedSequence.voice?.mode !== output.voice.mode
    || (output.voice.mode === 'single' && alignedSequence.voice?.speakerId !== output.voice.speakerId)
  ) {
    throw new TypeError('caption alignment voice identity does not match the presentation output');
  }
  assertCaptionCueBinding(input.cues, timeline, alignedSequence, {
    speakerMode: output.voice.mode,
    speakerId: output.voice.speakerId,
  });
  if (normalizedPlan.timelineHash !== timeline.hash) {
    throw new TypeError('caption composition plan targets a stale authored timeline');
  }
  if (normalizedPlan.outputSpecHash !== output.hash) {
    throw new TypeError('caption composition output does not match the composition plan');
  }
  let requiredTargetIds = listPresentationCompositionCueSlots(timeline).map((slot) => slot.targetId);
  let compositionAudit = auditPresentationCompositionPlan(normalizedPlan, {
    sourceCompositionHash,
    targetCompositionHash,
    outputSpecHash: output.hash,
    timelineHash: timeline.hash,
    requiredTargetIds,
  });
  if (compositionAudit.verdict !== 'accept') {
    let error = new TypeError(`caption composition rejected layout evidence: ${compositionAudit.issueCodes.join(', ')}`);
    error.code = 'PRESENTATION_COMPOSITION_REJECTED';
    error.review = compositionAudit;
    throw error;
  }
  let stepsByTurnAndTarget = new Map();
  for (let step of normalizedPlan.steps) {
    let key = `${step.turnId}\u0000${step.targetId}`;
    if (!stepsByTurnAndTarget.has(key)) stepsByTurnAndTarget.set(key, []);
    stepsByTurnAndTarget.get(key).push(step);
  }
  for (let [turnIndex, turn] of timeline.turns.entries()) {
    for (let [cueIndex, cue] of turn.cues.entries()) {
      if (!['focus', 'interaction', 'annotation'].includes(cue.kind)) continue;
      let key = `${turn.id}\u0000${cue.targetId}`;
      let steps = stepsByTurnAndTarget.get(key) || [];
      let covered = steps.some((step) => {
        if (cue.kind === 'annotation') {
          let annotationRect = normalizePresentationRect(step.annotation?.rect);
          return Boolean(step.annotation?.placement && annotationRect.width > 0 && annotationRect.height > 0);
        }
        let focusRect = normalizePresentationTargetComposition(step.measurement).focusRect;
        return focusRect.width > 0 && focusRect.height > 0;
      });
      if (!covered) {
        throw new TypeError(
          `caption composition is missing measured coverage for ${cue.kind} cue ${turnIndex}.${cueIndex}`,
        );
      }
    }
  }
  let presentationViewport = output.presentationViewport;
  let avoidRegions = [
    ...compositionAvoidRegions(timeline, alignedSequence, normalizedPlan, presentationViewport),
    ...(Array.isArray(input.reservedRegions) ? input.reservedRegions : []),
    ...(Array.isArray(input.avoidRegions) ? input.avoidRegions : []),
  ];
  let safeInsets = {
    top: presentationViewport.y + output.safeArea.top,
    right: output.width - presentationViewport.x - presentationViewport.width + output.safeArea.right,
    bottom: output.height - presentationViewport.y - presentationViewport.height + output.safeArea.bottom,
    left: presentationViewport.x + output.safeArea.left,
  };
  let track = output.captions.enabled
    ? buildCaptionPlacementTrack(input.cues, {
        width: output.width,
        height: output.height,
        captionStyle: output.captions.profile,
        safeInsets,
        avoidRegions,
      })
    : null;
  let composition = {
    schemaVersion: PRESENTATION_CAPTION_COMPOSITION_SCHEMA_VERSION,
    outputSpecHash: output.hash,
    timelineHash: timeline.hash,
    alignedSequenceHash: cleanText(alignedSequence.hash),
    compositionPlanHash: normalizedPlan.hash,
    output,
    track,
  };
  return {
    ...composition,
    hash: `${PRESENTATION_CAPTION_COMPOSITION_SCHEMA_VERSION}:${computeIntegrity(composition)}`,
  };
}
