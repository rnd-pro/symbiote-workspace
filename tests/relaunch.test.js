import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mountWorkspace } from '../browser.js';
import { listTemplates, planWorkspaceConstruction } from '../constructor/index.js';
import { loadWorkspaceConfig } from '../loader/index.js';
import { createSession, dispatch } from '../runtime/index.js';
import {
  createHostIntegrationContract,
  exportConfig,
  importConfig,
} from '../sharing/index.js';
import { collectPluginWorkspaceTemplates } from '../plugins/index.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/index.js';

class TestStyle {
  values = new Map();

  setProperty(name, value) {
    this.values.set(name, String(value));
  }
}

class TestElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = new TestStyle();
    this.className = '';
    this.listeners = new Map();
  }

  appendChild(child) {
    if (child?.isFragment) {
      for (let item of [...child.children]) this.appendChild(item);
      child.children = [];
      return child;
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  addEventListener(type, listener) {
    let listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    let listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((item) => item !== listener));
  }

  matches(selector) {
    if (selector.startsWith('.')) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    return this.tagName === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    let results = [];
    for (let child of this.children) {
      if (child.matches(selector)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }
}

class TestDocument {
  createElement(tagName) {
    return new TestElement(tagName, this);
  }

  createDocumentFragment() {
    return {
      isFragment: true,
      children: [],
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    };
  }
}

function createContainer() {
  let document = new TestDocument();
  return document.createElement('main');
}

function createThemeAdapter() {
  return {
    applyCascadeTheme(element, options) {
      if (options.hue !== undefined) element.style.setProperty('--sn-theme-hue', options.hue);
      return { state: options, tokens: {} };
    },
  };
}

function roomModule(tagName, capabilities, options = {}) {
  return {
    tagName,
    schemaVersion: '0.1.0',
    provider: 'portable-collaboration-room-pack',
    descriptor: {
      schemaVersion: '2.0.0',
      package: 'portable-collaboration-room-pack',
      component: tagName,
    },
    capabilities,
    ...options,
  };
}

const COLLABORATION_ROOM_PLUGIN = {
  name: 'portable-collaboration-room-pack',
  version: '1.0.0',
  workspace: {
    templates: [
      {
        name: 'ai-command-chat',
        description: 'AI command chat with transcript, command input, and shared context.',
        config: {
          version: WORKSPACE_SCHEMA_VERSION,
          name: 'AI Command Chat',
          register: 'agent-workspace',
          groups: [{ id: 'chat', name: 'Chat', icon: 'forum' }],
          sections: [{ id: 'command', label: 'Command', icon: 'terminal', order: 0, groupId: 'chat' }],
          panelTypes: {
            transcript: { title: 'Transcript', icon: 'chat', component: 'ai-chat-transcript' },
            command: { title: 'Command', icon: 'terminal', component: 'ai-command-composer' },
            context: { title: 'Context', icon: 'fact_check', component: 'ai-room-context' },
          },
          layout: {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.68,
            first: {
              type: 'split',
              direction: 'vertical',
              ratio: 0.78,
              first: { type: 'panel', panelType: 'transcript' },
              second: { type: 'panel', panelType: 'command' },
            },
            second: { type: 'panel', panelType: 'context' },
          },
          components: {
            catalog: ['ai-chat-transcript', 'ai-command-composer', 'ai-room-context'],
            modules: [
              roomModule('ai-chat-transcript', ['chat.transcript', 'agent.messages'], {
                bindings: [{ id: 'messages', direction: 'input', path: 'data.messages' }],
                events: { emits: [{ name: 'message-select' }] },
              }),
              roomModule('ai-command-composer', ['chat.command', 'agent.command-input'], {
                actions: [{ id: 'send-command', label: 'Send', command: 'agent.command.send' }],
                bindings: [{ id: 'draft', direction: 'two-way', path: 'data.commandDraft' }],
                events: { emits: [{ name: 'command-submit' }] },
                runtimeSlots: [{ id: 'agent-runtime', role: 'provider', required: true }],
                requiredHostServices: ['agent.runtime'],
              }),
              roomModule('ai-room-context', ['room.context', 'artifact.preview'], {
                bindings: [{ id: 'context', direction: 'input', path: 'data.context' }],
                requiredHostServices: ['storage.project'],
              }),
            ],
          },
        },
      },
      {
        name: 'ai-team-room',
        description: 'AI team room with participants, transcript, commands, and artifacts.',
        config: {
          version: WORKSPACE_SCHEMA_VERSION,
          name: 'AI Team Room',
          register: 'agent-workspace',
          groups: [{ id: 'room', name: 'Room', icon: 'groups' }],
          sections: [{ id: 'session', label: 'Session', icon: 'forum', order: 0, groupId: 'room' }],
          panelTypes: {
            transcript: { title: 'Transcript', icon: 'chat', component: 'team-room-transcript' },
            command: { title: 'Command', icon: 'terminal', component: 'team-room-command' },
            artifacts: { title: 'Artifacts', icon: 'inventory_2', component: 'team-room-artifacts' },
            participants: { title: 'Participants', icon: 'group', component: 'team-room-participants' },
          },
          layout: {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.72,
            first: {
              type: 'split',
              direction: 'vertical',
              ratio: 0.7,
              first: { type: 'panel', panelType: 'transcript' },
              second: { type: 'panel', panelType: 'command' },
            },
            second: {
              type: 'split',
              direction: 'vertical',
              ratio: 0.5,
              first: { type: 'panel', panelType: 'participants' },
              second: { type: 'panel', panelType: 'artifacts' },
            },
          },
          components: {
            catalog: [
              'team-room-transcript',
              'team-room-command',
              'team-room-artifacts',
              'team-room-participants',
            ],
            modules: [
              roomModule('team-room-transcript', ['room.transcript', 'agent.messages'], {
                bindings: [{ id: 'messages', direction: 'input', path: 'data.messages' }],
                events: { emits: [{ name: 'message-select' }] },
              }),
              roomModule('team-room-command', ['room.command', 'agent.command-input'], {
                actions: [{ id: 'route-command', label: 'Route', command: 'agent.command.route' }],
                bindings: [{ id: 'draft', direction: 'two-way', path: 'data.commandDraft' }],
                runtimeSlots: [{ id: 'agent-runtime', role: 'provider', required: true }],
                requiredHostServices: ['agent.runtime'],
              }),
              roomModule('team-room-artifacts', ['room.artifacts', 'artifact.preview'], {
                bindings: [{ id: 'artifacts', direction: 'input', path: 'data.artifacts' }],
                requiredHostServices: ['storage.project'],
              }),
              roomModule('team-room-participants', ['room.participants', 'presence.roster'], {
                bindings: [{ id: 'participants', direction: 'input', path: 'data.participants' }],
                events: { emits: [{ name: 'participant-select' }] },
                requiredHostServices: ['presence.session'],
              }),
            ],
          },
        },
      },
      {
        name: 'voice-video-room',
        description: 'Voice and video AI room with realtime media, transcript, and command controls.',
        config: {
          version: WORKSPACE_SCHEMA_VERSION,
          name: 'Voice Video Room',
          register: 'agent-workspace',
          groups: [{ id: 'call', name: 'Call', icon: 'video_call' }],
          sections: [{ id: 'live', label: 'Live', icon: 'video_call', order: 0, groupId: 'call' }],
          panelTypes: {
            stage: { title: 'Stage', icon: 'video_call', component: 'room-media-stage' },
            controls: { title: 'Controls', icon: 'settings_voice', component: 'room-call-controls' },
            transcript: { title: 'Transcript', icon: 'subtitles', component: 'room-call-transcript' },
            command: { title: 'Command', icon: 'terminal', component: 'room-call-command' },
          },
          layout: {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.68,
            first: {
              type: 'split',
              direction: 'vertical',
              ratio: 0.78,
              first: { type: 'panel', panelType: 'stage' },
              second: { type: 'panel', panelType: 'controls' },
            },
            second: {
              type: 'split',
              direction: 'vertical',
              ratio: 0.58,
              first: { type: 'panel', panelType: 'transcript' },
              second: { type: 'panel', panelType: 'command' },
            },
          },
          components: {
            catalog: ['room-media-stage', 'room-call-controls', 'room-call-transcript', 'room-call-command'],
            modules: [
              roomModule('room-media-stage', ['room.video', 'room.audio', 'media.realtime'], {
                bindings: [{ id: 'participants', direction: 'input', path: 'data.participants' }],
                runtimeSlots: [{ id: 'media-session', role: 'provider', required: true }],
                requiredHostServices: ['media.realtime', 'presence.session'],
              }),
              roomModule('room-call-controls', ['call.controls', 'room.audio'], {
                actions: [
                  { id: 'join-call', label: 'Join', command: 'call.join' },
                  { id: 'leave-call', label: 'Leave', command: 'call.leave' },
                  { id: 'toggle-mute', label: 'Mute', command: 'call.audio.toggle' },
                ],
                settings: [{ id: 'audio-device', label: 'Audio Device', type: 'string' }],
                requiredHostServices: ['media.realtime'],
              }),
              roomModule('room-call-transcript', ['room.transcript', 'agent.messages'], {
                bindings: [{ id: 'messages', direction: 'input', path: 'data.messages' }],
                requiredHostServices: ['storage.project'],
              }),
              roomModule('room-call-command', ['room.command', 'agent.command-input'], {
                actions: [{ id: 'send-command', label: 'Send', command: 'agent.command.send' }],
                runtimeSlots: [{ id: 'agent-runtime', role: 'provider', required: true }],
                requiredHostServices: ['agent.runtime'],
              }),
            ],
          },
        },
      },
    ],
  },
};

function collectCatalogTags(config) {
  let tags = new Set(config.components?.catalog || []);
  for (let panelType of Object.values(config.panelTypes || {})) {
    if (panelType.component) tags.add(panelType.component);
  }
  for (let descriptor of config.components?.modules || []) {
    if (descriptor.tagName) tags.add(descriptor.tagName);
  }
  return tags;
}

function catalogForConfig(config) {
  let tags = collectCatalogTags(config);
  return {
    has: (tag) => tags.has(tag),
    list: () => [...tags],
  };
}

function assertRelaunchable(config, label) {
  let exported = exportConfig(config, { strict: true });
  assert.ok(exported.json, `${label} exports strict portable JSON`);

  let imported = importConfig(exported.json);
  assert.ok(imported.config, `${label} imports from exported JSON`);
  assert.deepEqual(imported.errors, []);

  let catalog = catalogForConfig(imported.config);
  let loaded = loadWorkspaceConfig(imported.config, { catalog, strict: true });
  assert.equal(loaded.valid, true, `${label} loads with strict component resolution`);
  assert.deepEqual(loaded.missingComponents, []);

  let container = createContainer();
  let mounted = mountWorkspace(imported.config, container, {
    catalog,
    strictComponents: true,
    themeAdapter: createThemeAdapter(),
  });
  assert.equal(mounted.element.dataset.workspaceName, imported.config.name);
  mounted.destroy();
  assert.equal(container.children.length, 0);

  let reexported = exportConfig(imported.config, { strict: true });
  assert.equal(reexported.json, exported.json, `${label} re-exports deterministically`);
}

describe('portable workspace relaunch', () => {
  it('relaunches every canonical template after strict export and import', () => {
    for (let template of listTemplates()) {
      let { config } = planWorkspaceConstruction(`${template} workspace`, { template });
      assertRelaunchable(config, template);
    }
  });

  it('relaunches a constructed workspace through a fresh dispatch session', async () => {
    let session = createSession();
    await dispatch('construct_workspace', {
      intent: 'agent review workspace',
      template: 'agent-workspace',
      name: 'Portable Agent Review',
      requiredCapabilities: ['agent.review', 'workflow.node-editor'],
    }, session);

    let exported = await dispatch('export_workspace', { strict: true }, session);
    assert.equal(exported.status, 'ok');

    let relaunched = createSession();
    let imported = await dispatch('import_config', { json: exported.json }, relaunched);
    assert.equal(imported.status, 'ok');

    assertRelaunchable(relaunched.config, 'dispatch relaunch');

    let reexported = await dispatch('export_workspace', { strict: true }, relaunched);
    assert.equal(reexported.status, 'ok');
    assert.equal(reexported.json, exported.json);
  });

  it('relaunches neutral collaboration room templates from plugin metadata', () => {
    let templates = collectPluginWorkspaceTemplates([COLLABORATION_ROOM_PLUGIN]);
    assert.equal(templates.ok, true, JSON.stringify(templates.errors));

    let scenarios = [
      {
        template: 'ai-command-chat',
        brief: 'AI command chat for shared work',
        requiredCapabilities: ['chat.command', 'chat.transcript', 'room.context'],
        services: ['agent.runtime', 'storage.project'],
        slots: ['agent-runtime'],
      },
      {
        template: 'ai-team-room',
        brief: 'AI team room with commands and artifacts',
        requiredCapabilities: ['room.command', 'room.transcript', 'room.artifacts', 'room.participants'],
        services: ['agent.runtime', 'presence.session', 'storage.project'],
        slots: ['agent-runtime'],
      },
      {
        template: 'voice-video-room',
        brief: 'voice video room with command controls',
        requiredCapabilities: ['call.controls', 'room.audio', 'room.command', 'room.transcript', 'room.video'],
        services: ['agent.runtime', 'media.realtime', 'presence.session', 'storage.project'],
        slots: ['agent-runtime', 'media-session'],
      },
    ];

    for (let scenario of scenarios) {
      let { config, plan } = planWorkspaceConstruction({
        brief: scenario.brief,
        template: scenario.template,
        requiredCapabilities: scenario.requiredCapabilities,
      }, {
        workspaceTemplates: templates.templates,
      });

      assert.deepEqual(plan.capabilities.missing, [], `${scenario.template} covers required capabilities`);
      assertRelaunchable(config, scenario.template);

      let contract = createHostIntegrationContract(config);
      assert.equal(contract.status, 'ok', `${scenario.template} host contract status`);
      assert.deepEqual(contract.errors, []);
      for (let service of scenario.services) {
        assert.ok(contract.contract.services.required.includes(service), `${scenario.template} requires ${service}`);
      }
      for (let slot of scenario.slots) {
        assert.ok(
          contract.contract.runtimeSlots.required.some((entry) => entry.id === slot),
          `${scenario.template} requires runtime slot ${slot}`,
        );
      }
      assert.doesNotMatch(
        JSON.stringify(config),
        /https?:|file:\/\/|\/Users\/|billing|subscription|organization|recording|marketplace|license|seller|purchase/i,
        `${scenario.template} stays portable and product-neutral`,
      );
      assert.doesNotMatch(JSON.stringify(contract.contract), /https?:|file:\/\/|\/Users\//);
    }
  });

  it('strict export rejects host-only state before sanitizing output', () => {
    let { config } = planWorkspaceConstruction('agent review workspace', {
      template: 'agent-workspace',
    });

    let result = exportConfig({
      ...config,
      host: { sessionId: 'abc123' },
      runtime: {
        server_url: 'prod-primary',
        apiEndpoint: 'internal-api',
      },
      construction: {
        ...config.construction,
        plan: {
          ...config.construction.plan,
          localFile: '/Users/example/workspace/private.json',
        },
      },
    }, { strict: true });

    assert.equal(result.json, null);
    assert.ok(result.errors.some((error) => error.path === 'host'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.server_url'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.apiEndpoint'));
    assert.ok(result.errors.some((error) => error.path === 'construction.plan.localFile'));
  });
});

describe('host integration contract', () => {
  it('describes chat construction, standalone browser, and persistence contracts', () => {
    let { config } = planWorkspaceConstruction('agent review workspace', {
      template: 'agent-workspace',
      requiredCapabilities: ['agent.review', 'workflow.node-editor'],
    });

    let result = createHostIntegrationContract(config);

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.contract.chatConstruction.requiredTools, [
      'classify_workspace',
      'plan_workspace',
      'construct_workspace',
      'validate_workspace_patch',
      'apply_workspace_patch',
      'export_workspace',
      'import_config',
    ]);
    assert.deepEqual(result.contract.browser.requiredImports, [
      'symbiote-workspace/browser',
      'symbiote-ui',
    ]);
    assert.equal(result.contract.browser.importMap.required, true);
    assert.equal(result.contract.browser.importMap.scriptType, 'importmap');
    assert.equal(result.contract.browser.importMap.mustLoadBeforeModuleScript, true);
    assert.equal(result.contract.browser.mountFunction, 'mountWorkspace');
    assert.equal(result.contract.browser.themeAdapter, 'symbiote-ui.applyCascadeTheme');
    assert.ok(result.contract.persistence.requiredTools.includes('export_config'));
    assert.ok(result.contract.persistence.requiredTools.includes('import_config'));
    assert.deepEqual(result.contract.persistence.requiredEngineServices, ['storage.project']);
    assert.deepEqual(result.contract.persistence.optionalEngineServices, []);
    assert.equal(result.contract.persistence.optionalEngineService, undefined);
    assert.ok(result.contract.services.required.includes('agent.runtime'));
    assert.ok(result.contract.services.required.includes('storage.project'));
    assert.ok(result.contract.runtimeSlots.required.some((slot) => slot.id === 'agent-runtime'));
    assert.doesNotMatch(JSON.stringify(result.contract), /https?:|file:\/\/|\/Users\//);
  });

  it('does not invent engine persistence services for storage-free configs', () => {
    let result = createHostIntegrationContract({
      version: '0.3.0',
      name: 'Storage Free',
      register: 'tool',
    });

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.contract.services.required, []);
    assert.deepEqual(result.contract.persistence.requiredEngineServices, []);
    assert.deepEqual(result.contract.persistence.optionalEngineServices, []);
    assert.equal(result.contract.persistence.optionalEngineService, undefined);
  });

  it('derives persistence services from module host service declarations', () => {
    let result = createHostIntegrationContract({
      version: '0.3.0',
      name: 'Mixed Services',
      register: 'tool',
      components: {
        modules: [{
          tagName: 'data-panel',
          requiredHostServices: ['storage.project', 'agent.runtime'],
        }],
      },
      construction: {
        plan: {
          answers: { moduleSelection: ['archive-panel'] },
          modules: [{
            tagName: 'archive-panel',
            requiredHostServices: ['storage.archive', 'storage.project'],
          }],
        },
      },
    });

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.contract.persistence.requiredEngineServices, [
      'storage.archive',
      'storage.project',
    ]);
    assert.deepEqual(result.contract.persistence.optionalEngineServices, []);
    assert.equal(result.contract.browser.importMap.imports, undefined);
  });

  it('scopes host requirements to selected construction plan modules', () => {
    let { config } = planWorkspaceConstruction({
      brief: 'AI command chat with transcript only',
      template: 'ai-command-chat',
      requiredCapabilities: ['chat.transcript'],
    }, {
      workspaceTemplates: collectPluginWorkspaceTemplates([COLLABORATION_ROOM_PLUGIN]).templates,
    });

    let result = createHostIntegrationContract(config);

    assert.equal(result.status, 'ok');
    assert.deepEqual(config.construction.plan.modules.map((module) => module.panelType), ['transcript']);
    assert.deepEqual(result.contract.services.required, []);
    assert.deepEqual(result.contract.services.byModule, []);
    assert.deepEqual(result.contract.runtimeSlots.required, []);
    assert.deepEqual(result.contract.persistence.requiredEngineServices, []);
  });

  it('does not fall back to catalog requirements for explicit empty module selections', () => {
    let result = createHostIntegrationContract({
      version: '0.3.0',
      name: 'Empty Selection',
      register: 'tool',
      components: {
        modules: [{
          tagName: 'agent-runtime-panel',
          requiredHostServices: ['agent.runtime'],
          runtimeSlots: [{ id: 'agent-runtime', role: 'provider', required: true }],
        }],
      },
      construction: {
        plan: {
          answers: { moduleSelection: [] },
          modules: [],
        },
      },
    });

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.contract.services.required, []);
    assert.deepEqual(result.contract.runtimeSlots.required, []);
  });

  it('reports invalid configs instead of fabricating a host contract', () => {
    let result = createHostIntegrationContract({ name: 'Missing Version' });

    assert.equal(result.status, 'error');
    assert.equal(result.contract, null);
    assert.ok(result.errors.some((error) => error.path === 'version'));
  });

  it('rejects non-portable runtime slot IDs from construction plans', () => {
    let { config } = planWorkspaceConstruction('agent review workspace', {
      template: 'agent-workspace',
      requiredCapabilities: ['agent.review'],
    });

    let result = createHostIntegrationContract({
      ...config,
      construction: {
        ...config.construction,
        plan: {
          ...config.construction.plan,
          modules: [{
            ...config.construction.plan.modules[0],
            runtimeSlots: [{ id: 'Agent Runtime', role: 'provider', required: true }],
          }],
        },
      },
    });

    assert.equal(result.status, 'error');
    assert.equal(result.contract, null);
    assert.ok(result.errors.some((error) => (
      error.path === 'construction.plan.modules[0].runtimeSlots[0].id'
    )));
  });
});
