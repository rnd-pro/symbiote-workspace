#!/usr/bin/env node

import { createServer } from 'node:net';
import { createConnection } from 'node:net';
import { request } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

let DEFAULT_TIMEOUT = 15000;
let POLL_INTERVAL = 100;

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

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function scriptDir() {
  return dirname(fileURLToPath(import.meta.url));
}

async function pathExists(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findBrowser() {
  let explicit = readArg('--browser', process.env.SYMBIOTE_BROWSER_BIN || '');
  if (explicit) {
    if (await pathExists(explicit)) return explicit;
    throw new Error(`Browser executable is not accessible: ${explicit}`);
  }

  let candidates = [
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

function demoCommand(demo) {
  if (demo === 'realtime-builder') {
    return {
      script: 'realtime-builder.js',
      readyText: 'Symbiote realtime builder demo:',
    };
  }
  return {
    script: 'preview.mjs',
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

async function waitForCdp(port, timeout) {
  let deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await httpJson('GET', port, '/json/version', 1000);
    } catch (error) {
      lastError = error;
      await delay(POLL_INTERVAL);
    }
  }
  throw new Error(`Timed out waiting for Chrome DevTools Protocol: ${lastError?.message || 'no response'}`);
}

async function createCdpTarget(port, url) {
  let path = `/json/new?${encodeURIComponent(url)}`;
  try {
    return await httpJson('PUT', port, path, 3000);
  } catch {
    return httpJson('GET', port, path, 3000);
  }
}

class CdpWebSocket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
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

  send(method, params = {}, timeout = DEFAULT_TIMEOUT) {
    let id = this.nextId++;
    this.writeFrame(1, JSON.stringify({ id, method, params }));
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

  close() {
    this.writeFrame(8, Buffer.alloc(0));
    this.socket.end();
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
  let deadline = Date.now() + 14000;
  let play = document.querySelector('[data-action="play"]');
  if (!play) {
    reject(new Error('Realtime builder Play button is missing.'));
    return;
  }
  play.click();
  let check = () => {
    let error = document.querySelector('[data-preview-error]');
    if (error) {
      reject(new Error(error.textContent || 'Realtime builder rendered data-preview-error.'));
      return;
    }
    let shell = document.querySelector('.demo-shell');
    let activeSteps = [...document.querySelectorAll('.demo-build-step[data-status="active"]')];
    let doneSteps = [...document.querySelectorAll('.demo-build-step[data-status="done"]')];
    let finalStage = shell?.dataset.stage === 'validation';
    let finalKind = shell?.dataset.buildKind === 'rank-layout-behavior';
    let progress = document.querySelector('.demo-build-progress span')?.textContent || '';
    let themeEditor = document.body.textContent.includes('theme-editor');
    let contractSections = [
      'Service blueprint',
      'Layout roles',
      'Widget registry',
      'Adaptive and theme state',
    ].every((text) => document.body.textContent.includes(text));
    if (finalStage && finalKind && progress.includes('100%') && doneSteps.length >= 3 && activeSteps.length === 1 && themeEditor && contractSections) {
      resolve({
        title: document.title,
        stage: shell.dataset.stage,
        buildKind: shell.dataset.buildKind,
        progress,
        activeStep: activeSteps[0].textContent,
        doneStepCount: doneSteps.length,
      });
      return;
    }
    if (Date.now() > deadline) {
      reject(new Error('Realtime builder Play did not reach final operation state.'));
      return;
    }
    setTimeout(check, 100);
  };
  check();
})
`;

async function run() {
  let timeout = timeoutMs();
  let browser = await findBrowser();
  let previewPort = Number(readArg('--port', await freePort()));
  let cdpPort = Number(readArg('--cdp-port', await freePort()));
  let demo = readArg('--demo', 'visual');
  if (!['visual', 'realtime-builder'].includes(demo)) {
    throw new Error(`Unknown browser smoke demo: ${demo}`);
  }
  let command = demoCommand(demo);
  let keepOutput = hasArg('--keep-output') || process.env.SYMBIOTE_BROWSER_SMOKE_KEEP === '1';
  let outputDir = resolve(readArg('--output-dir', await mkdtemp(join(tmpdir(), 'symbiote-visual-demo-'))));
  let profileDir = await mkdtemp(join(tmpdir(), 'symbiote-browser-profile-'));
  let preview = null;
  let browserProcess = null;
  let cdp = null;

  try {
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

    browserProcess = spawnProcess(browser, [
      '--headless=new',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-dev-shm-usage',
      '--no-default-browser-check',
      '--no-first-run',
      `--remote-debugging-address=127.0.0.1`,
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ]);

    try {
      await waitForCdp(cdpPort, timeout);
    } catch (error) {
      throw new Error([
        error.message,
        browserProcess.output.stderr ? `Chrome stderr: ${browserProcess.output.stderr}` : '',
        browserProcess.output.stdout ? `Chrome stdout: ${browserProcess.output.stdout}` : '',
      ].filter(Boolean).join('\n'));
    }
    let target = await createCdpTarget(cdpPort, `http://127.0.0.1:${previewPort}/`);
    cdp = await CdpWebSocket.connect(target.webSocketDebuggerUrl, timeout);
    await cdp.send('Page.enable', {}, timeout);
    await cdp.send('Runtime.enable', {}, timeout);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${previewPort}/` }, timeout);
    await cdp.waitEvent('Page.loadEventFired', timeout);
    let expression = demo === 'realtime-builder' ? realtimeExpression : mountExpression;
    let result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeout);
    if (result.exceptionDetails) {
      let text = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(text);
    }

    console.log(JSON.stringify({
      status: 'ok',
      demo,
      url: `http://127.0.0.1:${previewPort}/`,
      browser,
      outputDir,
      ...result.result.value,
    }, null, 2));
  } finally {
    cdp?.close();
    killProcess(browserProcess);
    killProcess(preview);
    await rm(profileDir, { recursive: true, force: true });
    if (!keepOutput) await rm(outputDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  if (process.env.SYMBIOTE_BROWSER_SMOKE_OPTIONAL === '1') {
    console.log(JSON.stringify({ status: 'skipped', reason: error.message }, null, 2));
    process.exitCode = 0;
  } else {
    console.error(error.message);
    process.exitCode = 1;
  }
});
