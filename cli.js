#!/usr/bin/env node

/**
 * symbiote-workspace CLI
 *
 * Thin proxy to the unified dispatch layer.
 * All tool commands map directly to dispatch(toolName, args).
 *
 * Special commands (not dispatch-based):
 *   serve   — Start workspace HTTP server
 *   mcp     — Start MCP server (stdio)
 *   --help  — Print usage
 *
 * Stateful mode:
 *   --config <file>  Load config before command, auto-save after mutations
 *
 * @module symbiote-workspace/cli
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

let argv = process.argv.slice(2);
let command = argv[0];

// ── Help ──

function printUsage() {
  console.log(`
symbiote-workspace CLI — one API, two entries

Special Commands:
  serve               Start workspace HTTP server
  mcp                 Start MCP server (stdio transport, for AI agents)

Tool Commands (all dispatch to unified API):
  describe            Describe current workspace config
  discover            Discover components in symbiote-ui
  find-component      Find a specific component by tag name
  list-component-tags List all component tag names
  list-categories     List component categories
  list-used-components List components used in workspace
  list-templates      List available workspace templates
  scaffold            Create workspace from template/intent
  scaffold-from-scratch Create blank workspace
  classify-workspace  Classify workspace intent without mutating config
  plan-workspace      Build construction questions and plan without mutating config
  construct-workspace Build construction plan and store config in active session
  propose-workspace-patch Preview a workspace patch without mutating config
  validate-workspace-patch Validate a workspace patch before applying it
  apply-workspace-patch Apply a validated workspace patch
  export-workspace    Export current workspace through the construction workflow
  validate            Validate workspace config
  add-group           Add a project group
  remove-group        Remove a project group
  update-group        Update group properties
  reorder-groups      Reorder groups
  list-groups         List all groups
  add-section         Add a sidebar section
  remove-section      Remove a section
  update-section      Update section properties
  reorder-sections    Reorder sections in a group
  list-sections       List sections
  set-layout          Set BSP layout tree
  add-panel           Add panel by splitting existing
  remove-panel        Remove panel from layout
  resize-panel        Resize a split
  update-layout-behavior Update root layout behavior
  register-panel-type Register a panel type
  update-panel-type   Update panel type
  unregister-panel-type Remove panel type
  list-panel-types    List panel types
  add-menu-action     Add menu action to panel
  remove-menu-action  Remove menu action
  toggle-menu-action  Toggle menu action state
  list-menu-actions   List menu actions
  set-behavior        Set panel/root behavior
  get-behavior        Get panel/root behavior
  update-behavior     Update behavior
  mount-widget        Mount component in panel
  unmount-widget      Unmount component
  swap-widget         Swap component in panel
  bridge-event        Create event bridge
  unbridge-event      Remove event bridge
  list-bridges        List event bridges
  start-preview       Generate preview files
  save-config         Save config to file
  load-config         Load config from file
  export-config       Export portable JSON (strips auth/server data)
  import-config       Import workspace from JSON string
  diff-configs        Compare current config with another
  merge-configs       Merge partial overlay into current config
  export-workspace-package  Export workspace as portable package (config + manifest + host contract)
  import-workspace-package  Import workspace package from JSON string
  validate-workspace-package Validate a workspace package
  inspect-workspace-package Inspect workspace package for validity, readiness, and host-neutral capability requirements
  create-workspace-package-construction-context Create construction context from a workspace package (object or JSON string)
  create-workspace-packages-construction-context Create construction context from multiple workspace packages
  create-workspace-construction-handoff Create construction handoff from package context and intent
  collect-plugin-module-capabilities Collect module capability descriptors from plugin metadata
  collect-plugin-workspace-templates Collect workspace templates from plugin metadata
  check-guardrails    Check design guardrails (panel limits, ratios)

Common Aliases:
  describe            -> describe-workspace
  discover            -> discover-components
  scaffold            -> scaffold-workspace
  plan                -> plan-workspace
  construct           -> construct-workspace
  validate            -> validate-config
  preview             -> start-preview

Global Options:
  --config <file>     Load config before command, auto-save after mutations
  --help, -h          Show this help

Options for 'serve':
  --port <n>          Server port (default: 3100)
  --plugins-dir <p>   Directory containing .plugin.js files
  --plugins <list>    Comma-separated npm package names
  --handlers-dir <p>  Directory containing .handler.js files
  --workflow <f>      Path to .workflow.json file
  --verbose           Enable verbose logging

Options for 'discover':
  --ui-path <p>       Path to symbiote-ui root

Options for 'scaffold':
  --name <n>          Override workspace name
  --register <r>      Override register (tool|admin|editor|agent-workspace|media-studio|brand|presentation)
  --output <f>        Write config to file

Options for 'plan-workspace' and 'construct-workspace':
  --template <name>   Explicit template name
  --name <n>          Override workspace name
  --register <r>      Override target register
  --required-capabilities <json-array>
                      Required portable capability tags
  --module-capabilities <json-array>
                      External module capability descriptors
  --workspace-templates <json-array>
                      External workspace templates
  --answers <json-object>
                      Construction question answers keyed by question ID
  --preferred-theme <json-object>
                      Preferred theme recipe fields
  --options <json-object>
                      Constructor options, including construction handoff options

Options for 'export-workspace-package':
  --manifest <json-object>  Package manifest with id, name, version, description, etc.
  --strict                  Reject on validation warnings

Options for 'import-workspace-package':
  --json <string>            JSON string of the workspace package

Options for 'validate-workspace-package':
  --package <json-object>    Workspace package to validate

Options for 'inspect-workspace-package':
  --package <json-object>    Workspace package object to inspect
  --json <string>            JSON string of the workspace package
  --available <json-object>  Host-neutral available capabilities map

Options for 'create-workspace-package-construction-context':
  --package <json-object>          Workspace package object
  --json <string>                  JSON string of the workspace package
  --available <json-object>        Host-neutral available capabilities map
  --template-name <string>         Template name override

Options for 'create-workspace-packages-construction-context':
  --packages <json-array>          Package entries: [{ package, json, templateName }]
  --available <json-object>        Host-neutral available capabilities map

Options for 'create-workspace-construction-handoff':
  --context <json-object>           Package construction context object
  --intent <string-or-json-object>  Construction intent to enrich with package capabilities

Options for 'collect-plugin-module-capabilities' and 'collect-plugin-workspace-templates':
  --plugins <json-object-or-array>  Plugin definition object or array of plugin definitions

Examples:
  npx symbiote-workspace scaffold "chat workspace" --config ws.json
  npx symbiote-workspace add-group --config ws.json --id g1 --name "Editor"
  npx symbiote-workspace add-section --config ws.json --groupId g1 --id s1 --label "Source"
  npx symbiote-workspace register-panel-type --config ws.json --name vp --title Viewport --component sn-canvas-viewport
  npx symbiote-workspace list-panel-types --config ws.json
  npx symbiote-workspace describe --config ws.json
  npx symbiote-workspace mcp
  `);
}

// ── Flag Parsing ──

/**
 * Parse CLI flags from argv.
 * Supports --key value and --flag (boolean).
 * @param {string[]} argv
 * @returns {{ flags: Object, positionals: string[] }}
 */
function parseArgs(argv) {
  let flags = {};
  let positionals = [];

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg.startsWith('--')) {
      let key = arg.slice(2);
      let next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        // Try to parse as JSON for complex values (arrays, objects)
        try {
          flags[key] = JSON.parse(next);
        } catch {
          flags[key] = next;
        }
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { flags, positionals };
}

/**
 * Convert kebab-case to snake_case.
 * @param {string} str
 * @returns {string}
 */
function kebabToSnake(str) {
  return str.replace(/-/g, '_');
}

/**
 * Convert kebab-case flag keys to camelCase for handler args.
 * @param {Object} flags
 * @returns {Object}
 */
function flagsToCamelCase(flags) {
  let result = {};
  for (let [key, value] of Object.entries(flags)) {
    let camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

// ── Special Commands ──

async function cmdServe() {
  let { flags } = parseArgs(argv.slice(1));
  let port = parseInt(flags.port, 10) || 3100;
  let pluginsDir = flags['plugins-dir'];
  let plugins = flags.plugins ? String(flags.plugins).split(',').map((s) => s.trim()) : [];
  let handlersDir = flags['handlers-dir'];
  let workflowFile = flags.workflow;
  let verbose = flags.verbose === true;

  let { createWorkspaceServer } = await import('./server/index.js');

  let handle = await createWorkspaceServer({
    port, pluginsDir, plugins, handlersDir, workflowFile, verbose,
  });

  console.log(`symbiote-workspace server running on http://localhost:${port}`);
  console.log(`Plugins loaded: ${handle.plugins.length}`);

  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    console.log('\nShutting down...');
    handle.close().then(() => process.exit(0));
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function cmdMcp() {
  await import('./mcp/index.js');
}

// ── Tool Dispatch ──

/**
 * Map special CLI command names that don't match 1:1 with tool names.
 * @type {Object<string, string>}
 */
const COMMAND_ALIASES = {
  validate: 'validate_config',
  scaffold: 'scaffold_workspace',
  plan: 'plan_workspace',
  construct: 'construct_workspace',
  describe: 'describe_workspace',
  discover: 'discover_components',
  preview: 'start_preview',
  'list-templates': 'list_templates',
};

/**
 * Commands that take a positional argument as a special field.
 * @type {Object<string, string>}
 */
const POSITIONAL_MAP = {
  scaffold_workspace: 'template',
  classify_workspace: 'intent',
  plan_workspace: 'intent',
  construct_workspace: 'intent',
  validate_config: '_filePath',
  describe_workspace: '_filePath',
  start_preview: '_filePath',
  load_config: 'filePath',
};

async function runToolCommand() {
  let { flags, positionals } = parseArgs(argv.slice(1));
  let configFile = flags.config;
  delete flags.config;

  // Resolve tool name
  let cliCommand = command;
  let toolName = COMMAND_ALIASES[cliCommand] || kebabToSnake(cliCommand);

  // Import runtime
  let { dispatch, isMutating, TOOLS, createSession } = await import('./runtime/index.js');

  // Verify tool exists
  let toolExists = TOOLS.some((t) => t.name === toolName);
  if (!toolExists) {
    console.error(`Unknown command: ${cliCommand}`);
    console.error(`Run 'symbiote-workspace --help' for usage.`);
    process.exit(1);
  }

  // Build args from flags
  let toolArgs = flagsToCamelCase(flags);

  // Handle positional args
  let positionalField = POSITIONAL_MAP[toolName];
  if (positionalField && positionals.length > 0) {
    if (positionalField === '_filePath') {
      // Load config from positional file path
      configFile = configFile || positionals.join(' ');
    } else {
      toolArgs[positionalField] = positionals.join(' ');
    }
  }

  // Auto-resolve --ui-path for discover commands
  if ((toolName === 'discover_components' || toolName === 'find_component' ||
       toolName === 'list_component_tags' || toolName === 'list_categories') && !toolArgs.uiPath) {
    toolArgs.uiPath = await resolveUiPath();
  }

  // Create session
  let session = createSession();

  // Load config if specified
  if (configFile) {
    try {
      await session.load(configFile);
    } catch (err) {
      // For validate/describe, load the file content directly
      if (positionalField === '_filePath') {
        let json = await readFile(resolve(configFile), 'utf-8');
        session.config = JSON.parse(json);
      } else if (err.code === 'ENOENT' && isMutating(toolName)) {
        // File doesn't exist yet — scaffold will create it
        session.configFilePath = resolve(configFile);
      } else {
        console.error(`Cannot load config: ${err.message}`);
        process.exit(1);
      }
    }
  }

  // Dispatch
  let result;
  try {
    result = await dispatch(toolName, toolArgs, session);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  let isDispatchError = result?.status === 'error';

  // Auto-save on mutations
  if (!isDispatchError && configFile && isMutating(toolName) && session.configFilePath) {
    try {
      await session.save();
    } catch (err) {
      console.error(`Warning: auto-save failed: ${err.message}`);
    }
  }

  // Output
  console.log(JSON.stringify(result, null, 2));
  if (isDispatchError) process.exitCode = 1;
}

/**
 * Try to auto-resolve symbiote-ui path.
 * @returns {Promise<string>}
 */
async function resolveUiPath() {
  let { stat } = await import('node:fs/promises');
  let candidates = [
    resolve(process.cwd(), 'node_modules/symbiote-ui'),
    resolve(process.cwd(), '../symbiote-ui'),
  ];
  for (let candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch { /* try next */ }
  }
  console.error('Cannot auto-resolve symbiote-ui path. Use --ui-path <path>');
  process.exit(1);
}

// ── Main Dispatch ──

switch (command) {
  case 'serve':
    cmdServe().catch((err) => { console.error(`Server error: ${err.message}`); process.exit(1); });
    break;
  case 'mcp':
    cmdMcp().catch((err) => { console.error(`MCP error: ${err.message}`); process.exit(1); });
    break;
  case undefined:
  case '--help':
  case '-h':
    printUsage();
    break;
  default:
    runToolCommand().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
    break;
}
