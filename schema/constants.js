const DAY_MS = 24 * 60 * 60 * 1000;

export const STRUCTURAL_ID_PATTERN = Object.freeze(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
export const PORTABLE_ID_PATTERN = Object.freeze(/^[a-z][a-z0-9]*(?:[./:_-][a-z0-9]+)*$/);
export const MODULE_ID_PATTERN = Object.freeze(
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*:[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
);
export const CAPABILITY_ID_PATTERN = Object.freeze(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]+)*$/);
export const RUNTIME_ID_PATTERN = Object.freeze(/^[A-Za-z0-9_]{1,64}$/);
export const CATALOG_FINGERPRINT_FORMAT = 'sha256-<hex>';
export const CATALOG_FINGERPRINT_PATTERN = Object.freeze(/^sha256-[A-Fa-f0-9]+$/);

export const RESERVED_ID_CHARACTERS = Object.freeze(['*', '{', '}', '[', ']']);

export const WAS_ADDRESS_CLASSES = Object.freeze([
  'view',
  'panel',
  'stack',
  'node',
  'socket',
  'element',
  'state',
  'rt',
  'doc',
  'asset',
  'content',
  'action',
  'event',
  'binding',
  'route',
  'resource',
]);

export const PLACE_ADDRESS_CLASSES = Object.freeze([
  'view',
  'panel',
  'stack',
  'node',
  'socket',
  'element',
]);

export const VALUE_ADDRESS_CLASSES = Object.freeze([
  'state',
  'rt',
  'doc',
  'asset',
  'content',
]);

export const SUBJECT_ADDRESS_CLASSES = Object.freeze([
  'action',
  'event',
  'binding',
  'route',
]);

export const RESERVED_ADDRESS_CLASSES = Object.freeze(['resource']);

export const RUN_STATUSES = Object.freeze([
  'queued',
  'running',
  'done',
  'failed',
  'cancelled',
  'partial',
]);

export const TRIGGER_KINDS = Object.freeze(['manual', 'hook', 'schedule', 'ingress']);
export const ENDPOINT_KINDS = Object.freeze(['webhook', 'http']);
export const ENDPOINT_METHODS = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const HOOK_CLASSES = Object.freeze([
  'validate',
  'guard',
  'teach',
  'automate',
  'anomaly',
  'assist',
]);

export const HOOK_ACTION_KINDS = Object.freeze([
  'propose-safe-action',
  'ask-agent',
  'annotate',
  'suggest',
  'invoke',
]);

export const POLICY_MODES = Object.freeze(['auto', 'confirm', 'silent']);
export const PRINCIPAL_KINDS = Object.freeze(['human', 'agent', 'daemon']);
export const GRANT_EXPIRIES = Object.freeze(['task', 'session', 'install']);
export const VERDICTS = Object.freeze(['accepted', 'blocked', 'pendingApproval', 'rolledBack']);

export const DEPLOYMENT_RECORD_STATUSES = Object.freeze([
  'draft',
  'applied',
  'rolledBack',
  'superseded',
]);

export const ASSET_KINDS = Object.freeze([
  'image',
  'video',
  'audio',
  'font',
  'dataset',
  'model.checkpoint',
  'model.lora',
  'model.3d',
]);

export const AUDIO_PROVIDER_KINDS = Object.freeze([
  'browser-tts',
  'local-tts',
  'local-transcribe',
]);

export const COLLECTION_ITEM_KINDS = Object.freeze(['engine-graph', 'custom']);
export const RESOURCE_OPERATIONS = Object.freeze(['list', 'get', 'create', 'update', 'delete']);
export const I18N_STRATEGIES = Object.freeze(['prefix', 'query', 'none']);
export const ROUTE_QUERY_CODECS = Object.freeze(['string', 'int', 'csv', 'json', 'sort-tuple', 'date-range']);
export const ROUTE_RESERVED_QUERY = Object.freeze(['snap', 'locale']);
export const STATE_PERSISTENCE_TIERS = Object.freeze(['session', 'workspace', 'ephemeral', 'runtime']);
export const STATE_RESERVED_NAMESPACES = Object.freeze(['route', 'session']);

export const TASK_KINDS = Object.freeze(['construction']);
export const TASK_STATUSES = Object.freeze(['active', 'interrupted', 'completed', 'abandoned']);
export const PARK_STAGES = Object.freeze(['confirmPending', 'pendingApproval']);

export const LAYOUT_KINDS = Object.freeze(['bsp', 'stack']);
export const LAYOUT_NODE_TYPES = Object.freeze(['panel', 'split']);
export const COLLAPSE_POLICIES = Object.freeze(['auto', 'manual', 'never']);
export const OVERFLOW_POLICIES = Object.freeze(['collapse', 'scroll-inline', 'scroll-block', 'scroll']);
export const RESPONSIVE_MODES = Object.freeze(['preserve', 'stack', 'scroll-inline', 'drawer', 'swipe']);
export const MOBILE_DOCKS = Object.freeze(['auto', 'primary', 'start', 'end']);
export const SWIPE_CONTROLS = Object.freeze(['edge', 'island', 'none']);

export const SPLIT_RATIO_BOUNDS = Object.freeze({ min: 0.05, max: 0.95 });

export const COLLECTION_HISTORY_DEFAULTS = Object.freeze({
  depth: 100,
  coalesceWindowMs: 300,
});

export const EXECUTION_HISTORY_DEFAULTS = Object.freeze({
  maxRecords: 1000,
  maxAgeDays: 30,
});

export const CONTENT_INLINE_ENTRY_MAX_BYTES = 65536;
export const CONTENT_SECTION_INLINE_MAX_BYTES = 262144;

export const SESSION_GC_DEFAULTS = Object.freeze({
  taskAbandonMs: 14 * DAY_MS,
  parkedPendingApprovalMs: 14 * DAY_MS,
});

export const SESSION_LAYOUT_UNDO_DEPTH = 50;

export const FRAGMENT_SLOTS = Object.freeze([
  'layouts.<id>',
  'content.collections[*].entries',
  'content.collections[*].schema',
  'content.collections[*].schemaRef',
  'i18n.messages',
  'narration.timelines[*]',
  'assets',
]);

export const NON_STRUCTURAL_PATH_PREFIXES = Object.freeze([
  'narration.',
  'provenance.',
  'exports.shareKit.listing',
]);

export const COLLECTION_CAPABILITIES = Object.freeze([
  'collection.list',
  'collection.query',
  'collection.create',
  'collection.delete',
]);

export const DOCUMENT_CAPABILITIES = Object.freeze([
  'document.load',
  'document.commit',
  'document.patches',
  'document.delete',
  'document.snapshot',
  'document.presentation.save',
  'document.presentation.load',
]);

export const WORKSPACE_SESSION_CAPABILITIES = Object.freeze([
  'workspace.session.load',
  'workspace.session.commit',
  'workspace.session.snapshot.save',
  'workspace.session.snapshot.load',
  'workspace.session.snapshot.list',
]);

export const WORKSPACE_STATE_CAPABILITIES = Object.freeze([
  'workspace.state.load',
  'workspace.state.commit',
]);

export const EXECUTION_CAPABILITIES = Object.freeze([
  'execution.submit',
  'execution.cancel',
  'execution.reorder',
  'execution.attach',
  'execution.list',
  'execution.history.list',
  'execution.history.get',
  'execution.history.append',
]);

export const INGRESS_CAPABILITIES = Object.freeze([
  'ingress.register',
  'ingress.unregister',
]);

export const SCHEDULE_CAPABILITIES = Object.freeze([
  'schedule.register',
  'schedule.unregister',
]);

export const ASSET_CAPABILITIES = Object.freeze([
  'asset.resolve',
  'asset.fetch',
]);

export const AGENT_WEBMCP_CAPABILITY = 'agent.webmcp';

export const CAPABILITY_FAMILIES = Object.freeze({
  collection: COLLECTION_CAPABILITIES,
  document: DOCUMENT_CAPABILITIES,
  workspaceSession: WORKSPACE_SESSION_CAPABILITIES,
  workspaceState: WORKSPACE_STATE_CAPABILITIES,
  execution: EXECUTION_CAPABILITIES,
  ingress: INGRESS_CAPABILITIES,
  schedule: SCHEDULE_CAPABILITIES,
  asset: ASSET_CAPABILITIES,
  agent: Object.freeze([AGENT_WEBMCP_CAPABILITY]),
});

export const RT_PREFIX = 'rt:';
export const RT_WORKSPACE_EXECUTION_QUEUE = `${RT_PREFIX}workspace:execution:queue`;
export const RT_WORKSPACE_EXECUTION_NODE_PROGRESS = `${RT_PREFIX}workspace:execution:node-progress`;
export const RT_WORKSPACE_EXECUTION_NODE_OUTPUT = `${RT_PREFIX}workspace:execution:node-output`;
export const RT_WORKSPACE_CAPABILITIES = `${RT_PREFIX}workspace:capabilities`;
export const RT_WORKSPACE_REGISTRY_UPDATES = `${RT_PREFIX}workspace:registry:updates`;
export const WORKSPACE_CONFIG_CHANNEL = 'workspace:config';
export const WORKSPACE_STATE_CHANNEL = 'workspace:state';

export const WORKSPACE_EXECUTION_CHANNELS = Object.freeze({
  queue: RT_WORKSPACE_EXECUTION_QUEUE,
  nodeProgress: RT_WORKSPACE_EXECUTION_NODE_PROGRESS,
  nodeOutput: RT_WORKSPACE_EXECUTION_NODE_OUTPUT,
});

export const PLATFORM_RT_CHANNELS = Object.freeze([
  RT_WORKSPACE_EXECUTION_QUEUE,
  RT_WORKSPACE_EXECUTION_NODE_PROGRESS,
  RT_WORKSPACE_EXECUTION_NODE_OUTPUT,
  RT_WORKSPACE_CAPABILITIES,
  RT_WORKSPACE_REGISTRY_UPDATES,
]);

export const DURABLE_CHANNELS = Object.freeze([
  WORKSPACE_CONFIG_CHANNEL,
  WORKSPACE_STATE_CHANNEL,
]);

export const createDocumentChannelName = Object.freeze((collectionId, docId) => (
  `doc:${collectionId}:${docId}`
));
