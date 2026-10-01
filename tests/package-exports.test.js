import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// The wildcards `./schema/*` and `./runtime/*` once exposed roughly 3600 internal
// files as a consumer contract, of which three were ever imported. That is the
// cost being removed: a file can now be renamed or moved without a major
// version, because nothing outside the package was ever addressable by path.

function runInConsumer(source) {
  const dir = mkdtempSync(join(tmpdir(), 'sw-exports-'));
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  // A link exercises the same `exports` resolution a real install does, without
  // packing and installing the tree for every case.
  symlinkSync(ROOT, join(dir, 'node_modules', 'symbiote-workspace'), 'dir');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module' }));
  writeFileSync(join(dir, 'check.mjs'), source);
  return () => execFileSync(process.execPath, [join(dir, 'check.mjs')], { cwd: dir, encoding: 'utf8' });
}

describe('package entry points', () => {
  it('declares no wildcard, so the internal layout is not a public contract', () => {
    const wildcards = Object.keys(PKG.exports).filter((key) => key.includes('*'));

    assert.deepEqual(wildcards, [], `wildcard entry points remain: ${wildcards.join(', ')}`);
  });

  it('declares every deep path a consumer actually imports', () => {
    // Each of these was reachable only through a wildcard. If one goes missing
    // a consumer breaks on upgrade, so they are named explicitly.
    // Every path any consumer in this workspace imports. An early count of
    // these said three and was wrong — the wildcards had been hiding the rest,
    // which is exactly the failure mode this change exists to end.
    const required = [
      './runtime/composition-commit-point.js',
      './runtime/composition-registry.js',
      './runtime/portable-value.js',
      './runtime/presentation.js',
      './runtime/workspace-state.js',
      './schema/canonical-json.js',
      './schema/composition-descriptor.js',
      './schema/constants.js',
      './schema/module-capability.js',
      './schema/workspace-schema.js',
    ];

    for (const key of required) {
      assert.ok(PKG.exports[key], `missing explicit entry: ${key}`);
      // Asserted as a raw target, not through path.join: join normalises away a
      // missing "./", so a target the resolver would reject still looks fine.
      assert.ok(
        PKG.exports[key].startsWith('./'),
        `entry target must be a valid relative specifier: ${key} -> ${PKG.exports[key]}`,
      );
      assert.ok(existsSync(join(ROOT, PKG.exports[key])), `entry points at nothing: ${key}`);
    }
  });

  it('leaves an existing internal file unreachable, which is the whole point', () => {
    // This file exists and exports what a consumer might want. Nothing outside
    // the package can name it any more, so it can be moved without a major.
    const undeclared = './schema/ownership.js';
    assert.ok(existsSync(join(ROOT, undeclared.slice(2))), 'the file exists but is undeclared');
    assert.equal(PKG.exports[undeclared], undefined, 'an undeclared file must not be importable');

    const rejection = runInConsumer(
      `import('symbiote-workspace/schema/ownership.js').then(() => { throw new Error('undeclared path resolved'); }, (err) => console.log(err.code));`,
    );
    assert.match(rejection(), /ERR_PACKAGE_PATH_NOT_EXPORTED/);
  });
});
