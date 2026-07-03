/**
 * Runtime barrel export.
 * @module symbiote-workspace/runtime
 */

export { dispatch, TOOLS, TOOL_FAMILIES, TOOL_REGISTRY, getToolDefinition, isMutating } from './dispatch.js';
export { createSession } from './session.js';
export {
  REBASED_OVER_CONCURRENT_EDIT,
  WorkspaceState,
  createConfigFingerprint,
  createWorkspaceState,
} from './workspace-state.js';
export { UndoRouter, createUndoRouter } from './undo-router.js';
export { createRouter } from './router-lane.js';
export { createRouteMatcher, normalizeRoutePattern } from './route-matcher.js';
export {
  DOCUMENT_RECORD_VERSION,
  DEFAULT_DOCUMENT_HISTORY_DEPTH,
  DEFAULT_DOCUMENT_COALESCE_WINDOW_MS,
  DocumentRuntime,
  createDocumentRuntime,
  createMemoryDocumentPersistence,
  documentWriteCapability,
  isMutatingDocumentAction,
} from './documents.js';
export {
  SESSION_DOCUMENT_VERSION,
  SESSION_LAST_WRITER_WINS,
  SESSION_MEMORY_FALLBACK,
  SessionStore,
  createMemorySessionPersistence,
  createSessionStore,
  sessionDocumentAddress,
} from './session-store.js';
export { createRegistryObserver, createPollingRegistryObserver } from './registry-observer.js';
export {
  WIRE_OBSERVATION_CONTEXT,
  WIRE_OBSERVATION_EVENT_PREFIX,
  WIRE_OBSERVATION_BINDING_PREFIX,
  WIRE_VALUE_PROP,
  applyWireMap,
  compileWire,
  compileWires,
  compileWorkspaceWires,
  createRtProducerThrottle,
  installCompiledWires,
} from './wire-compiler.js';
export {
  HOOK_ACTIVITY_TYPE,
  HOOK_ACTIVITY_ACTIONS,
  ASK_AGENT_QUEUE_DEFAULT,
  bindConfigHooks,
  composeHookPolicy,
  dismissalKeyForHook,
  filterHookContext,
  hookBridgeInterfaces,
  previewHookMatches,
} from './hook-bridge.js';
export {
  createHookToolHandlers,
  hookToolFamily,
  hookTools,
} from './tools/hook-tools.js';
export {
  createSessionToolHandlers,
  resolveSessionStore,
  sessionToolFamily,
  sessionTools,
  tools as sessionToolDefinitions,
} from './tools/session-tools.js';
export {
  createDocumentToolHandlers,
  documentToolFamily,
  documentTools,
  resolveDocumentRuntime,
  tools as documentToolDefinitions,
} from './tools/document-tools.js';
export {
  routeToolFamily,
  tools as routeToolDefinitions,
} from './tools/route-tools.js';
export {
  grantHandlers,
  grantToolFamily,
  grantTools,
} from './tools/grant-tools.js';
export {
  createExecutionToolHandlers,
  executionToolFamily,
  resolveExecutionRuntime,
  tools as executionToolDefinitions,
} from './tools/execution-tools.js';
export {
  createCatalogToolFamily,
  catalogTools,
} from '../catalog/tools.js';
export {
  buildToolResultEnvelope,
  parseToolResultEnvelope,
  isToolResultEnvelope,
} from './tool-result.js';
export {
  toolConfirmPolicy,
  isMutatingTool,
  needsConfirm,
} from './tool-policy.js';
export {
  DATA_CHANGE_MESSAGE_TYPE,
  buildDataChangeMessage,
  isDataChangeMessage,
  broadcastDataChange,
} from './data-change.js';
export {
  validateStep,
  assertStep,
  buildCtx,
  toolViews,
} from './construction-agent.js';
export { runConstructionLoop } from './agent-loop.js';
export {
  createScriptedAdapter,
  createMemoryTrace,
  buildConstructionPlan,
} from './scripted-adapter.js';
export {
  PRESENTATION_PROMPT_PROFILES,
  createWorkspacePresentationTimeline,
  normalizePresentationPrompt,
  summarizePresentationTimeline,
} from './presentation.js';
