#!/usr/bin/env node

import { join, resolve } from 'node:path';
import { dispatch, createSession } from '../../runtime/index.js';
import { startPreview } from '../../handlers/preview.js';
import { exportConfig, importConfig } from '../../sharing/index.js';
import {
  BROWSER_ENGINE_CONTRACTS_IMPORT,
  BROWSER_ENGINE_IMPORT,
  BROWSER_THEME_IMPORT,
} from '../../sharing/browser-contract.js';
import {
  startStaticServer,
  symbioteEngineRoot,
  symbioteJsRoot,
  symbioteUiRoot,
  workspacePackageRoot,
} from './server-utils.js';

function readArg(name, fallback) {
  let index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function dispatchMutation(toolName, args, session) {
  return dispatch(toolName, { ...args, baseRevision: session.revision ?? 0 }, session);
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object' || action.does) return action;
  if (typeof action.command === 'string' && action.command.trim()) {
    let { command, ...rest } = action;
    return {
      ...rest,
      does: { kind: 'command', command, scope: 'host' },
    };
  }
  if (typeof action.event === 'string' && action.event.trim()) {
    let { event, ...rest } = action;
    return {
      ...rest,
      does: { kind: 'emit', event },
    };
  }
  return action;
}

function normalizeModuleCapability(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || !Array.isArray(descriptor.actions)) {
    return descriptor;
  }
  return {
    ...descriptor,
    actions: descriptor.actions.map(normalizeAction),
  };
}

function normalizeConfigCapabilities(config) {
  if (!config || typeof config !== 'object' || !Array.isArray(config.components?.modules)) {
    return config;
  }
  return {
    ...config,
    components: {
      ...config.components,
      modules: config.components.modules.map(normalizeModuleCapability),
    },
  };
}

function normalizeWorkspaceTemplate(template) {
  if (!template || typeof template !== 'object') return template;
  return {
    ...template,
    config: normalizeConfigCapabilities(template.config),
  };
}

function normalizePackageContext(context) {
  return {
    ...context,
    moduleCapabilities: (context.moduleCapabilities || []).map(normalizeModuleCapability),
    workspaceTemplates: (context.workspaceTemplates || []).map(normalizeWorkspaceTemplate),
  };
}

async function buildDemoConfig() {
  let sourceSession = createSession();
  let classification = await dispatch('construction_classify', {
    intent: 'video editing studio for agentic media review',
  }, sourceSession);
  if (classification.status !== 'ok') throw new Error(classification.hint || 'Classification failed.');

  let sourceConstruct = await dispatchMutation('construction_construct', {
    intent: {
      brief: 'video editing studio for agentic media review',
      template: classification.templateName,
      targetRegister: 'media-studio',
    },
  }, sourceSession);
  if (sourceConstruct.status !== 'ok') throw new Error(sourceConstruct.hint || 'Source workspace construction failed.');

  let sourcePackage = await dispatch('pack_export', {
    manifest: {
      id: 'com.symbiote.visual-demo.video-studio',
      name: 'Symbiote Visual Demo Video Studio',
      version: '0.1.0',
    },
    strict: true,
  }, sourceSession);
  if (sourcePackage.status !== 'ok') throw new Error(sourcePackage.hint || 'Source workspace package export failed.');

  let session = createSession();
  let context = await dispatch('pack_context_create', {
    json: sourcePackage.json,
  }, session);
  if (context.status !== 'ok' || context.ready !== true) {
    throw new Error(context.hint || context.readiness?.message || 'Package construction context failed.');
  }
  context = normalizePackageContext(context);

  let handoff = await dispatch('pack_handoff_create', {
    context,
    intent: {
      brief: 'relaunch the packaged visual demo video studio',
      template: context.workspaceTemplates[0].name,
    },
  }, session);
  if (handoff.status !== 'ok') throw new Error(handoff.hint || 'Construction handoff failed.');

  let plan = await dispatch('construction_plan', handoff, session);
  if (plan.status !== 'ok') throw new Error(plan.hint || 'Workspace planning failed.');

  let construct = await dispatchMutation('construction_construct', handoff, session);
  if (construct.status !== 'ok') throw new Error(construct.hint || 'Workspace construction failed.');

  let validation = await dispatch('config_validate', { strict: true }, session);
  if ((validation.valid ?? validation.ok) !== true) {
    let messages = (validation.errors || validation.warnings || [])
      .map((error) => error.message)
      .join('; ') || 'Validation failed.';
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

let workspaceRoot = workspacePackageRoot();
let uiRoot = await symbioteUiRoot(workspaceRoot);
let engineRoot = await symbioteEngineRoot(workspaceRoot);
let symbioteRoot = await symbioteJsRoot(workspaceRoot);
let outputDir = resolve(readArg('--output-dir', join(process.cwd(), 'tmp', 'visual-demo-preview')));
let port = Number(readArg('--port', '3456'));
let writeOnly = hasArg('--write-only');
let demo = await buildDemoConfig();
let preview = await startPreview(demo.config, {
  outputDir,
  port,
  imports: {
    'symbiote-workspace/browser': '/__workspace__/browser.js',
    [BROWSER_THEME_IMPORT]: '/__symbiote_ui__/ui/index.js',
    [BROWSER_ENGINE_IMPORT]: '/__symbiote_engine__/index.js',
    [BROWSER_ENGINE_CONTRACTS_IMPORT]: '/__symbiote_engine__/contracts/index.js',
    'symbiote-engine/': '/__symbiote_engine__/',
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
  await startStaticServer({ outputDir, workspaceRoot, uiRoot, engineRoot, symbioteRoot, port });
  console.log(`Symbiote visual demo: ${summary.url}`);
  console.log(`Preview files: ${outputDir}`);
}
