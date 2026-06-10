import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  planWorkspace,
  matchTemplate,
  listTemplates,
  getTemplate,
} from '../constructor/index.js';

describe('matchTemplate', () => {
  it('matches chat keywords', () => {
    assert.equal(matchTemplate('I want a chat interface'), 'chat');
    assert.equal(matchTemplate('build me a messenger'), 'chat');
    assert.equal(matchTemplate('conversation view'), 'chat');
  });

  it('matches editor keywords', () => {
    assert.equal(matchTemplate('code editor'), 'editor');
    assert.equal(matchTemplate('source file editor'), 'editor');
    assert.equal(matchTemplate('IDE workspace'), 'editor');
  });

  it('matches graph keywords', () => {
    assert.equal(matchTemplate('node graph canvas'), 'graph');
    assert.equal(matchTemplate('visual pipeline builder'), 'graph');
    assert.equal(matchTemplate('diagram flow canvas'), 'graph');
  });

  it('matches dashboard keywords', () => {
    assert.equal(matchTemplate('dashboard with panels'), 'dashboard');
    assert.equal(matchTemplate('analytics overview'), 'dashboard');
    assert.equal(matchTemplate('monitoring grid'), 'dashboard');
  });

  it('returns null for empty input', () => {
    assert.equal(matchTemplate(''), null);
    assert.equal(matchTemplate(null), null);
  });
});

describe('planWorkspace', () => {
  it('returns valid config for chat intent', () => {
    let config = planWorkspace('create a chat workspace');
    assert.equal(config.name, 'Chat Workspace');
    assert.equal(config.register, 'tool');
    assert.ok(config.layout);
    assert.ok(config.components?.catalog?.length > 0);
  });

  it('allows name override', () => {
    let config = planWorkspace('chat', { name: 'Custom Chat' });
    assert.equal(config.name, 'Custom Chat');
  });

  it('allows register override', () => {
    let config = planWorkspace('chat', { register: 'brand' });
    assert.equal(config.register, 'brand');
  });

  it('falls back to dashboard for unknown intent', () => {
    let config = planWorkspace('something unknown and random');
    assert.equal(config.name, 'Dashboard Workspace');
  });

  it('returns deep clone (no shared references)', () => {
    let a = planWorkspace('chat');
    let b = planWorkspace('chat');
    a.name = 'Modified';
    assert.notEqual(a.name, b.name);
  });
});

describe('listTemplates', () => {
  it('returns array of template names', () => {
    let templates = listTemplates();
    assert.ok(Array.isArray(templates));
    assert.ok(templates.includes('chat'));
    assert.ok(templates.includes('editor'));
    assert.ok(templates.includes('graph'));
    assert.ok(templates.includes('dashboard'));
  });
});

describe('getTemplate', () => {
  it('returns template by name', () => {
    let template = getTemplate('chat');
    assert.ok(template);
    assert.equal(template.name, 'chat');
    assert.ok(template.config);
  });

  it('returns null for unknown name', () => {
    assert.equal(getTemplate('nonexistent'), null);
  });
});
