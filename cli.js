#!/usr/bin/env node

/**
 * symbiote-workspace CLI.
 *
 * Thin proxy to the dispatch registry. Tool commands are the kebab-case form
 * of the live dispatch tool names.
 *
 * @module symbiote-workspace/cli
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { TOOLS } from './runtime/index.js';

let argv = process.argv.slice(2);
let command = argv[0];

function commandForTool(toolName) {
  return toolName.replaceAll('_', '-');
}

function formatHelpRows(rows) {
  let width = rows.reduce((max, [name]) => Math.max(max, name.length), 0) + 2;
  return rows.map(([name, description]) => `  ${name.padEnd(width)}${description}`).join('\n');
}

function getToolCommandRows() {
  return TOOLS.map((tool) => [commandForTool(tool.name), tool.description]);
}

function printUsage() {
  console.log(`
symbiote-workspace CLI

Special Commands:
  serve               Start workspace HTTP server
  mcp                 Start MCP server (stdio transport)

Tool Commands:
${formatHelpRows(getToolCommandRows())}

Global Options:
  --config <file>        Load config before command, auto-save after mutating commands
  --base-revision <n>    Required for mutating commands
  --help, -h             Show this help

Examples:
  node cli.js construction-scaffold-blank --base-revision 0 --name "Draft" --config ws.json
  node cli.js module-register --config ws.json --base-revision 1 --name main --title Main --component sn-panel
  node cli.js workspace-describe --config ws.json
  node cli.js mcp
  `);
}

function parseArgs(items) {
  let flags = {};
  let positionals = [];

  for (let i = 0; i < items.length; i++) {
    let arg = items[i];
    if (arg.startsWith('--')) {
      let key = arg.slice(2);
      let next = items[i + 1];
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

function kebabToSnake(value) {
  return value.replace(/-/g, '_');
}

function flagsToCamelCase(flags) {
  let result = {};
  for (let [key, value] of Object.entries(flags)) {
    let camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

async function cmdServe() {
  let { flags } = parseArgs(argv.slice(1));
  let port = parseInt(flags.port, 10) || 3100;
  let pluginsDir = flags['plugins-dir'];
  let plugins = flags.plugins ? String(flags.plugins).split(',').map((item) => item.trim()) : [];
  let handlersDir = flags['handlers-dir'];
  let workflowFile = flags.workflow;
  let verbose = flags.verbose === true;

  let { createWorkspaceServer } = await import('./server/index.js');
  let handle = await createWorkspaceServer({
    port,
    pluginsDir,
    plugins,
    handlersDir,
    workflowFile,
    verbose,
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

const POSITIONAL_MAP = {
  construction_scaffold: 'template',
  construction_classify: 'intent',
  construction_questions_build: 'intent',
  construction_plan: 'intent',
  construction_construct: 'intent',
  config_validate: '_filePath',
  workspace_describe: '_filePath',
  preview_start: '_filePath',
  config_load: 'filePath',
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
  return (toolName === 'construction_plan' || toolName === 'construction_construct') &&
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

  let cliCommand = command;
  let toolName = kebabToSnake(cliCommand);
  let { dispatch, isMutating, TOOLS: runtimeTools, createSession } = await import('./runtime/index.js');

  let toolExists = runtimeTools.some((tool) => tool.name === toolName);
  if (!toolExists) {
    console.error(`Unknown command: ${cliCommand}`);
    console.error('Run `symbiote-workspace --help` for usage.');
    process.exit(1);
  }

  if (flags.help === true || flags.h === true) {
    printUsage();
    return;
  }

  let toolArgs = flagsToCamelCase(flags);
  let outputFile = toolName === 'construction_scaffold' ? toolArgs.output : null;
  if (toolName === 'construction_scaffold') delete toolArgs.output;

  let positionalField = POSITIONAL_MAP[toolName];
  if (positionalField && positionals.length > 0) {
    if (positionalField === '_filePath') {
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

  if ([
    'component_discover',
    'component_find',
    'component_tags_list',
    'component_categories_list',
  ].includes(toolName) && !toolArgs.uiPath) {
    toolArgs.uiPath = await resolveUiPath();
  }

  let session = createSession({ actor: 'user-direct', principal: { kind: 'human', id: 'cli' } });
  if (configFile) {
    try {
      await session.load(configFile);
    } catch (err) {
      if (positionalField === '_filePath') {
        let json = await readFile(resolve(configFile), 'utf-8');
        session.config = JSON.parse(json);
      } else if (err.code === 'ENOENT' && isMutating(toolName)) {
        session.configFilePath = resolve(configFile);
      } else {
        console.error(`Cannot load config: ${err.message}`);
        process.exit(1);
      }
    }
  }

  let result;
  try {
    result = await dispatch(toolName, toolArgs, session, { actor: 'user-direct' });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  let isDispatchError = result?.status === 'error';

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

  console.log(JSON.stringify(result, null, 2));
  if (isDispatchError) process.exitCode = 1;
}

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
    } catch {
      // Try the next candidate.
    }
  }
  console.error('Cannot auto-resolve symbiote-ui path. Use --ui-path <path>');
  process.exit(1);
}

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
