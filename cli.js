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

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { TOOLS } from './runtime/index.js';

let argv = process.argv.slice(2);
let command = argv[0];

// ── Help ──

function commandForTool(toolName) {
  return toolName.replaceAll('_', '-');
}

function formatHelpRows(rows) {
  let width = rows.reduce((max, [name]) => Math.max(max, name.length), 0) + 2;
  return rows.map(([name, description]) => {
    return `  ${name.padEnd(width)}${description}`;
  }).join('\n');
}

function getToolCommandRows() {
  return TOOLS.map((tool) => [commandForTool(tool.name), tool.description]);
}

function getAliasRows() {
  return Object.entries(COMMAND_ALIASES)
    .filter(([alias, toolName]) => alias !== commandForTool(toolName))
    .map(([alias, toolName]) => [alias, `-> ${commandForTool(toolName)}`]);
}

function printUsage() {
  console.log(`
symbiote-workspace CLI — unified dispatch for CLI and MCP

Special Commands:
  serve               Start workspace HTTP server
  mcp                 Start MCP server (stdio transport)

Tool Commands (all dispatch to unified API):
${formatHelpRows(getToolCommandRows())}

Common Aliases:
${formatHelpRows(getAliasRows())}

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

Options for 'build-construction-questions', 'plan-workspace', and 'construct-workspace':
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

Options for 'answer-construction-question':
  --questions <json-array>   Existing construction questionnaire
  --question-id <string>     Question ID to answer
  --answer <json-value>      Answer value

Options for 'export-workspace-package':
  --manifest <json-object>  Package manifest with id, name, version, description, etc.
  --strict                  Reject on validation warnings

Options for 'import-workspace-package':
  --json <string>            JSON string of the workspace package

Options for 'validate-workspace-package':
  --package <json-object>    Workspace package to validate
  --json <string>            JSON string of the workspace package

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

Options for 'workflow-kanban':
  --panel-type <id>            Portable panel type ID for the kanban board
  --board <json-object>        Kanban board model with id, columns, and cards
  --title <string>             Panel title override
  --icon <string>              Material Symbols icon name
  --layout-id <id>             Optional named layout to create or replace
  --set-default-layout         Replace the root layout with this board panel
  --group <json-object>        Optional project group to upsert
  --section <json-object>      Optional sidebar section to upsert
  --event-target <json-object> Optional drop-event target bridge fields
  --required-host-services <json-array>
                              Portable host service IDs required by this board

Examples:
  node cli.js scaffold "chat workspace" --config ws.json
  node cli.js add-group --config ws.json --id g1 --name "Editor"
  node cli.js add-section --config ws.json --groupId g1 --id s1 --label "Source"
  node cli.js register-panel-type --config ws.json --name vp --title Viewport --component sn-canvas-viewport
  node cli.js list-panel-types --config ws.json
  node cli.js describe --config ws.json
  node cli.js preview ws.json --output-dir .workspace-preview
  node cli.js mcp
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
        if (key === 'json') {
          flags[key] = next;
        } else {
          try {
            flags[key] = JSON.parse(next);
          } catch {
            flags[key] = next;
          }
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
  build_construction_questions: 'intent',
  plan_workspace: 'intent',
  construct_workspace: 'intent',
  validate_config: '_filePath',
  describe_workspace: '_filePath',
  start_preview: '_filePath',
  load_config: 'filePath',
};

function maybeParseJsonObject(value) {
  if (typeof value !== 'string') return null;
  let trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    let parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isConstructionHandoffPositional(toolName, value) {
  return (toolName === 'plan_workspace' || toolName === 'construct_workspace') &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.intent !== undefined &&
    value.options !== undefined;
}

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

  if (flags.help === true || flags.h === true) {
    printUsage();
    return;
  }

  // Build args from flags
  let toolArgs = flagsToCamelCase(flags);
  let outputFile = toolName === 'scaffold_workspace' ? toolArgs.output : null;
  if (toolName === 'scaffold_workspace') {
    delete toolArgs.output;
  }

  // Handle positional args
  let positionalField = POSITIONAL_MAP[toolName];
  if (positionalField && positionals.length > 0) {
    if (positionalField === '_filePath') {
      // Load config from positional file path
      configFile = configFile || positionals.join(' ');
    } else {
      let positionalValue = positionals.join(' ');
      let positionalObject = maybeParseJsonObject(positionals.length === 1 ? positionalValue : '');
      if (isConstructionHandoffPositional(toolName, positionalObject)) {
        toolArgs = { ...positionalObject, ...toolArgs };
      } else {
        toolArgs[positionalField] = positionalValue;
      }
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

  if (!isDispatchError && outputFile) {
    try {
      await writeFile(resolve(outputFile), `${JSON.stringify(result.config, null, 2)}\n`, 'utf-8');
    } catch (err) {
      console.error(`Warning: output write failed: ${err.message}`);
      process.exitCode = 1;
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
