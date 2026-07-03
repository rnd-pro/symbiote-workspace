export const WORKSPACE_SCHEMA_VERSION = '0.2.0';

export const WORKSPACE_REGISTER_VALUES = Object.freeze([
  'tool',
  'admin',
  'editor',
  'agent-workspace',
  'media-studio',
  'brand',
  'presentation',
]);

export const EXECUTION_MODELS = Object.freeze([
  'ui-only',
  'graph-execution',
  'server-session',
  'remote-provider',
  'mobile-executor',
  'automation-bridge',
]);

export const HOST_SERVICE_CATEGORIES = Object.freeze([
  'agent.runtime',
  'ai.provider',
  'clipboard',
  'file.system',
  'media.realtime',
  'network.fetch',
  'notifications',
  'presence.session',
  'selection',
  'storage.archive',
  'storage.project',
]);

export const COLLAPSE_POLICIES = Object.freeze(['auto', 'manual', 'never']);

export const OVERFLOW_POLICIES = Object.freeze(['collapse', 'scroll-inline', 'scroll-block', 'scroll']);

export const RESPONSIVE_MODES = Object.freeze(['preserve', 'stack', 'scroll-inline', 'drawer', 'swipe']);

export const MOBILE_DOCKS = Object.freeze(['auto', 'primary', 'start', 'end']);

export const SWIPE_CONTROLS = Object.freeze(['edge', 'island', 'none']);

export const DATA_BINDING_DIRECTIONS = Object.freeze(['input', 'output', 'two-way']);

export const PANEL_SETTING_TYPES = Object.freeze(['string', 'number', 'boolean', 'enum', 'object', 'array', 'color', 'token', 'json']);

export const STATE_FIELD_TYPES = Object.freeze(['string', 'number', 'boolean', 'enum', 'object', 'array', 'color', 'token', 'json']);

export const STATE_FIELD_PERSISTENCE = Object.freeze(['session', 'workspace', 'ephemeral']);

export const ENGINE_BINDING_SURFACES = Object.freeze(['action', 'setting', 'state', 'event', 'binding']);

export const ENGINE_NODE_CACHE_MODES = Object.freeze(['auto', 'freeze', 'force']);

export const VALIDATION_REPORT_STATUSES = Object.freeze(['pass', 'warn', 'blocked']);

export const VALIDATION_REPORT_SEVERITIES = Object.freeze(['info', 'warning', 'error']);

export const PORTABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[./:_-][a-z0-9]+)*$/;

export const CUSTOM_ELEMENT_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
