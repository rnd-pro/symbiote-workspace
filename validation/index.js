export {
  checkDesignGuardrails,
} from './design-guardrails.js';

export {
  clearRegisteredSections,
  getRegisteredSections,
  registerSection,
  validateWorkspaceConfig,
  isCompatibleVersion,
} from './core.js';

export {
  loadWorkspaceDesignPolicy,
  normalizeWorkspacePatchReport,
  proposeWorkspacePatch,
  validateWorkspaceDesignPatch,
  validateWorkspacePatch,
  validateWorkspaceThemePatch,
  applyWorkspacePatch,
} from './workspace-patches.js';
