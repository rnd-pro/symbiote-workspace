import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerSection,
  clearRegisteredSections,
  getRegisteredSections,
  validateWorkspaceConfig,
  isCompatibleVersion,
} from '../validation/core.js';

const VERSION = '1.0.0';

function base(extra = {}) {
  return { version: VERSION, name: 'Keystone Workspace', ...extra };
}

describe('validation/core registry', () => {
  beforeEach(clearRegisteredSections);

  it('registers a section and reports it through the registry', () => {
    let unregister = registerSection({ id: 'structure', validate() {} });
    let ids = getRegisteredSections().map((section) => section.id);
    assert.deepEqual(ids, ['structure']);

    unregister();
    assert.deepEqual(getRegisteredSections(), []);
  });

  it('rejects invalid registrations without corrupting the registry', () => {
    assert.throws(() => registerSection({}), /non-empty section id/);
    assert.throws(() => registerSection({ id: 'x', validate: 'nope' }), /must be a function/);
    registerSection({ id: 'dup' });
    assert.throws(() => registerSection({ id: 'dup' }), /already registered/);
    assert.deepEqual(getRegisteredSections().map((s) => s.id), ['dup']);
  });

  it('freezes the exposed registry snapshot', () => {
    registerSection({ id: 'structure' });
    let sections = getRegisteredSections();
    assert.ok(Object.isFrozen(sections));
    assert.ok(Object.isFrozen(sections[0]));
  });
});

describe('validation/core envelope', () => {
  beforeEach(clearRegisteredSections);

  it('returns the target error envelope shape', () => {
    let result = validateWorkspaceConfig(base());
    assert.deepEqual(Object.keys(result).sort(), ['errors', 'ok', 'suggestedPatches', 'warnings']);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.suggestedPatches, []);
  });

  it('validates the empty envelope cleanly with zero sections registered', () => {
    let result = validateWorkspaceConfig({ version: VERSION });
    assert.equal(result.ok, true);
    assert.equal(getRegisteredSections().length, 0);
  });

  it('never throws on invalid input and reports a config type error', () => {
    for (let bad of [null, undefined, 'string', 42, []]) {
      let result = validateWorkspaceConfig(bad);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((error) => error.code === 'config.type'));
    }
  });

  it('collects section shape-pass issues and preserves suggestedPatches', () => {
    registerSection({
      id: 'structure',
      validate(config, context) {
        if (!config.name) {
          context.error('name', 'structure.name.required', 'Name is required.', {
            suggestedPatches: [{ op: 'add', path: '/name', value: 'Untitled' }],
          });
        }
      },
    });

    let result = validateWorkspaceConfig({ version: VERSION });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.path === 'name' && error.code === 'structure.name.required'));
    assert.deepEqual(result.suggestedPatches, [{ op: 'add', path: '/name', value: 'Untitled' }]);
  });

  it('is strict-only: only registered warning classes stay warnings', () => {
    registerSection({
      id: 'structure',
      validate(config, context) {
        context.warning('nav[0]', 'structure.nav.dead_group', 'Nav group is unreachable.');
        context.warning('data', 'data.soft_hint', 'Soft hint that must escalate.');
      },
    });

    let result = validateWorkspaceConfig(base());
    assert.equal(result.ok, false);
    assert.ok(result.warnings.some((warning) => warning.code === 'structure.nav.dead_group'));
    assert.ok(result.errors.some((error) => error.code === 'data.soft_hint'));
    assert.ok(!result.warnings.some((warning) => warning.code === 'data.soft_hint'));
  });
});

describe('validation/core referential pass', () => {
  beforeEach(clearRegisteredSections);

  it('resolves references across the assembled registry after shape passes', () => {
    let order = [];
    registerSection({
      id: 'structure',
      validate() { order.push('shape:structure'); },
      refProviders(config) {
        order.push('ref:structure');
        return (config.views || []).map((view, index) => ({ id: `view:${view}`, path: `views[${index}]` }));
      },
    });
    registerSection({
      id: 'routes',
      validate() { order.push('shape:routes'); },
      refConsumers(config) {
        order.push('ref:routes');
        return (config.routes || []).map((route, index) => ({
          id: `view:${route.view}`,
          path: `routes[${index}].view`,
          code: 'routes.view.unresolved',
        }));
      },
    });

    let ok = validateWorkspaceConfig(base({ views: ['dashboard'], routes: [{ view: 'dashboard' }] }));
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));

    let missing = validateWorkspaceConfig(base({ views: ['dashboard'], routes: [{ view: 'reports' }] }));
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((error) => error.path === 'routes[0].view' && error.code === 'routes.view.unresolved'));

    assert.ok(
      order.indexOf('shape:structure') < order.indexOf('ref:structure'),
      'shape passes must run before the referential pass',
    );
    assert.ok(
      order.indexOf('shape:routes') < order.indexOf('ref:routes'),
      'shape passes must run before the referential pass',
    );
  });

  it('rejects duplicate reference providers', () => {
    registerSection({
      id: 'structure',
      refProviders: () => [
        { id: 'view:dashboard', path: 'views[0]' },
        { id: 'view:dashboard', path: 'views[1]' },
      ],
    });

    let result = validateWorkspaceConfig(base());
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === 'references.duplicate_provider'));
  });

  it('honors optional consumers', () => {
    registerSection({
      id: 'routes',
      refConsumers: () => [{ id: 'view:maybe', path: 'routes[0].view', optional: true }],
    });

    let result = validateWorkspaceConfig(base());
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });
});

describe('validation/core version guard', () => {
  beforeEach(clearRegisteredSections);

  it('accepts same-major versions with minor <= reader minor', () => {
    assert.equal(isCompatibleVersion('1.0.0'), true);
    assert.equal(isCompatibleVersion('1.1.0'), false);
    assert.equal(isCompatibleVersion('0.9.0'), false);
    assert.equal(isCompatibleVersion('2.0.0'), false);
    assert.equal(isCompatibleVersion('bad'), false);
    assert.equal(isCompatibleVersion(null), false);
  });

  it('flags missing, malformed, and incompatible config versions as errors', () => {
    let missing = validateWorkspaceConfig({ name: 'No version' });
    assert.ok(missing.errors.some((error) => error.path === 'version' && error.code === 'version.required'));

    let malformed = validateWorkspaceConfig({ version: 'bad', name: 'Malformed' });
    assert.ok(malformed.errors.some((error) => error.path === 'version' && error.code === 'version.semver'));

    let incompatible = validateWorkspaceConfig({ version: '2.0.0', name: 'Future' });
    assert.ok(incompatible.errors.some((error) => error.path === 'version' && error.code === 'version.incompatible'));
  });
});
