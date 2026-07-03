/**
 * CatalogSource helpers and workspace-config source.
 *
 * @module symbiote-workspace/catalog/source
 */

import {
  cloneJson,
  createCatalogEntry,
  createContributesSummary,
} from './entry.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasDescriptorContract(module) {
  return isObject(module) && typeof module.tagName === 'string' && module.tagName.trim();
}

function packageVersion(config, source) {
  if (!isObject(config) || !isObject(source)) return undefined;
  let list = source.kind === 'plugin' ? config.requires?.plugins : config.requires?.packages;
  let key = source.kind === 'plugin' ? source.plugin : source.package;
  if (!Array.isArray(list) || typeof key !== 'string') return undefined;
  return list.find((item) => item?.id === key)?.version;
}

function normalizeStaticItem(item, defaults = {}) {
  let contract = item.contract || item.descriptor || item.contributes?.contract;
  let summary = item.contributes?.summary || createContributesSummary(contract || item);
  let entry = createCatalogEntry({
    ...defaults,
    ...item,
    contributes: { summary },
  });
  return { entry, contract: contract === undefined ? null : cloneJson(contract), full: cloneJson(item.full || item) };
}

export function createStaticCatalogSource(options = {}) {
  let sourceId = options.id || 'static';
  let records = (options.entries || []).map((item) => normalizeStaticItem(item, {
    origin: options.origin || 'config',
    kind: options.kind,
    installed: options.installed,
    devOnly: options.devOnly,
    sourceId,
  }));
  let byId = new Map(records.map((record) => [record.entry.id, record]));

  return Object.freeze({
    sourceId,
    async list() {
      return records.map((record) => record.entry);
    },
    async describe(id, options = {}) {
      let record = byId.get(id);
      if (!record) return null;
      if (options.depth === 'full') return { ...record.entry, contract: cloneJson(record.contract), full: cloneJson(record.full) };
      if (options.depth === 'contract') return { ...record.entry, contract: cloneJson(record.contract) };
      return record.entry;
    },
  });
}

export function createConfigCatalogSource(config = {}, options = {}) {
  let sourceId = options.id || 'config';
  let modules = Array.isArray(config.modules) ? config.modules : [];
  let records = modules.map((module) => {
    let contract = hasDescriptorContract(module) ? cloneJson(module) : null;
    let summary = createContributesSummary(module, {
      source: module.source,
    });
    let entry = createCatalogEntry({
      origin: 'config',
      kind: 'workspace.module',
      id: module.id,
      installed: true,
      version: module.version || packageVersion(config, module.source),
      integrity: module.integrity || module.source?.integrity,
      sourceId,
      contributes: { summary },
    });
    return { entry, contract, full: cloneJson(module) };
  });
  let byId = new Map(records.map((record) => [record.entry.id, record]));

  return Object.freeze({
    sourceId,
    async list() {
      return records.map((record) => record.entry);
    },
    async describe(id, options = {}) {
      let record = byId.get(id);
      if (!record) return null;
      if (options.depth === 'full') return { ...record.entry, contract: cloneJson(record.contract), full: cloneJson(record.full) };
      if (options.depth === 'contract') return { ...record.entry, contract: cloneJson(record.contract) };
      return record.entry;
    },
  });
}

export function createDevCatalogSource(entries = [], options = {}) {
  return createStaticCatalogSource({
    id: options.id || 'dev',
    origin: 'dev',
    installed: options.installed !== false,
    devOnly: true,
    entries,
  });
}

export async function collectCatalogEntries(sources, options = {}) {
  let entries = [];
  for (let source of sources) {
    if (!source || typeof source.list !== 'function') continue;
    let listed = await source.list(options);
    if (Array.isArray(listed)) entries.push(...listed);
  }
  return entries;
}

export function filterCatalogEntries(entries, options = {}) {
  let mode = options.mode || 'production';
  let proof = options.proof === true;
  return entries.filter((entry) => {
    if (entry.devOnly !== true) return true;
    if (proof) return false;
    return mode === 'scratch';
  });
}

export function dedupeCatalogEntries(entries) {
  let priority = new Map([
    ['config', 0],
    ['engine', 1],
    ['registry', 2],
    ['dev', 3],
  ]);
  let byId = new Map();
  for (let entry of entries) {
    let existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }
    let currentPriority = priority.get(entry.origin) ?? 10;
    let existingPriority = priority.get(existing.origin) ?? 10;
    if (currentPriority < existingPriority) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function describeFromSources(sources, id, options = {}) {
  for (let source of sources) {
    if (source && typeof source.describe === 'function') {
      let described = await source.describe(id, options);
      if (described) return described;
    }
  }
  return null;
}
