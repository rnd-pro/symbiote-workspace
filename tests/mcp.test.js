import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOLS } from '../runtime/index.js';
import { WORKSPACE_PACKAGE_KIND, WORKSPACE_PACKAGE_SCHEMA_VERSION } from '../sharing/index.js';

let __dirname = dirname(fileURLToPath(import.meta.url));
let MCP_SCRIPT = resolve(__dirname, '../mcp/index.js');
let PACKAGE_VERSION = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')).version;
let EXTERNAL_SENTIMENT_MODULE = {
  tagName: 'acme-sentiment-panel',
  provider: '@acme/workspace-pack',
  capabilities: ['analysis.sentiment', 'review.queue'],
  actions: [{ id: 'refresh', label: 'Refresh', command: 'sentiment.refresh' }],
  state: [{ id: 'selection', type: 'object', default: null }],
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
let MCP_PLUGIN_PACK = {
  name: '@acme/mcp-workspace-pack',
  version: '1.0.0',
  components: [
    'mcp-legacy-widget',
    EXTERNAL_SENTIMENT_MODULE,
  ],
  workspace: {
    templates: [EXTERNAL_ROOM_TEMPLATE],
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
 * @param {number} [sendDelay=100] - Delay between sent messages in ms
 * @returns {Promise<Object[]>} - Responses received
 */
function mcpSession(messages, timeout = 3000, sendDelay = 100) {
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
      delay += sendDelay;
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
    assert.equal(r.result.serverInfo.version, PACKAGE_VERSION);
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

    let expectedTools = new Map(TOOLS.map((tool) => [tool.name, tool]));
    let toolNames = new Set(toolList.result.tools.map((tool) => tool.name));
    assert.deepEqual(
      [...toolNames].sort(),
      [...expectedTools.keys()].sort(),
    );
    assert.equal(toolNames.has('classify_workspace'), true);
    assert.equal(toolNames.has('build_construction_questions'), true);
    assert.equal(toolNames.has('answer_construction_question'), true);
    assert.equal(toolNames.has('plan_workspace'), true);
    assert.equal(toolNames.has('construct_workspace'), true);
    assert.equal(toolNames.has('apply_workspace_patch'), true);
    assert.equal(toolNames.has('export_workspace'), true);
    assert.equal(toolNames.has('create_workspace_construction_handoff'), true);
    assert.equal(toolNames.has('collect_plugin_module_capabilities'), true);
    assert.equal(toolNames.has('collect_plugin_workspace_templates'), true);

    // Verify no internal fields leaked
    for (let tool of toolList.result.tools) {
      assert.equal(tool.mutates, undefined, `Tool ${tool.name} leaked 'mutates' field`);
      assert.equal(tool.writesFiles, undefined, `Tool ${tool.name} leaked 'writesFiles' field`);
      assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean');
      let expected = expectedTools.get(tool.name);
      assert.equal(
        tool.annotations.readOnlyHint,
        expected.mutates !== true && expected.writesFiles !== true,
        `Tool ${tool.name} readOnlyHint mismatch`,
      );
    }

    let saveConfig = toolList.result.tools.find((tool) => tool.name === 'save_config');
    let startPreview = toolList.result.tools.find((tool) => tool.name === 'start_preview');
    let listGroups = toolList.result.tools.find((tool) => tool.name === 'list_groups');
    let pluginModules = toolList.result.tools.find((tool) => (
      tool.name === 'collect_plugin_module_capabilities'
    ));
    let pluginTemplates = toolList.result.tools.find((tool) => (
      tool.name === 'collect_plugin_workspace_templates'
    ));
    let workspacePatchTools = [
      'propose_workspace_patch',
      'validate_workspace_patch',
      'apply_workspace_patch',
    ].map((name) => toolList.result.tools.find((tool) => tool.name === name));
    assert.equal(saveConfig.annotations.readOnlyHint, false);
    assert.equal(startPreview.annotations.readOnlyHint, false);
    assert.equal(listGroups.annotations.readOnlyHint, true);
    assert.equal(pluginModules.annotations.readOnlyHint, true);
    assert.equal(pluginTemplates.annotations.readOnlyHint, true);
    assert.equal(
      toolList.result.tools.find((tool) => tool.name === 'build_construction_questions')
        .annotations.readOnlyHint,
      true,
    );
    assert.equal(
      toolList.result.tools.find((tool) => tool.name === 'answer_construction_question')
        .annotations.readOnlyHint,
      true,
    );
    for (let tool of workspacePatchTools) {
      assert.deepEqual(tool.inputSchema.anyOf, [
        { required: ['overlay'] },
        { required: ['patch'] },
      ]);
    }
  });

  it('lists construction questionnaire tools with schemas', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    let tools = responses.find((r) => r.id === 2).result.tools;
    let buildTool = tools.find((tool) => tool.name === 'build_construction_questions');
    let answerTool = tools.find((tool) => tool.name === 'answer_construction_question');

    assert.ok(buildTool.inputSchema.properties.intent);
    assert.ok(buildTool.inputSchema.properties.workspaceTemplates);
    assert.deepEqual(buildTool.inputSchema.required, ['intent']);
    assert.equal(buildTool.annotations.readOnlyHint, true);
    assert.ok(answerTool.inputSchema.properties.questions);
    assert.ok(answerTool.inputSchema.properties.questionId);
    assert.ok(answerTool.inputSchema.properties.answer);
    assert.deepEqual(answerTool.inputSchema.required, ['questions', 'questionId', 'answer']);
    assert.equal(answerTool.annotations.readOnlyHint, true);
  });

  it('builds and answers construction questions via tools/call', async () => {
    let buildResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'build_construction_questions',
          arguments: { intent: 'chat workspace' },
        },
      },
    ]);
    let built = JSON.parse(buildResponses.find((r) => r.id === 2).result.content[0].text);

    assert.equal(built.status, 'ok');
    assert.equal(built.templateName, 'chat');
    assert.equal(built.nextAction, 'plan-workspace');
    assert.ok(built.questions.find((question) => question.id === 'theme-mode'));
    assert.equal(built.plan, undefined);
    assert.equal(built.config, undefined);

    let answerResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'answer_construction_question',
          arguments: {
            questions: built.questions,
            questionId: 'theme-mode',
            answer: 'custom',
          },
        },
      },
    ]);
    let answered = JSON.parse(answerResponses.find((r) => r.id === 2).result.content[0].text);

    assert.equal(answered.status, 'ok');
    assert.equal(answered.answeredQuestionId, 'theme-mode');
    assert.equal(answered.nextAction, 'plan-workspace');
    assert.equal(answered.questions.find((question) => question.id === 'theme-mode').answer, 'custom');
    assert.equal(answered.questions.find((question) => question.id === 'theme-hue').status, 'answered');
    assert.equal(answered.plan, undefined);
    assert.equal(answered.config, undefined);
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
    assert.deepEqual(constructContent.verification, constructContent.plan.verification);
    assert.deepEqual(constructContent.plan.answers.moduleSelection, ['imports', 'reply']);

    let exportResult = responses.find((r) => r.id === 3);
    assert.ok(exportResult);
    let exportContent = JSON.parse(exportResult.result.content[0].text);
    let exportedConfig = JSON.parse(exportContent.json);
    assert.equal(exportedConfig.name, 'MCP Constructed');
    assert.deepEqual(exportedConfig.construction.plan.capabilities.missing, []);
    assert.deepEqual(exportedConfig.validation.reports, constructContent.verification.reports);
  });

  it('rejects missing construction capabilities through tools/call without replacing session state', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'Existing MCP Config' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'plan_workspace',
          arguments: {
            intent: 'admin records workspace',
            template: 'admin',
            requiredCapabilities: ['admin.records'],
            answers: { 'module-selection': ['metric'] },
          },
        },
      },
      {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: {
          name: 'construct_workspace',
          arguments: {
            intent: 'admin records workspace',
            template: 'admin',
            requiredCapabilities: ['admin.records'],
            answers: { 'module-selection': ['metric'] },
          },
        },
      },
      {
        jsonrpc: '2.0', id: 5, method: 'tools/call',
        params: { name: 'export_workspace', arguments: {} },
      },
    ], 5000);

    let planResult = responses.find((r) => r.id === 3);
    assert.ok(planResult);
    let planContent = JSON.parse(planResult.result.content[0].text);
    assert.equal(planContent.status, 'ok');
    assert.deepEqual(planContent.plan.capabilities.selectedModules, [{
      panelType: 'metric',
      component: 'sn-metric',
      matchedCapabilities: [],
      missingCapabilities: ['admin.records'],
      coverageStatus: 'missing',
      selectionReason: 'user',
    }]);

    let constructResult = responses.find((r) => r.id === 4);
    assert.ok(constructResult);
    assert.equal(constructResult.result.isError, true);
    let constructContent = JSON.parse(constructResult.result.content[0].text);
    assert.equal(constructContent.status, 'error');
    assert.equal(constructContent.code, 'construction_capabilities_missing');
    assert.equal(constructContent.nextAction, 'provide-module-capabilities');
    assert.deepEqual(
      constructContent.readiness.missing.moduleCapabilities,
      ['admin.records'],
    );
    assert.deepEqual(constructContent.plan.capabilities.selectedModules, [{
      panelType: 'metric',
      component: 'sn-metric',
      matchedCapabilities: [],
      missingCapabilities: ['admin.records'],
      coverageStatus: 'missing',
      selectionReason: 'user',
    }]);
    assert.deepEqual(constructContent.readiness.recovery, [{
      kind: 'moduleCapabilities',
      item: 'admin.records',
      action: 'provide-module-capability',
      alternatives: [{
        panelType: 'records',
        component: 'sn-data-table',
        title: 'Records',
        score: 110,
        matchedCapabilities: ['admin.records'],
        relatedCapabilities: ['admin.bulk-actions'],
      }],
    }]);

    let exportResult = responses.find((r) => r.id === 5);
    assert.ok(exportResult);
    let exportContent = JSON.parse(exportResult.result.content[0].text);
    let exportedConfig = JSON.parse(exportContent.json);
    assert.equal(exportedConfig.name, 'Existing MCP Config');
  });

  it('rejects stale construction answer IDs through tools/call without replacing session state', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'Existing MCP Config' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'plan_workspace',
          arguments: {
            intent: 'chat workspace',
            answers: {
              'stale-question': 'value',
            },
          },
        },
      },
      {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'export_workspace', arguments: {} },
      },
    ], 5000);

    let planResult = responses.find((r) => r.id === 3);
    assert.ok(planResult);
    assert.equal(planResult.result.isError, true);
    let planContent = JSON.parse(planResult.result.content[0].text);
    assert.equal(planContent.status, 'error');
    assert.equal(planContent.tool, 'plan_workspace');
    assert.match(planContent.hint, /Unknown construction question "stale-question"/);

    let exportResult = responses.find((r) => r.id === 4);
    assert.ok(exportResult);
    let exportContent = JSON.parse(exportResult.result.content[0].text);
    let exportedConfig = JSON.parse(exportContent.json);
    assert.equal(exportedConfig.name, 'Existing MCP Config');
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
    assert.deepEqual(exportedConfig.state.fields, [{
      panelType: 'sentiment',
      component: 'acme-sentiment-panel',
      id: 'selection',
      type: 'object',
      path: 'state.sentiment.selection',
      default: null,
    }]);
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
    assert.equal(result.result.isError, true);
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

    let validateTool = toolList.result.tools.find((tool) => tool.name === 'validate_workspace_package');
    assert.ok(validateTool.inputSchema.properties.package);
    assert.ok(validateTool.inputSchema.properties.json);
    assert.deepEqual(validateTool.inputSchema.anyOf, [
      { required: ['package'] },
      { required: ['json'] },
    ]);
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

  it('processes stateful package import and export sequentially when messages arrive together', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'construct_workspace', arguments: {
          intent: 'chat workspace',
          template: 'chat',
          name: 'MCP Sequential Source',
        } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'export_workspace_package', arguments: { manifest: { id: 'com.example.mcp-sequential' } } },
      },
    ], 5000, 0);

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
        params: { name: 'export_workspace_package', arguments: { manifest: { id: 'com.example.mcp-sequential' } } },
      },
    ], 5000, 0);

    let reExportContent = JSON.parse(importResponses.find((r) => r.id === 3).result.content[0].text);
    assert.equal(reExportContent.status, 'ok');
    let reExportedPkg = JSON.parse(reExportContent.json);
    assert.equal(reExportedPkg.workspace.config.name, 'MCP Sequential Source');
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
    assert.equal(validateResult.result.isError, undefined);
    assert.equal(validateContent.status, 'ok');
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
    assert.equal(result.result.isError, true);
    assert.equal(content.status, 'error');
    assert.equal(content.tool, 'validate_workspace_package');
    assert.equal(content.valid, false);
    assert.equal(content.code, 'workspace_package_invalid');
    assert.equal(content.nextAction, 'fix-workspace-package');
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

  it('inspect_workspace_package missing package/json returns an MCP tool error', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'inspect_workspace_package',
          arguments: {},
        },
      },
    ]);

    let result = responses.find((r) => r.id === 2);
    assert.equal(result.result.isError, true);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'error');
    assert.equal(content.tool, 'inspect_workspace_package');
    assert.match(content.hint, /package or json/);
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

  it('create_workspace_package_construction_context missing package/json returns an MCP tool error', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_package_construction_context',
          arguments: {},
        },
      },
    ]);

    let result = responses.find((r) => r.id === 2);
    assert.equal(result.result.isError, true);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'error');
    assert.equal(content.tool, 'create_workspace_package_construction_context');
    assert.match(content.hint, /package or json/);
  });
});

describe('Plugin Metadata Collection via MCP', () => {
  it('collect_plugin_module_capabilities via tools/call returns validated module descriptors', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'collect_plugin_module_capabilities',
          arguments: { plugins: [MCP_PLUGIN_PACK] },
        },
      },
    ]);

    let result = responses.find((r) => r.id === 2);
    assert.ok(result);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.deepEqual(content.moduleCapabilities.map((item) => item.tagName), [
      'acme-sentiment-panel',
    ]);
  });

  it('collect_plugin_workspace_templates via tools/call returns portable templates', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'collect_plugin_workspace_templates',
          arguments: { plugins: [MCP_PLUGIN_PACK] },
        },
      },
    ]);

    let result = responses.find((r) => r.id === 2);
    assert.ok(result);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.deepEqual(content.templates.map((template) => template.name), [
      'mcp-voice-video-room',
    ]);
    assert.deepEqual(content.templates[0].source, {
      plugin: '@acme/mcp-workspace-pack',
      version: '1.0.0',
    });
  });

  it('plugin collector tools isolate unrelated section errors through MCP', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'collect_plugin_module_capabilities',
          arguments: {
            plugins: [{
              name: '@acme/mcp-section-isolated-components',
              version: '1.0.0',
              components: [EXTERNAL_SENTIMENT_MODULE],
              workspace: {
                templates: [{ name: 'Broken Template', config: EXTERNAL_ROOM_TEMPLATE.config }],
              },
            }],
          },
        },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'collect_plugin_workspace_templates',
          arguments: {
            plugins: [{
              name: '@acme/mcp-section-isolated-templates',
              version: '1.0.0',
              components: [{ tagName: 'Broken Component', actions: [{ id: 'open' }] }],
              workspace: {
                templates: [EXTERNAL_ROOM_TEMPLATE],
              },
            }],
          },
        },
      },
    ]);

    let moduleResult = responses.find((r) => r.id === 2);
    let templateResult = responses.find((r) => r.id === 3);
    assert.ok(moduleResult);
    assert.ok(templateResult);

    let moduleContent = JSON.parse(moduleResult.result.content[0].text);
    let templateContent = JSON.parse(templateResult.result.content[0].text);
    assert.equal(moduleContent.status, 'ok');
    assert.deepEqual(moduleContent.errors, []);
    assert.deepEqual(moduleContent.moduleCapabilities.map((item) => item.tagName), [
      'acme-sentiment-panel',
    ]);
    assert.equal(templateContent.status, 'ok');
    assert.deepEqual(templateContent.errors, []);
    assert.deepEqual(templateContent.templates.map((template) => template.name), [
      'mcp-voice-video-room',
    ]);
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
    assert.equal(content.nextAction, 'review-package-readiness');
    assert.equal(content.readiness.status, 'warning');
    assert.equal(content.readiness.nextAction, 'review-package-readiness');
    assert.equal(content.readiness.source.packageCount, 2);
    assert.ok(content.readiness.missingCount > 0);
    assert.ok(content.readiness.warningCount > 0);
    assert.equal(content.readiness.errorCount, 0);
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

describe('Construction Handoff via MCP', () => {
  it('lists create_workspace_construction_handoff in tools/list with schema and readOnlyHint', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    let toolList = responses.find((r) => r.id === 2);
    let tools = toolList.result.tools;
    let toolNames = new Set(tools.map((tool) => tool.name));
    assert.equal(toolNames.has('create_workspace_construction_handoff'), true);
    let tool = tools.find((t) => t.name === 'create_workspace_construction_handoff');
    assert.ok(tool.inputSchema.properties.context);
    assert.ok(tool.inputSchema.properties.intent);
    assert.deepEqual(tool.inputSchema.required, ['context']);
    assert.equal(tool.annotations.readOnlyHint, true);

    let planTool = tools.find((t) => t.name === 'plan_workspace');
    let constructTool = tools.find((t) => t.name === 'construct_workspace');
    assert.match(planTool.description, /readiness summary/);
    assert.match(constructTool.description, /structured readiness diagnostics/);
    assert.ok(planTool.inputSchema.properties.options);
    assert.ok(constructTool.inputSchema.properties.options);
    for (let tool of [planTool, constructTool]) {
      assert.deepEqual(tool.inputSchema.properties._type.enum, ['workspace-construction-handoff']);
      assert.ok(tool.inputSchema.properties.ready);
      assert.ok(tool.inputSchema.properties.missing);
      assert.ok(tool.inputSchema.properties.warnings);
      assert.ok(tool.inputSchema.properties.errors);
    }
  });

  it('create_workspace_construction_handoff via tools/call returns intent and options', async () => {
    let prepResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'scaffold_from_scratch', arguments: { name: 'MCP Handoff Prep' } },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'export_workspace_package',
          arguments: { manifest: { id: 'com.example.mcp-handoff' } },
        },
      },
    ], 5000);

    let exportContent = JSON.parse(prepResponses.find((r) => r.id === 3).result.content[0].text);
    let packageObj = JSON.parse(exportContent.json);

    let contextResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_package_construction_context',
          arguments: { package: packageObj },
        },
      },
    ]);

    let contextContent = JSON.parse(contextResponses.find((r) => r.id === 2).result.content[0].text);
    assert.equal(contextContent.status, 'ok');

    let handoffResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_construction_handoff',
          arguments: {
            context: contextContent,
            intent: { brief: 'MCP Handoff Workspace', template: 'review-package' },
          },
        },
      },
    ]);

    let result = handoffResponses.find((r) => r.id === 2);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.equal(content.valid, true);
    assert.equal(content.ready, true);
    assert.equal(content.readiness.nextAction, 'construct');
    assert.equal(content.nextAction, 'construct');
    assert.ok(content.intent);
    assert.equal(content.intent.template, 'review-package');
    assert.ok(content.options);
    assert.ok(content.options.workspaceTemplates.length > 0);
    assert.equal(content.errors.length, 0);
  });

  it('create_workspace_construction_handoff via tools/call returns structured invalid intent errors', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_construction_handoff',
          arguments: {
            context: { valid: true, ready: true },
            intent: {
              brief: 'Invalid MCP handoff',
              requiredCapabilities: ['valid', ''],
            },
          },
        },
      },
    ]);

    let result = responses.find((r) => r.id === 2);
    assert.equal(result.result.isError, true);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'error');
    assert.equal(content.tool, 'create_workspace_construction_handoff');
    assert.equal(content.code, 'construction_handoff_intent_invalid');
    assert.equal(content.nextAction, 'fix-construction-intent');
    assert.match(content.hint, /requiredCapabilities must contain non-empty strings/);
  });

  it('plan_workspace and construct_workspace accept handoff objects via tools/call', async () => {
    let handoffResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_construction_handoff',
          arguments: {
            context: {
              valid: true,
              ready: true,
              workspaceTemplates: [EXTERNAL_ROOM_TEMPLATE],
              moduleCapabilities: [],
              requiredCapabilities: ['room.command'],
              errors: [],
              warnings: [],
            },
            intent: { brief: 'MCP voice room', template: 'mcp-voice-video-room' },
          },
        },
      },
    ]);
    let handoff = JSON.parse(handoffResponses.find((r) => r.id === 2).result.content[0].text);
    assert.equal(handoff.status, 'ok');
    assert.equal(handoff._type, 'workspace-construction-handoff');

    let planResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'plan_workspace', arguments: handoff },
      },
    ]);
    let plan = JSON.parse(planResponses.find((r) => r.id === 2).result.content[0].text);
    assert.equal(plan.status, 'ok');
    assert.equal(plan.templateName, 'mcp-voice-video-room');
    assert.equal(plan.config.name, 'MCP Voice Video Room');
    assert.deepEqual(plan.verification, plan.plan.verification);
    assert.deepEqual(plan.config.validation.reports, plan.verification.reports);

    let constructResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'construct_workspace', arguments: handoff },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'export_workspace', arguments: {} },
      },
    ], 5000);
    let construct = JSON.parse(constructResponses.find((r) => r.id === 2).result.content[0].text);
    let exported = JSON.parse(constructResponses.find((r) => r.id === 3).result.content[0].text);
    let exportedConfig = JSON.parse(exported.json);

    assert.equal(construct.status, 'ok');
    assert.equal(construct.templateName, 'mcp-voice-video-room');
    assert.equal(exported.status, 'ok');
    assert.equal(exportedConfig.intent.template, 'mcp-voice-video-room');
  });

  it('plan_workspace and construct_workspace materialize real package-derived handoffs via tools/call', async () => {
    let sourceResponses = await mcpSession([
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
          arguments: { manifest: { id: 'com.example.mcp-real-handoff' } },
        },
      },
    ], 5000);
    let exportContent = JSON.parse(sourceResponses.find((r) => r.id === 3).result.content[0].text);
    assert.equal(exportContent.status, 'ok');

    let contextResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_package_construction_context',
          arguments: { json: exportContent.json },
        },
      },
    ]);
    let context = JSON.parse(contextResponses.find((r) => r.id === 2).result.content[0].text);
    assert.equal(context.status, 'ok');
    assert.equal(context.valid, true);
    assert.equal(context.ready, true);
    assert.equal(context.source.packageId, 'com.example.mcp-real-handoff');
    assert.equal(context.moduleCapabilities[0].tagName, 'acme-sentiment-panel');

    let handoffResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_construction_handoff',
          arguments: {
            context,
            intent: {
              brief: 'Build the packaged sentiment workspace.',
              template: context.workspaceTemplates[0].name,
            },
          },
        },
      },
    ]);
    let handoff = JSON.parse(handoffResponses.find((r) => r.id === 2).result.content[0].text);
    assert.equal(handoff.status, 'ok');
    assert.equal(handoff.valid, true);
    assert.equal(handoff.ready, true);
    assert.equal(handoff.readiness.nextAction, 'construct');
    assert.equal(handoff.nextAction, 'construct');

    let planResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'plan_workspace', arguments: handoff },
      },
    ]);
    let plan = JSON.parse(planResponses.find((r) => r.id === 2).result.content[0].text);
    assert.equal(plan.status, 'ok');
    assert.deepEqual(plan.plan.capabilities.missing, []);
    assert.equal(plan.config.panelTypes.sentiment.component, 'acme-sentiment-panel');
    assert.equal(plan.plan.packageContext.source.packageId, 'com.example.mcp-real-handoff');
    assert.equal(plan.plan.packageContext.readiness.nextAction, 'construct');
    assert.equal(plan.config.construction.packageContext.readiness.nextAction, 'construct');
    assert.deepEqual(plan.verification, plan.plan.verification);
    assert.deepEqual(plan.config.validation.reports, plan.verification.reports);

    let constructResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'construct_workspace', arguments: handoff },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'export_workspace', arguments: {} },
      },
    ], 5000);
    let construct = JSON.parse(constructResponses.find((r) => r.id === 2).result.content[0].text);
    let exported = JSON.parse(constructResponses.find((r) => r.id === 3).result.content[0].text);
    let exportedConfig = JSON.parse(exported.json);

    assert.equal(construct.status, 'ok');
    assert.deepEqual(construct.plan.capabilities.missing, []);
    assert.equal(exported.status, 'ok');
    assert.equal(exportedConfig.panelTypes.sentiment.component, 'acme-sentiment-panel');
    assert.ok(exportedConfig.components.catalog.includes('acme-sentiment-panel'));
    assert.ok(layoutReferencesPanel(exportedConfig.layout, 'sentiment'));
  });

  it('create_workspace_construction_handoff with invalid context returns errors via tools/call', async () => {
    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_construction_handoff',
          arguments: {
            context: { valid: false, errors: [{ path: 'kind', message: 'Invalid', severity: 'error' }] },
            intent: 'test',
          },
        },
      },
    ]);

    let result = responses.find((r) => r.id === 2);
    let content = JSON.parse(result.result.content[0].text);
    assert.equal(content.status, 'ok');
    assert.equal(content._type, 'workspace-construction-handoff');
    assert.equal(content.valid, false);
    assert.equal(content.ready, false);
    assert.equal(content.readiness.status, 'blocked');
    assert.equal(content.nextAction, 'fix-package-context');
    assert.ok(content.errors.length > 0);
    assert.deepEqual(content.options.workspaceTemplates, []);
  });

  it('plan_workspace and construct_workspace reject invalid handoff objects via tools/call', async () => {
    let handoffResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_construction_handoff',
          arguments: {
            context: {
              valid: false,
              ready: false,
              errors: [{ path: 'kind', message: 'Invalid package kind.', severity: 'error' }],
              warnings: [],
            },
            intent: { brief: 'MCP invalid chat handoff', template: 'chat' },
          },
        },
      },
    ]);
    let handoff = JSON.parse(handoffResponses.find((r) => r.id === 2).result.content[0].text);
    assert.equal(handoff.valid, false);

    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'plan_workspace', arguments: handoff },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'construct_workspace', arguments: handoff },
      },
    ]);

    let planResponse = responses.find((r) => r.id === 2);
    let constructResponse = responses.find((r) => r.id === 3);
    let plan = JSON.parse(planResponse.result.content[0].text);
    let construct = JSON.parse(constructResponse.result.content[0].text);
    assert.equal(planResponse.result.isError, true);
    assert.equal(plan.status, 'error');
    assert.equal(plan.tool, 'plan_workspace');
    assert.equal(plan.code, 'construction_handoff_invalid');
    assert.equal(plan.nextAction, 'fix-package-context');
    assert.match(plan.hint, /Construction handoff is invalid/);
    assert.match(plan.hint, /Invalid package kind/);
    assert.equal(plan.readiness.status, 'blocked');
    assert.equal(plan.readiness.errorCount, 1);
    assert.equal(constructResponse.result.isError, true);
    assert.equal(construct.status, 'error');
    assert.equal(construct.tool, 'construct_workspace');
    assert.equal(construct.code, 'construction_handoff_invalid');
    assert.equal(construct.nextAction, 'fix-package-context');
    assert.match(construct.hint, /Construction handoff is invalid/);
    assert.match(construct.hint, /Invalid package kind/);
    assert.equal(construct.readiness.status, 'blocked');
    assert.equal(construct.readiness.errorCount, 1);
  });

  it('construct_workspace rejects not-ready handoff objects via tools/call', async () => {
    let handoffResponses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_workspace_construction_handoff',
          arguments: {
            context: {
              valid: true,
              ready: false,
              workspaceTemplates: [EXTERNAL_ROOM_TEMPLATE],
              moduleCapabilities: [],
              requiredCapabilities: ['room.command'],
              missing: { components: ['sn-room-shell'] },
              errors: [],
              warnings: [{ path: 'available.components', message: 'Missing room shell.', severity: 'warning' }],
            },
            intent: { brief: 'MCP not ready room', template: 'mcp-voice-video-room' },
          },
        },
      },
    ]);
    let handoff = JSON.parse(handoffResponses.find((r) => r.id === 2).result.content[0].text);
    assert.equal(handoff.valid, true);
    assert.equal(handoff.ready, false);

    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'plan_workspace', arguments: handoff },
      },
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'construct_workspace', arguments: handoff },
      },
    ]);

    let constructResponse = responses.find((r) => r.id === 3);
    let plan = JSON.parse(responses.find((r) => r.id === 2).result.content[0].text);
    let construct = JSON.parse(constructResponse.result.content[0].text);
    assert.equal(plan.status, 'ok');
    assert.equal(plan.plan.readiness.package.status, 'warning');
    assert.equal(plan.readiness.status, plan.plan.readiness.package.status);
    assert.equal(plan.readiness.nextAction, plan.plan.readiness.package.nextAction);
    assert.deepEqual(plan.readiness.missing.components, ['sn-room-shell']);
    assert.deepEqual(plan.readiness.recovery, [{
      kind: 'components',
      item: 'sn-room-shell',
      action: 'register-component',
    }]);
    let packageReadinessReport = plan.verification.reports.find((report) => (
      report.check === 'package-readiness'
    ));
    assert.equal(packageReadinessReport.status, 'warn');
    assert.equal(packageReadinessReport.severity, 'warning');
    assert.equal(constructResponse.result.isError, true);
    assert.equal(construct.status, 'error');
    assert.equal(construct.tool, 'construct_workspace');
    assert.equal(construct.code, 'construction_handoff_not_ready');
    assert.equal(construct.nextAction, 'review-package-readiness');
    assert.match(construct.hint, /Construction handoff is not ready/);
    assert.match(construct.hint, /sn-room-shell/);
    assert.equal(construct.readiness.ready, false);
    assert.equal(construct.readiness.valid, true);
    assert.equal(construct.readiness.status, 'warning');
    assert.equal(construct.readiness.missingCount, 1);
    assert.equal(construct.readiness.warningCount, 1);
    assert.equal(construct.readiness.errorCount, 0);
    assert.deepEqual(construct.readiness.missing.components, ['sn-room-shell']);
    assert.deepEqual(construct.readiness.recovery, [{
      kind: 'components',
      item: 'sn-room-shell',
      action: 'register-component',
    }]);
  });

  it('construct_workspace rejects nested packageContext readiness gaps via tools/call', async () => {
    let handoff = {
      _type: 'workspace-construction-handoff',
      intent: { brief: 'MCP direct package context room', template: 'mcp-voice-video-room' },
      options: {
        packageContext: {
          valid: true,
          ready: false,
          missing: { components: ['sn-direct-room-shell'] },
          warnings: [{ path: 'available.components', message: 'Missing direct room shell.', severity: 'warning' }],
        },
      },
    };

    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'construct_workspace', arguments: handoff },
      },
    ]);

    let constructResponse = responses.find((r) => r.id === 2);
    let construct = JSON.parse(constructResponse.result.content[0].text);
    assert.equal(constructResponse.result.isError, true);
    assert.equal(construct.status, 'error');
    assert.equal(construct.code, 'construction_handoff_not_ready');
    assert.equal(construct.nextAction, 'review-package-readiness');
    assert.equal(construct.readiness.ready, false);
    assert.equal(construct.readiness.missingCount, 1);
    assert.deepEqual(construct.readiness.recovery, [{
      kind: 'components',
      item: 'sn-direct-room-shell',
      action: 'register-component',
    }]);
  });

  it('construct_workspace rejects bare options packageContext readiness gaps via tools/call', async () => {
    let payload = {
      intent: { brief: 'MCP options package context room', template: 'mcp-voice-video-room' },
      options: {
        packageContext: {
          valid: true,
          ready: false,
          missing: { components: ['sn-options-room-shell'] },
          warnings: [{ path: 'available.components', message: 'Missing options room shell.', severity: 'warning' }],
        },
      },
    };

    let responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'construct_workspace', arguments: payload },
      },
    ]);

    let constructResponse = responses.find((r) => r.id === 2);
    let construct = JSON.parse(constructResponse.result.content[0].text);
    assert.equal(constructResponse.result.isError, true);
    assert.equal(construct.status, 'error');
    assert.equal(construct.code, 'construction_handoff_not_ready');
    assert.equal(construct.nextAction, 'review-package-readiness');
    assert.equal(construct.readiness.ready, false);
    assert.equal(construct.readiness.missingCount, 1);
    assert.deepEqual(construct.readiness.recovery, [{
      kind: 'components',
      item: 'sn-options-room-shell',
      action: 'register-component',
    }]);
  });
});
