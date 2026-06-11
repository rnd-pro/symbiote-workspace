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
});
