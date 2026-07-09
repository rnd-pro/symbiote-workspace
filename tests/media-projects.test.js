import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MEDIA_PROJECT_ROUTE_PARAM,
  MEDIA_PROJECT_ROUTE_PREVIEW_FRAME_PARAM,
  MEDIA_PROJECT_ROUTE_PREVIEW_MODE_PARAM,
  MEDIA_PROJECT_ROUTE_TIMELINE_PARAM,
  MEDIA_PROJECT_ROUTE_TIMELINE_CURSOR_PARAM,
  MEDIA_PROJECT_ROUTE_WORKSPACE_SECTION_PARAM,
  MEDIA_PROJECT_SCHEMA_VERSION,
  MEDIA_RENDER_EVENT_SCHEMA_VERSION,
  MEDIA_RENDER_SETTINGS_SCHEMA_VERSION,
  applyMediaRenderEvent,
  createMediaProject,
  createMediaRenderEvent,
  createMediaProjectRouteSearch,
  createStorageMediaProjectStore,
  invalidateMediaProjectArtifacts,
  isMediaRenderEventType,
  mapRenderJobEventToMediaRenderEvents,
  mapRenderJobStageToMediaRenderEventType,
  normalizeMediaRenderEvent,
  normalizeMediaRenderReadiness,
  normalizeMediaRenderRouteState,
  normalizeMediaRenderSettings,
  parseMediaProjectRouteSearch,
  selectMediaProjectTimeline,
  updateMediaProjectRenderSettings,
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
    assert.equal(project.renderSettings.autoRender, true);
    assert.equal(project.renderSettings.schemaVersion, MEDIA_RENDER_SETTINGS_SCHEMA_VERSION);
    assert.equal(project.renderJob.id, 'job-1');
  });

  it('maps lesson replan and review render stages to portable media events', () => {
    assert.equal(isMediaRenderEventType('tour.replan.started'), true);
    assert.equal(isMediaRenderEventType('tour.lesson.review.done'), true);
    assert.equal(mapRenderJobStageToMediaRenderEventType('tour:replan'), 'tour.replan.started');
    assert.equal(mapRenderJobStageToMediaRenderEventType('tour:replan', { status: 'done' }), 'tour.replan.done');
    assert.equal(mapRenderJobStageToMediaRenderEventType('lesson:review'), 'tour.lesson.review.started');
    assert.equal(mapRenderJobStageToMediaRenderEventType('lesson:review', { done: true }), 'tour.lesson.review.done');
    assert.equal(mapRenderJobStageToMediaRenderEventType('failed', { failureStage: 'tour.lesson.review.failed' }), 'tour.lesson.review.failed');

    let [event] = mapRenderJobEventToMediaRenderEvents({
      jobId: 'job-lesson',
      stage: 'tour.lesson.review.done',
      status: 'running',
      progress: 0.08,
      lessonAuditHash: 'presentation-lesson-audit-v1:sha256-test',
    });

    assert.equal(event.type, 'tour.lesson.review.done');
    assert.equal(event.progress, 0.08);
    assert.equal(event.payload.sourceStage, 'tour.lesson.review.done');
  });

  it('selects timeline skeleton clips without fabricating video before artifacts exist', () => {
    let project = createMediaProject({
      id: 'timeline-skeleton-project',
      timeline: {
        ...timeline(),
        turns: [
          { id: 'turn-1', persona: 'guide', text: 'Show the preview.', renderCue: { startMs: 0, durationMs: 1200 } },
          { id: 'turn-2', persona: 'ops', text: 'Confirm the timeline.', renderCue: { startMs: 1200, durationMs: 900 } },
        ],
      },
      renderSettings: { fps: 30 },
    });

    let selected = selectMediaProjectTimeline(project);

    assert.equal(selected.fps, 30);
    assert.equal(selected.clips.length, 2);
    assert.deepEqual(selected.clips.map((clip) => clip.lane), ['actions', 'actions']);
    assert.equal(selected.clips.some((clip) => clip.lane === 'video'), false);
    assert.equal(selected.durationFrames, 63);
  });

  it('selects frame, voice, caption, and action clips from folded project state', () => {
    let project = createMediaProject({
      id: 'timeline-artifact-project',
      timeline: {
        ...timeline(),
        turns: [
          { id: 'turn-1', persona: 'guide', text: 'Show the preview.', renderCue: { startMs: 0, durationMs: 1000 } },
        ],
      },
      renderSettings: { fps: 30 },
      renderJob: {
        id: 'job-1',
        frameCount: 240,
        frames: [
          { index: 0, url: '/render-cache/jobs/job-1/frames/frame-00000.webp', mimeType: 'image/webp' },
          { index: 120, url: '/render-cache/jobs/job-1/frames/frame-00120.webp', mimeType: 'image/webp' },
          { index: 239, url: '/render-cache/jobs/job-1/frames/frame-00239.webp', mimeType: 'image/webp' },
        ],
        audio: {
          speakerLayers: [{
            persona: 'guide',
            clips: [{ id: 'voice-1', text: 'Narration line.', startMs: 1000, durationMs: 2500 }],
          }, {
            persona: 'ops',
            clips: [{ id: 'voice-2', text: 'Ops answer.', startMs: 2500, endMs: 4100 }],
          }],
        },
        captions: {
          cues: [{ id: 'caption-1', speaker: 'guide', text: 'Narration line.', startSec: 1.1, endSec: 2.2 }],
        },
      },
      renderEvents: Array.from({ length: 25 }, (_, index) => createMediaRenderEvent('artifact.ready', {
        artifact: { kind: 'probe', id: `event-${index}` },
      })),
    });

    let selected = selectMediaProjectTimeline(project);

    assert.deepEqual(selected.clips.map((clip) => clip.lane), [
      'actions',
      'video',
      'voice:guide',
      'voice:ops',
      'captions',
    ]);
    let videoClip = selected.clips.find((clip) => clip.lane === 'video');
    assert.equal(videoClip.endFrame, 240);
    assert.equal(videoClip.kind, 'frame-sequence');
    assert.equal(videoClip.frameCount, 240);
    assert.equal(videoClip.sequenceFormat, 'WebP');
    assert.equal(videoClip.sampleCount, 3);
    assert.equal(videoClip.samples.length, 3);
    assert.equal(selected.clips.find((clip) => clip.lane === 'voice:guide').startMs, 1000);
    assert.equal(selected.clips.find((clip) => clip.lane === 'voice:ops').endMs, 4100);
    assert.equal(selected.clips.find((clip) => clip.lane === 'voice:guide').id, 'voice:1:guide');
    assert.equal(selected.clips.find((clip) => clip.lane === 'captions').id, 'caption:caption-1');
    assert.equal(selected.clips.find((clip) => clip.lane === 'captions').startMs, 1100);
    assert.equal(selected.durationFrames, 240);
    assert.equal(project.renderEvents.length, 20);
  });

  it('shows partial voice clips from generated audio items before final speaker layers exist', () => {
    let project = createMediaProject({
      id: 'partial-audio-project',
      timeline: {
        ...timeline(),
        turns: [
          { id: 'turn-1', persona: 'guide', text: 'First generated line.', renderCue: { startMs: 0, durationMs: 1000 } },
          { id: 'turn-2', persona: 'ops', text: 'Second generated line.', renderCue: { startMs: 1000, durationMs: 1500 } },
        ],
      },
      renderSettings: { fps: 30 },
      renderJob: {
        id: 'partial-audio-job',
        audio: {
          items: [{
            index: 0,
            persona: 'guide',
            text: 'First generated line.',
            durationMs: 1000,
            artifactId: 'sha256:first',
            url: '/render-cache/jobs/partial-audio-job/audio/turn-0.wav',
          }, {
            index: 1,
            persona: 'ops',
            text: 'Second generated line.',
            durationMs: 1500,
            artifactId: 'sha256:second',
            url: '/render-cache/jobs/partial-audio-job/audio/turn-1.wav',
          }],
        },
      },
    });

    let selected = selectMediaProjectTimeline(project);
    let voiceClips = selected.clips.filter((clip) => clip.kind === 'voice');

    assert.deepEqual(voiceClips.map((clip) => clip.lane), ['voice:guide', 'voice:ops']);
    assert.deepEqual(voiceClips.map((clip) => clip.id), ['voice:1:guide', 'voice:2:ops']);
    assert.equal(voiceClips[0].startMs, 0);
    assert.equal(voiceClips[0].endMs, 1000);
    assert.equal(voiceClips[1].startMs, 1000);
    assert.equal(voiceClips[1].endMs, 2500);
  });

  it('normalizes render settings for vertical video and captions by default', () => {
    let settings = normalizeMediaRenderSettings({
      vertical: true,
      captionsMode: 'karaoke',
      providerId: 'local-model-service',
      sequenceMode: 'overlap',
    });

    assert.equal(settings.autoRender, true);
    assert.equal(settings.orientation, 'vertical');
    assert.equal(settings.aspectRatio, '9:16');
    assert.equal(settings.width, 1080);
    assert.equal(settings.height, 1920);
    assert.equal(settings.captionsEnabled, true);
    assert.equal(settings.captionStyle.preset, 'tiktok');
    assert.equal(settings.providerId, 'local-model-service');
    assert.equal(settings.sequenceMode, 'overlap');
  });

  it('owns a strict media render event vocabulary', () => {
    assert.equal(isMediaRenderEventType('audio.turn.rerender.requested'), true);
    assert.equal(isMediaRenderEventType('product.local.event'), false);

    let event = createMediaRenderEvent('preview.firstFrame.ready', {
      projectId: 'Project A',
      artifact: { kind: 'first-frame', url: '/frames/frame-00000.png' },
      progress: 18,
    });

    assert.equal(event.schemaVersion, MEDIA_RENDER_EVENT_SCHEMA_VERSION);
    assert.equal(event.type, 'preview.firstFrame.ready');
    assert.equal(event.projectId, 'project-a');
    assert.equal(event.progress, 0.18);
    assert.throws(
      () => normalizeMediaRenderEvent({ type: 'product.local.event' }),
      /unknown media render event type/,
    );
  });

  it('maps render job stages into canonical media render events', () => {
    assert.equal(mapRenderJobStageToMediaRenderEventType('encode:start', {}, { strict: true }), 'encode.started');
    assert.equal(mapRenderJobStageToMediaRenderEventType('queued', {}, { strict: true }), '');
    assert.throws(
      () => mapRenderJobStageToMediaRenderEventType('product:local-stage', {}, { strict: true }),
      /unsupported render job stage/,
    );

    let captureEvents = mapRenderJobEventToMediaRenderEvents({
      type: 'render-job:progress',
      jobId: 'render-1',
      progress: {
        stage: 'capture:frame',
        frame: 4,
        frames: 12,
        progress: 0.25,
      },
    }, {
      projectId: 'Project A',
      artifact: { kind: 'frame', url: '/render-cache/frame-00004.png', frame: 4 },
    });
    let captureEvent = captureEvents[0];

    assert.equal(captureEvent.type, 'capture.frame.ready');
    assert.equal(captureEvent.projectId, 'project-a');
    assert.equal(captureEvent.jobId, 'render-1');
    assert.equal(captureEvent.progress, 0.25);
    assert.equal(captureEvent.artifact.url, '/render-cache/frame-00004.png');
    assert.equal(captureEvent.payload.sourceType, 'render-job:progress');
    assert.equal(captureEvent.payload.sourceStage, 'capture:frame');

    let providerCaptureEvent = mapRenderJobEventToMediaRenderEvents({
      stage: 'capture',
      jobId: 'render-1',
      frame: 1,
      frames: 2,
      progress: 0.7,
    }, {
      projectId: 'Project A',
      artifact: { kind: 'frame', url: '/render-cache/frame-00000.png', frame: 1 },
    })[0];
    assert.equal(providerCaptureEvent.type, 'capture.frame.ready');
    assert.equal(providerCaptureEvent.artifact.url, '/render-cache/frame-00000.png');

    let readyEvent = mapRenderJobEventToMediaRenderEvents({
      stage: 'audio:synthesize',
      jobId: 'render-1',
      item: 1,
      items: 2,
      cacheHit: false,
      progress: 0.24,
    }, { projectId: 'Project A' })[0];
    assert.equal(readyEvent.type, 'audio.turn.ready');

    let ignoredEvents = mapRenderJobEventToMediaRenderEvents('browser:ready', { projectId: 'Project A', strict: true });
    assert.deepEqual(ignoredEvents, []);
  });

  it('applies mapped render job events without product-local event strings', () => {
    let project = createMediaProject({
      id: 'mapped-events-project',
      timeline: timeline(),
      renderState: { expectedFiles: 4, completedFiles: 1, pending: ['encode'] },
    });
    let [event] = mapRenderJobEventToMediaRenderEvents({
      stage: 'encode:done',
      jobId: 'render-1',
      status: 'succeeded',
      progress: 1,
    }, {
      projectId: project.id,
      completedFiles: 4,
      expectedFiles: 4,
      artifact: { kind: 'final-video', url: '/render-cache/jobs/render-1/render.mp4' },
      route: { mediaProjectId: project.id, jobId: 'render-1', sourceSurface: 'orders' },
    });
    let updated = applyMediaRenderEvent(project, event);

    assert.equal(event.type, 'encode.done');
    assert.equal(updated.status, 'complete');
    assert.equal(updated.renderState.status, 'complete');
    assert.equal(updated.renderState.stage, 'encode.done');
    assert.equal(updated.renderState.progress, 1);
    assert.equal(updated.renderState.settled, true);
    assert.equal(updated.renderState.autoRenderReady, false);
    assert.deepEqual(updated.renderState.pending, []);
    assert.equal(updated.renderJob.outputUrl, '/render-cache/jobs/render-1/render.mp4');
    assert.equal(updated.routeState.sourceSurface, 'orders');
    assert.equal(updated.artifacts[0].kind, 'final-video');
    assert.equal(updated.renderEvents.every((item) => isMediaRenderEventType(item.type)), true);
  });

  it('applies first-frame and artifact events to the media project state', () => {
    let project = createMediaProject({
      id: 'event-project',
      timeline: timeline(),
      renderState: { expectedFiles: 4, completedFiles: 0, pending: ['first-frame'] },
    });

    let updated = applyMediaRenderEvent(project, {
      type: 'preview.firstFrame.ready',
      progress: 25,
      completedFiles: 1,
      artifact: { id: 'frame-0', kind: 'first-frame', url: '/render-cache/frame-00000.png' },
      route: {
        surface: 'media-studio',
        sourceSurface: 'work-order-map',
        sourceTabId: 'req-4',
        sourceUrl: '/?surface=work-order-map&tour-render=1',
      },
    });

    assert.equal(updated.preview.status, 'ready');
    assert.equal(updated.preview.currentFrame, '/render-cache/frame-00000.png');
    assert.equal(updated.preview.frames.length, 1);
    assert.equal(updated.routeState.reattachStream, true);
    assert.equal(updated.routeState.sourceSurface, 'work-order-map');
    assert.equal(updated.renderState.completedFiles, 1);
    assert.equal(updated.renderState.progress, 0.25);
    assert.equal(updated.renderEvents.at(-1).type, 'preview.firstFrame.ready');
  });

  it('keeps prepared preview sequence ready for final auto-render', () => {
    let project = createMediaProject({
      id: 'prepared-project',
      timeline: timeline(),
      renderState: {
        status: 'dirty',
        dirty: ['final-output'],
        pending: [],
        failures: [],
        settled: false,
        autoRenderReady: false,
      },
      preview: { status: 'queued' },
    });

    let updated = applyMediaRenderEvent(project, {
      type: 'preview.sequence.ready',
      status: 'ready',
      progress: 0.86,
      artifact: { kind: 'frame-sequence', frameCount: 60 },
    });

    assert.equal(updated.renderState.status, 'ready');
    assert.equal(updated.renderState.settled, true);
    assert.equal(updated.renderState.autoRenderReady, true);
    assert.deepEqual(updated.renderState.dirty, ['final-output']);
    assert.equal(updated.preview.status, 'ready');
    assert.equal(updated.preview.frameCount, 60);
  });

  it('preserves prepared render-job state before final export', () => {
    let project = createMediaProject({
      id: 'prepared-audio-project',
      timeline: timeline(),
      renderJob: {
        id: 'prepare-job-1',
        renderMode: 'prepare',
        status: 'ready',
        stage: 'preview.sequence.ready',
        finalOutputStale: true,
        outputUrl: '',
        audio: { mix: { url: '/render-cache/jobs/prepare-job-1/audio/narration.wav' } },
        frameCount: 6,
      },
    });

    assert.equal(project.renderJob.renderMode, 'prepare');
    assert.equal(project.renderJob.finalOutputStale, true);
    assert.equal(project.renderJob.outputUrl, '');
    assert.equal(project.renderJob.audio.mix.url, '/render-cache/jobs/prepare-job-1/audio/narration.wav');
    assert.equal(project.renderJob.frameCount, 6);
  });

  it('invalidates dependent artifacts for voice rerender without recreating the project', () => {
    let project = createMediaProject({
      id: 'voice-project',
      timeline: timeline(),
      preview: { status: 'ready', currentFrame: '/frames/frame-00000.png' },
      renderJob: { id: 'render-1', status: 'complete', progress: 1, outputUrl: '/render.mp4' },
      renderState: { status: 'ready', settled: true, autoRenderReady: true },
    });

    let updated = applyMediaRenderEvent(project, {
      type: 'audio.turn.rerender.requested',
      turnId: 'turn-1',
      persona: 'guide',
    });

    assert.equal(updated.id, project.id);
    assert.equal(updated.status, 'dirty');
    assert.equal(updated.renderState.autoRenderReady, false);
    assert.deepEqual(updated.renderState.dirty.sort(), [
      'action-timing',
      'captions',
      'final-output',
      'preview-sequence',
    ].sort());
    assert.equal(updated.preview.status, 'dirty');
  });

  it('invalidates frame cache when vertical format or resolution changes', () => {
    let project = createMediaProject({
      id: 'format-project',
      timeline: timeline(),
      renderSettings: { width: 1280, height: 720, aspectRatio: '16:9' },
      renderState: { status: 'ready', settled: true, autoRenderReady: true },
    });

    let updated = updateMediaProjectRenderSettings(project, {
      vertical: true,
      width: 1080,
      height: 1920,
    });

    assert.equal(updated.renderSettings.orientation, 'vertical');
    assert.equal(updated.renderSettings.aspectRatio, '9:16');
    assert.equal(updated.renderState.autoRenderReady, false);
    assert.deepEqual(updated.renderState.dirty.sort(), [
      'final-output',
      'frame-cache',
      'preview-sequence',
    ].sort());
  });

  it('invalidates audio-dependent artifacts when provider or voice settings change', () => {
    let project = createMediaProject({
      id: 'voice-settings-project',
      timeline: timeline(),
      renderSettings: {
        providerId: 'symbiote-model-service',
        voiceRefs: { guide: 'qwen3:speaker:vivian' },
      },
      renderState: { status: 'ready', settled: true, autoRenderReady: true },
      preview: { status: 'ready', currentFrame: '/frames/frame-0001.png' },
    });

    let updated = updateMediaProjectRenderSettings(project, {
      providerId: 'symbiote-model-service',
      voiceRefs: { guide: 'qwen3:speaker:eric' },
    });

    assert.equal(updated.renderSettings.voiceRefs.guide, 'qwen3:speaker:eric');
    assert.equal(updated.renderState.autoRenderReady, false);
    assert.deepEqual(updated.renderState.dirty.sort(), [
      'action-timing',
      'audio',
      'captions',
      'final-output',
      'preview-sequence',
    ].sort());
    assert.equal(updated.preview.status, 'dirty');
  });

  it('normalizes readiness, failures, and route reattach state', () => {
    let readiness = normalizeMediaRenderReadiness({
      expectedFiles: 5,
      completedFiles: 2,
      failures: [{ stage: 'caption.whisper', message: 'Whisper failed' }],
    });
    let route = normalizeMediaRenderRouteState({
      mediaProjectId: 'Project A',
      sourceSurface: 'orders',
      currentFrame: 42,
    });
    let invalidated = invalidateMediaProjectArtifacts(
      createMediaProject({ id: 'dirty-project', timeline: timeline() }),
      'format',
    );

    assert.equal(readiness.progress, 0.4);
    assert.equal(readiness.settled, false);
    assert.equal(readiness.failures[0].recoverable, true);
    assert.equal(route.mediaProjectId, 'project-a');
    assert.equal(route.previewFrame, 42);
    assert.equal(route.reattachStream, true);
    assert.deepEqual(invalidated.renderState.dirty.sort(), [
      'final-output',
      'frame-cache',
      'preview-sequence',
    ].sort());
  });

  it('creates route search with recoverable route state and no timeline payload', () => {
    let project = createMediaProject({
      id: 'demo-project',
      timeline: timeline(),
      routeState: {
        jobId: 'render-42',
        sourceSurface: 'work-order-map',
        sourceTabId: 'orders-tab',
        workspaceSection: 'tools',
        sourceUrl: '/workspace?surface=work-order-map',
        previewFrame: 42,
        previewMode: 'sequence',
        timelineCursorMs: 3500,
        reattachStream: true,
      },
    });
    let search = createMediaProjectRouteSearch(project, {
      search: '?verify=abc&tour-render=1',
      removeParams: ['tour-render'],
    });
    let parsed = parseMediaProjectRouteSearch(search);

    assert.equal(parsed.projectId, 'demo-project');
    assert.equal(parsed.surface, 'media-studio');
    assert.equal(parsed.routeState.mediaProjectId, 'demo-project');
    assert.equal(parsed.routeState.jobId, 'render-42');
    assert.equal(parsed.routeState.sourceSurface, 'work-order-map');
    assert.equal(parsed.routeState.sourceTabId, 'orders-tab');
    assert.equal(parsed.routeState.workspaceSection, 'tools');
    assert.equal(parsed.routeState.sourceUrl, '/workspace?surface=work-order-map');
    assert.equal(parsed.routeState.timelineId, 'media-project-tour');
    assert.equal(parsed.routeState.previewFrame, 42);
    assert.equal(parsed.routeState.previewMode, 'sequence');
    assert.equal(parsed.routeState.timelineCursorMs, 3500);
    assert.equal(parsed.routeState.reattachStream, true);
    assert.match(search, new RegExp(`${MEDIA_PROJECT_ROUTE_PARAM}=demo-project`));
    assert.match(search, new RegExp(`${MEDIA_PROJECT_ROUTE_WORKSPACE_SECTION_PARAM}=tools`));
    assert.match(search, new RegExp(`${MEDIA_PROJECT_ROUTE_TIMELINE_PARAM}=media-project-tour`));
    assert.match(search, new RegExp(`${MEDIA_PROJECT_ROUTE_PREVIEW_MODE_PARAM}=sequence`));
    assert.doesNotMatch(search, /turns|renderSettings|tour-render/);
  });

  it('preserves media project route state when routing source workspace sections', () => {
    let project = createMediaProject({
      id: 'section-route-project',
      timeline: timeline(),
      routeState: {
        jobId: 'render-section',
        sourceSurface: 'universal-api-adapter',
        sourceTabId: 'adapter-tab',
        sourceUrl: '/?surface=universal-api-adapter',
        previewFrame: 84,
        timelineCursorMs: 7000,
        reattachStream: true,
      },
    });
    let search = createMediaProjectRouteSearch(project, {
      search: '?verify=route-switch',
      surface: 'code-explorer',
    });
    let parsed = parseMediaProjectRouteSearch(search);

    assert.equal(parsed.surface, 'code-explorer');
    assert.equal(parsed.projectId, 'section-route-project');
    assert.equal(parsed.routeState.mediaProjectId, 'section-route-project');
    assert.equal(parsed.routeState.jobId, 'render-section');
    assert.equal(parsed.routeState.sourceSurface, 'universal-api-adapter');
    assert.equal(parsed.routeState.sourceTabId, 'adapter-tab');
    assert.equal(parsed.routeState.sourceUrl, '/?surface=universal-api-adapter');
    assert.equal(parsed.routeState.timelineId, 'media-project-tour');
    assert.equal(parsed.routeState.previewFrame, 84);
    assert.equal(parsed.routeState.timelineCursorMs, 7000);
    assert.equal(parsed.routeState.reattachStream, true);
    assert.match(search, new RegExp(`${MEDIA_PROJECT_ROUTE_TIMELINE_PARAM}=media-project-tour`));
    assert.doesNotMatch(search, /turns|renderSettings/);
  });

  it('does not parse absent cursor route params as zero', () => {
    let parsed = parseMediaProjectRouteSearch('?surface=media-studio&mediaProject=cursor-project');

    assert.equal(parsed.routeState.previewFrame, undefined);
    assert.equal(parsed.routeState.timelineCursorMs, undefined);

    let explicitZero = parseMediaProjectRouteSearch('?surface=media-studio&mediaProject=cursor-project&mediaProjectPreviewFrame=0&mediaProjectCursorMs=0');

    assert.equal(explicitZero.routeState.previewFrame, 0);
    assert.equal(explicitZero.routeState.timelineCursorMs, 0);
  });

  it('keeps media studio preview mode explicit and bounded', () => {
    assert.equal(normalizeMediaRenderRouteState({ previewMode: 'output' }).previewMode, 'output');
    assert.equal(normalizeMediaRenderRouteState({ previewMode: 'live-dom' }).previewMode, undefined);

    let parsed = parseMediaProjectRouteSearch('?surface=media-studio&mediaProject=preview-mode-project&mediaProjectPreviewMode=output');

    assert.equal(parsed.routeState.previewMode, 'output');
  });

  it('fails loud on invalid media project route numeric params', () => {
    assert.throws(
      () => parseMediaProjectRouteSearch('?surface=media-studio&mediaProject=cursor-project&mediaProjectCursorMs=abc'),
      (error) => {
        assert.equal(error.code, 'MEDIA_PROJECT_ROUTE_PARAM_INVALID');
        assert.equal(error.param, MEDIA_PROJECT_ROUTE_TIMELINE_CURSOR_PARAM);
        return true;
      },
    );
    assert.throws(
      () => parseMediaProjectRouteSearch('?surface=media-studio&mediaProject=cursor-project&mediaProjectPreviewFrame=-1'),
      (error) => {
        assert.equal(error.code, 'MEDIA_PROJECT_ROUTE_PARAM_INVALID');
        assert.equal(error.param, MEDIA_PROJECT_ROUTE_PREVIEW_FRAME_PARAM);
        return true;
      },
    );
  });

  it('clears stale optional media project route state when a project has no reattach route', () => {
    let project = createMediaProject({
      id: 'plain-project',
      timeline: timeline(),
    });

    let search = createMediaProjectRouteSearch(project, {
      search: '?surface=media-studio&mediaProjectSourceSurface=old&mediaProjectSourceTab=old-tab&mediaProjectSection=tools&mediaProjectPreviewFrame=9&mediaProjectJob=old-job&mediaProjectSourceUrl=%2Fold&mediaProjectCursorMs=9&mediaProjectReattach=1',
    });

    assert.match(search, /mediaProject=plain-project/);
    assert.doesNotMatch(search, /mediaProjectSourceSurface|mediaProjectSourceTab|mediaProjectSection|mediaProjectPreviewFrame|mediaProjectJob|mediaProjectSourceUrl|mediaProjectCursorMs|mediaProjectReattach/);
  });

  it('persists and updates projects through a storage-backed store', () => {
    let storage = memoryStorage();
    let store = createStorageMediaProjectStore(storage, { namespace: 'test:media' });
    let project = store.create({
      id: 'roundtrip-project',
      title: 'Roundtrip',
      timeline: timeline(),
      renderSettings: { includeAudio: true },
      renderRequest: {
        seed: { url: '/workspace?surface=orders' },
        render: { width: 1080, height: 1920, fps: 12 },
      },
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
    assert.equal(restored.renderRequest.seed.url, '/workspace?surface=orders');
    assert.equal(restored.renderRequest.render.height, 1920);
    assert.deepEqual(store.list().map((item) => item.id), ['roundtrip-project']);
  });
});
