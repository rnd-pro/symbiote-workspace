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
    for (let match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function resolveLocalModule(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  let file = resolve(dirname(fromFile), specifier);
  if (!file.endsWith('.js')) file = `${file}.js`;
  return file;
}

function collectBrowserGraph(file, seen = new Set(), nodeImports = []) {
  if (seen.has(file)) return nodeImports;
  seen.add(file);

  let source = readFileSync(file, 'utf8');
  for (let specifier of collectStaticSpecifiers(source)) {
    if (specifier.startsWith('node:')) {
      nodeImports.push({ file, specifier });
      continue;
    }
    let local = resolveLocalModule(file, specifier);
    if (local) collectBrowserGraph(local, seen, nodeImports);
  }

  return nodeImports;
}

describe('browser entrypoint', () => {
  it('has no statically reachable Node built-in imports', () => {
    let nodeImports = collectBrowserGraph(resolve(ROOT, 'browser.js'));
    assert.deepEqual(nodeImports, []);
  });

  it('differs from the root entrypoint only by intentional runtime and DOM APIs', async () => {
    let root = await import('../index.js');
    let browser = await import('../browser.js');
    let onlyRoot = Object.keys(root).filter((key) => !(key in browser)).sort();
    let onlyBrowser = Object.keys(browser).filter((key) => !(key in root)).sort();

    assert.deepEqual(onlyRoot, [
      'TOOLS',
      'broadcastDataChange',
      'createSession',
      'dispatch',
      'isMutating',
    ]);
    assert.deepEqual(onlyBrowser, ['applyWorkspaceTheme', 'mountWorkspace', 'subscribeDataChange']);
  });
});
