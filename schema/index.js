export {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_REGISTER_VALUES,
  WORKSPACE_CONFIG_SCHEMA,
} from './workspace-schema.js';

export {
  MODULE_CAPABILITY_SCHEMA_VERSION,
  MODULE_CAPABILITY_DESCRIPTOR_SCHEMA,
  validateModuleCapabilityDescriptor,
} from './module-capability.js';

export {
  validateWorkspaceConfig,
  isCompatibleVersion,
} from './validate.js';
