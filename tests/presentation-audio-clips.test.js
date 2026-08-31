import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
  PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION,
  applyPresentationAuthoringProjectCommand,
  createPresentationAuthoringProject,
  createPresentationAuthoringProjectFromTimeline,
  createPresentationAuthoringTimelineProjection,
  createPresentationAlignedSequence,
  createPresentationScheduleV2,
  projectPresentationNle,
  createPresentationAuthoringCommandFromNleEdit,
  createPresentationTimelineContract,
  invertPresentationAuthoringProjectCommand,
  listPresentationAuthoringProjectCommandDescriptors,
  listPresentationAuthoringToolDescriptors,
} from '../index.js';

const PROJECT_V2 = 'workspace-presentation-authoring-project-v2';

function timelineFixture() {
  return createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'audio-clip-demo',
    title: 'Audio clip demo',
    locale: 'en-US',
    profile: 'brief',
    personas: {
      guide: {
        name: 'Guide',
        role: 'guide',
        locale: 'en-US',
      },
    },
    grounding: { sources: [] },
    turns: [{
      id: 'overview',
      persona: 'guide',
      dialogueAct: 'explain',
      text: 'Show the first result, then reveal the second result.',
      sourceRefs: [],
      claims: [],
      cues: [{
        kind: 'annotation',
        targetId: 'panel:result',
        at: {
          anchor: 'speech',
          quote: 'first result',
          occurrence: 1,
          edge: 'start',
          offsetMs: 0,
        },
        until: { anchor: 'turn-end', offsetMs: 0 },
        annotation: {
          intent: 'emphasize',
          marker: 'circle',
          placement: 'over',
        },
      }],
    }],
  });
}

function command(project, id, type, payload) {
  return {
    schemaVersion: PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
    id,
    base: {
      revision: project.revision,
      authoringProjectHash: project.hash,
    },
    type,
    payload,
  };
}

function withoutRevisionAndHash(project) {
  let value = structuredClone(project);
  delete value.revision;
  delete value.hash;
  return value;
}

function projectFixture() {
  let timeline = timelineFixture();
  let { project: imported } = createPresentationAuthoringProjectFromTimeline(timeline);
  let narration = imported.cells.find((cell) => cell.kind === 'narration');
  let event = imported.cells.find((cell) => cell.kind === 'cue');
  let asset = {
    id: 'asset:narration-master',
    kind: 'audio',
    mediaType: 'audio/wav',
    durationMs: 9000,
    contentHash: 'sha256-narration-master',
    alignmentHash: 'sha256-narration-alignment',
    sourceTimelineHash: timeline.hash,
  };
  let audioLayer = {
    id: 'audio-clip-demo:layer:audio',
    kind: 'audio',
    name: 'Narration audio',
    visualOwnerId: null,
    collisionDomainId: null,
  };
  let clips = [
    {
      id: 'audio-clip:overview:1',
      kind: 'audio-clip',
      layerId: audioLayer.id,
      turnId: narration.turnId,
      audio: {
        assetId: asset.id,
        sourceInMs: 0,
        sourceOutMs: 4000,
      },
      timing: { at: { anchor: 'turn-start', offsetMs: 0 } },
      dependsOn: [],
    },
    {
      id: 'audio-clip:overview:2',
      kind: 'audio-clip',
      layerId: audioLayer.id,
      turnId: narration.turnId,
      audio: {
        assetId: asset.id,
        sourceInMs: 4000,
        sourceOutMs: 9000,
      },
      timing: { at: { anchor: 'turn-start', offsetMs: 4000 } },
      dependsOn: [],
    },
  ];
  let project = createPresentationAuthoringProject({
    ...imported,
    schemaVersion: PROJECT_V2,
    assets: [asset],
    layers: [...imported.layers, audioLayer],
    cells: [...imported.cells, ...clips],
  });
  return { project, timeline, narration, event, asset, audioLayer, clips };
}

function assertMutation(before, application) {
  assert.equal(application.project.revision, before.revision + 1);
  assert.notEqual(application.project.hash, before.hash);
  assert.deepEqual(application.project.assets, before.assets);
}

describe('workspace presentation authoring project v2 audio clips', () => {
  it('keeps semantic narration singular while audio cuts are first-class cells over immutable assets', () => {
    let timeline = timelineFixture();
    let { project: imported } = createPresentationAuthoringProjectFromTimeline(timeline);

    assert.equal(PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION, PROJECT_V2);
    assert.equal(imported.schemaVersion, PROJECT_V2);
    assert.deepEqual(imported.assets, []);

    let { project, asset, clips } = projectFixture();
    let projection = createPresentationAuthoringTimelineProjection(project);

    assert.equal(project.layers.some((layer) => layer.kind === 'audio'), true);
    assert.deepEqual(project.assets, [asset]);
    assert.deepEqual(
      project.cells.filter((cell) => cell.kind === 'audio-clip'),
      clips,
    );
    assert.equal(
      project.cells.filter((cell) => cell.kind === 'narration' && cell.turnId === 'overview').length,
      1,
    );
    assert.equal(projection.turns.length, 1);
    assert.equal(projection.turns[0].text, timeline.turns[0].text);
    assert.equal(projection.hash, timeline.hash);
  });

  it('rejects unresolved audio assets and non-half-open or out-of-bounds source ranges', () => {
    let { project, clips } = projectFixture();
    let withFirstClip = (mutate) => ({
      ...project,
      cells: project.cells.map((cell) => (
        cell.id === clips[0].id ? mutate(structuredClone(cell)) : cell
      )),
    });

    assert.throws(
      () => createPresentationAuthoringProject(withFirstClip((cell) => ({
        ...cell,
        audio: { ...cell.audio, assetId: 'asset:missing' },
      }))),
      /unknown audio asset|audio asset.*unknown/i,
    );

    for (let [sourceInMs, sourceOutMs] of [
      [-1, 1000],
      [1000, 1000],
      [2000, 1000],
      [0, 9001],
    ]) {
      assert.throws(
        () => createPresentationAuthoringProject(withFirstClip((cell) => ({
          ...cell,
          audio: { ...cell.audio, sourceInMs, sourceOutMs },
        }))),
        /source(In|Out)Ms|source range|half-open|duration/i,
      );
    }
  });

  it('splits one clip without duplicating narration or mutating its source asset', () => {
    let { project, clips } = projectFixture();
    let applied = applyPresentationAuthoringProjectCommand(project, command(
      project,
      'split-overview-audio',
      'audio-clip.split',
      {
        cellId: clips[0].id,
        sourceAtMs: 1500,
        rightCellId: 'audio-clip:overview:1b',
      },
    ));
    assertMutation(project, applied);

    let left = applied.project.cells.find((cell) => cell.id === clips[0].id);
    let right = applied.project.cells.find((cell) => cell.id === 'audio-clip:overview:1b');
    assert.deepEqual(left.audio, {
      assetId: 'asset:narration-master',
      sourceInMs: 0,
      sourceOutMs: 1500,
    });
    assert.deepEqual(right.audio, {
      assetId: 'asset:narration-master',
      sourceInMs: 1500,
      sourceOutMs: 4000,
    });
    assert.deepEqual(right.timing, {
      at: { anchor: 'turn-start', offsetMs: 1500 },
    });
    assert.equal(
      applied.project.cells.filter((cell) => cell.kind === 'narration').length,
      1,
    );
  });

  it('maps an audio clip drag in the visual NLE to the same audio-clip.move command exposed to MCP and CLI', () => {
    let { project, clips } = projectFixture();
    let timeline = createPresentationAuthoringTimelineProjection(project);
    let alignment = createPresentationAlignedSequence(timeline, {
      media: { hash: 'sha256-narration-master', durationMs: 9000, locale: 'en-US' },
      turns: [{
        startMs: 0,
        endMs: 9000,
        transcript: timeline.turns[0].text,
        words: [
          { text: 'Show', startMs: 0, endMs: 500 },
          { text: 'the', startMs: 600, endMs: 800 },
          { text: 'first', startMs: 900, endMs: 1300 },
          { text: 'result,', startMs: 1400, endMs: 1900 },
          { text: 'then', startMs: 2200, endMs: 2600 },
          { text: 'reveal', startMs: 2700, endMs: 3300 },
          { text: 'the', startMs: 3400, endMs: 3600 },
          { text: 'second', startMs: 3700, endMs: 4300 },
          { text: 'result.', startMs: 4400, endMs: 5000 },
        ],
      }],
    });
    let schedule = createPresentationScheduleV2(project, alignment);
    let nle = projectPresentationNle(project, schedule);
    let result = createPresentationAuthoringCommandFromNleEdit(project, schedule, nle, {
      id: 'drag-audio-clip',
      type: 'clip.frame-drag',
      clipId: clips[0].id,
      frameMs: 1750,
      basis: {
        authoringProjectHash: project.hash,
        timelineHash: nle.timelineHash,
        scheduleHash: schedule.hash,
        nleHash: nle.hash,
      },
    });

    assert.equal(result.status, 'command');
    assert.equal(result.command.type, 'audio-clip.move');
    assert.deepEqual(result.command.payload, {
      cellId: clips[0].id,
      timing: { at: { anchor: 'turn-start', offsetMs: 1750 } },
    });
  });

  it('trims and timeline-moves clips with exact CAS and invertible stable identity', () => {
    let { project, clips } = projectFixture();
    let trim = command(project, 'trim-overview-audio', 'audio-clip.trim', {
      cellId: clips[0].id,
      sourceInMs: 200,
      sourceOutMs: 3600,
    });
    let trimmed = applyPresentationAuthoringProjectCommand(project, trim);
    assertMutation(project, trimmed);
    let trimmedClip = trimmed.project.cells.find((cell) => cell.id === clips[0].id);
    assert.equal(trimmedClip.id, clips[0].id);
    assert.equal(trimmedClip.audio.assetId, clips[0].audio.assetId);
    assert.deepEqual(trimmedClip.audio, {
      assetId: clips[0].audio.assetId,
      sourceInMs: 200,
      sourceOutMs: 3600,
    });

    let trimInverse = invertPresentationAuthoringProjectCommand(trim, trimmed);
    let untrimmed = applyPresentationAuthoringProjectCommand(trimmed.project, trimInverse);
    assert.deepEqual(
      withoutRevisionAndHash(untrimmed.project),
      withoutRevisionAndHash(project),
    );

    let move = command(project, 'move-overview-audio', 'audio-clip.move', {
      cellId: clips[0].id,
      timing: { at: { anchor: 'turn-start', offsetMs: 1250 } },
    });
    let moved = applyPresentationAuthoringProjectCommand(project, move);
    assertMutation(project, moved);
    assert.deepEqual(
      moved.project.cells.find((cell) => cell.id === clips[0].id).timing,
      move.payload.timing,
    );

    let moveInverse = invertPresentationAuthoringProjectCommand(move, moved);
    let unmoved = applyPresentationAuthoringProjectCommand(moved.project, moveInverse);
    assert.deepEqual(
      withoutRevisionAndHash(unmoved.project),
      withoutRevisionAndHash(project),
    );
  });

  it('links and unlinks a clip through a typed event dependency and rejects resulting cycles', () => {
    let { project, clips, event } = projectFixture();
    let link = command(project, 'link-audio-after-marker', 'audio-clip.link', {
      clipCellId: clips[0].id,
      eventCellId: event.id,
      barrier: 'settled',
    });
    let linked = applyPresentationAuthoringProjectCommand(project, link);
    assertMutation(project, linked);
    assert.deepEqual(
      linked.project.cells.find((cell) => cell.id === clips[0].id).dependsOn,
      [{ cellId: event.id, barrier: 'settled' }],
    );

    let linkInverse = invertPresentationAuthoringProjectCommand(link, linked);
    assert.equal(linkInverse.type, 'audio-clip.unlink');
    let unlinkedByInverse = applyPresentationAuthoringProjectCommand(linked.project, linkInverse);
    assert.deepEqual(
      withoutRevisionAndHash(unlinkedByInverse.project),
      withoutRevisionAndHash(project),
    );

    let unlink = command(linked.project, 'unlink-audio-after-marker', 'audio-clip.unlink', {
      clipCellId: clips[0].id,
      eventCellId: event.id,
      barrier: 'settled',
    });
    let explicitlyUnlinked = applyPresentationAuthoringProjectCommand(linked.project, unlink);
    assert.deepEqual(
      explicitlyUnlinked.project.cells.find((cell) => cell.id === clips[0].id).dependsOn,
      [],
    );

    let cycleSeed = createPresentationAuthoringProject({
      ...project,
      cells: project.cells.map((cell) => (
        cell.id === event.id
          ? { ...cell, dependsOn: [{ cellId: clips[0].id, barrier: 'ended' }] }
          : cell
      )),
    });
    assert.throws(
      () => applyPresentationAuthoringProjectCommand(cycleSeed, command(
        cycleSeed,
        'cyclic-audio-event-link',
        'audio-clip.link',
        {
          clipCellId: clips[0].id,
          eventCellId: event.id,
          barrier: 'settled',
        },
      )),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_DEPENDENCY_CYCLE',
    );
  });

  it('publishes strict first-class MCP/CLI descriptors for every audio clip edit', () => {
    let expected = new Map([
      ['audio-clip.split', 'presentation_authoring_audio_clip_split'],
      ['audio-clip.trim', 'presentation_authoring_audio_clip_trim'],
      ['audio-clip.move', 'presentation_authoring_audio_clip_move'],
      ['audio-clip.link', 'presentation_authoring_audio_clip_link'],
      ['audio-clip.unlink', 'presentation_authoring_audio_clip_unlink'],
    ]);
    let commandDescriptors = new Map(
      listPresentationAuthoringProjectCommandDescriptors().map((item) => [item.type, item]),
    );
    let toolDescriptors = new Map(
      listPresentationAuthoringToolDescriptors().map((item) => [item.name, item]),
    );

    for (let [type, toolName] of expected) {
      let commandDescriptor = commandDescriptors.get(type);
      assert.ok(commandDescriptor, `missing command descriptor ${type}`);
      assert.equal(commandDescriptor.toolName, toolName);
      assert.equal(commandDescriptor.payloadSchema.additionalProperties, false);

      let toolDescriptor = toolDescriptors.get(toolName);
      assert.ok(toolDescriptor, `missing tool descriptor ${toolName}`);
      assert.equal(toolDescriptor.commandType, type);
      assert.equal(toolDescriptor.inputSchema.additionalProperties, false);
    }
  });
});
