import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  planWorkspace,
  matchTemplate,
  listTemplates,
  getTemplate,
  planWorkspaceConstruction,
} from '../constructor/index.js';
import { validateWorkspaceConfig, WORKSPACE_SCHEMA_VERSION } from '../schema/index.js';

const TEAM_ROOM_TEMPLATE = {
  name: 'team-ai-room',
  description: 'AI team room workspace with shared transcript and command panels.',
  config: {
    version: WORKSPACE_SCHEMA_VERSION,
    name: 'Team AI Room',
    register: 'agent-workspace',
    groups: [{ id: 'room', name: 'Room', icon: 'groups' }],
    sections: [{ id: 'session', label: 'Session', icon: 'forum', order: 0, groupId: 'room' }],
    panelTypes: {
      transcript: { title: 'Transcript', icon: 'chat', component: 'team-room-transcript' },
      command: { title: 'Command', icon: 'terminal', component: 'team-room-command' },
    },
    layout: {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.62,
      first: { type: 'panel', panelType: 'transcript' },
      second: { type: 'panel', panelType: 'command' },
    },
    components: {
      catalog: ['team-room-transcript', 'team-room-command'],
      modules: [
        { tagName: 'team-room-transcript', capabilities: ['room.transcript', 'agent.messages'] },
        { tagName: 'team-room-command', capabilities: ['room.command', 'agent.command-input'] },
      ],
    },
  },
};

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

  it('matches admin keywords', () => {
    assert.equal(matchTemplate('admin console with records'), 'admin');
    assert.equal(matchTemplate('operations audit table'), 'admin');
  });

  it('matches agent workspace keywords', () => {
    assert.equal(matchTemplate('agent review workspace'), 'agent-workspace');
    assert.equal(matchTemplate('task handoff control room'), 'agent-workspace');
  });

  it('matches social automation keywords', () => {
    assert.equal(matchTemplate('social automation reply queue'), 'social-automation');
    assert.equal(matchTemplate('approval queue for replies'), 'social-automation');
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
    assert.ok(templates.includes('admin'));
    assert.ok(templates.includes('agent-workspace'));
    assert.ok(templates.includes('social-automation'));
  });

  it('can include plugin-neutral external workspace templates', () => {
    let templates = listTemplates({ workspaceTemplates: [TEAM_ROOM_TEMPLATE] });

    assert.ok(templates.includes('chat'));
    assert.ok(templates.includes('team-ai-room'));
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

  it('returns external workspace templates without mutating stored input', () => {
    let template = getTemplate('team-ai-room', {
      workspaceTemplates: [TEAM_ROOM_TEMPLATE],
    });

    assert.equal(template.name, 'team-ai-room');
    assert.equal(template.config.name, 'Team AI Room');
    template.config.name = 'Mutated';

    assert.equal(TEAM_ROOM_TEMPLATE.config.name, 'Team AI Room');
  });

  it('returns a deep clone that cannot mutate stored templates', () => {
    let first = getTemplate('admin');
    let second = getTemplate('admin');

    first.config.components.modules[0].capabilities.push('mutated.external-state');
    first.config.panelTypes.metric.component = 'mutated-component';

    assert.ok(!second.config.components.modules[0].capabilities.includes('mutated.external-state'));
    assert.equal(second.config.panelTypes.metric.component, 'sn-metric');
    assert.equal(getTemplate('admin').config.panelTypes.metric.component, 'sn-metric');
  });
});

describe('canonical templates', () => {
  it('provides executable configs with module descriptors', () => {
    let canonical = [
      'admin',
      'editor',
      'agent-workspace',
      'video-studio',
      'graph',
      'social-automation',
    ];

    for (let name of canonical) {
      let template = getTemplate(name);
      assert.ok(template, `${name} template should exist`);
      let validation = validateWorkspaceConfig(template.config, { strict: true });
      assert.equal(validation.valid, true, `${name} template should validate: ${JSON.stringify(validation.errors)}`);
      assert.ok(template.config.components?.catalog?.length > 0, `${name} should declare a component catalog`);
      assert.ok(template.config.components?.modules?.length > 0, `${name} should declare module capabilities`);
      for (let descriptor of template.config.components.modules) {
        assert.ok(descriptor.capabilities?.length > 0, `${name}:${descriptor.tagName} should declare capabilities`);
      }
    }
  });

  it('uses built-in module descriptors when planning canonical scenarios', () => {
    let result = planWorkspaceConstruction('social automation reply queue');
    assert.equal(result.intent.template, 'social-automation');
    assert.equal(result.config.register, 'agent-workspace');
    assert.ok(result.plan.modules.some((module) => module.component === 'sn-data-table'));
    assert.ok(result.plan.modules.every((module) => Array.isArray(module.capabilities)));
    assert.ok(result.plan.modules.some((module) => module.capabilities.includes('automation.reply-template')));
  });

  it('constructs from plugin-neutral external workspace templates', () => {
    let result = planWorkspaceConstruction({
      brief: 'Build a team AI room',
      template: 'team-ai-room',
      requiredCapabilities: ['room.command'],
    }, {
      workspaceTemplates: [TEAM_ROOM_TEMPLATE],
    });

    assert.equal(result.intent.template, 'team-ai-room');
    assert.equal(result.config.name, 'Team AI Room');
    assert.equal(result.config.register, 'agent-workspace');
    assert.deepEqual(result.plan.answers.moduleSelection, ['command']);
    assert.deepEqual(result.plan.capabilities.missing, []);

    let validation = validateWorkspaceConfig(result.config, { strict: true });
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  });

  it('matches external templates from name, description, and config name', () => {
    assert.equal(matchTemplate('open the team AI room', {
      workspaceTemplates: [TEAM_ROOM_TEMPLATE],
    }), 'team-ai-room');
  });

  it('rejects external templates that collide with canonical names', () => {
    assert.throws(() => planWorkspace('chat room', {
      workspaceTemplates: [{ ...TEAM_ROOM_TEMPLATE, name: 'chat' }],
    }), /collides with existing template "chat"/);
  });
});
