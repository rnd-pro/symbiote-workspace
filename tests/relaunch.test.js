import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mountWorkspace } from '../browser.js';
import { listTemplates, planWorkspaceConstruction } from '../constructor/index.js';
import { loadWorkspaceConfig } from '../loader/index.js';
import { createSession, dispatch } from '../runtime/index.js';
import {
  BROWSER_REQUIRED_IMPORTS,
  createHostIntegrationContract,
  exportConfig,
  exportWorkspacePackage,
  importConfig,
  importWorkspacePackage,
  validateWorkspacePackage,
} from '../sharing/index.js';
import { collectPluginWorkspaceTemplates } from '../plugins/index.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/index.js';
import { buildRealtimeChatStateDemo } from '../examples/visual-demo/realtime-builder.js';
import { buildChatFirstWorkspace } from '../examples/visual-demo/chat-builder-state.js';

function fixtureHomePath(...parts) {
  return ['', 'Users', ...parts].join('/');
}

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

function dispatchMutation(toolName, args, session) {
  return dispatch(toolName, { ...args, baseRevision: session.revision ?? 0 }, session);
}

const COLLABORATION_ROOM_PACKAGE = 'portable-collaboration-room-pack';

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function roomModuleId(tagName) {
  return `${COLLABORATION_ROOM_PACKAGE}:${tagName}`;
}

function hostCommandAction(id, label, command) {
  return { id, label, does: { kind: 'command', scope: 'host', command } };
}

function roomModule(tagName, capabilities, options = {}) {
  return {
    id: roomModuleId(tagName),
    source: { kind: 'package', package: COLLABORATION_ROOM_PACKAGE },
    tagName,
    schemaVersion: '0.2.0',
    provider: COLLABORATION_ROOM_PACKAGE,
    descriptor: {
      schemaVersion: '2.0.0',
      package: COLLABORATION_ROOM_PACKAGE,
      component: tagName,
    },
    capabilities,
    hostServices: { required: [], optional: [] },
    ...options,
  };
}

function panelLeaf(panel) {
  return { type: 'panel', id: `${panel}-node`, panel };
}

function splitNode(id, direction, ratio, first, second) {
  return { type: 'split', id, direction, ratio, first, second };
}

function roomPanel(tagName, title, icon) {
  return { module: roomModuleId(tagName), title, icon };
}

function requiredHostServicesFor(modules) {
  let services = [];
  for (let module of modules) {
    for (let service of module.hostServices?.required || []) services.push(service);
  }
  return [...new Set(services)].sort((a, b) => a.localeCompare(b));
}

function roomTemplateConfig({ name, navGroup, view, panels, layout, modules }) {
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    name,
    register: 'agent-workspace',
    nav: { groups: [navGroup] },
    views: [{
      id: view.id,
      title: view.title,
      icon: view.icon,
      nav: { group: navGroup.id, order: view.order ?? 0 },
      layout: { $layout: 'main' },
    }],
    panels,
    layouts: {
      main: { kind: 'bsp', root: layout },
    },
    modules,
    requires: {
      packages: [{ id: COLLABORATION_ROOM_PACKAGE, version: '^1.0.0' }],
      hostServices: { required: requiredHostServicesFor(modules), optional: [] },
    },
  };
}

function labelText(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value?.default) return value.default;
  if (value?.$t) return value.$t;
  return fallback;
}

function legacyLayoutNode(node) {
  if (!node) return null;
  if (node.type === 'panel') return { type: 'panel', panelType: node.panel };
  if (node.type === 'split') {
    return {
      type: 'split',
      direction: node.direction,
      ratio: node.ratio,
      first: legacyLayoutNode(node.first),
      second: legacyLayoutNode(node.second),
    };
  }
  return cloneJson(node);
}

function constructorTemplateConfig(config) {
  let modules = config.modules || [];
  let modulesById = new Map(modules.map((module) => [module.id, module]));
  let layouts = Object.fromEntries(
    Object.entries(config.layouts || {})
      .map(([id, layout]) => [id, legacyLayoutNode(layout.root || layout)])
      .filter(([, layout]) => layout),
  );
  let firstView = config.views?.[0];
  let defaultLayoutId = firstView?.layout?.$layout || Object.keys(layouts)[0];

  return {
    version: config.version,
    name: config.name,
    register: config.register,
    groups: (config.nav?.groups || []).map((group) => ({
      id: group.id,
      name: labelText(group.title, group.id),
      icon: group.icon,
      ...(group.order !== undefined ? { order: group.order } : {}),
    })),
    sections: (config.views || []).map((view) => ({
      id: view.id,
      label: labelText(view.title, view.id),
      icon: view.icon,
      order: view.nav?.order ?? 0,
      groupId: view.nav?.group,
      layoutId: view.layout?.$layout || defaultLayoutId,
    })),
    panelTypes: Object.fromEntries(
      Object.entries(config.panels || {}).map(([panelType, panel]) => {
        let module = modulesById.get(panel.module) || {};
        return [panelType, {
          title: labelText(panel.title, panelType),
          icon: panel.icon,
          component: module.tagName || panel.module,
          ...(panel.behavior ? { behavior: cloneJson(panel.behavior) } : {}),
        }];
      }),
    ),
    ...(defaultLayoutId && layouts[defaultLayoutId] ? { layout: cloneJson(layouts[defaultLayoutId]) } : {}),
    ...(Object.keys(layouts).length ? { layouts } : {}),
    components: {
      catalog: modules.map((module) => module.tagName).filter(Boolean),
      modules: cloneJson(modules),
    },
  };
}

function constructorWorkspaceTemplates(templates) {
  return templates.map((template) => ({
    ...template,
    config: constructorTemplateConfig(template.config),
  }));
}

function collectDeletedTemplateConfigKeyPaths(config) {
  let paths = [];
  for (let key of ['groups', 'sections', 'panelTypes', 'layout']) {
    if (Object.hasOwn(config, key)) paths.push(key);
  }
  if (Object.hasOwn(config.components || {}, 'catalog')) paths.push('components.catalog');
  if (Object.hasOwn(config.components || {}, 'modules')) paths.push('components.modules');

  function visit(value, path = '') {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (let [key, child] of Object.entries(value)) {
      let childPath = path ? `${path}.${key}` : key;
      if (key === 'requiredHostServices') paths.push(childPath);
      visit(child, childPath);
    }
  }

  visit(config);
  return paths;
}

function assertNoDeletedTemplateConfigKeys(templates) {
  for (let template of templates) {
    assert.deepEqual(
      collectDeletedTemplateConfigKeyPaths(template.config),
      [],
      `${template.name} template config uses deleted keys`,
    );
  }
}

const COLLABORATION_ROOM_PLUGIN = {
  name: COLLABORATION_ROOM_PACKAGE,
  version: '1.0.0',
  contributes: {
    templates: [
      {
        name: 'ai-command-chat',
        description: 'AI command chat with transcript, command input, and shared context.',
        config: {
          ...roomTemplateConfig({
            name: 'AI Command Chat',
            navGroup: { id: 'chat', title: 'Chat', icon: 'forum', order: 0 },
            view: { id: 'command', title: 'Command', icon: 'terminal', order: 0 },
            panels: {
              transcript: roomPanel('ai-chat-transcript', 'Transcript', 'chat'),
              command: roomPanel('ai-command-composer', 'Command', 'terminal'),
              context: roomPanel('ai-room-context', 'Context', 'fact_check'),
            },
            layout: splitNode(
              'command-root',
              'horizontal',
              0.68,
              splitNode('command-main', 'vertical', 0.78, panelLeaf('transcript'), panelLeaf('command')),
              panelLeaf('context'),
            ),
            modules: [
              roomModule('ai-chat-transcript', ['chat.transcript', 'agent.messages'], {
                bindings: [{ id: 'messages', direction: 'input', path: 'data.messages' }],
                events: { emits: [{ name: 'message-select' }] },
              }),
              roomModule('ai-command-composer', ['chat.command', 'agent.command-input'], {
                actions: [hostCommandAction('send-command', 'Send', 'agent.command.send')],
                bindings: [{ id: 'draft', direction: 'two-way', path: 'data.commandDraft' }],
                events: { emits: [{ name: 'command-submit' }] },
                runtimeSlots: [{ id: 'agent-runtime', role: 'provider', required: true }],
                hostServices: { required: ['agent.runtime'], optional: [] },
              }),
              roomModule('ai-room-context', ['room.context', 'artifact.preview'], {
                bindings: [{ id: 'context', direction: 'input', path: 'data.context' }],
                hostServices: { required: ['storage.project'], optional: [] },
              }),
            ],
          }),
        },
      },
      {
        name: 'ai-team-room',
        description: 'AI team room with participants, transcript, commands, and artifacts.',
        config: {
          ...roomTemplateConfig({
            name: 'AI Team Room',
            navGroup: { id: 'room', title: 'Room', icon: 'groups', order: 0 },
            view: { id: 'session', title: 'Session', icon: 'forum', order: 0 },
            panels: {
              transcript: roomPanel('team-room-transcript', 'Transcript', 'chat'),
              command: roomPanel('team-room-command', 'Command', 'terminal'),
              artifacts: roomPanel('team-room-artifacts', 'Artifacts', 'inventory_2'),
              participants: roomPanel('team-room-participants', 'Participants', 'group'),
            },
            layout: splitNode(
              'session-root',
              'horizontal',
              0.72,
              splitNode('session-main', 'vertical', 0.7, panelLeaf('transcript'), panelLeaf('command')),
              splitNode('session-side', 'vertical', 0.5, panelLeaf('participants'), panelLeaf('artifacts')),
            ),
            modules: [
              roomModule('team-room-transcript', ['room.transcript', 'agent.messages'], {
                bindings: [{ id: 'messages', direction: 'input', path: 'data.messages' }],
                events: { emits: [{ name: 'message-select' }] },
              }),
              roomModule('team-room-command', ['room.command', 'agent.command-input'], {
                actions: [hostCommandAction('route-command', 'Route', 'agent.command.route')],
                bindings: [{ id: 'draft', direction: 'two-way', path: 'data.commandDraft' }],
                runtimeSlots: [{ id: 'agent-runtime', role: 'provider', required: true }],
                hostServices: { required: ['agent.runtime'], optional: [] },
              }),
              roomModule('team-room-artifacts', ['room.artifacts', 'artifact.preview'], {
                bindings: [{ id: 'artifacts', direction: 'input', path: 'data.artifacts' }],
                hostServices: { required: ['storage.project'], optional: [] },
              }),
              roomModule('team-room-participants', ['room.participants', 'presence.roster'], {
                bindings: [{ id: 'participants', direction: 'input', path: 'data.participants' }],
                events: { emits: [{ name: 'participant-select' }] },
                hostServices: { required: ['presence.session'], optional: [] },
              }),
            ],
          }),
        },
      },
      {
        name: 'voice-video-room',
        description: 'Voice and video AI room with realtime media, transcript, and command controls.',
        config: {
          ...roomTemplateConfig({
            name: 'Voice Video Room',
            navGroup: { id: 'call', title: 'Call', icon: 'video_call', order: 0 },
            view: { id: 'live', title: 'Live', icon: 'video_call', order: 0 },
            panels: {
              stage: roomPanel('room-media-stage', 'Stage', 'video_call'),
              controls: roomPanel('room-call-controls', 'Controls', 'settings_voice'),
              transcript: roomPanel('room-call-transcript', 'Transcript', 'subtitles'),
              command: roomPanel('room-call-command', 'Command', 'terminal'),
            },
            layout: splitNode(
              'live-root',
              'horizontal',
              0.68,
              splitNode('live-stage', 'vertical', 0.78, panelLeaf('stage'), panelLeaf('controls')),
              splitNode('live-chat', 'vertical', 0.58, panelLeaf('transcript'), panelLeaf('command')),
            ),
            modules: [
              roomModule('room-media-stage', ['room.video', 'room.audio', 'media.realtime'], {
                bindings: [{ id: 'participants', direction: 'input', path: 'data.participants' }],
                runtimeSlots: [{ id: 'media-session', role: 'provider', required: true }],
                hostServices: { required: ['media.realtime', 'presence.session'], optional: [] },
              }),
              roomModule('room-call-controls', ['call.controls', 'room.audio'], {
                actions: [
                  hostCommandAction('join-call', 'Join', 'call.join'),
                  hostCommandAction('leave-call', 'Leave', 'call.leave'),
                  hostCommandAction('toggle-mute', 'Mute', 'call.audio.toggle'),
                ],
                settings: [{ id: 'audio-device', label: 'Audio Device', type: 'string' }],
                hostServices: { required: ['media.realtime'], optional: [] },
              }),
              roomModule('room-call-transcript', ['room.transcript', 'agent.messages'], {
                bindings: [{ id: 'messages', direction: 'input', path: 'data.messages' }],
                hostServices: { required: ['storage.project'], optional: [] },
              }),
              roomModule('room-call-command', ['room.command', 'agent.command-input'], {
                actions: [hostCommandAction('send-command', 'Send', 'agent.command.send')],
                runtimeSlots: [{ id: 'agent-runtime', role: 'provider', required: true }],
                hostServices: { required: ['agent.runtime'], optional: [] },
              }),
            ],
          }),
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
  let reports = config.construction?.plan?.verification?.reports;
  let exported = exportConfig(config, { strict: true });
  assert.ok(exported.json, `${label} exports strict portable JSON`);

  let imported = importConfig(exported.json);
  assert.ok(imported.config, `${label} imports from exported JSON`);
  assert.deepEqual(imported.errors, []);
  if (reports) {
    assert.deepEqual(
      imported.config.construction.plan.verification.reports,
      reports,
      `${label} preserves construction verification reports`,
    );
    assert.deepEqual(
      imported.config.validation.reports,
      reports,
      `${label} preserves mirrored validation reports`,
    );
  }

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
    let constructed = await dispatchMutation('construction_construct', {
      intent: 'agent review workspace',
      template: 'agent-workspace',
      name: 'Portable Agent Review',
      requiredCapabilities: ['agent.review', 'workflow.node-editor'],
    }, session);
    assert.equal(constructed.status, 'ok', constructed.hint);
    let reports = session.config.construction.plan.verification.reports;
    assert.ok(reports.length > 0);
    assert.deepEqual(session.config.validation.reports, reports);

    let exported = await dispatch('config_export', { strict: true }, session);
    assert.equal(exported.status, 'ok');

    let relaunched = createSession();
    let imported = await dispatchMutation('config_import', { json: exported.json }, relaunched);
    assert.equal(imported.status, 'ok');
    assert.deepEqual(relaunched.config.construction.plan.verification.reports, reports);
    assert.deepEqual(relaunched.config.validation.reports, reports);

    assertRelaunchable(relaunched.config, 'dispatch relaunch');

    let reexported = await dispatch('config_export', { strict: true }, relaunched);
    assert.equal(reexported.status, 'ok');
    assert.equal(reexported.json, exported.json);
  });

  it('relaunches the realtime builder handoff with construction metadata intact', () => {
    let demo = buildRealtimeChatStateDemo();
    let finalConfig = demo.stages.at(-1).config;
    let exported = exportConfig(finalConfig, { strict: true });
    assert.ok(exported.json);

    let imported = importConfig(exported.json);
    assert.deepEqual(imported.errors, []);
    assert.equal(imported.config.construction.plan.layout.topology, 'bsp-workbench');
    assert.deepEqual(
      imported.config.construction.plan.modules.map((item) => item.panelType).sort(),
      demo.requiredWidgets.slice().sort()
    );
    assert.equal(imported.config.components.modules.length, demo.requiredWidgets.length);
    assert.equal(imported.config.construction.plan.theme.editorPanel, 'theme-editor');
    assert.equal(
      imported.config.construction.plan.modules
        .find((item) => item.panelType === 'theme-editor')
        .bindings[0].path,
      'theme'
    );
    assert.equal(
      imported.config.construction.plan.modules
        .find((item) => item.panelType === 'agent-chat')
        .events.emits.some((event) => event.name === 'questionnaire-answer'),
      true
    );

    assertRelaunchable(imported.config, 'realtime builder handoff');

    let reexported = exportConfig(imported.config, { strict: true });
    assert.equal(reexported.json, exported.json);
  });

  it('relaunches every exported chat-builder demo variant through the strict harness', async () => {
    let demo = await buildChatFirstWorkspace();
    let count = 0;
    for (let scenario of demo.scenarios) {
      for (let variant of scenario.variants) {
        let label = `${scenario.key}/${variant.id}`;
        assert.ok(variant.exportJson, `${label} produced no export JSON`);

        // The exported portable JSON string is the sole relaunch input. Importing
        // it yields the config the strict harness exports, imports, loads, mounts,
        // destroys, and re-exports deterministically — headlessly covering the
        // public mountWorkspace path the live demo (mechanism A) does not exercise.
        let imported = importConfig(variant.exportJson);
        assert.deepEqual(imported.errors, [], `${label} imports from exported JSON`);
        assertRelaunchable(imported.config, label);
        count += 1;
      }
    }
    assert.ok(count >= 6, `expected the demo to expose multiple variants, got ${count}`);
  });

  it('packages and relaunches the realtime builder handoff with host browser requirements intact', () => {
    let demo = buildRealtimeChatStateDemo();
    let finalConfig = demo.stages.at(-1).config;
    let manifest = {
      id: 'realtime-builder-package',
      version: '1.0.0',
      description: 'Realtime builder package relaunch fixture.',
      tags: ['agent.workspace', 'realtime.builder'],
      dependencies: {
        packages: ['symbiote-engine', 'symbiote-ui'],
      },
    };

    let exported = exportWorkspacePackage(finalConfig, manifest);
    assert.ok(exported.json);
    assert.deepEqual(exported.errors, []);
    assert.deepEqual(exported.package.host.contract.browser.requiredImports, [...BROWSER_REQUIRED_IMPORTS]);
    assert.equal(exported.package.host.contract.browser.themeAdapterModule, 'symbiote-ui/ui');
    assert.deepEqual(exported.package.manifest.dependencies.packages, [
      'symbiote-engine',
      'symbiote-ui',
    ]);
    assert.deepEqual(
      exported.package.workspace.config.construction.plan.modules.map((item) => item.panelType).sort(),
      demo.requiredWidgets.slice().sort()
    );
    assert.deepEqual(
      exported.package.workspace.config.components.modules.map((item) => item.provider),
      Array(demo.requiredWidgets.length).fill('symbiote-ui')
    );

    let imported = importWorkspacePackage(exported.json);
    assert.deepEqual(imported.errors, []);
    assert.equal(imported.package.manifest.id, 'realtime-builder-package');
    assert.deepEqual(
      imported.config.construction.plan.modules.map((item) => item.panelType).sort(),
      demo.requiredWidgets.slice().sort()
    );
    assert.equal(imported.config.construction.plan.theme.editorPanel, 'theme-editor');
    assert.equal(
      imported.config.construction.plan.modules
        .find((item) => item.panelType === 'agent-chat')
        .events.emits.some((event) => event.name === 'questionnaire-answer'),
      true
    );

    let validation = validateWorkspacePackage(imported.package);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));

    let recomputedContract = createHostIntegrationContract(imported.config);
    assert.equal(recomputedContract.status, 'ok');
    assert.deepEqual(recomputedContract.contract, imported.package.host.contract);
    assertRelaunchable(imported.config, 'realtime builder package');
  });

  it('relaunches neutral collaboration room templates from plugin metadata', () => {
    let templates = collectPluginWorkspaceTemplates([COLLABORATION_ROOM_PLUGIN]);
    assert.equal(templates.ok, true, JSON.stringify(templates.errors));
    assertNoDeletedTemplateConfigKeys(templates.templates);
    let workspaceTemplates = constructorWorkspaceTemplates(templates.templates);

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
        workspaceTemplates,
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
          localFile: fixtureHomePath('example', 'workspace', 'private.json'),
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
      'construction_classify',
      'construction_plan',
      'construction_construct',
      'config_patch_validate',
      'config_patch_apply',
      'config_export',
      'config_import',
    ]);
    assert.deepEqual(result.contract.browser.requiredImports, [
      'symbiote-workspace/browser',
      'symbiote-ui/ui',
      'symbiote-engine',
      'symbiote-engine/contracts',
    ]);
    assert.equal(result.contract.browser.importMap.required, true);
    assert.equal(result.contract.browser.importMap.scriptType, 'importmap');
    assert.equal(result.contract.browser.importMap.mustLoadBeforeModuleScript, true);
    assert.equal(result.contract.browser.mountFunction, 'mountWorkspace');
    assert.equal(result.contract.browser.themeAdapter, 'symbiote-ui/ui.applyCascadeTheme');
    assert.equal(result.contract.browser.themeAdapterModule, 'symbiote-ui/ui');
    assert.equal(result.contract.browser.themeAdapterExport, 'applyCascadeTheme');
    assert.equal(result.contract.browser.themeGeometryAdapter, 'symbiote-ui/ui.applyCascadeGeometryRegister');
    assert.equal(result.contract.browser.themeGeometryAdapterExport, 'applyCascadeGeometryRegister');
    assert.deepEqual(result.contract.browser.themeAdapterExports, ['applyCascadeTheme', 'applyCascadeGeometryRegister']);
    assert.ok(result.contract.persistence.requiredTools.includes('config_export'));
    assert.ok(result.contract.persistence.requiredTools.includes('config_import'));
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
      version: WORKSPACE_SCHEMA_VERSION,
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
      version: WORKSPACE_SCHEMA_VERSION,
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
      workspaceTemplates: constructorWorkspaceTemplates(
        collectPluginWorkspaceTemplates([COLLABORATION_ROOM_PLUGIN]).templates,
      ),
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
      version: WORKSPACE_SCHEMA_VERSION,
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
