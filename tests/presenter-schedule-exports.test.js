import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

let exec = promisify(execFile);
let ROOT = fileURLToPath(new URL('..', import.meta.url));
let SCHEDULE_EXPORTS = [
  'PRESENTER_ACTION_SCHEDULE_VERSION',
  'createPresenterActionSchedule',
  'validatePresenterActionSchedule',
];

describe('presenter schedule public contract', () => {
  it('shares one implementation across every public presentation barrel', async () => {
    let surfaces = await Promise.all([
      import('symbiote-workspace'),
      import('symbiote-workspace/browser'),
      import('symbiote-workspace/runtime'),
      import('symbiote-workspace/runtime/presentation.js'),
    ]);

    assert.equal(
      surfaces[0].PRESENTER_ACTION_SCHEDULE_VERSION,
      'workspace-presenter-action-schedule-v1',
    );
    for (let name of SCHEDULE_EXPORTS) {
      for (let surface of surfaces.slice(1)) {
        assert.equal(surface[name], surfaces[0][name], `${name} export must be consistent`);
      }
    }
  });

  it('includes the schedule contract source in the npm package', async () => {
    let { stdout } = await exec('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: ROOT,
      maxBuffer: 1024 * 1024 * 8,
    });
    // npm 12 prints an object keyed by package name; older npm printed an array.
    let parsed = JSON.parse(stdout);
    let pack = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];

    assert.equal(pack.name, 'symbiote-workspace');
    // Compared with the manifest rather than a literal: a hardcoded version here
    // is how this test ended up asserting 1.1.0 while the package was 2.x.
    assert.equal(pack.version, JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version);
    assert.equal(
      pack.files.some((file) => file.path === 'runtime/presentation/presenter-schedule.js'),
      true,
    );
  });
});
