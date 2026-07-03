import {
  CATALOG_FINGERPRINT_PATTERN,
  PARK_STAGES,
  PORTABLE_ID_PATTERN,
  RUNTIME_ID_PATTERN,
  SESSION_GC_DEFAULTS,
  SESSION_LAYOUT_UNDO_DEPTH,
  STRUCTURAL_ID_PATTERN,
  TASK_KINDS,
  TASK_STATUSES,
  WORKSPACE_SESSION_CAPABILITIES,
  WORKSPACE_STATE_CAPABILITIES,
} from './constants.js';
import { isGrantObject } from './value-classes.js';

export const SESSION_DOCUMENT_KEYS = Object.freeze([
  'openViews',
  'activeView',
  'stacks',
  'geometry',
  'nav',
  'panelChrome',
  'state',
  'tasks',
  'parked',
  'grants',
  'teach',
]);

export const TEACH_STATUSES = Object.freeze(['offered', 'completed', 'dismissed']);

export const SESSION_DOCUMENT_SCHEMA = Object.freeze({
  id: 'SESSION_DOCUMENT',
  failureMode: 'lenient-drop',
  keys: SESSION_DOCUMENT_KEYS,
  properties: Object.freeze({
    openViews: 'open root-stack views: { view, key?, params? }[]',
    activeView: '<viewId> or <viewId>:<runtimeKey>',
    stacks: 'qualified stack address -> { active, order? }',
    geometry: 'viewId -> nodeId -> { ratio? | collapsed? | size? }',
    nav: 'presentation overlays such as sidebar order/hidden/width',
    panelChrome: 'WAS panel instance address -> runtime chrome state',
    state: 'session-tier state field values keyed by state.fields[].id',
    tasks: 'construction resume tasks[]',
    parked: 'confirm/pendingApproval parked work[]',
    grants: 'task/session grants[] only',
    teach: 'hookId[:hash] -> teach shown-state',
  }),
  constants: Object.freeze({
    taskKinds: TASK_KINDS,
    taskStatuses: TASK_STATUSES,
    parkStages: PARK_STAGES,
    gcDefaults: SESSION_GC_DEFAULTS,
    layoutUndoDepth: SESSION_LAYOUT_UNDO_DEPTH,
  }),
  capabilities: Object.freeze({
    session: WORKSPACE_SESSION_CAPABILITIES,
    state: WORKSPACE_STATE_CAPABILITIES,
  }),
  persistence: Object.freeze({
    session: 'workspace.session.* commits are lenient presentation-state persistence.',
    state: 'workspace.state.* commits are strict CAS for workspace-tier field values.',
  }),
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function warn(warnings, path, code, message) {
  warnings.push({ path, code, message, severity: 'warning', dropped: true });
}

function isRuntimeId(value) {
  return typeof value === 'string' && RUNTIME_ID_PATTERN.test(value);
}

function isStructuralId(value) {
  return typeof value === 'string' && STRUCTURAL_ID_PATTERN.test(value);
}

function isStateFieldId(value) {
  return typeof value === 'string'
    && value.split('.').every((segment) => STRUCTURAL_ID_PATTERN.test(segment));
}

function isActiveView(value) {
  if (!hasText(value)) return false;
  let [viewId, key, extra] = value.split(':');
  return extra === undefined && isStructuralId(viewId) && (key === undefined || isRuntimeId(key));
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!isObject(value)) return value;
  let out = {};
  for (let key of Object.keys(value)) out[key] = clonePlain(value[key]);
  return out;
}

function normalizeObjectMap(value, path, warnings, keyCheck, valueCheck) {
  if (value === undefined) return {};
  if (!isObject(value)) {
    warn(warnings, path, 'session.type', `${path} must be an object map.`);
    return {};
  }
  let out = {};
  for (let key of Object.keys(value)) {
    let entryPath = path ? `${path}.${key}` : key;
    if (!keyCheck(key)) {
      warn(warnings, entryPath, 'session.key', `Invalid session document key "${key}".`);
      continue;
    }
    let normalized = valueCheck(value[key], entryPath, warnings);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

function normalizeOpenViews(value, warnings, options) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warn(warnings, 'openViews', 'session.openViews', 'openViews must be an array.');
    return [];
  }
  let ephemeralViews = options.ephemeralViews instanceof Set ? options.ephemeralViews : new Set(options.ephemeralViews || []);
  let out = [];
  for (let i = 0; i < value.length; i++) {
    let entry = value[i];
    let path = `openViews[${i}]`;
    if (!isObject(entry) || !isStructuralId(entry.view)) {
      warn(warnings, path, 'session.openViews', 'Open view entries require a structural view id.');
      continue;
    }
    if (entry.key !== undefined && !isRuntimeId(entry.key)) {
      warn(warnings, `${path}.key`, 'session.runtime_id', 'Open view key must match RUNTIME_ID_PATTERN.');
      continue;
    }
    if (ephemeralViews.has(entry.view) && !isRuntimeId(entry.key)) {
      warn(warnings, `${path}.key`, 'session.openViews.ephemeral_key', 'Ephemeral-template views require a runtime key.');
      continue;
    }
    let normalized = { view: entry.view };
    if (entry.key !== undefined) normalized.key = entry.key;
    if (entry.params !== undefined) {
      if (!isObject(entry.params)) {
        warn(warnings, `${path}.params`, 'session.openViews.params', 'Open view params must be an object.');
        continue;
      }
      normalized.params = clonePlain(entry.params);
    }
    out.push(normalized);
  }
  return out;
}

function normalizeActiveView(value, warnings) {
  if (value === undefined) return undefined;
  if (!isActiveView(value)) {
    warn(warnings, 'activeView', 'session.activeView', 'activeView must be <viewId> or <viewId>:<runtimeKey>.');
    return undefined;
  }
  return value;
}

function isQualifiedStackAddress(value) {
  if (!hasText(value)) return false;
  let [view, stack, extra] = value.split('/');
  if (extra !== undefined || !view?.startsWith('view:') || !stack?.startsWith('stack:')) return false;
  return isStructuralId(view.slice('view:'.length)) && isStructuralId(stack.slice('stack:'.length));
}

function normalizeStack(value, path, warnings) {
  if (!isObject(value) || !hasText(value.active)) {
    warn(warnings, path, 'session.stacks', 'Stack overlay requires { active, order? }.');
    return undefined;
  }
  let out = { active: value.active };
  if (value.order !== undefined) {
    if (!Array.isArray(value.order) || !value.order.every(hasText)) {
      warn(warnings, `${path}.order`, 'session.stacks.order', 'Stack order must be an array of ids.');
      return undefined;
    }
    out.order = [...value.order];
  }
  return out;
}

function normalizeGeometryDelta(value, path, warnings) {
  if (!isObject(value)) {
    warn(warnings, path, 'session.geometry', 'Geometry delta must be an object.');
    return undefined;
  }
  let out = {};
  if (value.ratio !== undefined) {
    if (!isFiniteNumber(value.ratio) || value.ratio <= 0 || value.ratio >= 1) {
      warn(warnings, `${path}.ratio`, 'session.geometry.ratio', 'Geometry ratio must be between 0 and 1.');
      return undefined;
    }
    out.ratio = value.ratio;
  }
  if (value.collapsed !== undefined) {
    if (typeof value.collapsed !== 'boolean') {
      warn(warnings, `${path}.collapsed`, 'session.geometry.collapsed', 'Geometry collapsed must be boolean.');
      return undefined;
    }
    out.collapsed = value.collapsed;
  }
  if (value.size !== undefined) {
    if (!isFiniteNumber(value.size) || value.size < 0) {
      warn(warnings, `${path}.size`, 'session.geometry.size', 'Geometry size must be a non-negative number.');
      return undefined;
    }
    out.size = value.size;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeGeometry(value, warnings) {
  return normalizeObjectMap(value, 'geometry', warnings, isStructuralId, (nodes, viewPath, localWarnings) => (
    normalizeObjectMap(nodes, viewPath, localWarnings, isStructuralId, normalizeGeometryDelta)
  ));
}

function normalizeNav(value, warnings) {
  if (value === undefined) return {};
  if (!isObject(value)) {
    warn(warnings, 'nav', 'session.nav', 'nav must be an object.');
    return {};
  }
  let out = {};
  if (value.sidebar !== undefined) {
    if (!isObject(value.sidebar)) {
      warn(warnings, 'nav.sidebar', 'session.nav.sidebar', 'nav.sidebar must be an object.');
    } else {
      let sidebar = {};
      if (value.sidebar.order !== undefined) {
        if (Array.isArray(value.sidebar.order) && value.sidebar.order.every(isStructuralId)) {
          sidebar.order = [...value.sidebar.order];
        } else {
          warn(warnings, 'nav.sidebar.order', 'session.nav.sidebar', 'Sidebar order must be structural ids.');
        }
      }
      if (value.sidebar.hidden !== undefined) {
        if (Array.isArray(value.sidebar.hidden) && value.sidebar.hidden.every(isStructuralId)) {
          sidebar.hidden = [...value.sidebar.hidden];
        } else {
          warn(warnings, 'nav.sidebar.hidden', 'session.nav.sidebar', 'Sidebar hidden must be structural ids.');
        }
      }
      if (value.sidebar.width !== undefined) {
        if (isFiniteNumber(value.sidebar.width) && value.sidebar.width > 0) {
          sidebar.width = value.sidebar.width;
        } else {
          warn(warnings, 'nav.sidebar.width', 'session.nav.sidebar', 'Sidebar width must be a positive number.');
        }
      }
      if (Object.keys(sidebar).length > 0) out.sidebar = sidebar;
    }
  }
  return out;
}

function normalizePanelChrome(value, warnings) {
  return normalizeObjectMap(value, 'panelChrome', warnings, hasText, (entry, path, localWarnings) => {
    if (!isObject(entry)) {
      warn(localWarnings, path, 'session.panelChrome', 'Panel chrome entry must be an object.');
      return undefined;
    }
    return clonePlain(entry);
  });
}

function normalizeState(value, warnings) {
  return normalizeObjectMap(value, 'state', warnings, isStateFieldId, (entry) => clonePlain(entry));
}

function normalizeResume(value, path, warnings) {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    warn(warnings, path, 'session.tasks.resume', 'Task resume must be an object.');
    return undefined;
  }
  let out = {};
  if (value.phasePointer !== undefined) {
    if (!hasText(value.phasePointer)) {
      warn(warnings, `${path}.phasePointer`, 'session.tasks.resume', 'phasePointer must be a non-empty string.');
      return undefined;
    }
    out.phasePointer = value.phasePointer;
  }
  if (value.answers !== undefined) {
    if (!isObject(value.answers)) {
      warn(warnings, `${path}.answers`, 'session.tasks.resume', 'answers must be an object.');
      return undefined;
    }
    out.answers = clonePlain(value.answers);
  }
  if (value.stagedRefs !== undefined) {
    if (!Array.isArray(value.stagedRefs) || !value.stagedRefs.every(hasText)) {
      warn(warnings, `${path}.stagedRefs`, 'session.tasks.resume', 'stagedRefs must be non-empty strings.');
      return undefined;
    }
    out.stagedRefs = [...value.stagedRefs];
  }
  if (value.catalogFingerprint !== undefined) {
    if (!CATALOG_FINGERPRINT_PATTERN.test(value.catalogFingerprint)) {
      warn(warnings, `${path}.catalogFingerprint`, 'session.tasks.resume', 'catalogFingerprint must match the catalog fingerprint pattern.');
      return undefined;
    }
    out.catalogFingerprint = value.catalogFingerprint;
  }
  return out;
}

function normalizeTasks(value, warnings) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warn(warnings, 'tasks', 'session.tasks', 'tasks must be an array.');
    return [];
  }
  let out = [];
  for (let i = 0; i < value.length; i++) {
    let task = value[i];
    let path = `tasks[${i}]`;
    if (!isObject(task)
      || !isRuntimeId(task.taskId)
      || !TASK_KINDS.includes(task.kind)
      || !isFiniteNumber(task.startedAt)
      || !TASK_STATUSES.includes(task.status)) {
      warn(warnings, path, 'session.tasks', 'Task requires taskId, kind, startedAt, and status.');
      continue;
    }
    let normalized = {
      taskId: task.taskId,
      kind: task.kind,
      startedAt: task.startedAt,
      status: task.status,
    };
    let resume = normalizeResume(task.resume, `${path}.resume`, warnings);
    if (resume !== undefined) normalized.resume = resume;
    out.push(normalized);
  }
  return out;
}

function normalizeParked(value, warnings) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warn(warnings, 'parked', 'session.parked', 'parked must be an array.');
    return [];
  }
  let out = [];
  for (let i = 0; i < value.length; i++) {
    let parked = value[i];
    let path = `parked[${i}]`;
    if (!isObject(parked)
      || !isRuntimeId(parked.parkId)
      || !PARK_STAGES.includes(parked.stage)
      || !hasText(parked.payloadRef)
      || !isFiniteNumber(parked.createdAt)) {
      warn(warnings, path, 'session.parked', 'Parked item requires parkId, stage, payloadRef, and createdAt.');
      continue;
    }
    if (parked.stage === 'confirmPending' && !isFiniteNumber(parked.expiresAt)) {
      warn(warnings, `${path}.expiresAt`, 'session.parked.expiresAt', 'confirmPending parked items require expiresAt.');
      continue;
    }
    let normalized = {
      parkId: parked.parkId,
      stage: parked.stage,
      payloadRef: parked.payloadRef,
      createdAt: parked.createdAt,
    };
    if (parked.expiresAt !== undefined) normalized.expiresAt = parked.expiresAt;
    if (parked.verdictId !== undefined) {
      if (!hasText(parked.verdictId)) {
        warn(warnings, `${path}.verdictId`, 'session.parked.verdictId', 'verdictId must be a non-empty string.');
        continue;
      }
      normalized.verdictId = parked.verdictId;
    }
    if (parked.stale !== undefined) {
      if (typeof parked.stale !== 'boolean') {
        warn(warnings, `${path}.stale`, 'session.parked.stale', 'stale must be boolean.');
        continue;
      }
      normalized.stale = parked.stale;
    }
    out.push(normalized);
  }
  return out;
}

function normalizeGrants(value, warnings) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warn(warnings, 'grants', 'session.grants', 'grants must be an array.');
    return [];
  }
  let out = [];
  for (let i = 0; i < value.length; i++) {
    let grant = value[i];
    if (!isGrantObject(grant) || !['task', 'session'].includes(grant.expiry)) {
      warn(warnings, `grants[${i}]`, 'session.grants', 'Session documents may contain only task/session grant objects.');
      continue;
    }
    out.push(clonePlain(grant));
  }
  return out;
}

function isTeachKey(value) {
  if (!hasText(value)) return false;
  let [hookId, hash, extra] = value.split(':');
  return extra === undefined && PORTABLE_ID_PATTERN.test(hookId) && (hash === undefined || isRuntimeId(hash));
}

function normalizeTeach(value, warnings) {
  return normalizeObjectMap(value, 'teach', warnings, isTeachKey, (entry, path, localWarnings) => {
    if (!isObject(entry) || !TEACH_STATUSES.includes(entry.status) || !isFiniteNumber(entry.updatedAt)) {
      warn(localWarnings, path, 'session.teach', 'Teach entry requires status and updatedAt.');
      return undefined;
    }
    return { status: entry.status, updatedAt: entry.updatedAt };
  });
}

export function normalizeSessionDocument(value, options = {}) {
  let warnings = [];
  if (value !== undefined && !isObject(value)) {
    warn(warnings, '', 'session.document', 'Session document must be an object.');
  }
  let document = isObject(value) ? value : {};
  let normalized = {
    openViews: normalizeOpenViews(document.openViews, warnings, options),
    stacks: normalizeObjectMap(document.stacks, 'stacks', warnings, isQualifiedStackAddress, normalizeStack),
    geometry: normalizeGeometry(document.geometry, warnings),
    nav: normalizeNav(document.nav, warnings),
    panelChrome: normalizePanelChrome(document.panelChrome, warnings),
    state: normalizeState(document.state, warnings),
    tasks: normalizeTasks(document.tasks, warnings),
    parked: normalizeParked(document.parked, warnings),
    grants: normalizeGrants(document.grants, warnings),
    teach: normalizeTeach(document.teach, warnings),
  };
  let activeView = normalizeActiveView(document.activeView, warnings);
  if (activeView !== undefined) normalized.activeView = activeView;
  return { ok: true, document: normalized, warnings, errors: [] };
}

export function validateSessionDocument(value, options = {}) {
  return normalizeSessionDocument(value, options);
}
