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

export async function symbioteUiRoot(workspaceRoot) {
  let local = resolve(workspaceRoot, 'node_modules', 'symbiote-ui');
  try {
    await readFile(join(local, 'package.json'));
    return local;
  } catch {
    return resolve(workspaceRoot, '..', 'symbiote-ui');
  }
}

export async function startStaticServer({ outputDir, workspaceRoot, uiRoot, port }) {
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
