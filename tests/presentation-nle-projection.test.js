import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeIntegrity } from '../schema/canonical-json.js';

import {
  applyPresentationAuthoringProjectCommand,
  createPresentationAlignedSequence,
  createPresentationAuthoringCommandFromNleEdit,
  createPresentationAuthoringProject,
  createPresentationAuthoringProjectFromTimeline,
  createPresentationScheduleV2,
  createPresentationTimelineContract,
  createPresentationAuthoringTimelineProjection,
  createPresentationTimelineEditorModel,
  bindPresentationNleTimelineEditor,
  projectPresentationNle,
} from '../index.js';

function fixture() {
  let timeline = createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'semantic-nle',
    title: 'Semantic NLE',
    locale: 'en-US',
    profile: 'brief',
    personas: { guide: { name: 'Guide', role: 'guide', locale: 'en-US' } },
    grounding: { sources: [] },
    turns: [{
      id: 'result',
      persona: 'guide',
      dialogueAct: 'explain',
      text: 'Open the panel and mark the result.',
      sourceRefs: [],
      claims: [],
      cues: [
        {
          kind: 'interaction',
          targetId: 'panel:result',
          at: {
            anchor: 'speech',
            quote: 'Open the panel',
            occurrence: 1,
            edge: 'start',
            offsetMs: 0,
          },
          interaction: {
            type: 'scroll',
            binding: { source: 'webmcp', tool: 'panel.reveal', input: { id: 'result' } },
          },
        },
        {
          kind: 'annotation',
          targetId: 'panel:result',
          at: {
            anchor: 'speech',
            quote: 'mark the result',
            occurrence: 1,
            edge: 'start',
            offsetMs: 0,
          },
          until: { anchor: 'turn-end', offsetMs: 0 },
          annotation: {
            intent: 'emphasize',
            marker: 'number',
            label: '2',
            series: 'result-review',
            quote: 'result',
            occurrence: 2,
            placement: 'over',
          },
        },
      ],
    }],
  });
  let { project: imported } = createPresentationAuthoringProjectFromTimeline(timeline);
  let scroll = imported.cells.find((cell) => cell.cue?.interaction?.type === 'scroll');
  let attention = imported.cells.find((cell) => cell.cue?.kind === 'annotation');
  let cells = imported.cells.map((cell) => {
    if (cell.id === scroll.id) {
      return {
        ...cell,
        timing: { ...cell.timing, leadMs: 200, gestureDurationMs: 300 },
      };
    }
    if (cell.id === attention.id) {
      return {
        ...cell,
        timing: {
          ...cell.timing,
          leadMs: 300,
          gestureDurationMs: 250,
          settleBy: 'anchor',
        },
        dependsOn: [{ cellId: scroll.id, barrier: 'settled' }],
      };
    }
    return cell;
  });
  let project = createPresentationAuthoringProject({ ...imported, cells });
  let projectedTimeline = createPresentationAuthoringTimelineProjection(project);
  let alignment = createPresentationAlignedSequence(projectedTimeline, {
    media: { hash: 'sha256-nle-audio', durationMs: 1800, locale: 'en-US' },
    turns: [{
      startMs: 0,
      endMs: 1800,
      transcript: projectedTimeline.turns[0].text,
      words: [
        { text: 'Open', startMs: 0, endMs: 180 },
        { text: 'the', startMs: 180, endMs: 250 },
        { text: 'panel', startMs: 250, endMs: 450 },
        { text: 'and', startMs: 650, endMs: 760 },
        { text: 'mark', startMs: 1000, endMs: 1160 },
        { text: 'the', startMs: 1160, endMs: 1240 },
        { text: 'result', startMs: 1240, endMs: 1500 },
      ],
    }],
  });
  let schedule = createPresentationScheduleV2(project, alignment);
  return { project, schedule, alignment, scroll, attention };
}

function turnEndAudioFixture() {
  let { project: baseline, alignment } = fixture();
  let narration = baseline.cells.find((cell) => cell.kind === 'narration');
  let layer = {
    id: 'semantic-nle:layer:audio',
    kind: 'audio',
    name: 'Narration audio',
    visualOwnerId: null,
    collisionDomainId: null,
  };
  let clip = {
    id: 'semantic-nle:audio:ending',
    kind: 'audio-clip',
    layerId: layer.id,
    turnId: narration.turnId,
    audio: {
      assetId: 'semantic-nle:asset:master',
      sourceInMs: 1300,
      sourceOutMs: 1800,
    },
    timing: { at: { anchor: 'turn-end', offsetMs: -500 } },
    dependsOn: [],
  };
  let project = createPresentationAuthoringProject({
    ...baseline,
    assets: [{
      id: 'semantic-nle:asset:master',
      kind: 'audio',
      mediaType: 'audio/wav',
      durationMs: 1800,
      contentHash: alignment.media.hash,
      alignmentHash: alignment.hash,
      sourceTimelineHash: alignment.timelineHash,
    }],
    layers: [...baseline.layers, layer],
    cells: [...baseline.cells, clip],
  });
  let schedule = createPresentationScheduleV2(project, alignment);
  return { project, schedule, alignment, clip };
}

function editBasis(nle) {
  return {
    authoringProjectHash: nle.authoringProjectHash,
    timelineHash: nle.timelineHash,
    scheduleHash: nle.scheduleHash,
    nleHash: nle.hash,
  };
}

describe('workspace presentation NLE projection', () => {
  it('projects semantic tracks in layer order and marks generated tracks non-editable', () => {
    let { project, schedule, alignment, attention } = fixture();
    let nle = projectPresentationNle(project, schedule);

    assert.deepEqual(nle.tracks.map((track) => track.layerId), project.layers.map((layer) => layer.id));
    assert.equal(nle.tracks.every((track) => !track.generated), true);
    assert.equal(nle.tracks.find(({ kind }) => kind === 'narration').editable, false);
    assert.equal(
      nle.tracks.every((track) => (
        track.editable === track.clips.some((clip) => clip.editable)
      )),
      true,
    );
    assert.equal(nle.generatedTracks.length > 0, true);
    assert.equal(nle.generatedTracks.every((track) => !track.editable && track.generated), true);
    assert.equal(nle.authoringProjectHash, project.hash);
    assert.equal(nle.scheduleHash, schedule.hash);
    assert.equal(
      nle.tracks.flatMap((track) => track.clips).length,
      project.cells.length,
    );
    assert.equal(
      nle.tracks.flatMap((track) => track.clips)
        .filter((clip) => clip.kind === 'cue')
        .every((clip) => clip.commandTypes.includes('cell.set-timing')),
      true,
    );
    let markerClip = nle.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.cellId === attention.id);
    assert.deepEqual(markerClip.cue, attention.cue);
  });

  it('projects the exact NLE graph into the visual timeline component model', () => {
    let { project, schedule, alignment, attention } = fixture();
    let nle = projectPresentationNle(project, schedule);
    let model = createPresentationTimelineEditorModel(project, schedule, { fps: 25 });
    let sourceTracks = [...nle.tracks, ...nle.generatedTracks];

    assert.equal(model.schemaVersion, 'workspace-presentation-timeline-editor-model-v1');
    assert.equal(model.authoringProjectHash, project.hash);
    assert.equal(model.scheduleHash, schedule.hash);
    assert.equal(model.nleHash, nle.hash);
    assert.equal(model.fps, 25);
    assert.deepEqual(model.tracks.map(({ id }) => id), sourceTracks.map(({ id }) => id));
    assert.deepEqual(
      model.tracks.flatMap(({ clips }) => clips.map(({ id }) => id)),
      sourceTracks.flatMap(({ clips }) => clips.map(({ id }) => id)),
    );
    assert.ok(model.tracks.some(({ type }) => type === 'audio'));
    assert.ok(model.tracks.some(({ type }) => type === 'actions'));
    assert.ok(model.tracks.some(({ type }) => type === 'effect'));
    let narrationTrack = model.tracks.find(({ kind }) => kind === 'narration');
    assert.equal(narrationTrack.editable, false);
    assert.equal(narrationTrack.clips.every(({ editable }) => editable === false), true);
    let attentionNleClip = sourceTracks
      .flatMap(({ clips }) => clips)
      .find(({ id }) => id === attention.id);
    let attentionEditorClip = model.tracks
      .flatMap(({ clips }) => clips)
      .find(({ id }) => id === attention.id);
    assert.equal(attentionNleClip.span.endMs, attentionNleClip.visibility.endMs);
    assert.deepEqual(attentionEditorClip.sourceSpan, attentionNleClip.span);
    assert.deepEqual(attentionEditorClip.gestureSpan, attentionNleClip.gesture);
    assert.deepEqual(attentionEditorClip.visibilitySpan, attentionNleClip.visibility);
    assert.ok(model.tracks.flatMap(({ clips }) => clips).every(({ start, end }) => (
      Number.isInteger(start) && Number.isInteger(end) && end > start
    )));
  });

  it('binds the visual timeline drag to the same semantic command path used by MCP and CLI', () => {
    let { project, schedule, alignment, clip } = turnEndAudioFixture();
    let listeners = new Map();
    let loaded = null;
    let edits = [];
    let editor = {
      loadTimeline(model) { loaded = model; },
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type, listener) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };
    let binding = bindPresentationNleTimelineEditor(editor, {
      project,
      schedule,
      fps: 25,
      onEdit: result => edits.push(result),
    });
    let audioClip = loaded.tracks
      .flatMap(({ clips }) => clips)
      .find(({ id }) => id === clip.id);

    assert.equal(binding.model, loaded);
    assert.equal(binding.nleHash, loaded.nleHash);
    listeners.get('clip-move')({ detail: {
      clipId: audioClip.id,
      start: audioClip.start + 1,
      fps: loaded.fps,
      phase: 'commit',
      source: 'pointer',
    } });
    assert.equal(edits.length, 1);
    assert.equal(edits[0].status, 'command');
    assert.equal(edits[0].command.type, 'audio-clip.move');
    let originalNleHash = loaded.nleHash;
    let applied = applyPresentationAuthoringProjectCommand(project, edits[0].command);
    let nextSchedule = createPresentationScheduleV2(applied.project, alignment);
    let nextModel = binding.rebind({ project: applied.project, schedule: nextSchedule });
    assert.equal(nextModel.authoringProjectHash, applied.project.hash);
    assert.equal(binding.model, nextModel);
    assert.notEqual(nextModel.nleHash, originalNleHash);

    let reboundAudioClip = loaded.tracks
      .flatMap(({ clips }) => clips)
      .find(({ id }) => id === clip.id);
    listeners.get('clip-move')({ detail: {
      clipId: reboundAudioClip.id,
      start: reboundAudioClip.start + 1,
      fps: loaded.fps,
      phase: 'commit',
    } });
    assert.equal(edits.length, 2);
    assert.equal(edits[1].status, 'command');
    assert.equal(edits[1].command.base.authoringProjectHash, applied.project.hash);
    assert.equal(edits[1].command.base.revision, applied.project.revision);

    let narrationClip = loaded.tracks
      .flatMap(({ clips }) => clips)
      .find(({ kind }) => kind === 'narration');
    listeners.get('clip-move')({ detail: {
      clipId: narrationClip.id,
      start: narrationClip.start + 1,
      fps: loaded.fps,
      phase: 'commit',
    } });
    assert.equal(edits.length, 2, 'read-only visual clips cannot enter the command translator');

    listeners.get('clip-move')({ detail: {
      clipId: reboundAudioClip.id,
      start: reboundAudioClip.start + 2,
      fps: loaded.fps,
      phase: 'preview',
    } });
    assert.equal(edits.length, 2, 'preview movement cannot commit a semantic command');
    assert.throws(
      () => listeners.get('clip-move')({ detail: {
        clipId: reboundAudioClip.id,
        start: reboundAudioClip.start + 2,
        fps: loaded.fps + 1,
        phase: 'commit',
      } }),
      /FPS does not match/u,
    );

    binding.dispose();
    assert.equal(listeners.has('clip-move'), false);
  });

  it('preserves an audio clip turn-end anchor when the visual editor moves it', () => {
    let { project, schedule, clip } = turnEndAudioFixture();
    let nle = projectPresentationNle(project, schedule);
    let projected = nle.tracks.flatMap(({ clips }) => clips).find(({ id }) => id === clip.id);
    let result = createPresentationAuthoringCommandFromNleEdit(project, schedule, nle, {
      id: 'move-ending-audio',
      type: 'clip.frame-drag',
      clipId: clip.id,
      frameMs: projected.span.startMs + 100,
      basis: editBasis(nle),
    });

    assert.equal(result.status, 'command');
    assert.equal(result.command.type, 'audio-clip.move');
    assert.deepEqual(result.command.payload.timing.at, {
      anchor: 'turn-end',
      offsetMs: -400,
    });
  });

  it('maps an exact unique frame only to a semantic anchor command', () => {
    let { project, schedule, attention } = fixture();
    let nle = projectPresentationNle(project, schedule);
    let attentionAnchor = nle.anchors.find((anchor) => (
      anchor.sourceCellId === attention.id && anchor.edge === 'at'
    ));
    let result = createPresentationAuthoringCommandFromNleEdit(project, schedule, nle, {
      id: 'drag-attention',
      type: 'clip.frame-drag',
      clipId: attention.id,
      frameMs: attentionAnchor.timeMs,
      basis: editBasis(nle),
    });

    assert.equal(result.status, 'command');
    assert.equal(result.command.type, 'cell.set-timing');
    assert.equal(result.command.payload.cellId, attention.id);
    assert.deepEqual(result.command.payload.timing.at, attentionAnchor.anchor);
    assert.equal(result.command.payload.timing.leadMs, 0);
    assert.equal('resolvedMs' in result.command.payload.timing, false);
    assert.equal('frameMs' in result.command.payload.timing, false);
  });

  it('returns semantic choices for a non-exact frame and resolves a chosen anchor', () => {
    let { project, schedule, attention } = fixture();
    let nle = projectPresentationNle(project, schedule);
    let attentionAnchor = nle.anchors.find((anchor) => (
      anchor.sourceCellId === attention.id && anchor.edge === 'at'
    ));
    let frameMs = attentionAnchor.timeMs - 120;
    let result = createPresentationAuthoringCommandFromNleEdit(project, schedule, nle, {
      id: 'ambiguous-drag',
      type: 'clip.frame-drag',
      clipId: attention.id,
      frameMs,
      basis: editBasis(nle),
    });

    assert.equal(result.status, 'anchor-choices');
    assert.equal(result.code, 'PRESENTATION_NLE_ANCHOR_CHOICES');
    assert.equal(result.choices.length >= 2, true);
    assert.equal(result.choices.every((choice) => (
      choice.anchor
      && Number.isInteger(choice.timeMs)
      && Number.isInteger(choice.leadMs)
      && choice.leadMs >= 0
    )), true);

    let chosen = result.choices.find((choice) => choice.id === attentionAnchor.id);
    let resolved = createPresentationAuthoringCommandFromNleEdit(project, schedule, nle, {
      id: 'chosen-drag',
      type: 'clip.frame-drag',
      clipId: attention.id,
      frameMs,
      anchorId: chosen.id,
      basis: editBasis(nle),
    });

    assert.equal(resolved.status, 'command');
    assert.deepEqual(resolved.command.payload.timing.at, attentionAnchor.anchor);
    assert.equal(resolved.command.payload.timing.leadMs, 120);
    assert.equal('resolvedMs' in resolved.command.payload.timing, false);
  });

  it('rejects a caller-mutated NLE even when its self-hash is recomputed', () => {
    let { project, schedule, attention } = fixture();
    let nle = projectPresentationNle(project, schedule);
    let forged = structuredClone(nle);
    forged.tracks[0].name = 'Caller-owned track name';
    delete forged.hash;
    forged.hash = `${forged.schemaVersion}:${computeIntegrity(forged)}`;

    assert.throws(
      () => createPresentationAuthoringCommandFromNleEdit(project, schedule, forged, {
        id: 'forged-nle',
        type: 'clip.frame-drag',
        clipId: attention.id,
        frameMs: 0,
        basis: editBasis(forged),
      }),
      (error) => error.code === 'PRESENTATION_NLE_STALE',
    );
  });

  it('binds edits to the exact schedule/NLE basis and keeps generated clips read-only', () => {
    let { project, schedule, attention } = fixture();
    let nle = projectPresentationNle(project, schedule);
    let generatedClip = nle.generatedTracks[0].clips[0];
    let staleBasis = { ...editBasis(nle), scheduleHash: 'stale-schedule' };

    assert.throws(
      () => createPresentationAuthoringCommandFromNleEdit(project, schedule, nle, {
        id: 'stale-basis',
        type: 'clip.frame-drag',
        clipId: attention.id,
        frameMs: 0,
        basis: staleBasis,
      }),
      (error) => error.code === 'PRESENTATION_NLE_STALE',
    );
    assert.throws(
      () => createPresentationAuthoringCommandFromNleEdit(project, schedule, nle, {
        id: 'generated-track-edit',
        type: 'clip.frame-drag',
        clipId: generatedClip.id,
        frameMs: 0,
        basis: editBasis(nle),
      }),
      (error) => error.code === 'PRESENTATION_NLE_EDIT_INVALID',
    );

    let forgedSchedule = structuredClone(schedule);
    forgedSchedule.presentationStartMs += 1;
    delete forgedSchedule.hash;
    forgedSchedule.hash = `${forgedSchedule.contractVersion}:${computeIntegrity(forgedSchedule)}`;
    assert.throws(
      () => createPresentationAuthoringCommandFromNleEdit(project, forgedSchedule, nle, {
        id: 'forged-schedule',
        type: 'clip.frame-drag',
        clipId: attention.id,
        frameMs: 0,
        basis: editBasis(nle),
      }),
      (error) => error.code === 'PRESENTATION_NLE_STALE',
    );
  });

  it('returns a typed rejection for a chosen anchor with a negative lead', () => {
    let { project, schedule, attention } = fixture();
    let nle = projectPresentationNle(project, schedule);
    let anchor = nle.anchors.find((item) => (
      item.sourceCellId === attention.id && item.edge === 'at'
    ));
    let result = createPresentationAuthoringCommandFromNleEdit(project, schedule, nle, {
      id: 'negative-lead',
      type: 'clip.frame-drag',
      clipId: attention.id,
      frameMs: anchor.timeMs + 1,
      anchorId: anchor.id,
      basis: editBasis(nle),
    });

    assert.equal(result.status, 'rejected');
    assert.equal(result.code, 'PRESENTATION_NLE_LEAD_INVALID');
  });
});
