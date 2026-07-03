import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  EXECUTION_MODELS,
  HOST_SERVICE_CATEGORIES,
  DATA_BINDING_DIRECTIONS,
  WORKSPACE_CONFIG_SCHEMA,
  MODULE_CAPABILITY_DESCRIPTOR_SCHEMA,
  validatePortableStringArray,
  validateWorkspaceConfig,
  isCompatibleVersion,
} from '../schema/index.js';
import {
  COLLAPSE_POLICIES,
  OVERFLOW_POLICIES,
  RESPONSIVE_MODES,
  MOBILE_DOCKS,
  SWIPE_CONTROLS,
  PANEL_SETTING_TYPES,
  STATE_FIELD_TYPES,
  STATE_FIELD_PERSISTENCE,
  ENGINE_BINDING_SURFACES,
  ENGINE_NODE_CACHE_MODES,
  VALIDATION_REPORT_STATUSES,
  VALIDATION_REPORT_SEVERITIES,
} from '../schema/value-classes.js';

function fixtureFileUrl(path) {
  return ['file:', '', '', 'tmp', path].join('/');
}

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

  it('exports execution model values', () => {
    assert.ok(Array.isArray(EXECUTION_MODELS));
    assert.ok(EXECUTION_MODELS.includes('ui-only'));
    assert.ok(EXECUTION_MODELS.includes('graph-execution'));
    assert.ok(EXECUTION_MODELS.includes('automation-bridge'));
  });

  it('exports host service category values', () => {
    assert.ok(Array.isArray(HOST_SERVICE_CATEGORIES));
    assert.ok(HOST_SERVICE_CATEGORIES.includes('agent.runtime'));
    assert.ok(HOST_SERVICE_CATEGORIES.includes('storage.project'));
  });

  it('exports data binding directions', () => {
    assert.deepEqual(DATA_BINDING_DIRECTIONS, ['input', 'output', 'two-way']);
  });

  it('exports shared value classes used by schema and validator core', () => {
    assert.deepEqual(COLLAPSE_POLICIES, ['auto', 'manual', 'never']);
    assert.ok(OVERFLOW_POLICIES.includes('scroll-inline'));
    assert.ok(RESPONSIVE_MODES.includes('drawer'));
    assert.ok(MOBILE_DOCKS.includes('primary'));
    assert.ok(SWIPE_CONTROLS.includes('edge'));
    assert.ok(PANEL_SETTING_TYPES.includes('token'));
    assert.ok(STATE_FIELD_TYPES.includes('json'));
    assert.deepEqual(STATE_FIELD_PERSISTENCE, ['session', 'workspace', 'ephemeral']);
    assert.ok(ENGINE_BINDING_SURFACES.includes('action'));
    assert.ok(ENGINE_NODE_CACHE_MODES.includes('freeze'));
    assert.deepEqual(VALIDATION_REPORT_STATUSES, ['pass', 'warn', 'blocked']);
    assert.deepEqual(VALIDATION_REPORT_SEVERITIES, ['info', 'warning', 'error']);
  });

  it('exports frozen schema object', () => {
    assert.ok(Object.isFrozen(WORKSPACE_CONFIG_SCHEMA));
    assert.equal(WORKSPACE_CONFIG_SCHEMA.type, 'object');
    assert.ok(WORKSPACE_CONFIG_SCHEMA.required.includes('version'));
    assert.ok(WORKSPACE_CONFIG_SCHEMA.required.includes('name'));
    assert.deepEqual(
      WORKSPACE_CONFIG_SCHEMA.$defs.validationReport.required,
      ['id', 'check', 'status', 'severity', 'message'],
    );
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

  it('rejects malformed and incompatible schema versions', () => {
    let malformed = validateWorkspaceConfig({
      version: 'bad',
      name: 'Malformed Version',
    });
    let incompatible = validateWorkspaceConfig({
      version: '2.0.0',
      name: 'Future Version',
    });

    assert.equal(malformed.valid, false);
    assert.ok(malformed.errors.some((error) => error.path === 'version'));
    assert.equal(incompatible.valid, false);
    assert.ok(incompatible.errors.some((error) => error.path === 'version'));
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

  it('accepts valid validation reports', () => {
    let report = {
      id: 'portability-strict-export',
      check: 'portability',
      status: 'pass',
      severity: 'info',
      message: 'Workspace config passes strict portable export checks.',
      diagnostics: [],
    };
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Reported Workspace',
      construction: {
        plan: {
          verification: { reports: [report] },
        },
      },
      validation: { reports: [report] },
    });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects malformed validation reports', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Bad Reports',
      validation: {
        reports: ['bad', {
          id: 123,
          check: '',
          status: 'ready',
          severity: 'notice',
          message: '',
          diagnostics: 'bad',
        }],
      },
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'validation.reports[0]'));
    assert.ok(result.errors.some((error) => error.path === 'validation.reports[1].id'));
    assert.ok(result.errors.some((error) => error.path === 'validation.reports[1].check'));
    assert.ok(result.errors.some((error) => error.path === 'validation.reports[1].status'));
    assert.ok(result.errors.some((error) => error.path === 'validation.reports[1].severity'));
    assert.ok(result.errors.some((error) => error.path === 'validation.reports[1].message'));
    assert.ok(result.errors.some((error) => error.path === 'validation.reports[1].diagnostics'));
  });

  it('rejects malformed construction verification reports', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Bad Construction Reports',
      construction: {
        plan: {
          verification: {
            reports: [{ id: 'bad', check: 'package-readiness', status: 'warning', severity: 'warning', message: 'Bad' }],
          },
        },
      },
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'construction.plan.verification.reports[0].status'));
  });

  it('validates portable execution model metadata', () => {
    let valid = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Execution Workspace',
      intent: {
        brief: 'Build execution workspace',
        executionModel: 'server-session',
        hostServices: ['agent.runtime'],
      },
      execution: {
        model: 'server-session',
        hostServices: ['agent.runtime'],
      },
    }, { strict: true });

    assert.equal(valid.valid, true);

    let invalid = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Execution Workspace',
      intent: {
        brief: 'Build broken execution workspace',
        executionModel: fixtureFileUrl('runtime'),
        hostServices: ['https://api.example.com'],
      },
      execution: {
        model: fixtureFileUrl('runtime'),
        hostServices: [fixtureFileUrl('storage')],
      },
    }, { strict: true });

    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some((error) => error.path === 'intent.executionModel'));
    assert.ok(invalid.errors.some((error) => error.path === 'intent.hostServices[0]'));
    assert.ok(invalid.errors.some((error) => error.path === 'execution.model'));
    assert.ok(invalid.errors.some((error) => error.path === 'execution.hostServices[0]'));
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

  it('accepts root and scoped cascade theme config', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Theme Workspace',
      theme: {
        recipe: 'agent-console',
        params: { mode: 'dark', hue: 220 },
        relations: { surfaceStep: 1.15 },
        overrides: { '--sn-gap': '8px' },
        subtrees: [{
          selector: '.sidebar',
          params: { hue: 180 },
          relations: { radiusScale: 0.8 },
          overrides: { '--sn-node-radius': '4px' },
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.errors.length, 0);
  });

  it('rejects invalid cascade theme config', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Theme Workspace',
      theme: {
        recipe: '',
        params: [],
        relations: { surfaceStep: Infinity },
        overrides: { gap: 8 },
        subtrees: [{
          selector: '',
          params: 'dark',
          relations: [],
          overrides: { '--sn-radius': 4 },
        }, []],
      },
    }, { strict: true });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'theme.recipe'));
    assert.ok(result.errors.some((error) => error.path === 'theme.params'));
    assert.ok(result.errors.some((error) => error.path === 'theme.relations'));
    assert.ok(result.errors.some((error) => error.path === 'theme.overrides.gap'));
    assert.ok(result.errors.some((error) => error.path === 'theme.subtrees[0].selector'));
    assert.ok(result.errors.some((error) => error.path === 'theme.subtrees[0].params'));
    assert.ok(result.errors.some((error) => error.path === 'theme.subtrees[0].relations'));
    assert.ok(result.errors.some((error) => error.path === 'theme.subtrees[0].overrides.--sn-radius'));
    assert.ok(result.errors.some((error) => error.path === 'theme.subtrees[1]'));
  });

  it('accepts portable state fields', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'State Workspace',
      state: {
        fields: [{
          panelType: 'review',
          component: 'acme-review-panel',
          id: 'selection',
          type: 'object',
          default: null,
          path: 'state.review.selection',
          schema: { type: 'object' },
          persistence: 'session',
        }],
      },
      engine: {
        bindings: [{
          id: 'review-state-selection',
          panelType: 'review',
          component: 'acme-review-panel',
          surface: 'state',
          sourceId: 'selection',
          graphId: 'review-flow',
          nodeId: 'selection',
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.errors.length, 0);
  });

  it('rejects invalid and duplicate state fields', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken State Workspace',
      state: {
        fields: [{
          panelType: 'Review Panel',
          component: 'ReviewPanel',
          id: 'selection field',
          type: 'record',
          path: '/tmp/selection.json',
          schema: 'object',
          persistence: 'local',
          default: 1n,
        }, {
          panelType: 'review',
          component: 'acme-review-panel',
          id: 'selection',
          type: 'object',
        }, {
          panelType: 'review',
          component: 'acme-review-panel',
          id: 'selection',
          type: 'object',
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'state.fields[0].panelType'));
    assert.ok(result.errors.some((error) => error.path === 'state.fields[0].component'));
    assert.ok(result.errors.some((error) => error.path === 'state.fields[0].id'));
    assert.ok(result.errors.some((error) => error.path === 'state.fields[0].type'));
    assert.ok(result.errors.some((error) => error.path === 'state.fields[0].path'));
    assert.ok(result.errors.some((error) => error.path === 'state.fields[0].schema'));
    assert.ok(result.errors.some((error) => error.path === 'state.fields[0].persistence'));
    assert.ok(result.errors.some((error) => error.path === 'state.fields[0].default'));
    assert.ok(result.errors.some((error) => error.path === 'state.fields[2].id'));
  });

  it('rejects non-array state fields', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Non-array State Workspace',
      state: { fields: { id: 'selection' } },
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'state.fields'));
  });

  it('accepts portable engine packs, graphs, and bindings', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Engine Workspace',
      engine: {
        packs: ['analysis-pack'],
        graphs: [{
          id: 'main',
          nodes: [{ id: 'sentiment', type: 'analysis/sentiment', params: { threshold: 0.7 } }],
          connections: [{ from: 'source', out: 'items', to: 'sentiment', in: 'items' }],
        }],
        bindings: [{
          id: 'review-action-analyze',
          panelType: 'review',
          component: 'acme-review-panel',
          surface: 'action',
          sourceId: 'analyze',
          graphId: 'main',
          nodeId: 'sentiment',
          input: 'items',
          pack: 'analysis-pack',
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.errors.length, 0);
  });

  it('accepts engine bindings for external host-provided graphs', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'External Engine Workspace',
      engine: {
        graphs: [{
          id: 'main',
          nodes: [{ id: 'sentiment', type: 'analysis/sentiment' }],
        }],
        bindings: [{
          id: 'review-action-analyze',
          panelType: 'review',
          component: 'acme-review-panel',
          surface: 'action',
          sourceId: 'analyze',
          graphId: 'host-main',
          nodeId: 'sentiment',
          input: 'items',
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.errors.length, 0);
  });

  it('rejects engine bindings that miss declared graph nodes', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Engine References',
      engine: {
        graphs: [{
          id: 'main',
          nodes: [{ id: 'sentiment', type: 'analysis/sentiment' }],
        }],
        bindings: [{
          id: 'review-action-analyze',
          panelType: 'review',
          component: 'acme-review-panel',
          surface: 'action',
          sourceId: 'analyze',
          graphId: 'main',
          nodeId: 'missing',
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'engine.bindings[0].nodeId'));
  });

  it('rejects invalid engine packs, graphs, and bindings', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Engine Workspace',
      engine: {
        packs: ['analysis-pack', 'analysis-pack', 'https://example.com/pack'],
        graphs: [{
          id: 'Main Graph',
          nodes: [
            { id: 'Review Node', type: 'analysis sentiment', params: [] },
            { id: 'Review Node', type: 'analysis/sentiment', cacheMode: 'always' },
          ],
          connections: [{ from: '', out: '', to: 'sentiment', in: '' }],
        }],
        bindings: [{
          id: 'Review Action',
          panelType: 'review',
          component: 'ReviewPanel',
          surface: 'button',
          sourceId: '/tmp/action',
          graphId: 'main',
          nodeId: 'sentiment',
        }, {
          id: 'Review Action',
          panelType: 'review',
          surface: 'action',
          sourceId: 'analyze',
          graphId: 'main',
          nodeId: 'sentiment',
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'engine.packs[1]'));
    assert.ok(result.errors.some((error) => error.path === 'engine.packs[2]'));
    assert.ok(result.errors.some((error) => error.path === 'engine.graphs[0].id'));
    assert.ok(result.errors.some((error) => error.path === 'engine.graphs[0].nodes[0].id'));
    assert.ok(result.errors.some((error) => error.path === 'engine.graphs[0].nodes[0].type'));
    assert.ok(result.errors.some((error) => error.path === 'engine.graphs[0].nodes[0].params'));
    assert.ok(result.errors.some((error) => error.path === 'engine.graphs[0].nodes[1].id'));
    assert.ok(result.errors.some((error) => error.path === 'engine.graphs[0].nodes[1].cacheMode'));
    assert.ok(result.errors.some((error) => error.path === 'engine.graphs[0].connections[0].from'));
    assert.ok(result.errors.some((error) => error.path === 'engine.bindings[0].id'));
    assert.ok(result.errors.some((error) => error.path === 'engine.bindings[0].component'));
    assert.ok(result.errors.some((error) => error.path === 'engine.bindings[0].surface'));
    assert.ok(result.errors.some((error) => error.path === 'engine.bindings[0].sourceId'));
    assert.ok(result.errors.some((error) => error.path === 'engine.bindings[1].id'));
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

  it('validates behavior numeric ranges', () => {
    let valid = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Behavior Workspace',
      rootBehavior: {
        importance: 0,
        minInlineSize: 0,
        minBlockSize: 0,
        responsiveBreakpoint: 0,
      },
    });

    assert.equal(valid.valid, true);

    let invalid = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Behavior Workspace',
      rootBehavior: {
        importance: 200,
        minInlineSize: -1,
        minBlockSize: -1,
        responsiveBreakpoint: -1,
      },
    });

    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some((error) => error.path === 'rootBehavior.importance'));
    assert.ok(invalid.errors.some((error) => error.path === 'rootBehavior.minInlineSize'));
    assert.ok(invalid.errors.some((error) => error.path === 'rootBehavior.minBlockSize'));
    assert.ok(invalid.errors.some((error) => error.path === 'rootBehavior.responsiveBreakpoint'));
  });

  it('validates event bridge metadata', () => {
    let valid = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Event Workspace',
      events: [{
        id: 'workflow-kanban-approvals-drop',
        sourcePanel: 'approvals',
        event: 'sn-board-card-drop',
        targetPanel: 'workflow',
        targetProperty: 'approvalState',
        mapping: { cardId: 'detail.card.id' },
      }],
    });

    assert.equal(valid.valid, true);

    let invalid = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Event Workspace',
      events: [{
        sourcePanel: 'Bad Panel',
        event: '',
        targetPanel: 'https://host.local/panel',
        targetMethod: '',
        targetProperty: '',
        mapping: [],
      }],
    });

    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some((error) => error.path === 'events[0].sourcePanel'));
    assert.ok(invalid.errors.some((error) => error.path === 'events[0].event'));
    assert.ok(invalid.errors.some((error) => error.path === 'events[0].targetPanel'));
    assert.ok(invalid.errors.some((error) => error.path === 'events[0].targetMethod'));
    assert.ok(invalid.errors.some((error) => error.path === 'events[0].targetProperty'));
    assert.ok(invalid.errors.some((error) => error.path === 'events[0].mapping'));
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

  it('warns when named layouts reference unregistered panel types', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Named Layout References',
      panelTypes: {
        editor: { title: 'Editor', component: 'sw-editor-panel' },
      },
      layouts: {
        secondary: {
          type: 'split',
          direction: 'horizontal',
          first: { type: 'panel', panelType: 'editor' },
          second: { type: 'panel', panelType: 'missing' },
        },
      },
    }, { strict: true });

    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((error) => error.path === 'layouts.secondary.second.panelType'));
  });

  it('rejects panel type titles and components that are not non-empty strings', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Invalid Panel Types',
      panelTypes: {
        board: { title: { text: 'Board' }, component: 'sn-kanban-board' },
        table: { title: 'Table', component: { tag: 'sn-data-table' } },
        empty: { title: '', component: '' },
      },
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'panelTypes.board.title'));
    assert.ok(result.errors.some((error) => error.path === 'panelTypes.table.component'));
    assert.ok(result.errors.some((error) => error.path === 'panelTypes.empty.title'));
    assert.ok(result.errors.some((error) => error.path === 'panelTypes.empty.component'));
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
          state: [{ id: 'selection', type: 'object', default: null, path: 'state.selection', persistence: 'session', engine: { graphId: 'main', nodeId: 'selection', input: 'value' } }],
          events: { emits: [{ name: 'row-select', engine: { graphId: 'main', nodeId: 'select', output: 'row' } }], consumes: [{ name: 'data-update' }] },
          bindings: [{ id: 'rows', direction: 'input', path: 'data.rows', engine: { graphId: 'main', nodeId: 'rows', input: 'items' } }],
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

  it('validates portable panel settings', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Settings Workspace',
      panelTypes: {
        table: {
          title: 'Table',
          component: 'sn-data-table',
          settings: [{ id: 'page-size', label: 'Page size', type: 'number', default: 50 }],
        },
      },
    }, { strict: true });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);

    let invalid = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Settings Workspace',
      panelTypes: {
        table: {
          title: 'Table',
          component: 'sn-data-table',
          settings: [
            { id: 'page-size', label: 'Page size', type: 'number' },
            { id: 'page-size', label: 'Duplicate', type: 'unknown', options: true },
          ],
        },
      },
    }, { strict: true });

    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some((error) => error.path === 'panelTypes.table.settings[1].id'));
    assert.ok(invalid.errors.some((error) => error.path === 'panelTypes.table.settings[1].type'));
    assert.ok(invalid.errors.some((error) => error.path === 'panelTypes.table.settings[1].options'));
  });

  it('validates portable panel slots', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Slot Workspace',
      panelTypes: {
        table: {
          title: 'Table',
          component: 'sn-data-table',
          slots: [{ id: 'empty-state', role: 'fallback', accepts: ['sn-empty-state'], required: true }],
        },
      },
    }, { strict: true });

    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);

    let invalid = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Slot Workspace',
      panelTypes: {
        table: {
          title: 'Table',
          component: 'sn-data-table',
          slots: [
            { id: 'empty-state', accepts: ['sn-empty-state'] },
            { id: 'empty-state', role: 'bad role', accepts: [42], required: 'yes' },
          ],
        },
      },
    }, { strict: true });

    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some((error) => error.path === 'panelTypes.table.slots[1].id'));
    assert.ok(invalid.errors.some((error) => error.path === 'panelTypes.table.slots[1].role'));
    assert.ok(invalid.errors.some((error) => error.path === 'panelTypes.table.slots[1].accepts[0]'));
    assert.ok(invalid.errors.some((error) => error.path === 'panelTypes.table.slots[1].required'));
  });

  it('rejects invalid module capability descriptors', () => {
    let result = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Workspace',
      components: {
        modules: [{
          tagName: 'Data Table',
          provider: '/tmp/provider-pack',
          descriptor: { package: fixtureFileUrl('provider.js') },
          capabilities: ['data table'],
          actions: [{ id: 'refresh', engine: { graphId: 'main graph', nodeId: 'refresh' } }],
          state: [{ id: 'Selected State', type: 'record', default: NaN, schema: 'object', persistence: 'local', engine: { graphId: 'main', nodeId: '/tmp/state' } }],
          bindings: [{ id: 'rows', direction: 'input', engine: { graphId: 'main', nodeId: '/tmp/rows' } }],
          requiredHostServices: ['https://api.example.com'],
        }],
      },
    }, { strict: true });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].tagName'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].provider'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].descriptor.package'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].capabilities[0]'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].actions[0].label'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].actions[0].engine.graphId'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].state[0].id'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].state[0].type'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].state[0].default'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].state[0].schema'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].state[0].persistence'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].state[0].engine.nodeId'));
    assert.ok(result.errors.some((error) => error.path === 'components.modules[0].bindings[0].engine.nodeId'));
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

  it('rejects malformed semver', () => {
    assert.equal(isCompatibleVersion('bad'), false);
    assert.equal(isCompatibleVersion('0.bad.0'), false);
  });
});
