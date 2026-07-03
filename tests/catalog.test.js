import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  catalogSuggestions,
  createCatalog,
  createCatalogToolFamily,
  hasCatalogTagName,
} from '../catalog/index.js';

function moduleDescriptor(overrides = {}) {
  return {
    id: 'acme:data-table',
    source: { kind: 'package', package: 'acme', export: 'DataTable' },
    tagName: 'acme-data-table',
    title: 'Data Table',
    description: 'Tabular project data.',
    capabilities: ['data.table'],
    hostServices: { required: ['storage.project'], optional: [] },
    lifecycle: { readiness: 'auto' },
    ...overrides,
  };
}

function catalogConfig(modules) {
  return {
    version: '1.0.0',
    name: 'Catalog Test',
    requires: {
      packages: [{ id: 'acme', version: '1.2.3' }],
      hostServices: { required: ['storage.project'], optional: [] },
    },
    modules,
  };
}

describe('CatalogEntry shape', () => {
  it('search entries never expose tagName and are referenced by module id', async () => {
    let catalog = createCatalog({
      config: catalogConfig([moduleDescriptor()]),
    });

    let result = await catalog.search({ capabilities: ['data.table'] });

    assert.equal(result.status, 'ok');
    assert.equal(result.hits[0].id, 'acme:data-table');
    assert.equal(hasCatalogTagName(result.hits[0]), false);
    assert.deepEqual(result.hits[0].contributes.summary.capabilities, ['data.table']);

    let described = await catalog.describe({ ids: ['acme:data-table'], depth: 'summary' });
    assert.equal(hasCatalogTagName(described.entries[0]), false);
  });
});

describe('registry-origin catalog entries', () => {
  it('participate in search and proof, but route placement through install', async () => {
    let catalog = createCatalog({
      registry: 'market',
      registryListings: [{
        id: 'listing-timeline',
        version: '2.0.0',
        integrity: 'sha256-abc',
        contributes: {
          modules: [
            moduleDescriptor({
              id: 'market:timeline',
              tagName: 'market-timeline',
              title: 'Timeline',
              capabilities: ['video.timeline'],
            }),
          ],
        },
      }],
    });

    let result = await catalog.search({ capabilities: ['video.timeline'] });
    assert.equal(result.hits[0].origin, 'registry');
    assert.equal(result.hits[0].installed, false);

    let described = await catalog.describe({ ids: ['market:timeline'], depth: 'contract' });
    assert.equal(described.entries[0].installed, false);
    assert.equal(described.entries[0].contract.tagName, 'market-timeline');
    assert.equal(described.entries[0].contract.id, 'market:timeline');

    let proof = await catalog.proof({ capabilities: ['video.timeline'] });
    assert.equal(proof.hits[0].origin, 'registry');
    await assert.rejects(() => catalog.requireProof(proof), { code: 'catalog-prior-art' });
    await assert.rejects(() => catalog.assertPlaceable('market:timeline'), {
      code: 'catalog-install-required',
      route: 'install',
    });
  });
});

describe('dev-only catalog entries', () => {
  it('are hidden from production ranking and proof but visible in scratch mode', async () => {
    let catalog = createCatalog({
      devEntries: [
        moduleDescriptor({
          id: 'dev:prototype-chart',
          tagName: 'dev-prototype-chart',
          title: 'Prototype Chart',
          capabilities: ['chart.prototype'],
        }),
      ],
    });

    let production = await catalog.search({ capabilities: ['chart.prototype'] });
    assert.deepEqual(production.hits, []);

    let scratch = await catalog.search({ capabilities: ['chart.prototype'], mode: 'scratch' });
    assert.equal(scratch.hits[0].id, 'dev:prototype-chart');
    assert.equal(scratch.hits[0].devOnly, true);

    let proof = await catalog.proof({ capabilities: ['chart.prototype'], mode: 'scratch' });
    assert.deepEqual(proof.hits, []);
    assert.deepEqual(await catalog.requireProof(proof), { ok: true, fingerprint: proof.fingerprint });
  });
});

describe('catalog fingerprint and proof gate', () => {
  it('computes deterministic fingerprints and honors knownFingerprint etags', async () => {
    let first = createCatalog({
      entries: [
        moduleDescriptor({ id: 'acme:b', tagName: 'acme-b', capabilities: ['same.capability'] }),
        moduleDescriptor({ id: 'acme:a', tagName: 'acme-a', capabilities: ['same.capability'] }),
      ],
    });
    let second = createCatalog({
      entries: [
        moduleDescriptor({ id: 'acme:a', tagName: 'acme-a', capabilities: ['same.capability'] }),
        moduleDescriptor({ id: 'acme:b', tagName: 'acme-b', capabilities: ['same.capability'] }),
      ],
    });

    let firstFingerprint = await first.fingerprint();
    let secondFingerprint = await second.fingerprint();

    assert.equal(firstFingerprint.fingerprint, secondFingerprint.fingerprint);
    assert.match(firstFingerprint.fingerprint, /^sha256-[a-f0-9]{64}$/);

    let unchanged = await first.search({
      capabilities: ['same.capability'],
      knownFingerprint: firstFingerprint.fingerprint,
    });
    assert.deepEqual(unchanged, {
      status: 'ok',
      fingerprint: firstFingerprint.fingerprint,
      unchanged: true,
    });
  });

  it('requires a current proof record before inline free-creation', async () => {
    let empty = createCatalog();
    let proof = await empty.proof({ capabilities: ['missing.capability'] });

    await assert.rejects(() => empty.requireProof(null), { code: 'catalog-proof-required' });
    assert.deepEqual(await empty.requireProof(proof), { ok: true, fingerprint: proof.fingerprint });

    let changed = createCatalog({
      entries: [
        moduleDescriptor({
          id: 'acme:missing-capability',
          tagName: 'acme-missing-capability',
          capabilities: ['missing.capability'],
        }),
      ],
    });
    await assert.rejects(() => changed.requireProof(proof), { code: 'catalog-proof-stale' });
  });
});

describe('catalog ranking and suggestions', () => {
  it('ranks deterministically by score descending and then module id', async () => {
    let catalog = createCatalog({
      entries: [
        moduleDescriptor({ id: 'acme:z', tagName: 'acme-z', capabilities: ['review.queue'] }),
        moduleDescriptor({ id: 'acme:a', tagName: 'acme-a', capabilities: ['review.queue'] }),
        moduleDescriptor({ id: 'acme:m', tagName: 'acme-m', capabilities: ['review.detail'] }),
      ],
    });

    let result = await catalog.search({ capabilities: ['review.queue'] });

    assert.deepEqual(result.hits.map((hit) => hit.id), ['acme:a', 'acme:z', 'acme:m']);
    assert.ok(result.hits[0].score > result.hits[2].score);
  });

  it('stamps descriptor suggestions with suggestedBy moduleId@version', async () => {
    let catalog = createCatalog({
      entries: [
        {
          id: 'acme:assistant',
          version: '3.4.5',
          contributes: {
            summary: {
              title: 'Assistant',
              capabilities: ['agent.assist'],
              suggests: {
                wires: [{ from: 'module:acme:assistant#event:reply', to: 'module:acme:log#action:add' }],
              },
            },
          },
        },
      ],
    });

    let suggestions = await catalogSuggestions({ requiredCapabilities: ['agent.assist'] }, catalog);

    assert.equal(suggestions[0].moduleId, 'acme:assistant');
    assert.equal(suggestions[0].suggestedBy, 'acme:assistant@3.4.5');
    assert.equal(suggestions[0].suggestions.wires[0].suggestedBy, 'acme:assistant@3.4.5');
  });
});

describe('engine source and tool handlers', () => {
  it('projects host-provided engine node and pack listings without engine imports', async () => {
    let catalog = createCatalog({
      engineSurface: {
        nodeTypes: [{
          id: 'engine:clip-loader',
          title: 'Clip Loader',
          capabilities: ['video.clip.load'],
        }],
        packs: [{
          id: 'engine:video-pack',
          title: 'Video Pack',
          capabilities: ['video.pack'],
        }],
      },
    });

    let result = await catalog.search({ capabilities: ['video.clip.load'] });
    assert.equal(result.hits[0].kind, 'engine.node');
    assert.equal(result.hits[0].origin, 'engine');
  });

  it('exports dispatch-registerable catalog_* tool handlers', async () => {
    let catalog = createCatalog({
      entries: [
        moduleDescriptor({ id: 'acme:tool-entry', tagName: 'acme-tool-entry', capabilities: ['tool.test'] }),
      ],
    });
    let family = createCatalogToolFamily(catalog);

    assert.deepEqual(family.tools.map((tool) => tool.name), [
      'catalog_search',
      'catalog_describe',
      'catalog_proof',
    ]);

    let result = await family.handlers.catalog_search({ capabilities: ['tool.test'] });
    assert.equal(result.hits[0].id, 'acme:tool-entry');
  });
});
