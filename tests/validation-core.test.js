import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateWorkspaceConfig,
  isCompatibleVersion,
} from '../validation/core.js';
import {
  validateWorkspaceConfig as validateViaLegacyPath,
  isCompatibleVersion as isCompatibleViaLegacyPath,
} from '../schema/validate.js';
import {
  validateWorkspaceConfig as validateViaSchemaIndex,
} from '../schema/index.js';

describe('validation/core', () => {
  it('exports the workspace validator from the keystone module', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Core Workspace',
      data: {
        bindings: [{
          panelType: 'main',
          component: 'sn-data-table',
          id: 'rows',
          direction: 'input',
          path: 'data.rows',
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.errors.length, 0);
  });

  it('keeps schema index and legacy validate path on the same implementation', () => {
    assert.equal(validateViaSchemaIndex, validateWorkspaceConfig);
    assert.equal(validateViaLegacyPath, validateWorkspaceConfig);
    assert.equal(isCompatibleViaLegacyPath, isCompatibleVersion);
  });

  it('rejects non-portable values through the extracted core', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Core Workspace',
      execution: {
        model: 'server-session',
        hostServices: ['https://api.example.com'],
      },
      engine: {
        packs: ['local pack'],
      },
    }, { strict: true });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'execution.hostServices[0]'));
    assert.ok(result.errors.some((error) => error.path === 'engine.packs[0]'));
  });
});
