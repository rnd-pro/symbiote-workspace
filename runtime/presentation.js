import { parseWorkspaceAddress } from '../schema/was.js';
import { computeIntegrity } from '../schema/canonical-json.js';
import { auditPresentationTimelineClaims } from './lesson-context.js';
import {
  PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION,
  PRESENTATION_REPLAN_RESULT_SCHEMA_VERSION,
  auditPresentationCompositionPlan,
  createLessonIntentHash,
  listPresentationCompositionCueSlots,
  normalizePresentationOutputSpec,
  normalizePresentationTargetComposition,
  planCaptionPlacements,
  presentationReplanRequestHash,
} from './presentation-output.js';
import {
  PRESENTATION_CONTRACT_VERSION,
  createPresentationTimelineContract,
  createPresentationTimelineHash,
  normalizePresentationTimeline,
  presentationTimelineHasTurns,
} from './presentation/contract.js';
import { reviewPresentationCues, primaryPresentationCue } from './presentation/cue-review.js';
import { reviewPresentationDialogue, PRESENTATION_DIALOGUE_QUALITY_PROFILE } from './presentation/dialogue-review.js';

export {
  PRESENTATION_DIALOGUE_ISSUE_CODES,
  PRESENTATION_DIALOGUE_QUALITY_PROFILE,
  PRESENTATION_DIALOGUE_QUALITY_PROFILE_VERSION,
  reviewPresentationDialogue,
} from './presentation/dialogue-review.js';

export {
  PRESENTATION_CONTRACT_VERSION,
  PRESENTATION_DIALOGUE_ACTS,
  PRESENTATION_CUE_KINDS,
  PRESENTATION_INTERACTION_TYPES,
  PRESENTATION_ANNOTATION_INTENTS,
  PRESENTATION_MARKERS,
  PRESENTATION_SYMBOLS,
  PRESENTATION_ANNOTATION_PLACEMENTS,
  PRESENTATION_STATE_CONDITIONS,
  PRESENTATION_SYNC_ANCHORS,
  PRESENTATION_DELIVERY_EMOTIONS,
  PRESENTATION_DELIVERY_PACES,
  normalizePresentationSyncAnchor,
  normalizePresentationCue,
  normalizePresentationTimeline,
  createPresentationTimelineHash,
  createPresentationTimelineContract,
  presentationTimelineHashProjection,
  presentationTimelineHasTurns,
} from './presentation/contract.js';
export {
  PRESENTATION_ALIGNED_SEQUENCE_VERSION,
  PRESENTATION_ALIGNMENT_RESOLUTIONS,
  createPresentationAlignedSequence,
  validatePresentationAlignedSequence,
} from './presentation/align.js';
export { solvePresentationClock } from './presentation/solver.js';


export {
  PRESENTATION_CAPTION_TIMING_TOLERANCE_MS,
  PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION,
  PRESENTATION_REPLAN_RESULT_SCHEMA_VERSION,
  planCaptionPlacements,
} from './presentation-output.js';

export const PRESENTATION_PROMPT_PROFILES = Object.freeze(['brief', 'full', 'data-grounded', 'task-specific', 'dialogue']);
export const PRESENTATION_LESSON_AUDIT_SCHEMA_VERSION = 'presentation-lesson-audit-v2';
export const PRESENTATION_LESSON_REVIEW_CODES = Object.freeze([
  'action-disallowed-target',
  'action-missing-name',
  'dialogue-clarification-missing',
  'dialogue-act-invalid',
  'dialogue-alternating-monologues',
  'dialogue-delivery-discontinuity',
  'dialogue-discourse-marker-repeated',
  'dialogue-grounding-disconnected',
  'dialogue-persona-undeclared',
  'dialogue-question-missing',
  'dialogue-question-punctuation-missing',
  'dialogue-pronounceability-hazard',
  'dialogue-reply-content-disconnected',
  'dialogue-repetition-flood',
  'dialogue-role-contribution-imbalanced',
  'dialogue-role-indistinct',
  'dialogue-semantic-act-weak',
  'dialogue-terminal-punctuation-missing',
  'dialogue-turn-pacing',
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
  'lesson-arc-contract-invalid',
  'lesson-arc-start-invalid',
  'lesson-arc-body-invalid',
  'lesson-arc-closure-invalid',
  'lesson-arc-final-invalid',
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

const PRESENTATION_LESSON_SEMANTIC_STOPWORDS = Object.freeze({
  en: new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'before', 'by', 'for',
    'from', 'has', 'have', 'here', 'in', 'into', 'is', 'it', 'of', 'on', 'or',
    'that', 'the', 'their', 'then', 'this', 'to', 'was', 'we', 'will', 'with',
  ]),
  ru: new Set([
    'а', 'без', 'был', 'была', 'были', 'в', 'во', 'для', 'до', 'и', 'из', 'или',
    'к', 'как', 'мы', 'на', 'не', 'о', 'об', 'он', 'она', 'они', 'от', 'по', 'при',
    'с', 'со', 'то', 'у', 'что', 'это', 'этот', 'эта', 'эти',
  ]),
  es: new Set([
    'a', 'al', 'antes', 'como', 'con', 'de', 'del', 'el', 'en', 'es', 'esta',
    'este', 'estos', 'la', 'las', 'lo', 'los', 'para', 'por', 'que', 'se', 'su',
    'sus', 'un', 'una', 'y', 'ya',
  ]),
});
const PRESENTATION_LESSON_SEMANTIC_PLACEHOLDERS = new Set([
  'available', 'false', 'none', 'null', 'omitted', 'true', 'undefined', 'unknown',
]);
const PRESENTATION_LESSON_SEMANTIC_LIMITS = Object.freeze({
  fragments: 16,
  fragmentLength: 500,
  nodes: 32,
  tokens: 96,
});

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

function interactionType(name, target) {
  if (/(?:text|range)[._:\s-]*(?:select|selection)|(?:select|selection)[._:\s-]*(?:text|range)/i.test(name)) return 'text-select';
  if (/double/i.test(name)) return 'double-click';
  if (/hover/i.test(name)) return 'hover';
  if (/drag/i.test(name)) return 'drag';
  if (/scroll/i.test(name)) return 'scroll';
  if (/zoom/i.test(name)) return 'zoom';
  if (/input|type|edit/i.test(name)) return 'input';
  if (/select|choose/i.test(name)) return 'select';
  if (/reveal|expand|open-panel/i.test(name) || target.visible === false) return 'panel-reveal';
  if (/navigate|route|open/i.test(name)) return 'navigate';
  return 'click';
}

function interactionCues(target, profile) {
  let actions = [];
  for (let tool of listValue(target.webmcpTools)) {
    let name = actionName(tool);
    if (name) actions.push({
      kind: 'interaction',
      targetId: target.address,
      at: { anchor: 'turn-start', offsetMs: 0 },
      interaction: {
        type: interactionType(name, target),
        binding: { source: 'webmcp', tool: name, input: clonePortable(tool.input || {}) },
      },
    });
  }
  for (let action of listValue(target.safeActions)) {
    let name = actionName(action);
    if (name) actions.push({
      kind: 'interaction',
      targetId: target.address,
      at: { anchor: 'turn-start', offsetMs: 0 },
      interaction: {
        type: interactionType(name, target),
        binding: { source: 'workspace', tool: name, input: clonePortable(action.input || {}) },
      },
    });
  }
  return actions.slice(0, profile === 'full' ? 2 : 1);
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
    let previousTitle = cleanTimelineText(requestInfo.previousTargetTitle, 'the previous workspace signal');
    if (index === 0) return `Start with ${title}${suffix} so the viewer has the source context.`;
    if (index === 1) return `What does ${title} add to the result we just saw?`;
    if (index === total - 1) return `${title} closes the explanation by connecting the evidence to the requested outcome.`;
    return `That answer from ${title} continues ${previousTitle} with the next concrete workspace signal.`;
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

function presentationLessonLanguage(locale) {
  let language = cleanTimelineText(locale, 'en-US').toLowerCase().split(/[-_]/)[0];
  return ['ru', 'es'].includes(language) ? language : 'en';
}

function presentationLessonSemanticFragments(value) {
  let limits = PRESENTATION_LESSON_SEMANTIC_LIMITS;
  let queue = [{ value, depth: 0 }];
  let seen = new WeakSet();
  let fragments = [];
  let visited = 0;
  while (queue.length && fragments.length < limits.fragments && visited < limits.nodes) {
    let current = queue.shift();
    let item = current.value;
    visited += 1;
    if (item === undefined || item === null || typeof item === 'function' || typeof item === 'symbol') continue;
    if (typeof item !== 'object') {
      let text = cleanTimelineText(item).slice(0, limits.fragmentLength);
      if (text && !PRESENTATION_LESSON_SEMANTIC_PLACEHOLDERS.has(text.toLowerCase())) fragments.push(text);
      continue;
    }
    if (seen.has(item) || current.depth >= 3) continue;
    seen.add(item);
    let entries = Array.isArray(item)
      ? item.slice(0, 8).map((child) => ['', child])
      : Object.entries(item).slice(0, 8);
    for (let [key, child] of entries) {
      if (key) queue.push({ value: key, depth: current.depth + 1 });
      queue.push({ value: child, depth: current.depth + 1 });
    }
  }
  return fragments;
}

function presentationLessonSemanticStem(token, language) {
  let suffixes = language === 'ru'
    ? ['иями', 'ями', 'ами', 'ого', 'ему', 'ому', 'ыми', 'ими', 'ать', 'ять', 'ить', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ой', 'ей', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'ов', 'ев', 'ы', 'и', 'а', 'я', 'у', 'ю', 'е', 'о']
    : language === 'es'
      ? ['amientos', 'imientos', 'aciones', 'adores', 'adoras', 'ando', 'iendo', 'ados', 'adas', 'idos', 'idas', 'es', 'os', 'as', 'o', 'a', 's']
      : ['ingly', 'edly', 'ations', 'ation', 'ments', 'ment', 'ing', 'ied', 'ies', 'ed', 'es', 's'];
  for (let suffix of suffixes) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      token = token.slice(0, -suffix.length);
      break;
    }
  }
  if (language === 'en' && token.endsWith('e') && token.length > 5) token = token.slice(0, -1);
  return token;
}

function presentationLessonSemanticTokens(value, locale) {
  let language = presentationLessonLanguage(locale);
  let stopwords = PRESENTATION_LESSON_SEMANTIC_STOPWORDS[language];
  let tokens = [];
  let seen = new Set();
  for (let fragment of presentationLessonSemanticFragments(value)) {
    let normalized = fragment
      .normalize('NFKD')
      .toLocaleLowerCase(language)
      .replace(/\p{M}/gu, '');
    for (let token of normalized.match(/[\p{L}\p{N}]+/gu) || []) {
      if ((!/\d/u.test(token) && token.length < 3) || stopwords.has(token)) continue;
      let stem = presentationLessonSemanticStem(token, language);
      if (!stem || seen.has(stem)) continue;
      seen.add(stem);
      tokens.push(stem);
      if (tokens.length >= PRESENTATION_LESSON_SEMANTIC_LIMITS.tokens) return tokens;
    }
  }
  return tokens;
}

function presentationLessonTokensMatch(left, right) {
  if (left === right) return true;
  if (/\d/u.test(left) || /\d/u.test(right)) return false;
  let common = 0;
  let limit = Math.min(left.length, right.length);
  while (common < limit && left[common] === right[common]) common += 1;
  return limit >= 5 && common >= Math.min(6, limit);
}

function presentationLessonSemanticOverlap(spokenText, declaredContent, locale) {
  // This bounded lexical gate handles common inflection, not translation or synonym inference.
  // Content without shared words therefore fails closed instead of trusting metadata alone.
  let spokenTokens = presentationLessonSemanticTokens(spokenText, locale);
  let declaredTokens = presentationLessonSemanticTokens(declaredContent, locale);
  if (!spokenTokens.length || !declaredTokens.length) return false;
  let usedSpoken = new Set();
  let matches = [];
  for (let declared of declaredTokens) {
    let spokenIndex = spokenTokens.findIndex((spoken, index) => (
      !usedSpoken.has(index) && presentationLessonTokensMatch(spoken, declared)
    ));
    if (spokenIndex === -1) continue;
    usedSpoken.add(spokenIndex);
    matches.push(declared);
  }
  if (matches.length >= 2) return true;
  if (matches.length !== 1) return false;
  return /\d/u.test(matches[0]) || declaredTokens.length === 1;
}

function presentationLessonHasSemanticContent(values, locale) {
  return listValue(values).some((value) => presentationLessonSemanticTokens(value, locale).length > 0);
}

function presentationLessonCoheresWithAny(spokenText, values, locale) {
  return listValue(values).some((value) => presentationLessonSemanticOverlap(spokenText, value, locale));
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
    let serialized = /\d|[:._/#\[\]-]/u.test(value);
    return value.length >= 3 && serialized && spoken.includes(value);
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

const DIALOGUE_HANDOFF_MARKERS = new Set([
  'yes', 'right', 'exactly', 'also', 'and', 'but', 'so', 'then', 'now', 'that',
  'this', 'those', 'because', 'while', 'here', 'notice', 'you', 'correct', 'agreed',
  'да', 'верно', 'точно', 'также', 'но', 'поэтому', 'тогда', 'сейчас', 'это', 'здесь',
  'sí', 'correcto', 'exacto', 'también', 'pero', 'entonces', 'ahora', 'esto', 'aquí',
  'porque', 'mientras',
]);

function hasDialogueHandoff(text) {
  let tokens = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return tokens.some((token) => DIALOGUE_HANDOFF_MARKERS.has(token))
    || tokens.some((token, index) => token === 'i' && tokens[index + 1] === 'see');
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
  let requiredPersonas = idList(intent.requiredPersonas);
  let requiredKeywords = requestKeywords(intent);
  let requestedSurfaceIds = idList(intent.requestedSurfaceIds || intent.requestedTargets);
  let selectedTabIds = idList(intent.selectedTabIds || intent.requestedTabIds);
  let budget = normalizeTurnBudget(intent);
  let cueReview = reviewPresentationCues(timeline, intent);
  for (let issue of cueReview.issues) addIssue(issue.code, issue.message, issue);
  let targetIds = new Set(cueReview.targetIds);
  let tabIds = new Set(cueReview.tabIds);
  let personas = new Set();
  let actionCount = cueReview.interactionCount;
  let maxWordsPerTurn = Math.max(1, Math.floor(Number(intent.maxWordsPerTurn || intent.tts?.maxWordsPerTurn || 24)));
  let maxOverlapWords = Math.max(1, Math.floor(Number(intent.maxOverlapWords || intent.dialogue?.maxOverlapWords || 5)));
  let maxSamePersonaRun = Math.max(1, Math.floor(Number(intent.maxSamePersonaRun || intent.dialogue?.maxSamePersonaRun || 2)));
  let strictLessonArc = intent.strictLessonArc === true || intent.requireLessonArc === true;
  let requestedSpeakerMode = cleanTimelineText(
    intent.speakerMode
      || intent.renderSettings?.speakerMode
      || intent.output?.voice?.mode
      || intent.outputSpec?.voice?.mode,
  );
  let singleSpeakerRequested = ['single', 'single-narrator'].includes(requestedSpeakerMode);
  let strictLessonDialogue = strictLessonArc && !singleSpeakerRequested;
  let dialogueIntent = strictLessonDialogue ? {
    ...intent,
    requireDialogue: true,
    requireDialogueHandoffs: true,
    strictDialogueQuality: true,
    requireGrounding: true,
  } : intent;
  let strictDialogueQuality = dialogueIntent.strictDialogueQuality === true || dialogueIntent.hardGate === true;
  let groundingRequired = intent.requireGrounding === true || strictDialogueQuality || strictLessonArc;
  let groundingSources = new Map(listValue(timeline.grounding?.sources).map((source) => [source.id, source]));
  let speechRegistryTokens = [
    ...allowedTargetIds,
    ...allowedToolNames,
    ...idList(intent.forbiddenSpeechTokens),
  ];
  let normalizedTexts = new Map();
  let boilerplateCounts = new Map();
  let handoffCount = 0;
  let personaByTurnId = new Map();
  let previousPersona = '';
  let personaRunLength = 0;
  let longestPersonaRun = 0;
  let handoffRequired = dialogueIntent.requireDialogueHandoffs === true ||
    (dialogueIntent.requireDialogue === true && turns.length >= 4);
  let timelineText = [
    timeline.title,
    timeline.profile,
    ...turns.flatMap((turn) => [
      turn?.text,
      ...listValue(turn?.cues).flatMap((cue) => [cue.targetId, cue.tabId]),
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
    let primaryCue = primaryPresentationCue(turn);
    let targetId = cleanTimelineText(primaryCue?.targetId);
    let tabId = cleanTimelineText(primaryCue?.tabId);
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
    if (groundingRequired && ['explain', 'respond', 'confirm', 'disagree', 'summarize', 'conclude', 'close'].includes(turn.dialogueAct) && !refs.length) {
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
    let priorPersona = index > 0 ? cleanTimelineText(turns[index - 1]?.persona) : '';
    let personaChanged = Boolean(persona && priorPersona && persona !== priorPersona);
    let repliedPersona = turn?.replyTo ? personaByTurnId.get(turn.replyTo) : undefined;
    let structuredHandoff = repliedPersona !== undefined && repliedPersona !== persona;
    if (personaChanged && (structuredHandoff || hasDialogueHandoff(turn?.text))) {
      handoffCount += 1;
    }
    let overlapMs = nonNegativeNumber(turn?.transition?.overlapMs, 0);
    let overlapsPrevious = overlapMs > 0;
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
    if (turn?.id) personaByTurnId.set(turn.id, persona);
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
  let dialogueReview = reviewPresentationDialogue(timeline, dialogueIntent);
  for (let issue of dialogueReview.issues) addIssue(issue.code, issue.message, issue);
  longestPersonaRun = dialogueReview.longestPersonaRun;
  maxSamePersonaRun = dialogueReview.maxSamePersonaRun;
  maxOverlapWords = dialogueReview.maxOverlapWords;
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

  if (strictLessonArc && turns.length > 0) {
    let arc = isObject(intent.lessonArc) ? intent.lessonArc : null;
    let openingRequired = arc?.openingRequired === true;
    let closureRequired = arc?.closureRequired === true;
    let lessonContext = isObject(intent.lessonContext) ? intent.lessonContext : {};
    let lesson = isObject(lessonContext.lesson) ? lessonContext.lesson : {};
    let locale = cleanTimelineText(lesson.locale || timeline.locale, 'en-US');
    let facts = listValue(lessonContext.facts).filter(isObject);
    let evidence = listValue(lessonContext.evidence).filter(isObject);
    let factById = new Map(facts.map((fact) => [cleanTimelineText(fact.id), fact]).filter(([id]) => id));
    let evidenceById = new Map(evidence.map((item) => [cleanTimelineText(item.id), item]).filter(([id]) => id));
    let requiredFields = ['subjectSourceIds', 'outcomeSourceIds', 'requiredFactIds', 'requiredTargetIds', 'orderedTargetIds'];
    let missingFields = requiredFields.filter((field) => !Array.isArray(arc?.[field]));
    let subjectSourceIds = idList(arc?.subjectSourceIds);
    let outcomeSourceIds = idList(arc?.outcomeSourceIds);
    let requiredFactIds = idList(arc?.requiredFactIds);
    let requiredTargetIds = idList(arc?.requiredTargetIds);
    let orderedTargetIds = idList(arc?.orderedTargetIds);
    let emptyFields = [
      ['subjectSourceIds', subjectSourceIds],
      ['outcomeSourceIds', outcomeSourceIds],
      ['requiredFactIds', requiredFactIds],
      ['requiredTargetIds', requiredTargetIds],
      ['orderedTargetIds', orderedTargetIds],
    ].filter(([, values]) => values.length === 0).map(([field]) => field);

    let semanticContentCache = new Map();
    let semanticContentFor = (id) => {
      if (semanticContentCache.has(id)) return semanticContentCache.get(id);
      let values = [];
      let add = (value) => {
        if (values.length >= PRESENTATION_LESSON_SEMANTIC_LIMITS.fragments
          || value === undefined || value === null || value === '') return;
        if (typeof value === 'string' && cleanTimelineText(value).toLowerCase() === id.toLowerCase()) return;
        values.push(value);
      };
      let source = groundingSources.get(id);
      let fact = factById.get(id);
      let evidenceItem = evidenceById.get(id);
      add(source?.summary);
      add(evidenceItem?.summary);
      add(evidenceItem?.value);
      if (fact) {
        add(fact.label);
        add(fact.value);
        for (let evidenceId of idList(fact.evidenceRefs)) {
          let linkedEvidence = evidenceById.get(evidenceId);
          add(groundingSources.get(evidenceId)?.summary);
          add(linkedEvidence?.summary);
          add(linkedEvidence?.value);
        }
      }
      for (let linkedFact of facts) {
        if (!idList(linkedFact.evidenceRefs).includes(id)) continue;
        add(linkedFact.label);
        add(linkedFact.value);
      }
      semanticContentCache.set(id, values);
      return values;
    };

    let sourceIdsFor = (turn) => new Set(listValue(turn?.sourceRefs).map((ref) => ref.sourceId).filter(Boolean));
    let claimsFor = (turn) => listValue(turn?.claims).filter(isObject);
    let factIdsFor = (turn) => new Set([
      ...sourceIdsFor(turn),
      ...claimsFor(turn).flatMap((claim) => idList(claim.factRefs)),
    ]);
    let includesAll = (set, required) => required.every((value) => set.has(value));
    let turnSupportsSource = (turn, sourceId) => (
      sourceIdsFor(turn).has(sourceId)
      && presentationLessonCoheresWithAny(turn.text, semanticContentFor(sourceId), locale)
    );
    let claimSupportsFact = (turn, claim, factId) => {
      if (!idList(claim.factRefs).includes(factId)) return false;
      let turnSourceIds = sourceIdsFor(turn);
      let linkedEvidenceIds = idList(claim.evidenceRefs).filter((evidenceId) => turnSourceIds.has(evidenceId));
      let factContent = semanticContentFor(factId);
      if (!linkedEvidenceIds.length
        || !presentationLessonCoheresWithAny(turn.text, factContent, locale)
        || !presentationLessonSemanticOverlap(turn.text, claim.text, locale)
        || !presentationLessonCoheresWithAny(claim.text, factContent, locale)) return false;
      return linkedEvidenceIds.some((evidenceId) => {
        let evidenceContent = semanticContentFor(evidenceId);
        return presentationLessonHasSemanticContent(evidenceContent, locale)
          && presentationLessonCoheresWithAny(claim.text, evidenceContent, locale);
      });
    };
    let turnSupportsFact = (turn, factId) => (
      (sourceIdsFor(turn).has(factId)
        && presentationLessonCoheresWithAny(turn.text, semanticContentFor(factId), locale))
      || claimsFor(turn).some((claim) => claimSupportsFact(turn, claim, factId))
    );

    let unknownSourceIds = [...new Set([...subjectSourceIds, ...outcomeSourceIds])]
      .filter((sourceId) => !groundingSources.has(sourceId));
    let unknownFactIds = requiredFactIds.filter((factId) => (
      !groundingSources.has(factId) && !factById.has(factId) && !evidenceById.has(factId)
    ));
    let unknownOrderedTargetIds = orderedTargetIds.filter((targetId) => !requiredTargetIds.includes(targetId));
    let unverifiableSourceIds = [...new Set([...subjectSourceIds, ...outcomeSourceIds])]
      .filter((sourceId) => !presentationLessonHasSemanticContent(semanticContentFor(sourceId), locale));
    let unverifiableFactIds = requiredFactIds
      .filter((factId) => !presentationLessonHasSemanticContent(semanticContentFor(factId), locale));
    if (missingFields.length || emptyFields.length || unknownSourceIds.length || unknownFactIds.length
      || unknownOrderedTargetIds.length
      || unverifiableSourceIds.length || unverifiableFactIds.length) {
      addIssue('lesson-arc-contract-invalid', 'Strict lesson review requires explicit, grounded lesson-arc identities.', {
        severity: 'error',
        missingFields,
        emptyFields,
        unknownSourceIds,
        unknownFactIds,
        unknownOrderedTargetIds,
        unverifiableSourceIds,
        unverifiableFactIds,
      });
    }

    let openingRefs = sourceIdsFor(turns[0]);
    let missingSubjectRefs = subjectSourceIds.filter((sourceId) => !openingRefs.has(sourceId));
    let missingOutcomeRefs = outcomeSourceIds.filter((sourceId) => !openingRefs.has(sourceId));
    let incoherentSubjectSourceIds = subjectSourceIds
      .filter((sourceId) => openingRefs.has(sourceId) && !turnSupportsSource(turns[0], sourceId));
    let incoherentOutcomeSourceIds = outcomeSourceIds
      .filter((sourceId) => openingRefs.has(sourceId) && !turnSupportsSource(turns[0], sourceId));
    let hasOpening = turns[0].dialogueAct === 'open';
    if ((openingRequired || hasOpening) && (
      !hasOpening
      || missingSubjectRefs.length
      || missingOutcomeRefs.length
      || incoherentSubjectSourceIds.length
      || incoherentOutcomeSourceIds.length
    )) {
      addIssue('lesson-arc-start-invalid', 'The first turn must be an opening grounded in the declared subject and expected outcome.', {
        severity: 'error',
        turnIndex: 0,
        missingSubjectRefs,
        missingOutcomeRefs,
        incoherentSubjectSourceIds,
        incoherentOutcomeSourceIds,
      });
    }

    let bodyTurns = turns.slice(hasOpening ? 1 : 0)
      .filter((turn) => !['summarize', 'conclude', 'close'].includes(turn.dialogueAct));
    let bodyFactIds = new Set(bodyTurns.flatMap((turn) => [...factIdsFor(turn)]));
    let missingFacts = requiredFactIds.filter((factId) => !bodyFactIds.has(factId));
    let incoherentFacts = requiredFactIds.filter((factId) => (
      bodyFactIds.has(factId) && !bodyTurns.some((turn) => turnSupportsFact(turn, factId))
    ));
    let firstTargetIndex = new Map();
    for (let [turnIndex, turn] of bodyTurns.entries()) {
      for (let cue of listValue(turn.cues)) {
        if (cue.kind === 'focus' && cue.targetId && !firstTargetIndex.has(cue.targetId)) {
          firstTargetIndex.set(cue.targetId, turnIndex);
        }
      }
    }
    let missingTargets = requiredTargetIds.filter((targetId) => !firstTargetIndex.has(targetId));
    let priorOrderedIndex = -1;
    let outOfOrderTargets = [];
    for (let targetId of orderedTargetIds) {
      let index = firstTargetIndex.get(targetId);
      if (index !== undefined && index < priorOrderedIndex) outOfOrderTargets.push(targetId);
      if (index !== undefined) priorOrderedIndex = index;
    }
    if (missingFacts.length || incoherentFacts.length || missingTargets.length || outOfOrderTargets.length) {
      addIssue('lesson-arc-body-invalid', 'The lesson body does not cover the declared facts and target sequence.', {
        severity: 'error',
        missingFactIds: missingFacts,
        incoherentFactIds: incoherentFacts,
        missingTargetIds: missingTargets,
        outOfOrderTargetIds: outOfOrderTargets,
      });
    }

    let closureWindowSize = PRESENTATION_DIALOGUE_QUALITY_PROFILE.closureWindow || 3;
    let closureTurns = turns.slice(-closureWindowSize).filter((turn) => ['summarize', 'conclude', 'close'].includes(turn.dialogueAct));
    let closureSourceIds = new Set(closureTurns.flatMap((turn) => [...sourceIdsFor(turn)]));
    let closureFactIds = new Set(closureTurns.flatMap((turn) => [...factIdsFor(turn)]));
    let incoherentClosureOutcomeSourceIds = outcomeSourceIds.filter((sourceId) => (
      closureSourceIds.has(sourceId) && !closureTurns.some((turn) => turnSupportsSource(turn, sourceId))
    ));
    let coherentClosureFactIds = requiredFactIds
      .filter((factId) => closureFactIds.has(factId) && closureTurns.some((turn) => turnSupportsFact(turn, factId)));
    let closureGrounded = closureTurns.length > 0
      && includesAll(closureSourceIds, outcomeSourceIds)
      && incoherentClosureOutcomeSourceIds.length === 0
      && coherentClosureFactIds.length > 0;
    if (closureRequired && !closureGrounded) {
      addIssue('lesson-arc-closure-invalid', `The closing window of ${closureWindowSize} turns must summarize a demonstrated fact and the declared outcome.`, {
        severity: 'error',
        incoherentOutcomeSourceIds: incoherentClosureOutcomeSourceIds,
        coherentFactIds: coherentClosureFactIds,
      });
    }

    let finalTurn = turns[turns.length - 1];
    let finalRefs = sourceIdsFor(finalTurn);
    let incoherentFinalOutcomeSourceIds = outcomeSourceIds.filter((sourceId) => (
      finalRefs.has(sourceId) && !turnSupportsSource(finalTurn, sourceId)
    ));
    if (closureRequired && (
      !['conclude', 'close'].includes(finalTurn.dialogueAct)
      || !includesAll(finalRefs, outcomeSourceIds)
      || incoherentFinalOutcomeSourceIds.length
    )) {
      addIssue('lesson-arc-final-invalid', 'The final turn must close the lesson and cite the declared outcome.', {
        severity: 'error',
        turnIndex: turns.length - 1,
        incoherentOutcomeSourceIds: incoherentFinalOutcomeSourceIds,
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
      requestedSpeakerMode: requestedSpeakerMode || (strictLessonDialogue ? 'dialogue' : ''),
      strictLessonDialogue,
      actionCount,
    },
  };
}

export function createPresentationTtsProjection(input = {}, options = {}) {
  let timeline = normalizePresentationTimeline(input);
  let review = options.review || null;
  if (review?.verdict === 'reject') {
    return {
      schemaVersion: 'presentation-tts-projection-v3',
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
      cueCount: listValue(turn.cues).length,
    });
  });
  return {
    schemaVersion: 'presentation-tts-projection-v3',
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

function createTurn(target, index, total, profile, refs, context, requestInfo = {}) {
  let dataRefs = segmentDataRefs(target, profile, refs);
  let dialogueAct = profile === 'dialogue'
    ? index === 0 ? 'open' : index === 1 ? 'ask' : index === total - 1 ? 'close' : 'respond'
    : 'explain';
  let turnText = narrationFor(profile, target, index, total, dataRefs, context, requestInfo);
  return compactObject({
    id: portableId(`turn-${index + 1}-${profile}`),
    persona: profile === 'dialogue' ? (index % 2 ? 'analyst' : 'guide') : 'guide',
    addressee: profile === 'dialogue' ? (index % 2 ? 'guide' : 'analyst') : undefined,
    dialogueAct,
    replyTo: index > 0 ? portableId(`turn-${index}-${profile}`) : undefined,
    text: turnText,
    cues: [{
      kind: 'focus',
      targetId: target.address,
      tabId: targetTabId(target, context),
      at: { anchor: 'turn-start', offsetMs: 0 },
      until: { anchor: 'turn-end', offsetMs: 0 },
      focus: { mode: 'cursor' },
    }, ...interactionCues(target, profile)],
    sourceRefs: dataRefs.map((ref) => ({
      sourceId: ref.id,
      path: ref.path,
      hash: ref.contentHash,
      targetId: target.address,
    })),
  });
}

export function summarizePresentationTimeline(timeline = {}) {
  let turns = listValue(timeline.turns);
  let targetCoverage = turns.flatMap((turn) => listValue(turn.cues).map((cue) => cue.targetId)).filter(Boolean);
  let dataRefCount = turns.reduce((total, turn) => total + listValue(turn.sourceRefs).length, 0);
  return {
    profile: timeline.profile || 'brief',
    turnCount: turns.length,
    targetCoverage,
    dataRefCount,
    narrationDensity: turns.length > 1 ? 'expanded' : 'compact',
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
  let turns = targets.map((target, index) => createTurn(target, index, targets.length, prompt.profile, refs, context, {
    ...requestInfo,
    previousTargetTitle: index > 0 ? targetTitle(targets[index - 1]) : '',
  }));
  let timeline = compactObject({
    contractVersion: PRESENTATION_CONTRACT_VERSION,
    id: portableId(input.id || `${prompt.profile}-presentation`),
    source: input.source || 'local',
    locale: prompt.locale,
    profile: prompt.profile,
    personas: prompt.profile === 'dialogue'
      ? {
          guide: { name: 'Guide', role: 'lesson guide', locale: prompt.locale, delivery: { emotion: 'warm', pace: 'normal' } },
          analyst: { name: 'Analyst', role: 'domain analyst', locale: prompt.locale, delivery: { emotion: 'curious', pace: 'normal' } },
        }
      : { guide: { name: 'Guide', role: 'lesson guide', locale: prompt.locale } },
    grounding: {
      sources: refs.map((ref) => normalizeGroundingSource(ref)).filter(Boolean),
    },
    turns,
    metadata: compactObject({
      revision: Number.isInteger(input.revision) ? input.revision : undefined,
      freshness: input.freshness || 'fresh',
      prompt: prompt.prompt ? { text: prompt.prompt, profile: prompt.profile } : { profile: prompt.profile },
      requiredHostServices: ['agent.webmcp', ...listValue(input.requiredHostServices)],
    }),
  });
  timeline.metadata.presentationSummary = {
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
  let viewportSource = options.viewport || context.viewport || output.presentationViewport;
  let viewport = normalizeSnapshotViewport({ ...viewportSource, fps: viewportSource.fps ?? output.fps });
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
  return { ...request, hash: presentationReplanRequestHash(request) };
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
  let requiredTargetIds = idList(lessonContext.lesson?.requiredTargetIds);
  let snapshot = {
    ...(lessonContext.targetSnapshot || {}),
    targets: listValue(lessonContext.targets).map((target) => ({
      address: target.id || target.address,
      tabId: target.tabId,
      safeActionNames: target.revealRefs || [],
      webmcpToolNames: listValue(target.toolRefs).map((id) => descriptorNames.get(id)).filter(Boolean),
    })),
  };
  let requiredTargetSet = new Set(requiredTargetIds);
  let selectedTabIds = idList(snapshot.targets
    .filter((target) => requiredTargetSet.has(target.address))
    .map((target) => target.tabId));
  let lessonArc = isObject(lessonContext.constraints?.lessonArc)
    ? lessonContext.constraints.lessonArc
    : intent.lessonArc;
  let speakerMode = cleanTimelineText(lessonContext.output?.voice?.mode || intent.speakerMode);
  let structural = reviewPresentationTimelineAgainstSnapshot(input, snapshot, {
    ...intent,
    requestedSurfaceIds: requiredTargetIds,
    selectedTabIds: selectedTabIds.length ? selectedTabIds : idList(intent.selectedTabIds),
    lessonArc,
    lessonContext,
    ...(speakerMode ? { speakerMode } : {}),
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
  let expectedRequestHash = presentationReplanRequestHash(request);
  if (request.schemaVersion !== PRESENTATION_REPLAN_REQUEST_SCHEMA_VERSION || request.hash !== expectedRequestHash) {
    throw presentationContractError('REPLAN_REQUEST_STALE', 'presentation replan request hash does not match its content');
  }
  if (candidate.status !== 'ready' || !candidate.timeline) {
    throw presentationContractError('TOUR_REPLAN_REJECTED', 'presentation planner did not return a ready timeline');
  }
  if (cleanTimelineText(candidate.basis?.requestHash) !== request.hash) {
    throw presentationContractError('REPLAN_REQUEST_STALE', 'presentation planner result does not match the exact replan request');
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
      ...listPresentationCompositionCueSlots(timeline).map((slot) => slot.targetId),
    ])];
    compositionAudit = auditPresentationCompositionPlan(compositionPlan, {
      outputSpecHash: request.outputSpecHash,
      structuralHash: expectedHash,
      sourceCompositionHash: request.sourceCompositionHash,
      targetCompositionHash: request.targetCompositionHash,
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
