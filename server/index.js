/**
 * symbiote-workspace/server — Server mode entry point.
 *
 * Node-only. Requires symbiote-engine as a peer dependency.
 * Do NOT import this from browser code.
 *
 * @module symbiote-workspace/server
 */

export { createWorkspaceServer } from './serve.js';
export {
  loadPluginsFromDir,
  loadPluginsFromPackages,
  registerBuiltInServerPlugins,
  activatePlugins,
  activateAllPlugins,
} from './plugin-loader.js';
export { createIngressRouter, createIngressPlugin } from './ingress.js';
export { createTriggerReconciler, createTriggerReconcilerPlugin } from './triggers.js';
export { createJobRuntime, createMemoryExecutionStore, deterministicRunId } from './jobs.js';
export {
  DATA_CHANGE_MESSAGE_TYPE,
  buildDataChangeMessage,
  isDataChangeMessage,
  broadcastDataChange,
} from '../runtime/data-change.js';
