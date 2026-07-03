import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { TOOLS } from '../runtime/index.js';

let ROOT = resolve(import.meta.dirname, '..');
let CLI = resolve(ROOT, 'cli.js');

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function parseJson(stdout) {
  return JSON.parse(stdout.trim());
}

async function withTempDir(run) {
  let tmpRoot = resolve(ROOT, 'tmp');
  await mkdir(tmpRoot, { recursive: true });
  let dir = await mkdtemp(join(tmpRoot, 'cli-s2-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('CLI registry projection', () => {
  it('prints live tool commands from TOOLS without legacy command aliases', () => {
    let result = runCli(['--help']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /workspace-describe/);
    assert.match(result.stdout, /construction-scaffold-blank/);
    assert.match(result.stdout, /module-register/);
    assert.match(result.stdout, /workspace\.session\.snapshot\.list/);
    assert.match(result.stdout, /execution-submit/);
    assert.doesNotMatch(result.stdout, /add-group/);

    for (let tool of TOOLS) {
      assert.match(result.stdout, new RegExp(tool.name.replaceAll('_', '-')));
    }
  });

  it('rejects removed legacy commands', () => {
    let result = runCli(['add-group', '--id', 'g1', '--name', 'Group']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command: add-group/);
  });

  it('runs renamed mutating and read-only tools with CLI-derived user actor', async () => {
    await withTempDir(async (dir) => {
      let file = join(dir, 'workspace.json');

      let created = runCli([
        'construction-scaffold-blank',
        '--config', file,
        '--base-revision', '0',
        '--name', 'CLI Workspace',
      ]);
      assert.equal(created.status, 0, created.stderr);
      let createdResult = parseJson(created.stdout);
      assert.equal(createdResult.status, 'ok');
      assert.equal(createdResult.origin.actor, 'user-direct');

      let described = runCli(['workspace-describe', '--config', file]);
      assert.equal(described.status, 0, described.stderr);
      assert.equal(parseJson(described.stdout).name, 'CLI Workspace');

      let registered = runCli([
        'module-register',
        '--config', file,
        '--base-revision', '0',
        '--name', 'main',
        '--title', 'Main',
        '--component', 'sn-main',
      ]);
      assert.equal(registered.status, 0, registered.stderr);
      assert.equal(parseJson(registered.stdout).status, 'ok');

      let saved = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(saved.panelTypes.main.component, 'sn-main');
    });
  });

  it('surfaces dispatch contract errors as non-zero process results', () => {
    let result = runCli(['construction-scaffold-blank', '--name', 'No Base']);

    assert.equal(result.status, 1);
    let body = parseJson(result.stdout);
    assert.equal(body.status, 'error');
    assert.equal(body.code, 'tool-contract');
    assert.match(body.hint, /baseRevision/);
  });

  it('runs a W2 read-only session tool from the live registry', () => {
    let result = runCli(['workspace.session.snapshot.list']);

    assert.equal(result.status, 0, result.stderr);
    let body = parseJson(result.stdout);
    assert.equal(body.status, 'ok');
    assert.deepEqual(body.snapshots, []);
  });
});
