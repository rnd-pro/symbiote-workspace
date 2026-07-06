import { parseWorkspaceAddress } from '../schema/was.js';
import { computeIntegrity } from '../schema/canonical-json.js';

export const PRESENTATION_PROMPT_PROFILES = Object.freeze(['brief', 'full', 'data-grounded']);
export const PRESENTATION_CONTRACT_VERSION = 'presentation-timeline-v1';

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
  contextual: 'data-grounded',
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
  if (/(на основе данных|данн|контекст|data|record|records|selected|retrieved|grounded)/i.test(text)) {
    return 'data-grounded';
  }
  if (/(полн|подроб|деталь|full|complete|detailed|deep)/i.test(text)) return 'full';
  if (/(крат|корот|быстр|brief|short|quick|summary|concise)/i.test(text)) return 'brief';
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
    for (let key of Object.keys(dataContext.route.data)) {
      refs.push({ source: 'route', path: `state:route.data.${key}` });
    }
  } else if (hasData(dataContext.route)) {
    refs.push({ source: 'route', path: 'state:route' });
  }
  for (let [key, source] of Object.entries(DATA_REF_SOURCES)) {
    if (hasData(dataContext[key])) refs.push({ source, path: key });
  }
  return refs;
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

function choosePresentationTargets(context, profile, request) {
  let targets = contextTargets(context);
  let visible = targets.filter((target) => target.visible);
  let primary = visible.length > 0 ? visible : targets;
  let defaultLimit = profile === 'full' ? targets.length : profile === 'data-grounded' ? 3 : 1;
  let limit = Number.isInteger(request.maxSegments) && request.maxSegments > 0 ? request.maxSegments : defaultLimit;

  if (profile === 'full') return targets.slice(0, limit);
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

function narrationFor(profile, target, index, total, refs, context) {
  let title = targetTitle(target);
  let visibility = target.visible ? 'visible' : 'hidden until revealed';
  if (profile === 'brief') return `${title}: ${visibility} workspace surface.`;
  if (profile === 'data-grounded') {
    let sources = refs.map((ref) => ref.source).filter(Boolean).join(', ') || 'available';
    return `${title}: present this surface using ${sources} context from the current workspace state.`;
  }
  let actions = listValue(target.safeActions).length + listValue(target.webmcpTools).length;
  let hidden = listValue(target.hiddenReasons).join(', ') || 'none';
  return `${index + 1}/${total}: ${title} (${target.kind || 'target'}, module ${target.module || 'unspecified'}) is ${visibility}; hidden reasons: ${hidden}; declared actions/tools: ${actions}.`;
}

function segmentDataRefs(target, profile, refs) {
  if (profile !== 'data-grounded') return [];
  return refs.map((ref) => ({ ...ref, target: target.address }));
}

function cleanTimelineText(value, fallback = '') {
  let text = String(value ?? fallback ?? '').replace(/\s+/g, ' ').trim();
  return text && text !== 'undefined' && text !== 'null' ? text : String(fallback || '').trim();
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

function normalizePresentationTurn(turn = {}, index = 0) {
  if (!isObject(turn)) return null;
  let text = cleanTimelineText(turn.text ?? turn.narration ?? turn.caption);
  if (!text) return null;
  let persona = cleanTimelineText(turn.persona ?? turn.speaker, index % 2 ? 'ops' : 'guide') || 'guide';
  let cue = normalizePresentationCue(turn.cue, turn);
  return compactObject({
    persona,
    text,
    cue: hasKeys(cue) ? cue : undefined,
    webmcp: clonePortable(turn.webmcp),
    annotations: clonePortable(turn.annotations),
    renderCue: clonePortable(turn.renderCue),
  });
}

function segmentToPresentationTurn(segment = {}, index = 0) {
  if (!isObject(segment)) return null;
  let firstCue = listValue(segment.cues)[0] || {};
  return normalizePresentationTurn({
    persona: segment.persona || segment.speaker,
    text: segment.narration || segment.text,
    cue: {
      targetId: firstCue.target || firstCue.targetId || segment.focusTarget || segment.target,
      tabId: firstCue.tabId || segment.tabId,
      marker: firstCue.marker || firstCue.kind,
    },
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
    let id = cleanTimelineText(turn.persona, 'guide') || 'guide';
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
    turns: timeline.turns.map((turn) => compactObject({
      persona: turn.persona,
      text: turn.text,
      cue: hasKeys(turn.cue) ? turn.cue : undefined,
    })),
  };
}

export function normalizePresentationTimeline(input = {}, options = {}) {
  let source = isObject(input) ? input : {};
  let contractVersion = cleanTimelineText(
    options.contractVersion || source.contractVersion,
    PRESENTATION_CONTRACT_VERSION,
  );
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

function createSegment(target, index, total, profile, refs, context) {
  let dataRefs = segmentDataRefs(target, profile, refs);
  return compactObject({
    id: portableId(`segment-${index + 1}-${profile}-${target.kind || 'target'}`),
    target: target.address,
    focusTarget: target.address,
    narration: narrationFor(profile, target, index, total, dataRefs, context),
    cues: [{
      kind: profile === 'brief' ? 'focus' : 'highlight',
      target: target.address,
      text: targetTitle(target),
    }],
    actions: segmentActions(target, profile),
    dataRefs,
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
  let segments = targets.map((target, index) => createSegment(target, index, targets.length, prompt.profile, refs, context));
  let timeline = compactObject({
    id: portableId(input.id || `${prompt.profile}-presentation`),
    source: input.source || 'local',
    revision: Number.isInteger(input.revision) ? input.revision : undefined,
    freshness: input.freshness || 'fresh',
    locale: prompt.locale,
    profile: prompt.profile,
    prompt: prompt.prompt ? { text: prompt.prompt, profile: prompt.profile } : { profile: prompt.profile },
    requiredHostServices: ['agent.webmcp', ...listValue(input.requiredHostServices)],
    segments,
  });
  timeline.summary = {
    ...summarizePresentationTimeline(timeline),
    visibleTargetCount: targets.filter((target) => target.visible).length,
    hiddenTargetCount: targets.filter((target) => !target.visible).length,
    dataSourceCount: refs.length,
    narrationDensity: prompt.profile === 'full' ? 'detailed' : prompt.profile === 'data-grounded' ? 'contextual' : 'compact',
  };
  return timeline;
}
