/**
 * RegistryCatalogSource contract.
 *
 * Network fetch/search is intentionally deferred. This adapter accepts already
 * advertised listing records and makes them searchable/describable pre-install.
 *
 * @module symbiote-workspace/catalog/registry-source
 */

import {
  cloneJson,
  createCatalogEntry,
  createContributesSummary,
} from './entry.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function listingModules(listing) {
  if (Array.isArray(listing?.contributes?.modules)) return listing.contributes.modules;
  if (Array.isArray(listing?.modules)) return listing.modules;
  if (isObject(listing?.module)) return [listing.module];
  if (typeof listing?.moduleId === 'string') {
    return [{ id: listing.moduleId, ...(isObject(listing.contributes?.summary) ? listing.contributes.summary : {}) }];
  }
  return [];
}

function normalizeListing(listing, options = {}) {
  let registry = listing.registry || options.registry;
  let listingId = listing.listingId || listing.id;
  return listingModules(listing).map((module) => {
    let summary = createContributesSummary(module, {
      registry,
      listingId,
      capabilities: module.capabilities || listing.capabilities || [],
    });
    let entry = createCatalogEntry({
      origin: 'registry',
      kind: module.kind || listing.kind || 'workspace.module',
      id: module.id,
      installed: false,
      version: module.version || listing.version,
      integrity: module.integrity || listing.integrity,
      registry,
      listingId,
      sourceId: options.sourceId || `registry:${registry || 'default'}`,
      contributes: { summary },
    });
    return { entry, contract: cloneJson(module), full: cloneJson(listing) };
  });
}

export function createRegistryCatalogSource(options = {}) {
  let registry = options.registry || 'default';
  let sourceId = options.id || `registry:${registry}`;
  let listings = Array.isArray(options.listings) ? options.listings : [];
  let records = listings.flatMap((listing) => normalizeListing(listing, { registry, sourceId }));
  let byId = new Map(records.map((record) => [record.entry.id, record]));

  return Object.freeze({
    sourceId,
    registry,
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

export function createRegistryCatalogEntries(options = {}) {
  let listings = Array.isArray(options.listings) ? options.listings : [];
  return listings
    .flatMap((listing) => normalizeListing(listing, {
      registry: options.registry || listing.registry || 'default',
      sourceId: options.id || `registry:${options.registry || listing.registry || 'default'}`,
    }))
    .map((record) => record.entry);
}
