import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function assertInside(root, target) {
  let rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep));
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

export function workspacePackageRoot(metaUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(metaUrl)), '../..');
}

async function readablePackageRoot(path) {
  try {
    await readFile(join(path, 'package.json'));
    return path;
  } catch {
    return null;
  }
}

export async function symbioteUiRoot(workspaceRoot) {
  let candidates = [
    resolve(workspaceRoot, '..', 'symbiote-dev-plane', 'repos', 'symbiote-ui'),
    resolve(workspaceRoot, 'node_modules', 'symbiote-ui'),
    resolve(workspaceRoot, '..', 'symbiote-ui'),
  ];
  for (let candidate of candidates) {
    let root = await readablePackageRoot(candidate);
    if (root) return root;
  }
  return candidates.at(-1);
}

export async function symbioteEngineRoot(workspaceRoot) {
  let candidates = [
    resolve(workspaceRoot, '..', 'symbiote-dev-plane', 'repos', 'symbiote-engine'),
    resolve(workspaceRoot, 'node_modules', 'symbiote-engine'),
    resolve(workspaceRoot, '..', 'symbiote-engine'),
  ];
  for (let candidate of candidates) {
    let root = await readablePackageRoot(candidate);
    if (root) return root;
  }
  return candidates.at(-1);
}

export async function symbioteJsRoot(workspaceRoot) {
  let candidates = [
    resolve(workspaceRoot, '..', 'symbiote-dev-plane', 'repos', 'symbiote-ui', 'node_modules', '@symbiotejs', 'symbiote'),
    resolve(workspaceRoot, 'node_modules', '@symbiotejs', 'symbiote'),
    resolve(workspaceRoot, '..', 'symbiote-ui', 'node_modules', '@symbiotejs', 'symbiote'),
  ];
  for (let candidate of candidates) {
    let root = await readablePackageRoot(candidate);
    if (root) return root;
  }
  return candidates[0];
}

export async function startStaticServer({ outputDir, workspaceRoot, uiRoot, engineRoot, symbioteRoot, port }) {
  let server = createServer(async (req, res) => {
    try {
      let url = new URL(req.url || '/', `http://localhost:${port}`);
      let file = url.pathname.startsWith('/__workspace__/')
        ? serveFile(workspaceRoot, '/__workspace__/', url.pathname)
        : url.pathname.startsWith('/__symbiote_ui__/')
          ? serveFile(uiRoot, '/__symbiote_ui__/', url.pathname)
          : url.pathname.startsWith('/__symbiote_engine__/')
            ? serveFile(engineRoot, '/__symbiote_engine__/', url.pathname)
            : url.pathname.startsWith('/__symbiote__/')
              ? serveFile(symbioteRoot, '/__symbiote__/', url.pathname)
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
