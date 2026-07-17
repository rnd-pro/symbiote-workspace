#!/usr/bin/env node

import { createServer } from 'node:net';
import { createConnection } from 'node:net';
import { request } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { writeRealtimeChatStateDemo } from './realtime-builder-runtime.js';
import { startStaticServer } from './server-utils.js';

let DEFAULT_TIMEOUT = 15000;
let POLL_INTERVAL = 100;

const REALTIME_BROWSER_PACKAGES = [
  {
    name: 'symbiote-ui',
    rootKey: 'uiRoot',
    urlPrefix: '/__symbiote_ui__/',
  },
  {
    name: 'symbiote-engine',
    rootKey: 'engineRoot',
    urlPrefix: '/__symbiote_engine__/',
  },
  {
    name: '@symbiotejs/symbiote',
    rootKey: 'symbioteRoot',
    urlPrefix: '/__symbiote__/',
  },
];

function readArg(name, fallback) {
  let index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function timeoutMs() {
  return Number(readArg('--timeout', process.env.SYMBIOTE_BROWSER_SMOKE_TIMEOUT || DEFAULT_TIMEOUT));
}

function headlessMode() {
  let mode = readArg('--headless', process.env.SYMBIOTE_BROWSER_HEADLESS || 'new');
  if (!['old', 'new', 'shell'].includes(mode)) {
    throw new Error(`Unsupported browser smoke headless mode: ${mode}`);
  }
  return mode;
}

function browserDriver() {
  let driver = readArg('--driver', process.env.SYMBIOTE_BROWSER_DRIVER || 'cdp');
  if (!['cdp', 'playwright'].includes(driver)) {
    throw new Error(`Unsupported browser smoke driver: ${driver}`);
  }
  return driver;
}

function playwrightBrowserName() {
  let name = readArg('--playwright-browser', process.env.SYMBIOTE_PLAYWRIGHT_BROWSER || 'webkit');
  if (!['chromium', 'firefox', 'webkit'].includes(name)) {
    throw new Error(`Unsupported Playwright browser: ${name}`);
  }
  return name;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function scriptDir() {
  return dirname(fileURLToPath(import.meta.url));
}

function browserExportTarget(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (let candidate of value) {
      let target = browserExportTarget(candidate);
      if (target) return target;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (let condition of ['browser', 'import', 'default']) {
    let target = browserExportTarget(value[condition]);
    if (target) return target;
  }
  return null;
}

function packageExportEntries(meta) {
  if (!meta.exports) {
    return [['.', meta.module || meta.main || './index.js']];
  }
  if (typeof meta.exports === 'string' || Array.isArray(meta.exports)) {
    return [['.', meta.exports]];
  }
  let keys = Object.keys(meta.exports);
  if (keys.some((key) => key.startsWith('.'))) return Object.entries(meta.exports);
  return [['.', meta.exports]];
}

function packageImportKey(packageName, exportKey) {
  if (exportKey === '.') return packageName;
  if (!exportKey.startsWith('./')) {
    throw new Error(`Invalid export key "${exportKey}" in installed package "${packageName}".`);
  }
  return `${packageName}/${exportKey.slice(2)}`;
}

function packageImportUrl(packageName, urlPrefix, exportTarget) {
  if (!exportTarget.startsWith('./')) {
    throw new Error(
      `Installed package "${packageName}" has a non-local browser export: ${exportTarget}`
    );
  }
  let path = exportTarget.slice(2);
  if (path === '..' || path.startsWith('../') || path.includes('/../')) {
    throw new Error(
      `Installed package "${packageName}" has an out-of-root browser export: ${exportTarget}`
    );
  }
  return `${urlPrefix}${path}`;
}

export function browserPackageImports(meta, urlPrefix) {
  if (!meta?.name || !urlPrefix?.startsWith('/') || !urlPrefix.endsWith('/')) {
    throw new Error('Browser package imports require a package name and an absolute URL prefix.');
  }
  let imports = {
    [`${meta.name}/`]: urlPrefix,
  };
  for (let [exportKey, value] of packageExportEntries(meta)) {
    let exportTarget = browserExportTarget(value);
    if (!exportTarget) continue;
    let importKey = packageImportKey(meta.name, exportKey);
    let importUrl = packageImportUrl(meta.name, urlPrefix, exportTarget);
    let keyWildcard = importKey.endsWith('*');
    let urlWildcard = importUrl.endsWith('*');
    if (keyWildcard !== urlWildcard) {
      throw new Error(
        `Installed package "${meta.name}" has an unsupported browser export pattern: ${exportKey}`
      );
    }
    if (keyWildcard) {
      importKey = importKey.slice(0, -1);
      importUrl = importUrl.slice(0, -1);
    } else if (importKey.includes('*') || importUrl.includes('*')) {
      throw new Error(
        `Installed package "${meta.name}" has an unsupported browser export pattern: ${exportKey}`
      );
    }
    imports[importKey] = importUrl;
  }
  return imports;
}

export async function resolveInstalledPackage(packageName) {
  let entryUrl;
  try {
    entryUrl = import.meta.resolve(packageName);
  } catch (error) {
    throw new Error(
      `Unable to resolve installed browser package "${packageName}" from symbiote-workspace.`,
      { cause: error }
    );
  }

  let dir = dirname(fileURLToPath(entryUrl));
  while (true) {
    let metaPath = join(dir, 'package.json');
    try {
      let meta = JSON.parse(await readFile(metaPath, 'utf8'));
      if (meta.name === packageName) return { meta, root: dir };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Unable to read installed package metadata for "${packageName}".`, {
          cause: error,
        });
      }
    }
    let parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Unable to locate the installed package root for "${packageName}".`);
}

export async function resolveRealtimeBrowserHost() {
  let workspaceRoot = resolve(scriptDir(), '../..');
  let resolvedPackages = await Promise.all(
    REALTIME_BROWSER_PACKAGES.map(({ name }) => resolveInstalledPackage(name))
  );
  let host = {
    imports: {
      'symbiote-workspace/browser': '/__workspace__/browser.js',
    },
    packages: {},
    workspaceRoot,
  };
  for (let [index, descriptor] of REALTIME_BROWSER_PACKAGES.entries()) {
    let resolvedPackage = resolvedPackages[index];
    host[descriptor.rootKey] = resolvedPackage.root;
    host.packages[descriptor.name] = {
      root: resolvedPackage.root,
      version: resolvedPackage.meta.version,
    };
    Object.assign(
      host.imports,
      browserPackageImports(resolvedPackage.meta, descriptor.urlPrefix)
    );
  }
  return host;
}

export function replaceBrowserImportMap(html, imports) {
  let marker = '<script type="importmap">';
  let start = html.indexOf(marker);
  if (start === -1) {
    throw new Error('Realtime builder output is missing its browser import map.');
  }
  let contentStart = start + marker.length;
  let end = html.indexOf('</script>', contentStart);
  if (end === -1) {
    throw new Error('Realtime builder output has an unterminated browser import map.');
  }
  if (html.indexOf(marker, contentStart) !== -1) {
    throw new Error('Realtime builder output contains more than one browser import map.');
  }

  let current;
  try {
    current = JSON.parse(html.slice(contentStart, end));
  } catch (error) {
    throw new Error('Realtime builder output contains an invalid browser import map.', {
      cause: error,
    });
  }
  let replacement = JSON.stringify({ ...current, imports }, null, 2);
  return `${html.slice(0, contentStart)}\n${replacement}\n${html.slice(end)}`;
}

export async function startRealtimeBrowserPreview({ outputDir, port }) {
  let host = await resolveRealtimeBrowserHost();
  let summary = await writeRealtimeChatStateDemo({ outputDir, port });
  let htmlPath = join(outputDir, 'index.html');
  let html = await readFile(htmlPath, 'utf8');
  await writeFile(htmlPath, replaceBrowserImportMap(html, host.imports));
  let server = await startStaticServer({
    outputDir,
    workspaceRoot: host.workspaceRoot,
    uiRoot: host.uiRoot,
    engineRoot: host.engineRoot,
    symbioteRoot: host.symbioteRoot,
    port,
  });
  return { host, server, summary };
}

async function pathExists(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function browserCacheCandidates() {
  let home = process.env.HOME || '';
  if (!home) return [];
  let roots = [
    join(home, '.cache/symbiote-ui-browsers/chrome'),
    join(home, '.cache/puppeteer/chrome'),
  ];
  let candidates = [];
  for (let root of roots) {
    let entries = [];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (let entry of entries
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .sort((left, right) => right.localeCompare(left, undefined, {
        numeric: true,
        sensitivity: 'base',
      }))) {
      let base = join(root, entry);
      candidates.push(
        join(base, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        join(base, 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        join(base, 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'),
        join(base, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium')
      );
    }
  }
  return candidates;
}

async function findBrowser() {
  let explicit = readArg('--browser', process.env.SYMBIOTE_BROWSER_BIN || '');
  if (explicit) {
    if (await pathExists(explicit)) return explicit;
    throw new Error(`Browser executable is not accessible: ${explicit}`);
  }

  let candidates = [
    ...await browserCacheCandidates(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
    join(process.env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    join(process.env.HOME || '', 'Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'),
  ];

  for (let candidate of candidates) {
    if (candidate && await pathExists(candidate)) return candidate;
  }

  throw new Error('No Chrome-compatible browser found. Set SYMBIOTE_BROWSER_BIN or pass --browser.');
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    let server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      let port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
}

function spawnProcess(command, args, options = {}) {
  let child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => {
    child.output.stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    child.output.stderr += chunk;
  });
  return child;
}

function killProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 2000).unref();
}

function waitForProcessExit(child, timeout = 5000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveWait) => {
    let timer = setTimeout(resolveWait, timeout);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveWait();
    });
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}

async function removeTempDir(path) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(100 * (attempt + 1));
    }
  }
  throw lastError;
}

function demoCommand(demo) {
  if (demo === 'realtime-builder') {
    return {
      script: 'realtime-builder.js',
      readyText: 'Symbiote realtime builder demo:',
    };
  }
  return {
    script: 'preview.js',
    readyText: 'Symbiote visual demo:',
  };
}

async function waitForPreview(child, timeout, readyText) {
  let deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Visual demo server exited early: ${child.output.stderr || child.output.stdout}`);
    }
    if (child.output.stdout.includes(readyText)) return;
    await delay(POLL_INTERVAL);
  }
  throw new Error(`Timed out waiting for visual demo server. stderr: ${child.output.stderr}`);
}

function httpJson(method, port, path, timeout) {
  return new Promise((resolveJson, rejectJson) => {
    let req = request({
      host: '127.0.0.1',
      method,
      path,
      port,
      timeout,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          rejectJson(new Error(`CDP HTTP ${method} ${path} returned ${res.statusCode}: ${body}`));
          return;
        }
        try {
          resolveJson(JSON.parse(body));
        } catch (error) {
          rejectJson(error);
        }
      });
    });
    req.on('error', rejectJson);
    req.on('timeout', () => {
      req.destroy(new Error(`CDP HTTP ${method} ${path} timed out.`));
    });
    req.end();
  });
}

async function waitForCdp(port, timeout, browserProcess = null) {
  let deadline = Date.now() + timeout;
  let lastError = null;
  let requestTimeout = Math.min(3000, Math.max(1000, timeout));
  while (Date.now() < deadline) {
    try {
      return await httpJson('GET', port, '/json/version', requestTimeout);
    } catch (error) {
      lastError = error;
      if (browserProcess?.exitCode !== null) {
        throw new Error(
          `Browser exited before Chrome DevTools Protocol was available: exit code ${browserProcess.exitCode}`
        );
      }
      await delay(POLL_INTERVAL);
    }
  }
  throw new Error(`Timed out waiting for Chrome DevTools Protocol: ${lastError?.message || 'no response'}`);
}

async function readDevToolsActivePort(profileDir, timeout, browserProcess = null) {
  let deadline = Date.now() + timeout;
  let portFile = join(profileDir, 'DevToolsActivePort');
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      let text = await readFile(portFile, 'utf8');
      let [portLine] = text.trim().split(/\r?\n/);
      let port = Number(portLine);
      if (Number.isInteger(port) && port > 0) return port;
      lastError = new Error(`Invalid DevToolsActivePort content: ${JSON.stringify(text)}`);
    } catch (error) {
      lastError = error;
    }
    if (browserProcess?.exitCode !== null) {
      throw new Error(
        `Browser exited before Chrome wrote DevToolsActivePort: exit code ${browserProcess.exitCode}`
      );
    }
    await delay(POLL_INTERVAL);
  }
  throw new Error(`Timed out waiting for DevToolsActivePort: ${lastError?.message || 'no response'}`);
}

async function createCdpTarget(port, url, timeout = 10000) {
  let path = `/json/new?${encodeURIComponent(url)}`;
  let requestTimeout = Math.min(15000, Math.max(3000, timeout));
  try {
    return await httpJson('PUT', port, path, requestTimeout);
  } catch {
    return httpJson('GET', port, path, requestTimeout);
  }
}

class CdpWebSocket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.listeners = new Map();
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (error) => this.rejectAll(error));
    socket.on('close', () => this.rejectAll(new Error('CDP WebSocket closed.')));
  }

  static connect(url, timeout = DEFAULT_TIMEOUT) {
    let parsed = new URL(url);
    let key = randomBytes(16).toString('base64');
    return new Promise((resolveSocket, rejectSocket) => {
      let socket = createConnection(Number(parsed.port), parsed.hostname);
      let chunks = [];
      let settled = false;
      let timer = setTimeout(() => {
        fail(new Error('Timed out opening CDP WebSocket.'));
      }, timeout);

      function fail(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        rejectSocket(error);
      }

      socket.once('error', fail);
      socket.once('connect', () => {
        socket.write([
          `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
          `Host: ${parsed.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'));
      });
      socket.on('data', function handshake(chunk) {
        chunks.push(chunk);
        let response = Buffer.concat(chunks);
        let headerEnd = response.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        socket.off('data', handshake);
        let headers = response.slice(0, headerEnd).toString('utf8');
        let accept = createHash('sha1')
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest('base64');
        if (!headers.startsWith('HTTP/1.1 101') || !headers.includes(`Sec-WebSocket-Accept: ${accept}`)) {
          fail(new Error(`Invalid CDP WebSocket handshake: ${headers}`));
          return;
        }
        settled = true;
        clearTimeout(timer);
        let client = new CdpWebSocket(socket);
        let rest = response.slice(headerEnd + 4);
        if (rest.length > 0) client.onData(rest);
        resolveSocket(client);
      });
    });
  }

  rejectAll(error) {
    for (let pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      let first = this.buffer[0];
      let second = this.buffer[1];
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        length = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }
      let masked = Boolean(second & 0x80);
      let maskOffset = masked ? 4 : 0;
      if (this.buffer.length < offset + maskOffset + length) return;
      let mask = masked ? this.buffer.slice(offset, offset + 4) : null;
      offset += maskOffset;
      let payload = this.buffer.slice(offset, offset + length);
      this.buffer = this.buffer.slice(offset + length);
      if (mask) {
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
      }
      let opcode = first & 0x0f;
      if (opcode === 1) this.onMessage(payload.toString('utf8'));
      if (opcode === 8) this.socket.end();
      if (opcode === 9) this.writeFrame(10, payload);
    }
  }

  onMessage(text) {
    let message = JSON.parse(text);
    if (message.id && this.pending.has(message.id)) {
      let pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (message.method && this.events.has(message.method)) {
      for (let resolveEvent of this.events.get(message.method)) resolveEvent(message.params || {});
      this.events.delete(message.method);
    }
    if (message.method && this.listeners.has(message.method)) {
      for (let listener of this.listeners.get(message.method)) listener(message.params || {});
    }
  }

  writeFrame(opcode, payload) {
    let body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    let headerLength = body.length < 126 ? 2 : body.length < 65536 ? 4 : 10;
    let header = Buffer.alloc(headerLength + 4);
    header[0] = 0x80 | opcode;
    if (body.length < 126) {
      header[1] = 0x80 | body.length;
      headerLength = 2;
    } else if (body.length < 65536) {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(body.length, 2);
      headerLength = 4;
    } else {
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(body.length), 2);
      headerLength = 10;
    }
    let mask = randomBytes(4);
    mask.copy(header, headerLength);
    let masked = Buffer.from(body.map((byte, index) => byte ^ mask[index % 4]));
    this.socket.write(Buffer.concat([header, masked]));
  }

  send(method, params = {}, timeout = DEFAULT_TIMEOUT, sessionId = '') {
    let id = this.nextId++;
    this.writeFrame(1, JSON.stringify({
      id,
      method,
      params,
      ...(sessionId ? { sessionId } : {}),
    }));
    return new Promise((resolveSend, rejectSend) => {
      let timer = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new Error(`Timed out waiting for CDP command ${method}.`));
      }, timeout);
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
    });
  }

  waitEvent(method, timeout) {
    return new Promise((resolveEvent, rejectEvent) => {
      let waiters = this.events.get(method) || [];
      let timer = setTimeout(() => {
        this.events.set(method, waiters.filter((waiter) => waiter !== wrapped));
        rejectEvent(new Error(`Timed out waiting for CDP event ${method}.`));
      }, timeout);
      let wrapped = (params) => {
        clearTimeout(timer);
        resolveEvent(params);
      };
      waiters.push(wrapped);
      this.events.set(method, waiters);
    });
  }

  onEvent(method, listener) {
    let listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.writeFrame(8, Buffer.alloc(0));
    this.socket.end();
  }
}

async function connectCdpWebSocket(url, timeout = DEFAULT_TIMEOUT) {
  let deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await CdpWebSocket.connect(url, Math.min(3000, Math.max(500, deadline - Date.now())));
    } catch (error) {
      lastError = error;
      await delay(POLL_INTERVAL);
    }
  }
  throw lastError || new Error('Timed out opening CDP WebSocket.');
}

function remoteValuePreview(value = {}) {
  if ('value' in value) return String(value.value);
  return value.description || value.unserializableValue || value.type || '';
}

function exceptionPreview(exceptionDetails = {}) {
  return exceptionDetails.exception?.description
    || exceptionDetails.exception?.value
    || exceptionDetails.text
    || 'Unknown browser exception';
}

function createPageDiagnostics(cdp) {
  let diagnostics = {
    exceptions: [],
    console: [],
    failedRequests: [],
    badResponses: [],
  };
  cdp.onEvent('Runtime.exceptionThrown', (params) => {
    diagnostics.exceptions.push(exceptionPreview(params.exceptionDetails));
  });
  cdp.onEvent('Runtime.consoleAPICalled', (params) => {
    diagnostics.console.push({
      type: params.type || 'log',
      text: (params.args || []).map(remoteValuePreview).filter(Boolean).join(' '),
    });
  });
  cdp.onEvent('Network.loadingFailed', (params) => {
    diagnostics.failedRequests.push({
      type: params.type || 'unknown',
      errorText: params.errorText || 'unknown network failure',
      canceled: Boolean(params.canceled),
    });
  });
  cdp.onEvent('Network.responseReceived', (params) => {
    let response = params.response || {};
    let status = Number(response.status);
    if (Number.isFinite(status) && status >= 400) {
      diagnostics.badResponses.push({
        type: params.type || 'unknown',
        status,
        url: response.url || '',
        mimeType: response.mimeType || '',
      });
    }
  });
  return diagnostics;
}

function formatPageDiagnostics(diagnostics = {}) {
  let lines = [];
  if (diagnostics.exceptions?.length) {
    lines.push(`Browser exceptions:\n${diagnostics.exceptions.slice(-5).join('\n---\n')}`);
  }
  let consoleErrors = (diagnostics.console || [])
    .filter((item) => ['error', 'warning', 'assert'].includes(item.type) && item.text)
    .slice(-8)
    .map((item) => `[${item.type}] ${item.text}`);
  if (consoleErrors.length) {
    lines.push(`Browser console:\n${consoleErrors.join('\n')}`);
  }
  if (diagnostics.badResponses?.length) {
    lines.push(`Network bad responses:\n${diagnostics.badResponses.slice(-8).map((item) => (
      `[${item.type}] ${item.status} ${item.url} ${item.mimeType}`
    )).join('\n')}`);
  }
  if (diagnostics.failedRequests?.length) {
    lines.push(`Network failures:\n${diagnostics.failedRequests.slice(-8).map((item) => (
      `[${item.type}] ${item.errorText}${item.canceled ? ' canceled' : ''}`
    )).join('\n')}`);
  }
  return lines.join('\n\n');
}

function createPlaywrightDiagnostics(page) {
  let diagnostics = {
    exceptions: [],
    console: [],
    failedRequests: [],
    badResponses: [],
  };
  page.on('pageerror', (error) => {
    diagnostics.exceptions.push(error.stack || error.message || String(error));
  });
  page.on('console', (message) => {
    diagnostics.console.push({
      type: message.type(),
      text: message.text(),
    });
  });
  page.on('requestfailed', (request) => {
    diagnostics.failedRequests.push({
      type: request.resourceType(),
      errorText: request.failure()?.errorText || 'unknown network failure',
      canceled: false,
    });
  });
  page.on('response', (response) => {
    let status = response.status();
    if (status >= 400) {
      diagnostics.badResponses.push({
        type: response.request().resourceType(),
        status,
        url: response.url(),
        mimeType: response.headers()['content-type'] || '',
      });
    }
  });
  return diagnostics;
}

async function runPlaywrightSmoke({ demo, url, expression, timeout }) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error(
      'Playwright browser smoke driver requires dev dependency `playwright`. '
      + 'Run `npm install` and `npx playwright install webkit`, or use `--driver cdp`.'
    );
  }
  let browserName = playwrightBrowserName();
  let browserType = playwright[browserName];
  if (!browserType?.launch) {
    throw new Error(`Playwright browser is unavailable: ${browserName}`);
  }
  let browser = null;
  try {
    browser = await browserType.launch({ headless: true, timeout });
    let page = await browser.newPage();
    let diagnostics = createPlaywrightDiagnostics(page);
    try {
      await page.goto(url, { waitUntil: 'load', timeout });
      let value = await page.evaluate((source) => globalThis.eval(source), expression);
      return { browserName, value };
    } catch (error) {
      let diagnosticsText = formatPageDiagnostics(diagnostics);
      throw new Error([error.message, diagnosticsText].filter(Boolean).join('\n\n'));
    }
  } catch (error) {
    throw new Error([
      `Playwright ${browserName} smoke failed for ${demo}.`,
      error.message,
    ].filter(Boolean).join('\n'));
  } finally {
    if (browser) await browser.close();
  }
}

let mountExpression = `
new Promise((resolve, reject) => {
  let deadline = Date.now() + 10000;
  let check = () => {
    let error = document.querySelector('[data-preview-error]');
    if (error) {
      reject(new Error(error.textContent || 'Preview rendered data-preview-error.'));
      return;
    }
    let workspace = document.querySelector('[data-workspace-name]');
    let panels = [...document.querySelectorAll('[data-panel-type]').values()].map((panel) => panel.dataset.panelType);
    if (workspace && panels.length >= 4) {
      resolve({
        title: document.title,
        workspaceName: workspace.dataset.workspaceName,
        workspaceVersion: workspace.dataset.workspaceVersion,
        panelTypes: panels,
        warnings: [...document.querySelectorAll('[data-preview-warning]')].map((warning) => warning.textContent),
      });
      return;
    }
    if (Date.now() > deadline) {
      reject(new Error('Preview did not mount expected workspace and panel DOM.'));
      return;
    }
    setTimeout(check, 100);
  };
  check();
})
`;

let realtimeExpression = `
new Promise((resolve, reject) => {
  let deadline = Date.now() + 30000;
  let clickedPlay = false;
  let initialHistoryLength = history.length;
  let initialLocationHref = location.href;
  let atomicStageCounts = {};
  let scenarioUpdateCounts = {};
  let initialAssemblyEvidence = null;
  let scenarioDataProofEvidence = {};
  let scenarioProviderDefinitionEvidence = {};
  let assemblySamples = [];
  let previousAssemblyState = null;
  let phaseOrder = {
    layout: 0,
    modules: 1,
    data: 2,
    theme: 3,
  };
  let expectedAtomicStages = [
    'workspace-name',
    'target-register',
    'layout-topology',
    'module-selection',
    'execution-model',
    'required-host-services',
    'theme-mode',
    'theme-hue',
    'verification-scope',
  ];
  let expectedScenarioIds = [
    'video-editing',
    'automation-editing',
    'agent-programming',
    'constructor-control',
  ];
  let scenarioSwitchOrder = [
    'automation-editing',
    'agent-programming',
    'constructor-control',
  ];
  let scenarioComponents = {
    'video-editing': [
      'chat-workspace',
      'sn-video-player',
      'sn-timeline',
      'node-canvas',
      'canvas-graph',
      'inspector-panel',
    ],
    'automation-editing': [
      'chat-workspace',
      'node-canvas',
      'sn-data-table',
      'sn-rich-text-editor',
      'sn-kanban-board',
      'sn-timeline',
      'sn-file-upload',
    ],
    'agent-programming': [
      'chat-workspace',
      'sn-tree-panel',
      'source-editor',
      'sn-source-diff',
      'code-block',
      'sn-event-feed',
      'node-canvas',
      'canvas-graph',
    ],
    'constructor-control': [
      'layout-shell-menu',
      'project-tabs',
      'palette-browser',
      'panel-layout',
      'inspector-panel',
      'cascade-theme-editor',
      'sn-menu',
    ],
  };
  let scenarioDataProofs = {
    'video-editing': [
      { selector: 'sn-video-player[data-demo-hydrated="preview"]', tokens: ['Launch cut', 'Scene 03'] },
      { selector: 'sn-timeline[data-demo-hydrated="timeline"]', tokens: ['Product shot', 'Music bed'] },
      { selector: 'node-canvas[data-demo-hydrated="effects"]', tokens: ['Source', 'Grade'] },
      { selector: 'canvas-graph[data-demo-hydrated="overview"]', tokens: ['Render'] },
    ],
    'automation-editing': [
      { selector: 'node-canvas[data-demo-hydrated="workflow"]', tokens: ['Trigger', 'Classify'] },
      { selector: 'sn-data-table[data-demo-hydrated="queue"]', tokens: ['LinkedIn', 'pricing'] },
      { selector: 'sn-rich-text-editor[data-demo-hydrated="reply"]', tokens: ['tracked approval gate'] },
      { selector: 'sn-kanban-board[data-demo-hydrated="approvals"]', tokens: ['Pricing reply', 'Support escalation'] },
      { selector: 'sn-timeline[data-demo-hydrated="history"]', tokens: ['Queue item classified'] },
    ],
    'agent-programming': [
      { selector: 'sn-tree-panel[data-demo-hydrated="files"]', tokens: ['runtime.js'] },
      { selector: 'source-editor[data-demo-hydrated="source"]', tokens: ['applyPatch', 'mergeWorkspaceConfig'] },
      { selector: 'sn-source-diff[data-demo-hydrated="diff"]', tokens: ['validateWorkspacePatch'] },
      { selector: 'code-block[data-demo-hydrated="code"]', tokens: ['node --test', 'pass 42'] },
      { selector: 'sn-event-feed[data-demo-hydrated="activity"]', tokens: ['Plan accepted', 'Diff ready'] },
    ],
    'constructor-control': [
      { selector: 'layout-shell-menu[data-demo-hydrated="templates"]', tokens: ['video-studio', 'agent-workspace'] },
      { selector: 'project-tabs[data-demo-hydrated="tabs"]', tokens: ['Video Studio', 'Agent Programming'] },
      { selector: 'palette-browser[data-demo-hydrated="palette"]', tokens: ['chat-workspace', 'cascade-theme-editor', 'sn-kanban-board'] },
      { selector: 'panel-layout[data-demo-hydrated="layout"]', tokens: ['agent-chat', 'theme-editor'] },
      { selector: 'inspector-panel[data-demo-hydrated="inspector"]', tokens: ['Plan', 'agent/plan'] },
      { selector: 'sn-menu[data-demo-hydrated="menu"]', tokens: ['Load existing config', 'Export workspace'] },
    ],
  };
  let queryState = () => {
    let shell = document.querySelector('.demo-shell');
    let workspace = document.querySelector('.demo-workspace');
    let layout = workspace?.querySelector('panel-layout');
    let mountedWorkspace = workspace?.querySelector('.symbiote-workspace');
    let runtimeInstanceId = layout?.dataset.runtimeInstanceId
      || mountedWorkspace?.dataset.runtimeInstanceId
      || workspace?.dataset.runtimeInstanceId
      || '';
    let updateCount = Number(
      layout?.dataset.atomicUpdateCount
      || mountedWorkspace?.dataset.atomicUpdateCount
      || workspace?.dataset.atomicUpdateCount
      || '0'
    );
    let lastUpdatedStage = mountedWorkspace?.dataset.lastUpdatedStage
      || workspace?.dataset.lastUpdatedStage
      || '';
    return { shell, workspace, layout, mountedWorkspace, runtimeInstanceId, updateCount, lastUpdatedStage };
  };
  let hasScenarioComponents = (scenarioId) => (
    (scenarioComponents[scenarioId] || []).every((selector) => document.querySelector(selector))
  );
  let scenarioProviderDefinitionState = (scenarioId) => (
    (scenarioComponents[scenarioId] || []).map((tagName) => ({
      tagName,
      present: Boolean(document.querySelector(tagName)),
      defined: Boolean(customElements.get(tagName)),
    }))
  );
  let scenarioProvidersDefined = (scenarioId) => {
    let definitions = scenarioProviderDefinitionState(scenarioId);
    scenarioProviderDefinitionEvidence[scenarioId] = definitions;
    return definitions.length > 0 && definitions.every((item) => item.present && item.defined);
  };
  let readElementProof = (element) => [
    element?.getAttribute?.('data-demo-proof') || '',
    element?.textContent || '',
    element?.shadowRoot?.textContent || '',
  ].join(' ');
  let scenarioDataProofState = (scenarioId) => (
    (scenarioDataProofs[scenarioId] || []).map((requirement) => {
      let element = document.querySelector(requirement.selector);
      let proof = readElementProof(element);
      return {
        selector: requirement.selector,
        tokens: requirement.tokens,
        hydrated: Boolean(element),
        matched: Boolean(element) && requirement.tokens.every((token) => proof.includes(token)),
      };
    })
  );
  let scenarioDataProofReady = (scenarioId) => {
    let proof = scenarioDataProofState(scenarioId);
    scenarioDataProofEvidence[scenarioId] = proof;
    return proof.length > 0 && proof.every((item) => item.matched);
  };
  let mountedPanelTypes = () => {
    let panelTypes = [
      ...[...document.querySelectorAll('[data-module]')].map((element) => element.dataset.module),
      ...[...document.querySelectorAll('[data-panel-type]')].map((element) => element.dataset.panelType),
      ...[...document.querySelectorAll('layout-node[node-type="panel"]')].map((element) => (
        element.dataset.panelType || element.$?.panelType
      )),
    ].filter(Boolean);
    return [...new Set(panelTypes)];
  };
  let findScenarioTab = (scenarioId) => (
    [...document.querySelectorAll('project-tab-item')].find((tab) => (
      tab.dataset.scenarioTabId === scenarioId || tab.$?.id === scenarioId
    ))
  );
  let scenarioRailReady = () => (
    Boolean(document.querySelector('layout-shell-menu project-tabs')) &&
    Boolean(document.querySelector('layout-shell-menu layout-sidebar')) &&
    expectedScenarioIds.every((scenarioId) => findScenarioTab(scenarioId))
  );
  let sidebarSectionIds = () => (
    [...document.querySelectorAll('layout-sidebar sidebar-section')]
      .map((section) => section.dataset.sectionId || section.$?.sectionId || '')
      .filter(Boolean)
  );
  let sidebarContextReady = (scenarioId) => {
    let ids = sidebarSectionIds();
    return ids.length >= 3 &&
      ids.every((id) => id.startsWith(scenarioId + ':')) &&
      expectedScenarioIds.every((id) => !ids.includes(id));
  };
  let switchScenario = (scenarioId) => {
    let button = findScenarioTab(scenarioId);
    if (!button) return false;
    button.click();
    return true;
  };
  let currentScenarioReady = (scenarioId, state = queryState()) => (
    state.shell?.dataset.scenarioId === scenarioId &&
    state.workspace?.dataset.professionalScenario === scenarioId &&
    hasScenarioComponents(scenarioId) &&
    scenarioProvidersDefined(scenarioId) &&
    scenarioDataProofReady(scenarioId) &&
    sidebarContextReady(scenarioId)
  );
  let readAssemblyState = (shell) => ({
    phase: shell?.dataset.assemblyPhase || '',
    phaseIndex: phaseOrder[shell?.dataset.assemblyPhase || ''] ?? -1,
    visible: Number(shell?.dataset.visibleScenarioPanelCount || '0'),
    mounted: Number(shell?.dataset.mountedScenarioPanelCount || '0'),
    hydrated: Number(shell?.dataset.hydratedScenarioPanelCount || '0'),
    stage: shell?.dataset.stage || '',
    buildKind: shell?.dataset.buildKind || '',
  });
  let recordAssemblyState = (shell) => {
    let next = readAssemblyState(shell);
    if (previousAssemblyState) {
      let monotonic =
        next.phaseIndex >= previousAssemblyState.phaseIndex &&
        next.visible >= previousAssemblyState.visible &&
        next.mounted >= previousAssemblyState.mounted &&
        next.hydrated >= previousAssemblyState.hydrated;
      if (!monotonic) {
        rejectWithDebug('Realtime builder UI assembly moved backward.', {
          previousAssemblyState,
          nextAssemblyState: next,
          assemblySamples,
        });
        return false;
      }
    }
    let lastSample = assemblySamples.at(-1);
    if (
      !lastSample ||
      lastSample.phase !== next.phase ||
      lastSample.visible !== next.visible ||
      lastSample.mounted !== next.mounted ||
      lastSample.hydrated !== next.hydrated
    ) {
      assemblySamples.push(next);
    }
    previousAssemblyState = next;
    return true;
  };
  let rejectWithDebug = (message, debugState = {}) => {
    reject(new Error([
      message,
      'readyState=' + document.readyState,
      'debug=' + JSON.stringify(debugState),
      'body=' + (document.body?.innerHTML || '').slice(0, 800),
    ].join('\\n')));
  };
  let finishWithMobileCheck = (baseState, playProgress) => {
    let mobile = document.querySelector('[data-viewport-mode="mobile"]');
    if (!mobile) {
      reject(new Error('Realtime builder mobile adaptive preview button is missing.'));
      return;
    }
    let preMobileState = queryState();
    mobile.click();
    let checkMobile = () => {
      try {
      let mobileState = queryState();
      let mobileShell = mobileState.shell;
      let dockedPanels = mobileShell?.dataset.dockedPanels || '';
      let collapsedPanels = mobileShell?.dataset.collapsedPanels || '';
      let adaptivePanel = document.querySelector('[data-adaptive-state]');
      let mobileLayoutIdentityPreserved = Boolean(preMobileState.layout && preMobileState.layout === mobileState.layout);
      let mobileWorkspaceIdentityPreserved = Boolean(
        preMobileState.mountedWorkspace && preMobileState.mountedWorkspace === mobileState.mountedWorkspace
      );
      let mobileScenarioReady = currentScenarioReady('constructor-control', mobileState);
      let themeEvidence = mobileShell?.dataset.themeMode === 'dark' &&
        mobileShell?.dataset.themeEditorState === 'validated' &&
        mobileShell?.dataset.adaptiveMode === 'drawer' &&
        Boolean(document.querySelector('cascade-theme-editor'));
      if (
        mobileShell?.dataset.viewportMode === 'mobile' &&
        mobileScenarioReady &&
        Boolean(adaptivePanel) &&
        themeEvidence &&
        mobileLayoutIdentityPreserved &&
        mobileWorkspaceIdentityPreserved &&
        history.length === initialHistoryLength &&
        location.href === initialLocationHref
      ) {
        resolve({
          title: document.title,
          stage: mobileShell.dataset.stage,
          buildKind: mobileShell.dataset.buildKind,
          scenarioId: mobileShell.dataset.scenarioId,
          professionalScenario: mobileState.workspace.dataset.professionalScenario,
          scenarioTemplate: mobileShell.dataset.scenarioTemplate,
          viewportMode: mobileShell.dataset.viewportMode,
          adaptiveMode: mobileShell.dataset.adaptiveMode,
          themeMode: mobileShell.dataset.themeMode,
          themeEditorState: mobileShell.dataset.themeEditorState,
          dockedPanels,
          collapsedPanels,
          progress: playProgress,
          initialAssemblyEvidence,
          assemblySamples,
          runtimeInstanceId: baseState.runtimeInstanceId,
          atomicUpdateCount: mobileState.updateCount,
          atomicStageCounts,
          scenarioUpdateCounts,
          lastUpdatedStage: baseState.lastUpdatedStage,
          initialHistoryLength,
          historyLength: history.length,
          initialLocationHref,
          locationHref: location.href,
          noNavigation: history.length === initialHistoryLength && location.href === initialLocationHref,
          mobileLayoutIdentityPreserved,
          mobileWorkspaceIdentityPreserved,
          themeTransitionStage: baseState.themeTransitionStage,
          themeTransitionSource: baseState.themeTransitionSource,
          themeTransitionFromMode: baseState.themeTransitionFromMode,
          themeTransitionToMode: baseState.themeTransitionToMode,
          themeTransitionFromHue: baseState.themeTransitionFromHue,
          themeTransitionToHue: baseState.themeTransitionToHue,
          themeTransitionChanged: baseState.themeTransitionChanged,
          themeTransitionFromComputedHue: baseState.themeTransitionFromComputedHue,
          themeTransitionToComputedHue: baseState.themeTransitionToComputedHue,
          themeTransitionComputedChanged: baseState.themeTransitionComputedChanged,
          themeTransitionUpdateCount: baseState.themeTransitionUpdateCount,
          themeWidgetUsesDefaults: baseState.themeWidgetUsesDefaults,
          themeEditorDefined: baseState.themeEditorDefined,
          requiredElements: baseState.requiredElements,
          scenarioComponents: Object.fromEntries(Object.entries(scenarioComponents).map(([id, selectors]) => [
            id,
            selectors.filter((selector) => document.querySelector(selector)),
          ])),
          scenarioProviderDefinitionEvidence,
          modulePanels: baseState.modulePanels,
          currentEvidence: baseState.currentEvidence,
          scenarioDataProofEvidence,
          executionModel: baseState.executionModel,
          hostServices: baseState.hostServices,
          packageReadiness: baseState.packageReadiness,
          themeEditorOpenRequest: mobileShell.dataset.themeEditorOpenRequest,
        });
        return;
      }
      if (Date.now() > deadline) {
        rejectWithDebug('Realtime builder mobile adaptive preview did not preserve professional layout identity.', {
          viewportMode: mobileShell?.dataset.viewportMode || '',
          scenarioId: mobileShell?.dataset.scenarioId || '',
          professionalScenario: mobileState.workspace?.dataset.professionalScenario || '',
          dockedPanels,
          collapsedPanels,
          adaptivePanel: Boolean(adaptivePanel),
          themeEvidence: Boolean(themeEvidence),
          mobileScenarioReady,
          sidebarSectionIds: sidebarSectionIds(),
          sidebarContextReady: sidebarContextReady('constructor-control'),
          mobileLayoutIdentityPreserved,
          mobileWorkspaceIdentityPreserved,
        });
        return;
      }
      setTimeout(checkMobile, 100);
      } catch (error) {
        reject(error);
      }
    };
    checkMobile();
  };
  let verifyScenarioSwitches = (baseState, playProgress) => {
    let index = 0;
    let checkScenario = () => {
      try {
      if (index >= scenarioSwitchOrder.length) {
        finishWithMobileCheck(baseState, playProgress);
        return;
      }
      let scenarioId = scenarioSwitchOrder[index];
      if (!switchScenario(scenarioId)) {
        reject(new Error('Realtime builder scenario button is missing: ' + scenarioId));
        return;
      }
      let waitScenario = () => {
        try {
        let state = queryState();
        let ready = currentScenarioReady(scenarioId, state);
        let identityPreserved = state.layout === baseState.layout &&
          state.mountedWorkspace === baseState.mountedWorkspace &&
          state.runtimeInstanceId === baseState.runtimeInstanceId;
        let scenarioUpdated = state.updateCount > Number(scenarioUpdateCounts[scenarioId] || 0);
        if (ready && identityPreserved && scenarioUpdated) {
          scenarioUpdateCounts[scenarioId] = state.updateCount;
          index += 1;
          setTimeout(checkScenario, 50);
          return;
        }
        if (Date.now() > deadline) {
          rejectWithDebug('Realtime builder scenario switch did not mount the expected professional layout.', {
            scenarioId,
            ready,
            identityPreserved,
            scenarioUpdated,
            activeScenarioId: state.shell?.dataset.scenarioId || '',
            professionalScenario: state.workspace?.dataset.professionalScenario || '',
            sidebarSectionIds: sidebarSectionIds(),
            sidebarContextReady: sidebarContextReady(scenarioId),
            runtimeInstanceId: state.runtimeInstanceId,
            expectedRuntimeInstanceId: baseState.runtimeInstanceId,
            updateCount: state.updateCount,
            scenarioUpdateCounts,
            components: scenarioComponents[scenarioId].map((selector) => [selector, Boolean(document.querySelector(selector))]),
            providerDefinitions: scenarioProviderDefinitionEvidence[scenarioId] ||
              scenarioProviderDefinitionState(scenarioId),
            scenarioDataProof: scenarioDataProofEvidence[scenarioId] || scenarioDataProofState(scenarioId),
          });
          return;
        }
        setTimeout(waitScenario, 100);
        } catch (error) {
          reject(error);
        }
      };
      waitScenario();
      } catch (error) {
        reject(error);
      }
    };
    checkScenario();
  };
  let check = () => {
    try {
    let error = document.querySelector('[data-preview-error]');
    if (error) {
      reject(new Error(error.textContent || 'Realtime builder rendered data-preview-error.'));
      return;
    }
    let play = document.querySelector('[data-action="play"]');
    if (!play) {
      if (Date.now() > deadline) {
        reject(new Error([
          'Realtime builder Play button is missing.',
          \`readyState=\${document.readyState}\`,
          \`body=\${(document.body?.innerHTML || '').slice(0, 800)}\`,
        ].join('\\n')));
        return;
      }
      setTimeout(check, 100);
      return;
    }
    let state = queryState();
    let shell = state.shell;
    let workspace = state.workspace;
    let layout = state.layout;
    let mountedWorkspace = state.mountedWorkspace;
    if (!recordAssemblyState(shell)) return;
    if (!clickedPlay) {
      let initialProgress = document.querySelector('.demo-build-progress span')?.textContent || '';
      let initialPanels = mountedPanelTypes();
      let visiblePanelCount = Number(shell?.dataset.visibleScenarioPanelCount || initialPanels.length || '0');
      let mountedPanelCount = Number(shell?.dataset.mountedScenarioPanelCount || '0');
      let hydratedPanelCount = Number(shell?.dataset.hydratedScenarioPanelCount || '0');
      let plannedPanelCount = Number(shell?.dataset.plannedScenarioPanelCount || '0');
      let emptyStateCount = document.querySelectorAll('sn-empty-state').length;
      let initialAssemblyWasFullEmptyLayout =
        shell?.dataset.stage === 'workspace-name' &&
        shell?.dataset.scenarioId === 'video-editing' &&
        shell?.dataset.assemblyPhase === 'layout' &&
        initialProgress.includes('Build ') &&
        plannedPanelCount > 0 &&
        visiblePanelCount === plannedPanelCount &&
        mountedPanelCount === 0 &&
        hydratedPanelCount === 0 &&
        emptyStateCount >= plannedPanelCount &&
        !document.querySelector('chat-workspace');
      if (!initialAssemblyWasFullEmptyLayout) {
        if (Date.now() > deadline) {
          rejectWithDebug('Realtime builder initial state is not a full empty layout assembly.', {
            stage: shell?.dataset.stage || '',
            scenarioId: shell?.dataset.scenarioId || '',
            assemblyPhase: shell?.dataset.assemblyPhase || '',
            initialProgress,
            initialPanels,
            visiblePanelCount,
            mountedPanelCount,
            hydratedPanelCount,
            plannedPanelCount,
            emptyStateCount,
            hasChatWorkspace: Boolean(document.querySelector('chat-workspace')),
            visibleScenarioPanels: shell?.dataset.visibleScenarioPanels || '',
            mountedScenarioPanels: shell?.dataset.mountedScenarioPanels || '',
            hydratedScenarioPanels: shell?.dataset.hydratedScenarioPanels || '',
            plannedScenarioPanels: shell?.dataset.plannedScenarioPanels || '',
          });
          return;
        }
        setTimeout(check, 100);
        return;
      }
      initialAssemblyEvidence = {
        stage: shell.dataset.stage,
        scenarioId: shell.dataset.scenarioId,
        assemblyPhase: shell.dataset.assemblyPhase,
        progress: initialProgress,
        visiblePanelCount,
        mountedPanelCount,
        hydratedPanelCount,
        plannedPanelCount,
        emptyStateCount,
        visiblePanels: shell.dataset.visibleScenarioPanels,
        mountedPanels: shell.dataset.mountedScenarioPanels,
        hydratedPanels: shell.dataset.hydratedScenarioPanels,
        plannedPanels: shell.dataset.plannedScenarioPanels,
        mountedPanelTypes: initialPanels,
      };
      clickedPlay = true;
      play.click();
      setTimeout(check, 100);
      return;
    }
    let finalStage = shell?.dataset.stage === 'verification-scope';
    let finalKind = shell?.dataset.buildKind === 'rank-layout-behavior';
    let progress = document.querySelector('.demo-build-progress span')?.textContent || '';
    let requiredElements = [
      'panel-layout',
      'chat-workspace',
      'cascade-theme-widget',
      'cascade-theme-editor',
    ].map((selector) => document.querySelector(selector)).filter(Boolean);
    let operationChips = [...document.querySelectorAll('.demo-operation-chip')];
    let operationProcessReady =
      operationChips.length >= 4 &&
      operationChips.at(-1)?.dataset.operationLabel === 'Rank layout behavior' &&
      operationChips.every((chip) => ['done', 'active', 'pending'].includes(chip.dataset.operationStatus));
    let micButton = document.querySelector('chat-workspace chat-composer .btn-mic');
    let micRect = micButton?.getBoundingClientRect?.() || null;
    let composerBody = document.querySelector('chat-workspace chat-composer .composer-body:not(.voice-preview)');
    let composerRect = composerBody?.getBoundingClientRect?.() || null;
    let composerRadius = composerBody ? Number.parseFloat(getComputedStyle(composerBody).borderRadius) : 0;
    let chatVoiceReady = Boolean(
      micButton &&
      !micButton.hidden &&
      micButton.dataset.voiceState === 'idle' &&
      micRect?.width > 0 &&
      micRect?.height > 0 &&
      micRect.y >= 0 &&
      micRect.y < innerHeight
    );
    let chatComposerRounded = Boolean(
      composerRadius >= 12 &&
      composerRect?.width > 0 &&
      composerRect?.height > 0 &&
      composerRect.y >= 0 &&
      composerRect.y < innerHeight
    );
    let oldDemoSurfaces = document.querySelector('.demo-chat, .demo-inspector');
    let appShadowHosts = [...document.querySelectorAll('.demo-shell, .demo-workspace, .symbiote-workspace, panel-layout')]
      .filter((element) => element.shadowRoot);
    let modulePanels = [...document.querySelectorAll('[data-module]')].map((element) => element.dataset.module);
    let runtimeInstanceId = state.runtimeInstanceId;
    let updateCount = state.updateCount;
    let lastUpdatedStage = state.lastUpdatedStage;
    if (shell?.dataset.stage && Number.isFinite(updateCount)) {
      atomicStageCounts[shell.dataset.stage] = Math.max(
        atomicStageCounts[shell.dataset.stage] || 0,
        updateCount
      );
    }
    let noNavigation = history.length === initialHistoryLength && location.href === initialLocationHref;
    let atomicStageCountsReady = expectedAtomicStages.every((stage) => Number(atomicStageCounts[stage] || 0) > 0);
    let themeWidget = document.querySelector('cascade-theme-widget');
    let themeWidgetUsesDefaults = themeWidget &&
      !themeWidget.hasAttribute('storage-key') &&
      !themeWidget.hasAttribute('target-selector');
    let themeEditorDefined = Boolean(customElements.get('cascade-theme-editor'));
    let themeTransitionStage = shell?.dataset.themeTransitionStage || '';
    let themeTransitionSource = shell?.dataset.themeTransitionSource || '';
    let themeTransitionFromMode = shell?.dataset.themeTransitionFromMode || '';
    let themeTransitionToMode = shell?.dataset.themeTransitionToMode || '';
    let themeTransitionFromHue = shell?.dataset.themeTransitionFromHue || '';
    let themeTransitionToHue = shell?.dataset.themeTransitionToHue || '';
    let themeTransitionChanged = shell?.dataset.themeTransitionChanged || '';
    let themeTransitionFromComputedHue = shell?.dataset.themeTransitionFromComputedHue || '';
    let themeTransitionToComputedHue = shell?.dataset.themeTransitionToComputedHue || '';
    let themeTransitionComputedChanged = shell?.dataset.themeTransitionComputedChanged || '';
    let themeTransitionUpdateCount = Number(shell?.dataset.themeTransitionUpdateCount || '0');
    let themeTransitionReady =
      ['theme-mode', 'theme-hue'].includes(themeTransitionStage) &&
      themeTransitionSource === 'cascade-theme-change' &&
      themeTransitionChanged === 'true' &&
      themeTransitionFromMode === 'dark' &&
      themeTransitionToMode === 'dark' &&
      Number(themeTransitionFromHue) !== Number(themeTransitionToHue) &&
      themeTransitionFromComputedHue &&
      themeTransitionToComputedHue &&
      themeTransitionFromComputedHue !== themeTransitionToComputedHue &&
      themeTransitionComputedChanged === 'true' &&
      themeTransitionUpdateCount > 0;
    let currentEvidence = [
      'host-services',
      'package-readiness',
      'runtime-imports',
    ].map((id) => document.querySelector('[data-current-evidence="' + id + '"]')).filter(Boolean);
    let executionModel = shell?.dataset.executionModel || '';
    let hostServices = shell?.dataset.hostServices || '';
    let packageReadiness = shell?.dataset.packageReadiness || '';
    let packageReadinessElement = document.querySelector('[data-package-readiness="pass"]');
    let currentProtocolReady =
      executionModel === 'automation-bridge' &&
      hostServices.includes('agent.runtime') &&
      hostServices.includes('storage.project') &&
      packageReadiness === 'pass' &&
      Boolean(packageReadinessElement);
    let defaultScenarioReady = currentScenarioReady('video-editing', state);
    let finalAssemblyComplete =
      shell?.dataset.assemblyPhase === 'theme' &&
      Number(shell?.dataset.visibleScenarioPanelCount || '0') ===
      Number(shell?.dataset.plannedScenarioPanelCount || '-1') &&
      Number(shell?.dataset.mountedScenarioPanelCount || '0') ===
      Number(shell?.dataset.plannedScenarioPanelCount || '-1') &&
      Number(shell?.dataset.hydratedScenarioPanelCount || '0') ===
      Number(shell?.dataset.plannedScenarioPanelCount || '-1');
    let smokeReady = finalStage &&
      finalKind &&
      progress.includes('100%') &&
      requiredElements.length === 3 &&
      operationProcessReady &&
      chatVoiceReady &&
      chatComposerRounded &&
      !oldDemoSurfaces &&
      appShadowHosts.length === 0 &&
      themeWidgetUsesDefaults &&
      themeEditorDefined &&
      themeTransitionReady &&
      scenarioRailReady() &&
      defaultScenarioReady &&
      finalAssemblyComplete &&
      Boolean(initialAssemblyEvidence) &&
      runtimeInstanceId &&
      updateCount > 0 &&
      atomicStageCountsReady &&
      currentProtocolReady &&
      noNavigation &&
      lastUpdatedStage === 'verification-scope';
    if (smokeReady) {
      themeWidget?.dispatchEvent?.(new CustomEvent('cascade-theme-open-full', {
        bubbles: true,
        composed: true,
      }));
      let openRequest = shell?.dataset.themeEditorOpenRequest === 'theme-editor';
      verifyScenarioSwitches({
        layout,
        mountedWorkspace,
        runtimeInstanceId,
        updateCount,
        lastUpdatedStage,
        themeTransitionStage,
        themeTransitionSource,
        themeTransitionFromMode,
        themeTransitionToMode,
        themeTransitionFromHue,
        themeTransitionToHue,
        themeTransitionChanged,
        themeTransitionFromComputedHue,
        themeTransitionToComputedHue,
        themeTransitionComputedChanged,
        themeTransitionUpdateCount,
        themeWidgetUsesDefaults,
        themeEditorDefined,
        requiredElements: requiredElements.map((element) => element.localName),
        modulePanels,
        currentEvidence: currentEvidence.map((element) => element.dataset.currentEvidence),
        executionModel,
        hostServices,
        packageReadiness,
        themeEditorOpenRequest: openRequest ? 'theme-editor' : '',
      }, progress);
      return;
    }
    if (Date.now() > deadline) {
      let debugState = {
        finalStage,
        finalKind,
        progress,
        requiredElementCount: requiredElements.length,
          requiredElements: requiredElements.map((element) => element.localName),
          operationChipCount: operationChips.length,
          operationStatuses: operationChips.map((chip) => chip.dataset.operationStatus),
          operationProcessReady,
          chatVoiceReady,
          micHidden: micButton ? micButton.hidden : null,
          micVoiceState: micButton?.dataset.voiceState || '',
          micRect: micRect ? {
            x: Math.round(micRect.x),
            y: Math.round(micRect.y),
            width: Math.round(micRect.width),
            height: Math.round(micRect.height),
          } : null,
          chatComposerRounded,
          composerRadius,
          composerRect: composerRect ? {
            x: Math.round(composerRect.x),
            y: Math.round(composerRect.y),
            width: Math.round(composerRect.width),
            height: Math.round(composerRect.height),
          } : null,
          oldDemoSurfaceCount: oldDemoSurfaces ? 1 : 0,
        appShadowHostCount: appShadowHosts.length,
        themeWidgetUsesDefaults: Boolean(themeWidgetUsesDefaults),
        themeEditorDefined,
        themeTransitionStage,
        themeTransitionSource,
        themeTransitionFromMode,
        themeTransitionToMode,
        themeTransitionFromHue,
        themeTransitionToHue,
        themeTransitionChanged,
        themeTransitionFromComputedHue,
        themeTransitionToComputedHue,
        themeTransitionComputedChanged,
        themeTransitionUpdateCount,
        themeTransitionReady,
        scenarioRailReady: scenarioRailReady(),
        defaultScenarioReady,
        finalAssemblyComplete,
        assemblyPhase: shell?.dataset.assemblyPhase || '',
        assemblySamples,
        visibleScenarioPanelCount: shell?.dataset.visibleScenarioPanelCount || '',
        mountedScenarioPanelCount: shell?.dataset.mountedScenarioPanelCount || '',
        hydratedScenarioPanelCount: shell?.dataset.hydratedScenarioPanelCount || '',
        plannedScenarioPanelCount: shell?.dataset.plannedScenarioPanelCount || '',
        initialAssemblyEvidence,
        sidebarSectionIds: sidebarSectionIds(),
        sidebarContextReady: sidebarContextReady('video-editing'),
        scenarioProviderDefinitionEvidence,
        scenarioDataProofEvidence,
        modulePanels,
        runtimeInstanceId,
        updateCount,
        atomicStageCounts,
        atomicStageCountsReady,
        currentEvidence: currentEvidence.map((element) => element.dataset.currentEvidence),
        scenarioDataProofEvidence,
        executionModel,
        hostServices,
        packageReadiness,
        currentProtocolReady,
        lastUpdatedStage,
        initialHistoryLength,
        historyLength: history.length,
        initialLocationHref,
        locationHref: location.href,
        noNavigation,
      };
      reject(new Error([
        'Realtime builder Play did not reach final operation state.',
        \`readyState=\${document.readyState}\`,
        \`stage=\${shell?.dataset.stage || ''}\`,
        \`buildKind=\${shell?.dataset.buildKind || ''}\`,
        \`debug=\${JSON.stringify(debugState)}\`,
        \`body=\${(document.body?.innerHTML || '').slice(0, 800)}\`,
      ].join('\\n')));
      return;
    }
    setTimeout(check, 100);
    } catch (error) {
      reject(error);
    }
  };
  check();
})
`;

async function run() {
  let timeout = timeoutMs();
  let driver = browserDriver();
  let previewPort = Number(readArg('--port', await freePort()));
  let demo = readArg('--demo', 'visual');
  if (!['visual', 'realtime-builder'].includes(demo)) {
    throw new Error(`Unknown browser smoke demo: ${demo}`);
  }
  let command = demoCommand(demo);
  let keepOutput = hasArg('--keep-output') || process.env.SYMBIOTE_BROWSER_SMOKE_KEEP === '1';
  let outputDir = resolve(readArg('--output-dir', await mkdtemp(join(tmpdir(), 'symbiote-visual-demo-'))));
  let profileDir = null;
  let preview = null;
  let previewServer = null;
  let browserProcess = null;
  let cdp = null;
  let url = `http://127.0.0.1:${previewPort}/`;
  let expression = demo === 'realtime-builder'
    ? `(globalThis.__symbioteRealtimeSmokePromise ||= ${realtimeExpression})`
    : mountExpression;
  let resultValue = null;
  let browserSummary = {};

  try {
    if (demo === 'realtime-builder') {
      let startedPreview = await startRealtimeBrowserPreview({
        outputDir,
        port: previewPort,
      });
      previewServer = startedPreview.server;
    } else {
      preview = spawnProcess(process.execPath, [
        join(scriptDir(), command.script),
        '--port',
        String(previewPort),
        '--output-dir',
        outputDir,
      ], {
        cwd: resolve(scriptDir(), '../..'),
      });
      await waitForPreview(preview, timeout, command.readyText);
    }

    if (driver === 'playwright') {
      let result = await runPlaywrightSmoke({ demo, url, expression, timeout });
      resultValue = result.value;
      browserSummary = {
        browser: `playwright:${result.browserName}`,
        playwrightBrowser: result.browserName,
      };
    } else {
      let browser = await findBrowser();
      let headless = headlessMode();
      let configuredCdpPort = readArg('--cdp-port', process.env.SYMBIOTE_BROWSER_CDP_PORT || '0');
      let cdpPort = Number(configuredCdpPort);
      if (!Number.isInteger(cdpPort) || cdpPort < 0) {
        throw new Error(`Invalid Chrome DevTools Protocol port: ${configuredCdpPort}`);
      }
      profileDir = await mkdtemp(join(tmpdir(), 'symbiote-browser-profile-'));
      browserProcess = spawnProcess(browser, [
        `--headless=${headless}`,
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-dev-shm-usage',
        '--no-default-browser-check',
        '--no-first-run',
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profileDir}`,
        'about:blank',
      ]);

      try {
        if (cdpPort === 0) {
          cdpPort = await readDevToolsActivePort(profileDir, timeout, browserProcess);
        }
        await waitForCdp(cdpPort, timeout, browserProcess);
      } catch (error) {
        throw new Error([
          error.message,
          browserProcess.output.stderr ? `Chrome stderr: ${browserProcess.output.stderr}` : '',
          browserProcess.output.stdout ? `Chrome stdout: ${browserProcess.output.stdout}` : '',
        ].filter(Boolean).join('\n'));
      }
      let target = await createCdpTarget(cdpPort, url, timeout);
      cdp = await connectCdpWebSocket(target.webSocketDebuggerUrl, timeout);
      await cdp.send('Page.enable', {}, timeout);
      await cdp.send('Runtime.enable', {}, timeout);
      await cdp.send('Network.enable', {}, timeout);
      let diagnostics = createPageDiagnostics(cdp);
      await cdp.send('Page.navigate', { url }, timeout);
      await cdp.waitEvent('Page.loadEventFired', timeout);
      let result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }, timeout);
      if (result.exceptionDetails) {
        let text = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        let diagnosticsText = formatPageDiagnostics(diagnostics);
        throw new Error([text, diagnosticsText].filter(Boolean).join('\n\n'));
      }
      resultValue = result.result.value;
      browserSummary = { browser };
    }

    console.log(JSON.stringify({
      status: 'ok',
      driver,
      demo,
      url,
      ...browserSummary,
      outputDir,
      ...resultValue,
    }, null, 2));
  } finally {
    cdp?.close();
    killProcess(browserProcess);
    killProcess(preview);
    await Promise.all([
      waitForProcessExit(browserProcess),
      waitForProcessExit(preview),
      closeServer(previewServer),
    ]);
    if (profileDir) await removeTempDir(profileDir);
    if (!keepOutput) await removeTempDir(outputDir);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error) => {
    if (process.env.SYMBIOTE_BROWSER_SMOKE_OPTIONAL === '1') {
      console.log(JSON.stringify({ status: 'skipped', reason: error.message }, null, 2));
      process.exitCode = 0;
    } else {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
}
