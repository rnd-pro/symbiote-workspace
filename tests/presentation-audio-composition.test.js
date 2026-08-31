import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as workspace from '../index.js';

function fixture({ sourceInMs = 900, sourceOutMs = 3000, offsetMs = 500 } = {}) {
  let timeline = workspace.createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'audio-composition-demo',
    title: 'Audio composition demo',
    locale: 'en-US',
    profile: 'brief',
    personas: { guide: { name: 'Guide', role: 'guide', locale: 'en-US' } },
    grounding: { sources: [] },
    turns: [{
      id: 'overview',
      persona: 'guide',
      dialogueAct: 'explain',
      text: 'Alpha bridge bravo.',
      sourceRefs: [],
      claims: [],
      cues: [],
    }],
  });
  let { project: baseline } = workspace.createPresentationAuthoringProjectFromTimeline(timeline);
  let sourceTimeline = workspace.createPresentationAuthoringTimelineProjection(baseline);
  let alignment = workspace.createPresentationAlignedSequence(sourceTimeline, {
    media: { hash: 'sha256-master-audio', durationMs: 4000, locale: 'en-US' },
    turns: [{
      startMs: 0,
      endMs: 4000,
      transcript: 'Alpha bridge bravo.',
      words: [
        { text: 'Alpha', startMs: 100, endMs: 900 },
        { text: 'bridge', startMs: 1000, endMs: 1800 },
        { text: 'bravo', startMs: 2000, endMs: 3000 },
      ],
    }],
  });
  let narration = baseline.cells.find((cell) => cell.kind === 'narration');
  let asset = {
    id: 'asset:narration-master',
    kind: 'audio',
    mediaType: 'audio/wav',
    durationMs: 4000,
    contentHash: 'sha256-master-audio',
    alignmentHash: alignment.hash,
    sourceTimelineHash: sourceTimeline.hash,
  };
  let layer = {
    id: 'audio-composition-demo:layer:audio',
    kind: 'audio',
    name: 'Narration audio',
    visualOwnerId: null,
    collisionDomainId: null,
  };
  let clip = {
    id: 'audio-clip:overview',
    kind: 'audio-clip',
    layerId: layer.id,
    turnId: narration.turnId,
    audio: { assetId: asset.id, sourceInMs, sourceOutMs },
    timing: { at: { anchor: 'turn-start', offsetMs } },
    dependsOn: [],
  };
  let project = workspace.createPresentationAuthoringProject({
    ...baseline,
    assets: [asset],
    layers: [...baseline.layers, layer],
    cells: [...baseline.cells, clip],
  });
  let schedule = workspace.createPresentationScheduleV2(project, alignment);
  let source = {
    assetId: asset.id,
    contentHash: asset.contentHash,
    alignmentHash: asset.alignmentHash,
    durationMs: asset.durationMs,
    words: [
      { text: 'Alpha', startMs: 100, endMs: 900 },
      { text: 'bridge', startMs: 1000, endMs: 1800 },
      { text: 'bravo', startMs: 2000, endMs: 3000 },
    ],
  };
  return { project, schedule, source, asset, clip };
}

describe('presentation audio composition release', () => {
  it('reuses approved source evidence and shifts complete source words into presentation time', () => {
    let { project, schedule, source, asset, clip } = fixture();
    let composition = workspace.createPresentationAudioComposition(
      project,
      schedule,
      { sources: [source] },
    );
    assert.equal(
      composition.version,
      workspace.PRESENTATION_AUDIO_COMPOSITION_VERSION,
    );
    assert.equal(composition.authoringProjectHash, project.hash);
    assert.equal(composition.scheduleHash, schedule.hash);
    assert.deepEqual(composition.sources, [{
      assetId: asset.id,
      contentHash: asset.contentHash,
      alignmentHash: asset.alignmentHash,
      durationMs: asset.durationMs,
    }]);
    assert.deepEqual(composition.clips, [{
      clipId: clip.id,
      turnId: clip.turnId,
      assetId: asset.id,
      sourceContentHash: asset.contentHash,
      sourceAlignmentHash: asset.alignmentHash,
      sourceInMs: 900,
      sourceOutMs: 3000,
      timelineInMs: 500,
      timelineOutMs: 2600,
      durationMs: 2100,
      words: [
        { text: 'bridge', startMs: 600, endMs: 1400 },
        { text: 'bravo', startMs: 1600, endMs: 2600 },
      ],
    }]);
    assert.deepEqual(workspace.validatePresentationAudioComposition(composition), composition);
  });

  it('turns a negative authored audio offset into deterministic nonnegative presentation pre-roll', () => {
    let { project, schedule, source, clip } = fixture({ offsetMs: -500 });
    let scheduled = schedule.cells.find((cell) => cell.cellId === clip.id);
    assert.equal(schedule.presentationStartMs, 500);
    assert.equal(scheduled.audio.startMs, 0);
    assert.equal(scheduled.audio.endMs, clip.audio.sourceOutMs - clip.audio.sourceInMs);

    let composition = workspace.createPresentationAudioComposition(
      project,
      schedule,
      { sources: [source] },
    );
    assert.equal(composition.clips[0].timelineInMs, 0);
  });

  it('rejects missing or stale approved source evidence and word-interior cuts', () => {
    let valid = fixture();
    assert.throws(
      () => workspace.createPresentationAudioComposition(valid.project, valid.schedule, { sources: [] }),
      (error) => error.code === 'PRESENTATION_AUDIO_COMPOSITION_SOURCE_MISSING',
    );
    assert.throws(
      () => workspace.createPresentationAudioComposition(valid.project, valid.schedule, {
        sources: [{ ...valid.source, contentHash: 'sha256-stale' }],
      }),
      (error) => error.code === 'PRESENTATION_AUDIO_COMPOSITION_SOURCE_STALE',
    );
    let partial = fixture({ sourceInMs: 101 });
    assert.throws(
      () => workspace.createPresentationAudioComposition(
        partial.project,
        partial.schedule,
        { sources: [partial.source] },
      ),
      (error) => error.code === 'PRESENTATION_AUDIO_COMPOSITION_WORD_CUT',
    );
  });

  it('changes only composition lineage for a legal one-millisecond silence trim', () => {
    let original = fixture({ sourceInMs: 900 });
    let trimmed = fixture({ sourceInMs: 901 });
    let before = workspace.createPresentationAudioComposition(
      original.project,
      original.schedule,
      { sources: [original.source] },
    );
    let after = workspace.createPresentationAudioComposition(
      trimmed.project,
      trimmed.schedule,
      { sources: [trimmed.source] },
    );
    assert.notEqual(after.hash, before.hash);
    assert.notEqual(after.authoringProjectHash, before.authoringProjectHash);
    assert.deepEqual(after.sources, before.sources);
    assert.equal(trimmed.asset.contentHash, original.asset.contentHash);
    assert.equal(trimmed.asset.alignmentHash, original.asset.alignmentHash);
    assert.equal(trimmed.asset.sourceTimelineHash, original.asset.sourceTimelineHash);
  });

  it('creates a deterministic exact delivery manifest and enforces decoded duration tolerance', () => {
    let { project, schedule, source, clip } = fixture();
    let composition = workspace.createPresentationAudioComposition(
      project,
      schedule,
      { sources: [source] },
    );
    let artifacts = [{
      clipId: clip.id,
      sourceContentHash: source.contentHash,
      sourceInMs: 900,
      sourceOutMs: 3000,
      deliveryHash: 'sha256-materialized-clip',
      decodedDurationMs: 2119,
      mediaType: 'audio/wav',
    }];
    let first = workspace.createPresentationAudioDeliveryManifest(composition, { artifacts });
    let second = workspace.createPresentationAudioDeliveryManifest(composition, { artifacts });
    assert.deepEqual(first, second);
    assert.equal(first.compositionHash, composition.hash);
    assert.deepEqual(first.clips, artifacts);
    assert.throws(
      () => workspace.createPresentationAudioDeliveryManifest(composition, {
        artifacts: [{ ...artifacts[0], decodedDurationMs: 2121 }],
      }),
      (error) => error.code === 'PRESENTATION_AUDIO_DELIVERY_DURATION_MISMATCH',
    );
  });
});
