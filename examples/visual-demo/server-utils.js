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

function candidateFiles(file) {
  if (extname(file)) return [file];
  return [file, `${file}.js`, join(file, 'index.js')];
}

async function readServedFile(file) {
  let lastError = null;
  for (let candidate of candidateFiles(file)) {
    try {
      return {
        file: candidate,
        body: await readFile(candidate),
      };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export function workspacePackageRoot(metaUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(metaUrl)), '../..');
}

async function readablePackageRoot(path, requiredFiles = ['package.json']) {
  try {
    for (let file of requiredFiles) {
      await readFile(join(path, file));
    }
    return path;
  } catch {
    return null;
  }
}

export async function symbioteUiRoot(workspaceRoot) {
  let candidates = [
    resolve(workspaceRoot, '..', 'symbiote-dev-plane', 'repos', 'symbiote-ui'),
    resolve(workspaceRoot, '..', 'symbiote-ui'),
    resolve(workspaceRoot, 'node_modules', 'symbiote-ui'),
  ];
  for (let candidate of candidates) {
    let root = await readablePackageRoot(candidate, ['package.json', 'ui/index.js', 'board/index.js']);
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
      let served = await readServedFile(file);
      res.writeHead(200, { 'content-type': contentType(served.file) });
      res.end(served.body);
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
