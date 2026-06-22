#!/usr/bin/env node

/**
 * Chat-first tool-driven construction demo.
 *
 * Constructs a workspace AROUND a persistent chat panel using only real
 * `dispatch(...)` tools, then serves a browser bundle that replays the
 * construction one tool call at a time.
 *
 * Usage:
 *   node examples/visual-demo/chat-builder.js [--write-only] [--output-dir DIR] [--port N]
 */

import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  startStaticServer,
  symbioteEngineRoot,
  symbioteJsRoot,
  symbioteUiRoot,
  workspacePackageRoot,
} from './server-utils.js';
import { writeChatBuilderDemo } from './chat-builder-runtime.js';

export { buildChatFirstWorkspace } from './chat-builder-state.js';
export { writeChatBuilderDemo } from './chat-builder-runtime.js';

function readArg(name, fallback) {
  let index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

async function main() {
  let workspaceRoot = workspacePackageRoot(import.meta.url);
  let outputDir = resolve(readArg('--output-dir', join(process.cwd(), 'tmp', 'chat-builder-demo')));
  let port = Number(readArg('--port', '4568'));
  let writeOnly = hasArg('--write-only');

  let summary = await writeChatBuilderDemo({ outputDir, port });

  if (writeOnly) {
    console.log(JSON.stringify({ ...summary, writeOnly }, null, 2));
    return;
  }

  let uiRoot = await symbioteUiRoot(workspaceRoot);
  let engineRoot = await symbioteEngineRoot(workspaceRoot);
  let symbioteRoot = await symbioteJsRoot(workspaceRoot);
  await startStaticServer({ outputDir, workspaceRoot, uiRoot, engineRoot, symbioteRoot, port });
  console.log(`Symbiote chat-first builder demo: ${summary.url}`);
  console.log(`Constructed ${summary.panels.length} panels around the chat across ${summary.stageCount} stages.`);
  console.log(`Preview files: ${summary.outputDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
