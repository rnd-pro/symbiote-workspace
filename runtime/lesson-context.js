import { computeIntegrity } from '../schema/canonical-json.js';
import {
  PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  normalizePresentationOutputSpec,
  normalizePresentationTargetComposition,
} from './presentation-output.js';

export const LESSON_CONTEXT_SCHEMA_VERSION = 'workspace-lesson-context-v2';
export const LESSON_TEXT_RULES_VERSION = 'lesson-text-rules-en-ru-v1';
export const LESSON_TYPES = Object.freeze([
  'operational-task',
  'developer-source',
  'data-analysis',
  'workflow-process',
  'concise-overview',
]);
export const LESSON_RELATION_KINDS = Object.freeze([
  'contains',
  'member-of',
  'reveals',
  'activates',
  'selects',
  'precedes',
  'transitions-to',
  'affects',
  'depends-on',
  'defined-in',
]);
export const LESSON_CLAIM_KINDS = Object.freeze([
  'state',
  'metric',
  'comparison',
  'procedure',
  'outcome',
  'conclusion',
]);

const FACT_KINDS = new Set(['text', 'number', 'boolean', 'enum', 'record', 'series', 'source']);
const RELATION_KINDS = new Set(LESSON_RELATION_KINDS);
const CLAIM_KINDS = new Set(LESSON_CLAIM_KINDS);
const SCHEMA_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'enum',
  'const',
  'items',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'additionalProperties',
  'description',
  'title',
  'default',
]);
const STOPWORDS = Object.freeze({
  en: new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with']),
  ru: new Set(['а', 'без', 'в', 'во', 'для', 'и', 'из', 'к', 'как', 'на', 'не', 'о', 'от', 'по', 'с', 'со', 'то', 'у', 'что', 'это']),
});
const DEPTH_RULES = Object.freeze({
  'operational-task': { facts: 2, claims: 2, targets: 2, actions: 1, relationKinds: ['transitions-to', 'affects'], claimKinds: ['outcome'] },
  'developer-source': { facts: 2, sourceFacts: 2, claims: 2, targets: 2, actions: 0, relationKinds: ['depends-on', 'defined-in'] },
  'data-analysis': { facts: 2, claims: 2, targets: 2, actions: 0, claimKinds: ['comparison', 'conclusion'] },
  'workflow-process': { facts: 0, claims: 3, targets: 3, actions: 2, relationCount: 2, relationKinds: ['precedes', 'transitions-to'], claimKinds: ['procedure', 'outcome'] },
  'concise-overview': { facts: 0, claims: 1, targets: 1, actions: 0, maxTargets: 4, minTurns: 2, maxTurns: 4 },
});
const PACKET_LIMITS = Object.freeze({ targets: 256, toolDescriptors: 128, facts: 256, evidence: 256, relations: 512, priorActions: 20 });
const MAX_PORTABLE_VALUE_BYTES = 16 * 1024;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, fallback = '') {
  let text = String(value ?? fallback).replace(/\s+/g, ' ').trim();
  return text === 'undefined' || text === 'null' ? fallback : text;
}

function clonePortable(value, depth = 0) {
  if (depth > 12 || value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (value.nodeType || value.ownerDocument || value.documentElement || value.defaultView) return undefined;
  if (Array.isArray(value)) return value.map((item) => clonePortable(item, depth + 1)).filter((item) => item !== undefined);
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    if (['element', 'el', 'node', 'dom', 'ref', 'refs', 'targetElement', 'execute'].includes(key)) continue;
    let portable = clonePortable(child, depth + 1);
    if (portable !== undefined) result[key] = portable;
  }
  return result;
}

function uniqueSorted(values) {
  return [...new Set(list(values).map((value) => cleanText(value)).filter(Boolean))].sort();
}

function portableId(value, fallback) {
  let id = cleanText(value, fallback).toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  return id || fallback;
}

function canonicalList(values, key = 'id') {
  let records = list(values).filter(isObject);
  let byKey = new Map();
  for (let record of records) {
    let id = cleanText(record[key]);
    if (id) byKey.set(id, record);
  }
  return [...byKey.values()].sort((a, b) => cleanText(a[key]).localeCompare(cleanText(b[key])));
}

function normalizeLocale(locale) {
  return cleanText(locale, 'en-US').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function localizedDateTokens(value, language) {
  let text = cleanText(value).normalize('NFKC').toLocaleLowerCase(language);
  let result = [];
  for (let match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) result.push(`${match[1]}-${match[2]}-${match[3]}`);
  let months = language === 'ru'
    ? { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 }
    : { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  let monthPattern = Object.keys(months).join('|');
  let dayFirst = new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})\\b`, 'g');
  for (let match of text.matchAll(dayFirst)) result.push(`${match[3]}-${String(months[match[2]]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`);
  if (language === 'en') {
    let monthFirst = new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:,)?\\s+(\\d{4})\\b`, 'g');
    for (let match of text.matchAll(monthFirst)) result.push(`${match[3]}-${String(months[match[1]]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`);
  }
  return result;
}

function normalizeDecimalToken(token) {
  let compact = token.replace(/[\s\u00a0\u202f]/g, '');
  if (/^[+-]?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?$/.test(compact)) {
    let lastComma = compact.lastIndexOf(',');
    let lastDot = compact.lastIndexOf('.');
    let decimal = Math.max(lastComma, lastDot);
    let tail = compact.slice(decimal + 1);
    if (tail.length !== 3 || compact.slice(0, decimal).includes(compact[decimal])) {
      return `${compact.slice(0, decimal).replace(/[.,]/g, '')}.${tail}`;
    }
    return compact.replace(/[.,]/g, '');
  }
  return compact.replace(',', '.');
}

export function lessonTextTokens(value, locale = 'en-US', { contentOnly = false } = {}) {
  let language = normalizeLocale(locale);
  let dates = localizedDateTokens(value, language);
  let normalized = cleanText(value)
    .normalize('NFKC')
    .toLocaleLowerCase(language)
    .replace(/([+-]?\d[\d\s\u00a0\u202f.,]*\d|\d)/g, (token) => ` ${normalizeDecimalToken(token)} `);
  let tokens = normalized.match(/[\p{L}\p{N}]+(?:[._:-][\p{L}\p{N}]+)*/gu) || [];
  tokens = [...new Set(tokens.flatMap((token) => [
    token,
    ...(/\p{L}/u.test(token) ? token.split(/[._:-]+/u).filter((part) => part && part !== token) : []),
  ]))];
  tokens.push(...dates);
  if (!contentOnly) return tokens;
  return tokens.filter((token) => !STOPWORDS[language].has(token));
}

function boundedPortableValue(value, path) {
  let portable = clonePortable(value);
  let serialized = JSON.stringify(portable);
  if (serialized && serialized.length > MAX_PORTABLE_VALUE_BYTES) throw new TypeError(`${path} exceeds ${MAX_PORTABLE_VALUE_BYTES} bytes`);
  return portable;
}

function normalizeSafety(annotations = {}) {
  let value = (standard, legacy) => {
    let values = [annotations?.[standard], annotations?.[legacy]].filter((item) => typeof item === 'boolean');
    if (!values.length || new Set(values).size > 1) return null;
    return values[0];
  };
  return {
    readOnly: value('readOnlyHint', 'readOnly'),
    destructive: value('destructiveHint', 'destructive'),
    idempotent: value('idempotentHint', 'idempotent'),
    openWorld: value('openWorldHint', 'openWorld'),
  };
}

function normalizeExposure(value) {
  let origins = [];
  for (let raw of list(value?.exposedTo || value)) {
    try {
      let url = new URL(String(raw));
      if (url.protocol === 'https:' && url.username === '' && url.password === '') origins.push(url.origin);
    } catch {}
  }
  let normalized = uniqueSorted(origins);
  return { mode: normalized.length ? 'explicit' : 'default', origins: normalized };
}

function normalizeInputSchema(value) {
  let schema = value;
  if (typeof schema === 'string') {
    try {
      schema = JSON.parse(schema);
    } catch {
      return null;
    }
  }
  return isObject(schema) ? boundedPortableValue(schema, 'tool schema') : null;
}

export function normalizeLessonToolDescriptor(raw = {}, options = {}) {
  let inputSchema = normalizeInputSchema(raw.inputSchema || raw.input_schema || { type: 'object' });
  let name = cleanText(raw.name || raw.id);
  if (!name) return null;
  let record = {
    id: portableId(options.id || raw.id || `tool:${name}`, `tool:${name}`),
    name,
    description: cleanText(raw.description).slice(0, 2000),
    inputSchema,
    outputSchema: normalizeInputSchema(raw.outputSchema || raw.output_schema) || undefined,
    safety: normalizeSafety(raw.annotations || raw.safety || {}),
    exposure: normalizeExposure(options.registration || raw.registration || raw.exposure),
  };
  return {
    ...record,
    hash: `${LESSON_CONTEXT_SCHEMA_VERSION}:tool:${computeIntegrity(record)}`,
  };
}

function schemaIssues(schema, path = 'inputSchema') {
  let issues = [];
  if (!isObject(schema)) return [{ code: 'tool-schema-invalid', path, message: `${path} must be an object` }];
  for (let key of Object.keys(schema)) {
    if (!SCHEMA_KEYWORDS.has(key)) issues.push({ code: 'tool-schema-keyword-unsupported', path: `${path}.${key}`, message: `unsupported schema keyword: ${key}` });
  }
  if (schema.properties !== undefined) {
    if (!isObject(schema.properties)) issues.push({ code: 'tool-schema-invalid', path: `${path}.properties`, message: 'properties must be an object' });
    else for (let [key, child] of Object.entries(schema.properties)) issues.push(...schemaIssues(child, `${path}.properties.${key}`));
  }
  if (schema.items !== undefined) issues.push(...schemaIssues(schema.items, `${path}.items`));
  return issues;
}

export function validateLessonToolInput(schema, input, path = 'input') {
  let issues = schemaIssues(schema);
  if (issues.length) return issues;
  let visit = (rule, value, currentPath) => {
    let result = [];
    let type = rule.type;
    let validType = type === undefined
      || (type === 'object' && isObject(value))
      || (type === 'array' && Array.isArray(value))
      || (type === 'string' && typeof value === 'string')
      || (type === 'number' && typeof value === 'number' && Number.isFinite(value))
      || (type === 'integer' && Number.isInteger(value))
      || (type === 'boolean' && typeof value === 'boolean')
      || (type === 'null' && value === null);
    if (!validType) return [{ code: 'tool-input-type', path: currentPath, message: `expected ${type}` }];
    if (rule.const !== undefined && value !== rule.const) result.push({ code: 'tool-input-const', path: currentPath, message: 'value does not match const' });
    if (Array.isArray(rule.enum) && !rule.enum.some((item) => computeIntegrity(item) === computeIntegrity(value))) result.push({ code: 'tool-input-enum', path: currentPath, message: 'value is outside enum' });
    if (typeof value === 'string') {
      if (Number.isInteger(rule.minLength) && value.length < rule.minLength) result.push({ code: 'tool-input-min-length', path: currentPath, message: 'string is too short' });
      if (Number.isInteger(rule.maxLength) && value.length > rule.maxLength) result.push({ code: 'tool-input-max-length', path: currentPath, message: 'string is too long' });
      if (typeof rule.pattern === 'string') {
        try {
          if (!new RegExp(rule.pattern, 'u').test(value)) result.push({ code: 'tool-input-pattern', path: currentPath, message: 'string does not match pattern' });
        } catch {
          result.push({ code: 'tool-schema-invalid', path: currentPath, message: 'pattern is invalid' });
        }
      }
    }
    if (typeof value === 'number') {
      if (Number.isFinite(rule.minimum) && value < rule.minimum) result.push({ code: 'tool-input-minimum', path: currentPath, message: 'number is below minimum' });
      if (Number.isFinite(rule.maximum) && value > rule.maximum) result.push({ code: 'tool-input-maximum', path: currentPath, message: 'number is above maximum' });
    }
    if (Array.isArray(value)) {
      if (Number.isInteger(rule.minItems) && value.length < rule.minItems) result.push({ code: 'tool-input-min-items', path: currentPath, message: 'array has too few items' });
      if (Number.isInteger(rule.maxItems) && value.length > rule.maxItems) result.push({ code: 'tool-input-max-items', path: currentPath, message: 'array has too many items' });
      if (rule.items) value.forEach((item, index) => result.push(...visit(rule.items, item, `${currentPath}[${index}]`)));
    }
    if (isObject(value)) {
      for (let key of list(rule.required)) if (!(key in value)) result.push({ code: 'tool-input-required', path: `${currentPath}.${key}`, message: 'required property is missing' });
      let properties = isObject(rule.properties) ? rule.properties : {};
      for (let [key, child] of Object.entries(value)) {
        if (properties[key]) result.push(...visit(properties[key], child, `${currentPath}.${key}`));
        else if (rule.additionalProperties === false) result.push({ code: 'tool-input-additional-property', path: `${currentPath}.${key}`, message: 'additional property is not allowed' });
      }
    }
    return result;
  };
  return visit(schema, input, path);
}

export function lessonToolIsSafeForDeepening(descriptor = {}) {
  let safety = descriptor.safety || {};
  if (safety.destructive !== false && safety.readOnly !== true) return false;
  if (safety.destructive === true || safety.openWorld === true) return false;
  if (safety.readOnly === true) return safety.destructive === false || safety.destructive === null;
  return safety.destructive === false && safety.idempotent === true && safety.openWorld === false;
}

function normalizeTarget(raw = {}) {
  let id = cleanText(raw.id || raw.address || raw.targetId);
  if (!id) return null;
  return {
    id,
    address: cleanText(raw.address, id),
    tabId: cleanText(raw.tabId),
    kind: cleanText(raw.kind || raw.type, 'target'),
    title: cleanText(raw.title || raw.label),
    visible: Boolean(raw.visible),
    rendered: raw.rendered === undefined ? undefined : Boolean(raw.rendered),
    hiddenReasons: uniqueSorted(raw.hiddenReasons),
    revealRefs: uniqueSorted(list(raw.revealRefs).concat(list(raw.revealActions).map((item) => item?.name || item?.id || item?.type))),
    toolRefs: uniqueSorted(raw.toolRefs),
    composition: normalizePresentationTargetComposition(raw.composition || raw.metadata?.composition || {}),
    metadata: boundedPortableValue(raw.enrichment || raw.metadata || {}, `target.${id}.metadata`),
  };
}

function normalizeEvidence(raw = {}, index = 0) {
  let id = cleanText(raw.id, `evidence-${index + 1}`);
  let value = boundedPortableValue(raw.value ?? raw.data ?? raw.summary ?? raw.excerpt ?? null, `evidence.${id}`);
  return {
    id,
    source: cleanText(raw.source || raw.kind, 'context'),
    path: cleanText(raw.path, id),
    value,
    summary: cleanText(raw.summary || raw.excerpt || (typeof value === 'string' ? value : '')),
    contentHash: cleanText(raw.contentHash || raw.hash, computeIntegrity(value)),
    generation: Number.isInteger(raw.generation) ? raw.generation : 0,
    targetRefs: uniqueSorted(raw.targetRefs || [raw.targetId || raw.target].filter(Boolean)),
  };
}

function normalizeFact(raw = {}, index = 0) {
  let id = cleanText(raw.id, `fact-${index + 1}`);
  return {
    id,
    kind: FACT_KINDS.has(raw.kind) ? raw.kind : 'text',
    label: cleanText(raw.label || raw.name, id),
    value: boundedPortableValue(raw.value, `fact.${id}`),
    unit: cleanText(raw.unit) || undefined,
    evidenceRefs: uniqueSorted(raw.evidenceRefs || [raw.evidenceId].filter(Boolean)),
    targetRefs: uniqueSorted(raw.targetRefs || [raw.targetId].filter(Boolean)),
  };
}

function normalizeRelation(raw = {}, index = 0) {
  return {
    id: cleanText(raw.id, `relation-${index + 1}`),
    kind: cleanText(raw.kind || raw.type),
    from: cleanText(raw.from || raw.source),
    to: cleanText(raw.to || raw.target),
    evidenceRefs: uniqueSorted(raw.evidenceRefs),
  };
}

function collectDescriptors(context = {}) {
  let records = [...list(context.toolDescriptors), ...list(context.webmcpTools)];
  for (let target of [...list(context.targets), ...list(context.panels)]) {
    for (let descriptor of list(target.webmcpTools)) records.push({ ...descriptor, targetId: target.address || target.id });
  }
  return canonicalList(records.map((record) => normalizeLessonToolDescriptor(record)).filter(Boolean));
}

function normalizeLesson(raw = {}) {
  let type = LESSON_TYPES.includes(raw.type) ? raw.type : cleanText(raw.type);
  return {
    type,
    title: cleanText(raw.title, 'Workspace lesson'),
    objective: cleanText(raw.objective || raw.goal),
    locale: cleanText(raw.locale, 'en-US'),
    brief: cleanText(raw.brief || raw.prompt),
    requiredFactIds: uniqueSorted(raw.requiredFactIds),
    requiredTargetIds: uniqueSorted(raw.requiredTargetIds),
  };
}

export function createPresentationLessonContext(context = {}, options = {}) {
  let lesson = normalizeLesson(options.lesson || context.lesson || options.request || {});
  let sourceSnapshot = clonePortable(options.sourceSnapshot || context.sourceSnapshot || context.snapshot || {});
  let targetSnapshot = clonePortable(options.targetSnapshot || context.targetSnapshot || context.snapshot || {});
  if (sourceSnapshot.schemaVersion !== PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION) throw new TypeError('lesson source snapshot version is unsupported');
  if (targetSnapshot.schemaVersion !== PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION) throw new TypeError('lesson target snapshot version is unsupported');
  let output = normalizePresentationOutputSpec(options.output || context.output || targetSnapshot.output || { viewport: targetSnapshot.viewport });
  let toolDescriptors = collectDescriptors(context);
  let descriptorByName = new Map(toolDescriptors.map((descriptor) => [descriptor.name, descriptor]));
  let targets = canonicalList([...list(context.targets), ...list(context.panels)].map((raw) => {
    let target = normalizeTarget(raw);
    if (!target) return null;
    target.toolRefs = uniqueSorted(list(raw.webmcpTools).map((tool) => descriptorByName.get(tool?.name || tool?.id)?.id).filter(Boolean).concat(target.toolRefs));
    return target;
  }).filter(Boolean));
  let evidence = canonicalList(list(context.evidence || context.dataSources).map(normalizeEvidence));
  let facts = canonicalList(list(context.facts).map(normalizeFact));
  let relations = canonicalList(list(context.relations).map(normalizeRelation));
  for (let [name, records] of Object.entries({ targets, toolDescriptors, facts, evidence, relations })) {
    if (records.length > PACKET_LIMITS[name]) throw new TypeError(`${name} exceeds ${PACKET_LIMITS[name]} records`);
  }
  let packet = {
    schemaVersion: LESSON_CONTEXT_SCHEMA_VERSION,
    id: portableId(options.id || context.id || `${lesson.type || 'lesson'}-context`, 'lesson-context'),
    textRulesVersion: LESSON_TEXT_RULES_VERSION,
    lesson,
    output,
    constraints: boundedPortableValue(options.constraints || context.constraints || {}, 'constraints'),
    sourceSnapshot,
    targetSnapshot,
    targets,
    toolDescriptors,
    facts,
    evidence,
    relations,
    priorActions: list(context.priorActions).slice(-PACKET_LIMITS.priorActions).map((item, index) => boundedPortableValue(item, `priorActions.${index}`)),
    deepening: boundedPortableValue(options.deepening || context.deepening || { remainingRounds: 1, remainingActions: 3, requestedGaps: [], actions: [] }, 'deepening'),
  };
  return {
    ...packet,
    hash: `${LESSON_CONTEXT_SCHEMA_VERSION}:${computeIntegrity(packet)}`,
  };
}

function auditIssue(code, path, message, severity = 'error') {
  return { code, severity, path, message };
}

export function auditPresentationLessonContext(input = {}) {
  let packet;
  try {
    packet = input.schemaVersion === LESSON_CONTEXT_SCHEMA_VERSION && input.hash
      ? input
      : createPresentationLessonContext(input.context || input, input.options || {});
  } catch (error) {
    return { verdict: 'reject', issues: [auditIssue('lesson-packet-malformed', '', error.message)], issueCodes: ['lesson-packet-malformed'] };
  }
  let issues = [];
  let add = (code, path, message) => issues.push(auditIssue(code, path, message));
  if (packet.schemaVersion !== LESSON_CONTEXT_SCHEMA_VERSION) add('lesson-schema-unsupported', 'schemaVersion', 'unsupported lesson context schema');
  if (packet.sourceSnapshot?.schemaVersion !== PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION) add('lesson-schema-unsupported', 'sourceSnapshot.schemaVersion', 'unsupported embedded source snapshot schema');
  if (packet.targetSnapshot?.schemaVersion !== PRESENTATION_CONTEXT_SNAPSHOT_SCHEMA_VERSION) add('lesson-schema-unsupported', 'targetSnapshot.schemaVersion', 'unsupported embedded target snapshot schema');
  if (packet.output?.hash !== normalizePresentationOutputSpec(packet.output || {}).hash) add('lesson-context-stale', 'output.hash', 'lesson output hash does not match output content');
  let expectedHash = `${LESSON_CONTEXT_SCHEMA_VERSION}:${computeIntegrity(Object.fromEntries(Object.entries(packet).filter(([key]) => key !== 'hash')))}`;
  if (packet.hash !== expectedHash) add('lesson-context-stale', 'hash', 'lesson context hash does not match packet content');
  if (!LESSON_TYPES.includes(packet.lesson?.type)) add('lesson-type-invalid', 'lesson.type', 'lesson type is required');

  let targetIds = new Set(list(packet.targets).map((item) => item.id));
  let evidenceIds = new Set(list(packet.evidence).map((item) => item.id));
  let factIds = new Set(list(packet.facts).map((item) => item.id));
  let descriptorIds = new Set(list(packet.toolDescriptors).map((item) => item.id));
  for (let id of list(packet.lesson?.requiredTargetIds)) if (!targetIds.has(id)) add('required-target-missing', `lesson.requiredTargetIds.${id}`, 'required target is absent');
  for (let id of list(packet.lesson?.requiredFactIds)) if (!factIds.has(id)) add('required-fact-missing', `lesson.requiredFactIds.${id}`, 'required fact is absent');

  for (let [index, descriptor] of list(packet.toolDescriptors).entries()) {
    if (!descriptor.description) add('tool-description-missing', `toolDescriptors[${index}].description`, 'tool description is required');
    issues.push(...schemaIssues(descriptor.inputSchema, `toolDescriptors[${index}].inputSchema`));
    if (descriptor.outputSchema) issues.push(...schemaIssues(descriptor.outputSchema, `toolDescriptors[${index}].outputSchema`));
    if (!['default', 'explicit'].includes(descriptor.exposure?.mode)) add('tool-exposure-invalid', `toolDescriptors[${index}].exposure`, 'tool exposure is unclassified');
    if (descriptor.hash !== `${LESSON_CONTEXT_SCHEMA_VERSION}:tool:${computeIntegrity(Object.fromEntries(Object.entries(descriptor).filter(([key]) => key !== 'hash')))}`) add('tool-descriptor-stale', `toolDescriptors[${index}].hash`, 'tool descriptor hash does not match content');
  }
  for (let [index, target] of list(packet.targets).entries()) {
    for (let id of list(target.toolRefs)) if (!descriptorIds.has(id)) add('target-tool-unresolved', `targets[${index}].toolRefs`, `unknown descriptor: ${id}`);
  }
  for (let [index, fact] of list(packet.facts).entries()) {
    if (fact.value === undefined) add('fact-value-missing', `facts[${index}].value`, 'fact value is required');
    for (let id of list(fact.evidenceRefs)) if (!evidenceIds.has(id)) add('fact-evidence-unresolved', `facts[${index}].evidenceRefs`, `unknown evidence: ${id}`);
    for (let id of list(fact.targetRefs)) if (!targetIds.has(id)) add('fact-target-unresolved', `facts[${index}].targetRefs`, `unknown target: ${id}`);
    if (!fact.evidenceRefs.length) add('fact-evidence-missing', `facts[${index}].evidenceRefs`, 'fact requires evidence');
  }
  for (let [index, relation] of list(packet.relations).entries()) {
    if (!RELATION_KINDS.has(relation.kind)) add('relation-kind-invalid', `relations[${index}].kind`, 'unsupported relation kind');
    if (!targetIds.has(relation.from)) add('relation-endpoint-unresolved', `relations[${index}].from`, 'relation source is absent');
    if (!targetIds.has(relation.to)) add('relation-endpoint-unresolved', `relations[${index}].to`, 'relation target is absent');
    for (let id of list(relation.evidenceRefs)) if (!evidenceIds.has(id)) add('relation-evidence-unresolved', `relations[${index}].evidenceRefs`, `unknown evidence: ${id}`);
  }
  let rule = DEPTH_RULES[packet.lesson?.type];
  if (rule) {
    if (packet.facts.length < rule.facts) add('lesson-depth-insufficient', 'facts', `lesson requires at least ${rule.facts} facts`);
    if (rule.sourceFacts && packet.facts.filter((fact) => fact.kind === 'source').length < rule.sourceFacts) add('lesson-depth-insufficient', 'facts', `lesson requires at least ${rule.sourceFacts} source facts`);
    if (packet.targets.length < rule.targets) add('lesson-depth-insufficient', 'targets', `lesson requires at least ${rule.targets} targets`);
    if (rule.maxTargets && packet.lesson.requiredTargetIds.length > rule.maxTargets) add('lesson-budget-inconsistent', 'lesson.requiredTargetIds', 'required targets exceed concise overview budget');
    if (rule.relationKinds && !packet.relations.some((item) => rule.relationKinds.includes(item.kind))) add('lesson-depth-insufficient', 'relations', `lesson requires relation kind: ${rule.relationKinds.join(' or ')}`);
    if (rule.relationCount && packet.relations.filter((item) => rule.relationKinds.includes(item.kind)).length < rule.relationCount) add('lesson-depth-insufficient', 'relations', `lesson requires at least ${rule.relationCount} ordered relations`);
  }
  let issueCodes = [...new Set(issues.map((issue) => issue.code))];
  return {
    schemaVersion: `${LESSON_CONTEXT_SCHEMA_VERSION}:audit-v1`,
    verdict: issues.some((issue) => issue.severity === 'error') ? 'reject' : 'accept',
    packetHash: packet.hash,
    issueCodes,
    issues,
    coverage: { targets: packet.targets.length, facts: packet.facts.length, evidence: packet.evidence.length, relations: packet.relations.length, tools: packet.toolDescriptors.length },
  };
}

function claimTokens(claim, factMap, evidenceMap, locale) {
  let values = [];
  for (let id of list(claim.factRefs)) if (factMap.has(id)) values.push(factMap.get(id).value, factMap.get(id).label);
  for (let id of list(claim.evidenceRefs)) if (evidenceMap.has(id)) values.push(evidenceMap.get(id).value, evidenceMap.get(id).summary);
  return new Set(values.flatMap((value) => lessonTextTokens(typeof value === 'string' ? value : JSON.stringify(value), locale)));
}

function literalTokens(text, locale) {
  let normalized = lessonTextTokens(text, locale);
  let identifiers = [...cleanText(text).matchAll(/\b[A-ZА-ЯЁ][A-ZА-ЯЁ0-9_-]{1,}\b/gu)]
    .map((match) => match[0].normalize('NFKC').toLocaleLowerCase(normalizeLocale(locale)));
  return [...new Set([...normalized.filter((token) => /\d/.test(token)), ...identifiers])];
}

function jaccard(left, right) {
  let a = new Set(left);
  let b = new Set(right);
  let union = new Set([...a, ...b]);
  if (!union.size) return 0;
  let intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / union.size;
}

export function auditPresentationTimelineClaims(timeline = {}, packet = {}) {
  let issues = [];
  let add = (code, path, message) => issues.push(auditIssue(code, path, message));
  let turns = list(timeline.turns);
  let factMap = new Map(list(packet.facts).map((item) => [item.id, item]));
  let evidenceMap = new Map(list(packet.evidence).map((item) => [item.id, item]));
  let targetIds = new Set(list(packet.targets).map((item) => item.id));
  let descriptorMap = new Map(list(packet.toolDescriptors).map((item) => [item.name, item]));
  let claims = [];
  for (let [turnIndex, turn] of turns.entries()) {
    let turnClaims = list(turn.claims);
    let factual = !['ask', 'handoff'].includes(turn.dialogueAct);
    if (factual && !turnClaims.length) add('unsupported-claim', `turns[${turnIndex}].claims`, 'factual turn requires a structured claim');
    if (!factual && literalTokens(turn.text, packet.lesson?.locale).length) add('unsupported-claim', `turns[${turnIndex}].text`, 'non-factual turn introduces a literal');
    for (let [claimIndex, claim] of turnClaims.entries()) {
      let path = `turns[${turnIndex}].claims[${claimIndex}]`;
      claims.push(claim);
      if (!CLAIM_KINDS.has(claim.kind)) add('claim-kind-invalid', `${path}.kind`, 'unsupported claim kind');
      for (let id of list(claim.factRefs)) if (!factMap.has(id)) add('claim-fact-unresolved', `${path}.factRefs`, `unknown fact: ${id}`);
      for (let id of list(claim.evidenceRefs)) if (!evidenceMap.has(id)) add('claim-evidence-unresolved', `${path}.evidenceRefs`, `unknown evidence: ${id}`);
      for (let id of list(claim.targetRefs)) if (!targetIds.has(id)) add('claim-target-unresolved', `${path}.targetRefs`, `unknown target: ${id}`);
      if (!list(claim.factRefs).length || !list(claim.evidenceRefs).length) add('unsupported-claim', path, 'claim requires fact and evidence references');
      if (claim.kind === 'comparison' && new Set(list(claim.factRefs)).size < 2) add('unsupported-claim', path, 'comparison requires two facts');
      let supported = claimTokens(claim, factMap, evidenceMap, packet.lesson?.locale);
      for (let token of literalTokens(claim.text || turn.text, packet.lesson?.locale)) if (!supported.has(token)) add('unsupported-claim', `${path}.text`, `unsupported literal: ${token}`);
      let content = lessonTextTokens(claim.text || turn.text, packet.lesson?.locale, { contentOnly: true });
      let targetTokens = list(claim.targetRefs).flatMap((id) => lessonTextTokens(packet.targets.find((target) => target.id === id)?.title, packet.lesson?.locale, { contentOnly: true }));
      let factTokens = [...supported];
      if (content.length < 3 || (!content.some((token) => targetTokens.includes(token)) && !content.some((token) => factTokens.includes(token)))) add('generic-narration', `${path}.text`, 'claim text lacks target or fact-specific content');
    }
  }
  for (let left = 0; left < turns.length; left += 1) {
    let leftTokens = lessonTextTokens(turns[left].text, packet.lesson?.locale, { contentOnly: true });
    for (let right = left + 1; right < turns.length; right += 1) {
      let rightTokens = lessonTextTokens(turns[right].text, packet.lesson?.locale, { contentOnly: true });
      if (leftTokens.join(' ') === rightTokens.join(' ') || jaccard(leftTokens, rightTokens) >= 0.85) add('duplicate-narration', `turns[${right}].text`, `turn duplicates turn ${left + 1}`);
    }
  }
  let rule = DEPTH_RULES[packet.lesson?.type];
  let actions = turns.flatMap((turn) => list(turn.cues)
    .filter((cue) => cue.kind === 'interaction' && cue.interaction?.binding)
    .map((cue) => ({
      ...cue.interaction.binding,
      target: cue.targetId,
      type: cue.interaction.type,
    })));
  for (let [index, action] of actions.entries()) {
    let source = cleanText(action.source, action.tool ? 'webmcp' : 'workspace');
    if (source !== 'webmcp') continue;
    let name = cleanText(action.tool || action.name || action.id);
    let descriptor = descriptorMap.get(name);
    if (!descriptor) {
      add('unsafe-action', `actions[${index}]`, `unregistered WebMCP action: ${name}`);
      continue;
    }
    if (!lessonToolIsSafeForDeepening(descriptor)) add('unsafe-action', `actions[${index}]`, `unsafe WebMCP action: ${name}`);
    for (let issue of validateLessonToolInput(descriptor.inputSchema, action.input || {})) {
      add('action-input-invalid', `actions[${index}].${issue.path}`, issue.message);
    }
  }
  if (rule) {
    if (claims.length < rule.claims) add('lesson-depth-insufficient', 'turns.claims', `lesson requires at least ${rule.claims} claims`);
    if (actions.length < rule.actions) add('lesson-depth-insufficient', 'turns.actions', `lesson requires at least ${rule.actions} actions`);
    for (let kind of list(rule.claimKinds)) if (!claims.some((claim) => claim.kind === kind)) add('lesson-depth-insufficient', 'turns.claims', `lesson requires ${kind} claim`);
    if (rule.minTurns && turns.length < rule.minTurns) add('lesson-depth-insufficient', 'turns', `lesson requires at least ${rule.minTurns} turns`);
    if (rule.maxTurns && turns.length > rule.maxTurns) add('lesson-budget-inconsistent', 'turns', `lesson allows at most ${rule.maxTurns} turns`);
  }
  return {
    schemaVersion: `${LESSON_CONTEXT_SCHEMA_VERSION}:timeline-audit-v1`,
    verdict: issues.length ? 'reject' : 'accept',
    packetHash: packet.hash,
    issueCodes: [...new Set(issues.map((issue) => issue.code))],
    issues,
    coverage: { turns: turns.length, claims: claims.length, actions: actions.length },
  };
}
