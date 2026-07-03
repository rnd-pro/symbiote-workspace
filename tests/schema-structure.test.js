import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerSection,
  clearRegisteredSections,
  validateWorkspaceConfig,
} from '../validation/core.js';
import { structureSection } from '../schema/sections/structure.js';

/** Register the STRUCTURE section (+ optional sibling stubs) and validate. */
function validate(config, ...stubs) {
  clearRegisteredSections();
  registerSection(structureSection);
  for (let stub of stubs) registerSection(stub);
  return validateWorkspaceConfig(config);
}

/** A sibling section that provides the given referential ids (module:/state:/collection:). */
function providerStub(ids) {
  return { id: 'stub-providers', refProviders: () => ids.map((id) => ({ id })) };
}

/** A sibling section that consumes one referential id, to probe STRUCTURE's providers. */
function consumerStub(id) {
  return { id: 'stub-consumer', refConsumers: () => [{ id, path: 'probe', code: 'probe.unresolved' }] };
}

function codes(report) {
  return report.errors.map((e) => e.code);
}
function hasError(report, code) {
  return report.errors.some((e) => e.code === code);
}
function hasWarning(report, code) {
  return report.warnings.some((w) => w.code === code);
}

/** A fully valid single-view workspace; module ids backed by a provider stub. */
function validWorkspace() {
  return {
    version: '1.0.0',
    name: 'Records',
    views: [
      {
        id: 'records',
        title: { $t: 'views.records.title' },
        icon: 'table',
        layout: { $layout: 'records-focus' },
        route: { pattern: '/records/:recordId?' },
        nav: { group: 'operations', order: 100 },
        lifecycle: 'durable',
        behavior: { responsiveMode: 'drawer', responsiveBreakpoint: 820 },
        requires: 'records.read',
      },
    ],
    layouts: {
      'records-focus': {
        kind: 'bsp',
        root: {
          type: 'split', id: 'main-split', direction: 'horizontal', ratio: 0.7,
          first: { type: 'panel', id: 'records-main', panel: 'records', settings: { pageSize: 100 } },
          second: { type: 'panel', id: 'audit-side', panel: 'audit', behavior: { importance: 45 } },
        },
      },
    },
    panels: {
      records: {
        module: 'sn-data-table',
        title: { $t: 'panels.records.title' },
        behavior: { importance: 90, minInlineSize: 360 },
        menu: [{ ref: 'action:refresh' }, { ref: 'action:export', order: 2 }],
        settings: { pageSize: 50 },
        requires: 'records.read',
      },
      audit: { module: 'sn-audit-log' },
    },
    nav: { groups: [{ id: 'operations', title: { $t: 'nav.operations' }, icon: 'admin_panel_settings', order: 0 }] },
  };
}

const MODULE_PROVIDERS = providerStub(['module:sn-data-table', 'module:sn-audit-log']);

beforeEach(() => clearRegisteredSections());

describe('STRUCTURE — valid baseline', () => {
  it('validates a full workspace clean with module providers present', () => {
    let report = validate(validWorkspace(), MODULE_PROVIDERS);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.warnings.length, 0);
  });

  it('is registerable via the { id, validate, refProviders, refConsumers } contract', () => {
    assert.equal(structureSection.id, 'structure');
    assert.equal(typeof structureSection.validate, 'function');
    assert.equal(typeof structureSection.refProviders, 'function');
    assert.equal(typeof structureSection.refConsumers, 'function');
  });

  it('validates the empty envelope clean (section is inert without structure)', () => {
    let report = validate({ version: '1.0.0', name: 'Empty' });
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  });
});

describe('STRUCTURE — views[]', () => {
  it('rejects a non-structural view id', () => {
    let config = validWorkspace();
    config.views[0].id = 'Records--X';
    assert.ok(hasError(validate(config), 'structure.view.id'));
  });

  it('rejects duplicate view ids', () => {
    let config = validWorkspace();
    config.views.push({ ...config.views[0], nav: undefined });
    assert.ok(hasError(validate(config), 'structure.view.duplicate_id'));
  });

  it('requires a localizable title', () => {
    let config = validWorkspace();
    delete config.views[0].title;
    assert.ok(hasError(validate(config), 'structure.view.title'));
  });

  it('requires a layout (missing = ERROR)', () => {
    let config = validWorkspace();
    delete config.views[0].layout;
    assert.ok(hasError(validate(config), 'structure.view.layout_required'));
  });

  it('rejects both inline and $layout on one view', () => {
    let config = validWorkspace();
    config.views[0].layout = { $layout: 'records-focus', kind: 'bsp', root: { type: 'panel', id: 'x', panel: 'records' } };
    assert.ok(hasError(validate(config), 'structure.view.layout_both'));
  });

  it('rejects an unresolved $layout', () => {
    let config = validWorkspace();
    config.views[0].layout = { $layout: 'ghost-layout' };
    assert.ok(hasError(validate(config), 'structure.view.layout_unresolved'));
  });

  it('rejects an unknown lifecycle', () => {
    let config = validWorkspace();
    config.views[0].lifecycle = 'permanent';
    assert.ok(hasError(validate(config), 'structure.view.lifecycle'));
  });

  it('rejects nav placement on an ephemeral-template view', () => {
    let config = validWorkspace();
    config.views[0].lifecycle = 'ephemeral-template';
    assert.ok(hasError(validate(config), 'structure.view.ephemeral_nav'));
  });

  it('rejects a non-capability requires', () => {
    let config = validWorkspace();
    config.views[0].requires = 'Not A Capability';
    assert.ok(hasError(validate(config), 'structure.view.requires'));
  });

  it('rejects an unknown view key (no redirect view kind exists)', () => {
    let config = validWorkspace();
    config.views[0].redirect = 'other';
    assert.ok(hasError(validate(config), 'structure.unknown_key'));
  });
});

describe('STRUCTURE — layouts{} + node identity', () => {
  it('rejects an unknown layout kind naming the known kinds', () => {
    let config = validWorkspace();
    config.layouts['records-focus'].kind = 'grid';
    let report = validate(config);
    assert.ok(hasError(report, 'structure.layout.unknown_kind'));
    assert.ok(report.errors.some((e) => e.code === 'structure.layout.unknown_kind' && e.message.includes('bsp')));
  });

  it('treats flow as an unknown (deferred) kind, not a layout kind', () => {
    let config = validWorkspace();
    config.layouts['records-focus'] = { kind: 'flow', blocks: [] };
    assert.ok(hasError(validate(config), 'structure.layout.unknown_kind'));
  });

  it('requires an id on every layout node', () => {
    let config = validWorkspace();
    delete config.layouts['records-focus'].root.first.id;
    assert.ok(hasError(validate(config), 'structure.node.id'));
  });

  it('rejects a duplicate node id within one layout value', () => {
    let config = validWorkspace();
    config.layouts['records-focus'].root.second.id = 'records-main';
    assert.ok(hasError(validate(config), 'structure.node.duplicate_id'));
  });

  it('rejects a split ratio outside SPLIT_RATIO_BOUNDS', () => {
    let config = validWorkspace();
    config.layouts['records-focus'].root.ratio = 0.99;
    assert.ok(hasError(validate(config), 'structure.split.ratio_bounds'));
  });

  it('rejects a leaf whose panel is not declared in panels{}', () => {
    let config = validWorkspace();
    config.layouts['records-focus'].root.first.panel = 'ghost';
    assert.ok(hasError(validate(config), 'structure.leaf.panel_unknown'));
  });

  it('rejects the deleted panelState blob as an unknown key', () => {
    let config = validWorkspace();
    config.layouts['records-focus'].root.first.panelState = { foo: 1 };
    assert.ok(hasError(validate(config), 'structure.unknown_key'));
  });

  it('validates an inline view layout the same way', () => {
    let config = validWorkspace();
    config.views[0].layout = { kind: 'bsp', root: { type: 'panel', panel: 'records' } };
    delete config.layouts;
    // missing node id on the inline leaf
    assert.ok(hasError(validate(config, MODULE_PROVIDERS), 'structure.node.id'));
  });
});

describe('STRUCTURE — stack layouts', () => {
  function stackWorkspace(stack) {
    return {
      version: '1.0.0', name: 'Stacks',
      views: [{ id: 'work', title: 'Work', layout: { kind: 'stack', ...stack } }],
      panels: { terminal: { module: 'sn-terminal' }, editor: { module: 'sn-editor' } },
    };
  }

  it('accepts a static stack and resolves active against a child id', () => {
    let report = validate(
      stackWorkspace({ id: 'dock', active: 'term-1', children: [{ type: 'panel', id: 'term-1', panel: 'terminal' }] }),
      providerStub(['module:sn-terminal', 'module:sn-editor']),
    );
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  });

  it('rejects an active that names no child', () => {
    let report = validate(stackWorkspace({
      id: 'dock', active: 'ghost', children: [{ type: 'panel', id: 'term-1', panel: 'terminal' }],
    }));
    assert.ok(hasError(report, 'structure.stack.active_unknown'));
  });

  it('rejects mixing children with a dynamic form', () => {
    let report = validate(stackWorkspace({
      id: 'dock', children: [{ type: 'panel', id: 'term-1', panel: 'terminal' }],
      of: 'editor', itemsBinding: 'state:workbench.openFiles',
    }));
    assert.ok(hasError(report, 'structure.stack.mixed_form'));
  });

  it('rejects a dynamic stack whose of is not a placement', () => {
    let report = validate(stackWorkspace({
      id: 'editors', of: 'ghost', itemsBinding: 'state:workbench.openFiles',
    }));
    assert.ok(hasError(report, 'structure.stack.of_unknown'));
  });

  it('rejects an invalid itemsBinding', () => {
    let report = validate(stackWorkspace({
      id: 'editors', of: 'editor', itemsBinding: 'workbench.openFiles',
    }));
    assert.ok(hasError(report, 'structure.stack.items_binding_invalid'));
  });

  it('accepts a state-bound dynamic stack when the state field resolves', () => {
    let report = validate(
      stackWorkspace({
        id: 'editors', of: 'editor',
        itemsBinding: 'state:workbench.open-files',
        activeBinding: 'state:workbench.active-file',
      }),
      providerStub(['module:sn-terminal', 'module:sn-editor', 'state:workbench']),
    );
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  });

  it('accepts a collection-bound dynamic stack (ruling 10 as amended by R5)', () => {
    let report = validate(
      stackWorkspace({ id: 'editors', of: 'editor', itemsBinding: { collection: 'files' } }),
      providerStub(['module:sn-terminal', 'module:sn-editor', 'collection:files']),
    );
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  });
});

describe('STRUCTURE — panels{}', () => {
  it('requires a module', () => {
    let config = validWorkspace();
    delete config.panels.records.module;
    assert.ok(hasError(validate(config), 'structure.panels.module_required'));
  });

  it('reports an unresolved module through the referential pass', () => {
    // No provider stub → module refs do not resolve.
    let report = validate(validWorkspace());
    assert.ok(hasError(report, 'structure.panel.module_unresolved'));
  });

  it('rejects a menu entry that is not an action reference', () => {
    let config = validWorkspace();
    config.panels.records.menu = [{ ref: 'refresh' }];
    assert.ok(hasError(validate(config), 'structure.menu.ref'));
  });

  it('rejects redeclared action shape fields on a menu entry', () => {
    let config = validWorkspace();
    config.panels.records.menu = [{ ref: 'action:refresh', dispatch: 'doRefresh', label: 'Refresh' }];
    assert.ok(hasError(validate(config), 'structure.unknown_key'));
  });

  it('rejects a non-capability panel requires', () => {
    let config = validWorkspace();
    config.panels.records.requires = 'BAD CAP';
    assert.ok(hasError(validate(config), 'structure.panels.requires'));
  });

  it('rejects session-tier chrome flags (removable/closeable)', () => {
    let config = validWorkspace();
    config.panels.records.removable = false;
    assert.ok(hasError(validate(config), 'structure.unknown_key'));
  });
});

describe('STRUCTURE — nav{}', () => {
  it('rejects duplicate nav group ids', () => {
    let config = validWorkspace();
    config.nav.groups.push({ id: 'operations', title: { $t: 'dup' } });
    assert.ok(hasError(validate(config), 'structure.nav.duplicate_group'));
  });

  it('rejects a view nav.group that does not resolve', () => {
    let config = validWorkspace();
    config.views[0].nav = { group: 'ghost' };
    assert.ok(hasError(validate(config), 'structure.view.nav_group_unknown'));
  });

  it('rejects deleted chrome fields on a nav group', () => {
    let config = validWorkspace();
    config.nav.groups[0].color = '#fff';
    assert.ok(hasError(validate(config), 'structure.unknown_key'));
  });

  it('warns (the single tolerated warning) on an unreferenced nav group', () => {
    let config = validWorkspace();
    config.nav.groups.push({ id: 'orphan', title: { $t: 'nav.orphan' } });
    let report = validate(config, MODULE_PROVIDERS);
    assert.ok(hasWarning(report, 'structure.nav.dead_group'));
  });
});

describe('STRUCTURE — deleted top-level vocabulary', () => {
  for (let key of ['groups', 'sections', 'layout']) {
    it(`rejects a top-level "${key}" key`, () => {
      let config = validWorkspace();
      config[key] = key === 'layout' ? { kind: 'bsp' } : [];
      assert.ok(hasError(validate(config), 'structure.deleted_key'));
    });
  }
});

describe('STRUCTURE — WAS provider registration (§6)', () => {
  it('provides view:/panel:/stack:root addresses so cross-section refs resolve', () => {
    let config = validWorkspace();
    for (let id of ['view:records', 'panel:records:records-main', 'panel:records:audit-side', 'stack:root']) {
      let report = validate(config, MODULE_PROVIDERS, consumerStub(id));
      assert.ok(!report.errors.some((e) => e.code === 'probe.unresolved'), `expected ${id} to resolve`);
    }
  });

  it('does NOT provide an address for a leaf that does not exist', () => {
    let report = validate(validWorkspace(), MODULE_PROVIDERS, consumerStub('panel:records:ghost'));
    assert.ok(report.errors.some((e) => e.code === 'probe.unresolved'));
  });

  it('provides stack:<viewId>:<stackId> for stack nodes', () => {
    let config = {
      version: '1.0.0', name: 'Docked',
      views: [{ id: 'work', title: 'Work', layout: { kind: 'stack', id: 'bottom-dock', children: [{ type: 'panel', id: 'term-1', panel: 'terminal' }] } }],
      panels: { terminal: { module: 'sn-terminal' } },
    };
    let report = validate(config, providerStub(['module:sn-terminal']), consumerStub('stack:work:bottom-dock'));
    assert.ok(!report.errors.some((e) => e.code === 'probe.unresolved'));
  });

  it('qualifies a shared $layout per view (both panel addresses resolve)', () => {
    let config = {
      version: '1.0.0', name: 'Shared',
      views: [
        { id: 'alpha', title: 'Alpha', layout: { $layout: 'solo' } },
        { id: 'beta', title: 'Beta', layout: { $layout: 'solo' } },
      ],
      layouts: { solo: { kind: 'bsp', root: { type: 'panel', id: 'body', panel: 'records' } } },
      panels: { records: { module: 'sn-data-table' } },
    };
    let base = providerStub(['module:sn-data-table']);
    assert.ok(!validate(config, base, consumerStub('panel:alpha:body')).errors.some((e) => e.code === 'probe.unresolved'));
    assert.ok(!validate(config, base, consumerStub('panel:beta:body')).errors.some((e) => e.code === 'probe.unresolved'));
  });
});
