/**
 * symbiote-workspace — Node-safe root entry point.
 *
 * Exports schema, validation, planning, and sharing utilities.
 * Does NOT import browser-only code (DOM, CustomElements).
 *
 * Browser-only assembly lives in `symbiote-workspace/browser`.
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
  extractThemeOverrides,
  extractThemeSubtrees,
} from './loader/index.js';

export {
  planWorkspace,
  matchTemplate,
  listTemplates,
  getTemplate,
} from './constructor/index.js';

export {
  exportConfig,
  importConfig,
  diffConfigs,
  mergeConfigs,
} from './sharing/index.js';

export {
  checkDesignGuardrails,
} from './validation/index.js';
