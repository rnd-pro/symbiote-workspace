#!/usr/bin/env node

/**
 * symbiote-workspace CLI
 *
 * Commands:
 *   serve          Start workspace server with plugin loading
 *   validate       Validate a workspace config file
 *   plan           Generate a workspace config from intent text
 *   list-templates List available workspace templates
 *
 * Usage:
 *   npx symbiote-workspace serve --port 3100 --plugins-dir ./plugins
 *   npx symbiote-workspace validate workspace.config.json
 *   npx symbiote-workspace plan "build me a chat workspace"
 *   npx symbiote-workspace list-templates
 *
 * @module symbiote-workspace/cli
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

let args = process.argv.slice(2);
let command = args[0];

function printUsage() {
  console.log(`
symbiote-workspace CLI

Commands:
  serve             Start workspace server with plugin loading
  validate <file>   Validate a workspace config JSON file
  plan <intent>     Generate workspace config from intent text
  list-templates    List available workspace templates

Options for 'serve':
  --port <n>        Server port (default: 3100)
  --plugins-dir <p> Directory containing .plugin.js files
  --plugins <list>  Comma-separated npm package names
  --handlers-dir <p> Directory containing .handler.js files
  --workflow <f>    Path to .workflow.json file
  --verbose         Enable verbose logging

Options for 'plan':
  --name <n>        Override workspace name
  --register <r>    Override register (tool | brand | presentation)

Examples:
  npx symbiote-workspace serve --port 3100 --plugins-dir ./plugins
  npx symbiote-workspace validate my-workspace.json
  npx symbiote-workspace plan "video editor with timeline"
  npx symbiote-workspace list-templates
  `);
}

/**
 * Parse CLI flags from args array.
 * @param {string[]} argv
 * @returns {Object}
 */
function parseFlags(argv) {
  let flags = {};
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg.startsWith('--')) {
      let key = arg.slice(2);
      let next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

async function cmdServe() {
  let flags = parseFlags(args.slice(1));
  let port = parseInt(flags.port, 10) || 3100;
  let pluginsDir = flags['plugins-dir'];
  let plugins = flags.plugins ? flags.plugins.split(',').map((s) => s.trim()) : [];
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

  // Graceful shutdown
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

async function cmdValidate() {
  let filePath = args[1];
  if (!filePath) {
    console.error('Usage: symbiote-workspace validate <file.json>');
    process.exit(1);
  }

  let { validateWorkspaceConfig } = await import('./schema/index.js');

  let json;
  try {
    json = await readFile(resolve(filePath), 'utf-8');
  } catch (err) {
    console.error(`Cannot read file: ${err.message}`);
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(json);
  } catch (err) {
    console.error(`Invalid JSON: ${err.message}`);
    process.exit(1);
  }

  let result = validateWorkspaceConfig(config);

  if (result.valid) {
    console.log('✅ Valid workspace config');
    if (result.warnings?.length) {
      for (let w of result.warnings) {
        console.log(`  ⚠️  ${w.path}: ${w.message}`);
      }
    }
  } else {
    console.error('❌ Invalid workspace config:');
    for (let e of result.errors) {
      console.error(`  • ${e.path}: ${e.message}`);
    }
    process.exit(1);
  }
}

async function cmdPlan() {
  let intent = args.slice(1).filter((a) => !a.startsWith('--')).join(' ');
  if (!intent) {
    console.error('Usage: symbiote-workspace plan "your intent text"');
    process.exit(1);
  }

  let flags = parseFlags(args.slice(1));
  let { planWorkspace } = await import('./constructor/index.js');

  let options = {};
  if (flags.name) options.name = flags.name;
  if (flags.register) options.register = flags.register;

  let config = planWorkspace(intent, options);
  console.log(JSON.stringify(config, null, 2));
}

async function cmdListTemplates() {
  let { listTemplates, getTemplate } = await import('./constructor/index.js');

  let templates = listTemplates();
  console.log('Available workspace templates:\n');
  for (let name of templates) {
    let tpl = getTemplate(name);
    console.log(`  ${name} — ${tpl?.description || '(no description)'}`);
  }
}

// Dispatch
switch (command) {
  case 'serve':
    cmdServe().catch((err) => {
      console.error(`Server error: ${err.message}`);
      process.exit(1);
    });
    break;
  case 'validate':
    cmdValidate().catch((err) => {
      console.error(`Validation error: ${err.message}`);
      process.exit(1);
    });
    break;
  case 'plan':
    cmdPlan().catch((err) => {
      console.error(`Plan error: ${err.message}`);
      process.exit(1);
    });
    break;
  case 'list-templates':
    cmdListTemplates().catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
    break;
  default:
    printUsage();
    if (command && command !== '--help' && command !== '-h') {
      process.exit(1);
    }
    break;
}
