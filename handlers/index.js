/**
 * Handlers barrel export.
 * All handler functions available through a single import.
 *
 * @module symbiote-workspace/handlers
 */

export { describeWorkspace, listUsedComponents } from './describe.js';
export { discoverComponents, findComponent, listComponentTags, listCategories } from './discover.js';
export { scaffoldWorkspace, scaffoldFromScratch } from './scaffold.js';

export {
  createPanelNode,
  createSplitNode,
  setLayout,
  addPanel,
  removePanel,
  resizePanel,
  updateLayoutBehavior,
} from './layout.js';

export {
  registerPanelType,
  updatePanelType,
  unregisterPanelType,
  listPanelTypes,
} from './panels.js';

export {
  addSection,
  removeSection,
  updateSection,
  reorderSections,
  listSections,
} from './sections.js';

export {
  addGroup,
  removeGroup,
  updateGroup,
  reorderGroups,
  listGroups,
} from './groups.js';

export {
  addMenuAction,
  removeMenuAction,
  toggleMenuAction,
  listMenuActions,
} from './menu-actions.js';

export {
  setBehavior,
  getBehavior,
  updateBehavior,
} from './behaviors.js';

export {
  mountWidget,
  unmountWidget,
  swapWidget,
} from './widgets.js';

export {
  bridgeEvent,
  unbridgeEvent,
  listBridges,
} from './events.js';

export { workflowKanban } from './workflow-kanban.js';
export { startPreview } from './preview.js';
