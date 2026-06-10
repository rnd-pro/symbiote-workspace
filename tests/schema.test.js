import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  WORKSPACE_CONFIG_SCHEMA,
  validateWorkspaceConfig,
  isCompatibleVersion,
} from '../schema/index.js';

describe('schema', () => {
  it('exports schema version', () => {
    assert.equal(typeof WORKSPACE_SCHEMA_VERSION, 'string');
    assert.ok(WORKSPACE_SCHEMA_VERSION.match(/^\d+\.\d+\.\d+$/));
  });

  it('exports register values', () => {
    assert.ok(Array.isArray(WORKSPACE_REGISTER_VALUES));
    assert.ok(WORKSPACE_REGISTER_VALUES.includes('tool'));
    assert.ok(WORKSPACE_REGISTER_VALUES.includes('brand'));
    assert.ok(WORKSPACE_REGISTER_VALUES.includes('presentation'));
  });

  it('exports frozen schema object', () => {
    assert.ok(Object.isFrozen(WORKSPACE_CONFIG_SCHEMA));
    assert.equal(WORKSPACE_CONFIG_SCHEMA.type, 'object');
    assert.ok(WORKSPACE_CONFIG_SCHEMA.required.includes('version'));
    assert.ok(WORKSPACE_CONFIG_SCHEMA.required.includes('name'));
  });
});

describe('validateWorkspaceConfig', () => {
  it('validates minimal valid config', () => {
    let result = validateWorkspaceConfig({
      version: '0.1.0',
      name: 'Test Workspace',
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects missing version', () => {
    let result = validateWorkspaceConfig({ name: 'Test' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'version'));
  });

  it('rejects missing name', () => {
    let result = validateWorkspaceConfig({ version: '0.1.0' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'name'));
  });

  it('rejects non-object input', () => {
    let result = validateWorkspaceConfig('string');
    assert.equal(result.valid, false);
  });

  it('rejects invalid register value', () => {
    let result = validateWorkspaceConfig({
      version: '0.1.0',
      name: 'Test',
      register: 'invalid',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'register'));
  });

  it('accepts valid register values', () => {
    for (let register of WORKSPACE_REGISTER_VALUES) {
      let result = validateWorkspaceConfig({
        version: '0.1.0',
        name: 'Test',
        register,
      });
      assert.equal(result.valid, true, `register "${register}" should be valid`);
    }
  });

  it('warns on auth-like keys in config', () => {
    let result = validateWorkspaceConfig({
      version: '0.1.0',
      name: 'Test',
      data: { apiKey: '12345' },
    });
    assert.equal(result.valid, true);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings.some((w) => w.message.includes('non-portable')));
  });

  it('warns on URL values in config', () => {
    let result = validateWorkspaceConfig({
      version: '0.1.0',
      name: 'Test',
      data: { endpoint: 'https://api.example.com' },
    });
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.message.includes('server URLs')));
  });

  it('validates layout node types', () => {
    let result = validateWorkspaceConfig({
      version: '0.1.0',
      name: 'Test',
      layout: {
        type: 'split',
        children: [
          { type: 'single', component: 'sn-panel' },
          { type: 'single', component: 'sn-panel' },
        ],
      },
    });
    assert.equal(result.valid, true);
  });

  it('rejects unknown keys in strict mode', () => {
    let result = validateWorkspaceConfig({
      version: '0.1.0',
      name: 'Test',
      unknownField: true,
    }, { strict: true });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes('unknownField')));
  });
});

describe('isCompatibleVersion', () => {
  it('matches same major version', () => {
    assert.equal(isCompatibleVersion('0.1.0'), true);
    assert.equal(isCompatibleVersion('0.2.0'), true);
    assert.equal(isCompatibleVersion('0.99.99'), true);
  });

  it('rejects different major version', () => {
    assert.equal(isCompatibleVersion('1.0.0'), false);
    assert.equal(isCompatibleVersion('2.0.0'), false);
  });

  it('rejects non-string', () => {
    assert.equal(isCompatibleVersion(null), false);
    assert.equal(isCompatibleVersion(123), false);
  });
});
