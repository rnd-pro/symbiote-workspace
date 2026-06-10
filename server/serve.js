/**
 * Workspace Server — thin orchestration wrapper over symbiote-engine/GraphServer.
 *
 * Combines engine's createServer() with the workspace plugin system:
 * 1. Load plugins from directories and/or npm packages
 * 2. Register plugin handlers in engine Registry
 * 3. Start engine server (WS + HTTP)
 * 4. Activate all plugins with server context
 * 5. Return unified handle with close() for graceful shutdown
 *
 * @module symbiote-workspace/server/serve
 */

import { loadPluginsFromDir, loadPluginsFromPackages, activateAllPlugins } from './plugin-loader.js';
import { listPlugins, clearPlugins } from '../plugins/index.js';

/**
 * @typedef {Object} WorkspaceServerOptions
 * @property {number} [port=3100] - HTTP/WebSocket port
 * @property {string} [pluginsDir] - Path to directory containing .plugin.js files
 * @property {string[]} [plugins] - npm package names to load as plugins
 * @property {string} [handlersDir] - Path to .handler.js directory (passed to engine)
 * @property {string} [workflowFile] - Path to .workflow.json (passed to engine)
 * @property {boolean} [watchFiles=true] - Enable file watching (passed to engine)
 * @property {boolean} [verbose=false] - Verbose logging
 */

/**
 * Create and start a workspace server.
 *
 * @param {WorkspaceServerOptions} [options]
 * @returns {Promise<{
 *   server: import('http').Server,
 *   wss: import('ws').WebSocketServer,
 *   graph: Object,
 *   plugins: Array<{ name: string, version: string, status: string }>,
 *   close: () => Promise<void>
 * }>}
 */
export async function createWorkspaceServer(options = {}) {
  let {
    port = 3100,
    pluginsDir,
    plugins: pluginPackages = [],
    handlersDir,
    workflowFile,
    watchFiles = true,
    verbose = false,
  } = options;

  let log = verbose ? console.log.bind(console) : () => {};

  // 1. Load plugins (before starting server — handlers need to be registered first)
  let loadResults = [];

  if (pluginsDir) {
    let dirResults = await loadPluginsFromDir(pluginsDir, { verbose });
    loadResults.push(...dirResults);
  }

  if (pluginPackages.length) {
    let pkgResults = await loadPluginsFromPackages(pluginPackages, { verbose });
    loadResults.push(...pkgResults);
  }

  let loadedCount = loadResults.filter((r) => r.status === 'registered').length;
  let errorCount = loadResults.filter((r) => r.status === 'error').length;

  if (loadedCount > 0 || errorCount > 0) {
    log(`📦 [workspace-server] Plugins: ${loadedCount} loaded, ${errorCount} errors`);
  }

  // 2. Import and start engine server
  let engineModule;
  try {
    engineModule = await import('symbiote-engine/GraphServer.js');
  } catch (err) {
    throw new Error(
      `symbiote-workspace/server requires symbiote-engine as a peer dependency. ` +
      `Install it with: npm install symbiote-engine\n` +
      `Original error: ${err.message}`
    );
  }

  let engineResult = await engineModule.createServer({
    port,
    handlersDir,
    workflowFile,
    watchFiles,
    verbose,
  });

  // 3. Activate all pending plugins with server context
  let activationContext = {
    server: engineResult.server,
    wss: engineResult.wss,
    graph: engineResult.graph,
    broadcast: engineResult.broadcast,
  };

  let activationResults = await activateAllPlugins(activationContext);

  for (let result of activationResults) {
    if (result.ok) {
      log(`✅ [workspace-server] Activated: ${result.name}`);
    } else {
      log(`🔴 [workspace-server] Activation failed: ${result.name} — ${result.error}`);
    }
  }

  log(`🚀 [workspace-server] Ready on http://localhost:${port}`);

  // 4. Return handle
  let engineClose = engineResult.close;

  async function close() {
    // Deactivate plugins in reverse order
    let registered = listPlugins();
    for (let i = registered.length - 1; i >= 0; i--) {
      let plugin = registered[i];
      if (plugin.status === 'active') {
        let { unregisterPlugin } = await import('../plugins/index.js');
        await unregisterPlugin(plugin.name);
      }
    }

    // Close engine server
    await engineClose();
    log('🛑 [workspace-server] Stopped');
  }

  return {
    server: engineResult.server,
    wss: engineResult.wss,
    graph: engineResult.graph,
    plugins: listPlugins(),
    close,
  };
}
