import { validateWorkspaceConfig } from './core.js';
import { escapePointerSegment, pathToPointer, prefixPointer } from '../schema/config-path.js';
import { diffConfigs, mergeConfigs } from '../sharing/config-portability.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function workspaceContext(config, context = {}) {
  return {
    register: config?.register,
    componentFamilies: inferComponentFamilies(config),
    ...context,
  };
}

function inferComponentFamilies(config) {
  let tags = Object.values(config?.panelTypes || {})
    .map((panel) => panel?.component)
    .filter(Boolean);
  let families = new Set();
  for (let tag of tags) {
    if (/table|grid/.test(tag)) families.add('table');
    if (/chart|analytics|insight/.test(tag)) families.add('chart');
    if (/graph|node|canvas|flow/.test(tag)) families.add('graph');
    if (/code|source|editor/.test(tag)) families.add('code-editor');
    if (/chat|message|conversation/.test(tag)) families.add('chat');
  }
  return [...families].sort((a, b) => a.localeCompare(b));
}

function normalizePolicyDiagnostics(result, surface, pathPrefix = '') {
  return (result.violations || []).map((violation) => ({
    surface,
    path: pathPrefix ? prefixPointer(pathPrefix, violation.path) : pathToPointer(violation.path),
    severity: violation.severity === 'hard' ? 'hard' : 'soft',
    status: violation.status,
    parameter: violation.parameter,
    value: deepClone(violation.value),
    message: violation.reason,
    reason: violation.reason,
    rules: deepClone(violation.rules || []),
  }));
}

function normalizeSuggestedPatches(patches, pathPrefix = '') {
  return (patches || []).map((patch) => ({
    ...deepClone(patch),
    path: pathPrefix ? prefixPointer(pathPrefix, patch.path) : pathToPointer(patch.path),
  }));
}

function normalizeConfigDiagnostics(validation, patch) {
  let diagnostics = [];
  let source = [
    ...(validation.errors || []).map((error) => ({ ...error, severity: 'hard' })),
    ...(validation.warnings || []).map((warning) => ({ ...warning, severity: 'soft' })),
  ];
  for (let item of source) {
    let surface = surfaceForPath(item.path, patch);
    diagnostics.push({
      surface,
      path: pointerForSurface(item.path, surface, patch),
      severity: item.severity,
      status: item.severity === 'hard' ? 'blocked' : 'warn',
      message: item.message,
      reason: item.message,
    });
  }
  return diagnostics;
}

function surfaceForPath(path, patch) {
  if (path.startsWith('layout')) return 'layout';
  if (path.startsWith('panelTypes') || path.startsWith('components')) return patch.modules ? 'modules' : 'config';
  if (path.startsWith('theme')) return 'theme';
  if (path.startsWith('design') || path === 'register') return 'design';
  return 'config';
}

function pointerForSurface(path, surface, patch) {
  if (surface === 'modules' && patch.modules) {
    if (path.startsWith('panelTypes')) return `/modules/${pathToPointer(path).slice(1)}`;
    if (path.startsWith('components')) return `/modules/${pathToPointer(path).slice(1)}`;
  }
  return pathToPointer(path);
}

function layoutSuggestions(config) {
  let suggestions = [];
  collectRatioSuggestions(config?.layout, '/layout', suggestions);
  if (isObject(config?.layouts)) {
    for (let [layoutId, layout] of Object.entries(config.layouts)) {
      collectRatioSuggestions(layout?.root, `/layouts/${escapePointerSegment(layoutId)}/root`, suggestions);
    }
  }
  return suggestions;
}

function collectRatioSuggestions(node, path, suggestions) {
  if (!isObject(node)) return;
  if (node.type === 'split' && typeof node.ratio === 'number' && (node.ratio < 0.05 || node.ratio > 0.95)) {
    suggestions.push({
      op: 'replace',
      path: `${path}/ratio`,
      value: Math.min(0.95, Math.max(0.05, node.ratio)),
      reason: 'Use a legal split ratio within the workspace schema range.',
    });
  }
  if (node.first) collectRatioSuggestions(node.first, `${path}/first`, suggestions);
  if (node.second) collectRatioSuggestions(node.second, `${path}/second`, suggestions);
}

function normalizePatchInput(patch = {}) {
  if (!isObject(patch)) {
    throw new Error('Workspace patch must be a plain object.');
  }
  if (isObject(patch.overlay)) return deepClone(patch.overlay);

  let overlay = {};
  if (patch.theme !== undefined) overlay.theme = deepClone(patch.theme);
  if (patch.design !== undefined) overlay.design = deepClone(patch.design);
  if (patch.layout !== undefined) overlay.layout = deepClone(patch.layout);
  if (patch.runtime !== undefined) overlay.runtime = deepClone(patch.runtime);
  if (patch.exports !== undefined) overlay.exports = deepClone(patch.exports);
  if (patch.validation !== undefined) overlay.validation = deepClone(patch.validation);
  if (patch.patches !== undefined) overlay.patches = deepClone(patch.patches);
  if (patch.modules !== undefined) {
    if (patch.modules.panelTypes !== undefined) overlay.panelTypes = deepClone(patch.modules.panelTypes);
    if (patch.modules.components !== undefined) overlay.components = deepClone(patch.modules.components);
  }

  for (let [key, value] of Object.entries(patch)) {
    if (!['overlay', 'theme', 'design', 'layout', 'runtime', 'exports', 'validation', 'patches', 'modules'].includes(key)) {
      overlay[key] = deepClone(value);
    }
  }
  return overlay;
}

function statusFromDiagnostics(diagnostics) {
  if (diagnostics.some((item) => item.severity === 'hard')) return 'blocked';
  if (diagnostics.some((item) => item.severity === 'soft')) return 'warn';
  return 'pass';
}

function appliedPatchStatus(status) {
  return status === 'warn' ? 'warn' : 'pass';
}

function validationReportForAppliedPatch(proposal) {
  let status = appliedPatchStatus(proposal.status);
  return {
    id: 'workspace-patch-validation',
    check: 'workspace-patch-validation',
    version: proposal.version,
    status,
    severity: status === 'warn' ? 'warning' : 'info',
    message: status === 'warn'
      ? 'Workspace patch applied with validation warnings.'
      : 'Workspace patch validated and applied.',
    diagnostics: deepClone(proposal.diagnostics || []),
    suggestedPatches: deepClone(proposal.suggestedPatches || []),
  };
}

function appliedPatchRecord(proposal) {
  return {
    id: 'workspace-patch-validation',
    surface: proposal.surface,
    status: appliedPatchStatus(proposal.status),
    overlay: deepClone(proposal.overlay || {}),
    operations: deepClone(proposal.changes || []),
    report: validationReportForAppliedPatch(proposal),
  };
}

function upsertValidationReport(reports, report) {
  let nextReports = reports.filter((item) => item?.id !== report.id);
  nextReports.push(report);
  return nextReports;
}

function persistAppliedPatchEvidence(config, proposal) {
  let nextConfig = deepClone(config);
  let validation = isObject(nextConfig.validation) ? deepClone(nextConfig.validation) : {};
  let reports = Array.isArray(validation.reports) ? validation.reports : [];
  let report = validationReportForAppliedPatch(proposal);

  nextConfig.patches = [
    ...(Array.isArray(nextConfig.patches) ? nextConfig.patches : []),
    appliedPatchRecord(proposal),
  ];
  nextConfig.validation = {
    ...validation,
    reports: upsertValidationReport(reports, report),
  };
  return nextConfig;
}

/**
 * @returns {Promise<{
 *   deriveDesignConstraints: Function,
 *   validateThemePatch: Function,
 *   validateDesignPatch: Function,
 * }>}
 */
export async function loadWorkspaceDesignPolicy() {
  try {
    return await import('symbiote-ui/rules/design-policy.js');
  } catch (error) {
    throw new Error(`Cannot load symbiote-ui design policy: ${error.message}`);
  }
}

/**
 * @param {Object} config
 * @param {Object} themePatch
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function validateWorkspaceThemePatch(config, themePatch = {}, options = {}) {
  let policy = await loadWorkspaceDesignPolicy();
  let context = workspaceContext(config, options.context);
  let constraints = policy.deriveDesignConstraints(config, context);
  let result = policy.validateThemePatch(themePatch, constraints);
  let diagnostics = normalizePolicyDiagnostics(result, 'theme', '/theme');
  let suggestedPatches = normalizeSuggestedPatches(result.suggestedPatches, '/theme');
  return normalizeWorkspacePatchReport({
    surface: 'theme',
    constraints: result.constraints,
    diagnostics,
    suggestedPatches,
  });
}

/**
 * @param {Object} config
 * @param {Object} designPatch
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function validateWorkspaceDesignPatch(config, designPatch = {}, options = {}) {
  let policy = await loadWorkspaceDesignPolicy();
  let context = workspaceContext(config, options.context);
  let result = policy.validateDesignPatch({ design: designPatch }, config, context);
  let diagnostics = normalizePolicyDiagnostics(result, 'design');
  let suggestedPatches = normalizeSuggestedPatches(result.suggestedPatches);
  return normalizeWorkspacePatchReport({
    surface: 'design',
    constraints: result.constraints,
    diagnostics,
    suggestedPatches,
  });
}

/**
 * @param {Object} config
 * @param {Object} patch
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function validateWorkspacePatch(config, patch = {}, options = {}) {
  let overlay = normalizePatchInput(patch);
  let nextConfig = mergeConfigs(config, overlay);
  let diagnostics = [];
  let suggestedPatches = [];
  let constraints = null;

  if (patch.theme || overlay.theme) {
    let themeReport = await validateWorkspaceThemePatch(nextConfig, overlay.theme || {}, options);
    diagnostics.push(...themeReport.diagnostics);
    suggestedPatches.push(...themeReport.suggestedPatches);
    constraints = themeReport.constraints;
  }

  if (patch.design || overlay.design) {
    let designReport = await validateWorkspaceDesignPatch(nextConfig, overlay.design || {}, options);
    diagnostics.push(...designReport.diagnostics);
    suggestedPatches.push(...designReport.suggestedPatches);
    constraints ||= designReport.constraints;
  }

  let configValidation = validateWorkspaceConfig(nextConfig, { strict: true });
  diagnostics.push(...normalizeConfigDiagnostics(configValidation, patch));
  suggestedPatches.push(...layoutSuggestions(nextConfig));

  return normalizeWorkspacePatchReport({
    surface: 'workspace',
    overlay,
    nextConfig,
    constraints,
    configValidation,
    diagnostics,
    suggestedPatches,
  });
}

/**
 * @param {Object} config
 * @param {Object} patch
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function proposeWorkspacePatch(config, patch = {}, options = {}) {
  let report = await validateWorkspacePatch(config, patch, options);
  let nextConfig = report.accepted ? report.nextConfig : null;
  let changes = nextConfig ? diffConfigs(config, nextConfig) : [];
  return {
    ...report,
    nextConfig,
    preview: nextConfig,
    changes,
    count: changes.length,
  };
}

/**
 * @param {Object} config
 * @param {Object} patch
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function applyWorkspacePatch(config, patch = {}, options = {}) {
  let proposal = await proposeWorkspacePatch(config, patch, options);
  if (!proposal.accepted) {
    return {
      ...proposal,
      status: 'blocked',
      config: null,
    };
  }
  return {
    ...proposal,
    status: proposal.status === 'pass' ? 'ok' : proposal.status,
    config: persistAppliedPatchEvidence(proposal.nextConfig, proposal),
  };
}

/**
 * @param {Object} report
 * @returns {Object}
 */
export function normalizeWorkspacePatchReport(report = {}) {
  let diagnostics = (report.diagnostics || []).map((item) => ({
    ...deepClone(item),
    surface: item.surface || report.surface || 'workspace',
    path: pathToPointer(item.path),
    severity: item.severity === 'hard' ? 'hard' : 'soft',
    status: item.status || (item.severity === 'hard' ? 'blocked' : 'warn'),
    message: item.message || item.reason || '',
    reason: item.reason || item.message || '',
  }));
  let status = report.status || statusFromDiagnostics(diagnostics);
  let accepted = status !== 'blocked';
  let summary = {
    blocked: diagnostics.filter((item) => item.severity === 'hard').length,
    warnings: diagnostics.filter((item) => item.severity !== 'hard').length,
    totalDiagnostics: diagnostics.length,
    suggestedPatches: (report.suggestedPatches || []).length,
  };

  return {
    version: 'workspace-patch-report-v1',
    surface: report.surface || 'workspace',
    status,
    accepted,
    summary,
    diagnostics,
    suggestedPatches: deepClone(report.suggestedPatches || []),
    constraints: deepClone(report.constraints || null),
    configValidation: deepClone(report.configValidation || null),
    overlay: deepClone(report.overlay || null),
    nextConfig: deepClone(report.nextConfig || null),
  };
}
