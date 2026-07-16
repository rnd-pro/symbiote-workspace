import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let ROOT = resolve(import.meta.dirname, '..');

function collectStaticSpecifiers(source) {
  let specifiers = [];
  let patterns = [
    /^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/gm,
    /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm,
  ];
  for (let pattern of patterns) {
    for (let match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveLocalModule(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  let file = resolve(dirname(fromFile), specifier);
  if (!file.endsWith('.js')) file = `${file}.js`;
  return file;
}

function collectBrowserGraph(file, seen = new Set(), unsafeImports = []) {
  if (seen.has(file)) return unsafeImports;
  seen.add(file);

  let source = readFileSync(file, 'utf8');
  for (let specifier of collectStaticSpecifiers(source)) {
    if (specifier.startsWith('node:') || specifier === 'symbiote-engine') {
      unsafeImports.push({ file, specifier });
      continue;
    }
    let local = resolveLocalModule(file, specifier);
    if (local) collectBrowserGraph(local, seen, unsafeImports);
  }

  return unsafeImports;
}

describe('browser entrypoint', () => {
  it('has no statically reachable Node-only imports', () => {
    let unsafeImports = collectBrowserGraph(resolve(ROOT, 'browser.js'));
    assert.deepEqual(unsafeImports, []);
  });

  it('imports in Node without requiring DOM globals at module load', async () => {
    let before = globalThis.document;
    let browser = await import('../browser.js');

    assert.equal(globalThis.document, before);
    assert.equal(typeof browser.mountWorkspace, 'function');
    assert.equal(typeof browser.applyWorkspaceTheme, 'function');
    assert.equal(typeof browser.collectWorkspaceInterfaceContext, 'function');
    assert.equal(typeof browser.createWorkspacePresentationTimeline, 'function');
    assert.equal(typeof browser.playWorkspacePresentationTimeline, 'function');
  });

  it('differs from the root entrypoint only by intentional runtime and DOM APIs', async () => {
    let root = await import('../index.js');
    let browser = await import('../browser.js');
    let onlyRoot = Object.keys(root).filter((key) => !(key in browser)).sort();
    let onlyBrowser = Object.keys(browser).filter((key) => !(key in root)).sort();

    assert.deepEqual(onlyRoot, [
      'TOOLS',
      'assertCurrentCatalogProof',
      'broadcastDataChange',
      'catalogProof',
      'catalogSuggestions',
      'catalogTools',
      'createCatalog',
      'createCatalogToolFamily',
      'createConfigCatalogSource',
      'createDevCatalogSource',
      'createEngineCatalogSource',
      'createRegistryCatalogSource',
      'createSession',
      'createStaticCatalogSource',
      'dispatch',
      'isMutating',
      'isMutatingTool',
      'needsConfirm',
      'toolConfirmPolicy',
      'validateCatalogProof',
    ]);
    assert.deepEqual(onlyBrowser, [
      'applyWorkspaceTheme',
      'collectWorkspaceInterfaceContext',
      'mountWorkspace',
      'playWorkspacePresentationTimeline',
      'prepareWorkspacePresentation',
      'subscribeDataChange',
    ]);
  });

  it('keeps mountWorkspace as an explicit DOM contract', async () => {
    let { mountWorkspace } = await import('../browser.js');
    assert.throws(() => mountWorkspace({ version: '1.0.0', name: 'X' }, null), /DOM container/);
  });
});
