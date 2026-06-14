import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, unlink } from 'node:fs/promises';

let __dirname = dirname(fileURLToPath(import.meta.url));
let CLI = resolve(__dirname, '../cli.js');

async function exec(...args) {
  let { execFile } = await import('node:child_process');
  let { promisify } = await import('node:util');
  return promisify(execFile)('node', [CLI, ...args]);
}

describe('CLI help', () => {
  it('prints usage on --help', async () => {
    let { stdout } = await exec('--help');
    assert.ok(stdout.includes('symbiote-workspace CLI'));
    assert.ok(stdout.includes('scaffold'));
    assert.ok(stdout.includes('mcp'));
    assert.ok(stdout.includes('--config'));
    assert.equal(stdout.includes('Force JSON output'), false);
    assert.ok(stdout.includes('--json <string>'));
  });
});

describe('CLI tool commands', () => {
  it('list-templates returns JSON', async () => {
    let { stdout } = await exec('list-templates');
    let result = JSON.parse(stdout);
    assert.ok(result.count >= 5);
    assert.ok(result.templates.includes('chat'));
  });

  it('scaffold creates workspace', async () => {
    let { stdout } = await exec('scaffold', 'chat', '--name', 'My Chat');
    let result = JSON.parse(stdout);
    assert.equal(result.status, 'ok');
    assert.equal(result.config.name, 'My Chat');
  });

  it('scaffold-from-scratch creates blank workspace', async () => {
    let { stdout } = await exec('scaffold-from-scratch', '--name', 'Blank');
    let result = JSON.parse(stdout);
    assert.equal(result.status, 'ok');
    assert.equal(result.config.name, 'Blank');
  });
});

describe('CLI --config workflow', () => {
  let tmpFile = resolve(__dirname, '../_test_cli_config.json');

  it('scaffold + add-group + list-groups via --config', async () => {
    // Scaffold
    let r1 = await exec('scaffold', 'dashboard', '--config', tmpFile);
    let p1 = JSON.parse(r1.stdout);
    assert.equal(p1.status, 'ok');

    // Add group
    let r2 = await exec('add-group', '--config', tmpFile, '--id', 'test-g', '--name', 'Test Group');
    let p2 = JSON.parse(r2.stdout);
    assert.equal(p2.status, 'ok');

    // List groups — should have dashboard group + test-g
    let r3 = await exec('list-groups', '--config', tmpFile);
    let p3 = JSON.parse(r3.stdout);
    assert.ok(p3.count >= 2);

    // Describe
    let r4 = await exec('describe', tmpFile);
    let p4 = JSON.parse(r4.stdout);
    assert.ok(p4.panelTypes);

    // Validate
    let r5 = await exec('validate', tmpFile);
    let p5 = JSON.parse(r5.stdout);
    assert.equal(p5.valid, true);

    // Cleanup
    await unlink(tmpFile).catch(() => {});
  });

  it('register-panel-type + mount-widget via --config', async () => {
    // Scaffold blank
    await exec('scaffold-from-scratch', '--name', 'Widget Test', '--config', tmpFile);

    // Register panel type
    let r1 = await exec('register-panel-type', '--config', tmpFile,
      '--name', 'main', '--title', 'Main', '--component', 'sn-card');
    let p1 = JSON.parse(r1.stdout);
    assert.equal(p1.status, 'ok');

    // Mount widget
    let r2 = await exec('mount-widget', '--config', tmpFile,
      '--panelType', 'main', '--componentTag', 'sn-data-table');
    let p2 = JSON.parse(r2.stdout);
    assert.equal(p2.status, 'ok');

    // List panel types
    let r3 = await exec('list-panel-types', '--config', tmpFile);
    let p3 = JSON.parse(r3.stdout);
    assert.equal(p3.count, 1);

    // Cleanup
    await unlink(tmpFile).catch(() => {});
  });
});

describe('CLI error handling', () => {
  it('exits with error on unknown command', async () => {
    try {
      await exec('unknown-command-xyz');
      assert.fail('Should have exited with error');
    } catch (err) {
      assert.ok(err.code === 1);
    }
  });

  it('validates invalid config file', async () => {
    let tmpFile = resolve(__dirname, '../_test_invalid.json');
    await writeFile(tmpFile, JSON.stringify({ invalid: true }));
    try {
      let { stdout } = await exec('validate', tmpFile);
      let result = JSON.parse(stdout);
      assert.equal(result.valid, false);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  it('rejects host-only fields when loading --config', async () => {
    let tmpFile = resolve(__dirname, '../_test_host_only.json');
    await writeFile(tmpFile, JSON.stringify({
      version: '0.3.0',
      name: 'Host Only',
      server: { url: 'https://example.test' },
    }));

    try {
      await exec('list-groups', '--config', tmpFile);
      assert.fail('Expected --config load to reject host-only fields');
    } catch (err) {
      assert.equal(err.code, 1);
      assert.match(err.stderr, /portable workspace config/);
      assert.match(err.stderr, /server/);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });
});
