/**
 * Preview handler — dev server launch for workspace preview.
 * @module symbiote-workspace/handlers/preview
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Generate index.html for a workspace config.
 * @param {Object} config
 * @returns {string}
 */
function generateIndexHtml(config) {
  let name = config.name || 'Workspace';
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
  let configJson = JSON.stringify(config, null, 2);
  return `/**
 * Auto-generated workspace app.
 * Edit workspace.config.json and re-run preview to update.
 */

let config = ${configJson};

// Load workspace runtime
import('symbiote-workspace/browser').then(({ mountWorkspace }) => {
  mountWorkspace(config, document.body);
}).catch(() => {
  document.body.textContent = 'Error: symbiote-workspace/browser not available. Ensure symbiote-workspace is installed.';
});
`;
}

/**
 * Start a preview server for a workspace config.
 * @param {Object} config
 * @param {Object} [options]
 * @param {string} [options.outputDir] - Directory to write preview files
 * @param {number} [options.port] - Server port
 * @returns {Promise<{ url: string, outputDir: string, status: string, hint: string }>}
 */
export async function startPreview(config, options = {}) {
  let outputDir = options.outputDir || join(process.cwd(), '.workspace-preview');
  let port = options.port || 3456;

  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, 'index.html'), generateIndexHtml(config));
    await writeFile(join(outputDir, 'app.js'), generateAppJs(config));
    await writeFile(join(outputDir, 'workspace.config.json'), JSON.stringify(config, null, 2));
  } catch (err) {
    return {
      url: '',
      outputDir,
      status: 'error',
      hint: `Failed to write preview files: ${err.message}`,
    };
  }

  return {
    url: `http://localhost:${port}`,
    outputDir,
    status: 'ok',
    hint: `Preview files written to ${outputDir}. Start a dev server to view: npx serve ${outputDir} -l ${port}`,
  };
}
