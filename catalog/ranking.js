/**
 * Deterministic catalog ranking.
 *
 * @module symbiote-workspace/catalog/ranking
 */

import { CAPABILITY_FAMILIES } from '../schema/constants.js';

export const CATALOG_CAPABILITY_VOCABULARY = Object.freeze(
  [...new Set(Object.values(CAPABILITY_FAMILIES).flat())].sort((a, b) => a.localeCompare(b)),
);

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim());
}

function uniqueSorted(value) {
  return [...new Set(value)].sort((a, b) => a.localeCompare(b));
}

export function capabilityTokens(capability) {
  return String(capability || '')
    .split(/[.:/_-]+/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function capabilityOverlap(requiredCapability, moduleCapabilities = []) {
  let requiredTokens = new Set(capabilityTokens(requiredCapability));
  let exact = [];
  let related = [];

  for (let capability of moduleCapabilities) {
    if (capability === requiredCapability) {
      exact.push(capability);
      continue;
    }
    let tokens = capabilityTokens(capability);
    if (tokens.some((token) => requiredTokens.has(token))) {
      related.push(capability);
    }
  }

  return {
    exact: uniqueSorted(exact),
    related: uniqueSorted(related),
  };
}

function moduleIdFor(item) {
  return item.id || item.moduleId || item.value || item.panelType;
}

function titleFor(item) {
  return item.contributes?.summary?.title || item.title || item.label || null;
}

function capabilitiesFor(item) {
  return stringList(item.contributes?.summary?.capabilities || item.capabilities);
}

export function capabilityCandidate(module, requiredCapability) {
  let capabilities = capabilitiesFor(module);
  let overlap = capabilityOverlap(requiredCapability, capabilities);
  let score = (overlap.exact.length * 100) + (overlap.related.length * 10);
  let moduleId = moduleIdFor(module);

  if (score === 0 || !moduleId) return null;

  return {
    moduleId,
    title: titleFor(module),
    score,
    matchedCapabilities: overlap.exact,
    relatedCapabilities: overlap.related.slice(0, 5),
  };
}

export function rankCapabilityCandidates(requiredCapability, modules, selectedModuleIds = new Set(), options = {}) {
  let limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 5;
  let selected = selectedModuleIds instanceof Set ? selectedModuleIds : new Set(selectedModuleIds || []);

  return modules
    .map((module) => capabilityCandidate(module, requiredCapability))
    .filter(Boolean)
    .filter((candidate) => !selected.has(candidate.moduleId))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.moduleId.localeCompare(b.moduleId);
    })
    .slice(0, limit);
}

function searchTokens(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function searchableText(entry) {
  let summary = entry.contributes?.summary || {};
  return [
    entry.id,
    entry.kind,
    entry.origin,
    summary.title,
    summary.description,
    ...stringList(summary.capabilities),
  ]
    .filter((item) => typeof item === 'string' && item.trim())
    .join(' ')
    .toLowerCase();
}

function normalizeQuery(query = {}) {
  if (typeof query === 'string') return { query };
  if (Array.isArray(query)) return { capabilities: query };
  return query && typeof query === 'object' ? query : {};
}

export function rankCatalogEntries(queryInput, entries, options = {}) {
  let query = normalizeQuery(queryInput);
  let requiredCapabilities = uniqueSorted([
    ...stringList(query.capabilities),
    ...stringList(query.requiredCapabilities),
  ]);
  let terms = searchTokens(query.query || query.text);
  let kinds = new Set(stringList(query.kinds));
  let limit = Number.isInteger(query.limit) && query.limit > 0
    ? query.limit
    : (Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 20);

  return entries
    .filter((entry) => kinds.size === 0 || kinds.has(entry.kind))
    .map((entry) => {
      let matchedCapabilities = [];
      let relatedCapabilities = [];
      let score = 0;

      for (let capability of requiredCapabilities) {
        let overlap = capabilityOverlap(capability, capabilitiesFor(entry));
        score += (overlap.exact.length * 100) + (overlap.related.length * 10);
        matchedCapabilities.push(...overlap.exact);
        relatedCapabilities.push(...overlap.related);
      }

      let haystack = searchableText(entry);
      let matchedTerms = terms.filter((term) => haystack.includes(term));
      score += matchedTerms.length * 5;

      if (requiredCapabilities.length === 0 && terms.length === 0 && kinds.size === 0) {
        score = 1;
      }
      if (score === 0) return null;

      return {
        ...entry,
        score,
        matchedCapabilities: uniqueSorted(matchedCapabilities),
        relatedCapabilities: uniqueSorted(relatedCapabilities).slice(0, 5),
        matchedTerms: uniqueSorted(matchedTerms),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}
