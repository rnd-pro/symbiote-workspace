import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

let exec = promisify(execFile);
let ROOT_URL = new URL('..', import.meta.url);
let ROOT = fileURLToPath(ROOT_URL);
let PACKAGE_META = JSON.parse(readFileSync(new URL('package.json', ROOT_URL), 'utf8'));

async function runPreflight(args = []) {
  return exec('node', ['scripts/release-preflight.js', ...args], {
    cwd: ROOT,
    maxBuffer: 1024 * 1024 * 8,
  });
}

describe('release preflight', () => {
  it('supports current prerelease metadata checks without running expensive gates', async () => {
    let { stdout } = await runPreflight([
      '--target-version',
      PACKAGE_META.version,
      '--skip-npm-ci',
      '--skip-tests',
      '--skip-package-consumer',
      '--skip-pack',
      '--skip-browser',
      '--skip-git-clean',
    ]);

    assert.match(stdout, /workflow_kanban registry check/);
    assert.match(stdout, /Release preflight passed/);
  });

  it('keeps the default stable gate closed until package metadata is released', async () => {
    await assert.rejects(
      runPreflight([
        '--skip-npm-ci',
        '--skip-tests',
        '--skip-package-consumer',
        '--skip-pack',
        '--skip-browser',
        '--skip-git-clean',
      ]),
      (error) => {
        assert.match(error.stderr, /package\.json version is .* expected 1\.0\.0/);
        assert.match(error.stderr, /CHANGELOG\.md is missing a dated 1\.0\.0 release heading/);
        return true;
      },
    );
  });
});
