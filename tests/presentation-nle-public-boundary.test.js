import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_NLE_ENTRIES = [
  resolve(ROOT, 'runtime/presentation/nle-projection.js'),
  resolve(ROOT, 'runtime/presentation/nle-timeline-editor.js'),
];

async function collectRelativeModuleGraph(entries) {
  let pending = [...entries];
  let modules = new Map();
  while (pending.length) {
    let file = pending.pop();
    if (modules.has(file)) continue;
    let source = await readFile(file, 'utf8');
    modules.set(file, source);
    let specifiers = [
      ...source.matchAll(/\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/gu),
    ].map((match) => match[1]);
    for (let specifier of specifiers) {
      pending.push(resolve(dirname(file), specifier));
    }
  }
  return modules;
}

describe('public presentation NLE dependency boundary', () => {
  it('keeps local authoring tool identifiers out of the pure projection graph', async () => {
    let modules = await collectRelativeModuleGraph(PUBLIC_NLE_ENTRIES);
    let commandModule = resolve(ROOT, 'runtime/presentation/commands.js');

    assert.equal(
      modules.has(commandModule),
      false,
      'pure NLE projection must not reach the local authoring command descriptor module',
    );
    for (let [file, source] of modules) {
      assert.doesNotMatch(
        source,
        /presentation_authoring_/u,
        `${file} exposes a local authoring tool identifier to browser consumers`,
      );
    }
  });
});
