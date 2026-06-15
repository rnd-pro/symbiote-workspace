#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch, createSession } from '../../runtime/index.js';
import { startPreview } from '../../handlers/preview.js';
import { exportConfig, importConfig } from '../../sharing/index.js';
import { BROWSER_THEME_IMPORT } from '../../sharing/browser-contract.js';

let MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function readArg(name, fallback) {
  let index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function assertInside(root, target) {
  let rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep));
}

function workspacePackageRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

async function symbioteUiRoot(workspaceRoot) {
  let local = resolve(workspaceRoot, 'node_modules', 'symbiote-ui');
  try {
    await readFile(join(local, 'package.json'));
    return local;
  } catch {
    return resolve(workspaceRoot, '..', 'symbiote-ui');
  }
}

function contentType(path) {
  return MIME_TYPES[extname(path)] || 'application/octet-stream';
}

function serveFile(root, pathPrefix, requestPath) {
  let suffix = requestPath.slice(pathPrefix.length).replace(/^\/+/, '');
  let file = resolve(root, suffix || 'index.html');
  if (!assertInside(root, file)) return null;
  return file;
}

async function buildDemoConfig() {
  let sourceSession = createSession();
  let classification = await dispatch('classify_workspace', {
    intent: 'video editing studio for agentic media review',
  }, sourceSession);
  if (classification.status !== 'ok') throw new Error(classification.hint || 'Classification failed.');

  let sourceConstruct = await dispatch('construct_workspace', {
    intent: {
      brief: 'video editing studio for agentic media review',
      template: classification.templateName,
      targetRegister: 'media-studio',
    },
  }, sourceSession);
  if (sourceConstruct.status !== 'ok') throw new Error(sourceConstruct.hint || 'Source workspace construction failed.');

  let sourcePackage = await dispatch('export_workspace_package', {
    manifest: {
      id: 'com.symbiote.visual-demo.video-studio',
      name: 'Symbiote Visual Demo Video Studio',
      version: '0.1.0',
    },
    strict: true,
  }, sourceSession);
  if (sourcePackage.status !== 'ok') throw new Error(sourcePackage.hint || 'Source workspace package export failed.');

  let session = createSession();
  let context = await dispatch('create_workspace_package_construction_context', {
    json: sourcePackage.json,
  }, session);
  if (context.status !== 'ok' || context.ready !== true) {
    throw new Error(context.hint || context.readiness?.message || 'Package construction context failed.');
  }

  let handoff = await dispatch('create_workspace_construction_handoff', {
    context,
    intent: {
      brief: 'relaunch the packaged visual demo video studio',
      template: context.workspaceTemplates[0].name,
    },
  }, session);
  if (handoff.status !== 'ok') throw new Error(handoff.hint || 'Construction handoff failed.');

  let plan = await dispatch('plan_workspace', handoff, session);
  if (plan.status !== 'ok') throw new Error(plan.hint || 'Workspace planning failed.');

  let construct = await dispatch('construct_workspace', handoff, session);
  if (construct.status !== 'ok') throw new Error(construct.hint || 'Workspace construction failed.');

  let validation = await dispatch('validate_config', { strict: true }, session);
  if (validation.valid !== true) {
    let messages = validation.errors?.map((error) => error.message).join('; ') || 'Validation failed.';
    throw new Error(messages);
  }

  let exported = exportConfig(session.config, { strict: true });
  if (!exported.json) {
    let messages = exported.errors?.map((error) => error.message).join('; ') || 'Strict export failed.';
    throw new Error(messages);
  }

  let imported = importConfig(exported.json);
  if (!imported.config) {
    let messages = imported.errors?.map((error) => error.message).join('; ') || 'Relaunch import failed.';
    throw new Error(messages);
  }

  return {
    classification,
    context,
    handoff,
    plan,
    validation,
    config: imported.config,
  };
}

async function startStaticServer({ outputDir, workspaceRoot, uiRoot, port }) {
  let server = createServer(async (req, res) => {
    try {
      let url = new URL(req.url || '/', `http://localhost:${port}`);
      let file = url.pathname.startsWith('/__workspace__/')
        ? serveFile(workspaceRoot, '/__workspace__/', url.pathname)
        : url.pathname.startsWith('/__symbiote_ui__/')
          ? serveFile(uiRoot, '/__symbiote_ui__/', url.pathname)
          : serveFile(outputDir, '/', url.pathname);
      if (!file) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      let body = await readFile(file);
      res.writeHead(200, { 'content-type': contentType(file) });
      res.end(body);
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500);
      res.end(error.code === 'ENOENT' ? 'Not found' : error.message);
    }
  });

  await new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart);
    server.listen(port, () => {
      server.off('error', rejectStart);
      resolveStart();
    });
  });
  return server;
}

let workspaceRoot = workspacePackageRoot();
let uiRoot = await symbioteUiRoot(workspaceRoot);
let outputDir = resolve(readArg('--output-dir', join(process.cwd(), 'tmp', 'visual-demo-preview')));
let port = Number(readArg('--port', '3456'));
let writeOnly = hasArg('--write-only');
let demo = await buildDemoConfig();
let preview = await startPreview(demo.config, {
  outputDir,
  port,
  imports: {
    'symbiote-workspace/browser': '/__workspace__/browser.js',
    [BROWSER_THEME_IMPORT]: '/__symbiote_ui__/themes/Theme.js',
  },
});

if (preview.status !== 'ok') {
  let messages = preview.errors?.map((error) => error.message).join('; ') || preview.hint;
  throw new Error(messages);
}

let summary = {
  status: 'ok',
  url: `http://localhost:${port}/`,
  outputDir,
  template: demo.classification.templateName,
  packageTemplate: demo.context.workspaceTemplates[0]?.name,
  reports: demo.validation.reports?.length || 0,
  panels: Object.keys(demo.config.panelTypes || {}).length,
  writeOnly,
};

if (writeOnly) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  await startStaticServer({ outputDir, workspaceRoot, uiRoot, port });
  console.log(`Symbiote visual demo: ${summary.url}`);
  console.log(`Preview files: ${outputDir}`);
}
