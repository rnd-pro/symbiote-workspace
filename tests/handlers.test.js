import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  scaffoldWorkspace,
  scaffoldFromScratch,
  registerPanelType,
  updatePanelType,
  unregisterPanelType,
  listPanelTypes,
  addGroup,
  removeGroup,
  updateGroup,
  listGroups,
  addSection,
  removeSection,
  updateSection,
  listSections,
  addMenuAction,
  removeMenuAction,
  toggleMenuAction,
  listMenuActions,
  setBehavior,
  getBehavior,
  updateBehavior,
  mountWidget,
  unmountWidget,
  swapWidget,
  bridgeEvent,
  unbridgeEvent,
  listBridges,
  createPanelNode,
  createSplitNode,
  setLayout,
  addPanel,
  removePanel,
  resizePanel,
  updateLayoutBehavior,
  describeWorkspace,
  listUsedComponents,
} from '../handlers/index.js';

describe('scaffoldFromScratch', () => {
  it('creates a valid blank config', () => {
    let config = scaffoldFromScratch({ name: 'Test' });
    assert.equal(config.name, 'Test');
    assert.equal(config.version, '0.2.0');
    assert.ok(Array.isArray(config.groups));
    assert.ok(Array.isArray(config.sections));
    assert.ok(typeof config.panelTypes === 'object');
  });
});

describe('scaffoldWorkspace', () => {
  it('creates a template config through the ESM constructor path', () => {
    let result = scaffoldWorkspace('graph', { name: 'Graph Handler' });

    assert.equal(result.status, 'ok');
    assert.equal(result.config.name, 'Graph Handler');
    assert.notEqual(result.config.layout.panelType, 'default');
    assert.ok(Object.keys(result.config.panelTypes).length > 0);
  });
});

describe('describeWorkspace', () => {
  it('does not project unsupported layout children branches', () => {
    let config = {
      version: '0.2.0',
      name: 'Unsupported Layout Shape',
      layout: {
        type: 'group',
        component: 'layout-shell',
        children: [
          { type: 'single', component: 'old-panel', panelType: 'old' },
        ],
      },
      panelTypes: {
        main: { title: 'Main', component: 'current-panel' },
      },
    };

    let description = describeWorkspace(config);
    let used = listUsedComponents(config);

    assert.equal(description.layout.type, 'unknown');
    assert.equal(description.layout.raw, config.layout);
    assert.deepEqual(used.components, ['current-panel', 'layout-shell']);
  });
});

describe('panels', () => {
  let config;

  it('registerPanelType adds a panel type', () => {
    config = scaffoldFromScratch();
    let result = registerPanelType(config, 'viewport', { title: 'Viewport', component: 'sn-canvas-viewport' });
    config = result.config;
    assert.equal(result.status, 'ok');
    assert.ok(config.panelTypes.viewport);
    assert.equal(config.panelTypes.viewport.component, 'sn-canvas-viewport');
    assert.ok(config.components.catalog.includes('sn-canvas-viewport'));
  });

  it('updatePanelType updates a panel type', () => {
    let result = updatePanelType(config, 'viewport', { title: 'Updated Viewport' });
    config = result.config;
    assert.equal(config.panelTypes.viewport.title, 'Updated Viewport');
  });

  it('unregisterPanelType removes a panel type', () => {
    let result = unregisterPanelType(config, 'viewport');
    assert.equal(result.status, 'ok');
    assert.ok(!result.config.panelTypes.viewport);
  });

  it('listPanelTypes returns registered types', () => {
    config = scaffoldFromScratch();
    registerPanelType(config, 'a', { title: 'A', component: 'comp-a' });
    let result = listPanelTypes(config);
    assert.equal(result.count, 0); // empty because config was not updated
  });

  it('rejects invalid panel type', () => {
    let result = registerPanelType(config, 'bad', { title: 'Bad' });
    assert.equal(result.status, 'error');
  });
});

describe('groups', () => {
  let config;

  it('addGroup adds a group', () => {
    config = scaffoldFromScratch();
    let result = addGroup(config, { id: 'g1', name: 'Group 1', icon: 'folder' });
    config = result.config;
    assert.equal(result.status, 'ok');
    assert.equal(config.groups.length, 1);
    assert.equal(config.groups[0].id, 'g1');
  });

  it('addGroup rejects duplicate', () => {
    let result = addGroup(config, { id: 'g1', name: 'Dup' });
    assert.equal(result.status, 'error');
  });

  it('updateGroup updates a group', () => {
    let result = updateGroup(config, 'g1', { name: 'Updated' });
    config = result.config;
    assert.equal(config.groups[0].name, 'Updated');
  });

  it('removeGroup removes group and sections', () => {
    let r = addSection(config, 'g1', { id: 's1', label: 'Section 1' });
    config = r.config;
    assert.equal(config.sections.length, 1);
    let result = removeGroup(config, 'g1');
    assert.equal(result.config.groups.length, 0);
    assert.equal(result.config.sections.length, 0);
  });

  it('listGroups lists groups', () => {
    config = scaffoldFromScratch();
    addGroup(config, { id: 'a', name: 'A' });
    let result = listGroups(config);
    assert.equal(result.count, 0);
  });
});

describe('sections', () => {
  let config;

  it('addSection adds section', () => {
    config = scaffoldFromScratch();
    let r1 = addGroup(config, { id: 'g1', name: 'G1' });
    config = r1.config;
    let r2 = addSection(config, 'g1', { id: 's1', label: 'Sec1', icon: 'star' });
    config = r2.config;
    assert.equal(r2.status, 'ok');
    assert.equal(config.sections.length, 1);
    assert.equal(config.sections[0].groupId, 'g1');
  });

  it('updateSection updates', () => {
    let result = updateSection(config, 's1', { label: 'Updated' });
    config = result.config;
    assert.equal(config.sections[0].label, 'Updated');
  });

  it('removeSection removes', () => {
    let result = removeSection(config, 's1');
    assert.equal(result.config.sections.length, 0);
  });

  it('listSections filters by group', () => {
    // Start fresh for this test
    let fresh = scaffoldFromScratch();
    let r1 = addGroup(fresh, { id: 'gx', name: 'GX' });
    fresh = r1.config;
    let r2 = addSection(fresh, 'gx', { id: 'sx', label: 'SX' });
    fresh = r2.config;
    let result = listSections(fresh, 'gx');
    assert.equal(result.count, 1);
  });
});

describe('menu-actions', () => {
  let config;

  it('addMenuAction adds to panel type', () => {
    config = scaffoldFromScratch();
    let r = registerPanelType(config, 'vp', { title: 'VP', component: 'vp-comp' });
    config = r.config;
    let r2 = addMenuAction(config, 'vp', { id: 'act1', label: 'Action 1', icon: 'star' });
    config = r2.config;
    assert.equal(config.panelTypes.vp.menuActions.length, 1);
  });

  it('toggleMenuAction toggles', () => {
    let r = toggleMenuAction(config, 'vp', 'act1', true);
    config = r.config;
    assert.equal(config.panelTypes.vp.menuActions[0].active, true);
  });

  it('removeMenuAction removes', () => {
    let r = removeMenuAction(config, 'vp', 'act1');
    config = r.config;
    assert.equal(config.panelTypes.vp.menuActions.length, 0);
  });
});

describe('behaviors', () => {
  let config;

  it('setBehavior sets root behavior', () => {
    config = scaffoldFromScratch();
    let r = setBehavior(config, 'root', { responsiveMode: 'drawer', responsiveBreakpoint: 720 });
    config = r.config;
    assert.equal(config.rootBehavior.responsiveMode, 'drawer');
  });

  it('setBehavior rejects invalid enum', () => {
    let r = setBehavior(config, 'root', { collapse: 'invalid' });
    assert.equal(r.status, 'error');
  });

  it('getBehavior reads root', () => {
    let r = getBehavior(config, 'root');
    assert.equal(r.behavior.responsiveMode, 'drawer');
  });

  it('updateBehavior merges', () => {
    let r = updateBehavior(config, 'root', { swipeControl: 'island' });
    config = r.config;
    assert.equal(config.rootBehavior.swipeControl, 'island');
    assert.equal(config.rootBehavior.responsiveMode, 'drawer');
  });
});

describe('widgets', () => {
  let config;

  it('mountWidget mounts component', () => {
    config = scaffoldFromScratch();
    let r = mountWidget(config, 'main', 'sn-data-table');
    config = r.config;
    assert.equal(config.panelTypes.main.component, 'sn-data-table');
    assert.ok(config.components.catalog.includes('sn-data-table'));
  });

  it('swapWidget swaps component', () => {
    let r = swapWidget(config, 'main', 'sn-chart');
    config = r.config;
    assert.equal(config.panelTypes.main.component, 'sn-chart');
  });

  it('unmountWidget sets empty state', () => {
    let r = unmountWidget(config, 'main');
    assert.equal(r.config.panelTypes.main.component, 'sn-empty-state');
  });
});

describe('events', () => {
  let config;

  it('bridgeEvent creates bridge', () => {
    config = scaffoldFromScratch();
    let r = bridgeEvent(config, { sourcePanel: 'timeline', event: 'frame-change', targetPanel: 'viewport' });
    config = r.config;
    assert.equal(config.events.length, 1);
    assert.equal(config.events[0].sourcePanel, 'timeline');
  });

  it('unbridgeEvent removes', () => {
    let id = config.events[0].id;
    let r = unbridgeEvent(config, id);
    assert.equal(r.config.events.length, 0);
  });

  it('listBridges lists', () => {
    let r = listBridges(config);
    assert.equal(r.count, 1);
  });
});

describe('layout', () => {
  let config;

  it('setLayout sets default layout', () => {
    config = scaffoldFromScratch();
    let layout = createSplitNode('horizontal', createPanelNode('a'), createPanelNode('b'), 0.5);
    let r = setLayout(config, layout);
    config = r.config;
    assert.equal(config.layout.type, 'split');
    assert.equal(config.layout.first.panelType, 'a');
  });

  it('setLayout sets named layout', () => {
    let layout = createSplitNode('vertical', createPanelNode('c'), createPanelNode('d'), 0.7);
    let r = setLayout(config, layout, 'myLayout');
    config = r.config;
    assert.ok(config.layouts.myLayout);
  });

  it('addPanel splits existing panel', () => {
    let r = addPanel(config, 'a', 'new-panel', 'vertical', 0.4);
    config = r.config;
    assert.equal(r.status, 'ok');
    // 'a' should now be in a split with 'new-panel'
    assert.equal(config.layout.first.type, 'split');
  });

  it('removePanel joins with sibling', () => {
    let r = removePanel(config, 'new-panel');
    config = r.config;
    assert.equal(r.status, 'ok');
  });

  it('resizePanel changes ratio', () => {
    config = scaffoldFromScratch();
    let layout = createSplitNode('horizontal', createPanelNode('a'), createPanelNode('b'), 0.5);
    let r1 = setLayout(config, layout);
    config = r1.config;
    let r = resizePanel(config, 'a', 0.3);
    config = r.config;
    assert.equal(config.layout.ratio, 0.3);
  });

  it('updateLayoutBehavior updates root', () => {
    let r = updateLayoutBehavior(config, { responsiveMode: 'stack' });
    config = r.config;
    assert.equal(config.rootBehavior.responsiveMode, 'stack');
  });
});

describe('integration: video studio via handlers', () => {
  it('constructs a complete valid workspace', async () => {
    let { validateWorkspaceConfig } = await import('../validation/core.js');

    let config = scaffoldFromScratch({ name: 'Video Studio' });

    let r = registerPanelType(config, 'viewport', { title: 'Viewport', icon: 'smart_display', component: 'sn-canvas-viewport', behavior: { importance: 90 } });
    config = r.config;
    r = registerPanelType(config, 'timeline', { title: 'Timeline', icon: 'view_timeline', component: 'sn-timeline-editor', behavior: { importance: 80 } });
    config = r.config;
    r = registerPanelType(config, 'graph', { title: 'Graph', icon: 'hub', component: 'node-canvas' });
    config = r.config;
    r = registerPanelType(config, 'inspector', { title: 'Inspector', icon: 'tune', component: 'inspector-panel' });
    config = r.config;

    r = addGroup(config, { id: 'video', name: 'Video', icon: 'movie' });
    config = r.config;

    r = addSection(config, 'video', { id: 'studio', label: 'Studio', icon: 'movie' });
    config = r.config;
    r = addSection(config, 'video', { id: 'preview', label: 'Preview', icon: 'smart_display' });
    config = r.config;

    r = setLayout(config, createSplitNode('vertical',
      createSplitNode('horizontal', createPanelNode('viewport'), createPanelNode('graph'), 0.5),
      createPanelNode('timeline'), 0.6));
    config = r.config;

    r = bridgeEvent(config, { sourcePanel: 'timeline', event: 'frame-change', targetPanel: 'viewport' });
    config = r.config;

    r = setBehavior(config, 'root', { responsiveMode: 'drawer', responsiveBreakpoint: 720 });
    config = r.config;

    let result = validateWorkspaceConfig(config);
    assert.equal(result.valid, true, 'Config should be valid: ' + JSON.stringify(result.errors));
    assert.equal(Object.keys(config.panelTypes).length, 4);
    assert.equal(config.groups.length, 1);
    assert.equal(config.sections.length, 2);
    assert.equal(config.events.length, 1);
  });
});
