import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  DATA_BINDING_DIRECTIONS,
  WORKSPACE_CONFIG_SCHEMA,
  MODULE_CAPABILITY_DESCRIPTOR_SCHEMA,
  validatePortableStringArray,
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

  it('exports data binding directions', () => {
    assert.deepEqual(DATA_BINDING_DIRECTIONS, ['input', 'output', 'two-way']);
  });

  it('exports frozen schema object', () => {
    assert.ok(Object.isFrozen(WORKSPACE_CONFIG_SCHEMA));
    assert.equal(WORKSPACE_CONFIG_SCHEMA.type, 'object');
    assert.ok(WORKSPACE_CONFIG_SCHEMA.required.includes('version'));
    assert.ok(WORKSPACE_CONFIG_SCHEMA.required.includes('name'));
    assert.deepEqual(
      WORKSPACE_CONFIG_SCHEMA.properties.data.properties.bindings.items.required,
      ['panelType', 'component', 'id', 'direction'],
    );
  });

  it('exports module capability descriptor schema', () => {
    assert.ok(Object.isFrozen(MODULE_CAPABILITY_DESCRIPTOR_SCHEMA));
    assert.deepEqual(MODULE_CAPABILITY_DESCRIPTOR_SCHEMA.required, ['tagName']);
  });

  it('exports portable string array validation helper', () => {
    let errors = [];
    validatePortableStringArray(['valid.id', 'Invalid Label'], 'capabilities', errors);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'capabilities[1]');
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

  it('accepts portable data bindings', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Binding Workspace',
      data: {
        bindings: [{
          panelType: 'sn-data-table',
          component: 'sn-data-table',
          id: 'rows',
          direction: 'input',
          path: 'data.rows',
          schema: { type: 'array' },
        }, {
          panelType: 'sn-editor',
          component: 'sn-code-editor',
          id: 'draft',
          direction: 'two-way',
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects invalid data binding shape', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Binding Workspace',
      data: {
        bindings: [{
          panelType: 'Data Table',
          component: 'DataTable',
          id: 'rows list',
          direction: 'read',
          path: '/tmp/rows.json',
          schema: 'array',
        }, {
          component: 'sn-chart',
          id: 'series',
          direction: 'output',
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'data.bindings[0].panelType'));
    assert.ok(result.errors.some((error) => error.path === 'data.bindings[0].component'));
    assert.ok(result.errors.some((error) => error.path === 'data.bindings[0].id'));
    assert.ok(result.errors.some((error) => error.path === 'data.bindings[0].direction'));
    assert.ok(result.errors.some((error) => error.path === 'data.bindings[0].path'));
    assert.ok(result.errors.some((error) => error.path === 'data.bindings[0].schema'));
    assert.ok(result.errors.some((error) => error.path === 'data.bindings[1].panelType'));
  });

  it('rejects non-array and duplicate data bindings', () => {
    let nonArray = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Non-array Binding Workspace',
      data: { bindings: { id: 'rows' } },
    });

    assert.equal(nonArray.valid, false);
    assert.ok(nonArray.errors.some((error) => error.path === 'data.bindings'));

    let duplicate = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Duplicate Binding Workspace',
      data: {
        bindings: [{
          panelType: 'sn-data-table',
          component: 'sn-data-table',
          id: 'rows',
          direction: 'input',
        }, {
          panelType: 'sn-data-table',
          component: 'sn-data-table',
          id: 'rows',
          direction: 'output',
        }],
      },
    });

    assert.equal(duplicate.valid, false);
    assert.ok(duplicate.errors.some((error) => error.path === 'data.bindings[1].id'));
  });

  it('rejects non-object data config', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Data Workspace',
      data: [],
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'data'));
  });

  it('validates layout node types', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Test',
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        first: { type: 'panel', panelType: 'a' },
        second: { type: 'panel', panelType: 'b' },
      },
    });
    assert.equal(result.valid, true);
  });

  it('rejects split layout children without BSP first and second nodes', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Children Layout',
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          { type: 'panel', panelType: 'a' },
          { type: 'panel', panelType: 'b' },
        ],
      },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'layout.children'));
    assert.ok(result.errors.some((error) => error.path === 'layout.first'));
    assert.ok(result.errors.some((error) => error.path === 'layout.second'));
  });

  it('rejects children arrays on layout nodes', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Children Layout',
      layout: {
        type: 'group',
        children: [
          { type: 'panel', panelType: 'a' },
        ],
      },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'layout.children'));
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

  it('accepts module capability descriptors in component metadata', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Admin Workspace',
      components: {
        catalog: ['sn-data-table'],
        modules: [{
          tagName: 'sn-data-table',
          schemaVersion: '0.1.0',
          provider: 'symbiote-ui',
          descriptor: {
            schemaVersion: '2.0.0',
            package: 'symbiote-ui',
            export: 'display/data-table',
            component: 'sn-data-table',
          },
          capabilities: ['data.table', 'admin.bulk-actions'],
          actions: [{ id: 'refresh', label: 'Refresh', event: 'refresh' }],
          menus: [{ id: 'row-menu', label: 'Row menu', items: [{ id: 'open', label: 'Open' }] }],
          toolbarItems: [{ id: 'filter', label: 'Filter', command: 'filter.open' }],
          settings: [{ id: 'page-size', label: 'Page size', type: 'number', default: 50 }],
          events: { emits: [{ name: 'row-select' }], consumes: [{ name: 'data-update' }] },
          bindings: [{ id: 'rows', direction: 'input', path: 'data.rows' }],
          slots: [{ id: 'empty-state', accepts: ['sn-empty-state'] }],
          runtimeSlots: [{ id: 'data-provider', role: 'provider', required: true }],
          requiredHostServices: ['storage.project', 'selection'],
          placement: { regions: ['main'], registers: ['admin'] },
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects invalid module capability descriptors', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Workspace',
      components: {
        modules: [{
          tagName: 'Data Table',
          capabilities: ['data table'],
          actions: [{ id: 'refresh' }],
          requiredHostServices: ['https://api.example.com'],
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].tagName'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].capabilities[0]'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].actions[0].label'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].requiredHostServices[0]'));
  });

  it('rejects invalid executable module placement metadata', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Placement Workspace',
      components: {
        modules: [{
          tagName: 'acme-sentiment-panel',
          capabilities: ['analysis.sentiment'],
          placement: {
            panelType: 'Bad Panel',
            title: '',
            icon: 'bad icon',
            behavior: 'wide',
            regions: ['/local/path'],
          },
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].placement.panelType'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].placement.title'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].placement.icon'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].placement.behavior'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].placement.regions[0]'));
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
