export {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  EXECUTION_MODELS,
  HOST_SERVICE_CATEGORIES,
  DATA_BINDING_DIRECTIONS,
  WORKSPACE_CONFIG_SCHEMA,
  WORKSPACE_SECTION_MODULES,
  assembleWorkspaceSchema,
  getWorkspaceSchema,
} from './workspace-schema.js';

export * from './constants.js';
export * from './was.js';
export * from './config-path.js';
export * from './value-classes.js';
export * from './canonical-json.js';
export * from './record-schema.js';
export * from './session-document.js';

export { structureSection } from './sections/structure.js';
export { modulesSection } from './sections/modules.js';
export { wiringSection } from './sections/wiring.js';
export { dataSection } from './sections/data.js';
export {
  workspaceSurfacesSection,
  deriveWorkspaceSurfaceRoute,
  WORKSPACE_SURFACES_SECTION_ID,
  WORKSPACE_SURFACE_ROUTE_DERIVATIONS,
  WORKSPACE_SURFACE_SESSION_SCOPES,
  WORKSPACE_SURFACE_CHAT_MODES,
  WORKSPACE_SURFACE_THEME_MODES,
  WORKSPACE_SURFACE_PROGRESS_CHANNELS,
} from './sections/workspace-surfaces.js';
export { routesSection } from './sections/routes.js';
export { behaviorSection } from './sections/behavior.js';
export { serverSection } from './sections/server.js';
export { stateSection } from './sections/state.js';

export {
  MODULE_CAPABILITY_SCHEMA_VERSION,
  MODULE_CAPABILITY_DESCRIPTOR_SCHEMA,
  validateModuleCapabilityDescriptor,
  validatePortableStringArray,
} from './module-capability.js';

export {
  validateWorkspaceConfig,
  isCompatibleVersion,
} from '../validation/core.js';
