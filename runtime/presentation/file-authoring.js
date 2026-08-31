import { randomUUID } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPresentationAuthoringToolPack } from './authoring-tools.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

export class PresentationAuthoringFileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationAuthoringFileError';
    this.code = code;
    this.details = clone(details);
  }
}

function fail(code, message, details = {}) {
  throw new PresentationAuthoringFileError(code, message, details);
}

function projectPath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(
      'PRESENTATION_AUTHORING_FILE_INVALID',
      'projectFile must be a nonempty filesystem path',
    );
  }
  return resolve(value);
}

function parseDocument(source, file) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    fail(
      'PRESENTATION_AUTHORING_FILE_INVALID',
      `presentation Project file is not valid JSON: ${error.message}`,
      { projectFile: file },
    );
  }
  if (!isObject(value)) {
    fail(
      'PRESENTATION_AUTHORING_FILE_INVALID',
      'presentation Project file must contain an object',
      { projectFile: file },
    );
  }
  if (Object.hasOwn(value, 'project')) {
    return { style: 'snapshot', snapshot: clone(value) };
  }
  return { style: 'project', snapshot: { project: clone(value) } };
}

async function readDocument(file) {
  let source;
  let metadata;
  try {
    [source, metadata] = await Promise.all([
      readFile(file, 'utf8'),
      stat(file),
    ]);
  } catch (error) {
    fail(
      'PRESENTATION_AUTHORING_FILE_READ_FAILED',
      `cannot read presentation Project file: ${error.message}`,
      { projectFile: file, causeCode: error.code || null },
    );
  }
  return { ...parseDocument(source, file), source, mode: metadata.mode };
}

function serializeDocument(style, snapshot) {
  let value = style === 'project' ? snapshot.project : snapshot;
  if (!isObject(value)) {
    fail(
      'PRESENTATION_AUTHORING_FILE_INVALID',
      'presentation authority transaction produced an invalid document',
    );
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function replaceAtomically(file, source, mode) {
  let temporaryFile = `${file}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporaryFile, 'wx', mode);
    await handle.writeFile(source, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryFile, file);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporaryFile).catch(() => {});
    fail(
      'PRESENTATION_AUTHORING_FILE_WRITE_FAILED',
      `cannot atomically update presentation Project file: ${error.message}`,
      { projectFile: file, causeCode: error.code || null },
    );
  }
}

async function withFileLock(file, operation) {
  let lockFile = `${file}.lock`;
  let lock;
  try {
    lock = await open(lockFile, 'wx');
  } catch (error) {
    fail(
      'PRESENTATION_AUTHORING_FILE_BUSY',
      'presentation Project file is already being edited',
      { projectFile: file, causeCode: error.code || null },
    );
  }
  try {
    await lock.writeFile(`${JSON.stringify({ pid: process.pid })}\n`, 'utf8');
  } catch (error) {
    await lock.close().catch(() => {});
    await unlink(lockFile).catch(() => {});
    fail(
      'PRESENTATION_AUTHORING_FILE_WRITE_FAILED',
      `cannot initialize presentation Project lock: ${error.message}`,
      { projectFile: file, causeCode: error.code || null },
    );
  }
  try {
    return await operation();
  } finally {
    await lock.close().catch(() => {});
    await unlink(lockFile).catch(() => {});
  }
}

function serialExecutor() {
  let tail = Promise.resolve();
  return (operation) => {
    let result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export function createPresentationAuthoringFileAuthority(filePath) {
  let file = projectPath(filePath);
  let serial = serialExecutor();
  return Object.freeze({
    projectFile: file,
    read() {
      return serial(async () => clone((await readDocument(file)).snapshot));
    },
    transact({ base } = {}, update) {
      if (typeof update !== 'function') {
        fail(
          'PRESENTATION_AUTHORING_FILE_INVALID',
          'presentation authority transaction requires an update callback',
          { projectFile: file },
        );
      }
      return serial(() => withFileLock(file, async () => {
        let current = await readDocument(file);
        let nextSnapshot = await update(clone(current.snapshot), { base: clone(base) });
        let source = serializeDocument(current.style, nextSnapshot);
        await replaceAtomically(file, source, current.mode);
      }));
    },
  });
}

function unavailableRegeneration() {
  let reject = () => fail(
    'PRESENTATION_AUTHORING_REGENERATION_UNAVAILABLE',
    'presentation media regeneration requires an explicitly configured provider',
  );
  return Object.freeze({ request: reject, inspect: reject });
}

export function createPresentationAuthoringFileHost({ projectFile, regeneration } = {}) {
  let authority = createPresentationAuthoringFileAuthority(projectFile);
  let pack = createPresentationAuthoringToolPack({
    authority,
    regeneration: regeneration || unavailableRegeneration(),
  });
  return Object.freeze({
    projectFile: authority.projectFile,
    authority,
    tools: pack.tools,
    invoke: pack.invoke,
  });
}
