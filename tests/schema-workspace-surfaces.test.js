import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerSection,
  clearRegisteredSections,
  validateWorkspaceConfig,
} from '../validation/core.js';
import {
  workspaceSurfacesSection,
  deriveWorkspaceSurfaceRoute,
  WORKSPACE_SURFACE_PROGRESS_CHANNELS,
} from '../schema/sections/workspace-surfaces.js';
import { WORKSPACE_EXECUTION_CHANNELS } from '../schema/constants.js';
import { exportConfig } from '../sharing/config-portability.js';

const VERSION = '1.0.0';

function validate(config) {
  clearRegisteredSections();
  registerSection(workspaceSurfacesSection);
  return validateWorkspaceConfig(config);
}

function has(result, code) {
  return result.errors.some((error) => error.code === code);
}

function grant() {
  return {
    id: 'g-1',
    principal: { kind: 'agent', id: 'surface-builder' },
    scope: ['views[media-studio].*'],
    kinds: ['config_patch'],
    expiry: 'task',
  };
}

function baseConfig(overrides = {}) {
  return {
    version: VERSION,
    name: 'Surface workspace',
    requires: {
      hostServices: {
        required: ['agent.runtime', 'media.realtime', 'presence.session'],
        optional: ['storage.project'],
      },
    },
    views: [
      {
        id: 'media-studio',
        title: 'Media Studio',
        route: { pattern: '/workspace/media-studio' },
        workspaceSurface: {
          kind: 'media-studio',
          route: { derive: 'view-id' },
          session: { scope: 'workspace' },
          shell: { chat: 'shared', theme: 'cascade' },
          capabilities: {
            required: ['agent.webmcp', 'workspace.session.load'],
            optional: ['render.proof'],
          },
          hostServices: {
            required: ['agent.runtime', 'media.realtime', 'presence.session'],
            optional: ['storage.project'],
          },
          progressChannel: WORKSPACE_EXECUTION_CHANNELS.nodeProgress,
          renderProof: {
            capability: 'render.proof',
            hostService: 'media.realtime',
            progressChannel: WORKSPACE_EXECUTION_CHANNELS.nodeProgress,
          },
        },
      },
    ],
    ...overrides,
  };
}

describe('workspace surface section', () => {
  beforeEach(() => clearRegisteredSections());

  it('registers as a validation section and exports the progress vocabulary', () => {
    assert.equal(workspaceSurfacesSection.id, 'workspace-surfaces');
    assert.equal(typeof workspaceSurfacesSection.validate, 'function');
    assert.equal(typeof workspaceSurfacesSection.refProviders, 'function');
    assert.equal(typeof workspaceSurfacesSection.refConsumers, 'function');
    assert.ok(Object.isFrozen(workspaceSurfacesSection));
    assert.deepEqual(WORKSPACE_SURFACE_PROGRESS_CHANNELS, [
      WORKSPACE_EXECUTION_CHANNELS.queue,
      WORKSPACE_EXECUTION_CHANNELS.nodeProgress,
      WORKSPACE_EXECUTION_CHANNELS.nodeOutput,
    ]);
  });

  it('validates a same-session media-studio view surface with a derived route', () => {
    let config = baseConfig();
    assert.equal(deriveWorkspaceSurfaceRoute(config.views[0]), '/workspace/media-studio');
    let result = validate(config);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it('rejects route drift instead of allowing a second route plane', () => {
    let config = baseConfig();
    config.views[0].route.pattern = '/video-editor';
    let result = validate(config);
    assert.ok(has(result, 'workspaceSurface.route.drift'));
  });

  it('requires routed workspace surfaces to declare route derivation', () => {
    let config = baseConfig();
    delete config.views[0].workspaceSurface.route;
    let result = validate(config);
    assert.ok(has(result, 'workspaceSurface.route.required'));
  });

  it('enforces shared chat rail, cascade theme, and workspace session invariants', () => {
    let config = baseConfig();
    config.views[0].workspaceSurface.shell = { chat: 'hidden', theme: 'local' };
    config.views[0].workspaceSurface.session = { scope: 'view' };
    let result = validate(config);
    assert.ok(has(result, 'workspaceSurface.shell.chat'));
    assert.ok(has(result, 'workspaceSurface.shell.theme'));
    assert.ok(has(result, 'workspaceSurface.session.scope'));
  });

  it('rejects per-surface shell ownership fields', () => {
    let config = baseConfig();
    Object.assign(config.views[0].workspaceSurface, {
      chat: { panel: 'local-chat' },
      theme: { mode: 'local' },
      header: { title: 'Nested header' },
      layoutShell: { component: 'layout-shell-menu' },
    });
    let result = validate(config);
    assert.equal(result.errors.filter((error) => error.code === 'workspaceSurface.shell.owned').length, 4);
  });

  it('resolves host-service bindings through requires.hostServices and known categories', () => {
    let config = baseConfig();
    config.views[0].workspaceSurface.hostServices.required = ['db.private'];
    config.views[0].workspaceSurface.renderProof.hostService = 'media.realtime.worker';
    let result = validate(config);
    assert.ok(has(result, 'workspaceSurface.hostService.category'));
    assert.ok(has(result, 'workspaceSurface.hostService.undeclared'));
  });

  it('rejects malformed capabilities and progress channels', () => {
    let config = baseConfig();
    config.views[0].workspaceSurface.capabilities.required = ['Workspace Session'];
    config.views[0].workspaceSurface.progressChannel = 'render-progress';
    config.views[0].workspaceSurface.renderProof.progressChannel = 'render-progress';
    let result = validate(config);
    assert.ok(has(result, 'workspaceSurface.capability.id'));
    assert.equal(result.errors.filter((error) => error.code === 'workspaceSurface.progressChannel.invalid').length, 2);
  });

  it('publishes stable workspace-surface refs without consuming a route ref', () => {
    let providers = workspaceSurfacesSection.refProviders(baseConfig());
    assert.deepEqual(providers, [{
      id: 'workspace-surface:media-studio',
      path: 'views[].workspaceSurface',
    }]);
    assert.deepEqual(workspaceSurfacesSection.refConsumers(), []);
  });
});

describe('workspace surface portability', () => {
  it('uses the shared exporter to reject private URLs, paths, sessions, and grants', () => {
    let config = baseConfig();
    Object.assign(config.views[0].workspaceSurface, {
      previewUrl: 'https://internal.example/render',
      sessionId: 'session-123',
      voiceSamplePath: '/Users/operator/voices/es.wav',
      grants: [grant()],
    });

    let result = exportConfig(config, { strict: true });
    assert.equal(result.json, null);
    assert.ok(result.errors.some((error) => error.path === 'views[0].workspaceSurface.previewUrl'));
    assert.ok(result.errors.some((error) => error.path === 'views[0].workspaceSurface.sessionId'));
    assert.ok(result.errors.some((error) => error.path === 'views[0].workspaceSurface.voiceSamplePath'));
    assert.ok(result.errors.some((error) => error.path === 'views[0].workspaceSurface.grants[0]'));
  });
});
