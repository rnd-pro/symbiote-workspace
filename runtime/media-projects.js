import {
  createPresentationTimelineContract,
  createPresentationTimelineHash,
  presentationTimelineHasTurns,
} from './presentation.js';

export const MEDIA_PROJECT_SCHEMA_VERSION = 'workspace-media-project-v1';
export const MEDIA_PROJECT_ROUTE_PARAM = 'mediaProject';
export const MEDIA_PROJECT_DEFAULT_SURFACE = 'media-studio';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePortable(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'function') return undefined;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => clonePortable(item)).filter((item) => item !== undefined);
  }
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    let next = clonePortable(child);
    if (next !== undefined) result[key] = next;
  }
  return result;
}

function compactObject(value = {}) {
  let result = {};
  for (let [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = child;
  }
  return result;
}

function cleanString(value, fallback = '') {
  let text = String(value ?? fallback ?? '').replace(/\s+/g, ' ').trim();
  return text && text !== 'undefined' && text !== 'null' ? text : String(fallback || '').trim();
}

function safeId(value, fallback = 'media-project') {
  return cleanString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || fallback;
}

function timestamp(value, fallback = new Date().toISOString()) {
  let text = cleanString(value);
  if (!text) return fallback;
  let date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function normalizeProgress(value) {
  let number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(1, Math.max(0, number > 1 ? number / 100 : number));
}

function normalizeRenderJob(input = {}) {
  let source = isObject(input) ? input : {};
  let id = cleanString(source.id || source.jobId);
  return compactObject({
    id,
    status: cleanString(source.status),
    stage: cleanString(source.stage),
    progress: normalizeProgress(source.progress),
    outputUrl: cleanString(source.outputUrl),
    manifestUrl: cleanString(source.manifestUrl || source.proofUrl),
    proofUrl: cleanString(source.proofUrl || source.manifestUrl),
    captionsUrl: cleanString(source.captionsUrl),
    error: cleanString(source.error),
    audio: clonePortable(source.audio),
    captions: clonePortable(source.captions),
    frames: clonePortable(source.frames),
    frameCount: Number.isFinite(Number(source.frameCount)) ? Number(source.frameCount) : undefined,
    updatedAt: timestamp(source.updatedAt, new Date().toISOString()),
  });
}

export function createMediaProjectId(input = {}) {
  let source = isObject(input) ? input : {};
  let title = safeId(source.title || source.name || 'media-project');
  let suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return safeId(`${title}-${suffix}`);
}

export function normalizeMediaProject(input = {}, options = {}) {
  let source = isObject(input) ? input : {};
  let now = new Date().toISOString();
  let timeline = undefined;
  if (presentationTimelineHasTurns(source.timeline)) {
    timeline = createPresentationTimelineContract(source.timeline);
  } else if (options.requireTimeline) {
    throw new Error('media project requires a presentation timeline');
  }
  let renderJob = normalizeRenderJob(source.renderJob || source.job || {});
  let id = safeId(source.id || options.id || createMediaProjectId(source));
  let timelineHash = timeline
    ? createPresentationTimelineHash(timeline)
    : cleanString(source.timelineHash || source.hash);
  return compactObject({
    schemaVersion: cleanString(source.schemaVersion, MEDIA_PROJECT_SCHEMA_VERSION),
    id,
    title: cleanString(source.title || timeline?.title, 'Media project'),
    surface: cleanString(source.surface, MEDIA_PROJECT_DEFAULT_SURFACE),
    status: cleanString(source.status || renderJob.status, timeline ? 'draft' : 'empty'),
    timeline,
    timelineHash,
    renderSettings: clonePortable(source.renderSettings || source.render),
    renderJob: Object.keys(renderJob).length ? renderJob : undefined,
    preview: clonePortable(source.preview),
    artifacts: clonePortable(source.artifacts),
    source: clonePortable(source.source),
    metadata: clonePortable(source.metadata),
    createdAt: timestamp(source.createdAt, now),
    updatedAt: timestamp(source.updatedAt, now),
  });
}

export function createMediaProject(input = {}) {
  return normalizeMediaProject(input, { requireTimeline: true });
}

function projectId(value) {
  if (typeof value === 'string') return safeId(value, '');
  return safeId(value?.id || value?.projectId, '');
}

export function createMediaProjectRouteSearch(project, options = {}) {
  let id = projectId(project);
  if (!id) throw new Error('media project route requires a project id');
  let params = new URLSearchParams(cleanString(options.search));
  let surfaceParam = cleanString(options.surfaceParam, 'surface');
  let projectParam = cleanString(options.projectParam, MEDIA_PROJECT_ROUTE_PARAM);
  params.set(surfaceParam, cleanString(options.surface, MEDIA_PROJECT_DEFAULT_SURFACE));
  params.set(projectParam, id);
  for (let name of Array.isArray(options.removeParams) ? options.removeParams : []) {
    params.delete(name);
  }
  let text = params.toString();
  return text ? `?${text}` : '';
}

export function parseMediaProjectRouteSearch(search = '', options = {}) {
  let params = new URLSearchParams(cleanString(search));
  let projectParam = cleanString(options.projectParam, MEDIA_PROJECT_ROUTE_PARAM);
  let surfaceParam = cleanString(options.surfaceParam, 'surface');
  return {
    projectId: safeId(params.get(projectParam), ''),
    surface: cleanString(params.get(surfaceParam)),
  };
}

export function createMemoryMediaProjectStore(initialProjects = []) {
  let projects = new Map();
  for (let item of Array.isArray(initialProjects) ? initialProjects : []) {
    let project = normalizeMediaProject(item);
    projects.set(project.id, project);
  }
  return {
    save(project) {
      let normalized = normalizeMediaProject(project);
      projects.set(normalized.id, normalized);
      return normalized;
    },
    create(project) {
      return this.save(createMediaProject(project));
    },
    load(id) {
      let project = projects.get(projectId(id));
      return project ? clonePortable(project) : null;
    },
    update(id, patch = {}) {
      let current = this.load(id);
      if (!current) return null;
      return this.save({ ...current, ...clonePortable(patch), id: current.id, updatedAt: new Date().toISOString() });
    },
    remove(id) {
      return projects.delete(projectId(id));
    },
    list() {
      return [...projects.values()].map((project) => clonePortable(project));
    },
  };
}

export function createStorageMediaProjectStore(storage, options = {}) {
  let namespace = cleanString(options.namespace, 'workspace:media-projects');
  let indexKey = `${namespace}:index`;
  let memory = createMemoryMediaProjectStore(options.initialProjects || []);

  function hasStorage() {
    return Boolean(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function');
  }

  function key(id) {
    return `${namespace}:${projectId(id)}`;
  }

  function readIndex() {
    if (!hasStorage()) return memory.list().map((project) => project.id);
    try {
      let parsed = JSON.parse(storage.getItem(indexKey) || '[]');
      return Array.isArray(parsed) ? parsed.map((id) => projectId(id)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function writeIndex(ids) {
    if (!hasStorage()) return;
    storage.setItem(indexKey, JSON.stringify([...new Set(ids.map((id) => projectId(id)).filter(Boolean))]));
  }

  function saveStored(project) {
    let normalized = normalizeMediaProject(project);
    if (!hasStorage()) return memory.save(normalized);
    storage.setItem(key(normalized.id), JSON.stringify(normalized));
    writeIndex([...readIndex(), normalized.id]);
    return normalized;
  }

  return {
    save: saveStored,
    create(project) {
      return saveStored(createMediaProject(project));
    },
    load(id) {
      let normalizedId = projectId(id);
      if (!normalizedId) return null;
      if (!hasStorage()) return memory.load(normalizedId);
      try {
        let raw = storage.getItem(key(normalizedId));
        return raw ? normalizeMediaProject(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    update(id, patch = {}) {
      let current = this.load(id);
      if (!current) return null;
      return saveStored({ ...current, ...clonePortable(patch), id: current.id, updatedAt: new Date().toISOString() });
    },
    remove(id) {
      let normalizedId = projectId(id);
      if (!normalizedId) return false;
      if (!hasStorage()) return memory.remove(normalizedId);
      try { storage.removeItem?.(key(normalizedId)); } catch {}
      writeIndex(readIndex().filter((item) => item !== normalizedId));
      return true;
    },
    list() {
      if (!hasStorage()) return memory.list();
      return readIndex().map((id) => this.load(id)).filter(Boolean);
    },
  };
}
