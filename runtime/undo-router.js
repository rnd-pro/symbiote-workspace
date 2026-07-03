import { canTraverseHistoryEntry } from './workspace-state.js';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const deepClone = (value) => {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const DOC_ADDRESS_PATTERN = /^doc:([^:]+):(.+)$/;

function readAttribute(node, name) {
  if (!node || typeof node.getAttribute !== 'function') return undefined;
  try {
    return node.getAttribute(name) || undefined;
  } catch {
    return undefined;
  }
}

function docAddressFromFocus(focus) {
  if (typeof focus === 'string') return focus;
  if (!isObject(focus)) return null;

  let direct = focus.docAddress || focus.documentAddress || focus.doc || focus.channel || focus.topic;
  if (typeof direct === 'string') return direct;

  let datasetAddress = focus.dataset?.docAddress || focus.dataset?.documentAddress;
  if (typeof datasetAddress === 'string') return datasetAddress;

  for (let attr of ['data-doc-address', 'data-document-address', 'data-doc', 'data-channel']) {
    let value = readAttribute(focus, attr);
    if (typeof value === 'string') return value;
  }

  if (typeof focus.closest === 'function') {
    let owner = focus.closest('[data-doc-address],[data-document-address],[data-doc],[data-channel]');
    if (owner && owner !== focus) return docAddressFromFocus(owner);
  }

  return null;
}

function isSessionLayoutFocus(focus, address) {
  if (typeof address === 'string' && address.startsWith('session:layout')) return true;
  if (!isObject(focus)) return false;
  return focus.kind === 'session-layout'
    || focus.stack === 'session-layout'
    || focus.role === 'session-layout';
}

function collectionFromAddress(address) {
  let match = DOC_ADDRESS_PATTERN.exec(address || '');
  return match ? match[1] : null;
}

function isCollectionWildcard(address) {
  return DOC_ADDRESS_PATTERN.test(address || '') && address.endsWith(':*');
}

function entrySortValue(entry) {
  if (!entry) return -Infinity;
  if (Number.isFinite(entry.at)) return entry.at;
  if (Number.isFinite(entry.committedAt)) return entry.committedAt;
  if (Number.isFinite(entry.revision)) return entry.revision;
  return -Infinity;
}

function normalizePeek(raw, context) {
  if (!raw) return { status: 'empty' };
  if (raw.status === 'empty' || raw.status === 'blocked') return raw;

  let entry = raw.entry || raw;
  if (!entry) return { status: 'empty' };
  let access = canTraverseHistoryEntry(entry, context);
  if (!access.ok) {
    return {
      status: 'blocked',
      blocked: true,
      reason: access.reason,
      attribution: access.attribution,
      entry: deepClone(entry),
    };
  }
  return {
    status: 'ready',
    entry: deepClone(entry),
    via: raw.via || access.via,
  };
}

function stackKeys(documentStacks) {
  if (!documentStacks) return [];
  if (documentStacks instanceof Map) return [...documentStacks.keys()];
  return Object.keys(documentStacks);
}

function stackValue(documentStacks, key) {
  if (!documentStacks) return null;
  if (documentStacks instanceof Map) return documentStacks.get(key) || null;
  return documentStacks[key] || null;
}

async function peekStack(stack, action, context) {
  if (!stack) return { status: 'empty' };
  let method = action === 'undo' ? 'peekUndo' : 'peekRedo';
  let latestMethod = action === 'undo' ? 'latestUndoEntry' : 'latestRedoEntry';
  if (typeof stack[method] === 'function') return normalizePeek(await stack[method](context), context);
  if (typeof stack[latestMethod] === 'function') return normalizePeek(await stack[latestMethod](context), context);
  let arrayName = action === 'undo' ? 'undoStack' : 'redoStack';
  if (Array.isArray(stack[arrayName]) && stack[arrayName].length > 0) {
    return normalizePeek(stack[arrayName][stack[arrayName].length - 1], context);
  }
  return { status: 'empty' };
}

function overlayExecutorFrom(router, context) {
  let restore = context.restoreOverlay || router.restoreOverlay;
  let clear = context.clearRestoredOverlay || context.clearOverlay || router.clearOverlay;
  if (!restore && !clear) return context;
  return {
    ...context,
    restoreOverlayExecutor: { restore, clear },
    restoreOverlay: restore,
    clearRestoredOverlay: clear,
  };
}

export class UndoRouter {
  constructor(options = {}) {
    this.configStack = options.configStack || null;
    this.documentStacks = options.documentStacks || null;
    this.documentHistory = options.documentHistory || null;
    this.getFocus = options.getFocus || (() => null);
    this.settleFocus = options.settleFocus || null;
    this.restoreOverlay = options.restoreOverlay || options.restoreOverlayExecutor?.restore || null;
    this.clearOverlay = options.clearOverlay
      || options.clearRestoredOverlay
      || options.restoreOverlayExecutor?.clear
      || null;
  }

  async undo(options = {}) {
    return this._dispatch('undo', options);
  }

  async redo(options = {}) {
    return this._dispatch('redo', options);
  }

  async resolveTarget(action, options = {}) {
    await Promise.resolve();
    if (typeof this.settleFocus === 'function') await this.settleFocus();

    let focus = Object.prototype.hasOwnProperty.call(options, 'focus')
      ? options.focus
      : await this.getFocus();
    let address = docAddressFromFocus(focus);

    if (isSessionLayoutFocus(focus, address)) {
      return {
        type: 'blocked',
        result: {
          status: 'blocked',
          reason: 'session_layout_not_implicit',
          hint: 'Session-layout history is only reachable through an explicit session.layout.undo affordance.',
        },
      };
    }

    if (typeof address === 'string' && DOC_ADDRESS_PATTERN.test(address)) {
      if (isCollectionWildcard(address)) {
        return this._resolveCollectionTarget(action, focus, address, options);
      }
      return this._resolveDocumentTarget(address);
    }

    return { type: 'config', stack: this.configStack, stackName: 'config' };
  }

  async _dispatch(action, options) {
    let target = await this.resolveTarget(action, options);
    if (target.type === 'blocked') return target.result;
    if (!target.stack) {
      return {
        status: 'empty',
        stack: target.stackName || target.type,
        reason: `${target.type}_stack_missing`,
      };
    }

    let context = overlayExecutorFrom(this, options);
    let result;
    if (target.usesDocumentHistory && typeof this.documentHistory?.[action] === 'function') {
      result = await this.documentHistory[action](target.docAddress, context);
    } else if (typeof target.stack[action] === 'function') {
      result = await target.stack[action](context);
    } else {
      return {
        status: 'empty',
        stack: target.stackName || target.type,
        reason: `${action}_not_supported`,
      };
    }

    return {
      ...result,
      stack: result?.stack || target.stackName || target.type,
      docAddress: target.docAddress,
    };
  }

  _resolveDocumentTarget(address) {
    let stack = this._stackForDoc(address);
    if (stack) {
      return { type: 'document', stack, stackName: 'document', docAddress: address };
    }
    if (typeof this.documentHistory?.undo === 'function' || typeof this.documentHistory?.redo === 'function') {
      return {
        type: 'document',
        stack: this.documentHistory,
        stackName: 'document',
        docAddress: address,
        usesDocumentHistory: true,
      };
    }
    return { type: 'document', stack: null, stackName: 'document', docAddress: address };
  }

  async _resolveCollectionTarget(action, focus, address, options) {
    let collection = collectionFromAddress(address);
    let docAddresses = await this._boundDocuments(focus, collection);
    let best = null;
    let blocked = null;

    for (let docAddress of docAddresses) {
      let stack = this._stackForDoc(docAddress);
      if (!stack) continue;
      let peek = await peekStack(stack, action, options);
      if (peek.status === 'blocked') {
        if (!blocked || entrySortValue(peek.entry) > entrySortValue(blocked.result.entry)) {
          blocked = {
            type: 'blocked',
            result: { ...peek, stack: 'document', docAddress },
          };
        }
        continue;
      }
      if (peek.status !== 'ready') continue;
      if (!best || entrySortValue(peek.entry) > entrySortValue(best.entry)) {
        best = { stack, docAddress, entry: peek.entry };
      }
    }

    if (best) {
      return {
        type: 'document',
        stack: best.stack,
        stackName: 'document',
        docAddress: best.docAddress,
      };
    }
    if (blocked) return blocked;
    return {
      type: 'document',
      stack: null,
      stackName: 'document',
      docAddress: address,
    };
  }

  _stackForDoc(address) {
    if (typeof this.documentHistory?.stackForDoc === 'function') {
      return this.documentHistory.stackForDoc(address);
    }
    if (typeof this.documentHistory?.getStack === 'function') {
      return this.documentHistory.getStack(address);
    }
    return stackValue(this.documentStacks, address);
  }

  async _boundDocuments(focus, collection) {
    if (isObject(focus)) {
      for (let key of ['docAddresses', 'documents', 'boundDocuments']) {
        if (Array.isArray(focus[key])) return focus[key].filter((item) => typeof item === 'string');
      }
    }
    if (typeof this.documentHistory?.listBoundDocuments === 'function') {
      let result = await this.documentHistory.listBoundDocuments(focus, collection);
      if (Array.isArray(result)) return result;
    }
    if (typeof this.documentHistory?.listDocuments === 'function') {
      let result = await this.documentHistory.listDocuments(collection);
      if (Array.isArray(result)) return result;
    }
    let prefix = `doc:${collection}:`;
    return stackKeys(this.documentStacks).filter((key) => key.startsWith(prefix) && key !== `${prefix}*`);
  }
}

export function createUndoRouter(options) {
  return new UndoRouter(options);
}
