import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyWorkspaceTheme,
  mountWorkspace,
} from '../browser.js';

class TestStyle {
  values = new Map();

  setProperty(name, value) {
    this.values.set(name, String(value));
  }

  getPropertyValue(name) {
    return this.values.get(name) || '';
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
    this.id = '';
    this.listeners = new Map();
  }

  appendChild(child) {
    if (child?.isFragment) {
      for (let item of [...child.children]) {
        this.appendChild(item);
      }
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

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    for (let listener of this.listeners.get(event.type) || []) {
      listener(event);
    }
    if (event.bubbles && this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }
    return true;
  }

  matches(selector) {
    if (selector.startsWith('.')) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    if (selector.startsWith('#')) {
      return this.id === selector.slice(1);
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
  constructor() {
    this.defaultView = {
      history: { length: 1 },
    };
  }

  createElement(tagName) {
    return new TestElement(tagName, this);
  }

  createDocumentFragment() {
    return { isFragment: true, children: [], appendChild(child) {
      this.children.push(child);
      return child;
    } };
  }
}

function createThemeAdapter(calls = []) {
  return {
    applyCascadeTheme(element, options, eventOptions) {
      calls.push({ element, options, eventOptions });
      if (options.hue !== undefined) element.style.setProperty('--sn-theme-hue', options.hue);
      if (options.density !== undefined) {
        element.style.setProperty('--sn-theme-density', options.density);
      }
      return { state: options, tokens: {} };
    },
  };
}

function createContainer() {
  let document = new TestDocument();
  return document.createElement('main');
}

describe('applyWorkspaceTheme', () => {
  it('applies root params, relations, overrides, and subtree theme layers', () => {
    let root = createContainer();
    let sidebar = root.ownerDocument.createElement('aside');
    sidebar.className = 'sidebar';
    root.appendChild(sidebar);
    let calls = [];

    let result = applyWorkspaceTheme({
      version: '0.3.0',
      name: 'Theme Test',
      theme: {
        params: { mode: 'dark', hue: 220 },
        relations: { surfaceStep: 1.2 },
        overrides: { '--sn-panel-bg': 'black' },
        subtrees: [
          {
            selector: '.sidebar',
            params: { hue: 180, density: 90 },
            relations: { radiusScale: 0.75 },
            overrides: { '--sn-node-radius': '4px' },
          },
        ],
      },
    }, root, {
      themeAdapter: createThemeAdapter(calls),
    });

    assert.equal(root.style.getPropertyValue('--sn-theme-hue'), '220');
    assert.equal(root.style.getPropertyValue('--sn-panel-bg'), 'black');
    assert.equal(sidebar.style.getPropertyValue('--sn-theme-hue'), '180');
    assert.equal(sidebar.style.getPropertyValue('--sn-theme-density'), '90');
    assert.equal(sidebar.style.getPropertyValue('--sn-node-radius'), '4px');
    assert.equal(calls[0].options.relations.surfaceStep, 1.2);
    assert.equal(calls[1].options.relations.radiusScale, 0.75);
    assert.equal(result.subtreeThemes.length, 1);
    assert.deepEqual(result.warnings, []);
  });

  it('reports unmatched subtree selectors without hiding the warning', () => {
    let root = createContainer();
    let result = applyWorkspaceTheme({
      version: '0.3.0',
      name: 'Theme Test',
      theme: {
        subtrees: [{ selector: '.missing', overrides: { '--sn-panel-bg': 'red' } }],
      },
    }, root);

    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].path, 'theme.subtrees.0');
  });

  it('throws when params require a missing theme adapter', () => {
    let root = createContainer();
    assert.throws(() => applyWorkspaceTheme({
      version: '0.3.0',
      name: 'Theme Test',
      theme: { params: { hue: 220 } },
    }, root), /requires options\.themeAdapter\.applyCascadeTheme/);
  });

  it('throws when relations require a missing theme adapter', () => {
    let root = createContainer();
    assert.throws(() => applyWorkspaceTheme({
      version: '0.3.0',
      name: 'Theme Test',
      theme: { relations: { surfaceStep: 1.2 } },
    }, root), /requires options\.themeAdapter\.applyCascadeTheme/);
  });

  it('throws when subtree params or relations require a missing theme adapter', () => {
    let root = createContainer();
    let sidebar = root.ownerDocument.createElement('aside');
    sidebar.className = 'sidebar';
    root.appendChild(sidebar);

    assert.throws(() => applyWorkspaceTheme({
      version: '0.3.0',
      name: 'Theme Test',
      theme: {
        subtrees: [{
          selector: '.sidebar',
          params: { hue: 180 },
          relations: { radiusScale: 0.8 },
        }],
      },
    }, root), /requires options\.themeAdapter\.applyCascadeTheme/);
  });

  it('applies override-only themes without a cascade theme adapter', () => {
    let root = createContainer();
    let result = applyWorkspaceTheme({
      version: '0.3.0',
      name: 'Theme Test',
      theme: {
        overrides: { '--sn-panel-bg': 'black' },
      },
    }, root);

    assert.equal(root.style.getPropertyValue('--sn-panel-bg'), 'black');
    assert.deepEqual(result.warnings, []);
  });
});

describe('mountWorkspace', () => {
  it('mounts wrapper, applies theme, and writes editor changes into config', () => {
    let container = createContainer();
    let config = {
      version: '0.3.0',
      name: 'Mounted Workspace',
      theme: { params: { mode: 'dark', hue: 220 } },
    };
    let changes = [];

    let mounted = mountWorkspace(config, container, {
      themeAdapter: createThemeAdapter(),
      onThemeChange: (change) => changes.push(change),
    });

    assert.equal(container.children.length, 1);
    assert.equal(mounted.element.dataset.workspaceName, 'Mounted Workspace');
    mounted.element.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: { state: { hue: 180, contrast: 70 }, targetSelector: null },
    });

    assert.equal(config.theme.params.hue, 180);
    assert.equal(config.theme.params.contrast, 70);
    assert.equal(changes.length, 1);

    mounted.destroy();
    assert.equal(container.children.length, 0);
  });

  it('writes subtree editor changes into matching theme subtree config', () => {
    let container = createContainer();
    let config = {
      version: '0.3.0',
      name: 'Mounted Workspace',
      theme: {
        params: { mode: 'dark', hue: 220 },
        subtrees: [{ selector: '.preview', params: { hue: 40 } }],
      },
    };

    let mounted = mountWorkspace(config, container, {
      themeAdapter: createThemeAdapter(),
    });
    mounted.element.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: { state: { hue: 90 }, targetSelector: '.preview' },
    });

    assert.equal(config.theme.subtrees[0].params.hue, 90);
  });

  it('preserves structured root and subtree theme writeback state', () => {
    let container = createContainer();
    let config = {
      version: '0.3.0',
      name: 'Mounted Workspace',
      theme: {
        params: { mode: 'dark', hue: 220 },
        relations: { surfaceStep: 1.1 },
        overrides: { '--sn-gap': '8px' },
        subtrees: [{
          selector: '.preview',
          params: { hue: 40 },
          relations: { radiusScale: 0.75 },
          overrides: { '--sn-node-radius': '4px' },
        }],
      },
    };

    let mounted = mountWorkspace(config, container, {
      themeAdapter: createThemeAdapter(),
    });

    mounted.element.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: {
        state: {
          params: { hue: 180, contrast: 70 },
          relations: { surfaceStep: 1.25 },
          overrides: { '--sn-gap': '10px' },
        },
        targetSelector: null,
      },
    });
    mounted.element.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: {
        state: {
          params: { hue: 90, brightness: 65 },
          relations: { radiusScale: 0.9 },
          overrides: { '--sn-node-radius': '6px' },
        },
        targetSelector: '.preview',
      },
    });

    assert.deepEqual(config.theme.params, {
      mode: 'dark',
      hue: 180,
      contrast: 70,
    });
    assert.deepEqual(config.theme.relations, { surfaceStep: 1.25 });
    assert.deepEqual(config.theme.overrides, { '--sn-gap': '10px' });
    assert.deepEqual(config.theme.subtrees[0].params, {
      hue: 90,
      brightness: 65,
    });
    assert.deepEqual(config.theme.subtrees[0].relations, { radiusScale: 0.9 });
    assert.deepEqual(config.theme.subtrees[0].overrides, {
      '--sn-node-radius': '6px',
    });
  });

  it('exposes missing panel components and only fails when strict components are enabled', () => {
    let container = createContainer();
    let config = {
      version: '0.3.0',
      name: 'Mounted Workspace',
      panelTypes: {
        editor: {
          title: 'Editor',
          component: 'sn-editor-panel',
        },
      },
      layout: {
        type: 'panel',
        panelType: 'editor',
      },
    };
    let emptyCatalog = { has: () => false, list: () => [] };

    let mounted = mountWorkspace(config, container, {
      catalog: emptyCatalog,
    });

    assert.deepEqual(mounted.loaderResult.missingComponents, ['sn-editor-panel']);
    assert.ok(mounted.loaderResult.warnings.some((warning) => warning.path === 'components'));

    assert.throws(() => mountWorkspace(config, createContainer(), {
      catalog: emptyCatalog,
      strictComponents: true,
    }), /Missing components: sn-editor-panel/);
  });

  it('renders portable layout and panel previews without a runtime controller', () => {
    let container = createContainer();
    let mounted = mountWorkspace({
      version: '0.3.0',
      name: 'Visual Demo',
      panelTypes: {
        timeline: {
          title: 'Timeline',
          component: 'sn-video-timeline',
          slots: [{ id: 'tracks', role: 'content' }],
        },
        preview: {
          title: 'Preview',
          component: 'sn-video-preview',
        },
      },
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.65,
        first: { type: 'panel', panelType: 'timeline' },
        second: { type: 'panel', panelType: 'preview' },
      },
    }, container);

    let panels = mounted.element.querySelectorAll('.symbiote-workspace__panel');
    let split = mounted.element.querySelectorAll('.symbiote-workspace__split')[0];

    assert.equal(panels.length, 2);
    assert.equal(split.dataset.direction, 'horizontal');
    assert.equal(split.style.getPropertyValue('display'), 'flex');
    assert.equal(split.style.getPropertyValue('flex-direction'), 'row');
    assert.equal(split.style.getPropertyValue('--symbiote-workspace-preview-ratio'), '0.65');
    assert.equal(panels[0].style.getPropertyValue('border-radius'), '8px');
    assert.equal(panels[0].style.getPropertyValue('min-height'), '8rem');
    assert.equal(panels[0].dataset.panelType, 'timeline');
    assert.equal(panels[0].dataset.component, 'sn-video-timeline');
    assert.equal(panels[0].children[0].textContent, 'Timeline');
    assert.equal(panels[0].querySelectorAll('.symbiote-workspace__panel-slot')[0].dataset.slotId, 'tracks');
    assert.equal(panels[1].dataset.panelType, 'preview');
    assert.equal(panels[1].children[0].textContent, 'Preview');
  });

  it('updates the mounted default preview without replacing the workspace wrapper', () => {
    let container = createContainer();
    let mounted = mountWorkspace({
      version: '0.3.0',
      name: 'Initial Workspace',
      panelTypes: {
        timeline: {
          title: 'Timeline',
          component: 'sn-video-timeline',
        },
      },
      layout: {
        type: 'panel',
        panelType: 'timeline',
      },
    }, container);
    let wrapper = mounted.element;
    let initialPanel = mounted.element.querySelectorAll('.symbiote-workspace__panel')[0];

    mounted.updateConfig({
      version: '0.3.0',
      name: 'Updated Workspace',
      panelTypes: {
        preview: {
          title: 'Preview',
          component: 'sn-video-preview',
        },
      },
      layout: {
        type: 'panel',
        panelType: 'preview',
      },
      theme: {
        overrides: { '--sn-panel-bg': 'black' },
      },
    });

    let updatedPanel = mounted.element.querySelectorAll('.symbiote-workspace__panel')[0];
    assert.equal(container.children.length, 1);
    assert.equal(mounted.element, wrapper);
    assert.notEqual(updatedPanel, initialPanel);
    assert.equal(mounted.config.name, 'Updated Workspace');
    assert.equal(mounted.element.dataset.workspaceName, 'Updated Workspace');
    assert.equal(updatedPanel.dataset.panelType, 'preview');
    assert.equal(updatedPanel.dataset.component, 'sn-video-preview');
    assert.equal(mounted.element.style.getPropertyValue('--sn-panel-bg'), 'black');
  });

  it('delegates mounted updates to runtime handles without destroying them', () => {
    let container = createContainer();
    let destroyCalls = 0;
    let updates = [];
    let mounted = mountWorkspace({
      version: '0.3.0',
      name: 'Runtime Workspace',
      theme: { params: { hue: 220 } },
    }, container, {
      themeAdapter: createThemeAdapter(),
      runtimeController: {
        mountWorkspace() {
          return {
            updateConfig(update) {
              updates.push(update);
            },
            destroy() {
              destroyCalls += 1;
            },
          };
        },
      },
    });

    let wrapper = mounted.element;
    mounted.updateConfig({
      version: '0.3.0',
      name: 'Runtime Workspace Updated',
      theme: { params: { hue: 180 } },
    });

    assert.equal(mounted.element, wrapper);
    assert.equal(container.children.length, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].config.name, 'Runtime Workspace Updated');
    assert.equal(updates[0].previousConfig.name, 'Runtime Workspace');
    assert.equal(destroyCalls, 0);

    mounted.destroy();
    assert.equal(destroyCalls, 1);
  });

  it('delegates mounted updates to runtime controllers with the controller context', () => {
    let container = createContainer();
    let updates = [];
    let controller = {
      name: 'controller',
      mountWorkspace() {
        return {};
      },
      updateConfig(update) {
        updates.push({
          thisValue: this,
          update,
        });
      },
    };
    let mounted = mountWorkspace({
      version: '0.3.0',
      name: 'Controller Workspace',
    }, container, {
      runtimeController: controller,
    });

    mounted.updateConfig({
      version: '0.3.0',
      name: 'Controller Workspace Updated',
    });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].thisValue, controller);
    assert.equal(updates[0].update.config.name, 'Controller Workspace Updated');
    assert.equal(updates[0].update.previousConfig.name, 'Controller Workspace');
  });

  it('rejects invalid mounted updates before mutating the existing workspace', () => {
    let container = createContainer();
    let mounted = mountWorkspace({
      version: '0.3.0',
      name: 'Mounted Workspace',
      panelTypes: {
        editor: {
          title: 'Editor',
          component: 'sn-editor-panel',
        },
      },
      layout: {
        type: 'panel',
        panelType: 'editor',
      },
    }, container);
    let wrapper = mounted.element;
    let panel = wrapper.querySelectorAll('.symbiote-workspace__panel')[0];

    assert.throws(() => mounted.updateConfig({
      version: '0.3.0',
      name: 'Invalid Workspace',
      panelTypes: {
        editor: {
          title: 'Editor',
          component: 'sn-editor-panel',
        },
      },
      layout: {
        type: 'panel',
        panelType: 'editor',
      },
    }, {
      catalog: { has: () => false, list: () => [] },
      strictComponents: true,
    }), /Missing components: sn-editor-panel/);

    assert.equal(mounted.element, wrapper);
    assert.equal(mounted.config.name, 'Mounted Workspace');
    assert.equal(wrapper.dataset.workspaceName, 'Mounted Workspace');
    assert.equal(wrapper.querySelectorAll('.symbiote-workspace__panel')[0], panel);
  });

  it('applies validated workspace patches through the mounted update contract', async () => {
    let container = createContainer();
    let mounted = mountWorkspace({
      version: '0.3.0',
      name: 'Patch Workspace',
      panelTypes: {
        timeline: {
          title: 'Timeline',
          component: 'sn-video-timeline',
        },
      },
      layout: {
        type: 'panel',
        panelType: 'timeline',
      },
    }, container);
    let wrapper = mounted.element;

    let result = await mounted.applyPatch({
      overlay: {
        name: 'Patched Workspace',
        panelTypes: {
          preview: {
            title: 'Preview',
            component: 'sn-video-preview',
          },
        },
        layout: {
          type: 'panel',
          panelType: 'preview',
        },
      },
    });

    assert.equal(result.status, 'ok');
    assert.equal(result.mounted, mounted);
    assert.equal(mounted.element, wrapper);
    assert.equal(mounted.config.name, 'Patched Workspace');
    assert.equal(mounted.config.patches.length, 1);
    assert.equal(wrapper.dataset.workspaceName, 'Patched Workspace');
    assert.equal(
      wrapper.querySelectorAll('.symbiote-workspace__panel')[0].dataset.panelType,
      'preview'
    );
  });

  it('applies workspace patches through runtime updates without navigation or remounting', async () => {
    let container = createContainer();
    let history = container.ownerDocument.defaultView.history;
    let initialHistoryLength = history.length;
    let destroyCalls = 0;
    let runtimeUpdates = [];
    let runtimeElement;

    let mounted = mountWorkspace({
      version: '0.3.0',
      name: 'Realtime Patch Workspace',
      panelTypes: {
        timeline: {
          title: 'Timeline',
          component: 'sn-video-timeline',
        },
      },
      layout: {
        type: 'panel',
        panelType: 'timeline',
      },
    }, container, {
      runtimeController: {
        mountWorkspace({ element }) {
          runtimeElement = element.ownerDocument.createElement('panel-layout');
          runtimeElement.dataset.runtimeInstanceId = 'runtime-1';
          runtimeElement.dataset.atomicUpdateCount = '0';
          element.dataset.runtimeInstanceId = runtimeElement.dataset.runtimeInstanceId;
          element.dataset.atomicUpdateCount = '0';
          element.appendChild(runtimeElement);
          return {
            updateConfig(update) {
              runtimeUpdates.push(update);
              let updateCount = Number(runtimeElement.dataset.atomicUpdateCount || '0') + 1;
              runtimeElement.dataset.atomicUpdateCount = String(updateCount);
              runtimeElement.dataset.lastUpdateReason = update.reason || '';
              runtimeElement.dataset.lastUpdatedStage = update.stage?.id || '';
              update.element.dataset.runtimeInstanceId = runtimeElement.dataset.runtimeInstanceId;
              update.element.dataset.atomicUpdateCount = String(updateCount);
              update.element.dataset.lastUpdatedStage = update.stage?.id || '';
            },
            destroy() {
              destroyCalls += 1;
            },
          };
        },
      },
    });
    let wrapper = mounted.element;

    let result = await mounted.applyPatch({
      overlay: {
        name: 'Realtime Patch Workspace Updated',
        panelTypes: {
          preview: {
            title: 'Preview',
            component: 'sn-video-preview',
          },
        },
        layout: {
          type: 'panel',
          panelType: 'preview',
        },
      },
    }, {
      stage: { id: 'validation' },
    });

    assert.equal(result.status, 'ok');
    assert.equal(result.mounted, mounted);
    assert.equal(mounted.element, wrapper);
    assert.equal(container.children[0], wrapper);
    assert.equal(runtimeElement.parentElement, wrapper);
    assert.equal(runtimeElement.dataset.runtimeInstanceId, 'runtime-1');
    assert.equal(runtimeElement.dataset.atomicUpdateCount, '1');
    assert.equal(runtimeElement.dataset.lastUpdatedStage, 'validation');
    assert.equal(wrapper.dataset.runtimeInstanceId, 'runtime-1');
    assert.equal(wrapper.dataset.atomicUpdateCount, '1');
    assert.equal(wrapper.dataset.lastUpdatedStage, 'validation');
    assert.equal(mounted.config.name, 'Realtime Patch Workspace Updated');
    assert.equal(runtimeUpdates.length, 1);
    assert.equal(runtimeUpdates[0].reason, 'applyPatch');
    assert.equal(runtimeElement.dataset.lastUpdateReason, 'applyPatch');
    assert.equal(runtimeUpdates[0].previousConfig.name, 'Realtime Patch Workspace');
    assert.equal(destroyCalls, 0);
    assert.equal(history.length, initialHistoryLength);
  });

  it('preserves theme writeback across mounted runtime updates', () => {
    let container = createContainer();
    let destroyCalls = 0;
    let runtimeElement;
    let themeChanges = [];
    let config = {
      version: '0.3.0',
      name: 'Theme Runtime Workspace',
      theme: { params: { mode: 'light', hue: 220 } },
      panelTypes: {
        editor: {
          title: 'Editor',
          component: 'sn-editor-panel',
        },
      },
      layout: {
        type: 'panel',
        panelType: 'editor',
      },
    };

    let mounted = mountWorkspace(config, container, {
      themeAdapter: createThemeAdapter(),
      onThemeChange: (change) => themeChanges.push(change),
      runtimeController: {
        mountWorkspace({ element }) {
          runtimeElement = element.ownerDocument.createElement('panel-layout');
          element.appendChild(runtimeElement);
          return {
            updateConfig({ config: nextConfig, element }) {
              runtimeElement.dataset.updatedThemeMode = nextConfig.theme?.params?.mode || '';
              element.dataset.updatedThemeMode = runtimeElement.dataset.updatedThemeMode;
            },
            destroy() {
              destroyCalls += 1;
            },
          };
        },
      },
    });
    let wrapper = mounted.element;

    wrapper.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: {
        state: { mode: 'dark', hue: 180 },
        targetSelector: null,
      },
    });
    assert.deepEqual(mounted.config.theme.params, {
      mode: 'dark',
      hue: 180,
    });

    mounted.updateConfig({
      ...mounted.config,
      name: 'Theme Runtime Workspace Updated',
      theme: { params: { ...mounted.config.theme.params, density: 92 } },
    }, {
      stage: { id: 'builder' },
      reason: 'realtime-stage',
    });
    assert.deepEqual(mounted.config.theme.params, {
      mode: 'dark',
      hue: 180,
      density: 92,
    });

    wrapper.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: {
        state: { mode: 'contrast', hue: 90 },
        targetSelector: null,
      },
    });

    assert.equal(mounted.element, wrapper);
    assert.equal(container.children[0], wrapper);
    assert.equal(runtimeElement.parentElement, wrapper);
    assert.equal(runtimeElement.dataset.updatedThemeMode, 'dark');
    assert.equal(wrapper.dataset.updatedThemeMode, 'dark');
    assert.equal(mounted.config.name, 'Theme Runtime Workspace Updated');
    assert.deepEqual(mounted.config.theme.params, {
      mode: 'contrast',
      hue: 90,
      density: 92,
    });
    assert.equal(themeChanges.length, 2);
    assert.equal(themeChanges[0].state.mode, 'dark');
    assert.equal(themeChanges[1].state.mode, 'contrast');
    assert.equal(destroyCalls, 0);
  });

  it('cleans up runtime handles and stops writeback after destroy', () => {
    let container = createContainer();
    let config = {
      version: '0.3.0',
      name: 'Mounted Workspace',
      theme: { params: { hue: 220 } },
    };
    let destroyCalls = 0;

    let mounted = mountWorkspace(config, container, {
      themeAdapter: createThemeAdapter(),
      runtimeController: {
        mountWorkspace() {
          return {
            destroy() {
              destroyCalls += 1;
            },
          };
        },
      },
    });

    mounted.destroy();
    mounted.element.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: { state: { hue: 90 }, targetSelector: null },
    });

    assert.equal(destroyCalls, 1);
    assert.equal(container.children.length, 0);
    assert.equal(config.theme.params.hue, 220);
  });
});
