import { parseWorkspaceAddress } from '../schema/was.js';
import { computeIntegrity } from '../schema/canonical-json.js';
import { auditPresentationTimelineClaims } from './lesson-context.js';
import {
  PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION,
  PRESENTATION_REPLAN_RESULT_SCHEMA_VERSION,
  auditPresentationCompositionPlan,
  createLessonIntentHash,
  normalizePresentationOutputSpec,
  normalizePresentationTargetComposition,
} from './presentation-output.js';

export {
  PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION,
  PRESENTATION_REPLAN_RESULT_SCHEMA_VERSION,
} from './presentation-output.js';

export const PRESENTATION_PROMPT_PROFILES = Object.freeze(['brief', 'full', 'data-grounded', 'task-specific', 'dialogue']);
export const PRESENTATION_CONTRACT_VERSION = 'presentation-timeline-v2';
export const PRESENTATION_LESSON_AUDIT_SCHEMA_VERSION = 'presentation-lesson-audit-v2';
export const PRESENTATION_LESSON_REVIEW_CODES = Object.freeze([
  'action-disallowed-target',
  'action-missing-name',
  'dialogue-clarification-missing',
  'dialogue-grounding-disconnected',
  'dialogue-question-missing',
  'spoken-speaker-label',
  'spoken-dom-token',
  'spoken-metadata-token',
  'unsafe-tts-text',
  'repeated-boilerplate',
  'disallowed-target',
  'disallowed-tool',
  'dialogue-reply-missing',
  'dialogue-role-count',
  'dialogue-question-unanswered',
  'dialogue-single-persona',
  'missing-dialogue-handoff',
  'missing-cue-tab',
  'missing-cue-target',
  'missing-requested-surface',
  'missing-requested-tab',
  'missing-required-persona',
  'missing-turns',
  'grounding-required',
  'grounding-ref-unknown',
  'grounding-target-mismatch',
  'request-keyword-missing',
  'tts-long-turn',
  'turn-budget-overflow',
  'turn-budget-underflow',
  'unsupported-action-source',
  'dialogue-monologue-run',
  'self-overlap',
  'overlong-overlap-turn',
]);

const PRESENTATION_DIALOGUE_ACTS = new Set([
  'open',
  'explain',
  'ask',
  'clarify',
  'confirm',
  'respond',
  'handoff',
  'close',
]);

const PROFILE_ALIASES = Object.freeze({
  brief: 'brief',
  short: 'brief',
  quick: 'brief',
  summary: 'brief',
  concise: 'brief',
  full: 'full',
  complete: 'full',
  detailed: 'full',
  deep: 'full',
  data: 'data-grounded',
  grounded: 'data-grounded',
  'data-grounded': 'data-grounded',
  dialogue: 'dialogue',
  conversation: 'dialogue',
  contextual: 'data-grounded',
  focused: 'task-specific',
  podcast: 'dialogue',
  task: 'task-specific',
  'task-specific': 'task-specific',
  walkthrough: 'task-specific',
});

const DATA_REF_SOURCES = Object.freeze({
  selectedRecords: 'selected',
  selected: 'selected',
  retrievedContext: 'retrieved',
  retrieved: 'retrieved',
  mockData: 'mock',
  mock: 'mock',
  liveData: 'live',
  live: 'live',
  documentPresentation: 'document.presentation',
});

const PRESENTATION_REQUEST_STOPWORDS = new Set([
  'a',
  'about',
  'all',
  'and',
  'are',
  'available',
  'current',
  'describe',
  'dialogue',
  'explain',
  'focused',
  'for',
  'from',
  'how',
  'interface',
  'presentation',
  'podcast',
  'show',
  'task',
  'the',
  'this',
  'through',
  'tour',
  'two',
  'ui',
  'voice',
  'walk',
  'walkthrough',
  'workspace',
  'workspaces',
  'интерфейс',
  'как',
  'мне',
  'покажи',
  'презентация',
  'про',
  'тур',
  'что',
 ]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function listValue(value) {
  return Array.isArray(value) ? value : [];
}

function clonePortable(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'function') return undefined;
  if (typeof value !== 'object') return value;
  if (value.nodeType || value.ownerDocument || value.documentElement || value.defaultView) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => clonePortable(item))
      .filter((item) => item !== undefined);
  }
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    if (['element', 'el', 'node', 'dom', 'ref', 'refs', 'targetElement'].includes(key)) continue;
    let next = clonePortable(child);
    if (next !== undefined) result[key] = next;
  }
  return result;
}

function compactObject(value) {
  let result = {};
  for (let [key, child] of Object.entries(value || {})) {
    if (child !== undefined) result[key] = child;
  }
  return result;
}

function hasKeys(value) {
  return isObject(value) && Object.keys(value).length > 0;
}

function hasData(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== '';
}

function portableId(value, fallback = 'presentation') {
  let text = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9./:_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/[-_.:/]+$/g, '')
    .replace(/[-_.:/]{2,}/g, '-');
  if (!text) text = fallback;
  if (!/^[a-z]/.test(text)) text = `${fallback}-${text}`;
  return text;
}

function isValidWasAddress(address) {
  if (typeof address !== 'string' || address.length === 0) return false;
  try {
    parseWorkspaceAddress(address);
    return true;
  } catch {
    return false;
  }
}

function requestObject(request) {
  if (typeof request === 'string') return { prompt: request };
  return isObject(request) ? request : {};
}

function profileFromPrompt(prompt) {
  let text = String(prompt || '').toLowerCase();
  if (/(dialogue|conversation|podcast|two[-\s]?voice|two hosts|двухголос|диалог|подкаст)/i.test(text)) {
    return 'dialogue';
  }
  if (/(полн|подроб|деталь|full|complete|detailed|deep)/i.test(text)) return 'full';
  if (/(крат|корот|быстр|brief|short|quick|summary|concise)/i.test(text)) return 'brief';
  if (/(на основе данных|данн|контекст|data|record|records|selected|retrieved|grounded)/i.test(text)) {
    return 'data-grounded';
  }
  if (/(task|specific|focus|focused|scenario|workflow|задач|конкретн|сценари|процесс)/i.test(text)) {
    return 'task-specific';
  }
  return 'brief';
}

export function normalizePresentationPrompt(request = {}) {
  let input = requestObject(request);
  let rawProfile = input.profile || input.depth || input.mode;
  let profile = PROFILE_ALIASES[String(rawProfile || '').toLowerCase()] || profileFromPrompt(input.prompt);
  return {
    profile,
    prompt: typeof input.prompt === 'string' ? input.prompt : '',
    locale: typeof input.locale === 'string' && input.locale.trim() ? input.locale : 'en-US',
  };
}

function targetTitle(target) {
  return target.title || target.label || target.panelId || target.nodeId || target.id || target.address || 'workspace target';
}

function targetTabId(target = {}, context = {}) {
  let explicit = cleanTimelineText(target.tabId || target.viewId || target.windowId || target.boardId);
  if (explicit) return explicit;
  let address = cleanTimelineText(target.address);
  let match = address.match(/^panel:([^:]+):/);
  return match ? match[1] : cleanTimelineText(context.activeViewId || context.viewId);
}

function mergeTargetRecord(target, panel) {
  return compactObject({
    ...clonePortable(target),
    ...clonePortable(panel),
    address: panel?.address || target?.address,
    kind: target?.kind || 'panel',
    visible: Boolean(panel?.visible ?? target?.visible),
    revealActions: listValue(panel?.revealActions).length > 0 ? clonePortable(panel.revealActions) : clonePortable(target?.revealActions),
    safeActions: [
      ...listValue(target?.safeActions),
      ...listValue(panel?.safeActions),
    ],
    webmcpTools: [
      ...listValue(target?.webmcpTools),
      ...listValue(panel?.webmcpTools),
    ],
  });
}

function contextTargets(context = {}) {
  let byAddress = new Map();
  for (let target of listValue(context.targets)) {
    if (isValidWasAddress(target?.address)) byAddress.set(target.address, clonePortable(target));
  }

  let panels = listValue(context.panels)
    .map((panel) => mergeTargetRecord(byAddress.get(panel?.address), panel))
    .filter((target) => isValidWasAddress(target.address));

  let seen = new Set(panels.map((target) => target.address));
  let fallback = [...byAddress.values()].filter((target) => {
    if (seen.has(target.address)) return false;
    if (target.kind === 'stack') return false;
    seen.add(target.address);
    return true;
  });
  return [...panels, ...fallback];
}

function dataRefCandidates(dataContext = {}) {
  let refs = [];
  if (hasData(dataContext.route?.data)) {
    for (let [key, value] of Object.entries(dataContext.route.data)) {
      refs.push(createSourceEvidence('route', `state:route.data.${key}`, value));
    }
  } else if (hasData(dataContext.route)) {
    refs.push(createSourceEvidence('route', 'state:route', dataContext.route));
  }
  for (let [key, source] of Object.entries(DATA_REF_SOURCES)) {
    if (hasData(dataContext[key])) refs.push(createSourceEvidence(source, key, dataContext[key]));
  }
  return refs;
}

function sanitizedEvidenceSummary(value, maxLength = 200) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(clonePortable(value));
  } catch {
    text = String(value || '');
  }
  return cleanTimelineText(text)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/([?&](?:token|key|secret|password|authorization)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, Math.max(0, maxLength));
}

function createSourceEvidence(kind, path, value, options = {}) {
  let portable = clonePortable(value);
  let serialized;
  try {
    serialized = JSON.stringify(portable);
  } catch {
    serialized = String(value || '');
  }
  let id = portableId(options.id || `source-${kind}-${path}`, 'source');
  return compactObject({
    id,
    source: kind,
    kind,
    path: cleanTimelineText(path),
    targetId: cleanTimelineText(options.targetId),
    contentHash: computeIntegrity(serialized),
    length: serialized.length,
    generation: Number.isInteger(options.generation) ? options.generation : undefined,
    summary: sanitizedEvidenceSummary(value),
  });
}

function uniqueByAddress(targets) {
  let seen = new Set();
  let result = [];
  for (let target of targets) {
    if (!target?.address || seen.has(target.address)) continue;
    seen.add(target.address);
    result.push(target);
  }
  return result;
}

function dataTargetScore(target) {
  let haystack = JSON.stringify([
    target.address,
    target.kind,
    target.title,
    target.panelId,
    target.module,
    target.enrichment,
  ]).toLowerCase();
  let score = 0;
  for (let token of ['data', 'record', 'row', 'selected', 'context', 'document', 'table', 'queue']) {
    if (haystack.includes(token)) score += 1;
  }
  if (target.visible) score += 1;
  return score;
}

function targetSearchText(target = {}) {
  return JSON.stringify([
    target.address,
    target.kind,
    target.title,
    target.label,
    target.panelId,
    target.module,
    target.enrichment,
    target.safeActions,
    target.webmcpTools,
  ]).toLowerCase();
}

function requestTargetScore(target = {}, keywords = []) {
  if (!keywords.length) return 0;
  let haystack = targetSearchText(target);
  let score = 0;
  for (let keyword of keywords) {
    if (haystack.includes(keyword)) score += 2;
  }
  if (target.visible) score += 1;
  return score;
}

function choosePresentationTargets(context, profile, request) {
  let targets = contextTargets(context);
  let visible = targets.filter((target) => target.visible);
  let primary = visible.length > 0 ? visible : targets;
  let defaultLimit = profile === 'full' ? targets.length : profile === 'dialogue' ? 4 : profile === 'data-grounded' || profile === 'task-specific' ? 3 : 1;
  let limit = Number.isInteger(request.maxSegments) && request.maxSegments > 0 ? request.maxSegments : defaultLimit;

  if (profile === 'full') return targets.slice(0, limit);
  if (profile === 'dialogue' || profile === 'task-specific') {
    let keywords = keywordList(request.requestKeywords || request.keywords || request.prompt || request.taskText || request.goal);
    let ranked = targets
      .map((target) => ({ target, score: requestTargetScore(target, keywords) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.target);
    return uniqueByAddress([...ranked, ...primary, ...targets]).slice(0, limit);
  }
  if (profile === 'data-grounded') {
    let ranked = [...targets].sort((a, b) => dataTargetScore(b) - dataTargetScore(a));
    return uniqueByAddress([primary[0], ...ranked]).slice(0, limit);
  }
  return primary.slice(0, limit);
}

function actionName(action) {
  if (typeof action?.name === 'string' && action.name.trim()) return action.name;
  if (typeof action?.id === 'string' && action.id.trim()) return action.id;
  return '';
}

function segmentActions(target, profile) {
  let actions = [];
  for (let tool of listValue(target.webmcpTools)) {
    let name = actionName(tool);
    if (name) actions.push({ source: 'webmcp', name, target: target.address, input: clonePortable(tool.input) });
  }
  for (let action of listValue(target.safeActions)) {
    let name = actionName(action);
    if (name) actions.push({ source: 'workspace', name, target: target.address, input: clonePortable(action.input) });
  }
  return actions.slice(0, profile === 'full' ? 2 : 1).map(compactObject);
}

function narrationFor(profile, target, index, total, refs, context, requestInfo = {}) {
  let title = targetTitle(target);
  let visibility = target.visible ? 'visible' : 'hidden until revealed';
  if (profile === 'brief') return `${title}: ${visibility} workspace surface.`;
  if (profile === 'task-specific') {
    let focus = listValue(requestInfo.keywords).slice(0, 6).join(', ') || 'the requested workflow';
    return `${title}: focus on ${focus} using this ${visibility} workspace surface.`;
  }
  if (profile === 'dialogue') {
    let focus = listValue(requestInfo.keywords).slice(0, 6).join(', ');
    let suffix = focus ? ` for ${focus}` : '';
    if (index === 0) return `Start with ${title}${suffix} so the viewer has the source context.`;
    if (index === 1) return `What does ${title} add to the result we just saw?`;
    if (index === total - 1) return `${title} closes the explanation by connecting the evidence to the requested outcome.`;
    return `${title} answers that by showing the next concrete workspace signal.`;
  }
  if (profile === 'data-grounded') {
    let sources = refs.map((ref) => ref.source).filter(Boolean).join(', ') || 'available';
    return `${title}: present this surface using ${sources} context from the current workspace state.`;
  }
  let actions = listValue(target.safeActions).length + listValue(target.webmcpTools).length;
  let hidden = listValue(target.hiddenReasons).join(', ') || 'none';
  return `${title} is ${visibility}. It exposes ${actions} guided interaction${actions === 1 ? '' : 's'} for this part of the workflow.`;
}

function segmentDataRefs(target, profile, refs) {
  if (!['data-grounded', 'task-specific', 'dialogue'].includes(profile)) return [];
  return refs.map((ref) => ({ ...ref, target: target.address, targetId: target.address }));
}

function cleanTimelineText(value, fallback = '') {
  let text = String(value ?? fallback ?? '').replace(/\s+/g, ' ').trim();
  return text && text !== 'undefined' && text !== 'null' ? text : String(fallback || '').trim();
}

function nonNegativeNumber(value, fallback = undefined) {
  let number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function positiveNumber(value, fallback = undefined) {
  let number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function idList(value) {
  return listValue(value)
    .map((item) => cleanTimelineText(item))
    .filter(Boolean);
}

function keywordList(value) {
  let source = Array.isArray(value) ? value.join(' ') : String(value || '');
  return [...new Set(source
    .toLowerCase()
    .normalize('NFKD')
    .split(/[^a-zа-яё0-9_-]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 2 && !PRESENTATION_REQUEST_STOPWORDS.has(item)))];
}

function requestKeywords(intent = {}) {
  let explicit = keywordList(intent.requestKeywords || intent.keywords);
  if (explicit.length) return explicit;
  if (intent.requireRequestFit !== true) return [];
  return keywordList(intent.requestPrompt || intent.prompt || intent.task || intent.goal);
}

function wordCount(text) {
  let words = cleanTimelineText(text)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  return words.length;
}

function hasTtsUnsafeToken(text) {
  return /\b(?:undefined|null|nan)\b/i.test(String(text || ''));
}

function hasSpokenMarkup(text) {
  return /https?:\/\/|www\.|<\/?(?:speak|prosody|break|emphasis)\b|\*\*|__|[`{}[\]]|[\u0000-\u001f\u007f]/i
    .test(String(text || ''));
}

function hasSpokenSpeakerLabel(text) {
  return /^\s*(?:speaker\s*\d+|guide|ops|host|narrator|assistant|user)\s*[:：-]\s+/i.test(String(text || ''));
}

function boilerplateSignature(text) {
  let words = cleanTimelineText(text)
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s-]+/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 5).join(' ');
}

function normalizedTurnText(text) {
  return cleanTimelineText(text)
    .toLowerCase()
    .replace(/\b(?:this|that|the|a|an)\b/g, ' ')
    .replace(/[^a-zа-яё0-9\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function spokenRegistryToken(text, tokens = []) {
  let spoken = String(text || '').toLowerCase();
  return tokens.find((token) => {
    let value = cleanTimelineText(token).toLowerCase();
    return value.length >= 3 && spoken.includes(value);
  }) || '';
}

function hasDomSpeechToken(text) {
  return /(?:^|\s)(?:#[a-z][\w-]*|\.[a-z][\w-]*|\[[a-z][^\]]*\]|(?:queryselector|dataset|classname|innerhtml)\b)/i
    .test(String(text || ''));
}

function hasSerializedMetadataToken(text) {
  return /\b(?:targetId|tabId|panelId|workspaceId|dataRefs|sourceRefs|dialogueAct|replyTo|contractVersion|renderCue|webmcpTools)(?:\b|\s*[:.[\]])/i
    .test(String(text || ''));
}

function hasDialogueHandoff(text) {
  return /\b(?:yes|right|exactly|also|and|but|so|then|now|that|this|those|because|while|here|notice|you|i see|correct|agreed|да|верно|точно|также|но|поэтому|тогда|сейчас|это|здесь)\b/i
    .test(String(text || ''));
}

function turnStartMs(turn = {}) {
  return nonNegativeNumber(turn.renderCue?.startMs ?? turn.renderCue?.start, undefined);
}

function turnEndMs(turn = {}) {
  let explicit = nonNegativeNumber(turn.renderCue?.endMs ?? turn.renderCue?.end, undefined);
  if (explicit !== undefined) return explicit;
  let start = turnStartMs(turn);
  let duration = positiveNumber(turn.renderCue?.durationMs ?? turn.renderCue?.duration, undefined);
  if (start !== undefined && duration !== undefined) return start + duration;
  return undefined;
}

function normalizeTurnBudget(intent = {}) {
  let source = isObject(intent.turnBudget) ? intent.turnBudget : {};
  let min = nonNegativeNumber(source.min ?? source.minTurns ?? intent.minTurns, undefined);
  let max = nonNegativeNumber(source.max ?? source.maxTurns ?? intent.maxTurns, undefined);
  return compactObject({
    minTurns: min === undefined ? undefined : Math.floor(min),
    maxTurns: max === undefined ? undefined : Math.floor(max),
  });
}

function tabCovered(tabId, targetIds, tabIds) {
  if (tabIds.has(tabId)) return true;
  return [...targetIds].some((targetId) => (
    targetId === `window:${tabId}` || targetId.startsWith(`panel:${tabId}:`)
  ));
}

function normalizeCueTarget(value, fallback = '') {
  return cleanTimelineText(value, fallback);
}

function normalizePresentationCue(cue = {}, fallback = {}) {
  let source = isObject(cue) ? cue : {};
  return compactObject({
    targetId: normalizeCueTarget(
      source.targetId || source.target || source.address || fallback.targetId || fallback.target || fallback.focusTarget,
    ),
    tabId: cleanTimelineText(source.tabId || fallback.tabId),
    marker: cleanTimelineText(source.marker || fallback.marker || fallback.kind),
  });
}

function normalizeSourceRef(ref = {}) {
  if (typeof ref === 'string') return compactObject({ sourceId: cleanTimelineText(ref) });
  if (!isObject(ref)) return null;
  return compactObject({
    sourceId: cleanTimelineText(ref.sourceId || ref.id || ref.source),
    path: cleanTimelineText(ref.path),
    hash: cleanTimelineText(ref.hash || ref.contentHash),
    targetId: cleanTimelineText(ref.targetId || ref.target),
  });
}

function normalizeGroundingSource(source = {}) {
  if (!isObject(source)) return null;
  let id = cleanTimelineText(source.id || source.sourceId || source.source);
  if (!id) return null;
  return compactObject({
    id,
    kind: cleanTimelineText(source.kind || source.source),
    path: cleanTimelineText(source.path),
    targetId: cleanTimelineText(source.targetId || source.target),
    contentHash: cleanTimelineText(source.contentHash || source.hash),
    length: nonNegativeNumber(source.length, undefined),
    generation: Number.isInteger(source.generation) ? source.generation : undefined,
    summary: sanitizedEvidenceSummary(source.summary || source.excerpt || ''),
  });
}

function groundingSourcesFromSegments(segments = []) {
  let byId = new Map();
  for (let segment of listValue(segments)) {
    for (let ref of listValue(segment?.dataRefs)) {
      let source = normalizeGroundingSource({
        ...ref,
        id: ref?.id || portableId(`source-${ref?.source || 'data'}-${ref?.path || 'value'}`, 'source'),
        targetId: ref?.targetId || ref?.target || segment?.target,
      });
      if (source) byId.set(source.id, source);
    }
  }
  return [...byId.values()];
}

function normalizePresentationTurn(turn = {}, index = 0) {
  if (!isObject(turn)) return null;
  let text = cleanTimelineText(turn.text ?? turn.narration ?? turn.caption);
  if (!text) return null;
  let persona = cleanTimelineText(turn.persona ?? turn.speaker);
  let cue = normalizePresentationCue(turn.cue, turn);
  return compactObject({
    id: cleanTimelineText(turn.id, `turn-${index + 1}`),
    persona,
    text,
    cue: hasKeys(cue) ? cue : undefined,
    dialogueAct: PRESENTATION_DIALOGUE_ACTS.has(cleanTimelineText(turn.dialogueAct || turn.act))
      ? cleanTimelineText(turn.dialogueAct || turn.act)
      : undefined,
    replyTo: cleanTimelineText(turn.replyTo || turn.responseToTurnId),
    sourceRefs: listValue(turn.sourceRefs || turn.dataRefs)
      .map((ref) => normalizeSourceRef(ref))
      .filter(Boolean),
    claims: listValue(turn.claims).map((claim) => clonePortable(claim)).filter(hasKeys),
    emotion: cleanTimelineText(turn.emotion || turn.style),
    pauseBeforeMs: nonNegativeNumber(turn.pauseBeforeMs ?? turn.gapMs),
    overlapMs: nonNegativeNumber(turn.overlapMs ?? turn.overlap),
    webmcp: clonePortable(turn.webmcp),
    actions: listValue(turn.actions)
      .map((action) => clonePortable(action))
      .filter(hasKeys),
    annotations: clonePortable(turn.annotations),
    renderCue: clonePortable(turn.renderCue),
  });
}

function segmentToPresentationTurn(segment = {}, index = 0) {
  if (!isObject(segment)) return null;
  let firstCue = listValue(segment.cues)[0] || {};
  return normalizePresentationTurn({
    id: segment.id || `turn-${index + 1}`,
    persona: segment.persona || segment.speaker,
    text: segment.narration || segment.text,
    cue: {
      targetId: firstCue.target || firstCue.targetId || segment.focusTarget || segment.target,
      tabId: firstCue.tabId || segment.tabId,
      marker: firstCue.marker || firstCue.kind,
    },
    actions: segment.actions,
    dialogueAct: segment.dialogueAct,
    replyTo: segment.replyTo,
    sourceRefs: listValue(segment.sourceRefs).length ? segment.sourceRefs : listValue(segment.dataRefs).map((ref) => ({
      sourceId: ref?.id || portableId(`source-${ref?.source || 'data'}-${ref?.path || 'value'}`, 'source'),
      path: ref?.path,
      hash: ref?.contentHash || ref?.hash,
      targetId: ref?.targetId || ref?.target || segment.target,
    })),
    claims: segment.claims,
    annotations: segment.annotations,
  }, index);
}

function normalizePresentationPersonas(personas = {}, turns = [], locale = 'en-US') {
  let result = {};
  if (isObject(personas)) {
    for (let [key, persona] of Object.entries(personas)) {
      let id = cleanTimelineText(key);
      if (!id) continue;
      if (typeof persona === 'string') {
        result[id] = { name: cleanTimelineText(persona, id) };
        continue;
      }
      if (!isObject(persona)) {
        result[id] = { name: id };
        continue;
      }
      result[id] = compactObject({
        name: cleanTimelineText(persona.name, id),
        lang: cleanTimelineText(persona.lang || persona.locale),
        rate: Number.isFinite(Number(persona.rate)) ? Number(persona.rate) : undefined,
        pitch: Number.isFinite(Number(persona.pitch)) ? Number(persona.pitch) : undefined,
      });
    }
  }
  for (let turn of turns) {
    let id = cleanTimelineText(turn.persona);
    if (!id) continue;
    if (!result[id]) result[id] = { name: id, lang: cleanTimelineText(locale) };
  }
  return result;
}

function hashableTimelineProjection(timeline) {
  return {
    contractVersion: timeline.contractVersion,
    id: timeline.id,
    title: timeline.title,
    locale: timeline.locale,
    profile: timeline.profile,
    personas: timeline.personas,
    grounding: timeline.grounding,
    turns: timeline.turns.map((turn) => compactObject({
      persona: turn.persona,
      id: turn.id,
      text: turn.text,
      cue: hasKeys(turn.cue) ? turn.cue : undefined,
      dialogueAct: turn.dialogueAct,
      replyTo: turn.replyTo,
      sourceRefs: listValue(turn.sourceRefs).length ? turn.sourceRefs : undefined,
      claims: listValue(turn.claims).length ? turn.claims : undefined,
      pauseBeforeMs: turn.pauseBeforeMs,
      overlapMs: turn.overlapMs,
      webmcp: hasKeys(turn.webmcp) ? turn.webmcp : undefined,
      actions: listValue(turn.actions).length ? turn.actions : undefined,
      renderCue: hasKeys(turn.renderCue) ? turn.renderCue : undefined,
    })),
  };
}

export function normalizePresentationTimeline(input = {}, options = {}) {
  let source = isObject(input) ? input : {};
  let contractVersion = cleanTimelineText(
    options.contractVersion || source.contractVersion,
    PRESENTATION_CONTRACT_VERSION,
  );
  if (contractVersion !== PRESENTATION_CONTRACT_VERSION) {
    throw new Error(`unsupported presentation contract version: ${contractVersion}`);
  }
  let locale = cleanTimelineText(source.locale || source.lang || source.language, 'en-US');
  let title = cleanTimelineText(source.title || source.name, 'Workspace presentation');
  let profile = cleanTimelineText(source.profile || source.promptProfile || source.prompt?.profile || source.summary?.profile, 'brief');
  let turns = listValue(source.turns)
    .map((turn, index) => normalizePresentationTurn(turn, index))
    .filter(Boolean);
  if (!turns.length) {
    turns = listValue(source.segments)
      .map((segment, index) => segmentToPresentationTurn(segment, index))
      .filter(Boolean);
  }
  let segments = clonePortable(source.segments);
  let normalized = compactObject({
    contractVersion,
    id: portableId(source.id || title, 'presentation'),
    title,
    locale,
    profile,
    personas: normalizePresentationPersonas(source.personas, turns, locale),
    grounding: {
      sources: listValue(source.grounding?.sources).length
        ? listValue(source.grounding.sources).map(normalizeGroundingSource).filter(Boolean)
        : groundingSourcesFromSegments(source.segments),
    },
    turns,
    segments: Array.isArray(segments) ? segments : undefined,
    source: cleanTimelineText(source.source),
    metadata: clonePortable(source.metadata),
  });
  let summary = isObject(source.summary)
    ? clonePortable(source.summary)
    : summarizePresentationTimeline(normalized);
  normalized.summary = compactObject({
    ...summary,
    turnCount: turns.length,
  });
  return normalized;
}

export function createPresentationTimelineHash(input = {}, options = {}) {
  let timeline = normalizePresentationTimeline(input, options);
  if (!timeline.turns.length) {
    throw new Error('presentation timeline requires at least one narrated turn');
  }
  return `${timeline.contractVersion}:${computeIntegrity(hashableTimelineProjection(timeline))}`;
}

export function createPresentationTimelineContract(input = {}, options = {}) {
  let timeline = normalizePresentationTimeline(input, options);
  if (!timeline.turns.length) {
    throw new Error('presentation timeline requires at least one narrated turn');
  }
  return {
    ...timeline,
    hash: createPresentationTimelineHash(timeline, { contractVersion: timeline.contractVersion }),
  };
}

export function presentationTimelineHasTurns(timeline = {}) {
  try {
    return normalizePresentationTimeline(timeline).turns.length > 0;
  } catch {
    return false;
  }
}

export function alignPresentationTimelineToAudio(input = {}, options = {}) {
  let timeline = createPresentationTimelineContract(input);
  let turns = listValue(timeline.turns);
  let audioItems = listValue(options.audioItems || options.audio?.items);
  let sequenceMode = cleanTimelineText(options.sequenceMode || timeline.metadata?.audioAuthority?.sequenceMode, 'sequential');
  sequenceMode = sequenceMode === 'overlap' ? 'overlap' : 'sequential';
  let requireAudio = options.requireAudio !== false;
  let estimatedTurnMs = positiveNumber(options.estimatedTurnMs, 1000);
  let cursorMs = 0;
  let correctedTurns = turns.map((turn, index) => {
    let audio = audioItems[index] || {};
    let audioDurationMs = positiveNumber(audio.durationMs ?? audio.duration, undefined);
    if (audioDurationMs === undefined) {
      audioDurationMs = positiveNumber(Number(audio.durationSec) * 1000, undefined);
    }
    let durationMs = positiveNumber(
      audioDurationMs ?? turn.renderCue?.durationMs,
      requireAudio ? undefined : estimatedTurnMs,
    );
    if (!durationMs) {
      throw new Error(`audio authority timing requires duration for turn ${index + 1}`);
    }
    let requestedStart = nonNegativeNumber(turn.renderCue?.startMs ?? turn.renderCue?.start, undefined);
    if (sequenceMode === 'overlap' && requestedStart === undefined) {
      throw new Error(`audio authority overlap timing requires renderCue.startMs for turn ${index + 1}`);
    }
    let startMs = sequenceMode === 'overlap' ? requestedStart : cursorMs;
    let endMs = Math.max(startMs + 1, startMs + Math.round(durationMs));
    cursorMs = sequenceMode === 'overlap' ? Math.max(cursorMs, endMs) : endMs;
    return {
      ...turn,
      renderCue: {
        ...(turn.renderCue || {}),
        startMs,
        durationMs: endMs - startMs,
        endMs,
        source: 'audio',
      },
    };
  });
  return createPresentationTimelineContract({
    ...timeline,
    turns: correctedTurns,
    metadata: {
      ...(timeline.metadata || {}),
      audioAuthority: {
        source: 'audio-items',
        sequenceMode,
        turnCount: correctedTurns.length,
        durationMs: cursorMs,
      },
    },
  });
}

export function reviewPresentationTimeline(input = {}, intent = {}) {
  let timeline = normalizePresentationTimeline(input);
  let turns = listValue(timeline.turns);
  let issues = [];
  let addIssue = (code, message, { severity = 'warning', turnIndex, ...detail } = {}) => {
    if (!PRESENTATION_LESSON_REVIEW_CODES.includes(code)) {
      throw new Error(`unregistered presentation lesson review code: ${code}`);
    }
    issues.push(compactObject({ code, severity, message, turnIndex, ...detail }));
  };

  if (!turns.length) {
    addIssue('missing-turns', 'Presentation timeline has no narrated turns.', { severity: 'error' });
  }

  let allowedTargetIds = new Set(idList(intent.allowedTargetIds));
  let allowedToolNames = new Set(idList(intent.allowedToolNames));
  let allowedActionSources = new Set(idList(intent.allowedActionSources || ['webmcp', 'workspace', 'host']));
  let requiredPersonas = idList(intent.requiredPersonas);
  let requiredKeywords = requestKeywords(intent);
  let requestedSurfaceIds = idList(intent.requestedSurfaceIds || intent.requestedTargets);
  let selectedTabIds = idList(intent.selectedTabIds || intent.requestedTabIds);
  let budget = normalizeTurnBudget(intent);
  let targetIds = new Set();
  let tabIds = new Set();
  let personas = new Set();
  let actionCount = 0;
  let maxWordsPerTurn = Math.max(1, Math.floor(Number(intent.maxWordsPerTurn || intent.tts?.maxWordsPerTurn || 24)));
  let maxOverlapWords = Math.max(1, Math.floor(Number(intent.maxOverlapWords || intent.dialogue?.maxOverlapWords || 5)));
  let maxSamePersonaRun = Math.max(1, Math.floor(Number(intent.maxSamePersonaRun || intent.dialogue?.maxSamePersonaRun || 2)));
  let strictDialogueQuality = intent.strictDialogueQuality === true || intent.hardGate === true;
  let groundingRequired = intent.requireGrounding === true || strictDialogueQuality;
  let groundingSources = new Map(listValue(timeline.grounding?.sources).map((source) => [source.id, source]));
  let turnById = new Map(turns.map((turn) => [turn.id, turn]));
  let speechRegistryTokens = [
    ...allowedTargetIds,
    ...allowedToolNames,
    ...idList(intent.forbiddenSpeechTokens),
  ];
  let normalizedTexts = new Map();
  let questionCount = 0;
  let clarificationCount = 0;
  let boilerplateCounts = new Map();
  let handoffCount = 0;
  let previousPersona = '';
  let personaRunLength = 0;
  let longestPersonaRun = 0;
  let handoffRequired = intent.requireDialogueHandoffs === true ||
    (intent.requireDialogue === true && turns.length >= 4);
  let timelineText = [
    timeline.title,
    timeline.profile,
    ...turns.flatMap((turn) => [
      turn?.text,
      turn?.cue?.targetId,
      turn?.cue?.tabId,
      turn?.persona,
    ]),
  ].join(' ').toLowerCase();
  let missingRequestKeywords = requiredKeywords.filter((keyword) => !timelineText.includes(keyword));
  let requestKeywordSeverity = intent.requireRequestKeywords === true || intent.requireRequestFit === true
    ? 'error'
    : 'warning';
  for (let keyword of missingRequestKeywords) {
    addIssue(
      'request-keyword-missing',
      `Request keyword "${keyword}" is not covered by the presentation timeline.`,
      { severity: requestKeywordSeverity, keyword },
    );
  }

  for (let [index, turn] of turns.entries()) {
    let targetId = cleanTimelineText(turn?.cue?.targetId);
    let tabId = cleanTimelineText(turn?.cue?.tabId);
    let persona = cleanTimelineText(turn?.persona);
    if (targetId) targetIds.add(targetId);
    if (tabId) tabIds.add(tabId);
    if (persona) personas.add(persona);
    if (persona && persona === previousPersona) {
      personaRunLength += 1;
    } else {
      previousPersona = persona;
      personaRunLength = persona ? 1 : 0;
    }
    longestPersonaRun = Math.max(longestPersonaRun, personaRunLength);

    if (allowedTargetIds.size && targetId && !allowedTargetIds.has(targetId)) {
      addIssue('disallowed-target', `Turn ${index + 1} targets "${targetId}", which is not in the allowed target set.`, {
        severity: 'error',
        turnIndex: index,
      });
    }
    if (!targetId && (allowedTargetIds.size || requestedSurfaceIds.length || selectedTabIds.length)) {
      addIssue('missing-cue-target', `Turn ${index + 1} has no stable cue target.`, { severity: 'error', turnIndex: index });
    }
    if (!tabId && selectedTabIds.length) {
      addIssue('missing-cue-tab', `Turn ${index + 1} has no stable tab cue.`, { severity: 'error', turnIndex: index });
    }
    let actions = [
      ...(hasKeys(turn?.webmcp) ? [{ source: 'webmcp', ...turn.webmcp }] : []),
      ...listValue(turn?.actions),
    ];
    for (let action of actions) {
      if (!isObject(action)) continue;
      actionCount += 1;
      let source = cleanTimelineText(action.source, action.tool ? 'webmcp' : 'workspace');
      let name = cleanTimelineText(action.tool || action.name || action.id);
      let actionTarget = cleanTimelineText(action.target || action.targetId);
      if (!allowedActionSources.has(source)) {
        addIssue('unsupported-action-source', `Turn ${index + 1} uses unsupported action source "${source}".`, {
          severity: 'error',
          turnIndex: index,
          source,
        });
      }
      if (!name) {
        addIssue('action-missing-name', `Turn ${index + 1} has an action without a stable name.`, {
          severity: 'error',
          turnIndex: index,
          source,
        });
      }
      if (allowedToolNames.size && source === 'webmcp' && name && !allowedToolNames.has(name)) {
        addIssue('disallowed-tool', `Turn ${index + 1} uses "${name}", which is not an allowed presentation action.`, {
          severity: 'error',
          turnIndex: index,
          source,
          name,
        });
      }
      if (allowedTargetIds.size && actionTarget && !allowedTargetIds.has(actionTarget)) {
        addIssue('action-disallowed-target', `Turn ${index + 1} action targets "${actionTarget}", which is not allowed.`, {
          severity: 'error',
          turnIndex: index,
          source,
          name,
          targetId: actionTarget,
        });
      }
    }
    if (hasTtsUnsafeToken(turn?.text)) {
      addIssue('unsafe-tts-text', `Turn ${index + 1} contains a token that should not be spoken.`, {
        severity: 'error',
        turnIndex: index,
        turnId: turn.id,
      });
    }
    if (hasSpokenMarkup(turn?.text)) {
      addIssue('unsafe-tts-text', `Turn ${index + 1} contains markup, a URL, or symbols that should be removed before TTS.`, {
        severity: 'error',
        turnIndex: index,
        turnId: turn.id,
      });
    }
    if (hasSpokenSpeakerLabel(turn?.text)) {
      addIssue('spoken-speaker-label', `Turn ${index + 1} starts with a speaker label that would be spoken by TTS.`, {
        severity: 'error',
        turnIndex: index,
        turnId: turn.id,
      });
    }
    if (hasDomSpeechToken(turn?.text)) {
      addIssue('spoken-dom-token', `Turn ${index + 1} contains a DOM selector or browser implementation token.`, {
        severity: 'error',
        turnIndex: index,
        turnId: turn.id,
      });
    }
    let registryToken = spokenRegistryToken(turn?.text, speechRegistryTokens);
    if (hasSerializedMetadataToken(turn?.text) || registryToken) {
      addIssue('spoken-metadata-token', `Turn ${index + 1} contains serialized interface metadata.`, {
        severity: 'error',
        turnIndex: index,
        turnId: turn.id,
        token: registryToken || undefined,
      });
    }
    let words = wordCount(turn?.text);
    if (words > maxWordsPerTurn) {
      addIssue('tts-long-turn', `Turn ${index + 1} has ${words} words; max is ${maxWordsPerTurn}.`, {
        severity: 'error',
        turnIndex: index,
      });
    }
    let signature = boilerplateSignature(turn?.text);
    if (signature) {
      let count = (boilerplateCounts.get(signature) || 0) + 1;
      boilerplateCounts.set(signature, count);
      if (count > 1 && signature.split(/\s+/).length >= 4) {
        addIssue('repeated-boilerplate', `Turn ${index + 1} repeats the same opening phrase as another turn.`, {
          severity: strictDialogueQuality ? 'error' : 'warning',
          turnIndex: index,
          signature,
        });
      }
    }
    let normalizedText = normalizedTurnText(turn?.text);
    if (normalizedText) {
      if (normalizedTexts.has(normalizedText)) {
        addIssue('repeated-boilerplate', `Turn ${index + 1} repeats another turn.`, {
          severity: strictDialogueQuality ? 'error' : 'warning',
          turnIndex: index,
          turnId: turn.id,
          relatedTurnId: normalizedTexts.get(normalizedText),
        });
      } else {
        normalizedTexts.set(normalizedText, turn.id);
      }
    }
    let refs = listValue(turn.sourceRefs);
    if (groundingRequired && ['explain', 'respond', 'confirm'].includes(turn.dialogueAct) && !refs.length) {
      addIssue('grounding-required', `Turn ${index + 1} requires source grounding.`, {
        severity: 'error',
        turnIndex: index,
        turnId: turn.id,
      });
    }
    for (let ref of refs) {
      let source = groundingSources.get(ref.sourceId);
      if (!source) {
        addIssue('grounding-ref-unknown', `Turn ${index + 1} references an unknown grounding source.`, {
          severity: 'error',
          turnIndex: index,
          turnId: turn.id,
          sourceRef: ref.sourceId,
        });
        continue;
      }
      let refTarget = ref.targetId || source.targetId;
      if (targetId && refTarget && refTarget !== targetId && source.targetId !== tabId) {
        addIssue('grounding-target-mismatch', `Turn ${index + 1} grounding does not match its cue target.`, {
          severity: 'error',
          turnIndex: index,
          turnId: turn.id,
          sourceRef: ref.sourceId,
          actual: refTarget,
          expected: targetId,
        });
      }
    }
    if (index > 0 && turn?.persona !== turns[index - 1]?.persona && hasDialogueHandoff(turn?.text)) {
      handoffCount += 1;
    }
    let overlapMs = nonNegativeNumber(turn?.overlapMs, 0);
    let startMs = turnStartMs(turn);
    let previousEndMs = index > 0 ? turnEndMs(turns[index - 1]) : undefined;
    let overlapsPrevious = overlapMs > 0 ||
      (startMs !== undefined && previousEndMs !== undefined && startMs < previousEndMs);
    if (overlapsPrevious && index > 0 && turn?.persona === turns[index - 1]?.persona) {
      addIssue('self-overlap', `Turn ${index + 1} overlaps the previous turn from the same persona.`, {
        severity: 'error',
        turnIndex: index,
      });
    }
    if (overlapsPrevious && words > maxOverlapWords) {
      addIssue('overlong-overlap-turn', `Turn ${index + 1} has ${words} words inside an overlap; max is ${maxOverlapWords}.`, {
        severity: strictDialogueQuality ? 'error' : 'warning',
        turnIndex: index,
      });
    }
  }

  for (let targetId of requestedSurfaceIds) {
    if (!targetIds.has(targetId)) {
      addIssue('missing-requested-surface', `Requested surface "${targetId}" is not covered by the timeline.`, {
        severity: 'error',
      });
    }
  }
  for (let tabId of selectedTabIds) {
    if (!tabCovered(tabId, targetIds, tabIds)) {
      addIssue('missing-requested-tab', `Requested tab "${tabId}" is not covered by the timeline.`, {
        severity: 'error',
      });
    }
  }
  if (budget.minTurns !== undefined && turns.length < budget.minTurns) {
    addIssue('turn-budget-underflow', `Timeline has ${turns.length} turns; minimum is ${budget.minTurns}.`, { severity: 'error' });
  }
  if (budget.maxTurns !== undefined && turns.length > budget.maxTurns) {
    addIssue('turn-budget-overflow', `Timeline has ${turns.length} turns; maximum is ${budget.maxTurns}.`, { severity: 'error' });
  }
  if (intent.requireDialogue === true && turns.length > 1 && personas.size < 2) {
    addIssue('dialogue-single-persona', 'Dialogue mode requires at least two personas in the narrated turns.');
  }
  if (intent.requireDialogue === true && personas.size !== 2) {
    addIssue('dialogue-role-count', `Dialogue requires exactly two explicit personas; found ${personas.size}.`, {
      severity: 'error',
      actual: personas.size,
      expected: 2,
    });
  }
  if (intent.requireDialogue === true) {
    for (let [index, turn] of turns.entries()) {
      if (!turn.persona) {
        addIssue('dialogue-role-count', `Turn ${index + 1} has no explicit persona.`, {
          severity: 'error', turnIndex: index, turnId: turn.id,
        });
      }
      if (!turn.dialogueAct || !PRESENTATION_DIALOGUE_ACTS.has(turn.dialogueAct)) {
        addIssue('dialogue-reply-missing', `Turn ${index + 1} has no valid dialogue act.`, {
          severity: 'error', turnIndex: index, turnId: turn.id, path: 'dialogueAct',
        });
      }
      if (index > 0) {
        let previous = turns[index - 1];
        let reply = turnById.get(turn.replyTo);
        if (!reply || reply.id !== previous.id || reply.persona === turn.persona) {
          addIssue('dialogue-reply-missing', `Turn ${index + 1} must reply to the adjacent turn from the other persona.`, {
            severity: 'error', turnIndex: index, turnId: turn.id, relatedTurnId: turn.replyTo,
          });
        } else if (groundingRequired) {
          let previousRefs = new Set(listValue(previous.sourceRefs).map((ref) => ref.sourceId));
          let sharesSource = listValue(turn.sourceRefs).some((ref) => previousRefs.has(ref.sourceId));
          if (!sharesSource) {
            addIssue('dialogue-grounding-disconnected', `Turn ${index + 1} shares no source with the turn it answers.`, {
              severity: 'error', turnIndex: index, turnId: turn.id, relatedTurnId: previous.id,
            });
          }
        }
      }
      if (['ask', 'clarify'].includes(turn.dialogueAct)) {
        if (turn.dialogueAct === 'ask') questionCount += 1;
        if (turn.dialogueAct === 'clarify') clarificationCount += 1;
        let responses = turns.slice(index + 1, index + 3);
        let answered = responses.some((candidate) => (
          candidate.replyTo === turn.id
          && candidate.persona !== turn.persona
          && ['respond', 'confirm'].includes(candidate.dialogueAct)
        ));
        if (!answered) {
          addIssue(
            turn.dialogueAct === 'clarify' ? 'dialogue-clarification-missing' : 'dialogue-question-unanswered',
            `Turn ${index + 1} has no structured response within two turns.`,
            { severity: 'error', turnIndex: index, turnId: turn.id },
          );
        }
      }
    }
    let minQuestions = Math.max(0, Math.floor(Number(intent.minQuestions || intent.dialogue?.minQuestions || 0)));
    let minClarifications = Math.max(0, Math.floor(Number(intent.minClarifications || intent.dialogue?.minClarifications || 0)));
    if (questionCount < minQuestions) {
      addIssue('dialogue-question-missing', `Dialogue requires ${minQuestions} question turn(s); found ${questionCount}.`, {
        severity: 'error', actual: questionCount, expected: minQuestions,
      });
    }
    if (clarificationCount < minClarifications) {
      addIssue('dialogue-clarification-missing', `Dialogue requires ${minClarifications} clarification turn(s); found ${clarificationCount}.`, {
        severity: 'error', actual: clarificationCount, expected: minClarifications,
      });
    }
  }
  if (intent.requireDialogue === true && personas.size > 1 && longestPersonaRun > maxSamePersonaRun) {
    addIssue('dialogue-monologue-run', `Dialogue has ${longestPersonaRun} consecutive turns from one persona; max is ${maxSamePersonaRun}.`, {
      severity: strictDialogueQuality ? 'error' : 'warning',
      longestPersonaRun,
      maxSamePersonaRun,
    });
  }
  let missingRequiredPersonas = requiredPersonas.filter((persona) => !personas.has(persona));
  for (let persona of missingRequiredPersonas) {
    addIssue('missing-required-persona', `Required persona "${persona}" is not present in the timeline.`, {
      severity: 'error',
      persona,
    });
  }
  if (handoffRequired && personas.size > 1 && turns.length >= 4) {
    let requiredHandoffs = Math.max(1, Math.floor((turns.length - 1) * 0.25));
    if (handoffCount < requiredHandoffs) {
      addIssue('missing-dialogue-handoff', `Dialogue has ${handoffCount} responsive handoffs; minimum is ${requiredHandoffs}.`, {
        severity: strictDialogueQuality ? 'error' : 'warning',
        handoffCount,
        requiredHandoffs,
      });
    }
  }

  let hasError = issues.some((issue) => issue.severity === 'error');
  return {
    verdict: hasError ? 'reject' : issues.length ? 'revise' : 'pass',
    issues,
    warnings: issues.filter((issue) => issue.severity !== 'error'),
    coverage: {
      turnCount: turns.length,
      targetIds: [...targetIds],
      requestedSurfaceIds,
      missingRequestedSurfaceIds: requestedSurfaceIds.filter((targetId) => !targetIds.has(targetId)),
      selectedTabIds,
      missingSelectedTabIds: selectedTabIds.filter((tabId) => !tabCovered(tabId, targetIds, tabIds)),
      personas: [...personas],
      requiredPersonas,
      missingRequiredPersonas,
      requestKeywords: requiredKeywords,
      missingRequestKeywords,
      turnBudget: budget,
      maxWordsPerTurn,
      maxOverlapWords,
      maxSamePersonaRun,
      longestPersonaRun,
      handoffCount,
      handoffRequired,
      actionCount,
    },
  };
}

export function createPresentationTtsProjection(input = {}, options = {}) {
  let timeline = normalizePresentationTimeline(input);
  let review = options.review || null;
  if (review?.verdict === 'reject') {
    return {
      schemaVersion: 'presentation-tts-projection-v2',
      model: 'deterministic-text-only',
      status: 'blocked',
      readyForTts: false,
      itemCount: 0,
      estimatedDurationMs: 0,
      items: [],
    };
  }
  let estimatedMsPerWord = positiveNumber(options.estimatedMsPerWord || options.msPerWord, 310);
  let minTurnMs = positiveNumber(options.minTurnMs, 700);
  let punctuationPauseMs = nonNegativeNumber(options.punctuationPauseMs, 120);
  let items = timeline.turns.map((turn, index) => {
    let text = cleanTimelineText(turn.text);
    let words = wordCount(text);
    let punctuationPauses = (text.match(/[,.!?;:]/g) || []).length;
    let estimatedDurationMs = Math.max(
      minTurnMs,
      Math.round((words * estimatedMsPerWord) + (punctuationPauses * punctuationPauseMs)),
    );
    return compactObject({
      index,
      persona: turn.persona,
      text,
      textHash: computeIntegrity(text),
      wordCount: words,
      charCount: text.length,
      estimatedDurationMs,
      cue: hasKeys(turn.cue) ? turn.cue : undefined,
    });
  });
  return {
    schemaVersion: 'presentation-tts-projection-v2',
    model: 'deterministic-text-only',
    status: 'ready',
    readyForTts: true,
    estimatedMsPerWord,
    minTurnMs,
    punctuationPauseMs,
    itemCount: items.length,
    estimatedDurationMs: items.reduce((total, item) => total + item.estimatedDurationMs, 0),
    items,
  };
}

function normalizePresentationLessonReview(review = {}) {
  let source = isObject(review) ? review : {};
  let issues = listValue(source.issues).map((issue) => {
    let normalized = clonePortable(issue) || {};
    normalized.code = cleanTimelineText(issue?.code);
    normalized.severity = cleanTimelineText(issue?.severity, 'warning');
    normalized.message = cleanTimelineText(issue?.message);
    return compactObject(normalized);
  }).filter((issue) => issue.code);
  let issueCodes = [...new Set(issues.map((issue) => issue.code))];
  return {
    schemaVersion: 'presentation-lesson-review-v2',
    verdict: cleanTimelineText(source.verdict, issues.some((issue) => issue.severity === 'error') ? 'reject' : issues.length ? 'revise' : 'pass'),
    issueCodes,
    issues,
    coverage: clonePortable(source.coverage || {}),
  };
}

function normalizeAuditSettings(settings = {}) {
  let source = isObject(settings) ? settings : {};
  return compactObject({
    width: nonNegativeNumber(source.width, undefined),
    height: nonNegativeNumber(source.height, undefined),
    fps: positiveNumber(source.fps, undefined),
    orientation: cleanTimelineText(source.orientation),
    aspectRatio: cleanTimelineText(source.aspectRatio),
    speakerMode: cleanTimelineText(source.speakerMode),
    sequenceMode: cleanTimelineText(source.sequenceMode),
    captionsMode: cleanTimelineText(source.captionsMode),
    includeAudio: source.includeAudio === undefined ? undefined : source.includeAudio !== false,
  });
}

function normalizeAuditSource(source = {}) {
  let value = isObject(source) ? source : {};
  return compactObject({
    url: sanitizePresentationUrl(value.url),
    route: cleanTimelineText(value.route),
    surface: cleanTimelineText(value.surface || value.surfaceId),
    tabId: cleanTimelineText(value.tabId || value.tab),
    section: cleanTimelineText(value.section),
    title: cleanTimelineText(value.title),
    tabs: clonePortable(value.tabs),
    surfaces: clonePortable(value.surfaces),
  });
}

function sanitizePresentationUrl(value) {
  let text = cleanTimelineText(value);
  if (!text) return '';
  try {
    let parsed = new URL(text, 'https://presentation.invalid');
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    if (parsed.origin === 'https://presentation.invalid') return parsed.pathname;
    return parsed.toString();
  } catch {
    return text.split(/[?#]/, 1)[0];
  }
}

export function createPresentationLessonAuditPacket(input = {}, options = {}) {
  let timeline = createPresentationTimelineContract(input);
  let intent = clonePortable(options.intent || {});
  let review = normalizePresentationLessonReview(options.review || reviewPresentationTimeline(timeline, intent));
  let ttsProjection = createPresentationTtsProjection(timeline, {
    ...(options.ttsProjection || {}),
    review,
  });
  let packet = {
    schemaVersion: PRESENTATION_LESSON_AUDIT_SCHEMA_VERSION,
    timelineId: timeline.id,
    timelineHash: timeline.hash,
    timelineContractVersion: timeline.contractVersion,
    title: timeline.title,
    locale: timeline.locale,
    profile: timeline.profile,
    renderSettings: normalizeAuditSettings(options.renderSettings || options.settings),
    source: normalizeAuditSource(options.source),
    contextSummary: compactObject({
      identityHash: cleanTimelineText(options.contextSummary?.identityHash),
      dataHash: cleanTimelineText(options.contextSummary?.dataHash),
      generation: Number.isInteger(options.contextSummary?.generation) ? options.contextSummary.generation : undefined,
      visibleTargetCount: nonNegativeNumber(options.contextSummary?.visibleTargetCount, undefined),
      targetCount: nonNegativeNumber(options.contextSummary?.targetCount, undefined),
    }),
    grounding: clonePortable(timeline.grounding),
    reviewPolicy: cleanTimelineText(options.reviewPolicy, 'structural-v2'),
    generationInputHash: cleanTimelineText(options.generationInputHash),
    readyForTts: review.verdict !== 'reject' && ttsProjection.readyForTts === true,
    ttsProjection,
    review,
  };
  return {
    ...packet,
    hash: `${PRESENTATION_LESSON_AUDIT_SCHEMA_VERSION}:${computeIntegrity(packet)}`,
  };
}

function createSegment(target, index, total, profile, refs, context, requestInfo = {}) {
  let dataRefs = segmentDataRefs(target, profile, refs);
  let dialogueAct = profile === 'dialogue'
    ? index === 0 ? 'open' : index === 1 ? 'ask' : index === total - 1 ? 'close' : 'respond'
    : 'explain';
  return compactObject({
    id: portableId(`segment-${index + 1}-${profile}`),
    persona: profile === 'dialogue' ? (index % 2 ? 'analyst' : 'guide') : 'guide',
    dialogueAct,
    replyTo: index > 0 ? portableId(`segment-${index}-${profile}`) : undefined,
    target: target.address,
    focusTarget: target.address,
    narration: narrationFor(profile, target, index, total, dataRefs, context, requestInfo),
    cues: [{
      kind: profile === 'brief' ? 'focus' : 'highlight',
      target: target.address,
      tabId: targetTabId(target, context),
      text: targetTitle(target),
    }],
    actions: segmentActions(target, profile),
    dataRefs,
    sourceRefs: dataRefs.map((ref) => ({
      sourceId: ref.id,
      path: ref.path,
      hash: ref.contentHash,
      targetId: target.address,
    })),
    requiredHostServices: listValue(target.webmcpTools).length > 0 ? ['agent.webmcp'] : undefined,
  });
}

export function summarizePresentationTimeline(timeline = {}) {
  let segments = listValue(timeline.segments);
  let targetCoverage = segments.map((segment) => segment.target).filter(Boolean);
  let hiddenTargetCount = segments.filter((segment) => listValue(segment.revealActions).length > 0).length;
  let dataRefCount = segments.reduce((total, segment) => total + listValue(segment.dataRefs).length, 0);
  return {
    profile: timeline.profile || timeline.promptProfile || timeline.summary?.profile || 'brief',
    segmentCount: segments.length,
    targetCoverage,
    dataRefCount,
    hiddenTargetCount,
    narrationDensity: timeline.summary?.narrationDensity || (segments.length > 1 ? 'expanded' : 'compact'),
  };
}

export function createWorkspacePresentationTimeline(context = {}, request = {}) {
  let input = requestObject(request);
  let prompt = normalizePresentationPrompt(input);
  let targets = choosePresentationTargets(context, prompt.profile, input);
  let refs = dataRefCandidates(context.dataContext || {});
  let requestInfo = {
    keywords: keywordList(input.requestKeywords || input.keywords || input.prompt || input.taskText || input.goal),
  };
  let segments = targets.map((target, index) => createSegment(target, index, targets.length, prompt.profile, refs, context, requestInfo));
  let timeline = compactObject({
    id: portableId(input.id || `${prompt.profile}-presentation`),
    source: input.source || 'local',
    revision: Number.isInteger(input.revision) ? input.revision : undefined,
    freshness: input.freshness || 'fresh',
    locale: prompt.locale,
    profile: prompt.profile,
    prompt: prompt.prompt ? { text: prompt.prompt, profile: prompt.profile } : { profile: prompt.profile },
    requiredHostServices: ['agent.webmcp', ...listValue(input.requiredHostServices)],
    personas: prompt.profile === 'dialogue'
      ? { guide: { name: 'Guide' }, analyst: { name: 'Analyst' } }
      : { guide: { name: 'Guide' } },
    grounding: {
      sources: refs.map((ref) => normalizeGroundingSource(ref)).filter(Boolean),
    },
    segments,
  });
  timeline.summary = {
    ...summarizePresentationTimeline(timeline),
    visibleTargetCount: targets.filter((target) => target.visible).length,
    hiddenTargetCount: targets.filter((target) => !target.visible).length,
    dataSourceCount: refs.length,
    narrationDensity: prompt.profile === 'full' ? 'detailed' : prompt.profile === 'data-grounded' ? 'contextual' : prompt.profile === 'dialogue' ? 'conversational' : prompt.profile === 'task-specific' ? 'focused' : 'compact',
  };
  return timeline;
}

function presentationContractError(code, message) {
  let error = new Error(message);
  error.code = code;
  return error;
}

function snapshotActionName(action = {}) {
  return cleanTimelineText(action.name || action.id || action.tool || action.type);
}

function snapshotTarget(target = {}) {
  let address = cleanTimelineText(target.address || target.targetId || target.id);
  if (!address) return null;
  return compactObject({
    address,
    tabId: cleanTimelineText(target.tabId || target.viewId || target.boardId),
    title: cleanTimelineText(target.title || target.label),
    kind: cleanTimelineText(target.kind || target.type),
    visible: Boolean(target.visible),
    rendered: target.rendered === undefined ? undefined : Boolean(target.rendered),
    hiddenReasons: idList(target.hiddenReasons),
    safeActionNames: listValue(target.safeActions || target.revealActions)
      .map(snapshotActionName)
      .filter(Boolean),
    webmcpToolNames: listValue(target.webmcpTools)
      .map(snapshotActionName)
      .filter(Boolean),
    composition: normalizePresentationTargetComposition(target.composition || target.metadata?.composition || {}),
  });
}

function normalizeSnapshotViewport(viewport = {}) {
  let width = Math.max(1, Math.round(positiveNumber(viewport.width, 1920)));
  let height = Math.max(1, Math.round(positiveNumber(viewport.height, 1080)));
  return {
    width,
    height,
    fps: Math.max(1, Math.round(positiveNumber(viewport.fps, 30))),
    orientation: cleanTimelineText(viewport.orientation, width < height ? 'vertical' : 'horizontal'),
    aspectRatio: cleanTimelineText(viewport.aspectRatio, `${width}:${height}`),
  };
}

export function createPresentationContextSnapshot(context = {}, options = {}) {
  let generation = Number.isInteger(options.generation)
    ? options.generation
    : Number.isInteger(context.generation) ? context.generation : 0;
  let output = normalizePresentationOutputSpec(options.output || context.output || { viewport: options.viewport || context.viewport || {} });
  let viewport = normalizeSnapshotViewport(output);
  let source = normalizeAuditSource(options.source || context.source || context.workspace || {});
  let targetRecords = [
    ...listValue(context.targets),
    ...listValue(context.panels),
  ].map(snapshotTarget).filter(Boolean);
  let targetMap = new Map();
  for (let target of targetRecords) {
    let existing = targetMap.get(target.address);
    targetMap.set(target.address, existing ? compactObject({ ...existing, ...target }) : target);
  }
  let targets = [...targetMap.values()].sort((a, b) => a.address.localeCompare(b.address));
  if (!targets.length) throw presentationContractError('TARGET_SNAPSHOT_EMPTY', 'presentation context snapshot has no targets');
  let dataSources = dataRefCandidates(context.dataContext || options.dataContext || {})
    .map((sourceRecord) => normalizeGroundingSource({ ...sourceRecord, generation }))
    .filter(Boolean);
  let stability = compactObject({
    settled: options.stability?.settled === true || context.stability?.settled === true,
    waitedFor: idList(options.stability?.waitedFor || context.stability?.waitedFor),
  });
  let identity = {
    schemaVersion: PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
    viewport,
    source,
    targets: targets.map((target) => ({
      address: target.address,
      tabId: target.tabId,
      kind: target.kind,
      visible: target.visible,
      rendered: target.rendered,
      hiddenReasons: target.hiddenReasons,
      safeActionNames: target.safeActionNames,
      webmcpToolNames: target.webmcpToolNames,
    })),
    stability,
  };
  let identityHash = `${PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION}:${computeIntegrity(identity)}`;
  let compositionHash = `${PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION}:composition:${computeIntegrity({
    outputSpecHash: output.hash,
    targets: targets.map((target) => ({ address: target.address, composition: target.composition })),
  })}`;
  let dataHash = `${PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION}:data:${computeIntegrity(dataSources.map((item) => ({
    id: item.id,
    path: item.path,
    contentHash: item.contentHash,
  })))}`;
  return {
    ...identity,
    output,
    outputSpecHash: output.hash,
    compositionHash,
    generation,
    targets,
    dataSources,
    summary: {
      targetCount: targets.length,
      visibleTargetCount: targets.filter((target) => target.visible).length,
      dataSourceCount: dataSources.length,
    },
    identityHash,
    dataHash,
  };
}

function snapshotAllowedActions(snapshot = {}) {
  let actions = [];
  for (let target of listValue(snapshot.targets)) {
    for (let tool of listValue(target.webmcpToolNames)) {
      actions.push({ source: 'webmcp', tool, target: target.address });
    }
    for (let name of listValue(target.safeActionNames)) {
      actions.push({ source: 'workspace', tool: name, target: target.address });
    }
  }
  return actions;
}

export function createPresentationReplanRequest(input = {}) {
  let targetSnapshot = input.targetSnapshot || input.snapshot;
  if (!isObject(targetSnapshot) || !targetSnapshot.identityHash) {
    throw presentationContractError('TARGET_SNAPSHOT_EMPTY', 'presentation replan requires a target snapshot');
  }
  let sourceSnapshot = input.sourceSnapshot || targetSnapshot;
  let remainingRounds = Math.max(0, Math.min(1, Math.floor(Number(input.actionBudget?.remainingRounds ?? input.deepening?.remainingRounds ?? 1))));
  let remainingActions = Math.max(0, Math.min(3, Math.floor(Number(input.actionBudget?.remainingActions ?? input.deepening?.remainingActions ?? 3))));
  let prompt = normalizePresentationPrompt(input.request || input.prompt || {});
  let output = normalizePresentationOutputSpec(input.output || targetSnapshot.output || { viewport: targetSnapshot.viewport });
  let request = {
    schemaVersion: PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION,
    sourceSnapshotHash: sourceSnapshot.identityHash,
    targetSnapshotHash: targetSnapshot.identityHash,
    generation: targetSnapshot.generation,
    viewport: targetSnapshot.viewport,
    output,
    outputSpecHash: output.hash,
    sourceCompositionHash: cleanTimelineText(sourceSnapshot.compositionHash),
    targetCompositionHash: cleanTimelineText(targetSnapshot.compositionHash),
    prompt: prompt.prompt,
    profile: prompt.profile,
    personaSpec: clonePortable(input.personaSpec || input.request?.personaSpec || {}),
    turnBudget: normalizeTurnBudget({
      turnBudget: input.turnBudget || input.request?.turnBudget,
      minTurns: input.request?.minTurns,
      maxTurns: input.request?.maxTurns,
    }),
    allowedActions: clonePortable(input.allowedActions || snapshotAllowedActions(targetSnapshot)),
    actionBudget: { remainingRounds, remainingActions },
    priorTimelineHash: cleanTimelineText(input.timeline?.hash || input.priorTimelineHash),
    grounding: { sources: clonePortable(targetSnapshot.dataSources || []) },
    lessonContextHash: cleanTimelineText(input.lessonContext?.hash),
    lessonContext: isObject(input.lessonContext) ? clonePortable(input.lessonContext) : undefined,
    reviewFeedback: isObject(input.reviewFeedback) ? clonePortable(input.reviewFeedback) : undefined,
  };
  return {
    ...request,
    hash: `${PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION}:${computeIntegrity(request)}`,
  };
}

export function reviewPresentationTimelineAgainstSnapshot(input = {}, snapshot = {}, intent = {}) {
  let allowedTargetIds = listValue(snapshot.targets).map((target) => target.address).filter(Boolean);
  let allowedToolNames = listValue(snapshot.targets).flatMap((target) => target.webmcpToolNames || []);
  let timeline = createPresentationTimelineContract({
    ...input,
    grounding: listValue(input.grounding?.sources).length
      ? input.grounding
      : { sources: snapshot.dataSources || [] },
  });
  return reviewPresentationTimeline(timeline, {
    ...intent,
    allowedTargetIds,
    allowedToolNames,
    forbiddenSpeechTokens: [
      ...allowedTargetIds,
      ...allowedToolNames,
      ...listValue(snapshot.targets).flatMap((target) => [target.tabId, ...listValue(target.safeActionNames)]),
    ].filter(Boolean),
  });
}

export function reviewPresentationTimelineAgainstLessonContext(input = {}, lessonContext = {}, intent = {}) {
  let descriptorNames = new Map(listValue(lessonContext.toolDescriptors).map((descriptor) => [descriptor.id, descriptor.name]));
  let snapshot = {
    ...(lessonContext.targetSnapshot || {}),
    targets: listValue(lessonContext.targets).map((target) => ({
      address: target.id || target.address,
      tabId: target.tabId,
      safeActionNames: target.revealRefs || [],
      webmcpToolNames: listValue(target.toolRefs).map((id) => descriptorNames.get(id)).filter(Boolean),
    })),
  };
  let structural = reviewPresentationTimelineAgainstSnapshot(input, snapshot, {
    requestedSurfaceIds: lessonContext.lesson?.requiredTargetIds || [],
    ...intent,
  });
  let timeline = createPresentationTimelineContract(input);
  let grounding = auditPresentationTimelineClaims(timeline, lessonContext);
  let issues = [...structural.issues, ...grounding.issues];
  return {
    ...structural,
    verdict: issues.some((issue) => issue.severity === 'error') ? 'reject' : 'accept',
    issueCodes: [...new Set(issues.map((issue) => issue.code))],
    issues,
    lessonContextHash: lessonContext.hash,
    coverage: {
      ...structural.coverage,
      ...grounding.coverage,
    },
  };
}

export function finalizePresentationReplan(candidate = {}, request = {}, options = {}) {
  if (candidate.status !== 'ready' || !candidate.timeline) {
    throw presentationContractError('TOUR_REPLAN_REJECTED', 'presentation planner did not return a ready timeline');
  }
  let expectedHash = cleanTimelineText(request.targetSnapshotHash);
  let candidateHash = cleanTimelineText(candidate.basis?.targetSnapshotHash || candidate.snapshotHash);
  if (!expectedHash || candidateHash !== expectedHash || Number(candidate.basis?.generation) !== Number(request.generation)) {
    throw presentationContractError('TARGET_CONTEXT_STALE', 'presentation planner result targets a stale snapshot');
  }
  if (request.lessonContextHash && cleanTimelineText(candidate.basis?.lessonContextHash) !== request.lessonContextHash) {
    throw presentationContractError('LESSON_CONTEXT_STALE', 'presentation planner result targets a stale lesson context');
  }
  if (!request.outputSpecHash || cleanTimelineText(candidate.basis?.outputSpecHash) !== request.outputSpecHash) {
    throw presentationContractError('OUTPUT_CONTEXT_STALE', 'presentation planner result targets a stale output spec');
  }
  let snapshot = options.snapshot;
  if (!snapshot || snapshot.identityHash !== expectedHash) {
    throw presentationContractError('TARGET_CONTEXT_STALE', 'latest target snapshot is unavailable');
  }
  let timeline = createPresentationTimelineContract(candidate.timeline);
  let reviewIntent = { turnBudget: request.turnBudget, ...(options.intent || {}) };
  let review = request.lessonContext
    ? reviewPresentationTimelineAgainstLessonContext(timeline, request.lessonContext, reviewIntent)
    : reviewPresentationTimelineAgainstSnapshot(timeline, snapshot, reviewIntent);
  if (review.verdict === 'reject') {
    let error = presentationContractError('TOUR_REPLAN_REJECTED', 'presentation timeline failed target-snapshot review');
    error.review = review;
    throw error;
  }
  let personaSpec = clonePortable(request.personaSpec || {});
  let lessonIntentHash = request.lessonContext ? createLessonIntentHash(request.lessonContext, timeline) : '';
  let compositionPlan = options.compositionPlan;
  let compositionAudit = null;
  if (options.requireComposition !== false) {
    let requiredTargetIds = [...new Set([
      ...listValue(request.lessonContext?.lesson?.requiredTargetIds),
      ...timeline.turns.map((turn) => cleanTimelineText(turn?.cue?.targetId)).filter(Boolean),
    ])];
    compositionAudit = auditPresentationCompositionPlan(compositionPlan, {
      outputSpecHash: request.outputSpecHash,
      structuralHash: expectedHash,
      timelineHash: timeline.hash,
      lessonIntentHash,
      requiredTargetIds,
    });
    if (compositionAudit.verdict !== 'accept') {
      let error = presentationContractError('PRESENTATION_COMPOSITION_REJECTED', 'presentation composition failed target readiness review');
      error.review = compositionAudit;
      error.compositionPlan = compositionPlan;
      throw error;
    }
  }
  let cacheIdentity = computeIntegrity({
    snapshotHash: expectedHash,
    compositionHash: compositionPlan?.hash || '',
    timelineHash: timeline.hash,
    outputSpecHash: request.outputSpecHash,
    lessonIntentHash,
    personaSpec,
  });
  return {
    schemaVersion: PRESENTATION_REPLAN_RESULT_SCHEMA_VERSION,
    status: 'ready',
    basis: {
      sourceSnapshotHash: request.sourceSnapshotHash,
      targetSnapshotHash: expectedHash,
      generation: request.generation,
      requestHash: request.hash,
      outputSpecHash: request.outputSpecHash,
    },
    snapshotChain: clonePortable(options.snapshotChain || []),
    timeline,
    timelineHash: timeline.hash,
    output: clonePortable(request.output),
    outputSpecHash: request.outputSpecHash,
    lessonIntentHash,
    compositionPlan: clonePortable(compositionPlan),
    compositionHash: cleanTimelineText(compositionPlan?.hash),
    compositionAudit,
    turns: timeline.turns,
    review,
    coverage: review.coverage,
    renderSeedPatch: { timelineHash: timeline.hash, snapshotHash: expectedHash, outputSpecHash: request.outputSpecHash, compositionHash: cleanTimelineText(compositionPlan?.hash) },
    cacheIdentity,
  };
}
