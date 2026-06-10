#!/usr/bin/env node

/**
 * MCP Server for symbiote-workspace builder.
 *
 * Pure JSON-RPC protocol layer over stdio.
 * All tool definitions and dispatch logic live in runtime/dispatch.js.
 *
 * Usage:
 *   node symbiote-workspace/mcp/index.js
 *
 * MCP config:
 *   { "command": "node", "args": ["path/to/symbiote-workspace/mcp/index.js"] }
 *
 * @module symbiote-workspace/mcp
 */

import { dispatch, TOOLS } from '../runtime/dispatch.js';
import { createSession } from '../runtime/session.js';

// One session per MCP server process
let session = createSession();

// ── JSON-RPC Protocol (stdio, Content-Length framing) ──

let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  processBuffer();
});

function processBuffer() {
  while (true) {
    let headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;

    let header = buffer.slice(0, headerEnd);
    let contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!contentLengthMatch) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    let contentLength = parseInt(contentLengthMatch[1], 10);
    let bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + contentLength) return;

    let body = buffer.slice(bodyStart, bodyStart + contentLength);
    buffer = buffer.slice(bodyStart + contentLength);

    handleMessage(body);
  }
}

function sendResponse(response) {
  let json = JSON.stringify(response);
  let message = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
  process.stdout.write(message);
}

async function handleMessage(body) {
  let request;
  try {
    request = JSON.parse(body);
  } catch {
    return;
  }

  let { id, method, params } = request;

  if (method === 'initialize') {
    sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'symbiote-workspace',
          version: '0.3.0-alpha.2',
        },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return; // No response needed
  }

  if (method === 'tools/list') {
    // Strip internal 'mutates' field from tool definitions
    let tools = TOOLS.map(({ mutates, ...rest }) => rest);
    sendResponse({
      jsonrpc: '2.0',
      id,
      result: { tools },
    });
    return;
  }

  if (method === 'tools/call') {
    let toolName = params?.name;
    let args = params?.arguments || {};

    try {
      let result = await dispatch(toolName, args, session);
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      });
    } catch (err) {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
          isError: true,
        },
      });
    }
    return;
  }

  // Unknown method
  sendResponse({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}
