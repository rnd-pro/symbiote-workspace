/**
 * @typedef {Object} GuardrailResult
 * @property {boolean} pass
 * @property {Array<{ check: string, message: string, severity: string }>} issues
 */

/**
 * @param {import('../schema/workspace-schema.js').WorkspaceConfig} config
 * @param {Object} [options]
 * @param {string} [options.register] - Override register for density checks
 * @returns {GuardrailResult}
 */
export function checkDesignGuardrails(config, options = {}) {
  let issues = [];
  let register = options.register || config?.register || 'tool';

  checkThemeCompleteness(config, issues);
  checkRegisterDensity(config, register, issues);
  checkLayoutDepth(config?.layout, issues);

  return {
    pass: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
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

function countLeafPanels(layout) {
  if (!layout) return 0;
  if (layout.type === 'panel') return 1;
  if (layout.type === 'split') {
    return countLeafPanels(layout.first) + countLeafPanels(layout.second);
  }
  return 1;
}

function checkRegisterDensity(config, register, issues) {
  let constraints = REGISTER_CONSTRAINTS[register];
  if (!constraints) return;

  let panelCount = countLeafPanels(config?.layout);
  if (panelCount > constraints.maxPanels) {
    issues.push({
      check: 'register-density',
      message: `Register "${register}" allows max ${constraints.maxPanels} panels, layout has ${panelCount}.`,
      severity: 'warning',
    });
  }

  checkMinRatios(config?.layout, constraints.minRatio, register, issues);
}

function checkMinRatios(layout, minRatio, register, issues) {
  if (!layout) return;
  if (layout.type === 'split' && typeof layout.ratio === 'number') {
    if (layout.ratio < minRatio) {
      issues.push({
        check: 'register-density',
        message: `Register "${register}" requires minimum ratio ${minRatio}, found ${layout.ratio}.`,
        severity: 'warning',
      });
    }
    let complementRatio = 1 - layout.ratio;
    if (complementRatio < minRatio) {
      issues.push({
        check: 'register-density',
        message: `Register "${register}" requires minimum ratio ${minRatio}, found ${complementRatio.toFixed(2)} (complement).`,
        severity: 'warning',
      });
    }
    checkMinRatios(layout.first, minRatio, register, issues);
    checkMinRatios(layout.second, minRatio, register, issues);
  }
}

let MAX_LAYOUT_DEPTH = 6;

function getLayoutDepth(layout, depth = 1) {
  if (!layout) return depth;
  if (layout.type === 'split') {
    let firstDepth = layout.first ? getLayoutDepth(layout.first, depth + 1) : depth;
    let secondDepth = layout.second ? getLayoutDepth(layout.second, depth + 1) : depth;
    return Math.max(firstDepth, secondDepth);
  }
  return depth;
}

function checkLayoutDepth(layout, issues) {
  if (!layout) return;
  let depth = getLayoutDepth(layout);
  if (depth > MAX_LAYOUT_DEPTH) {
    issues.push({
      check: 'layout-depth',
      message: `Layout nesting depth ${depth} exceeds maximum ${MAX_LAYOUT_DEPTH}.`,
      severity: 'warning',
    });
  }
}
