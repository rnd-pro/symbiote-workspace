import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOLS } from '../runtime/index.js';
import { WORKSPACE_PACKAGE_KIND, WORKSPACE_PACKAGE_SCHEMA_VERSION } from '../sharing/index.js';

let __dirname = dirname(fileURLToPath(import.meta.url));
let MCP_SCRIPT = resolve(__dirname, '../mcp/index.js');
let EXTERNAL_SENTIMENT_MODULE = {
  tagName: 'acme-sentiment-panel',
  provider: '@acme/workspace-pack',
  capabilities: ['analysis.sentiment', 'review.queue'],
  actions: [{ id: 'refresh', label: 'Refresh', command: 'sentiment.refresh' }],
  bindings: [{ id: 'items', direction: 'input', path: 'data.sentiment' }],
  requiredHostServices: ['storage.project'],
  placement: {
    panelType: 'sentiment',
    title: 'Sentiment',
    icon: 'sentiment_satisfied',
    behavior: { importance: 72, minInlineSize: 260 },
  },
};
let EXTERNAL_ROOM_TEMPLATE = {
  name: 'mcp-voice-video-room',
  description: 'Portable MCP voice and video room.',
  config: {
    version: '0.1.0',
    name: 'MCP Voice Video Room',
    register: 'agent-workspace',
    panelTypes: {
      stage: { title: 'Stage', icon: 'video_call', component: 'mcp-room-stage' },
      command: { title: 'Command', icon: 'terminal', component: 'mcp-room-command' },
    },
    layout: {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.7,
      first: { type: 'panel', panelType: 'stage' },
      second: { type: 'panel', panelType: 'command' },
    },
    components: {
      catalog: ['mcp-room-stage', 'mcp-room-command'],
      modules: [
        {
          tagName: 'mcp-room-stage',
          capabilities: ['room.video', 'room.audio', 'media.realtime'],
          runtimeSlots: [{ id: 'media-session', role: 'provider', required: true }],
          requiredHostServices: ['media.realtime', 'presence.session'],
        },
        {
          tagName: 'mcp-room-command',
          capabilities: ['room.command', 'agent.command-input'],
          runtimeSlots: [{ id: 'agent-runtime', role: 'provider', required: true }],
          requiredHostServices: ['agent.runtime'],
        },
      ],
    },
  },
};

function layoutReferencesPanel(node, panelType) {
  if (!node) return false;
  if (node.type === 'panel') return node.panelType === panelType;
  return layoutReferencesPanel(node.first, panelType) ||
    layoutReferencesPanel(node.second, panelType);
}

/**
 * Start MCP server and exchange messages.
 * @param {Object[]} messages - JSON-RPC messages to send
 * @param {number} [timeout=3000] - Max wait time in ms
 * @returns {Promise<Object[]>} - Responses received
 */
function mcpSession(messages, timeout = 3000) {
  return new Promise((resolve, reject) => {
    let mcp = spawn('node', [MCP_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let responses = [];
    let buf = '';
    let timers = [];
    let expectedResponses = messages.filter((message) => message.id !== undefined).length;
    let settled = false;

    function cleanup() {
      for (let timer of timers) clearTimeout(timer);
      if (!mcp.killed) mcp.kill();
    }

    function finish() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(responses);
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

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
        if (expectedResponses > 0 && responses.length >= expectedResponses) {
          finish();
          return;
        }
      }
    });
    mcp.on('error', fail);

    function send(obj) {
      let json = JSON.stringify(obj);
      mcp.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
    }

    let delay = 0;
    for (let msg of messages) {
      timers.push(setTimeout(() => send(msg), delay));
      delay += 100;
    }

    timers.push(setTimeout(finish, Math.max(timeout, delay + 500)));
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

  it('lists all registered tools without leaking internal fields', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    let toolList = responses.find((r) => r.id === 2);
    assert.ok(toolList);
    assert.equal(toolList.result.tools.length, TOOLS.length);
    assert.equal(TOOLS.length, 63, 'expected tool count');

    let toolNames = new Set(toolList.result.tools.map((tool) => tool.name));
    assert.equal(toolNames.has('classify_workspace'), true);
    assert.equal(toolNames.has('plan_workspace'), true);
    assert.equal(toolNames.has('construct_workspace'), true);
    assert.equal(toolNames.has('apply_workspace_patch'), true);
    assert.equal(toolNames.has('export_workspace'), true);

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

  it('constructs workspace state through tools/call and exports it from the same session', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'construct_workspace',
          arguments: {
            intent: 'social automation reply queue',
            template: 'social-automation',
            name: 'MCP Constructed',
            requiredCapabilities: ['automation.reply-template', 'data.import'],
          },
        },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'export_workspace', arguments: {} },
      },
    ], 1200);

    let constructResult = responses.find((r) => r.id === 2);
    assert.ok(constructResult);
    let constructContent = JSON.parse(constructResult.result.content[0].text);
    assert.equal(constructContent.status, 'ok');
    assert.deepEqual(constructContent.plan.answers.moduleSelection, ['imports', 'reply']);

    let exportResult = responses.find((r) => r.id === 3);
    assert.ok(exportResult);
    let exportContent = JSON.parse(exportResult.result.content[0].text);
    let exportedConfig = JSON.parse(exportContent.json);
    assert.equal(exportedConfig.name, 'MCP Constructed');
    assert.deepEqual(exportedConfig.construction.plan.capabilities.missing, []);
  });

  it('constructs external module descriptors through tools/call and exports executable config', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'construct_workspace',
          arguments: {
            intent: 'sentiment review operations dashboard',
            template: 'dashboard',
            requiredCapabilities: ['analysis.sentiment'],
            moduleCapabilities: [EXTERNAL_SENTIMENT_MODULE],
          },
        },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'export_workspace', arguments: {} },
      },
    ], 5000);

    let constructResult = responses.find((r) => r.id === 2);
    assert.ok(constructResult);
    let constructContent = JSON.parse(constructResult.result.content[0].text);
    assert.deepEqual(constructContent.plan.answers.moduleSelection, ['sentiment']);
    assert.deepEqual(constructContent.plan.capabilities.missing, []);

    let exportResult = responses.find((r) => r.id === 3);
    assert.ok(exportResult);
    let exportContent = JSON.parse(exportResult.result.content[0].text);
    let exportedConfig = JSON.parse(exportContent.json);
    assert.equal(exportedConfig.panelTypes.sentiment.component, 'acme-sentiment-panel');
    assert.ok(exportedConfig.components.catalog.includes('acme-sentiment-panel'));
    assert.ok(layoutReferencesPanel(exportedConfig.layout, 'sentiment'));
  });

  it('constructs external room templates through tools/call and exports executable config', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'construct_workspace',
          arguments: {
            intent: 'voice video AI room',
            template: 'mcp-voice-video-room',
            requiredCapabilities: ['room.video', 'room.command'],
            workspaceTemplates: [EXTERNAL_ROOM_TEMPLATE],
          },
        },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'export_workspace', arguments: {} },
      },
    ], 5000);

    let constructResult = responses.find((r) => r.id === 2);
    assert.ok(constructResult);
    let constructContent = JSON.parse(constructResult.result.content[0].text);
    assert.equal(constructContent.status, 'ok');
    assert.equal(constructContent.intent.template, 'mcp-voice-video-room');
    assert.deepEqual(constructContent.plan.capabilities.missing, []);

    let exportResult = responses.find((r) => r.id === 3);
    assert.ok(exportResult);
    let exportContent = JSON.parse(exportResult.result.content[0].text);
    let exportedConfig = JSON.parse(exportContent.json);
    assert.equal(exportedConfig.name, 'MCP Voice Video Room');
    assert.equal(exportedConfig.panelTypes.stage.component, 'mcp-room-stage');
    assert.ok(exportedConfig.components.catalog.includes('mcp-room-command'));
    assert.ok(layoutReferencesPanel(exportedConfig.layout, 'stage'));
    assert.ok(layoutReferencesPanel(exportedConfig.layout, 'command'));
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

describe('Workspace Package via MCP', () => {
  it('lists workspace package tools', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    let toolList = responses.find((r) => r.id === 2);
    assert.ok(toolList);
    let toolNames = new Set(toolList.result.tools.map((tool) => tool.name));
    assert.equal(toolNames.has('export_workspace_package'), true);
    assert.equal(toolNames.has('import_workspace_package'), true);
    assert.equal(toolNames.has('validate_workspace_package'), true);
  });

  it('export_workspace_package produces a full package with kind and host contract', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP Pkg Test' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'export_workspace_package',
          arguments: { manifest: { id: 'com.example.mcp-pkg' } },
        },
      },
    ], 5000);

    let exportResult = responses.find((r) => r.id === 3);
    assert.ok(exportResult);
    let content = JSON.parse(exportResult.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.ok(content.json);

    let pkg = JSON.parse(content.json);
    assert.equal(pkg.kind, WORKSPACE_PACKAGE_KIND);
    assert.equal(pkg.schemaVersion, WORKSPACE_PACKAGE_SCHEMA_VERSION);
    assert.equal(pkg.manifest.id, 'com.example.mcp-pkg');
    assert.equal(pkg.manifest.name, 'MCP Pkg Test');
    assert.ok(pkg.host);
    assert.ok(pkg.host.contract);
    assert.equal(pkg.host.contract.schemaVersion, '0.1.0');
  });

  it('import_workspace_package restores session and re-exports identical package', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'construct_workspace', arguments: {
          intent: 'chat workspace',
          template: 'chat',
          name: 'MCP Import Source',
        } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'export_workspace_package', arguments: { manifest: { id: 'com.example.mcp-import' } } },
      },
    ], 5000);

    let exportContent = JSON.parse(responses.find((r) => r.id === 3).result.content[0].text);
    assert.equal(exportContent.status, 'ok');

    let importResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'import_workspace_package', arguments: { json: exportContent.json } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'export_workspace_package', arguments: { manifest: { id: 'com.example.mcp-import' } } },
      },
    ], 5000);

    let importResult = importResponses.find((r) => r.id === 2);
    let importContent = JSON.parse(importResult.result.content[0].text);
    assert.equal(importContent.status, 'ok');
    assert.equal(importContent.config.name, 'MCP Import Source');

    let reExportResult = importResponses.find((r) => r.id === 3);
    let reExportContent = JSON.parse(reExportResult.result.content[0].text);
    assert.equal(reExportContent.status, 'ok');

    let reExportedPkg = JSON.parse(reExportContent.json);
    assert.equal(reExportedPkg.workspace.config.name, 'MCP Import Source');
  });

  it('validate_workspace_package accepts a valid package produced by export', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP Validate' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'export_workspace_package', arguments: { manifest: { id: 'com.example.mcp-validate' } } },
      },
    ], 5000);

    let exportContent = JSON.parse(responses.find((r) => r.id === 3).result.content[0].text);
    let packageObj = JSON.parse(exportContent.json);

    let validateResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'validate_workspace_package', arguments: { package: packageObj } },
      },
    ]);

    let validateResult = validateResponses.find((r) => r.id === 2);
    let validateContent = JSON.parse(validateResult.result.content[0].text);
    assert.equal(validateContent.valid, true);
    assert.equal(validateContent.errors.length, 0);
  });

  it('validate_workspace_package rejects an invalid package', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'validate_workspace_package',
          arguments: { package: { kind: 'not-a-workspace-package' } },
        },
      },
    ]);

    let result = responses.find((r) => r.id === 2);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.valid, false);
    assert.ok(content.errors.length > 0);
    assert.ok(content.errors.some((e) => e.path === 'kind'));
  });

  it('lists inspect_workspace_package in tools/list', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    let toolList = responses.find((r) => r.id === 2);
    let tools = toolList.result.tools;
    let toolNames = new Set(tools.map((tool) => tool.name));
    assert.equal(toolNames.has('inspect_workspace_package'), true);
    let inspectTool = tools.find((tool) => tool.name === 'inspect_workspace_package');
    assert.ok(inspectTool.inputSchema.properties.package);
    assert.ok(inspectTool.inputSchema.properties.json);
    assert.ok(inspectTool.inputSchema.properties.available);
    assert.deepEqual(inspectTool.inputSchema.anyOf, [
      { required: ['package'] },
      { required: ['json'] },
    ]);
  });

  it('inspect_workspace_package via tools/call returns valid/ready plus requirements/missing', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP Inspect' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'export_workspace_package',
          arguments: { manifest: { id: 'com.example.mcp-inspect' } },
        },
      },
    ], 5000);

    let exportContent = JSON.parse(responses.find((r) => r.id === 3).result.content[0].text);
    let packageObj = JSON.parse(exportContent.json);

    let inspectResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'inspect_workspace_package',
          arguments: { package: packageObj },
        },
      },
    ]);

    let result = inspectResponses.find((r) => r.id === 2);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.equal(content.valid, true);
    assert.equal(content.ready, true);
    assert.ok(content.summary);
    assert.equal(content.summary.id, 'com.example.mcp-inspect');
    assert.ok(content.requirements);
    assert.ok(content.missing);
    assert.equal(content.errors.length, 0);
  });

  it('inspect_workspace_package via tools/call accepts a JSON string', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP JSON Inspect' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'export_workspace_package',
          arguments: { manifest: { id: 'com.example.mcp-json-inspect' } },
        },
      },
    ], 5000);

    let exportContent = JSON.parse(responses.find((r) => r.id === 3).result.content[0].text);

    let inspectResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'inspect_workspace_package',
          arguments: { json: exportContent.json },
        },
      },
    ]);

    let result = inspectResponses.find((r) => r.id === 2);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.equal(content.valid, true);
    assert.equal(content.ready, true);
    assert.equal(content.summary.id, 'com.example.mcp-json-inspect');
  });

  it('inspect_workspace_package with unavailable deps returns missing via tools/call', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP Gap Inspect' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'export_workspace_package',
          arguments: {
            manifest: {
              id: 'com.example.mcp-gap',
              dependencies: { plugins: ['mcp-missing-plugin'], components: ['mcp-missing-comp'] },
            },
          },
        },
      },
    ], 5000);

    let exportContent = JSON.parse(responses.find((r) => r.id === 3).result.content[0].text);
    let packageObj = JSON.parse(exportContent.json);

    let inspectResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'inspect_workspace_package',
          arguments: {
            package: packageObj,
            available: { plugins: ['present-plugin'], components: [] },
          },
        },
      },
    ]);

    let result = inspectResponses.find((r) => r.id === 2);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.equal(content.valid, true);
    assert.equal(content.ready, false);
    assert.ok(content.missing.plugins.includes('mcp-missing-plugin'));
    assert.ok(content.missing.components.includes('mcp-missing-comp'));
    assert.ok(content.warnings.length > 0);
  });
});

describe('Package Construction Context via MCP', () => {
  it('lists create_workspace_package_construction_context in tools/list with schema', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    let toolList = responses.find((r) => r.id === 2);
    let tools = toolList.result.tools;
    let toolNames = new Set(tools.map((tool) => tool.name));
    assert.equal(toolNames.has('create_workspace_package_construction_context'), true);
    let tool = tools.find((t) => t.name === 'create_workspace_package_construction_context');
    assert.ok(tool.inputSchema.properties.package);
    assert.ok(tool.inputSchema.properties.json);
    assert.ok(tool.inputSchema.properties.available);
    assert.ok(tool.inputSchema.properties.templateName);
    assert.deepEqual(tool.inputSchema.anyOf, [
      { required: ['package'] },
      { required: ['json'] },
    ]);
  });

  it('create_workspace_package_construction_context via tools/call accepts a package object', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP Construct Ctx Obj' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'export_workspace_package',
          arguments: { manifest: { id: 'com.example.mcp-construct-obj' } },
        },
      },
    ], 5000);

    let exportContent = JSON.parse(responses.find((r) => r.id === 3).result.content[0].text);
    let packageObj = JSON.parse(exportContent.json);

    let ctxResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_package_construction_context',
          arguments: { package: packageObj },
        },
      },
    ]);

    let result = ctxResponses.find((r) => r.id === 2);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.equal(content.valid, true);
    assert.ok(content.workspaceTemplates.length > 0);
    assert.ok(content.workspaceTemplates[0].config);
    assert.ok(content.source);
    assert.equal(content.source.type, 'workspace-package');
    assert.equal(content.summary.id, 'com.example.mcp-construct-obj');
    assert.equal(content.errors.length, 0);
  });

  it('create_workspace_package_construction_context via tools/call accepts a JSON string', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP Construct JSON' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'export_workspace_package',
          arguments: { manifest: { id: 'com.example.mcp-construct-json' } },
        },
      },
    ], 5000);

    let exportContent = JSON.parse(responses.find((r) => r.id === 3).result.content[0].text);

    let ctxResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_package_construction_context',
          arguments: { json: exportContent.json },
        },
      },
    ]);

    let result = ctxResponses.find((r) => r.id === 2);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.equal(content.valid, true);
    assert.equal(content.source.packageId, 'com.example.mcp-construct-json');
    assert.ok(content.workspaceTemplates.length > 0);
  });

  it('create_workspace_package_construction_context via tools/call returns requiredCapabilities', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'construct_workspace',
          arguments: {
            intent: 'sentiment review operations dashboard',
            template: 'dashboard',
            requiredCapabilities: ['analysis.sentiment', 'review.queue'],
            moduleCapabilities: [EXTERNAL_SENTIMENT_MODULE],
          },
        },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'export_workspace_package',
          arguments: { manifest: { id: 'com.example.mcp-required-caps' } },
        },
      },
    ], 5000);

    let exportContent = JSON.parse(responses.find((r) => r.id === 3).result.content[0].text);
    let packageObj = JSON.parse(exportContent.json);
    packageObj.workspace.config.construction.intent = {
      brief: 'MCP review queue workspace',
      targetRegister: 'tool',
      requiredCapabilities: ['agent.runtime', 'analysis.sentiment'],
    };

    let ctxResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_package_construction_context',
          arguments: { package: packageObj },
        },
      },
    ]);

    let result = ctxResponses.find((r) => r.id === 2);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.equal(content.valid, true);
    assert.deepEqual(content.requiredCapabilities, [
      'agent.runtime',
      'analysis.sentiment',
      'review.queue',
    ]);
  });

  it('create_workspace_package_construction_context with unavailable deps reports gap via tools/call', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP Construct Gap' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'export_workspace_package',
          arguments: {
            manifest: {
              id: 'com.example.mcp-construct-gap',
              dependencies: { plugins: ['mcp-gap-pkg'], components: ['mcp-gap-comp'] },
            },
          },
        },
      },
    ], 5000);

    let exportContent = JSON.parse(responses.find((r) => r.id === 3).result.content[0].text);
    let packageObj = JSON.parse(exportContent.json);

    let ctxResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_package_construction_context',
          arguments: {
            package: packageObj,
            available: { plugins: ['only-present'], components: [] },
          },
        },
      },
    ]);

    let result = ctxResponses.find((r) => r.id === 2);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.equal(content.valid, true);
    assert.equal(content.ready, false);
    assert.ok(content.missing.plugins.includes('mcp-gap-pkg'));
    assert.ok(content.missing.components.includes('mcp-gap-comp'));
    assert.ok(content.warnings.length > 0);
  });
});

describe('Package Collection Construction Context via MCP', () => {
  it('lists create_workspace_packages_construction_context in tools/list with schema', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    let toolList = responses.find((r) => r.id === 2);
    let tools = toolList.result.tools;
    let toolNames = new Set(tools.map((tool) => tool.name));
    assert.equal(toolNames.has('create_workspace_packages_construction_context'), true);
    let tool = tools.find((t) => t.name === 'create_workspace_packages_construction_context');
    assert.ok(tool.inputSchema.properties.packages);
    assert.ok(tool.inputSchema.properties.available);
    assert.deepEqual(tool.inputSchema.required, ['packages']);
  });

  it('create_workspace_packages_construction_context via tools/call aggregates package entries', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP Collection Alpha' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'export_workspace_package',
          arguments: {
            manifest: {
              id: 'com.example.mcp-collection-alpha',
              dependencies: { plugins: ['mcp-collection-alpha-plugin'], components: ['mcp-collection-alpha-component'] },
            },
          },
        },
      },
      {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP Collection Beta' } },
      },
      {
        jsonrpc: '2.0', id: 5, method: 'tools/call',
        params: {
          name: 'export_workspace_package',
          arguments: {
            manifest: {
              id: 'com.example.mcp-collection-beta',
              dependencies: { plugins: ['mcp-collection-beta-plugin'], components: ['mcp-collection-beta-component'] },
            },
          },
        },
      },
    ], 5000);

    let alphaContent = JSON.parse(responses.find((r) => r.id === 3).result.content[0].text);
    let betaContent = JSON.parse(responses.find((r) => r.id === 5).result.content[0].text);
    let alphaPackage = JSON.parse(alphaContent.json);

    let ctxResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_packages_construction_context',
          arguments: {
            packages: [
              { package: alphaPackage, templateName: 'mcp-collection-alpha-room' },
              { json: betaContent.json, templateName: 'mcp-collection-beta-room' },
            ],
            available: {
              components: [],
              plugins: [],
              packages: [],
              hostServices: [],
              runtimeSlots: [],
            },
          },
        },
      },
    ]);

    let result = ctxResponses.find((r) => r.id === 2);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.equal(content.valid, true);
    assert.equal(content.ready, false);
    assert.deepEqual(content.source, {
      type: 'workspace-package-collection',
      packageCount: 2,
      validPackageCount: 2,
    });
    assert.deepEqual(content.workspaceTemplates.map((template) => template.name), [
      'mcp-collection-alpha-room',
      'mcp-collection-beta-room',
    ]);
    assert.equal(content.packageResults.length, 2);
    assert.equal(content.sources.length, 2);
    assert.ok(content.missing.components.includes('mcp-collection-alpha-component'));
    assert.ok(content.missing.plugins.includes('mcp-collection-beta-plugin'));
    assert.ok(content.warnings.length > 0);
  });
});
