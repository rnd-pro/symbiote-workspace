import {
  STRUCTURAL_ID_PATTERN,
  CAPABILITY_ID_PATTERN,
  LAYOUT_KINDS,
  COLLAPSE_POLICIES,
  OVERFLOW_POLICIES,
  RESPONSIVE_MODES,
  MOBILE_DOCKS,
  SWIPE_CONTROLS,
  SPLIT_RATIO_BOUNDS,
} from '../constants.js';
import { parseWorkspaceAddress } from '../was.js';

/**
 * STRUCTURE section — the structural plane of the target schema: `views[]`,
 * `layouts{}` (bsp + stack), `panels{}`, `nav{}`, the config/session boundary,
 * and the WAS derivation rules from structure.
 *
 * Referential division of labour (spec §6, plan S1.0 line 280):
 * - Intra-STRUCTURE references resolve locally in `validate` because all data
 *   lives in this section's own config: `$layout`→`layouts{}`, leaf `panel`→
 *   `panels{}`, dynamic stack `of`→`panels{}`, `view.nav.group`→`nav.groups[]`,
 *   static stack `active`→a child id, and node-id uniqueness within a layout.
 * - STRUCTURE is the SOURCE of WAS place addresses (`refProviders`): `view:<id>`,
 *   `panel:<viewId>:<leafId>`, `stack:<viewId>:<stackId>`, reserved `stack:root`.
 *   Wires/hooks/narration (other sections) consume them in the one referential
 *   pass.
 * - Cross-SECTION references STRUCTURE makes are emitted as `refConsumers` so
 *   they resolve against sibling providers in the assembled schema. The
 *   provider-id contract STRUCTURE relies on (honoured by the sibling W1
 *   slices, spliced by L1 at integration):
 *     - `module:<moduleId>`      provided by MODULES  (panels{}.module)
 *     - `state:<rootFieldName>`  provided by STATE    (dynamic stack bindings)
 *     - `collection:<id>`        provided by DATA     (collection-driven items)
 *   Menu action-ref resolution against the placed module is owned by WIRING
 *   (plan S1.3), so STRUCTURE validates menu-entry SHAPE only.
 */

const VIEW_LIFECYCLES = Object.freeze(['durable', 'ephemeral-template']);
const SPLIT_DIRECTIONS = Object.freeze(['horizontal', 'vertical']);
const BSP_NODE_TYPES = Object.freeze(['panel', 'split']);
const STACK_CHILD_TYPES = Object.freeze(['panel', 'bsp', 'stack']);

const DELETED_TOP_LEVEL_KEYS = Object.freeze(['groups', 'sections', 'layout', 'panelTypes']);

const BEHAVIOR_KEYS = Object.freeze(new Set([
  'importance', 'minInlineSize', 'minBlockSize',
  'collapse', 'overflow', 'responsiveMode', 'mobileDock', 'swipeControl',
]));
const NUMERIC_BEHAVIOR_KEYS = Object.freeze(new Set(['importance', 'minInlineSize', 'minBlockSize']));
const ENUM_BEHAVIOR_KEYS = Object.freeze({
  collapse: COLLAPSE_POLICIES,
  overflow: OVERFLOW_POLICIES,
  responsiveMode: RESPONSIVE_MODES,
  mobileDock: MOBILE_DOCKS,
  swipeControl: SWIPE_CONTROLS,
});

const VIEW_KEYS = Object.freeze(new Set(['id', 'title', 'icon', 'layout', 'route', 'nav', 'lifecycle', 'behavior', 'requires']));
const NAV_GROUP_KEYS = Object.freeze(new Set(['id', 'title', 'icon', 'order']));
const VIEW_NAV_KEYS = Object.freeze(new Set(['group', 'order']));
const PANEL_KEYS = Object.freeze(new Set(['module', 'title', 'icon', 'behavior', 'menu', 'settings', 'requires']));
const MENU_ENTRY_KEYS = Object.freeze(new Set(['ref', 'order', 'icon']));
const PANEL_LEAF_KEYS = Object.freeze(new Set(['type', 'id', 'panel', 'settings', 'behavior', 'title', 'icon']));
const SPLIT_KEYS = Object.freeze(new Set(['type', 'id', 'direction', 'ratio', 'first', 'second', 'behavior']));
const BSP_LAYOUT_KEYS = Object.freeze(new Set(['kind', 'root']));
const BSP_CHILD_KEYS = Object.freeze(new Set(['type', 'id', 'root', 'title', 'icon']));
const STACK_KEYS = Object.freeze(new Set(['kind', 'type', 'id', 'title', 'icon', 'active', 'children', 'of', 'itemsBinding', 'activeBinding']));

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStructuralId(value) {
  return typeof value === 'string' && STRUCTURAL_ID_PATTERN.test(value);
}

function isCapabilityId(value) {
  return typeof value === 'string' && CAPABILITY_ID_PATTERN.test(value);
}

/** Localizable string: shorthand string | `{ $t }` catalog ref | inline `{ default }` (L1 ruling 11/C1). */
function isLocalizable(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!isObject(value)) return false;
  if (typeof value.$t === 'string') return value.$t.trim().length > 0;
  return typeof value.default === 'string';
}

function isWasAddress(value, className) {
  if (typeof value !== 'string') return false;
  try {
    return parseWorkspaceAddress(value).className === className;
  } catch {
    return false;
  }
}

function stateRootField(address) {
  if (typeof address !== 'string' || !address.startsWith('state:')) return null;
  let root = address.slice('state:'.length).split('.')[0];
  return isStructuralId(root) ? root : null;
}

function checkKnownKeys(obj, allowed, ctx, path, label) {
  for (let key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      ctx.error(`${path}.${key}`, 'structure.unknown_key', `${label} has unknown key "${key}".`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Shape validation
 * ------------------------------------------------------------------ */

function validate(config, ctx) {
  if (!isObject(config)) return;

  for (let key of DELETED_TOP_LEVEL_KEYS) {
    if (Object.hasOwn(config, key)) {
      ctx.error(key, 'structure.deleted_key', `Top-level "${key}" is deleted; the workspace is a root stack of views (spec §2.2).`);
    }
  }

  validateLayoutsMap(config, ctx);
  validatePanelsMap(config, ctx);
  let navGroups = validateNav(config, ctx);
  validateViews(config, ctx, navGroups);

  for (let [id, group] of navGroups) {
    if (!group.referenced) {
      ctx.warning('nav.groups', 'structure.nav.dead_group', `Nav group "${id}" is referenced by no view.`, { severity: 'warning' });
    }
  }
}

function validateLayoutsMap(config, ctx) {
  let layouts = config.layouts;
  if (layouts === undefined) return;
  if (!isObject(layouts)) {
    ctx.error('layouts', 'structure.layouts.type', 'layouts must be a plain object keyed by layout id.');
    return;
  }
  for (let id of Object.keys(layouts)) {
    if (!isStructuralId(id)) {
      ctx.error(`layouts.${id}`, 'structure.layouts.id', `Layout id "${id}" must match the structural-id grammar.`);
    }
    validateLayoutValue(layouts[id], ctx, `layouts.${id}`, config);
  }
}

function validateLayoutValue(value, ctx, path, config) {
  if (!isObject(value)) {
    ctx.error(path, 'structure.layout.type', 'A layout value must be a typed object.');
    return;
  }
  let seenIds = new Set();
  if (!hasText(value.kind) || !LAYOUT_KINDS.includes(value.kind)) {
    ctx.error(`${path}.kind`, 'structure.layout.unknown_kind', `Layout kind "${value.kind}" is not one of the known kinds: ${LAYOUT_KINDS.join(', ')}.`);
    return;
  }
  if (value.kind === 'bsp') {
    checkKnownKeys(value, BSP_LAYOUT_KEYS, ctx, path, 'bsp layout');
    if (!isObject(value.root)) {
      ctx.error(`${path}.root`, 'structure.bsp.root_required', 'A bsp layout requires a root node.');
      return;
    }
    validateBspNode(value.root, ctx, `${path}.root`, seenIds, config);
    return;
  }
  // stack
  validateStackNode(value, ctx, path, seenIds, config);
}

function validateNodeId(node, ctx, path, seenIds) {
  if (!isStructuralId(node.id)) {
    ctx.error(`${path}.id`, 'structure.node.id', `Layout node id "${node.id}" must match the structural-id grammar.`);
    return;
  }
  if (seenIds.has(node.id)) {
    ctx.error(`${path}.id`, 'structure.node.duplicate_id', `Layout node id "${node.id}" is declared more than once within its layout value.`);
    return;
  }
  seenIds.add(node.id);
}

function validateBspNode(node, ctx, path, seenIds, config) {
  if (!isObject(node)) {
    ctx.error(path, 'structure.node.type', 'A bsp node must be an object.');
    return;
  }
  if (!BSP_NODE_TYPES.includes(node.type)) {
    ctx.error(`${path}.type`, 'structure.node.type', `bsp node type "${node.type}" must be one of: ${BSP_NODE_TYPES.join(', ')}.`);
    return;
  }
  validateNodeId(node, ctx, path, seenIds);

  if (node.type === 'panel') {
    checkKnownKeys(node, PANEL_LEAF_KEYS, ctx, path, 'panel leaf');
    validatePanelLeaf(node, ctx, path, config);
    return;
  }
  // split
  checkKnownKeys(node, SPLIT_KEYS, ctx, path, 'split node');
  if (!SPLIT_DIRECTIONS.includes(node.direction)) {
    ctx.error(`${path}.direction`, 'structure.split.direction', `split direction "${node.direction}" must be one of: ${SPLIT_DIRECTIONS.join(', ')}.`);
  }
  if (typeof node.ratio !== 'number' || Number.isNaN(node.ratio)) {
    ctx.error(`${path}.ratio`, 'structure.split.ratio', 'split ratio must be a number.');
  } else if (node.ratio < SPLIT_RATIO_BOUNDS.min || node.ratio > SPLIT_RATIO_BOUNDS.max) {
    ctx.error(`${path}.ratio`, 'structure.split.ratio_bounds', `split ratio ${node.ratio} must be within [${SPLIT_RATIO_BOUNDS.min}, ${SPLIT_RATIO_BOUNDS.max}].`);
  }
  if (node.behavior !== undefined) validateBehavior(node.behavior, ctx, `${path}.behavior`, false);
  if (!isObject(node.first)) {
    ctx.error(`${path}.first`, 'structure.split.first_required', 'A split node requires a first child.');
  } else {
    validateBspNode(node.first, ctx, `${path}.first`, seenIds, config);
  }
  if (!isObject(node.second)) {
    ctx.error(`${path}.second`, 'structure.split.second_required', 'A split node requires a second child.');
  } else {
    validateBspNode(node.second, ctx, `${path}.second`, seenIds, config);
  }
}

function validatePanelLeaf(node, ctx, path, config) {
  if (!hasText(node.panel)) {
    ctx.error(`${path}.panel`, 'structure.leaf.panel_required', 'A panel leaf requires a panel placement key.');
  } else if (!isObject(config.panels) || !Object.hasOwn(config.panels, node.panel)) {
    ctx.error(`${path}.panel`, 'structure.leaf.panel_unknown', `Panel leaf references placement "${node.panel}" not declared in panels{}.`);
  }
  if (node.settings !== undefined && !isObject(node.settings)) {
    ctx.error(`${path}.settings`, 'structure.leaf.settings_type', 'panel leaf settings must be an object of declared-setting values.');
  }
  if (node.title !== undefined && !isLocalizable(node.title)) {
    ctx.error(`${path}.title`, 'structure.leaf.title', 'panel leaf title override must be a localizable string.');
  }
  if (node.behavior !== undefined) validateBehavior(node.behavior, ctx, `${path}.behavior`, false);
}

function validateStackNode(node, ctx, path, seenIds, config) {
  if (!isObject(node)) {
    ctx.error(path, 'structure.stack.type', 'A stack node must be an object.');
    return;
  }
  checkKnownKeys(node, STACK_KEYS, ctx, path, 'stack node');
  validateNodeId(node, ctx, path, seenIds);
  if (node.title !== undefined && !isLocalizable(node.title)) {
    ctx.error(`${path}.title`, 'structure.stack.title', 'stack title override must be a localizable string.');
  }

  let hasChildren = Object.hasOwn(node, 'children');
  let hasDynamic = Object.hasOwn(node, 'of') || Object.hasOwn(node, 'itemsBinding');

  if (hasChildren && hasDynamic) {
    ctx.error(path, 'structure.stack.mixed_form', 'A stack declares EXACTLY ONE of children (static) or of+itemsBinding (dynamic), not both.');
    return;
  }
  if (!hasChildren && !hasDynamic) {
    ctx.error(path, 'structure.stack.missing_form', 'A stack requires either children (static) or of+itemsBinding (dynamic).');
    return;
  }

  if (hasChildren) {
    validateStaticStack(node, ctx, path, seenIds, config);
  } else {
    validateDynamicStack(node, ctx, path, config);
  }
}

function validateStaticStack(node, ctx, path, seenIds, config) {
  if (!Array.isArray(node.children) || node.children.length === 0) {
    ctx.error(`${path}.children`, 'structure.stack.children_required', 'A static stack requires a non-empty children array.');
    return;
  }
  let childIds = new Set();
  for (let i = 0; i < node.children.length; i++) {
    let childId = validateStackChild(node.children[i], ctx, `${path}.children[${i}]`, seenIds, config);
    if (childId) childIds.add(childId);
  }
  if (node.active !== undefined && !childIds.has(node.active)) {
    ctx.error(`${path}.active`, 'structure.stack.active_unknown', `stack active "${node.active}" does not name one of its children.`);
  }
}

function validateStackChild(child, ctx, path, seenIds, config) {
  if (!isObject(child)) {
    ctx.error(path, 'structure.stack.child_type', 'A stack child must be an object.');
    return null;
  }
  if (!STACK_CHILD_TYPES.includes(child.type)) {
    ctx.error(`${path}.type`, 'structure.stack.child_type', `stack child type "${child.type}" must be one of: ${STACK_CHILD_TYPES.join(', ')}.`);
    return null;
  }
  validateNodeId(child, ctx, path, seenIds);

  if (child.type === 'panel') {
    checkKnownKeys(child, PANEL_LEAF_KEYS, ctx, path, 'stack panel child');
    validatePanelLeaf(child, ctx, path, config);
  } else if (child.type === 'bsp') {
    checkKnownKeys(child, BSP_CHILD_KEYS, ctx, path, 'stack bsp child');
    if (child.title !== undefined && !isLocalizable(child.title)) {
      ctx.error(`${path}.title`, 'structure.stack.title', 'composite child title override must be a localizable string.');
    }
    if (!isObject(child.root)) {
      ctx.error(`${path}.root`, 'structure.bsp.root_required', 'A bsp stack child requires a root node.');
    } else {
      validateBspNode(child.root, ctx, `${path}.root`, seenIds, config);
    }
  } else {
    validateStackNode(child, ctx, path, seenIds, config);
  }
  return typeof child.id === 'string' ? child.id : null;
}

function validateDynamicStack(node, ctx, path, config) {
  if (Object.hasOwn(node, 'children') || Object.hasOwn(node, 'active')) {
    ctx.error(path, 'structure.stack.mixed_form', 'A dynamic stack cannot declare children/active; use activeBinding for the active item.');
  }
  if (!hasText(node.of)) {
    ctx.error(`${path}.of`, 'structure.stack.of_required', 'A dynamic stack requires an "of" panel placement key.');
  } else if (!isObject(config.panels) || !Object.hasOwn(config.panels, node.of)) {
    ctx.error(`${path}.of`, 'structure.stack.of_unknown', `Dynamic stack of "${node.of}" is not declared in panels{}.`);
  }
  if (!Object.hasOwn(node, 'itemsBinding')) {
    ctx.error(`${path}.itemsBinding`, 'structure.stack.items_binding_required', 'A dynamic stack requires an itemsBinding.');
  } else {
    validateItemsBinding(node.itemsBinding, ctx, `${path}.itemsBinding`);
  }
  if (node.activeBinding !== undefined && !isWasAddress(node.activeBinding, 'state')) {
    ctx.error(`${path}.activeBinding`, 'structure.stack.active_binding_invalid', 'stack activeBinding must be a state: address holding the active item key.');
  }
}

/** itemsBinding: a `state:` address to an array field, OR `{ collection, query? }` (L1 ruling 10 as amended by R5). */
function validateItemsBinding(value, ctx, path) {
  if (typeof value === 'string') {
    if (!isWasAddress(value, 'state')) {
      ctx.error(path, 'structure.stack.items_binding_invalid', 'string itemsBinding must be a state: address of a declared array field.');
    }
    return;
  }
  if (isObject(value)) {
    if (!hasText(value.collection)) {
      ctx.error(path, 'structure.stack.items_binding_invalid', 'object itemsBinding must be { collection, query? } naming a declared collection.');
    }
    checkKnownKeys(value, new Set(['collection', 'query']), ctx, path, 'itemsBinding');
    return;
  }
  ctx.error(path, 'structure.stack.items_binding_invalid', 'itemsBinding must be a state: address or a { collection, query? } object.');
}

function validatePanelsMap(config, ctx) {
  let panels = config.panels;
  if (panels === undefined) return;
  if (!isObject(panels)) {
    ctx.error('panels', 'structure.panels.type', 'panels must be a plain object keyed by placement id.');
    return;
  }
  for (let key of Object.keys(panels)) {
    let path = `panels.${key}`;
    if (!isStructuralId(key)) {
      ctx.error(path, 'structure.panels.id', `Panel placement key "${key}" must match the structural-id grammar.`);
    }
    let placement = panels[key];
    if (!isObject(placement)) {
      ctx.error(path, 'structure.panels.type', 'A panel placement must be an object.');
      continue;
    }
    checkKnownKeys(placement, PANEL_KEYS, ctx, path, 'panel placement');
    if (!hasText(placement.module)) {
      ctx.error(`${path}.module`, 'structure.panels.module_required', 'A panel placement requires a module id.');
    }
    if (placement.title !== undefined && !isLocalizable(placement.title)) {
      ctx.error(`${path}.title`, 'structure.panels.title', 'panel title must be a localizable string.');
    }
    if (placement.behavior !== undefined) validateBehavior(placement.behavior, ctx, `${path}.behavior`, false);
    if (placement.settings !== undefined && !isObject(placement.settings)) {
      ctx.error(`${path}.settings`, 'structure.panels.settings_type', 'panel settings must be an object of declared-setting values.');
    }
    if (placement.requires !== undefined && !isCapabilityId(placement.requires)) {
      ctx.error(`${path}.requires`, 'structure.panels.requires', 'panel requires must be a portable capability id.');
    }
    if (placement.menu !== undefined) validateMenu(placement.menu, ctx, `${path}.menu`);
  }
}

function validateMenu(menu, ctx, path) {
  if (!Array.isArray(menu)) {
    ctx.error(path, 'structure.menu.type', 'panel menu must be an array of action references.');
    return;
  }
  for (let i = 0; i < menu.length; i++) {
    let entry = menu[i];
    let entryPath = `${path}[${i}]`;
    if (!isObject(entry)) {
      ctx.error(entryPath, 'structure.menu.entry', 'A menu entry must be an object referencing an action.');
      continue;
    }
    checkKnownKeys(entry, MENU_ENTRY_KEYS, ctx, entryPath, 'menu entry');
    if (!isWasAddress(entry.ref, 'action')) {
      ctx.error(`${entryPath}.ref`, 'structure.menu.ref', 'A menu entry ref must be an action: reference (panels never redeclare action shapes).');
    }
    if (entry.order !== undefined && typeof entry.order !== 'number') {
      ctx.error(`${entryPath}.order`, 'structure.menu.order', 'menu entry order must be a number.');
    }
  }
}

function validateNav(config, ctx) {
  let groups = new Map();
  let nav = config.nav;
  if (nav === undefined) return groups;
  if (!isObject(nav)) {
    ctx.error('nav', 'structure.nav.type', 'nav must be a plain object.');
    return groups;
  }
  if (nav.groups === undefined) return groups;
  if (!Array.isArray(nav.groups)) {
    ctx.error('nav.groups', 'structure.nav.groups_type', 'nav.groups must be an array.');
    return groups;
  }
  for (let i = 0; i < nav.groups.length; i++) {
    let group = nav.groups[i];
    let path = `nav.groups[${i}]`;
    if (!isObject(group)) {
      ctx.error(path, 'structure.nav.group_type', 'A nav group must be an object.');
      continue;
    }
    checkKnownKeys(group, NAV_GROUP_KEYS, ctx, path, 'nav group');
    if (!isStructuralId(group.id)) {
      ctx.error(`${path}.id`, 'structure.nav.group_id', `nav group id "${group.id}" must match the structural-id grammar.`);
    } else if (groups.has(group.id)) {
      ctx.error(`${path}.id`, 'structure.nav.duplicate_group', `nav group id "${group.id}" is declared more than once.`);
    } else {
      groups.set(group.id, { referenced: false });
    }
    if (!isLocalizable(group.title)) {
      ctx.error(`${path}.title`, 'structure.nav.group_title', 'nav group title is required and must be a localizable string.');
    }
    if (group.order !== undefined && typeof group.order !== 'number') {
      ctx.error(`${path}.order`, 'structure.nav.group_order', 'nav group order must be a number.');
    }
  }
  return groups;
}

function validateViews(config, ctx, navGroups) {
  let views = config.views;
  if (views === undefined) return;
  if (!Array.isArray(views)) {
    ctx.error('views', 'structure.views.type', 'views must be an array.');
    return;
  }
  let seenViewIds = new Set();
  for (let i = 0; i < views.length; i++) {
    let view = views[i];
    let path = `views[${i}]`;
    if (!isObject(view)) {
      ctx.error(path, 'structure.view.type', 'A view must be an object.');
      continue;
    }
    checkKnownKeys(view, VIEW_KEYS, ctx, path, 'view');

    if (!isStructuralId(view.id)) {
      ctx.error(`${path}.id`, 'structure.view.id', `view id "${view.id}" must match the structural-id grammar.`);
    } else if (seenViewIds.has(view.id)) {
      ctx.error(`${path}.id`, 'structure.view.duplicate_id', `view id "${view.id}" is declared more than once.`);
    } else {
      seenViewIds.add(view.id);
    }

    if (!isLocalizable(view.title)) {
      ctx.error(`${path}.title`, 'structure.view.title', 'view title is required and must be a localizable string.');
    }

    validateViewLayout(view.layout, ctx, `${path}.layout`, config);

    if (view.route !== undefined && !isObject(view.route)) {
      ctx.error(`${path}.route`, 'structure.view.route_type', 'view route must be an object (route internals are owned by ROUTES).');
    }

    let lifecycle = view.lifecycle;
    if (lifecycle !== undefined && !VIEW_LIFECYCLES.includes(lifecycle)) {
      ctx.error(`${path}.lifecycle`, 'structure.view.lifecycle', `view lifecycle "${lifecycle}" must be one of: ${VIEW_LIFECYCLES.join(', ')}.`);
    }

    validateViewNav(view, ctx, path, navGroups);

    if (lifecycle === 'ephemeral-template' && isObject(view.nav)) {
      ctx.error(`${path}.nav`, 'structure.view.ephemeral_nav', 'An ephemeral-template view cannot carry nav placement; its instances live in the session tier.');
    }

    if (view.behavior !== undefined) validateBehavior(view.behavior, ctx, `${path}.behavior`, true);

    if (view.requires !== undefined && !isCapabilityId(view.requires)) {
      ctx.error(`${path}.requires`, 'structure.view.requires', 'view requires must be a portable capability id.');
    }
  }
}

function validateViewLayout(layout, ctx, path, config) {
  if (layout === undefined) {
    ctx.error(path, 'structure.view.layout_required', 'view layout is REQUIRED (L1 ruling 3): exactly one of an inline layout value or { $layout }.');
    return;
  }
  if (!isObject(layout)) {
    ctx.error(path, 'structure.view.layout_invalid', 'view layout must be an inline layout value or a { $layout } reference.');
    return;
  }
  let hasRef = Object.hasOwn(layout, '$layout');
  let hasInline = hasText(layout.kind);
  if (hasRef && hasInline) {
    ctx.error(path, 'structure.view.layout_both', 'view layout declares both an inline value and a $layout reference; use exactly one.');
    return;
  }
  if (hasRef) {
    checkKnownKeys(layout, new Set(['$layout']), ctx, path, 'view layout reference');
    if (!hasText(layout.$layout)) {
      ctx.error(`${path}.$layout`, 'structure.view.layout_ref', '$layout must name a layout in layouts{}.');
    } else if (!isObject(config.layouts) || !isObject(config.layouts[layout.$layout])) {
      ctx.error(`${path}.$layout`, 'structure.view.layout_unresolved', `$layout "${layout.$layout}" does not resolve in layouts{}.`);
    }
    return;
  }
  if (hasInline) {
    validateLayoutValue(layout, ctx, path, config);
    return;
  }
  ctx.error(path, 'structure.view.layout_invalid', 'view layout must be an inline layout value or a { $layout } reference.');
}

function validateViewNav(view, ctx, path, navGroups) {
  if (view.nav === undefined) return;
  if (!isObject(view.nav)) {
    ctx.error(`${path}.nav`, 'structure.view.nav_type', 'view nav must be an object { group?, order? }.');
    return;
  }
  checkKnownKeys(view.nav, VIEW_NAV_KEYS, ctx, `${path}.nav`, 'view nav');
  if (view.nav.group !== undefined) {
    if (!isStructuralId(view.nav.group)) {
      ctx.error(`${path}.nav.group`, 'structure.view.nav_group', 'view nav group must be a structural id naming a nav group.');
    } else if (!navGroups.has(view.nav.group)) {
      ctx.error(`${path}.nav.group`, 'structure.view.nav_group_unknown', `view nav group "${view.nav.group}" does not resolve in nav.groups[].`);
    } else {
      navGroups.get(view.nav.group).referenced = true;
    }
  }
  if (view.nav.order !== undefined && typeof view.nav.order !== 'number') {
    ctx.error(`${path}.nav.order`, 'structure.view.nav_order', 'view nav order must be a number.');
  }
}

function validateBehavior(behavior, ctx, path, isRoot) {
  if (!isObject(behavior)) {
    ctx.error(path, 'structure.behavior.type', 'behavior must be a LayoutBehavior object.');
    return;
  }
  for (let key of Object.keys(behavior)) {
    if (isRoot && key === 'responsiveBreakpoint') {
      if (typeof behavior[key] !== 'number') {
        ctx.error(`${path}.${key}`, 'structure.behavior.value', 'responsiveBreakpoint must be a number.');
      }
      continue;
    }
    if (!BEHAVIOR_KEYS.has(key)) {
      ctx.error(`${path}.${key}`, 'structure.unknown_key', `behavior has unknown key "${key}".`);
      continue;
    }
    if (NUMERIC_BEHAVIOR_KEYS.has(key)) {
      if (typeof behavior[key] !== 'number') {
        ctx.error(`${path}.${key}`, 'structure.behavior.value', `behavior "${key}" must be a number.`);
      }
    } else {
      let allowed = ENUM_BEHAVIOR_KEYS[key];
      if (!allowed.includes(behavior[key])) {
        ctx.error(`${path}.${key}`, 'structure.behavior.value', `behavior "${key}" must be one of: ${allowed.join(', ')}.`);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * WAS derivation (spec §6) — providers and cross-section consumers
 * ------------------------------------------------------------------ */

function resolveViewLayout(config, layout) {
  if (!isObject(layout)) return null;
  if (typeof layout.$layout === 'string') {
    let defs = config.layouts;
    return isObject(defs) && isObject(defs[layout.$layout]) ? defs[layout.$layout] : null;
  }
  if (typeof layout.kind === 'string') return layout;
  return null;
}

function eachViewLayout(config, cb) {
  let views = Array.isArray(config?.views) ? config.views : [];
  for (let view of views) {
    if (!isObject(view) || typeof view.id !== 'string') continue;
    cb(view.id, resolveViewLayout(config, view.layout));
  }
}

/** Tolerant tree walk yielding every layout node with a coarse type tag. */
function forEachNode(value, visit) {
  if (!isObject(value)) return;
  if (value.kind === 'bsp') return walkBsp(value.root, visit);
  if (value.kind === 'stack') return walkStack(value, visit);
}

function walkBsp(node, visit) {
  if (!isObject(node)) return;
  if (node.type === 'panel') return visit(node, 'panel');
  if (node.type === 'split') {
    visit(node, 'split');
    walkBsp(node.first, visit);
    walkBsp(node.second, visit);
  }
}

function walkStack(node, visit) {
  if (!isObject(node)) return;
  visit(node, 'stack');
  let children = Array.isArray(node.children) ? node.children : [];
  for (let child of children) {
    if (!isObject(child)) continue;
    if (child.type === 'panel') visit(child, 'panel');
    else if (child.type === 'bsp') walkBsp(child.root, visit);
    else if (child.type === 'stack') walkStack(child, visit);
  }
}

function refProviders(config) {
  let providers = [];
  let seen = new Set();
  let push = (id, path) => {
    if (seen.has(id)) return;
    seen.add(id);
    providers.push({ id, path });
  };

  eachViewLayout(config, (viewId, value) => {
    push(`view:${viewId}`, 'views');
    forEachNode(value, (node, type) => {
      if (typeof node.id !== 'string') return;
      if (type === 'panel') push(`panel:${viewId}:${node.id}`, 'layouts');
      else if (type === 'stack') push(`stack:${viewId}:${node.id}`, 'layouts');
    });
  });

  push('stack:root', 'stack:root');
  return providers;
}

function refConsumers(config) {
  let consumers = [];

  let panels = isObject(config?.panels) ? config.panels : {};
  for (let key of Object.keys(panels)) {
    let placement = panels[key];
    if (isObject(placement) && hasText(placement.module)) {
      consumers.push({
        id: `module:${placement.module}`,
        path: `panels.${key}.module`,
        code: 'structure.panel.module_unresolved',
        message: `Panel placement "${key}" references module "${placement.module}" not declared in modules[].`,
      });
    }
  }

  eachViewLayout(config, (viewId, value) => {
    forEachNode(value, (node, type) => {
      if (type !== 'stack' || !(Object.hasOwn(node, 'of') || Object.hasOwn(node, 'itemsBinding'))) return;
      let base = `stack:${viewId}:${node.id}`;
      let items = node.itemsBinding;
      if (typeof items === 'string') {
        let root = stateRootField(items);
        if (root) {
          consumers.push({
            id: `state:${root}`,
            path: base,
            code: 'structure.stack.items_binding_unresolved',
            message: `Dynamic stack "${node.id}" itemsBinding "${items}" does not resolve to a declared state field.`,
          });
        }
      } else if (isObject(items) && hasText(items.collection)) {
        consumers.push({
          id: `collection:${items.collection}`,
          path: base,
          code: 'structure.stack.items_binding_unresolved',
          message: `Dynamic stack "${node.id}" itemsBinding collection "${items.collection}" is not a declared collection.`,
        });
      }
      let root = stateRootField(node.activeBinding);
      if (root) {
        consumers.push({
          id: `state:${root}`,
          path: base,
          code: 'structure.stack.active_binding_unresolved',
          message: `Dynamic stack "${node.id}" activeBinding "${node.activeBinding}" does not resolve to a declared state field.`,
        });
      }
    });
  });

  return consumers;
}

/**
 * STRUCTURE section registration for the S1.0 validator core.
 *
 * @type {import('../../validation/core.js').ValidationSection}
 */
export const structureSection = Object.freeze({
  id: 'structure',
  validate,
  refProviders,
  refConsumers,
});

export default structureSection;
