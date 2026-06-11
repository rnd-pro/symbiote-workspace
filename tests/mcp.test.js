import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let __dirname = dirname(fileURLToPath(import.meta.url));
let MCP_SCRIPT = resolve(__dirname, '../mcp/index.js');

/**
 * Start MCP server and exchange messages.
 * @param {Object[]} messages - JSON-RPC messages to send
 * @param {number} [timeout=2000] - Max wait time in ms
 * @returns {Promise<Object[]>} - Responses received
 */
function mcpSession(messages, timeout = 800) {
  return new Promise((resolve, reject) => {
    let mcp = spawn('node', [MCP_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let responses = [];
    let buf = '';

    mcp.stdout.on('data', (d) => {
      buf += d.toString();
      while (true) {
        let m = buf.match(/Content-Length: (\d+)\r\n\r\n/);
        if (!m) break;
        let len = parseInt(m[1]);
        let bodyStart = m[0].length;
        if (buf.length < bodyStart + len) break;
        let body = buf.slice(bodyStart, bodyStart + len);
        buf = buf.slice(bodyStart + len);
        responses.push(JSON.parse(body));
      }
    });

    function send(obj) {
      let json = JSON.stringify(obj);
      mcp.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
    }

    // Send messages with delays
    let delay = 0;
    for (let msg of messages) {
      setTimeout(() => send(msg), delay);
      delay += 100;
    }

    setTimeout(() => {
      mcp.kill();
      resolve(responses);
    }, Math.max(timeout, delay + 500));
  });
}

describe('MCP Protocol', () => {
  it('initializes and returns server info', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    ]);

    assert.equal(responses.length, 1);
    let r = responses[0];
    assert.equal(r.id, 1);
    assert.equal(r.result.serverInfo.name, 'symbiote-workspace');
    assert.ok(r.result.protocolVersion);
  });

  it('lists all 50 tools', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    let toolList = responses.find((r) => r.id === 2);
    assert.ok(toolList);
    assert.equal(toolList.result.tools.length, 50);

    // Verify no internal fields leaked
    for (let tool of toolList.result.tools) {
      assert.equal(tool.mutates, undefined, `Tool ${tool.name} leaked 'mutates' field`);
    }
  });

  it('dispatches scaffold_from_scratch via tools/call', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP Test' } },
      },
    ]);

    let result = responses.find((r) => r.id === 2);
    assert.ok(result);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.equal(content.config.name, 'MCP Test');
  });

  it('maintains session state across tool calls', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'Session Test' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'add_group', arguments: { id: 'g1', name: 'Group 1' } },
      },
      {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'list_groups', arguments: {} },
      },
    ]);

    let listResult = responses.find((r) => r.id === 4);
    assert.ok(listResult);
    let content = JSON.parse(listResult.result.content[0].text);
    assert.equal(content.count, 1);
    assert.equal(content.groups[0].id, 'g1');
  });

  it('returns error for unknown method', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'unknown/method', params: {} },
    ]);

    assert.equal(responses.length, 1);
    assert.ok(responses[0].error);
    assert.equal(responses[0].error.code, -32601);
  });

  it('handles tool errors gracefully', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'nonexistent_tool', arguments: {} },
      },
    ]);

    let result = responses.find((r) => r.id === 2);
    assert.ok(result);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'error');
  });
});
