import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLUGIN_SCHEMA,
  validatePluginDefinition,
  validatePluginWorkspaceTemplate,
} from '../plugins/plugin-schema.js';
import { clearRegisteredSections } from '../validation/core.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/value-classes.js';

function paths(result) {
  return result.errors.map((error) => error.path);
}

function hasPath(result, path) {
  return result.errors.some((error) => error.path === path);
}

function contributedModule(overrides = {}) {
  return {
    id: 'acme.video:preview',
    tagName: 'acme-video-preview',
    title: 'Preview',
    capabilities: ['media.preview'],
    actions: [{ id: 'play', label: 'Play', does: { kind: 'emit', event: 'play' } }],
    hostServices: { required: [], optional: [] },
    ...overrides,
  };
}

function workspaceConfig(name) {
  return { version: WORKSPACE_SCHEMA_VERSION, name };
}

beforeEach(() => {
  clearRegisteredSections();
});

describe('PLUGIN_SCHEMA', () => {
  it('exports a frozen manifest schema with required name/version', () => {
    assert.ok(PLUGIN_SCHEMA);
    assert.equal(PLUGIN_SCHEMA.type, 'object');
    assert.deepEqual(PLUGIN_SCHEMA.required, ['name', 'version']);
    assert.ok(Object.isFrozen(PLUGIN_SCHEMA));
    assert.ok(PLUGIN_SCHEMA.properties.contributes);
  });
});

describe('manifest identity', () => {
  it('accepts a minimal namespaced manifest', () => {
    let result = validatePluginDefinition({ name: 'acme.video', version: '1.1.0' });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('rejects a null manifest', () => {
    assert.equal(validatePluginDefinition(null).valid, false);
  });

  it('rejects a name that is not a valid namespace', () => {
    let result = validatePluginDefinition({ name: 'Acme Video', version: '1.0.0' });
    assert.equal(result.valid, false);
    assert.ok(hasPath(result, 'name'));
  });

  it('rejects a non-semver version', () => {
    let result = validatePluginDefinition({ name: 'acme.video', version: 'v-one' });
    assert.equal(result.valid, false);
    assert.ok(hasPath(result, 'version'));
  });

  it('rejects a namespace that does not equal name', () => {
    let result = validatePluginDefinition({ name: 'acme.video', version: '1.0.0', namespace: 'acme.audio' });
    assert.equal(result.valid, false);
    assert.ok(hasPath(result, 'namespace'));
  });
});

describe('legacy flat vocabulary removed', () => {
  it('reports removed top-level keys as errors', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.0.0',
      handlers: [{ type: 'x/y' }],
      components: ['acme-video-preview'],
      workspace: { templates: [] },
      category: 'provider',
    });
    assert.equal(result.valid, false);
    for (let path of ['handlers', 'components', 'workspace', 'category']) {
      assert.ok(hasPath(result, path), `expected error on ${path}`);
    }
  });
});

describe('contributes.modules', () => {
  it('accepts namespaced module contracts', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.1.0',
      contributes: { modules: [contributedModule()] },
    });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });

  it('rejects a contribution id outside the plugin namespace', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.1.0',
      contributes: { modules: [contributedModule({ id: 'other.ns:preview' })] },
    });
    assert.equal(result.valid, false);
    assert.ok(hasPath(result, 'contributes.modules[0].id'));
  });

  it('rejects duplicate contribution ids across kinds', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.1.0',
      contributes: {
        modules: [contributedModule({ id: 'acme.video:shared' })],
        packs: [{ id: 'acme.video:shared', handlers: [{ type: 'video/encode' }] }],
      },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => /Duplicate contribution id/.test(error.message)));
  });

  it('prefixes descriptor validation errors from the shared descriptor validator', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.1.0',
      contributes: {
        modules: [contributedModule({ tagName: 'Bad Tag', actions: [{ id: 'x', does: { kind: 'emit', event: 'e' } }] })],
      },
    });
    assert.equal(result.valid, false);
    assert.ok(hasPath(result, 'contributes.modules[0].tagName'));
    assert.ok(hasPath(result, 'contributes.modules[0].actions[0].label'));
  });
});

describe('contributes.packs handler manifests', () => {
  it('accepts ingress and schedule trigger kinds plus ui/credentialType/hostServices', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.1.0',
      contributes: {
        packs: [{
          id: 'acme.video:media',
          handlers: [
            { type: 'video/webhook', trigger: { kind: 'ingress' }, ui: { autoForm: true }, credentialType: 'api-key', hostServices: { required: ['graph-execution'] } },
            { type: 'video/nightly', trigger: { kind: 'schedule' } },
          ],
        }],
      },
    });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });

  it('rejects a handler trigger kind outside ingress|schedule', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.1.0',
      contributes: {
        packs: [{ id: 'acme.video:media', handlers: [{ type: 'video/x', trigger: { kind: 'manual' } }] }],
      },
    });
    assert.equal(result.valid, false);
    assert.ok(hasPath(result, 'contributes.packs[0].handlers[0].trigger'));
  });
});

describe('contributes.templates', () => {
  it('accepts whole-config templates validated by the config validator', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.1.0',
      contributes: {
        templates: [{ name: 'studio-room', description: 'Studio.', config: workspaceConfig('Studio Room') }],
      },
    });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });

  it('prefixes config validator errors and rejects non-portable template names', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.1.0',
      contributes: {
        templates: [
          { name: 'Bad Room', config: workspaceConfig('Bad Room') },
          { name: 'missing-version', config: { name: 'No Version' } },
        ],
      },
    });
    assert.equal(result.valid, false);
    assert.ok(hasPath(result, 'contributes.templates[0].name'));
    assert.ok(hasPath(result, 'contributes.templates[1].config.version'));
  });

  it('validatePluginWorkspaceTemplate stays available for the capabilities layer', () => {
    let errors = [];
    validatePluginWorkspaceTemplate({ name: 'room', config: workspaceConfig('Room') }, 'templates[0]', errors);
    assert.deepEqual(errors, []);
  });
});

describe('idLifecycle rules', () => {
  it('accepts a rename that points an absent old id to a present contribution', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.1.0',
      contributes: { modules: [contributedModule({ id: 'acme.video:editor' })] },
      idLifecycle: { renames: { 'acme.video:timeline': 'acme.video:editor' } },
    });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });

  it('rejects a rename whose target is not a current contribution', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.1.0',
      contributes: { modules: [contributedModule({ id: 'acme.video:editor' })] },
      idLifecycle: { renames: { 'acme.video:timeline': 'acme.video:missing' } },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'idLifecycle.renames.acme.video:timeline'));
  });

  it('rejects a rename whose key still exists in current contributes', () => {
    let result = validatePluginDefinition({
      name: 'acme.video',
      version: '1.1.0',
      contributes: { modules: [contributedModule({ id: 'acme.video:editor' })] },
      idLifecycle: { renames: { 'acme.video:editor': 'acme.video:editor' } },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => /must not still exist/.test(error.message)));
  });
});
