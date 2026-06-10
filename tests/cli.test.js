import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let __dirname = dirname(fileURLToPath(import.meta.url));

describe('CLI', () => {
  it('prints usage on --help', async () => {
    let { execFile } = await import('node:child_process');
    let { promisify } = await import('node:util');
    let exec = promisify(execFile);

    let { stdout } = await exec('node', [resolve(__dirname, '../cli.js'), '--help']);
    assert.ok(stdout.includes('symbiote-workspace CLI'));
    assert.ok(stdout.includes('serve'));
    assert.ok(stdout.includes('validate'));
    assert.ok(stdout.includes('plan'));
    assert.ok(stdout.includes('list-templates'));
  });

  it('lists templates', async () => {
    let { execFile } = await import('node:child_process');
    let { promisify } = await import('node:util');
    let exec = promisify(execFile);

    let { stdout } = await exec('node', [resolve(__dirname, '../cli.js'), 'list-templates']);
    assert.ok(stdout.includes('chat'));
    assert.ok(stdout.includes('editor'));
    assert.ok(stdout.includes('graph'));
    assert.ok(stdout.includes('dashboard'));
  });

  it('plans a workspace from intent', async () => {
    let { execFile } = await import('node:child_process');
    let { promisify } = await import('node:util');
    let exec = promisify(execFile);

    let { stdout } = await exec('node', [
      resolve(__dirname, '../cli.js'),
      'plan',
      'build me a chat workspace',
    ]);
    let config = JSON.parse(stdout);
    assert.equal(config.name, 'Chat Workspace');
    assert.ok(config.layout);
    assert.ok(config.components?.catalog?.includes('sn-chat-transcript'));
  });

  it('plans with --name flag', async () => {
    let { execFile } = await import('node:child_process');
    let { promisify } = await import('node:util');
    let exec = promisify(execFile);

    let { stdout } = await exec('node', [
      resolve(__dirname, '../cli.js'),
      'plan',
      'graph editor',
      '--name',
      'My Graph',
    ]);
    let config = JSON.parse(stdout);
    assert.equal(config.name, 'My Graph');
  });

  it('validates a valid config file', async () => {
    let { execFile } = await import('node:child_process');
    let { promisify } = await import('node:util');
    let { writeFile, unlink } = await import('node:fs/promises');
    let exec = promisify(execFile);

    let tmpFile = resolve(__dirname, '../_test_valid_config.json');
    await writeFile(tmpFile, JSON.stringify({
      version: '0.1.0',
      name: 'Test Workspace',
      register: 'tool',
    }));

    try {
      let { stdout } = await exec('node', [resolve(__dirname, '../cli.js'), 'validate', tmpFile]);
      assert.ok(stdout.includes('Valid'));
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  it('rejects an invalid config file', async () => {
    let { execFile } = await import('node:child_process');
    let { promisify } = await import('node:util');
    let { writeFile, unlink } = await import('node:fs/promises');
    let exec = promisify(execFile);

    let tmpFile = resolve(__dirname, '../_test_invalid_config.json');
    await writeFile(tmpFile, JSON.stringify({ invalid: true }));

    try {
      await exec('node', [resolve(__dirname, '../cli.js'), 'validate', tmpFile]);
      assert.fail('Should have exited with error');
    } catch (err) {
      assert.ok(err.stderr.includes('Invalid') || err.code === 1);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  it('exits with error on unknown command', async () => {
    let { execFile } = await import('node:child_process');
    let { promisify } = await import('node:util');
    let exec = promisify(execFile);

    try {
      await exec('node', [resolve(__dirname, '../cli.js'), 'unknown-command']);
      assert.fail('Should have exited with error');
    } catch (err) {
      assert.ok(err.code === 1);
    }
  });
});
