import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../schema/canonical-json.js';
import * as browserApi from '../browser.js';
import * as rootApi from '../index.js';
import * as runtimeApi from '../runtime/index.js';
import {
  PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
  PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION,
  applyPresentationAuthoringProjectCommand,
  applyPresentationAuthoringProjectCommands,
  createPresentationAuthoringProject,
  createPresentationAuthoringProjectFromTimeline,
  createPresentationAuthoringProjectHashes,
  createPresentationTimelineContract,
  createPresentationAuthoringTimelineProjection,
  invertPresentationAuthoringProjectCommand,
  listPresentationAuthoringProjectCommandDescriptors,
  validatePresentationAuthoringProject,
} from '../index.js';

function timelineFixture() {
  return createPresentationTimelineContract({
    contractVersion: 'presentation-timeline-v3',
    id: 'provider-project-demo',
    title: 'Provider Project Demo',
    locale: 'en-US',
    profile: 'dialogue',
    personas: {
      guide: {
        name: 'Guide',
        role: 'lesson guide',
        locale: 'en-US',
        delivery: { emotion: 'warm', pace: 'normal', tone: 'clear' },
      },
      operator: {
        name: 'Operator',
        role: 'domain operator',
        locale: 'en-US',
        delivery: { emotion: 'curious', pace: 'brisk' },
      },
    },
    grounding: {
      sources: [{
        id: 'workspace-state',
        kind: 'records',
        path: 'workspace.current',
        targetId: 'panel:workspace',
        contentHash: 'sha256-workspace',
        generation: 3,
        summary: 'Current workspace state.',
      }],
    },
    turns: [
      {
        id: 'open',
        persona: 'guide',
        addressee: 'operator',
        dialogueAct: 'ask',
        text: 'Open the workspace and inspect the result.',
        sourceRefs: [{
          sourceId: 'workspace-state',
          hash: 'sha256-workspace',
          targetId: 'panel:workspace',
        }],
        claims: [],
        delivery: { emotion: 'warm', pace: 'normal' },
        cues: [
          {
            kind: 'interaction',
            targetId: 'panel:workspace',
            tabId: 'workspace',
            at: {
              anchor: 'speech',
              quote: 'Open the workspace',
              occurrence: 1,
              edge: 'start',
              offsetMs: 0,
            },
            interaction: {
              type: 'scroll',
              binding: {
                source: 'webmcp',
                tool: 'workspace.reveal',
                input: { targetId: 'panel:workspace' },
              },
              reversible: true,
            },
          },
          {
            kind: 'annotation',
            targetId: 'panel:workspace',
            at: {
              anchor: 'speech',
              quote: 'inspect the result',
              occurrence: 1,
              edge: 'start',
              offsetMs: 0,
            },
            until: { anchor: 'turn-end', offsetMs: 0 },
            annotation: {
              intent: 'emphasize',
              marker: 'box',
              placement: 'over',
            },
          },
        ],
      },
      {
        id: 'answer',
        persona: 'operator',
        addressee: 'guide',
        dialogueAct: 'respond',
        replyTo: 'open',
        text: 'The result is ready and the selected state is visible.',
        sourceRefs: [{
          sourceId: 'workspace-state',
          hash: 'sha256-workspace',
          targetId: 'panel:workspace',
        }],
        claims: [{
          id: 'ready-state',
          kind: 'state',
          text: 'The selected state is visible.',
          factRefs: ['ready'],
          evidenceRefs: ['workspace-state'],
          targetRefs: ['panel:workspace'],
        }],
        transition: { pauseBeforeMs: 120, overlapMs: 0 },
        cues: [
          {
            kind: 'focus',
            targetId: 'panel:workspace',
            at: {
              anchor: 'speech',
              quote: 'selected state',
              occurrence: 1,
              edge: 'start',
              offsetMs: 0,
            },
            until: { anchor: 'turn-end', offsetMs: 0 },
            focus: { mode: 'frame' },
          },
          {
            kind: 'state',
            targetId: 'panel:workspace',
            at: { anchor: 'turn-end', offsetMs: 0 },
            state: { condition: 'paint-stable', timeoutMs: 5000 },
          },
        ],
      },
    ],
    source: 'provider-fixture',
    metadata: { audience: 'operators', fixtureRevision: 3 },
  });
}

function command(project, id, type, payload) {
  return {
    schemaVersion: PRESENTATION_AUTHORING_COMMAND_SCHEMA_VERSION,
    id,
    base: { revision: project.revision, authoringProjectHash: project.hash },
    type,
    payload,
  };
}

describe('workspace presentation authoring project v1', () => {
  it('round-trips a canonical v3 timeline byte-for-byte without a second timeline store', () => {
    let timeline = timelineFixture();
    let imported = createPresentationAuthoringProjectFromTimeline(timeline);
    let projection = createPresentationAuthoringTimelineProjection(imported.project);

    assert.equal(imported.project.schemaVersion, PRESENTATION_AUTHORING_PROJECT_SCHEMA_VERSION);
    assert.equal(imported.project.revision, 0);
    assert.equal(imported.project.script.turns, undefined);
    assert.equal(canonicalize(projection), canonicalize(timeline));
    assert.equal(projection.hash, timeline.hash);
    assert.equal(imported.mapping.turns.length, timeline.turns.length);
    assert.equal(imported.mapping.cues.length, 4);
    assert.equal(validatePresentationAuthoringProject(imported.project), imported.project);

    let hashes = createPresentationAuthoringProjectHashes(imported.project);
    assert.equal(hashes.authoringProjectHash, imported.project.hash);
    assert.equal(hashes.timelineHash, timeline.hash);
    assert.equal(hashes.layerHashes.length, imported.project.layers.length);
    assert.equal(hashes.cellHashes.length, imported.project.cells.length);
  });

  it('preserves stable cell identity through moves and uses canonical slice hashes', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let cueCells = project.cells.filter((cell) => cell.kind === 'cue');
    let movedCell = cueCells[1];
    let beforeHashes = createPresentationAuthoringProjectHashes(project);
    let applied = applyPresentationAuthoringProjectCommand(project, command(
      project,
      'move-attention',
      'cell.move',
      { cellId: movedCell.id, index: project.cells.length - 1 },
    ));
    let afterCell = applied.project.cells.find((cell) => cell.id === movedCell.id);
    let afterHashes = createPresentationAuthoringProjectHashes(applied.project);

    assert.equal(afterCell.id, movedCell.id);
    assert.equal(applied.project.revision, 1);
    assert.notEqual(applied.project.hash, project.hash);
    assert.equal(
      beforeHashes.cellHashes.find((item) => item.cellId === movedCell.id).hash,
      afterHashes.cellHashes.find((item) => item.cellId === movedCell.id).hash,
    );

    let reorderedKeys = {
      cells: applied.project.cells,
      layers: applied.project.layers,
      policy: applied.project.policy,
      script: applied.project.script,
      revision: applied.project.revision,
      id: applied.project.id,
      schemaVersion: applied.project.schemaVersion,
    };
    assert.equal(createPresentationAuthoringProject(reorderedKeys).hash, applied.project.hash);
  });

  it('invalidates only the affected authored slices for project-only timing edits', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let cue = project.cells.find((cell) => cell.kind === 'cue' && cell.cue.kind === 'focus');
    let before = createPresentationAuthoringProjectHashes(project);
    let applied = applyPresentationAuthoringProjectCommand(project, command(
      project,
      'selective-timing-edit',
      'cell.set-timing',
      { cellId: cue.id, timing: { ...cue.timing, leadMs: 240 } },
    ));
    let after = createPresentationAuthoringProjectHashes(applied.project);
    let cueLayerId = cue.layerId;

    assert.notEqual(after.authoringProjectHash, before.authoringProjectHash);
    assert.equal(after.timelineHash, before.timelineHash);
    assert.notEqual(
      after.cellHashes.find((item) => item.cellId === cue.id).hash,
      before.cellHashes.find((item) => item.cellId === cue.id).hash,
    );
    assert.notEqual(
      after.layerHashes.find((item) => item.layerId === cueLayerId).hash,
      before.layerHashes.find((item) => item.layerId === cueLayerId).hash,
    );
    for (let item of before.layerHashes.filter((entry) => entry.layerId !== cueLayerId)) {
      assert.equal(
        after.layerHashes.find((entry) => entry.layerId === item.layerId).hash,
        item.hash,
      );
    }
  });

  it('shares one bounded command contract across callers, rejects stale bases, and inverts edits', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let cue = project.cells.find((cell) => cell.kind === 'cue' && cell.cue.kind === 'annotation');
    let edit = command(project, 'timing-edit', 'cell.set-timing', {
      cellId: cue.id,
      timing: { ...cue.timing, leadMs: 280, gestureDurationMs: 360, settleBy: 'anchor' },
    });
    let uiResult = applyPresentationAuthoringProjectCommand(project, edit);
    let agentResult = applyPresentationAuthoringProjectCommand(project, structuredClone(edit));

    assert.deepEqual(agentResult, uiResult);
    assert.equal(uiResult.receipt.commandId, edit.id);
    assert.equal(uiResult.change.type, 'cell.set-timing');
    assert.throws(
      () => applyPresentationAuthoringProjectCommand(uiResult.project, edit),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_STALE',
    );

    let inverse = invertPresentationAuthoringProjectCommand(edit, uiResult);
    let restored = applyPresentationAuthoringProjectCommand(uiResult.project, inverse);
    let restoredCue = restored.project.cells.find((cell) => cell.id === cue.id);
    assert.deepEqual(restoredCue.timing, cue.timing);

    let descriptorTypes = listPresentationAuthoringProjectCommandDescriptors()
      .map((descriptor) => descriptor.type);
    assert.deepEqual(descriptorTypes, [
      'layer.add',
      'layer.update',
      'layer.remove',
      'layer.move',
      'cell.add',
      'cell.remove',
      'cell.move',
      'cell.set-content',
      'cell.set-timing',
      'cell.set-dependencies',
      'narration.replace',
    ]);
  });

  it('rejects runtime-only browser observations from authored project data', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let cue = project.cells.find((cell) => cell.kind === 'cue');
    let cells = project.cells.map((cell) => (
      cell.id === cue.id
        ? { ...cell, cue: { ...cell.cue, selector: '#private-node' } }
        : cell
    ));

    assert.throws(
      () => createPresentationAuthoringProject({ ...project, cells }),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_RUNTIME_DATA',
    );
  });

  it('rejects selector-shaped targets and rectangle interaction parameters structurally', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let cue = project.cells.find((cell) => cell.cue?.interaction);
    let cells = project.cells.map((cell) => (
      cell.id === cue.id
        ? {
            ...cell,
            cue: {
              ...cell.cue,
              targetId: '#private-node',
              interaction: {
                ...cell.cue.interaction,
                parameters: { x: 12, y: 24, width: 320, height: 180 },
              },
            },
          }
        : cell
    ));

    assert.throws(
      () => createPresentationAuthoringProject({ ...project, cells }),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_RUNTIME_DATA',
    );
  });

  it('validates dependency references, self-reference, cycles, and barriers in Authoring Project', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let cueCells = project.cells.filter((cell) => cell.kind === 'cue');
    let narration = project.cells.find((cell) => cell.kind === 'narration');
    let [first, second] = cueCells;
    let withDependencies = (updates) => createPresentationAuthoringProject({
      ...project,
      cells: project.cells.map((cell) => ({
        ...cell,
        dependsOn: updates[cell.id] ?? cell.dependsOn,
      })),
    });

    assert.throws(
      () => withDependencies({
        [first.id]: [{ cellId: 'missing-cell', barrier: 'settled' }],
      }),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_UNKNOWN_DEPENDENCY',
    );
    assert.throws(
      () => withDependencies({
        [first.id]: [{ cellId: first.id, barrier: 'settled' }],
      }),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_DEPENDENCY_SELF_REFERENCE',
    );
    assert.throws(
      () => withDependencies({
        [first.id]: [{ cellId: second.id, barrier: 'settled' }],
        [second.id]: [{ cellId: first.id, barrier: 'settled' }],
      }),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_DEPENDENCY_CYCLE',
    );
    assert.throws(
      () => withDependencies({
        [first.id]: [{ cellId: narration.id, barrier: 'ready' }],
      }),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_BARRIER_UNAVAILABLE',
    );
  });

  it('exposes only the typed barriers supplied by each Authoring Project cell kind', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let narration = project.cells.find((cell) => cell.kind === 'narration');
    let interaction = project.cells.find((cell) => cell.cue?.kind === 'interaction');
    let annotation = project.cells.find((cell) => cell.cue?.kind === 'annotation');
    let focus = project.cells.find((cell) => cell.cue?.kind === 'focus');
    let state = project.cells.find((cell) => cell.cue?.kind === 'state');
    let accepted = [
      [narration, 'ended', interaction],
      [annotation, 'ended', interaction],
      [focus, 'settled', interaction],
      [interaction, 'acted', annotation],
      [state, 'ready', focus],
    ];

    for (let [source, barrier, dependent] of accepted) {
      let cells = project.cells.map((cell) => (
        cell.id === dependent.id
          ? { ...cell, dependsOn: [{ cellId: source.id, barrier }] }
          : cell
      ));
      assert.doesNotThrow(() => createPresentationAuthoringProject({ ...project, cells }));
    }
  });

  it('requires one project-wide exclusive presenter collision domain', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let alternateDomain = {
      id: `${project.id}:alternate-presenter`,
      name: 'Alternate presenter',
      exclusive: true,
    };
    let layers = project.layers.map((layer) => (
      layer.kind === 'annotation'
        ? { ...layer, collisionDomainId: alternateDomain.id }
        : layer
    ));

    assert.throws(
      () => createPresentationAuthoringProject({
        ...project,
        policy: {
          ...project.policy,
          collisionDomains: [...project.policy.collisionDomains, alternateDomain],
        },
        layers,
      }),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_COLLISION_DOMAIN_INVALID',
    );
  });

  it('applies same-base command batches with one final Project validation', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let narration = project.cells.find((cell) => cell.turnId === 'open' && cell.kind === 'narration');
    let cue = project.cells.find((cell) => (
      cell.turnId === narration.turnId && cell.cue?.kind === 'interaction'
    ));
    let turn = {
      ...narration.turn,
      text: 'Review the workspace and inspect the result.',
    };
    let timing = {
      ...cue.timing,
      at: { ...cue.timing.at, quote: 'Review the workspace' },
    };
    let commands = [
      command(project, 'batch-narration', 'cell.set-content', {
        cellId: narration.id,
        content: turn,
      }),
      command(project, 'batch-timing', 'cell.set-timing', {
        cellId: cue.id,
        timing,
      }),
    ];
    let projectBefore = structuredClone(project);
    let commandsBefore = structuredClone(commands);

    for (let singular of commands) {
      assert.throws(
        () => applyPresentationAuthoringProjectCommand(project, singular),
        (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_INVALID',
      );
    }
    let result = applyPresentationAuthoringProjectCommands(project, commands);
    let resultCue = result.project.cells.find((cell) => cell.id === cue.id);

    assert.equal(result.project.revision, project.revision + 1);
    assert.equal(resultCue.timing.at.quote, 'Review the workspace');
    assert.equal(result.changes.length, commands.length);
    assert.equal(result.receipts.length, commands.length);
    assert.equal(result.receipts.every((receipt) => (
      receipt.revision === result.project.revision
      && receipt.authoringProjectHash === result.project.hash
    )), true);
    assert.deepEqual(project, projectBefore);
    assert.deepEqual(commands, commandsBefore);
  });

  it('applies and inverts one bounded narration replacement command', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let narration = project.cells.find((cell) => cell.turnId === 'open' && cell.kind === 'narration');
    let cue = project.cells.find((cell) => (
      cell.turnId === narration.turnId && cell.cue?.kind === 'interaction'
    ));
    let turn = {
      ...narration.turn,
      text: 'Review the workspace and inspect the result.',
    };
    let replacement = command(project, 'replace-narration', 'narration.replace', {
      narrationCellId: narration.id,
      turn,
      cueBindings: [{
        cueCellId: cue.id,
        at: { ...cue.timing.at, quote: 'Review the workspace' },
        until: cue.timing.until,
      }],
    });
    let applied = applyPresentationAuthoringProjectCommand(project, replacement);
    let appliedCue = applied.project.cells.find((cell) => cell.id === cue.id);

    assert.equal(applied.project.revision, project.revision + 1);
    assert.equal(applied.receipt.authoringProjectHash, applied.project.hash);
    assert.equal(applied.change.type, 'narration.replace');
    assert.equal(applied.change.before.turn.text, narration.turn.text);
    assert.equal(applied.change.after.turn.text, turn.text);
    assert.equal(appliedCue.timing.at.quote, 'Review the workspace');
    assert.equal(appliedCue.timing.leadMs, cue.timing.leadMs);
    assert.equal(appliedCue.timing.gestureDurationMs, cue.timing.gestureDurationMs);
    assert.equal(appliedCue.timing.settleBy, cue.timing.settleBy);
    assert.deepEqual(appliedCue.cue, cue.cue);
    assert.deepEqual(appliedCue.dependsOn, cue.dependsOn);

    let inverse = invertPresentationAuthoringProjectCommand(replacement, applied);
    let restored = applyPresentationAuthoringProjectCommand(applied.project, inverse);
    assert.deepEqual(restored.project.cells, project.cells);
    assert.deepEqual(restored.project.script, project.script);
    assert.deepEqual(restored.project.layers, project.layers);
    assert.deepEqual(restored.project.policy, project.policy);
  });

  it('rejects unbounded narration replacement targets and invalid final anchors', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let narration = project.cells.find((cell) => cell.turnId === 'open' && cell.kind === 'narration');
    let cue = project.cells.find((cell) => (
      cell.turnId === narration.turnId && cell.cue?.kind === 'interaction'
    ));
    let otherCue = project.cells.find((cell) => cell.turnId === 'answer' && cell.kind === 'cue');
    let stateCue = project.cells.find((cell) => cell.cue?.kind === 'state');
    let stateNarration = project.cells.find((cell) => (
      cell.turnId === stateCue.turnId && cell.kind === 'narration'
    ));
    let binding = {
      cueCellId: cue.id,
      at: cue.timing.at,
      until: cue.timing.until,
    };
    let replacement = (id, narrationCell, turn, cueBindings) => command(
      project,
      id,
      'narration.replace',
      { narrationCellId: narrationCell.id, turn, cueBindings },
    );

    assert.throws(
      () => applyPresentationAuthoringProjectCommand(project, replacement(
        'duplicate-binding',
        narration,
        narration.turn,
        [binding, binding],
      )),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_DUPLICATE_ID',
    );
    assert.throws(
      () => applyPresentationAuthoringProjectCommand(project, replacement(
        'cross-turn-binding',
        narration,
        narration.turn,
        [{ cueCellId: otherCue.id, at: otherCue.timing.at, until: otherCue.timing.until }],
      )),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_INVALID',
    );
    assert.throws(
      () => applyPresentationAuthoringProjectCommand(project, replacement(
        'non-speech-binding',
        stateNarration,
        stateNarration.turn,
        [{ cueCellId: stateCue.id, at: stateCue.timing.at, until: stateCue.timing.until }],
      )),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_INVALID',
    );
    assert.throws(
      () => applyPresentationAuthoringProjectCommand(project, replacement(
        'wrong-narration-cell-kind',
        cue,
        narration.turn,
        [binding],
      )),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_INVALID',
    );
    assert.throws(
      () => applyPresentationAuthoringProjectCommand(project, replacement(
        'wrong-cue-cell-kind',
        narration,
        narration.turn,
        [{ cueCellId: narration.id, at: cue.timing.at, until: cue.timing.until }],
      )),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_INVALID',
    );
    assert.throws(
      () => applyPresentationAuthoringProjectCommand(project, replacement(
        'changed-turn-identity',
        narration,
        { ...narration.turn, id: 'replacement-turn' },
        [binding],
      )),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_INVALID',
    );
    assert.throws(
      () => applyPresentationAuthoringProjectCommand(project, replacement(
        'empty-cue-bindings',
        narration,
        narration.turn,
        [],
      )),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_INVALID',
    );
    assert.throws(
      () => applyPresentationAuthoringProjectCommand(project, replacement(
        'incomplete-final-anchor',
        narration,
        { ...narration.turn, text: 'Review the workspace.' },
        [{
          cueCellId: cue.id,
          at: { ...cue.timing.at, quote: 'Review the workspace' },
          until: cue.timing.until,
        }],
      )),
      (error) => error.code === 'PRESENTATION_AUTHORING_PROJECT_INVALID',
    );
  });

  it('rejects mixed bases and leaves an atomic batch input unchanged on failure', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let cue = project.cells.find((cell) => cell.kind === 'cue');
    let valid = command(project, 'valid-first', 'cell.set-timing', {
      cellId: cue.id,
      timing: { ...cue.timing, leadMs: 160 },
    });
    let invalid = command(project, 'invalid-second', 'cell.add', { cell: cue });
    let projectBefore = structuredClone(project);
    let commands = [valid, invalid];
    let commandsBefore = structuredClone(commands);

    assert.throws(
      () => applyPresentationAuthoringProjectCommands(project, commands),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_DUPLICATE_ID',
    );
    assert.deepEqual(project, projectBefore);
    assert.deepEqual(commands, commandsBefore);

    let mixed = structuredClone(valid);
    mixed.id = 'mixed-base';
    mixed.base.revision += 1;
    assert.throws(
      () => applyPresentationAuthoringProjectCommands(project, [valid, mixed]),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_STALE',
    );

    let duplicateCommandId = command(project, valid.id, 'cell.move', {
      cellId: cue.id,
      index: project.cells.length - 1,
    });
    assert.throws(
      () => applyPresentationAuthoringProjectCommands(project, [valid, duplicateCommandId]),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_DUPLICATE_ID',
    );
  });

  it('refuses inverse provenance from a different same-type application', () => {
    let { project } = createPresentationAuthoringProjectFromTimeline(timelineFixture());
    let cue = project.cells.find((cell) => cell.kind === 'cue');
    let first = command(project, 'first-timing', 'cell.set-timing', {
      cellId: cue.id,
      timing: { ...cue.timing, leadMs: 120 },
    });
    let second = command(project, 'second-timing', 'cell.set-timing', {
      cellId: cue.id,
      timing: { ...cue.timing, leadMs: 240 },
    });
    let secondApplication = applyPresentationAuthoringProjectCommand(project, second);

    assert.throws(
      () => invertPresentationAuthoringProjectCommand(first, secondApplication),
      (error) => error.code === 'PRESENTATION_AUTHORING_COMMAND_INVERSE_UNAVAILABLE',
    );
  });

  it('exports the authoring project API from root, runtime, and browser entry points', () => {
    let publicFunctions = [
      'createPresentationAuthoringProject',
      'createPresentationAuthoringProjectFromTimeline',
      'validatePresentationAuthoringProject',
      'createPresentationAuthoringProjectHashes',
      'createPresentationAuthoringTimelineProjection',
      'listPresentationAuthoringProjectCommandDescriptors',
      'applyPresentationAuthoringProjectCommand',
      'applyPresentationAuthoringProjectCommands',
      'invertPresentationAuthoringProjectCommand',
      'createPresentationScheduleV2',
      'validatePresentationScheduleV2',
      'projectPresentationNle',
      'createPresentationAuthoringCommandFromNleEdit',
    ];
    for (let api of [rootApi, runtimeApi, browserApi]) {
      for (let name of publicFunctions) {
        assert.equal(typeof api[name], 'function', `${name} must be exported`);
      }
    }
  });
});
