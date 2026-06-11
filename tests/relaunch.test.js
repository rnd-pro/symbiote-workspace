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

  it('strict export rejects host-only state before sanitizing output', () => {
    let { config } = planWorkspaceConstruction('agent review workspace', {
      template: 'agent-workspace',
    });

    let result = exportConfig({
      ...config,
      host: { sessionId: 'abc123' },
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
    assert.equal(result.contract.browser.mountFunction, 'mountWorkspace');
    assert.equal(result.contract.browser.themeAdapter, 'symbiote-ui.applyCascadeTheme');
    assert.ok(result.contract.persistence.requiredTools.includes('export_config'));
    assert.ok(result.contract.persistence.requiredTools.includes('import_config'));
    assert.equal(result.contract.persistence.optionalEngineService, 'storage.project');
    assert.ok(result.contract.services.required.includes('agent.runtime'));
    assert.ok(result.contract.services.required.includes('storage.project'));
    assert.ok(result.contract.runtimeSlots.required.some((slot) => slot.id === 'agent-runtime'));
    assert.doesNotMatch(JSON.stringify(result.contract), /https?:|file:\/\/|\/Users\//);
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
