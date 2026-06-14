/**
 * symbiote-workspace — Node-safe root entry point.
 *
 * Exports schema, validation, planning, sharing, and plugin utilities.
 * Does NOT import browser-only code (DOM, CustomElements).
 * Does NOT import server-only code (node:fs, node:http).
 *
 * Browser-only assembly lives in `symbiote-workspace/browser`.
 * Server mode lives in `symbiote-workspace/server`.
 */

export {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  WORKSPACE_CONFIG_SCHEMA,
  validateWorkspaceConfig,
  isCompatibleVersion,
} from './schema/index.js';

export {
  loadWorkspaceConfig,
  extractThemeParams,
  extractThemeRelations,
  extractThemeOverrides,
  extractThemeSubtrees,
} from './loader/index.js';

export {
  planWorkspace,
  matchTemplate,
  listTemplates,
  getTemplate,
  normalizeConstructionIntent,
  buildConstructionQuestions,
  answerConstructionQuestion,
  planWorkspaceConstruction,
  extractConstructionPlan,
} from './constructor/index.js';

export {
  WORKSPACE_PACKAGE_KIND,
  WORKSPACE_PACKAGE_SCHEMA_VERSION,
  exportConfig,
  exportWorkspacePackage,
  importConfig,
  importWorkspacePackage,
  diffConfigs,
  mergeConfigs,
  createHostIntegrationContract,
  createWorkspacePackageConstructionContext,
  inspectWorkspacePackage,
  validateWorkspacePackage,
} from './sharing/index.js';

export {
  checkDesignGuardrails,
  loadWorkspaceDesignPolicy,
  normalizeWorkspacePatchReport,
  proposeWorkspacePatch,
  validateWorkspaceDesignPatch,
  validateWorkspacePatch,
  validateWorkspaceThemePatch,
  applyWorkspacePatch,
} from './validation/index.js';

export {
  PLUGIN_SCHEMA,
  PLUGIN_CATEGORIES,
  validatePluginDefinition,
  registerPlugin,
  activatePlugin,
  unregisterPlugin,
  listPlugins,
  getPlugin,
  getPluginStatus,
  clearPlugins,
  validatePlugin,
  collectPluginModuleCapabilities,
  listPluginModuleCapabilities,
  collectPluginWorkspaceTemplates,
  listPluginWorkspaceTemplates,
} from './plugins/index.js';

export {
  dispatch,
  TOOLS,
  isMutating,
  createSession,
} from './runtime/index.js';
