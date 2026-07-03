import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

import { TOOLS } from '../runtime/index.js';

let ROOT = resolve(import.meta.dirname, '..');
let MCP = resolve(ROOT, 'mcp/index.js');

function encodeMessage(message) {
  let json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
}

function parseToolResult(response) {
  return JSON.parse(response.result.content[0].text);
}

function createClient() {
  let child = spawn(process.execPath, [MCP], {
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

async function withMcp(run) {
  let client = createClient();
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
});
