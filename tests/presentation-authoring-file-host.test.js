import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import * as rootApi from '../index.js';
import * as runtimeApi from '../runtime/index.js';

function projectFixture() {
  const timeline = rootApi.createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'file-authoring-demo',
    title: 'File authoring demo',
    locale: 'en-US',
    profile: 'brief',
    personas: { guide: { name: 'Guide', role: 'guide', locale: 'en-US' } },
    grounding: { sources: [] },
    turns: [{
      id: 'overview',
      persona: 'guide',
      dialogueAct: 'explain',
      text: 'Show the result.',
      sourceRefs: [],
      claims: [],
      cues: [],
    }],
  });
  const { project: imported } = rootApi.createPresentationAuthoringProjectFromTimeline(timeline);
  const narration = imported.cells.find((cell) => cell.kind === 'narration');
  const asset = {
    id: 'asset:narration',
    kind: 'audio',
    mediaType: 'audio/wav',
    durationMs: 4000,
    contentHash: 'sha256-narration',
    alignmentHash: 'sha256-alignment',
    sourceTimelineHash: timeline.hash,
  };
  const audioLayer = {
    id: 'file-authoring-demo:layer:audio',
    kind: 'audio',
    name: 'Narration audio',
    visualOwnerId: null,
    collisionDomainId: null,
  };
  const clip = {
    id: 'audio-clip:overview',
    kind: 'audio-clip',
    layerId: audioLayer.id,
    turnId: narration.turnId,
    audio: { assetId: asset.id, sourceInMs: 0, sourceOutMs: 4000 },
    timing: { at: { anchor: 'turn-start', offsetMs: 0 } },
    dependsOn: [],
  };
  const project = rootApi.createPresentationAuthoringProject({
    ...imported,
    assets: [asset],
    layers: [...imported.layers, audioLayer],
    cells: [...imported.cells, clip],
  });
  return { project, clip, asset };
}

function base(project) {
  return { revision: project.revision, authoringProjectHash: project.hash };
}

async function withTempDir(run) {
  const tmpRoot = resolve(import.meta.dirname, '..', 'tmp');
  await mkdir(tmpRoot, { recursive: true });
  const dir = await mkdtemp(join(tmpRoot, 'presentation-file-host-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('file-backed presentation authoring host', () => {
  it('exports one reusable file authority and host from the Node-safe public APIs', () => {
    for (const api of [rootApi, runtimeApi]) {
      assert.equal(typeof api.createPresentationAuthoringFileAuthority, 'function');
      assert.equal(typeof api.createPresentationAuthoringFileHost, 'function');
    }
  });

  it('atomically edits the raw canonical Project and rejects stale or invalid writes unchanged', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'project.json');
      const { project, clip, asset } = projectFixture();
      await writeJson(file, project);
      const host = rootApi.createPresentationAuthoringFileHost({ projectFile: file });

      const originalBytes = await readFile(file, 'utf8');
      const inspected = await host.invoke('presentation_authoring_inspect', {});
      assert.deepEqual(inspected.project, project);
      assert.equal(await readFile(file, 'utf8'), originalBytes);

      const trimmed = await host.invoke('presentation_authoring_audio_clip_trim', {
        id: 'trim-file-audio',
        base: base(project),
        payload: { cellId: clip.id, sourceInMs: 500, sourceOutMs: 3500 },
      });
      const persisted = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(persisted.schemaVersion, 'workspace-presentation-authoring-project-v2');
      assert.equal(Object.hasOwn(persisted, 'project'), false);
      assert.deepEqual(persisted.assets, [asset]);
      assert.deepEqual(
        persisted.cells.find((cell) => cell.id === clip.id).audio,
        { assetId: asset.id, sourceInMs: 500, sourceOutMs: 3500 },
      );
      assert.equal(persisted.hash, trimmed.project.hash);

      const stableBytes = await readFile(file, 'utf8');
      await assert.rejects(
        host.invoke('presentation_authoring_audio_clip_trim', {
          id: 'stale-trim',
          base: base(project),
          payload: { cellId: clip.id, sourceInMs: 750, sourceOutMs: 3000 },
        }),
        (error) => error.code === 'PRESENTATION_AUTHORING_TOOL_STALE',
      );
      assert.equal(await readFile(file, 'utf8'), stableBytes);

      await assert.rejects(
        host.invoke('presentation_authoring_audio_clip_trim', {
          id: 'invalid-trim',
          base: base(persisted),
          payload: { cellId: clip.id, sourceInMs: 3600, sourceOutMs: 3600 },
        }),
      );
      assert.equal(await readFile(file, 'utf8'), stableBytes);
      assert.deepEqual(await readdir(dir), ['project.json']);
    });
  });

  it('preserves a snapshot envelope and fails regeneration explicitly without a provider', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'snapshot.json');
      const { project, clip } = projectFixture();
      await writeJson(file, { project });
      const host = rootApi.createPresentationAuthoringFileHost({ projectFile: file });

      const moved = await host.invoke('presentation_authoring_audio_clip_move', {
        id: 'move-snapshot-audio',
        base: base(project),
        payload: {
          cellId: clip.id,
          timing: { at: { anchor: 'turn-start', offsetMs: 250 } },
        },
      });
      const persisted = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(persisted.project.hash, moved.project.hash);
      assert.equal(persisted.project.cells.find((cell) => cell.id === clip.id).timing.at.offsetMs, 250);
      assert.equal(Object.hasOwn(persisted, 'project'), true);

      const stableBytes = await readFile(file, 'utf8');
      await assert.rejects(
        host.invoke('presentation_authoring_regeneration_request', {
          id: 'regen-without-provider',
          base: base(persisted.project),
          dependency: 'narration-audio',
        }),
        (error) => error.code === 'PRESENTATION_AUTHORING_REGENERATION_UNAVAILABLE',
      );
      assert.equal(await readFile(file, 'utf8'), stableBytes);
    });
  });
});
