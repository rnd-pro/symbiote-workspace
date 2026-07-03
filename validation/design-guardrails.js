/**
 * @typedef {Object} GuardrailIssue
 * @property {string} check
 * @property {string} message
 * @property {string} severity
 * @property {string} [view]
 */

/**
 * @typedef {Object} GuardrailResult
 * @property {boolean} pass
 * @property {Array<GuardrailIssue>} issues
 */

/**
 * Design-quality guardrails over the target-schema structural plane. Unlike the
 * strict validator (validation/core.js), these emit register-aware WARNINGS and
 * INFO on the resolved `views[] → layouts{}` geometry: theme completeness,
 * register density (max panels + minimum split ratios), and layout nesting depth.
 *
 * @param {Object} config - Workspace config (target schema).
 * @param {Object} [options]
 * @param {string} [options.register] - Override register for density checks.
 * @returns {GuardrailResult}
 */
export function checkDesignGuardrails(config, options = {}) {
  let issues = [];
  let register = options.register || config?.register || 'tool';

  checkThemeCompleteness(config, issues);

  for (let { viewId, layout } of resolveBspLayouts(config)) {
    checkRegisterDensity(layout, register, viewId, issues);
    checkLayoutDepth(layout, viewId, issues);
  }

  return {
    pass: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolves every view's layout to its bsp root node. `$layout` references are
 * resolved against `layouts{}`; non-bsp layouts (stack) carry no geometry the
 * density/depth heuristics understand and are skipped.
 *
 * @returns {Array<{ viewId: string, layout: Object }>}
 */
function resolveBspLayouts(config) {
  let views = Array.isArray(config?.views) ? config.views : [];
  let resolved = [];
  for (let view of views) {
    if (!isObject(view)) continue;
    let value = resolveLayoutValue(config, view.layout);
    if (isObject(value) && value.kind === 'bsp' && isObject(value.root)) {
      resolved.push({ viewId: typeof view.id === 'string' ? view.id : '', layout: value.root });
    }
  }
  return resolved;
}

function resolveLayoutValue(config, layout) {
  if (!isObject(layout)) return null;
  if (typeof layout.$layout === 'string') {
    let defs = config?.layouts;
    return isObject(defs) && isObject(defs[layout.$layout]) ? defs[layout.$layout] : null;
  }
  if (typeof layout.kind === 'string') return layout;
  return null;
}

let REQUIRED_THEME_PARAMS = ['mode', 'hue'];

function checkThemeCompleteness(config, issues) {
  if (!config?.theme?.params) {
    issues.push({
      check: 'theme-completeness',
      message: 'No theme params specified — workspace will use host defaults.',
      severity: 'info',
    });
    return;
  }

  let params = config.theme.params;
  for (let key of REQUIRED_THEME_PARAMS) {
    if (params[key] === undefined) {
      issues.push({
        check: 'theme-completeness',
        message: `Theme param "${key}" is not set — cascade will use default.`,
        severity: 'info',
      });
    }
  }
}

/** @type {Object<string, { maxPanels: number, minRatio: number }>} */
let REGISTER_CONSTRAINTS = {
  tool: { maxPanels: 12, minRatio: 0.1 },
  admin: { maxPanels: 14, minRatio: 0.08 },
  editor: { maxPanels: 10, minRatio: 0.1 },
  'agent-workspace': { maxPanels: 12, minRatio: 0.1 },
  'media-studio': { maxPanels: 10, minRatio: 0.08 },
  brand: { maxPanels: 6, minRatio: 0.2 },
  presentation: { maxPanels: 4, minRatio: 0.25 },
};

function countLeafPanels(node) {
  if (!isObject(node)) return 0;
  if (node.type === 'split') {
    return countLeafPanels(node.first) + countLeafPanels(node.second);
  }
  return node.type === 'panel' ? 1 : 0;
}

function checkRegisterDensity(node, register, viewId, issues) {
  let constraints = REGISTER_CONSTRAINTS[register];
  if (!constraints) return;

  let panelCount = countLeafPanels(node);
  if (panelCount > constraints.maxPanels) {
    issues.push({
      check: 'register-density',
      message: `Register "${register}" allows max ${constraints.maxPanels} panels, view "${viewId}" layout has ${panelCount}.`,
      severity: 'warning',
      view: viewId,
    });
  }

  checkMinRatios(node, constraints.minRatio, register, viewId, issues);
}

function checkMinRatios(node, minRatio, register, viewId, issues) {
  if (!isObject(node) || node.type !== 'split') return;
  if (typeof node.ratio === 'number') {
    if (node.ratio < minRatio) {
      issues.push({
        check: 'register-density',
        message: `Register "${register}" requires minimum ratio ${minRatio}, view "${viewId}" found ${node.ratio}.`,
        severity: 'warning',
        view: viewId,
      });
    }
    let complementRatio = 1 - node.ratio;
    if (complementRatio < minRatio) {
      issues.push({
        check: 'register-density',
        message: `Register "${register}" requires minimum ratio ${minRatio}, view "${viewId}" found ${complementRatio.toFixed(2)} (complement).`,
        severity: 'warning',
        view: viewId,
      });
    }
  }
  checkMinRatios(node.first, minRatio, register, viewId, issues);
  checkMinRatios(node.second, minRatio, register, viewId, issues);
}

let MAX_LAYOUT_DEPTH = 6;

function getLayoutDepth(node, depth = 1) {
  if (!isObject(node) || node.type !== 'split') return depth;
  let firstDepth = getLayoutDepth(node.first, depth + 1);
  let secondDepth = getLayoutDepth(node.second, depth + 1);
  return Math.max(firstDepth, secondDepth);
}

function checkLayoutDepth(node, viewId, issues) {
  let depth = getLayoutDepth(node);
  if (depth > MAX_LAYOUT_DEPTH) {
    issues.push({
      check: 'layout-depth',
      message: `Layout nesting depth ${depth} in view "${viewId}" exceeds maximum ${MAX_LAYOUT_DEPTH}.`,
      severity: 'warning',
      view: viewId,
    });
  }
}
