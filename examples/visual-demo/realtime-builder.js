#!/usr/bin/env node

import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  startStaticServer,
  symbioteEngineRoot,
  symbioteJsRoot,
  symbioteUiRoot,
  workspacePackageRoot,
} from './server-utils.js';
import { writeRealtimeChatStateDemo } from './realtime-builder-runtime.js';

export { buildRealtimeChatStateDemo } from './realtime-builder-state.js';
export { writeRealtimeChatStateDemo } from './realtime-builder-runtime.js';

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
  let uiRoot = await symbioteUiRoot(workspaceRoot);
  let engineRoot = await symbioteEngineRoot(workspaceRoot);
  let symbioteRoot = await symbioteJsRoot(workspaceRoot);
  let outputDir = resolve(readArg('--output-dir', join(process.cwd(), 'tmp', 'realtime-builder-demo')));
  let port = Number(readArg('--port', '4567'));
  let writeOnly = hasArg('--write-only');
  let summary = await writeRealtimeChatStateDemo({ outputDir, port });

  if (writeOnly) {
    console.log(JSON.stringify({ ...summary, writeOnly }, null, 2));
    return;
  }

  await startStaticServer({ outputDir, workspaceRoot, uiRoot, engineRoot, symbioteRoot, port });
  console.log(`Symbiote realtime builder demo: ${summary.url}`);
  console.log(`Preview files: ${summary.outputDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
