import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_SECTION_MODULES,
  assembleWorkspaceSchema,
  getWorkspaceSchema,
  WORKSPACE_CONFIG_SCHEMA,
  validateWorkspaceConfig,
  isCompatibleVersion,
} from '../schema/workspace-schema.js';
import {
  VALUE_CLASSES,
  SEMVER_PATTERN,
  classifyValueSlot,
  isGrantObject,
  nonPortableStringReason,
} from '../schema/value-classes.js';

describe('schema assembler', () => {
  it('exports the target-major schema version', () => {
    assert.match(WORKSPACE_SCHEMA_VERSION, SEMVER_PATTERN);
    assert.equal(WORKSPACE_SCHEMA_VERSION.split('.')[0], '1');
    assert.equal(isCompatibleVersion(WORKSPACE_SCHEMA_VERSION), true);
  });

  it('ships the W1 section modules through the assembler', () => {
    assert.ok(Object.isFrozen(WORKSPACE_SECTION_MODULES));
    assert.deepEqual(WORKSPACE_SECTION_MODULES.map((section) => section.id), [
      'structure',
      'modules',
      'wiring',
      'data',
      'workspace-surfaces',
      'routes',
      'behavior',
      'server',
      'state',
    ]);
  });

  it('assembles a schema descriptor from the section registry', () => {
    let descriptor = assembleWorkspaceSchema();
    assert.deepEqual(descriptor, {
      version: WORKSPACE_SCHEMA_VERSION,
      sections: WORKSPACE_SECTION_MODULES.map((section) => section.id),
    });
    assert.deepEqual(getWorkspaceSchema(), descriptor);
  });

  it('keeps the exported config schema descriptor aligned with target top-level sections', () => {
    assert.ok(Object.isFrozen(WORKSPACE_CONFIG_SCHEMA.properties));
    for (let key of [
      'views',
      'register',
      'layouts',
      'panels',
      'modules',
      'requires',
      'wires',
      'data',
      'state',
      'routes',
      'redirects',
      'behavior',
      'server',
    ]) {
      assert.ok(WORKSPACE_CONFIG_SCHEMA.properties[key], `missing descriptor property ${key}`);
    }
  });

  it('validates a minimal target-schema config end-to-end after assembly', () => {
    assembleWorkspaceSchema();
    let result = validateWorkspaceConfig({ version: WORKSPACE_SCHEMA_VERSION, name: 'Minimal Workspace' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.errors, []);
  });

  it('validates through the registered section modules', () => {
    assembleWorkspaceSchema();
    let result = validateWorkspaceConfig({
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Pluggable Workspace',
      groups: {},
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.path === 'groups'));
  });

  it('rejects incompatible config versions through the assembler surface', () => {
    assembleWorkspaceSchema();
    let result = validateWorkspaceConfig({ version: '2.0.0', name: 'Future Workspace' });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.path === 'version'));
  });
});

describe('schema value classes', () => {
  it('classifies string slots by schema location', () => {
    assert.deepEqual([...VALUE_CLASSES], ['id', 'text', 'path', 'pattern', 'code']);
    assert.equal(classifyValueSlot('routes[0].pattern'), 'pattern');
    assert.equal(classifyValueSlot('meta.canonical'), 'pattern');
    assert.equal(classifyValueSlot('assets[2].source.path'), 'path');
    assert.equal(classifyValueSlot('components.custom[0].code'), 'code');
    assert.equal(classifyValueSlot('panelTypes.table.title'), 'text');
    assert.equal(classifyValueSlot('components.catalog[0]'), 'id');
  });

  it('applies portability rules per value class', () => {
    assert.equal(nonPortableStringReason({ path: 'routes[0].pattern', value: '/orders/:id' }), null);
    assert.equal(nonPortableStringReason({ path: 'assets[0].source.path', value: 'assets/logo.png' }), null);
    assert.equal(nonPortableStringReason({ path: 'assets[0].source.path', value: 'https://cdn.example.com/x.png' }), 'url-in-path');
    assert.equal(nonPortableStringReason({ path: 'components.catalog[0]', value: 'https://cdn.example.com/x.js' }), 'url');
    assert.equal(nonPortableStringReason({ path: 'components.catalog[0]', value: '/Users/me/x.js' }), 'host-path');
    assert.equal(nonPortableStringReason({ path: 'panelTypes.table.title', value: 'https://not-scanned' }), null);
  });

  it('detects grant objects', () => {
    assert.equal(isGrantObject({
      id: 'g-7',
      principal: { kind: 'agent', id: 'construction' },
      scope: ['views[dashboard].*'],
      kinds: ['config_patch'],
      expiry: 'task',
    }), true);
    assert.equal(isGrantObject({ id: 'not-a-grant', scope: 'x' }), false);
    assert.equal(isGrantObject('string'), false);
  });
});
