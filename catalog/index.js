/**
 * symbiote-workspace catalog subsystem.
 *
 * @module symbiote-workspace/catalog
 */

import {
  assertCatalogEntryPlaceable,
  cloneJson,
} from './entry.js';
import { catalogFingerprint } from './fingerprint.js';
import { rankCatalogEntries } from './ranking.js';
import {
  collectCatalogEntries,
  createConfigCatalogSource,
  createDevCatalogSource,
  createStaticCatalogSource,
  dedupeCatalogEntries,
  describeFromSources,
  filterCatalogEntries,
} from './source.js';
import { createEngineCatalogSource } from './engine-source.js';
import { createRegistryCatalogSource } from './registry-source.js';
import {
  assertCurrentCatalogProof,
  catalogProof,
} from './proof.js';

export * from './entry.js';
export * from './source.js';
export * from './engine-source.js';
export * from './registry-source.js';
export * from './ranking.js';
export * from './fingerprint.js';
export * from './proof.js';
export * from './tools.js';

function normalizeSearchArgs(input = {}, options = {}) {
  if (typeof input === 'string') return { ...options, query: input };
  if (Array.isArray(input)) return { ...options, capabilities: input };
  return { ...options, ...(input || {}) };
}

function normalizeDescribeArgs(input = {}, options = {}) {
  if (Array.isArray(input)) return { ...options, ids: input };
  if (typeof input === 'string') return { ...options, ids: [input] };
  return { ...options, ...(input || {}) };
}

function normalizeSources(options) {
  let sources = [...(Array.isArray(options.sources) ? options.sources : [])];
  if (options.config) sources.push(createConfigCatalogSource(options.config));
  if (Array.isArray(options.entries)) {
    sources.push(createStaticCatalogSource({ id: 'entries', entries: options.entries }));
  }
  if (Array.isArray(options.devEntries)) {
    sources.push(createDevCatalogSource(options.devEntries));
  }
  if (options.engineSurface || options.engineSource) {
    sources.push(createEngineCatalogSource(options.engineSurface || options.engineSource));
  }
  if (Array.isArray(options.registryListings)) {
    sources.push(createRegistryCatalogSource({
      registry: options.registry || 'default',
      listings: options.registryListings,
    }));
  }
  return sources;
}

function sourceFingerprintMode(options = {}) {
  return {
    mode: options.mode || 'production',
    proof: options.proof === true,
  };
}

function suggestionStamp(entry) {
  return `${entry.id}@${entry.version || '0.0.0'}`;
}

function stampSuggestionValue(value, suggestedBy) {
  if (Array.isArray(value)) return value.map((item) => stampSuggestionValue(item, suggestedBy));
  if (value && typeof value === 'object') {
    return { ...cloneJson(value), suggestedBy };
  }
  return value;
}

function stampSuggestions(suggestions, suggestedBy) {
  if (!suggestions || typeof suggestions !== 'object') return {};
  let stamped = {};
  for (let [key, value] of Object.entries(suggestions)) {
    stamped[key] = stampSuggestionValue(value, suggestedBy);
  }
  return stamped;
}

export function createCatalog(options = {}) {
  let sources = normalizeSources(options);

  let catalog = {
    sources,
    async entries(entryOptions = {}) {
      let listed = await collectCatalogEntries(sources, entryOptions);
      return dedupeCatalogEntries(filterCatalogEntries(listed, entryOptions));
    },
    async fingerprint(fingerprintOptions = {}) {
      let entries = await catalog.entries(sourceFingerprintMode(fingerprintOptions));
      return catalogFingerprint(entries, fingerprintOptions);
    },
    async search(input = {}, searchOptions = {}) {
      let args = normalizeSearchArgs(input, searchOptions);
      let entries = await catalog.entries({
        mode: args.mode || 'production',
        proof: args.proof === true,
      });
      let fingerprint = catalogFingerprint(entries, { knownFingerprint: args.knownFingerprint });
      if (fingerprint.unchanged) {
        return { status: 'ok', fingerprint: fingerprint.fingerprint, unchanged: true };
      }
      let hits = rankCatalogEntries(args, entries, { limit: args.limit });
      return {
        status: 'ok',
        fingerprint: fingerprint.fingerprint,
        unchanged: false,
        hits,
        count: hits.length,
      };
    },
    async describe(input = {}, describeOptions = {}) {
      let args = normalizeDescribeArgs(input, describeOptions);
      let ids = Array.isArray(args.ids) ? args.ids : [];
      let depth = args.depth || 'summary';
      let entries = [];
      let missing = [];

      for (let id of ids) {
        let described = await describeFromSources(sources, id, { depth });
        if (described) entries.push(described);
        else missing.push(id);
      }

      return {
        status: missing.length > 0 ? 'partial' : 'ok',
        depth,
        entries,
        missing,
      };
    },
    async proof(input = {}, proofOptions = {}) {
      return catalogProof(input, catalog, proofOptions);
    },
    async catalogProof(input = {}, proofOptions = {}) {
      return catalogProof(input, catalog, proofOptions);
    },
    async requireProof(proof) {
      return assertCurrentCatalogProof(proof, catalog);
    },
    async assertPlaceable(input) {
      if (typeof input === 'string') {
        let described = await catalog.describe(input);
        if (!described.entries[0]) throw new Error(`Catalog entry "${input}" was not found.`);
        return assertCatalogEntryPlaceable(described.entries[0]);
      }
      return assertCatalogEntryPlaceable(input);
    },
  };

  return Object.freeze(catalog);
}

export async function catalogSuggestions(intent = {}, catalog, options = {}) {
  if (!catalog || typeof catalog.search !== 'function') {
    throw new Error('catalogSuggestions requires a catalog instance.');
  }
  let requiredCapabilities = Array.isArray(intent.requiredCapabilities)
    ? intent.requiredCapabilities
    : [];
  let selected = new Set(Array.isArray(intent.selectedModuleIds) ? intent.selectedModuleIds : []);
  let result = await catalog.search({
    capabilities: requiredCapabilities,
    mode: options.mode || 'production',
    limit: options.limit || 20,
  });

  return result.hits
    .filter((hit) => !selected.has(hit.id))
    .map((hit) => {
      let suggestedBy = suggestionStamp(hit);
      let summary = hit.contributes?.summary || {};
      return {
        moduleId: hit.id,
        title: summary.title || null,
        score: hit.score,
        matchedCapabilities: hit.matchedCapabilities || [],
        relatedCapabilities: hit.relatedCapabilities || [],
        suggestedBy,
        suggestions: stampSuggestions(summary.suggests || summary.suggestions, suggestedBy),
      };
    });
}
