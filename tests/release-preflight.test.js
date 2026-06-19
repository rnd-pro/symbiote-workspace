import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

let exec = promisify(execFile);
let ROOT_URL = new URL('..', import.meta.url);
let ROOT = fileURLToPath(ROOT_URL);
let PACKAGE_META = JSON.parse(readFileSync(new URL('package.json', ROOT_URL), 'utf8'));

async function runPreflight(args = [], options = {}) {
  return exec('node', ['scripts/release-preflight.js', ...args], {
    cwd: ROOT,
    maxBuffer: 1024 * 1024 * 8,
    env: { ...process.env, ...options.env },
  });
}

function withFakeNpm(script) {
  let dir = mkdtempSync(resolve(os.tmpdir(), 'symbiote-release-preflight-npm-'));
  let bin = resolve(dir, 'npm');
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return {
    env: { PATH: `${dir}:${process.env.PATH}` },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function cheapGateArgs(extra = []) {
  return [
    '--target-version',
    PACKAGE_META.version,
    '--skip-npm-ci',
    '--skip-tests',
    '--skip-package-consumer',
    '--skip-pack',
    '--skip-browser',
    '--skip-git-clean',
    ...extra,
  ];
}

describe('release preflight', () => {
  it('supports current prerelease metadata checks without running expensive gates', async () => {
    let { stdout } = await runPreflight(cheapGateArgs([
      '--skip-npm-auth',
      '--skip-npm-registry',
    ]));

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
        '--skip-npm-auth',
        '--skip-npm-registry',
      ]),
      (error) => {
        assert.match(error.stderr, /package\.json version is .* expected 1\.0\.0/);
        assert.match(error.stderr, /package-lock\.json version is .* expected 1\.0\.0/);
        assert.match(error.stderr, /package-lock\.json root package version is .* expected 1\.0\.0/);
        assert.match(error.stderr, /CHANGELOG\.md is missing a dated 1\.0\.0 release heading/);
        return true;
      },
    );
  });

  it('checks npm identity and registry state without publishing', async () => {
    let fake = withFakeNpm(`#!/bin/sh
if [ "$1" = "whoami" ]; then
  echo release-user
  exit 0
fi
if [ "$1" = "view" ]; then
  echo '{"versions":["0.3.0-alpha.1"],"dist-tags":{"next":"0.3.0-alpha.1"}}'
  exit 0
fi
exit 1
`);
    try {
      let { stdout } = await runPreflight(cheapGateArgs(), { env: fake.env });

      assert.match(stdout, /npm identity check/);
      assert.match(stdout, /"npmUser":"release-user"/);
      assert.match(stdout, /npm registry package check/);
      assert.match(stdout, /"targetVersionExists":false/);
      assert.match(stdout, /Release preflight passed/);
    } finally {
      fake.cleanup();
    }
  });

  it('fails when the target version is already published', async () => {
    let fake = withFakeNpm(`#!/bin/sh
if [ "$1" = "whoami" ]; then
  echo release-user
  exit 0
fi
if [ "$1" = "view" ]; then
  echo '{"versions":["${PACKAGE_META.version}"],"dist-tags":{"next":"${PACKAGE_META.version}"}}'
  exit 0
fi
exit 1
`);
    try {
      await assert.rejects(
        runPreflight(cheapGateArgs(), { env: fake.env }),
        (error) => {
          assert.match(error.stderr, new RegExp(`npm registry already contains symbiote-workspace@${PACKAGE_META.version.replaceAll('.', '\\.')}`));
          return true;
        },
      );
    } finally {
      fake.cleanup();
    }
  });

  it('fails npm auth when npm whoami is unavailable', async () => {
    let fake = withFakeNpm(`#!/bin/sh
if [ "$1" = "whoami" ]; then
  echo 'npm error code E401' >&2
  exit 1
fi
if [ "$1" = "view" ]; then
  echo '{"versions":[],"dist-tags":{}}'
  exit 0
fi
exit 1
`);
    try {
      await assert.rejects(
        runPreflight(cheapGateArgs(), { env: fake.env }),
        (error) => {
          assert.match(error.stderr, /npm whoami failed; authenticate before release publication/);
          return true;
        },
      );
    } finally {
      fake.cleanup();
    }
  });

  it('requires explicit first-publication approval for npm registry E404', async () => {
    let fake = withFakeNpm(`#!/bin/sh
if [ "$1" = "whoami" ]; then
  echo release-user
  exit 0
fi
if [ "$1" = "view" ]; then
  echo 'npm error code E404' >&2
  exit 1
fi
exit 1
`);
    try {
      await assert.rejects(
        runPreflight(cheapGateArgs(), { env: fake.env }),
        (error) => {
          assert.match(error.stderr, /npm registry has no package symbiote-workspace/);
          assert.match(error.stderr, /--allow-new-package-name/);
          return true;
        },
      );

      let { stdout } = await runPreflight(cheapGateArgs(['--allow-new-package-name']), {
        env: fake.env,
      });

      assert.match(stdout, /"registered":false/);
      assert.match(stdout, /"firstPublicationAllowed":true/);
      assert.match(stdout, /Release preflight passed/);
    } finally {
      fake.cleanup();
    }
  });
});
