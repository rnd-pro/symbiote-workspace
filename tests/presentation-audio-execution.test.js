import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as workspace from '../index.js';

function deferred() {
  let resolve;
  let reject;
  let promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function timelineFixture() {
  return workspace.createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'audio-clip-execution',
    title: 'Audio clip execution',
    locale: 'en-US',
    profile: 'brief',
    personas: {
      guide: { name: 'Guide', role: 'guide', locale: 'en-US' },
    },
    grounding: { sources: [] },
    turns: [{
      id: 'explain-result',
      persona: 'guide',
      dialogueAct: 'explain',
      text: 'Alpha bridge bravo.',
      sourceRefs: [],
      claims: [],
      cues: [{
        kind: 'interaction',
        targetId: 'panel:result',
        at: {
          anchor: 'speech',
          quote: 'bridge',
          occurrence: 1,
          edge: 'start',
          offsetMs: 0,
        },
        interaction: {
          type: 'scroll',
          binding: {
            source: 'webmcp',
            tool: 'panel.reveal',
            input: { id: 'result' },
          },
          reversible: true,
        },
      }],
    }],
  });
}

function audioClipFixture() {
  let { project: baseline } = workspace.createPresentationAuthoringProjectFromTimeline(
    timelineFixture(),
  );
  let sourceTimeline = workspace.createPresentationAuthoringTimelineProjection(baseline);
  let sourceAlignment = workspace.createPresentationAlignedSequence(sourceTimeline, {
    media: { hash: 'sha256-master-audio', durationMs: 2000, locale: 'en-US' },
    turns: [{
      startMs: 0,
      endMs: 2000,
      transcript: sourceTimeline.turns[0].text,
      words: [
        { text: 'Alpha', startMs: 0, endMs: 650 },
        { text: 'bridge', startMs: 800, endMs: 1100 },
        { text: 'bravo', startMs: 1200, endMs: 1900 },
      ],
    }],
  });
  let narration = baseline.cells.find((cell) => cell.kind === 'narration');
  let event = baseline.cells.find((cell) => cell.kind === 'cue');
  let audioLayer = {
    id: 'audio-clip-execution:layer:audio',
    kind: 'audio',
    name: 'Narration audio',
    visualOwnerId: null,
    collisionDomainId: null,
  };
  let clipA = {
    id: 'audio-clip-execution:audio:a',
    kind: 'audio-clip',
    layerId: audioLayer.id,
    turnId: narration.turnId,
    audio: {
      assetId: 'audio-clip-execution:asset:master',
      sourceInMs: 0,
      sourceOutMs: 700,
    },
    timing: { at: { anchor: 'turn-start', offsetMs: 0 } },
    dependsOn: [],
  };
  let clipB = {
    id: 'audio-clip-execution:audio:b',
    kind: 'audio-clip',
    layerId: audioLayer.id,
    turnId: narration.turnId,
    audio: {
      assetId: 'audio-clip-execution:asset:master',
      sourceInMs: 1200,
      sourceOutMs: 2000,
    },
    timing: { at: { anchor: 'turn-start', offsetMs: 700 } },
    dependsOn: [{ cellId: event.id, barrier: 'settled' }],
  };
  let configuredEvent = {
    ...event,
    timing: {
      ...event.timing,
      gestureDurationMs: 300,
      settleBy: 'none',
    },
    dependsOn: [{ cellId: clipA.id, barrier: 'ended' }],
  };
  let project = workspace.createPresentationAuthoringProject({
    ...baseline,
    assets: [{
      id: 'audio-clip-execution:asset:master',
      kind: 'audio',
      mediaType: 'audio/wav',
      durationMs: 2000,
      contentHash: 'sha256-master-audio',
      alignmentHash: sourceAlignment.hash,
      sourceTimelineHash: sourceTimeline.hash,
    }],
    layers: [...baseline.layers, audioLayer],
    cells: [
      narration,
      clipA,
      configuredEvent,
      clipB,
    ],
  });
  let timeline = workspace.createPresentationAuthoringTimelineProjection(project);
  assert.equal(timeline.hash, sourceTimeline.hash);
  let alignment = workspace.validatePresentationAlignedSequence(sourceAlignment, timeline);
  let schedule = workspace.createPresentationScheduleV2(project, alignment);
  let playbackPlan = workspace.createPresentationPlaybackPlan(project, schedule);
  return {
    project,
    alignment,
    schedule,
    playbackPlan,
    clipA,
    clipB,
    event: configuredEvent,
  };
}

function clipProjection(value) {
  return {
    id: value.id,
    assetId: value.audio.assetId,
    sourceInMs: value.audio.sourceInMs,
    sourceOutMs: value.audio.sourceOutMs,
  };
}

function executionFixture({ failEvent = false } = {}) {
  let fixture = audioClipFixture();
  let audioA = deferred();
  let audioB = deferred();
  let eventDeferred = deferred();
  let calls = [];
  let audioInputs = [];
  let eventInputs = [];
  let execution = workspace.createPresentationExecutionController({
    project: fixture.project,
    alignedSequence: fixture.alignment,
    schedule: fixture.schedule,
    adapter: {
      playAudioClip(input) {
        audioInputs.push(input);
        calls.push(`audio:${input.projectCell.id}`);
        if (input.projectCell.id === fixture.clipA.id) return audioA.promise;
        if (input.projectCell.id === fixture.clipB.id) return audioB.promise;
        throw new Error(`unexpected audio clip: ${input.projectCell.id}`);
      },
      runInteraction(input) {
        eventInputs.push(input);
        calls.push(`event:${input.projectCell.id}`);
        return failEvent
          ? Promise.reject(new Error('required event failed'))
          : eventDeferred.promise;
      },
    },
  });
  return {
    ...fixture,
    execution,
    calls,
    audioA,
    audioB,
    eventDeferred,
    audioInputs,
    eventInputs,
  };
}

function observation() {
  return {
    domain: 'performance',
    timeOriginMs: performance.timeOrigin,
    monotonicTimeMs: performance.now(),
  };
}

function finishAudio(input) {
  input.reportReceipt({
    status: 'ended',
    observedAt: observation(),
    providerReceipt: {
      clipId: input.projectCell.id,
      assetId: input.projectCell.audio.assetId,
      sourceContentHash: input.sourceAsset.contentHash,
      sourceInMs: input.projectCell.audio.sourceInMs,
      sourceOutMs: input.projectCell.audio.sourceOutMs,
    },
  });
}

function settleInteraction(input) {
  input.reportReceipt({
    status: 'acted',
    observedAt: observation(),
    providerReceipt: { cellId: input.projectCell.id, milestone: 'acted' },
  });
  input.reportReceipt({
    status: 'settled',
    observedAt: observation(),
    providerReceipt: { cellId: input.projectCell.id, milestone: 'settled' },
  });
}

describe('presentation audio clips share one authoring, NLE, and headless execution graph', () => {
  it('projects authored audio clips into NLE and playback with identical IDs and source ranges', () => {
    let fixture = audioClipFixture();
    let nle = workspace.projectPresentationNle(fixture.project, fixture.schedule);
    let audioTrack = nle.tracks.find((track) => track.kind === 'audio');

    assert.ok(audioTrack, 'the authored audio layer must be an ordinary NLE track');
    assert.equal(audioTrack.editable, true);
    assert.equal(audioTrack.generated, false);
    assert.deepEqual(
      audioTrack.clips.map(clipProjection),
      [fixture.clipA, fixture.clipB].map(clipProjection),
    );
    assert.deepEqual(
      fixture.playbackPlan.clips.map(clipProjection),
      audioTrack.clips.map(clipProjection),
    );
    assert.equal(fixture.playbackPlan.cells.length, fixture.project.cells.length);
    assert.equal(fixture.playbackPlan.narration.length, 1);
    assert.deepEqual(fixture.playbackPlan.events.map((cell) => cell.id), [fixture.event.id]);
    assert.equal(
      nle.generatedTracks.some((track) => track.id === 'generated:narration-audio'),
      false,
      'the NLE must not invent a second generated master-audio timeline',
    );
  });

  it('does not finish the entry at clip A end and admits B only after event E settles', async () => {
    let fixture = executionFixture();
    fixture.execution.sample({ mediaTimeMs: 0, reason: 'playing' });
    assert.deepEqual(fixture.calls, [`audio:${fixture.clipA.id}`]);

    finishAudio(fixture.audioInputs[0]);
    fixture.audioA.resolve();
    await fixture.execution.whenIdle();
    assert.equal(
      fixture.execution.snapshot.terminal.some((item) => item.cellId === fixture.clipB.id),
      false,
      'the first native audio end cannot end the semantic entry',
    );

    fixture.execution.sample({ mediaTimeMs: 800, reason: 'playing' });
    assert.deepEqual(fixture.calls, [
      `audio:${fixture.clipA.id}`,
      `event:${fixture.event.id}`,
    ]);

    fixture.execution.sample({ mediaTimeMs: 1100, reason: 'playing' });
    assert.equal(fixture.audioInputs.length, 1, 'clip B cannot start before settlement');
    settleInteraction(fixture.eventInputs[0]);
    fixture.eventDeferred.resolve();
    await fixture.execution.whenIdle();
    fixture.execution.sample({ mediaTimeMs: 1100, reason: 'playing' });
    assert.deepEqual(fixture.calls, [
      `audio:${fixture.clipA.id}`,
      `event:${fixture.event.id}`,
      `audio:${fixture.clipB.id}`,
    ]);

    finishAudio(fixture.audioInputs[1]);
    fixture.audioB.resolve();
    await fixture.execution.whenIdle();
    assert.equal(
      fixture.execution.snapshot.terminal.some((item) => (
        item.cellId === fixture.clipB.id && item.status === 'completed'
      )),
      true,
    );
  });

  it('never admits clip B when its required event fails', async () => {
    let fixture = executionFixture({ failEvent: true });
    fixture.execution.sample({ mediaTimeMs: 0, reason: 'playing' });
    finishAudio(fixture.audioInputs[0]);
    fixture.audioA.resolve();
    await fixture.execution.whenIdle();
    fixture.execution.sample({ mediaTimeMs: 800, reason: 'playing' });
    await fixture.execution.whenIdle();
    fixture.execution.sample({ mediaTimeMs: 1100, reason: 'playing' });
    assert.deepEqual(fixture.calls, [
      `audio:${fixture.clipA.id}`,
      `event:${fixture.event.id}`,
    ]);
  });

  it('rejects an audio completion receipt that does not bind the exact Project clip range', async () => {
    let fixture = executionFixture();
    fixture.execution.sample({ mediaTimeMs: 0, reason: 'playing' });
    let input = fixture.audioInputs[0];

    assert.throws(
      () => input.reportReceipt({
        status: 'ended',
        observedAt: observation(),
        providerReceipt: {
          clipId: input.projectCell.id,
          assetId: input.projectCell.audio.assetId,
          sourceContentHash: input.sourceAsset.contentHash,
          sourceInMs: input.projectCell.audio.sourceInMs,
          sourceOutMs: input.projectCell.audio.sourceOutMs + 1,
        },
      }),
      (error) => error.code === 'PRESENTATION_AUDIO_RECEIPT_SOURCE_MISMATCH',
    );
    await fixture.execution.whenIdle();
    fixture.execution.sample({ mediaTimeMs: 1100, reason: 'playing' });
    assert.equal(fixture.audioInputs.length, 1);
  });

  it('uses the main controller lifecycle and restarts an interrupted clip at the sampled source position', async () => {
    let fixture = executionFixture();
    fixture.execution.sample({ mediaTimeMs: 250, reason: 'playing' });
    let first = fixture.audioInputs[0];
    assert.equal(first.playback.sourcePositionMs, 250);

    await fixture.execution.pause();
    assert.equal(first.signal.aborted, true);
    fixture.execution.resume();
    fixture.execution.sample({ mediaTimeMs: 400, reason: 'resume-timeupdate' });
    let resumed = fixture.audioInputs[1];
    assert.equal(resumed.playback.sourcePositionMs, 400);

    await fixture.execution.seek();
    assert.equal(resumed.signal.aborted, true);
    fixture.execution.sample({ mediaTimeMs: 550, reason: 'seeked' });
    assert.equal(fixture.audioInputs[2].playback.sourcePositionMs, 550);
  });
});
