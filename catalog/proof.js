/**
 * Catalog proof gate.
 *
 * @module symbiote-workspace/catalog/proof
 */

import { cloneJson } from './entry.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function catalogProofError(code, message, extra = {}) {
  let error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

export function createCatalogProofRecord(query, searchResult) {
  if (!isObject(searchResult) || searchResult.unchanged === true || typeof searchResult.fingerprint !== 'string') {
    throw new Error('catalogProof requires a performed catalog_search result with a fingerprint.');
  }
  return Object.freeze({
    kind: 'catalogProof',
    query: cloneJson(query),
    fingerprint: searchResult.fingerprint,
    hits: cloneJson(searchResult.hits || []).map((hit) => ({
      id: hit.id,
      origin: hit.origin,
      installed: hit.installed,
      score: hit.score,
    })),
  });
}

function proofSearchArgs(query, options = {}) {
  let normalized;
  if (typeof query === 'string') normalized = { query };
  else if (Array.isArray(query)) normalized = { capabilities: query };
  else normalized = cloneJson(query || {});
  return {
    ...options,
    ...normalized,
    mode: 'production',
    proof: true,
    knownFingerprint: undefined,
  };
}

export async function catalogProof(query, catalog, options = {}) {
  if (!catalog || typeof catalog.search !== 'function') {
    throw new Error('catalogProof requires a catalog with a search method.');
  }
  let searchResult = await catalog.search(proofSearchArgs(query, options));
  return createCatalogProofRecord(query, searchResult);
}

export async function assertCurrentCatalogProof(proof, catalog) {
  if (!isObject(proof) || proof.kind !== 'catalogProof') {
    throw catalogProofError(
      'catalog-proof-required',
      'Inline free-creation requires a catalogProof from a performed catalog_search.',
    );
  }
  if (proof.query === undefined) {
    throw catalogProofError(
      'catalog-proof-required',
      'catalogProof must name the performed search query.',
    );
  }
  if (!catalog || typeof catalog.fingerprint !== 'function') {
    throw new Error('catalogProof validation requires a catalog with a fingerprint method.');
  }

  let current = await catalog.fingerprint({ mode: 'production', proof: true });
  if (proof.fingerprint !== current.fingerprint) {
    throw catalogProofError(
      'catalog-proof-stale',
      'catalogProof fingerprint is stale; re-run catalog_search before inline free-creation.',
      { currentFingerprint: current.fingerprint, proofFingerprint: proof.fingerprint },
    );
  }
  if (Array.isArray(proof.hits) && proof.hits.length > 0) {
    throw catalogProofError(
      'catalog-prior-art',
      'catalogProof found existing prior art; install or reuse a catalog entry instead of free-creating.',
      { hits: cloneJson(proof.hits) },
    );
  }
  return { ok: true, fingerprint: current.fingerprint };
}

export async function validateCatalogProof(proof, catalog) {
  try {
    let result = await assertCurrentCatalogProof(proof, catalog);
    return result;
  } catch (error) {
    return {
      ok: false,
      code: error.code || 'catalog-proof-error',
      message: error.message,
      currentFingerprint: error.currentFingerprint,
      proofFingerprint: error.proofFingerprint,
      hits: error.hits,
    };
  }
}
