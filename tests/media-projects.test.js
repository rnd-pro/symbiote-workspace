import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MEDIA_PROJECT_ROUTE_PARAM,
  MEDIA_PROJECT_SCHEMA_VERSION,
  createMediaProject,
  createMediaProjectRouteSearch,
  createStorageMediaProjectStore,
  parseMediaProjectRouteSearch,
} from '../index.js';

function timeline() {
  return {
    id: 'media-project-tour',
    title: 'Media project tour',
    locale: 'en-US',
    personas: {
      guide: { name: 'Guide', lang: 'en-US' },
      ops: { name: 'Operations', lang: 'en-US' },
    },
    turns: [
      { persona: 'guide', text: 'Show the preview.', cue: { targetId: 'panel:media:preview' } },
      { persona: 'ops', text: 'Confirm the timeline.', cue: { targetId: 'panel:media:timeline' } },
    ],
  };
}

function memoryStorage() {
  let values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

describe('media project contract', () => {
  it('creates a canonical project from a presentation timeline', () => {
    let project = createMediaProject({
      id: 'project A',
      title: 'Current UI render',
      timeline: timeline(),
      renderSettings: { includeAudio: true, fps: 12 },
      renderJob: { id: 'job-1', status: 'queued', progress: 0 },
    });

    assert.equal(project.schemaVersion, MEDIA_PROJECT_SCHEMA_VERSION);
    assert.equal(project.id, 'project-a');
    assert.equal(project.surface, 'media-studio');
    assert.equal(project.timeline.turns.length, 2);
    assert.match(project.timelineHash, /^presentation-timeline-v1:/);
    assert.equal(project.renderSettings.includeAudio, true);
    assert.equal(project.renderJob.id, 'job-1');
  });

  it('creates route search with project id only', () => {
    let project = createMediaProject({ id: 'demo-project', timeline: timeline() });
    let search = createMediaProjectRouteSearch(project, {
      search: '?verify=abc&tour-render=1',
      removeParams: ['tour-render'],
    });
    let parsed = parseMediaProjectRouteSearch(search);

    assert.equal(parsed.projectId, 'demo-project');
    assert.equal(parsed.surface, 'media-studio');
    assert.match(search, new RegExp(`${MEDIA_PROJECT_ROUTE_PARAM}=demo-project`));
    assert.doesNotMatch(search, /turns|timeline|renderSettings|tour-render/);
  });

  it('persists and updates projects through a storage-backed store', () => {
    let storage = memoryStorage();
    let store = createStorageMediaProjectStore(storage, { namespace: 'test:media' });
    let project = store.create({
      id: 'roundtrip-project',
      title: 'Roundtrip',
      timeline: timeline(),
      renderSettings: { includeAudio: true },
    });

    let updated = store.update(project.id, {
      status: 'complete',
      renderJob: {
        id: 'render-1',
        status: 'succeeded',
        progress: 1,
        outputUrl: '/render-cache/jobs/render-1/render.mp4',
        manifestUrl: '/render-cache/jobs/render-1/manifest.json',
      },
    });
    let restored = store.load(project.id);

    assert.equal(updated.renderJob.id, 'render-1');
    assert.equal(restored.status, 'complete');
    assert.equal(restored.timeline.hash, project.timeline.hash);
    assert.equal(restored.renderJob.outputUrl, '/render-cache/jobs/render-1/render.mp4');
    assert.deepEqual(store.list().map((item) => item.id), ['roundtrip-project']);
  });
});
