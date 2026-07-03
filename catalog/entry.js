/**
 * Catalog entry normalization.
 *
 * Catalog entries are addressed by module id only. The activation tag name is
 * allowed inside contract-depth descriptors, but never on the entry shape used
 * for search, proof, or references.
 *
 * @module symbiote-workspace/catalog/entry
 */

import { MODULE_ID_PATTERN } from '../schema/constants.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function stripCatalogTagNames(value) {
  if (Array.isArray(value)) return value.map((item) => stripCatalogTagNames(item));
  if (!isObject(value)) return cloneJson(value);

  let next = {};
  for (let [key, item] of Object.entries(value)) {
    if (key === 'tagName') continue;
    next[key] = stripCatalogTagNames(item);
  }
  return next;
}

export function hasCatalogTagName(value) {
  if (Array.isArray(value)) return value.some((item) => hasCatalogTagName(item));
  if (!isObject(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'tagName')) return true;
  return Object.values(value).some((item) => hasCatalogTagName(item));
}

export function assertNoCatalogTagName(value, label = 'CatalogEntry') {
  if (!hasCatalogTagName(value)) return;
  throw new Error(`${label} must not expose tagName; use module ids for catalog references.`);
}

function requireModuleId(id) {
  if (typeof id !== 'string' || !MODULE_ID_PATTERN.test(id)) {
    throw new Error(`Catalog entry id "${id}" must be a module id in namespace:local-name form.`);
  }
  return id;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string' && item.trim()))]
    .sort((a, b) => a.localeCompare(b));
}

export function createContributesSummary(descriptor = {}, overrides = {}) {
  let summary = {
    title: descriptor.title,
    description: descriptor.description,
    provider: descriptor.provider,
    capabilities: normalizeStringArray(descriptor.capabilities),
    actions: descriptor.actions,
    settings: descriptor.settings,
    state: descriptor.state,
    events: descriptor.events,
    bindings: descriptor.bindings,
    slots: descriptor.slots,
    runtimeSlots: descriptor.runtimeSlots,
    streams: descriptor.streams,
    hostServices: descriptor.hostServices,
    lifecycle: descriptor.lifecycle,
    placement: descriptor.placement,
    webmcp: descriptor.webmcp,
    suggests: descriptor.suggests,
    suggestions: descriptor.suggestions,
    source: descriptor.source,
    ...overrides,
  };

  for (let key of Object.keys(summary)) {
    if (summary[key] === undefined) delete summary[key];
  }
  return stripCatalogTagNames(summary);
}

function normalizeContributes(contributes) {
  if (!isObject(contributes)) return { summary: {} };
  let summary = contributes.summary !== undefined ? contributes.summary : contributes;
  return { summary: stripCatalogTagNames(summary) };
}

export function createCatalogEntry(input) {
  if (!isObject(input)) {
    throw new Error('CatalogEntry requires an object input.');
  }

  let entry = {
    origin: typeof input.origin === 'string' && input.origin ? input.origin : 'config',
    kind: typeof input.kind === 'string' && input.kind ? input.kind : 'workspace.module',
    id: requireModuleId(input.id),
    installed: input.installed !== false,
    contributes: normalizeContributes(input.contributes),
  };

  if (input.version !== undefined) entry.version = String(input.version);
  if (input.integrity !== undefined) entry.integrity = String(input.integrity);
  if (input.registry !== undefined) entry.registry = String(input.registry);
  if (input.listingId !== undefined) entry.listingId = String(input.listingId);
  if (input.sourceId !== undefined) entry.sourceId = String(input.sourceId);
  if (input.devOnly === true || entry.origin === 'dev') entry.devOnly = true;

  assertNoCatalogTagName(entry);
  return Object.freeze(entry);
}

export function catalogEntryReference(entry) {
  return { moduleId: requireModuleId(entry?.id) };
}

export function assertCatalogEntryPlaceable(entry) {
  if (!isObject(entry)) {
    throw new Error('Cannot place a missing catalog entry.');
  }
  if (entry.installed !== false) return entry;

  let error = new Error(
    `Catalog entry "${entry.id}" is not installed; route through the install transaction before placement.`,
  );
  error.code = 'catalog-install-required';
  error.route = 'install';
  error.entry = catalogEntryReference(entry);
  throw error;
}
