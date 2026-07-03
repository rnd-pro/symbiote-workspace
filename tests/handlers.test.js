import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { describeWorkspace, listUsedComponents } from '../handlers/describe.js';
import { scaffoldFromScratch, scaffoldWorkspace } from '../handlers/scaffold.js';
import { createPanelNode, createSplitNode, setLayout } from '../handlers/layout.js';
import { listPanelTypes, registerPanelType, updatePanelType } from '../handlers/panels.js';
import { getBehavior, setBehavior, updateBehavior } from '../handlers/behaviors.js';
import { mountWidget, swapWidget, unmountWidget } from '../handlers/widgets.js';

describe('surviving handler surfaces', () => {
  it('creates blank and template configs', () => {
    let blank = scaffoldFromScratch({ name: 'Blank' });
    assert.equal(blank.name, 'Blank');
    assert.equal(blank.version, '1.0.0');
    assert.deepEqual(blank.components, { catalog: [] });

    let templated = scaffoldWorkspace('graph', { name: 'Graph' });
    assert.equal(templated.status, 'ok');
    assert.equal(templated.config.name, 'Graph');
  });

  it('describes workspace structure and used components', () => {
    let config = scaffoldFromScratch({ name: 'Describe' });
    let registered = registerPanelType(config, 'main', { title: 'Main', component: 'sn-main' });
    config = registered.config;
    config.layout = { type: 'panel', panelType: 'main', component: 'layout-shell' };

    let description = describeWorkspace(config);
    let used = listUsedComponents(config);

    assert.equal(description.name, 'Describe');
    assert.equal(description.panelTypes.main.component, 'sn-main');
    assert.deepEqual(used.components, ['layout-shell', 'sn-main']);
  });

  it('manages layout trees', () => {
    let config = scaffoldFromScratch();
    let layout = createSplitNode('horizontal', createPanelNode('left'), createPanelNode('right'), 0.4);
    let result = setLayout(config, layout);

    assert.equal(result.status, 'ok');
    assert.equal(result.config.layout.type, 'split');
    assert.equal(result.config.layout.first.panelType, 'left');
  });

  it('manages module registrations', () => {
    let config = scaffoldFromScratch();
    let registered = registerPanelType(config, 'main', { title: 'Main', component: 'sn-main' });
    config = registered.config;
    let updated = updatePanelType(config, 'main', { title: 'Primary' });
    config = updated.config;
    let listed = listPanelTypes(config);

    assert.equal(registered.status, 'ok');
    assert.equal(config.panelTypes.main.title, 'Primary');
    assert.equal(listed.count, 1);
  });

  it('manages layout behavior', () => {
    let config = scaffoldFromScratch();
    let set = setBehavior(config, 'root', { responsiveMode: 'drawer' });
    config = set.config;
    let updated = updateBehavior(config, 'root', { responsiveBreakpoint: 720 });
    config = updated.config;
    let current = getBehavior(config, 'root');

    assert.equal(set.status, 'ok');
    assert.equal(current.behavior.responsiveMode, 'drawer');
    assert.equal(current.behavior.responsiveBreakpoint, 720);
  });

  it('manages panel component assignment', () => {
    let config = scaffoldFromScratch();
    let mounted = mountWidget(config, 'main', 'sn-data-table');
    config = mounted.config;
    let swapped = swapWidget(config, 'main', 'sn-chart');
    config = swapped.config;
    let unmounted = unmountWidget(config, 'main');

    assert.equal(mounted.status, 'ok');
    assert.equal(swapped.config.panelTypes.main.component, 'sn-chart');
    assert.equal(unmounted.config.panelTypes.main.component, 'sn-empty-state');
  });
});
