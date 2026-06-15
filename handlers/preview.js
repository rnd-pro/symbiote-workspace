/**
 * Preview handler — dev server launch for workspace preview.
 * @module symbiote-workspace/handlers/preview
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import {
  BROWSER_REQUIRED_IMPORTS,
  BROWSER_THEME_IMPORT,
  createBrowserRuntimeContract,
} from '../sharing/browser-contract.js';
import { exportConfig } from '../sharing/config-portability.js';

const PREVIEW_ERROR_SURFACES = [
  'import-map-support',
  'module-load',
  'workspace-mount',
  'loader-warnings',
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeScriptJson(value) {
  return JSON.stringify(value, null, 2).replaceAll('</script', '<\\/script');
}

function toBrowserPath(fromDir, targetPath) {
  let path = relative(fromDir, targetPath).split(sep).join('/');
  if (!path.startsWith('.')) path = `./${path}`;
  return path;
}

function outputUrl(port, outputDir, serveRoot) {
  let path = relative(serveRoot, outputDir).split(sep).join('/');
  if (!path || path.startsWith('..')) return `http://localhost:${port}`;
  return `http://localhost:${port}/${path}/`;
}

function createPreviewImports(outputDir, serveRoot, imports = {}) {
  if (isObject(imports) && Object.keys(imports).length > 0) return { ...imports };
  return {
    'symbiote-workspace/browser': toBrowserPath(outputDir, join(serveRoot, 'browser.js')),
    [BROWSER_THEME_IMPORT]: toBrowserPath(outputDir, join(serveRoot, 'node_modules', 'symbiote-ui', 'themes', 'Theme.js')),
  };
}

function isImportMapAddress(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function validatePreviewImportMap(imports) {
  let errors = [];
  if (!isObject(imports)) {
    return [{
      path: 'imports',
      message: 'Preview imports must be an object.',
    }];
  }

  for (let specifier of BROWSER_REQUIRED_IMPORTS) {
    if (!Object.hasOwn(imports, specifier)) {
      errors.push({
        path: `imports.${specifier}`,
        message: `Preview import map must define "${specifier}".`,
      });
    }
  }

  for (let [specifier, address] of Object.entries(imports)) {
    if (!isImportMapAddress(address)) {
      errors.push({
        path: `imports.${specifier}`,
        message: `Preview import "${specifier}" must map to an absolute URL or a URL starting with /, ./, or ../.`,
      });
    }
    if (specifier.endsWith('/') && typeof address === 'string' && !address.endsWith('/')) {
      errors.push({
        path: `imports.${specifier}`,
        message: `Preview import "${specifier}" ends with /, so its mapped URL must also end with /.`,
      });
    }
  }

  return errors;
}

function createPreviewContract(imports) {
  return {
    schemaVersion: '0.1.0',
    browser: createBrowserRuntimeContract({
      errorSurfaces: [...PREVIEW_ERROR_SURFACES],
    }),
    importMap: {
      imports: { ...imports },
    },
  };
}

/**
 * Generate index.html for a workspace config.
 * @param {Object} config
 * @param {Object<string, string>} imports
 * @returns {string}
 */
function generateIndexHtml(config, imports) {
  let name = escapeHtml(config.name || 'Workspace');
  let importMap = escapeScriptJson({ imports });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <link rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
    body { font-family: system-ui, sans-serif; }
  </style>
  <script type="importmap">
${importMap}
  <\/script>
</head>
<body>
  <script type="module" src="./app.js"><\/script>
</body>
</html>`;
}

/**
 * Generate app.js that materializes a workspace config.
 * @param {Object} config
 * @returns {string}
 */
function generateAppJs(config) {
  let configJson = escapeScriptJson(config);
  return `/**
 * Auto-generated workspace app.
 * Edit workspace.config.json and re-run preview to update.
 */

let config = ${configJson};

function renderPreviewError(prefix, error) {
  document.body.textContent = '';
  let message = document.createElement('pre');
  message.setAttribute('data-preview-error', 'true');
  message.textContent = \`${'${prefix}'}: ${'${error?.message || error}'}\`;
  document.body.appendChild(message);
}

function renderPreviewWarnings(loaderResult) {
  let warnings = loaderResult?.warnings || [];
  if (warnings.length === 0) return;
  let panel = document.createElement('aside');
  panel.setAttribute('data-preview-warnings', 'true');
  panel.setAttribute('aria-label', 'Workspace preview warnings');
  for (let warning of warnings) {
    let item = document.createElement('div');
    item.setAttribute('data-preview-warning', warning.path || 'workspace');
    item.textContent = warning.message || String(warning);
    panel.appendChild(item);
  }
  document.body.appendChild(panel);
}

function assertImportMapSupport() {
  let supported = typeof HTMLScriptElement !== 'undefined'
    && HTMLScriptElement.supports?.('importmap') === true;
  if (supported) return;
  throw new Error('Import maps are not supported in this browser. Preview requires <script type="importmap"> for symbiote-workspace/browser and ${BROWSER_THEME_IMPORT}.');
}

async function loadPreviewModules() {
  try {
    return await Promise.all([
      import('symbiote-workspace/browser'),
      import('${BROWSER_THEME_IMPORT}'),
    ]);
  } catch (error) {
    renderPreviewError('Failed to load preview modules', error);
    throw error;
  }
}

async function startPreview() {
  try {
    assertImportMapSupport();
  } catch (error) {
    renderPreviewError('Import map support check failed', error);
    throw error;
  }
  let [{ mountWorkspace }, { applyCascadeTheme }] = await loadPreviewModules();
  try {
    if (typeof mountWorkspace !== 'function') {
      throw new Error('symbiote-workspace/browser did not export mountWorkspace().');
    }
    if (typeof applyCascadeTheme !== 'function') {
      throw new Error('${BROWSER_THEME_IMPORT} did not export applyCascadeTheme().');
    }
    let mounted = mountWorkspace(config, document.body, {
      themeAdapter: { applyCascadeTheme },
    });
    renderPreviewWarnings(mounted.loaderResult);
  } catch (error) {
    renderPreviewError('Failed to mount workspace', error);
    throw error;
  }
}

startPreview();
`;
}

/**
 * Start a preview server for a workspace config.
 * @param {Object} config
 * @param {Object} [options]
 * @param {string} [options.outputDir] - Directory to write preview files
 * @param {number} [options.port] - Server port
 * @param {Object<string, string>} [options.imports] - Import map overrides
 * @param {string} [options.serveRoot] - Directory to serve for local preview
 * @returns {Promise<{ url: string, outputDir: string, serveRoot: string, status: string, hint: string }>}
 */
export async function startPreview(config, options = {}) {
  let outputDir = resolve(options.outputDir || join(process.cwd(), '.workspace-preview'));
  let port = options.port || 3456;
  let serveRoot = resolve(options.serveRoot || (
    isObject(options.imports) ? outputDir : process.cwd()
  ));
  let portable = exportConfig(config);
  let imports = createPreviewImports(outputDir, serveRoot, options.imports);
  let contract = createPreviewContract(imports);
  let importErrors = validatePreviewImportMap(imports);

  if (!portable.json) {
    return {
      url: '',
      outputDir,
      serveRoot,
      status: 'error',
      hint: 'Workspace config is not portable enough for preview output.',
      errors: portable.errors,
      contract,
    };
  }

  if (importErrors.length > 0) {
    return {
      url: '',
      outputDir,
      serveRoot,
      status: 'error',
      hint: 'Invalid preview import map.',
      errors: importErrors,
      contract,
    };
  }

  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, 'index.html'), generateIndexHtml(portable.config, imports));
    await writeFile(join(outputDir, 'app.js'), generateAppJs(portable.config));
    await writeFile(join(outputDir, 'workspace.config.json'), portable.json);
    await writeFile(join(outputDir, 'preview.contract.json'), JSON.stringify(contract, null, 2));
  } catch (err) {
    return {
      url: '',
      outputDir,
      serveRoot,
      status: 'error',
      hint: `Failed to write preview files: ${err.message}`,
    };
  }

  return {
    url: outputUrl(port, outputDir, serveRoot),
    outputDir,
    serveRoot,
    status: 'ok',
    hint: `Preview files written to ${outputDir}. Start a dev server to view: npx serve ${serveRoot} -l ${port}`,
    contract,
  };
}
