export {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  EXECUTION_MODELS,
  HOST_SERVICE_CATEGORIES,
  DATA_BINDING_DIRECTIONS,
  WORKSPACE_CONFIG_SCHEMA,
} from './workspace-schema.js';

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
