#!/usr/bin/env node

/**
 * MCP Server for symbiote-workspace builder.
 *
 * Pure JSON-RPC protocol layer over stdio. Tool definitions and dispatch logic
 * live in the runtime registry.
 *
 * @module symbiote-workspace/mcp
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSession, dispatch, TOOLS } from '../runtime/index.js';

let session = createSession({ actor: 'agent-gated', principal: { kind: 'agent', id: 'mcp' } });
let sessions = new Map();

function sessionFor(id) {
  if (id == null || id === '') return session;
  let key = String(id);
  if (!sessions.has(key)) {
    sessions.set(key, createSession({
      actor: 'agent-gated',
      principal: { kind: 'agent', id: `mcp:${key}` },
      sessionId: key,
    }));
  }
  return sessions.get(key);
}

let PACKAGE_VERSION = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
  'utf8',
)).version;

let buffer = Buffer.alloc(0);
let messageQueue = Promise.resolve();

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});

function processBuffer() {
  while (true) {
    let headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;

    let header = buffer.subarray(0, headerEnd).toString('utf8');
    let contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!contentLengthMatch) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }

    let contentLength = parseInt(contentLengthMatch[1], 10);
    let bodyStart = headerEnd + 4;
    let bodyEnd = bodyStart + contentLength;
    if (buffer.length < bodyEnd) return;

    let body = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
    buffer = buffer.subarray(bodyEnd);

    messageQueue = messageQueue
      .then(() => handleMessage(body))
      .catch((error) => {
        sendResponse({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: error.message },
        });
      });
  }
}

function sendResponse(response) {
  let json = JSON.stringify(response);
  let message = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
  process.stdout.write(message);
}

function publicToolDefinition(tool) {
  let {
    family,
    mutates,
    requiresConfig,
    revisionScope,
    writesFiles,
    annotations,
    ...rest
  } = tool;
  return {
    ...rest,
    annotations: {
      ...annotations,
      readOnlyHint: mutates !== true && writesFiles !== true,
    },
  };
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
          version: PACKAGE_VERSION,
        },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    sendResponse({
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS.map(publicToolDefinition) },
    });
    return;
  }

  if (method === 'tools/call') {
    let toolName = params?.name;
    let { session_id: sessionId, actor: _ignoredActor, ...args } = params?.arguments || {};

    try {
      let result = await dispatch(toolName, args, sessionFor(sessionId), { actor: 'agent-gated' });
      let isDispatchError = result?.status === 'error';
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          ...(isDispatchError ? { isError: true } : {}),
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

  sendResponse({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}
