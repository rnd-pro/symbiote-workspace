import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize, computeIntegrity } from '../schema/canonical-json.js';
import * as browserApi from '../browser.js';
import * as rootApi from '../index.js';
import * as runtimeApi from '../runtime/index.js';
import {
  PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
  PresentationAuthoringToolError,
  applyPresentationAuthoringProjectCommand,
  createPresentationAlignedSequence,
  createPresentationAuthoringProjectFromTimeline,
  createPresentationAuthoringTimelineProjection,
  createPresentationAuthoringToolPack,
  createPresentationScheduleV2,
  createPresentationTimelineContract,
  listPresentationAuthoringProjectCommandDescriptors,
  listPresentationAuthoringToolDescriptors,
  projectPresentationNle,
} from '../index.js';
import * as directApi from '../runtime/presentation/authoring-tools.js';

const REGENERATION_RECEIPT_VERSION = 'workspace-presentation-regeneration-receipt-v1';
const SCOPED_REGENERATION_REQUEST_VERSION = 'workspace-presentation-regeneration-request-v2';
const SCOPED_REGENERATION_RECEIPT_VERSION = 'workspace-presentation-regeneration-receipt-v2';
const MEDIA_COLLECTION_VERSION = 'workspace-presentation-media-collection-v1';

function timelineFixture() {
  return createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'authoring-tool-demo',
    title: 'Authoring Tool Demo',
    locale: 'en-US',
    profile: 'brief',
    personas: {
      guide: {
        name: 'Guide',
        role: 'guide',
        locale: 'en-US',
        delivery: { emotion: 'warm', pace: 'normal', tone: 'clear' },
      },
    },
    grounding: { sources: [] },
    turns: [{
      id: 'inspect-result',
      persona: 'guide',
      dialogueAct: 'explain',
      text: 'Inspect the result carefully.',
      sourceRefs: [],
      claims: [],
      cues: [{
        kind: 'annotation',
        targetId: 'panel:result',
        at: {
          anchor: 'speech',
          quote: 'result',
          occurrence: 1,
          edge: 'start',
          offsetMs: 0,
        },
        until: { anchor: 'turn-end', offsetMs: 0 },
        annotation: { intent: 'emphasize', marker: 'box', placement: 'over' },
      }],
    }],
  });
}

function alignedSequence(project, audioHash = 'sha256-audio-v1') {
  let timeline = createPresentationAuthoringTimelineProjection(project);
  return createPresentationAlignedSequence(timeline, {
    media: { hash: audioHash, durationMs: 1600, locale: 'en-US' },
    turns: [{
      startMs: 0,
      endMs: 1600,
      transcript: timeline.turns[0].text,
      words: [
        { text: 'Inspect', startMs: 0, endMs: 280 },
        { text: 'the', startMs: 300, endMs: 440 },
        { text: 'result', startMs: 480, endMs: 800 },
        { text: 'carefully', startMs: 840, endMs: 1300 },
      ],
    }],
  });
}

function narrationHash(project) {
  let timeline = createPresentationAuthoringTimelineProjection(project);
  let turns = timeline.turns.map(({ cues, ...turn }) => turn);
  let personaIds = new Set(turns.map((turn) => turn.persona));
  let projection = {
    schemaVersion: 'workspace-presentation-narration-v1',
    locale: timeline.locale,
    profile: timeline.profile,
    personas: Object.fromEntries(
      Object.entries(timeline.personas).filter(([personaId]) => personaIds.has(personaId)),
    ),
    turns,
  };
  return `workspace-presentation-narration-v1:${computeIntegrity(projection)}`;
}

function acceptedAncestry(project, alignment) {
  return {
    schemaVersion: 'workspace-presentation-media-ancestry-v1',
    narrationHash: narrationHash(project),
    audio: { hash: alignment.media.hash, status: 'accepted' },
    alignment: { hash: alignment.hash, status: 'accepted' },
    render: { hash: 'sha256-render-v1', status: 'accepted' },
    playable: true,
  };
}

function collectionTimelineFixture(count = 30) {
  return createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'collection-authority-demo',
    title: 'Collection Authority Demo',
    locale: 'en-US',
    profile: 'brief',
    personas: {
      guide: {
        name: 'Guide',
        role: 'guide',
        locale: 'en-US',
        delivery: { emotion: 'warm', pace: 'normal', tone: 'clear' },
      },
    },
    grounding: { sources: [] },
    turns: Array.from({ length: count }, (_value, index) => ({
      id: `entry-${String(index + 1).padStart(2, '0')}`,
      persona: 'guide',
      dialogueAct: 'explain',
      text: `Explain independent entry ${index + 1}.`,
      sourceRefs: [],
      claims: [],
      cues: [],
    })),
  });
}

function scopedNarrationHash(project, narrationCell) {
  let timeline = createPresentationAuthoringTimelineProjection(project);
  let turn = timeline.turns.find((item) => item.id === narrationCell.turnId);
  let { cues, ...narrationTurn } = turn;
  let projection = {
    schemaVersion: 'workspace-presentation-narration-v1',
    locale: timeline.locale,
    profile: timeline.profile,
    personas: { [narrationTurn.persona]: timeline.personas[narrationTurn.persona] },
    turns: [narrationTurn],
  };
  return `workspace-presentation-narration-v1:${computeIntegrity(projection)}`;
}

function acceptedCollection(project) {
  let narrationCells = project.cells.filter((cell) => cell.kind === 'narration');
  return {
    schemaVersion: MEDIA_COLLECTION_VERSION,
    collectionId: 'collection-authority-demo:media',
    manifestHash: 'sha256-collection-manifest-v1',
    entries: narrationCells.map((cell) => ({
      entryId: cell.turnId,
      narrationCellId: cell.id,
      mediaAncestry: {
        schemaVersion: 'workspace-presentation-media-ancestry-v1',
        narrationHash: scopedNarrationHash(project, cell),
        audio: { hash: `sha256-audio:${cell.turnId}:v1`, status: 'accepted' },
        alignment: { hash: `sha256-alignment:${cell.turnId}:v1`, status: 'accepted' },
        render: { hash: `sha256-render:${cell.turnId}:v1`, status: 'accepted' },
        playable: true,
      },
    })),
  };
}

function ancestryWithStatusGraph(ancestry, statusGraph) {
  let value = structuredClone(ancestry);
  for (let key of ['audio', 'alignment', 'render']) {
    value[key].status = statusGraph[key];
  }
  value.playable = statusGraph.playable;
  return value;
}

function artifactScope(collection, entry) {
  return {
    collectionId: collection.collectionId,
    manifestHash: collection.manifestHash,
    entryId: entry.entryId,
    narrationCellId: entry.narrationCellId,
  };
}

function memoryAuthority(initialSnapshot, { abortAfterCommit } = {}) {
  let snapshot = structuredClone(initialSnapshot);
  let commits = 0;
  let reads = 0;
  return {
    read() {
      reads += 1;
      return structuredClone(snapshot);
    },
    transact({ base: receivedBase }, update) {
      assert.equal(typeof receivedBase.revision, 'number');
      assert.equal(typeof receivedBase.authoringProjectHash, 'string');
      let before = structuredClone(snapshot);
      snapshot = structuredClone(update(structuredClone(snapshot)));
      commits += 1;
      assert.notDeepEqual(snapshot, before);
      abortAfterCommit?.();
    },
    replaceAlignment(alignment) {
      snapshot.alignment = structuredClone(alignment);
    },
    state() {
      return structuredClone(snapshot);
    },
    counts() {
      return { commits, reads };
    },
  };
}

function receiptFor(request, status, artifactHash) {
  let scoped = request.schemaVersion === SCOPED_REGENERATION_REQUEST_VERSION;
  let value = {
    schemaVersion: scoped
      ? SCOPED_REGENERATION_RECEIPT_VERSION
      : REGENERATION_RECEIPT_VERSION,
    receiptId: `receipt:${request.id}`,
    requestId: request.id,
    requestHash: request.hash,
    status,
    base: structuredClone(request.base),
    ...(scoped ? { artifactScope: structuredClone(request.artifactScope) } : {}),
    dependency: request.dependency,
    narrationHash: request.narrationHash,
    predecessors: structuredClone(request.predecessors),
    artifactHash,
  };
  return {
    ...value,
    hash: `${value.schemaVersion}:${computeIntegrity(value)}`,
  };
}

function memoryRegeneration() {
  let receipts = new Map();
  let requests = new Map();
  return {
    request(request) {
      requests.set(request.id, structuredClone(request));
      let receipt = receiptFor(request, 'pending', null);
      receipts.set(receipt.receiptId, receipt);
      return structuredClone(receipt);
    },
    inspect(receiptId) {
      return structuredClone(receipts.get(receiptId));
    },
    accept(requestId, artifactHash) {
      let receipt = receiptFor(requests.get(requestId), 'accepted', artifactHash);
      receipts.set(receipt.receiptId, receipt);
      return receipt.receiptId;
    },
  };
}

function fixturePack(options = {}) {
  let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
  let alignment = alignedSequence(project);
  let authority = memoryAuthority({
    project,
    alignment,
    mediaAncestry: acceptedAncestry(project, alignment),
  }, options);
  let regeneration = memoryRegeneration();
  return {
    project,
    alignment,
    authority,
    regeneration,
    pack: createPresentationAuthoringToolPack({ authority, regeneration }),
  };
}

function collectionFixturePack(options = {}) {
  let { project } = createPresentationAuthoringProjectFromTimeline(
    collectionTimelineFixture(options.count),
    { revision: options.revision ?? 0 },
  );
  let mediaCollection = acceptedCollection(project);
  let authority = memoryAuthority({ project, mediaCollection });
  let regeneration = memoryRegeneration();
  return {
    project,
    mediaCollection,
    authority,
    regeneration,
    pack: createPresentationAuthoringToolPack({ authority, regeneration }),
  };
}

function scopedRequestValue({ id, base: requestBase, scope, dependency, narration, predecessors }) {
  let value = {
    schemaVersion: SCOPED_REGENERATION_REQUEST_VERSION,
    id,
    base: structuredClone(requestBase),
    artifactScope: structuredClone(scope),
    dependency,
    narrationHash: narration,
    predecessors: structuredClone(predecessors),
  };
  return {
    ...value,
    hash: `${SCOPED_REGENERATION_REQUEST_VERSION}:${computeIntegrity(value)}`,
  };
}

function base(project) {
  return { revision: project.revision, authoringProjectHash: project.hash };
}

function timingInput(project, cue, id = 'agent-timing-edit') {
  return {
    id,
    base: base(project),
    payload: {
      cellId: cue.id,
      timing: { ...cue.timing, leadMs: 120, gestureDurationMs: 420 },
    },
  };
}

function canonicalProjectContent(project) {
  let value = structuredClone(project);
  delete value.revision;
  delete value.hash;
  return canonicalize(value);
}

describe('workspace presentation authoring tool pack', () => {
  it('exposes strict semantic descriptors without a generic mutation route', () => {
    let descriptors = listPresentationAuthoringToolDescriptors();
    let commandDescriptors = listPresentationAuthoringProjectCommandDescriptors();
    assert.deepEqual(
      descriptors.filter((item) => item.commandType).map((item) => item.name),
      [
        'presentation_authoring_layer_add',
        'presentation_authoring_layer_update',
        'presentation_authoring_layer_remove',
        'presentation_authoring_layer_move',
        'presentation_authoring_cell_add',
        'presentation_authoring_cell_remove',
        'presentation_authoring_cell_move',
        'presentation_authoring_cell_set_content',
        'presentation_authoring_cell_set_timing',
        'presentation_authoring_cell_set_dependencies',
        'presentation_authoring_narration_replace',
      ],
    );
    assert.equal(descriptors.length, 15);
    assert.equal(descriptors.every((item) => item.inputSchema.additionalProperties === false), true);
    assert.equal(commandDescriptors.every((item) => (
      item.toolName.startsWith('presentation_authoring_')
      && item.payloadSchema.additionalProperties === false
    )), true);
    let descriptorByType = new Map(commandDescriptors.map((item) => [item.type, item]));
    assert.equal(
      descriptorByType.get('layer.add').payloadSchema.properties.layer.additionalProperties,
      false,
    );
    assert.equal(
      descriptorByType.get('cell.add').payloadSchema.properties.cell.oneOf
        .every((variant) => variant.additionalProperties === false),
      true,
    );
    assert.equal(
      descriptorByType.get('cell.set-content').payloadSchema.properties.content.oneOf
        .every((variant) => variant.additionalProperties === false),
      true,
    );
    let narrationReplace = descriptorByType.get('narration.replace');
    assert.equal(narrationReplace.payloadSchema.properties.cueBindings.minItems, 1);
    assert.equal(
      narrationReplace.payloadSchema.properties.cueBindings.items.additionalProperties,
      false,
    );
    for (let toolName of [
      'presentation_authoring_regeneration_request',
      'presentation_authoring_regeneration_inspect',
    ]) {
      let scopeSchema = descriptors.find((item) => item.name === toolName)
        .inputSchema.properties.artifactScope;
      assert.deepEqual(scopeSchema.required, [
        'collectionId',
        'manifestHash',
        'entryId',
        'narrationCellId',
      ]);
      assert.equal(scopeSchema.additionalProperties, false);
    }
    assert.equal(descriptors.some((item) => /apply|patch|batch/.test(item.name)), false);
    assert.equal(
      JSON.stringify(descriptors).includes('mediaBytes'),
      false,
    );
  });

  it('rejects impossible media ancestry graphs before provider invocation', async (context) => {
    let cases = [
      {
        name: 'alignment accepted while audio is stale',
        statusGraph: {
          audio: 'stale',
          alignment: 'accepted',
          render: 'stale',
          playable: false,
        },
      },
      {
        name: 'render accepted while audio and alignment are stale',
        statusGraph: {
          audio: 'stale',
          alignment: 'stale',
          render: 'accepted',
          playable: false,
        },
      },
      {
        name: 'render accepted while alignment is stale',
        statusGraph: {
          audio: 'accepted',
          alignment: 'stale',
          render: 'accepted',
          playable: false,
        },
      },
      {
        name: 'all dependencies accepted while playable is false',
        statusGraph: {
          audio: 'accepted',
          alignment: 'accepted',
          render: 'accepted',
          playable: false,
        },
      },
      {
        name: 'a dependency stale while playable is true',
        statusGraph: {
          audio: 'accepted',
          alignment: 'accepted',
          render: 'stale',
          playable: true,
        },
      },
    ];

    for (let mode of ['single', 'collection']) {
      for (let testCase of cases) {
        await context.test(`${mode}: ${testCase.name}`, async () => {
          let project;
          let snapshot;
          let scope;
          if (mode === 'single') {
            ({ project } = createPresentationAuthoringProjectFromTimeline(timelineFixture()));
            let alignment = alignedSequence(project);
            snapshot = {
              project,
              alignment,
              mediaAncestry: ancestryWithStatusGraph(
                acceptedAncestry(project, alignment),
                testCase.statusGraph,
              ),
            };
          } else {
            ({ project } = createPresentationAuthoringProjectFromTimeline(
              collectionTimelineFixture(),
            ));
            let mediaCollection = acceptedCollection(project);
            mediaCollection.entries[0].mediaAncestry = ancestryWithStatusGraph(
              mediaCollection.entries[0].mediaAncestry,
              testCase.statusGraph,
            );
            snapshot = { project, mediaCollection };
            scope = artifactScope(mediaCollection, mediaCollection.entries[0]);
          }
          let authority = memoryAuthority(snapshot);
          let providerCalls = 0;
          let regeneration = {
            request() {
              providerCalls += 1;
              throw new Error('regeneration provider must not receive invalid ancestry');
            },
            inspect() {
              providerCalls += 1;
              throw new Error('regeneration provider must not receive invalid ancestry');
            },
          };
          let pack = createPresentationAuthoringToolPack({ authority, regeneration });
          let before = authority.state();

          await assert.rejects(
            pack.invoke('presentation_authoring_regeneration_request', {
              id: `reject-impossible-${mode}`,
              base: base(project),
              ...(scope ? { artifactScope: scope } : {}),
              dependency: 'narration-audio',
            }),
            (error) => (
              error instanceof PresentationAuthoringToolError
              && error.code === 'PRESENTATION_AUTHORING_MEDIA_ANCESTRY_INVALID'
            ),
          );
          assert.deepEqual(authority.state(), before);
          assert.equal(authority.counts().commits, 0);
          assert.equal(providerCalls, 0);
        });
      }
    }
  });

  it('matches direct command, timeline, schedule, and NLE results for timing edits', async () => {
    let fixture = fixturePack();
    let cue = fixture.project.cells.find((cell) => cell.kind === 'cue');
    let input = timingInput(fixture.project, cue);
    let directCommand = {
      schemaVersion: PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
      id: input.id,
      base: input.base,
      type: 'cell.set-timing',
      payload: input.payload,
    };
    let direct = applyPresentationAuthoringProjectCommand(fixture.project, directCommand);
    let schedule = createPresentationScheduleV2(direct.project, fixture.alignment);
    let ancestry = fixture.authority.state().mediaAncestry;
    let result = await fixture.pack.invoke('presentation_authoring_cell_set_timing', input);

    assert.deepEqual(result.command, directCommand);
    assert.deepEqual(result.project, direct.project);
    assert.deepEqual(result.change, direct.change);
    assert.deepEqual(result.receipt, direct.receipt);
    assert.deepEqual(result.timeline, createPresentationAuthoringTimelineProjection(direct.project));
    assert.deepEqual(result.schedule, schedule);
    assert.deepEqual(result.nle, projectPresentationNle(direct.project, schedule));
    assert.equal(result.projectionStatus.status, 'ready');
    assert.deepEqual(result.mediaDisposition, {
      status: 'preserved',
      narrationHash: ancestry.narrationHash,
      mediaAncestry: ancestry,
    });
    assert.equal(fixture.authority.counts().commits, 1);
  });

  it('atomically replaces narration and same-turn speech cue bindings', async () => {
    let fixture = fixturePack();
    let narration = fixture.project.cells.find((cell) => cell.kind === 'narration');
    let cue = fixture.project.cells.find((cell) => cell.kind === 'cue');
    let turn = { ...narration.turn, text: 'Review the workspace closely.' };
    let at = { ...cue.timing.at, quote: 'workspace' };
    let singularContent = {
      schemaVersion: PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
      id: 'singular-narration',
      base: base(fixture.project),
      type: 'cell.set-content',
      payload: { cellId: narration.id, content: turn },
    };
    let singularTiming = {
      schemaVersion: PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
      id: 'singular-anchor',
      base: base(fixture.project),
      type: 'cell.set-timing',
      payload: {
        cellId: cue.id,
        timing: { ...cue.timing, at },
      },
    };

    assert.throws(
      () => applyPresentationAuthoringProjectCommand(fixture.project, singularContent),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_INVALID',
    );
    assert.throws(
      () => applyPresentationAuthoringProjectCommand(fixture.project, singularTiming),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_INVALID',
    );

    let applied = await fixture.pack.invoke('presentation_authoring_narration_replace', {
      id: 'replace-narration-and-anchors',
      base: base(fixture.project),
      payload: {
        narrationCellId: narration.id,
        turn,
        cueBindings: [{ cueCellId: cue.id, at, until: cue.timing.until }],
      },
    });
    let appliedCue = applied.project.cells.find((cell) => cell.id === cue.id);

    assert.equal(fixture.authority.counts().commits, 1);
    assert.equal(applied.project.revision, fixture.project.revision + 1);
    assert.equal(applied.receipt.authoringProjectHash, applied.project.hash);
    assert.equal(applied.change.type, 'narration.replace');
    assert.equal(appliedCue.timing.at.quote, 'workspace');
    assert.equal(appliedCue.timing.leadMs, cue.timing.leadMs);
    assert.equal(appliedCue.timing.gestureDurationMs, cue.timing.gestureDurationMs);
    assert.equal(appliedCue.timing.settleBy, cue.timing.settleBy);
    assert.deepEqual(appliedCue.cue, cue.cue);
    assert.deepEqual(appliedCue.dependsOn, cue.dependsOn);
    assert.equal(applied.mediaDisposition.status, 'invalidated');

    await assert.rejects(
      fixture.pack.invoke('presentation_authoring_narration_replace', {
        id: 'stale-narration-replacement',
        base: base(fixture.project),
        payload: applied.command.payload,
      }),
      (error) => error.code === 'PRESENTATION_AUTHORING_TOOL_STALE',
    );
    assert.equal(fixture.authority.counts().commits, 1);

    let inverse = await fixture.pack.invoke('presentation_authoring_inverse', {
      command: applied.command,
      change: applied.change,
      receipt: applied.receipt,
    });
    assert.equal(inverse.toolName, 'presentation_authoring_narration_replace');
    let restored = await fixture.pack.invoke(inverse.toolName, {
      id: inverse.inverse.id,
      base: inverse.inverse.base,
      payload: inverse.inverse.payload,
    });
    assert.equal(fixture.authority.counts().commits, 2);
    assert.equal(canonicalProjectContent(restored.project), canonicalProjectContent(fixture.project));
  });

  it('rejects invalid narration replacement scopes without an authority commit', async () => {
    let fixture = fixturePack();
    let narration = fixture.project.cells.find((cell) => cell.kind === 'narration');
    let cue = fixture.project.cells.find((cell) => cell.kind === 'cue');
    let binding = { cueCellId: cue.id, at: cue.timing.at, until: cue.timing.until };
    let input = (id, payload, inputBase = base(fixture.project)) => ({
      id,
      base: inputBase,
      payload,
    });
    let assertAtomicReject = async (request, code) => {
      let before = fixture.authority.state();
      let commits = fixture.authority.counts().commits;
      await assert.rejects(
        fixture.pack.invoke('presentation_authoring_narration_replace', request),
        (error) => error instanceof PresentationAuthoringToolError && error.code === code,
      );
      assert.deepEqual(fixture.authority.state(), before);
      assert.equal(fixture.authority.counts().commits, commits);
    };

    await assertAtomicReject(input('duplicate-cue-binding', {
      narrationCellId: narration.id,
      turn: narration.turn,
      cueBindings: [binding, binding],
    }), 'PRESENTATION_AUTHORING_COMMAND_DUPLICATE_ID');
    await assertAtomicReject(input('generated-narration-target', {
      narrationCellId: 'generated:narration',
      turn: narration.turn,
      cueBindings: [binding],
    }), 'PRESENTATION_AUTHORING_TOOL_READ_ONLY');
    await assertAtomicReject(input('generated-cue-target', {
      narrationCellId: narration.id,
      turn: narration.turn,
      cueBindings: [{ ...binding, cueCellId: 'generated:cue' }],
    }), 'PRESENTATION_AUTHORING_TOOL_READ_ONLY');
    await assertAtomicReject(input('incomplete-final-anchor', {
      narrationCellId: narration.id,
      turn: { ...narration.turn, text: 'Review the workspace closely.' },
      cueBindings: [{
        ...binding,
        at: { ...binding.at, quote: 'missing phrase' },
      }],
    }), 'PRESENTATION_AUTHORING_PROJECT_INVALID');
    await assertAtomicReject(input('stale-narration-base', {
      narrationCellId: narration.id,
      turn: narration.turn,
      cueBindings: [binding],
    }, { ...base(fixture.project), revision: fixture.project.revision + 1 }),
    'PRESENTATION_AUTHORING_TOOL_STALE');

    let { project: crossTurnProject } = createPresentationAuthoringProjectFromTimeline(
      collectionTimelineFixture(2),
    );
    let otherNarration = crossTurnProject.cells.find((cell) => cell.turnId === 'entry-02');
    let annotationLayer = crossTurnProject.layers.find((layer) => layer.kind === 'annotation');
    let cueCell = {
      id: 'entry-02:cue',
      kind: 'cue',
      layerId: annotationLayer.id,
      turnId: otherNarration.turnId,
      cue: {
        kind: 'annotation',
        targetId: 'panel:entry-02',
        annotation: { intent: 'emphasize', marker: 'box', placement: 'over' },
      },
      timing: {
        at: {
          anchor: 'speech',
          quote: 'independent entry 2',
          occurrence: 1,
          edge: 'start',
          offsetMs: 0,
        },
        until: { anchor: 'turn-end', offsetMs: 0 },
        leadMs: 0,
        gestureDurationMs: 800,
        settleBy: 'none',
      },
      dependsOn: [],
    };
    let withCue = applyPresentationAuthoringProjectCommand(crossTurnProject, {
      schemaVersion: PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
      id: 'add-cross-turn-cue',
      base: base(crossTurnProject),
      type: 'cell.add',
      payload: { cell: cueCell },
    }).project;
    let crossTurnAuthority = memoryAuthority({
      project: withCue,
      mediaCollection: acceptedCollection(withCue),
    });
    let crossTurnPack = createPresentationAuthoringToolPack({
      authority: crossTurnAuthority,
      regeneration: memoryRegeneration(),
    });
    let firstNarration = withCue.cells.find((cell) => cell.turnId === 'entry-01');

    await assert.rejects(
      crossTurnPack.invoke('presentation_authoring_narration_replace', {
        id: 'cross-turn-cue-binding',
        base: base(withCue),
        payload: {
          narrationCellId: firstNarration.id,
          turn: firstNarration.turn,
          cueBindings: [{
            cueCellId: cueCell.id,
            at: cueCell.timing.at,
            until: cueCell.timing.until,
          }],
        },
      }),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_INVALID',
    );
    assert.equal(crossTurnAuthority.counts().commits, 0);
  });

  it('rejects stale, generated, unknown, patch, and nested free-form edits atomically', async () => {
    let fixture = fixturePack();
    let cue = fixture.project.cells.find((cell) => cell.kind === 'cue');
    let before = fixture.authority.state();
    let assertAtomicReject = async (promise, code) => {
      let commits = fixture.authority.counts().commits;
      await assert.rejects(
        promise,
        (error) => error instanceof PresentationAuthoringToolError && error.code === code,
      );
      assert.deepEqual(fixture.authority.state(), before);
      assert.equal(fixture.authority.counts().commits, commits);
    };

    await assertAtomicReject(fixture.pack.invoke('presentation_authoring_cell_set_timing', {
      ...timingInput(fixture.project, cue),
      base: { ...base(fixture.project), revision: 99 },
    }), 'PRESENTATION_AUTHORING_TOOL_STALE');
    await assertAtomicReject(fixture.pack.invoke('presentation_authoring_cell_move', {
      id: 'generated-edit',
      base: base(fixture.project),
      payload: { cellId: 'generated:narration-audio:master', index: 0 },
    }), 'PRESENTATION_AUTHORING_TOOL_READ_ONLY');
    await assertAtomicReject(fixture.pack.invoke('presentation_authoring_apply', {
      id: 'raw-apply', base: base(fixture.project), patch: [],
    }), 'PRESENTATION_AUTHORING_TOOL_UNKNOWN');
    await assertAtomicReject(fixture.pack.invoke('presentation_authoring_cell_set_timing', {
      ...timingInput(fixture.project, cue), patch: [],
    }), 'PRESENTATION_AUTHORING_TOOL_INPUT_INVALID');
    await assertAtomicReject(fixture.pack.invoke('presentation_authoring_cell_set_timing', {
      id: 'absolute-time',
      base: base(fixture.project),
      payload: { ...timingInput(fixture.project, cue).payload, frameMs: 420 },
    }), 'PRESENTATION_AUTHORING_TOOL_INPUT_INVALID');
    await assertAtomicReject(fixture.pack.invoke('presentation_authoring_cell_set_content', {
      id: 'nested-free-form',
      base: base(fixture.project),
      payload: {
        cellId: cue.id,
        content: { ...cue.cue, arbitraryPatch: { path: '/runtime' } },
      },
    }), 'PRESENTATION_AUTHORING_PROJECT_INVALID');
  });

  it('returns a committed semantic receipt when cancellation arrives after atomic commit', async () => {
    let controller = new AbortController();
    let fixture = fixturePack({ abortAfterCommit: () => controller.abort() });
    let cue = fixture.project.cells.find((cell) => cell.kind === 'cue');
    let result = await fixture.pack.invoke(
      'presentation_authoring_cell_set_timing',
      timingInput(fixture.project, cue),
      { signal: controller.signal },
    );

    assert.equal(controller.signal.aborted, true);
    assert.equal(result.receipt.authoringProjectHash, fixture.authority.state().project.hash);
    assert.equal(fixture.authority.counts().commits, 1);
  });

  it('forwards AbortSignal to regeneration without committing provider state', async () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let alignment = alignedSequence(project);
    let authority = memoryAuthority({
      project,
      alignment,
      mediaAncestry: acceptedAncestry(project, alignment),
    });
    let controller = new AbortController();
    let receivedSignal;
    let regeneration = {
      request(_request, { signal }) {
        receivedSignal = signal;
        controller.abort();
        signal.throwIfAborted();
      },
      inspect() {
        throw new Error('inspect must not be called');
      },
    };
    let pack = createPresentationAuthoringToolPack({ authority, regeneration });

    await assert.rejects(
      pack.invoke('presentation_authoring_regeneration_request', {
        id: 'abort-regeneration',
        base: base(project),
        dependency: 'narration-audio',
      }, { signal: controller.signal }),
      (error) => error.name === 'AbortError',
    );
    assert.equal(receivedSignal, controller.signal);
    assert.equal(authority.counts().commits, 0);
    assert.deepEqual(authority.state().project, project);
  });

  it('binds inverse to the exact application and restores canonical semantics', async () => {
    let fixture = fixturePack();
    let cue = fixture.project.cells.find((cell) => cell.kind === 'cue');
    let applied = await fixture.pack.invoke(
      'presentation_authoring_cell_set_timing',
      timingInput(fixture.project, cue),
    );
    let inverse = await fixture.pack.invoke('presentation_authoring_inverse', {
      command: applied.command,
      change: applied.change,
      receipt: applied.receipt,
    });
    assert.equal(inverse.toolName, 'presentation_authoring_cell_set_timing');
    let restored = await fixture.pack.invoke(inverse.toolName, {
      id: inverse.inverse.id,
      base: inverse.inverse.base,
      payload: inverse.inverse.payload,
    });
    assert.equal(canonicalProjectContent(restored.project), canonicalProjectContent(fixture.project));
    assert.deepEqual(restored.timeline, createPresentationAuthoringTimelineProjection(fixture.project));
  });

  it('preserves media for cue/timing edits but invalidates media for non-text narration changes', async () => {
    let attentionFixture = fixturePack();
    let cue = attentionFixture.project.cells.find((cell) => cell.kind === 'cue');
    let attention = await attentionFixture.pack.invoke('presentation_authoring_cell_set_content', {
      id: 'attention-content',
      base: base(attentionFixture.project),
      payload: {
        cellId: cue.id,
        content: {
          ...cue.cue,
          annotation: { ...cue.cue.annotation, marker: 'circle' },
        },
      },
    });
    assert.equal(attention.mediaDisposition.status, 'preserved');
    assert.equal(attention.projectionStatus.status, 'stale');

    let timingFixture = fixturePack();
    let timedCue = timingFixture.project.cells.find((cell) => cell.kind === 'cue');
    let timingAncestry = timingFixture.authority.state().mediaAncestry;
    let timing = await timingFixture.pack.invoke('presentation_authoring_cell_set_timing', {
      id: 'semantic-anchor-offset',
      base: base(timingFixture.project),
      payload: {
        cellId: timedCue.id,
        timing: {
          ...timedCue.timing,
          at: { ...timedCue.timing.at, offsetMs: 40 },
        },
      },
    });
    assert.equal(timing.mediaDisposition.status, 'preserved');
    assert.deepEqual(timing.mediaDisposition.mediaAncestry, timingAncestry);
    assert.equal(timing.projectionStatus.status, 'stale');
    assert.equal(Object.hasOwn(timing, 'schedule'), false);
    assert.equal(Object.hasOwn(timing, 'nle'), false);

    let narrationFixture = fixturePack();
    let narration = narrationFixture.project.cells.find((cell) => cell.kind === 'narration');
    let changed = await narrationFixture.pack.invoke('presentation_authoring_cell_set_content', {
      id: 'narration-delivery-change',
      base: base(narrationFixture.project),
      payload: {
        cellId: narration.id,
        content: {
          ...narration.turn,
          delivery: { emotion: 'warm', pace: 'brisk', tone: 'clear' },
        },
      },
    });
    assert.equal(changed.mediaDisposition.status, 'invalidated');
    assert.deepEqual(changed.mediaDisposition.invalidation.invalidates, [
      'narration-audio', 'alignment', 'render',
    ]);
  });

  it('invalidates narration lineage and restores playability only in accepted order', async () => {
    let fixture = fixturePack();
    let narration = fixture.project.cells.find((cell) => cell.kind === 'narration');
    let oldAncestry = fixture.authority.state().mediaAncestry;
    let edited = await fixture.pack.invoke('presentation_authoring_cell_set_content', {
      id: 'rewrite-narration',
      base: base(fixture.project),
      payload: {
        cellId: narration.id,
        content: { ...narration.turn, text: 'Inspect the updated result carefully.' },
      },
    });

    assert.equal(edited.mediaDisposition.status, 'invalidated');
    assert.deepEqual(edited.mediaDisposition.invalidation.preservedLineage, {
      narrationAudioHash: oldAncestry.audio.hash,
      alignmentHash: oldAncestry.alignment.hash,
      renderHash: oldAncestry.render.hash,
    });
    assert.deepEqual([
      edited.mediaDisposition.mediaAncestry.audio.status,
      edited.mediaDisposition.mediaAncestry.alignment.status,
      edited.mediaDisposition.mediaAncestry.render.status,
      edited.mediaDisposition.mediaAncestry.playable,
    ], ['stale', 'stale', 'stale', false]);
    assert.equal(edited.projectionStatus.status, 'stale');
    assert.equal(Object.hasOwn(edited, 'schedule'), false);
    assert.equal(Object.hasOwn(edited, 'nle'), false);

    let currentBase = base(edited.project);
    await assert.rejects(
      fixture.pack.invoke('presentation_authoring_regeneration_request', {
        id: 'align-too-early', base: currentBase, dependency: 'alignment',
      }),
      (error) => error.code === 'PRESENTATION_AUTHORING_REGENERATION_ORDER',
    );
    await fixture.pack.invoke('presentation_authoring_regeneration_request', {
      id: 'regenerate-audio', base: currentBase, dependency: 'narration-audio',
    });
    let audioReceiptId = fixture.regeneration.accept('regenerate-audio', 'sha256-audio-v2');
    let audio = await fixture.pack.invoke('presentation_authoring_regeneration_inspect', {
      receiptId: audioReceiptId, base: currentBase,
    });
    assert.deepEqual([
      audio.mediaDisposition.mediaAncestry.audio.status,
      audio.mediaDisposition.mediaAncestry.playable,
    ], ['accepted', false]);

    let nextAlignment = alignedSequence(edited.project, 'sha256-audio-v2');
    fixture.authority.replaceAlignment(nextAlignment);
    let alignmentRequest = await fixture.pack.invoke(
      'presentation_authoring_regeneration_request',
      { id: 'regenerate-alignment', base: currentBase, dependency: 'alignment' },
    );
    assert.deepEqual(alignmentRequest.request.predecessors, {
      narrationAudioHash: 'sha256-audio-v2',
    });
    let alignmentReceiptId = fixture.regeneration.accept(
      'regenerate-alignment', nextAlignment.hash,
    );
    let alignment = await fixture.pack.invoke('presentation_authoring_regeneration_inspect', {
      receiptId: alignmentReceiptId, base: currentBase,
    });
    assert.equal(alignment.projectionStatus.status, 'ready');
    assert.equal(alignment.mediaDisposition.mediaAncestry.playable, false);

    let renderRequest = await fixture.pack.invoke('presentation_authoring_regeneration_request', {
      id: 'regenerate-render', base: currentBase, dependency: 'render',
    });
    assert.deepEqual(renderRequest.request.predecessors, {
      narrationAudioHash: 'sha256-audio-v2',
      alignmentHash: nextAlignment.hash,
    });
    let renderReceiptId = fixture.regeneration.accept('regenerate-render', 'sha256-render-v2');
    let render = await fixture.pack.invoke('presentation_authoring_regeneration_inspect', {
      receiptId: renderReceiptId, base: currentBase,
    });
    assert.equal(render.mediaDisposition.mediaAncestry.playable, true);
    assert.deepEqual([
      render.mediaDisposition.mediaAncestry.audio.hash,
      render.mediaDisposition.mediaAncestry.alignment.hash,
      render.mediaDisposition.mediaAncestry.render.hash,
    ], ['sha256-audio-v2', nextAlignment.hash, 'sha256-render-v2']);
  });

  it('regenerates one entry in a 30-artifact collection without mutating another entry', async () => {
    let fixture = collectionFixturePack();
    let narrationCells = fixture.project.cells.filter((cell) => cell.kind === 'narration');
    let targetCell = narrationCells[7];
    let otherCell = narrationCells[19];
    let targetBefore = fixture.mediaCollection.entries.find(
      (entry) => entry.narrationCellId === targetCell.id,
    );
    let otherBefore = fixture.mediaCollection.entries.find(
      (entry) => entry.narrationCellId === otherCell.id,
    );
    let otherBytes = canonicalize(otherBefore);

    let edited = await fixture.pack.invoke('presentation_authoring_cell_set_content', {
      id: 'rewrite-one-collection-entry',
      base: base(fixture.project),
      payload: {
        cellId: targetCell.id,
        content: { ...targetCell.turn, text: 'Explain the independently updated entry.' },
      },
    });

    assert.equal(edited.mediaDisposition.status, 'invalidated');
    assert.equal(edited.mediaDisposition.invalidations.length, 1);
    let collection = edited.mediaDisposition.mediaCollection;
    let target = collection.entries.find((entry) => entry.entryId === targetBefore.entryId);
    let other = collection.entries.find((entry) => entry.entryId === otherBefore.entryId);
    let scope = artifactScope(collection, target);
    assert.deepEqual(edited.mediaDisposition.invalidations[0].artifactScope, scope);
    assert.deepEqual([
      target.mediaAncestry.audio.status,
      target.mediaAncestry.alignment.status,
      target.mediaAncestry.render.status,
      target.mediaAncestry.playable,
    ], ['stale', 'stale', 'stale', false]);
    assert.equal(canonicalize(other), otherBytes);
    assert.equal(edited.projectionStatus.status, 'missing');

    let currentBase = base(edited.project);
    let audioRequest = await fixture.pack.invoke(
      'presentation_authoring_regeneration_request',
      {
        id: 'regenerate-scoped-audio',
        base: currentBase,
        artifactScope: scope,
        dependency: 'narration-audio',
      },
    );
    assert.equal(audioRequest.request.schemaVersion, SCOPED_REGENERATION_REQUEST_VERSION);
    assert.deepEqual(audioRequest.request.artifactScope, scope);
    let requestContent = structuredClone(audioRequest.request);
    delete requestContent.hash;
    assert.equal(
      audioRequest.request.hash,
      `${SCOPED_REGENERATION_REQUEST_VERSION}:${computeIntegrity(requestContent)}`,
    );
    let audioReceiptId = fixture.regeneration.accept(
      audioRequest.request.id,
      'sha256-audio:entry-08:v2',
    );
    let audio = await fixture.pack.invoke('presentation_authoring_regeneration_inspect', {
      receiptId: audioReceiptId,
      base: currentBase,
      artifactScope: scope,
    });
    assert.deepEqual(audio.receipt.artifactScope, scope);
    let receiptContent = structuredClone(audio.receipt);
    delete receiptContent.hash;
    assert.equal(
      audio.receipt.hash,
      `${SCOPED_REGENERATION_RECEIPT_VERSION}:${computeIntegrity(receiptContent)}`,
    );
    assert.equal(audio.mediaDisposition.mediaCollection.entries.find(
      (entry) => entry.entryId === target.entryId,
    ).mediaAncestry.audio.status, 'accepted');

    let alignmentRequest = await fixture.pack.invoke(
      'presentation_authoring_regeneration_request',
      {
        id: 'regenerate-scoped-alignment',
        base: currentBase,
        artifactScope: scope,
        dependency: 'alignment',
      },
    );
    assert.deepEqual(alignmentRequest.request.predecessors, {
      narrationAudioHash: 'sha256-audio:entry-08:v2',
    });
    let alignmentReceiptId = fixture.regeneration.accept(
      alignmentRequest.request.id,
      'sha256-alignment:entry-08:v2',
    );
    await fixture.pack.invoke('presentation_authoring_regeneration_inspect', {
      receiptId: alignmentReceiptId,
      base: currentBase,
      artifactScope: scope,
    });

    let renderRequest = await fixture.pack.invoke(
      'presentation_authoring_regeneration_request',
      {
        id: 'regenerate-scoped-render',
        base: currentBase,
        artifactScope: scope,
        dependency: 'render',
      },
    );
    assert.deepEqual(renderRequest.request.predecessors, {
      narrationAudioHash: 'sha256-audio:entry-08:v2',
      alignmentHash: 'sha256-alignment:entry-08:v2',
    });
    let renderReceiptId = fixture.regeneration.accept(
      renderRequest.request.id,
      'sha256-render:entry-08:v2',
    );
    let render = await fixture.pack.invoke('presentation_authoring_regeneration_inspect', {
      receiptId: renderReceiptId,
      base: currentBase,
      artifactScope: scope,
    });
    let finalTarget = render.mediaDisposition.mediaCollection.entries.find(
      (entry) => entry.entryId === target.entryId,
    );
    let finalOther = render.mediaDisposition.mediaCollection.entries.find(
      (entry) => entry.entryId === other.entryId,
    );
    assert.equal(finalTarget.mediaAncestry.playable, true);
    assert.deepEqual([
      finalTarget.mediaAncestry.audio.hash,
      finalTarget.mediaAncestry.alignment.hash,
      finalTarget.mediaAncestry.render.hash,
    ], [
      'sha256-audio:entry-08:v2',
      'sha256-alignment:entry-08:v2',
      'sha256-render:entry-08:v2',
    ]);
    assert.equal(canonicalize(finalOther), otherBytes);
    assert.equal(fixture.authority.counts().commits, 4);
  });

  it('rejects wrong collection scope and stale scoped ancestry before authority mutation', async () => {
    let cases = [
      {
        name: 'different entry scope',
        request({ currentBase, target, other }) {
          return scopedRequestValue({
            id: 'wrong-entry-scope',
            base: currentBase,
            scope: other.scope,
            dependency: 'narration-audio',
            narration: other.narrationHash,
            predecessors: {},
          });
        },
      },
      {
        name: 'old Project base',
        request({ currentBase, target }) {
          return scopedRequestValue({
            id: 'old-project-base',
            base: { ...currentBase, revision: currentBase.revision - 1 },
            scope: target.scope,
            dependency: 'narration-audio',
            narration: target.narrationHash,
            predecessors: {},
          });
        },
      },
      {
        name: 'old collection manifest',
        request({ currentBase, target }) {
          return scopedRequestValue({
            id: 'old-collection-manifest',
            base: currentBase,
            scope: { ...target.scope, manifestHash: 'sha256-collection-manifest-old' },
            dependency: 'narration-audio',
            narration: target.narrationHash,
            predecessors: {},
          });
        },
      },
      {
        name: 'stale narration hash',
        request({ currentBase, target }) {
          return scopedRequestValue({
            id: 'stale-narration',
            base: currentBase,
            scope: target.scope,
            dependency: 'narration-audio',
            narration: 'workspace-presentation-narration-v1:stale',
            predecessors: {},
          });
        },
      },
      {
        name: 'stale predecessor hash',
        request({ currentBase, target }) {
          return scopedRequestValue({
            id: 'stale-predecessor',
            base: currentBase,
            scope: target.scope,
            dependency: 'alignment',
            narration: target.narrationHash,
            predecessors: { narrationAudioHash: 'sha256-audio:stale' },
          });
        },
      },
    ];

    for (let testCase of cases) {
      let fixture = collectionFixturePack({ revision: 1 });
      let targetEntry = fixture.mediaCollection.entries[3];
      let otherEntry = fixture.mediaCollection.entries[11];
      let target = {
        scope: artifactScope(fixture.mediaCollection, targetEntry),
        narrationHash: targetEntry.mediaAncestry.narrationHash,
      };
      let other = {
        scope: artifactScope(fixture.mediaCollection, otherEntry),
        narrationHash: otherEntry.mediaAncestry.narrationHash,
      };
      let currentBase = base(fixture.project);
      let request = testCase.request({ currentBase, target, other });
      let receipt = receiptFor(request, 'accepted', `sha256-artifact:${testCase.name}`);
      let regeneration = {
        request() {
          throw new Error('request must not be called');
        },
        inspect(receiptId) {
          assert.equal(receiptId, receipt.receiptId);
          return structuredClone(receipt);
        },
      };
      let pack = createPresentationAuthoringToolPack({
        authority: fixture.authority,
        regeneration,
      });
      let before = fixture.authority.state();
      let commits = fixture.authority.counts().commits;

      await assert.rejects(
        pack.invoke('presentation_authoring_regeneration_inspect', {
          receiptId: receipt.receiptId,
          base: currentBase,
          artifactScope: target.scope,
        }),
        (error) => (
          error instanceof PresentationAuthoringToolError
          && error.code === 'PRESENTATION_AUTHORING_REGENERATION_RECEIPT_STALE'
        ),
        testCase.name,
      );
      assert.deepEqual(fixture.authority.state(), before, testCase.name);
      assert.equal(fixture.authority.counts().commits, commits, testCase.name);
    }
  });

  it('inspects current semantic state without mutation', async () => {
    let fixture = fixturePack();
    let before = fixture.authority.state();
    let commits = fixture.authority.counts().commits;
    let result = await fixture.pack.invoke('presentation_authoring_inspect', {});
    assert.deepEqual(result.project, before.project);
    assert.deepEqual(result.layers, before.project.layers);
    assert.deepEqual(result.cells, before.project.cells);
    assert.deepEqual(result.mediaAncestry, before.mediaAncestry);
    assert.equal(result.projectionStatus.status, 'ready');
    assert.equal(result.descriptors.length, 15);
    assert.equal(fixture.authority.counts().commits, commits);
  });

  it('exports the same Node-safe functions from every public entry point', () => {
    for (let api of [rootApi, runtimeApi, browserApi, directApi]) {
      assert.equal(api.createPresentationAuthoringToolPack, createPresentationAuthoringToolPack);
      assert.equal(api.listPresentationAuthoringToolDescriptors, listPresentationAuthoringToolDescriptors);
      assert.equal(api.PresentationAuthoringToolError, PresentationAuthoringToolError);
    }
  });
});
