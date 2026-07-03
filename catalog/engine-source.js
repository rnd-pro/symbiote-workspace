/**
 * Adapter for a host-provided symbiote-engine catalog surface.
 *
 * This module intentionally does not import symbiote-engine. Hosts pass the
 * S2.6a surface object in; node types and packs are projected to CatalogEntry.
 *
 * @module symbiote-workspace/catalog/engine-source
 */

import { MODULE_ID_PATTERN } from '../schema/constants.js';
import {
  cloneJson,
  createCatalogEntry,
  createContributesSummary,
} from './entry.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toLocalName(value) {
  let local = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return local || 'entry';
}

function moduleId(value, fallbackNamespace = 'engine') {
  if (typeof value === 'string' && MODULE_ID_PATTERN.test(value)) return value;
  return `${fallbackNamespace}:${toLocalName(value)}`;
}

async function callList(surface, name) {
  if (typeof surface?.[name] !== 'function') return [];
  let result = await surface[name]();
  return Array.isArray(result) ? result : [];
}

async function collectRecords(surface) {
  if (typeof surface?.listCatalogEntries === 'function') {
    let result = await surface.listCatalogEntries();
    return Array.isArray(result) ? result : [];
  }

  let nodeTypes = [
    ...(Array.isArray(surface?.nodeTypes) ? surface.nodeTypes : []),
    ...(Array.isArray(surface?.drivers) ? surface.drivers : []),
    ...await callList(surface, 'listNodeTypes'),
    ...await callList(surface, 'listDrivers'),
  ];
  let packs = [
    ...(Array.isArray(surface?.packs) ? surface.packs : []),
    ...await callList(surface, 'listPacks'),
  ];

  return [
    ...nodeTypes.map((record) => ({ ...record, catalogKind: 'engine.node' })),
    ...packs.map((record) => ({ ...record, catalogKind: 'engine.pack' })),
  ];
}

function normalizeRecord(record, options = {}) {
  let kind = record.catalogKind || record.kind || 'engine.node';
  let rawId = record.moduleId || record.id || record.type || record.nodeType || record.name;
  let id = moduleId(rawId, options.namespace || 'engine');
  let contract = record.contract || record.descriptor || record.moduleDescriptor || null;
  let source = {
    kind: 'engine',
    pack: record.pack || record.packId,
    nodeType: record.type || record.nodeType || record.name,
  };
  let summary = createContributesSummary(contract || record, {
    source,
    capabilities: record.capabilities || contract?.capabilities || [],
    suggests: record.suggests || contract?.suggests,
  });

  let entry = createCatalogEntry({
    origin: 'engine',
    kind,
    id,
    installed: record.installed !== false,
    version: record.version,
    integrity: record.integrity,
    sourceId: options.sourceId || 'engine',
    contributes: { summary },
  });
  return { entry, contract: cloneJson(contract), full: cloneJson(record) };
}

export function createEngineCatalogSource(surface = {}, options = {}) {
  let sourceId = options.id || 'engine';

  return Object.freeze({
    sourceId,
    async list() {
      let records = await collectRecords(surface);
      return records.map((record) => normalizeRecord(record, { ...options, sourceId }).entry);
    },
    async describe(id, options = {}) {
      let records = await collectRecords(surface);
      for (let record of records) {
        let normalized = normalizeRecord(record, { sourceId });
        if (normalized.entry.id !== id) continue;
        if (options.depth === 'full') {
          return { ...normalized.entry, contract: cloneJson(normalized.contract), full: cloneJson(normalized.full) };
        }
        if (options.depth === 'contract') return { ...normalized.entry, contract: cloneJson(normalized.contract) };
        return normalized.entry;
      }
      return null;
    },
  });
}

export function createEngineCatalogEntries(surface = {}, options = {}) {
  return collectRecords(surface).then((records) => records.map((record) => (
    normalizeRecord(record, { ...options, sourceId: options.id || 'engine' }).entry
  )));
}

export const isEngineCatalogRecord = isObject;
