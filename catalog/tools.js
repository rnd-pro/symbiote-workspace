/**
 * Dispatch-registerable catalog tool family.
 *
 * Registration into runtime/dispatch.js is an integration step owned outside
 * this slice; this file only exports the family shape and handlers.
 *
 * @module symbiote-workspace/catalog/tools
 */

function resolveCatalog(catalog, context = {}) {
  let target = typeof catalog === 'function' ? catalog(context) : (catalog || context.catalog);
  if (!target) throw new Error('Catalog tools require a catalog instance.');
  return target;
}

export const catalogTools = Object.freeze([
  {
    name: 'catalog_search',
    description: 'Search the live workspace catalog by text, capabilities, kind, and fingerprint.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'string' } },
        kinds: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['production', 'scratch'] },
        limit: { type: 'integer' },
        knownFingerprint: { type: 'string' },
      },
    },
  },
  {
    name: 'catalog_describe',
    description: 'Describe catalog entries by module id at summary, contract, or full depth.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        depth: { type: 'string', enum: ['summary', 'contract', 'full'] },
      },
      required: ['ids'],
    },
  },
  {
    name: 'catalog_proof',
    description: 'Create a catalogProof record for an inline free-creation gap search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'string' } },
        kinds: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer' },
      },
    },
  },
]);

export function createCatalogToolHandlers(catalog) {
  return {
    async catalog_search(args = {}, context = {}) {
      return resolveCatalog(catalog, context).search(args);
    },
    async catalog_describe(args = {}, context = {}) {
      return resolveCatalog(catalog, context).describe(args);
    },
    async catalog_proof(args = {}, context = {}) {
      return resolveCatalog(catalog, context).proof(args);
    },
  };
}

export function createCatalogToolFamily(catalog) {
  return {
    name: 'catalog',
    tools: catalogTools,
    handlers: createCatalogToolHandlers(catalog),
  };
}
