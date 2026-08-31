import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  TOOLS,
  createPresentationAuthoringProjectFromTimeline,
  createPresentationTimelineContract,
  listPresentationAuthoringToolDescriptors,
} from '../runtime/index.js';

let ROOT = resolve(import.meta.dirname, '..');
let MCP = resolve(ROOT, 'mcp/index.js');
let CLI = resolve(ROOT, 'cli.js');

function presentationProjectFixture() {
  let timeline = createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'mcp-presentation',
    title: 'MCP presentation',
    locale: 'en-US',
    profile: 'brief',
    personas: { guide: { name: 'Guide', role: 'guide', locale: 'en-US' } },
    grounding: { sources: [] },
    turns: [{
      id: 'overview',
      persona: 'guide',
      dialogueAct: 'explain',
      text: 'Show the result.',
      sourceRefs: [],
      claims: [],
      cues: [],
    }],
  });
  let { project } = createPresentationAuthoringProjectFromTimeline(timeline);
  let layer = project.layers.find((item) => item.kind === 'narration');
  return { project, layer };
}

async function withTempDir(run) {
  let tmpRoot = resolve(ROOT, 'tmp');
  await mkdir(tmpRoot, { recursive: true });
  let dir = await mkdtemp(join(tmpRoot, 'mcp-presentation-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function encodeMessage(message) {
  let json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
}

function parseToolResult(response) {
  return JSON.parse(response.result.content[0].text);
}

function createClient(options = {}) {
  let entry = options.viaCli ? CLI : MCP;
  let args = options.viaCli ? ['mcp'] : [];
  if (options.projectFile) args.push('--project', options.projectFile);
  let child = spawn(process.execPath, [entry, ...args], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  let stderr = '';
  let pending = new Map();

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    parseResponses();
  });

  child.on('exit', () => {
    for (let { reject } of pending.values()) {
      reject(new Error(`MCP exited early. ${stderr}`));
    }
    pending.clear();
  });

  function parseResponses() {
    while (true) {
      let headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      let header = buffer.subarray(0, headerEnd).toString('utf8');
      let match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      let contentLength = Number.parseInt(match[1], 10);
      let bodyStart = headerEnd + 4;
      let bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) return;
      let body = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      buffer = buffer.subarray(bodyEnd);

      let response = JSON.parse(body);
      let waiter = pending.get(response.id);
      if (waiter) {
        pending.delete(response.id);
        waiter.resolve(response);
      }
    }
  }

  function request(method, params) {
    let id = nextId++;
    let message = { jsonrpc: '2.0', id, method, params };
    child.stdin.write(encodeMessage(message));
    return new Promise((resolveResponse, reject) => {
      let timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for MCP response ${id}. ${stderr}`));
      }, 5000);
      pending.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolveResponse(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  async function close() {
    child.kill();
    await once(child, 'exit').catch(() => {});
  }

  return { request, close };
}

async function withMcp(run, options = {}) {
  let client = createClient(options);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

describe('MCP registry projection', () => {
  it('initializes and lists the merged registry', async () => {
    await withMcp(async (client) => {
      let initialized = await client.request('initialize', {});
      assert.equal(initialized.result.serverInfo.name, 'symbiote-workspace');

      let listed = await client.request('tools/list', {});
      assert.equal(listed.result.tools.length, TOOLS.length);
      let names = new Set(listed.result.tools.map((tool) => tool.name));
      assert.equal(names.has('workspace_describe'), true);
      assert.equal(names.has('module_register'), true);
      assert.equal(names.has('navigate'), true);
      assert.equal(names.has('document.commit'), true);
      assert.equal(names.has('workspace.session.snapshot.list'), true);
      assert.equal(names.has('execution_submit'), true);
      assert.equal(names.has('media_sequence_validate'), true);
      assert.equal(names.has('media_evidence_validate'), true);
      assert.equal(names.has('catalog_search'), true);
      assert.equal(names.has('register_panel_type'), false);
      assert.equal(listed.result.tools.every((tool) => tool.annotations), true);
      assert.equal(listed.result.tools.some((tool) => tool.revisionScope), false);
    });
  });

  it('returns dispatch contract errors through tools/call', async () => {
    await withMcp(async (client) => {
      let response = await client.request('tools/call', {
        name: 'construction_scaffold_blank',
        arguments: { name: 'No Base' },
      });
      let body = parseToolResult(response);

      assert.equal(response.result.isError, true);
      assert.equal(body.status, 'error');
      assert.equal(body.code, 'tool-contract');
    });
  });

  it('preserves per-session keying', async () => {
    await withMcp(async (client) => {
      let a = await client.request('tools/call', {
        name: 'construction_scaffold_blank',
        arguments: { session_id: 'A', baseRevision: 0, name: 'Workspace A' },
      });
      let b = await client.request('tools/call', {
        name: 'construction_scaffold_blank',
        arguments: { session_id: 'B', baseRevision: 0, name: 'Workspace B' },
      });
      assert.equal(parseToolResult(a).status, 'ok');
      assert.equal(parseToolResult(b).status, 'ok');

      let describedA = await client.request('tools/call', {
        name: 'workspace_describe',
        arguments: { session_id: 'A' },
      });
      let describedB = await client.request('tools/call', {
        name: 'workspace_describe',
        arguments: { session_id: 'B' },
      });

      assert.equal(parseToolResult(describedA).name, 'Workspace A');
      assert.equal(parseToolResult(describedB).name, 'Workspace B');
    });
  });

  it('derives actor from MCP lane and ignores actor arguments', async () => {
    await withMcp(async (client) => {
      let response = await client.request('tools/call', {
        name: 'construction_scaffold_blank',
        arguments: {
          session_id: 'actor-test',
          baseRevision: 0,
          name: 'Actor',
          actor: 'user-direct',
        },
      });
      let body = parseToolResult(response);

      assert.equal(body.status, 'ok');
      assert.equal(body.origin.actor, 'agent-gated');
      assert.deepEqual(body.origin.principal, { kind: 'agent', id: 'mcp:actor-test' });
    });
  });

  it('calls W2 session tools through the public MCP registry', async () => {
    await withMcp(async (client) => {
      let response = await client.request('tools/call', {
        name: 'workspace.session.snapshot.list',
        arguments: { session_id: 'w2-session' },
      });
      let body = parseToolResult(response);

      assert.equal(response.result.isError, undefined);
      assert.equal(body.status, 'ok');
      assert.deepEqual(body.snapshots, []);
    });
  });

  it('calls S4 catalog tools through the public MCP registry', async () => {
    await withMcp(async (client) => {
      let response = await client.request('tools/call', {
        name: 'catalog_search',
        arguments: { capabilities: ['missing.capability'] },
      });
      let body = parseToolResult(response);

      assert.equal(response.result.isError, undefined);
      assert.equal(body.status, 'ok');
      assert.deepEqual(body.hits, []);
    });
  });

  it('calls a read-only media tool through the public MCP registry', async () => {
    await withMcp(async (client) => {
      let response = await client.request('tools/call', {
        name: 'media_sequence_validate',
        arguments: { sequence: {} },
      });
      let body = parseToolResult(response);

      assert.equal(response.result.isError, undefined);
      assert.equal(body.status, 'ok');
      assert.equal(body.valid, false);
      assert.ok(Array.isArray(body.errors) && body.errors.length > 0);
    });
  });

  it('serves the same file-backed presentation tools through CLI MCP mode', async () => {
    await withTempDir(async (dir) => {
      let file = join(dir, 'presentation.json');
      let { project, layer } = presentationProjectFixture();
      await writeFile(file, `${JSON.stringify(project, null, 2)}\n`, 'utf8');

      await withMcp(async (client) => {
        let listed = await client.request('tools/list', {});
        assert.equal(
          listed.result.tools.length,
          TOOLS.length + listPresentationAuthoringToolDescriptors().length,
        );
        let names = new Set(listed.result.tools.map((tool) => tool.name));
        assert.equal(names.has('presentation_authoring_inspect'), true);
        assert.equal(names.has('presentation_authoring_audio_clip_trim'), true);

        let inspected = await client.request('tools/call', {
          name: 'presentation_authoring_inspect',
          arguments: {},
        });
        assert.equal(parseToolResult(inspected).project.hash, project.hash);

        let updated = await client.request('tools/call', {
          name: 'presentation_authoring_layer_update',
          arguments: {
            id: 'mcp-layer-name',
            base: { revision: project.revision, authoringProjectHash: project.hash },
            payload: { layerId: layer.id, changes: { name: 'Edited by MCP' } },
          },
        });
        let result = parseToolResult(updated);
        assert.equal(updated.result.isError, undefined);
        let persisted = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(persisted.hash, result.project.hash);
        assert.equal(persisted.layers.find((item) => item.id === layer.id).name, 'Edited by MCP');

        let stableBytes = await readFile(file, 'utf8');
        let stale = await client.request('tools/call', {
          name: 'presentation_authoring_layer_update',
          arguments: {
            id: 'mcp-stale-layer-name',
            base: { revision: project.revision, authoringProjectHash: project.hash },
            payload: { layerId: layer.id, changes: { name: 'Must not persist' } },
          },
        });
        assert.equal(stale.result.isError, true);
        assert.match(parseToolResult(stale).error, /base does not match|stale/i);
        assert.equal(await readFile(file, 'utf8'), stableBytes);
      }, { projectFile: file, viaCli: true });
    });
  });
});
