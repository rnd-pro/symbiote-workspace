import assert from 'node:assert/strict';
import test from 'node:test';
import * as browser from '../browser.js';
import * as root from '../index.js';
import * as presentationRuntime from '../runtime/presentation.js';
import { createPresentationLessonContext } from '../runtime/lesson-context.js';
import { createSemanticSkeleton } from '../runtime/presentation/semantic-skeleton.js';
import { createPresentationFlowBridge } from '../runtime/presentation/flow-bridge.js';
import {
  createLivePresentationProjection,
  createMediaPresentationAncestryAssertion,
  validateMediaPresentationAncestry,
} from '../runtime/presentation/presentation-project.js';
import {
  compilePresentationAuthoringPrompt,
  compilePresentationFlowPlanningPrompt,
  createPresentationAuthoringPrompt,
  createPresentationFlowPlanningPrompt,
  parsePresentationAuthoringResponse,
  parsePresentationFlowPlanningResponse,
  runPresentationFlowAuthoring,
} from '../runtime/presentation/flow-authoring.js';
import {
  bindPresentationFlowSemanticPlan,
  createPresentationDeepeningRequest,
  createPresentationAuthoringRequest,
  createPresentationFlowBasis,
  createPresentationFlowPlanOptions,
  createPresentationFlowPlanSelection,
  createPresentationFlowPlanningRequest,
  createPresentationFlowTask,
  createProjectAdaptationCapsule,
  decidePresentationFlowTransition,
} from '../runtime/presentation/flow.js';

test('exports the flow contract through Node and browser public surfaces', () => {
  for (const surface of [root, browser, presentationRuntime]) {
    assert.equal(typeof surface.createPresentationFlowTask, 'function');
    assert.equal(typeof surface.createPresentationAuthoringRequest, 'function');
    assert.equal(typeof surface.createPresentationFlowPlanningRequest, 'function');
    assert.equal(typeof surface.createPresentationFlowBridge, 'function');
    assert.equal(typeof surface.runPresentationFlowAuthoring, 'function');
    assert.equal(typeof surface.compilePresentationAuthoringPrompt, 'function');
    assert.equal(typeof surface.compilePresentationFlowPlanningPrompt, 'function');
    assert.equal(typeof surface.createPresentationDeepeningRequest, 'function');
    assert.equal(typeof surface.parsePresentationAuthoringResponse, 'function');
    assert.equal(typeof surface.parsePresentationFlowPlanningResponse, 'function');
    assert.equal(typeof surface.collectPresentationInspectionFindings, 'function');
    assert.equal(surface.WORKSPACE_PRESENTATION_FLOW_TASK_VERSION, 'workspace-presentation-flow-task-v1');
  }
});

test('compiles a bounded semantic planning request and rejects unoffered model selection', () => {
  const task = createPresentationFlowTask({ id: 'tour-plan', mode: 'author', artifactKind: 'live-tour', objective: 'Review the orders workspace', locale: 'en-US', budgets: { maxRepairRounds: 2, maxDeepeningActions: 1, maxContextQueries: 3 } });
  const adaptation = createProjectAdaptationCapsule({ id: 'neutral-fixture', version: '1', locale: 'en-US', audience: 'operator', processObjective: 'Review the current order state', profileRefs: ['persona:guide'], rubricRefs: ['presentation-core'], capabilityProfiles: ['dialogue'], guidance: [] });
  const context = lessonContext();
  const basis = createPresentationFlowBasis({ task, adaptation, lessonContext: context, generation: 4, expiresAt: 9999999999 });
  const options = createPresentationFlowPlanOptions({
    basis,
    lessonContext: context,
    actionOptions: [{ id: 'inspect-orders', actionId: 'inspect-orders', targetId: 'orders', toolId: 'inspect-orders' }],
    dialogueProfiles: ['dialogue'],
    requiredTargetIds: ['orders', 'details'],
    requiredFactIds: ['fact:status', 'fact:owner'],
  });
  const request = createPresentationFlowPlanningRequest({ task, adaptation, basis, options, lessonContext: context });
  const prompt = createPresentationFlowPlanningPrompt(request);
  const compiled = compilePresentationFlowPlanningPrompt(request);
  const selection = parsePresentationFlowPlanningResponse({
    planSelection: { targetIds: ['orders', 'details'], factIds: ['fact:status'], actionOptionIds: ['inspect-orders'], dialogueProfileId: 'dialogue' },
  }, request);

  assert.equal(prompt.selectionAuthority.targets[0].id, 'details');
  assert.equal(prompt.selectionAuthority.facts.some((fact) => fact.id === 'fact:status'), true);
  assert.equal('value' in prompt.selectionAuthority.facts[0], false);
  assert.match(compiled, /Choose only IDs from selectionAuthority/);
  assert.match(compiled, /Include every ID in selectionAuthority\.requiredTargetIds/);
  assert.match(compiled, /Include every ID in selectionAuthority\.requiredFactIds/);
  assert.deepEqual(selection.targetIds, ['details', 'orders']);
  assert.deepEqual(prompt.selectionAuthority.requiredTargetIds, ['details', 'orders']);
  assert.deepEqual(prompt.selectionAuthority.requiredFactIds, ['fact:owner', 'fact:status']);
  const partialSelection = parsePresentationFlowPlanningResponse({
    planSelection: { targetIds: ['orders'], factIds: ['fact:status'], actionOptionIds: ['inspect-orders'], dialogueProfileId: 'dialogue' },
  }, request);
  assert.deepEqual(partialSelection.targetIds, ['details', 'orders']);
  assert.deepEqual(partialSelection.factIds, ['fact:owner', 'fact:status']);
  assert.throws(() => parsePresentationFlowPlanningResponse({
    planSelection: { targetIds: ['unknown'], factIds: [], actionOptionIds: [] },
  }, request), /unoffered option/);
  assert.throws(() => parsePresentationFlowPlanningResponse({
    planSelection: { targetIds: ['orders'], factIds: [], actionOptionIds: [], extra: true },
  }, request), /Unrecognized field/);
});

function lessonContext(generation = 1) {
  const targets = [
    { id: 'orders', address: 'orders', title: 'Orders', visible: true, rendered: true },
    { id: 'details', address: 'details', title: 'Details', visible: true, rendered: true },
  ];
  return createPresentationLessonContext({
    targets,
    facts: [
      { id: 'fact:status', value: 'Approved', evidenceRefs: ['evidence:status'], targetRefs: ['orders'], narration: { role: 'substantive', coverage: 'required' } },
      { id: 'fact:owner', value: 'Morgan', evidenceRefs: ['evidence:owner'], targetRefs: ['details'], narration: { role: 'substantive', coverage: 'required' } },
    ],
    evidence: [
      { id: 'evidence:status', source: 'fixture', path: 'status', value: 'Approved', targetRefs: ['orders'], narration: { role: 'substantive', coverage: 'required' } },
      { id: 'evidence:owner', source: 'fixture', path: 'owner', value: 'Morgan', targetRefs: ['details'], narration: { role: 'substantive', coverage: 'required' } },
    ],
    relations: [{ id: 'orders-to-details', kind: 'affects', from: 'orders', to: 'details' }],
    toolDescriptors: [{ id: 'inspect-orders', name: 'inspect_orders', description: 'Inspect orders', inputSchema: { type: 'object', additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }],
  }, {
    lesson: { type: 'operational-task', title: 'Orders', objective: 'Explain approved orders', locale: 'en-US', requiredFactIds: ['fact:status', 'fact:owner'], requiredTargetIds: ['orders', 'details'] },
    sourceSnapshot: { schemaVersion: 'presentation-context-snapshot-v2', identityHash: `source-${generation}`, generation, viewport: { width: 1280, height: 720, fps: 30 }, targets },
    targetSnapshot: { schemaVersion: 'presentation-context-snapshot-v2', identityHash: `target-${generation}`, generation, viewport: { width: 1280, height: 720, fps: 30 }, targets: [{ address: 'orders' }] },
  });
}

function semanticPlan(targetId = 'orders') {
  return createSemanticSkeleton({
    locale: 'en-US', title: 'Orders', profile: 'brief', personas: { guide: { role: 'operator' } },
    grounding: {
      facts: [{ id: 'fact:status', value: 'Approved', narration: { role: 'substantive', coverage: 'required' } }],
      evidence: [{ id: 'evidence:status', value: 'Approved', narration: { role: 'structural', coverage: 'optional' } }],
      claims: [{ id: 'claim:status', kind: 'state', factRefs: ['fact:status'], tupleScope: { mode: 'single', selectors: [{ sourceId: 'fact:status', tuplePath: '/value' }] } }],
    },
    requiredTargets: [{ targetId, factRefs: ['fact:status'], evidenceRefs: ['evidence:status'], claimRefs: ['claim:status'] }],
    orderedCausalRelations: [{ targetId, factRefs: ['fact:status'], evidenceRefs: ['evidence:status'], claimRefs: [{ id: 'claim:status', kind: 'state' }], focusMode: 'none' }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  });
}

function repeatRepairPlan() {
  return createSemanticSkeleton({
    locale: 'en-US', title: 'Review', profile: 'brief', personas: { guide: { role: 'operator' }, reviewer: { role: 'operator' } },
    grounding: { facts: [], evidence: [], claims: [] },
    requiredTargets: [{ targetId: 'orders' }, { targetId: 'details' }],
    orderedCausalRelations: [
      { targetId: 'orders', focusMode: 'frame' },
      { targetId: 'details', focusMode: 'frame' },
    ],
    dialoguePlan: [
      { persona: 'guide', dialogueAct: 'explain' },
      { persona: 'reviewer', dialogueAct: 'explain' },
    ],
  });
}

test('creates a hash-bound agent task, selection and text-only authoring request from registered context', () => {
  const task = createPresentationFlowTask({ id: 'tour-1', mode: 'author', artifactKind: 'live-tour', objective: 'Review the orders workspace', locale: 'en-US', budgets: { maxRepairRounds: 2, maxDeepeningActions: 1, maxContextQueries: 3 } });
  const adaptation = createProjectAdaptationCapsule({ id: 'maintenance', version: '1', locale: 'en-US', audience: 'operator', processObjective: 'Review the current order state', profileRefs: ['persona:guide'], rubricRefs: ['presentation-core'], capabilityProfiles: ['dialogue'], guidance: ['Use operational language.'] });
  const context = lessonContext();
  const basis = createPresentationFlowBasis({ task, adaptation, lessonContext: context, generation: 4, expiresAt: 9999999999 });
  const options = createPresentationFlowPlanOptions({ basis, lessonContext: context, dialogueProfiles: ['dialogue'] });
  const selection = createPresentationFlowPlanSelection({ basis, options, selection: { targetIds: ['orders'], factIds: ['fact:status'], actionOptionIds: [], dialogueProfileId: 'dialogue' } });
  const bound = bindPresentationFlowSemanticPlan({ basis, options, selection, skeleton: semanticPlan() });
  const request = createPresentationAuthoringRequest({ basis: bound, task, adaptation, skeleton: semanticPlan(), options });

  assert.equal(request.task.objective, 'Review the orders workspace');
  assert.equal(request.semanticPlan.slots[0].slotId, semanticPlan().slots[0].slotId);
  assert.equal(request.grounding.slots[0].claims[0].facts[0].tuples[0].atoms[0].quote, 'Approved');
  assert.equal('sourceSnapshot' in request, false);
  assert.equal('toolDescriptors' in request, false);
  assert.equal(request.deepening.actionOptions.length, 0);
  assert.throws(() => createPresentationFlowPlanSelection({ basis, options, selection: { targetIds: ['unknown'], factIds: [], actionOptionIds: [] } }), /unoffered option/);
});

test('fails closed on stale context, topology drift, no progress and exhausted repair budget', () => {
  const task = createPresentationFlowTask({ id: 'tour-2', mode: 'author', artifactKind: 'live-tour', objective: 'Review orders', locale: 'en-US', budgets: { maxRepairRounds: 1, maxDeepeningActions: 0, maxContextQueries: 1 } });
  const adaptation = createProjectAdaptationCapsule({ id: 'maintenance', version: '1', locale: 'en-US', profileRefs: [], rubricRefs: [], capabilityProfiles: [], guidance: [] });
  const context = lessonContext();
  const basis = createPresentationFlowBasis({ task, adaptation, lessonContext: context, generation: 1, expiresAt: 9999999999 });
  const options = createPresentationFlowPlanOptions({ basis, lessonContext: context });
  const selection = createPresentationFlowPlanSelection({ basis, options, selection: { targetIds: ['orders'], factIds: ['fact:status'], actionOptionIds: [] } });
  const bound = bindPresentationFlowSemanticPlan({ basis, options, selection, skeleton: semanticPlan() });
  const stale = { ...bound, generation: 2 };
  delete stale.hash;
  assert.equal(decidePresentationFlowTransition({ basis: bound, currentBasis: stale, candidateHash: 'candidate-1', findings: [{ code: 'repeated-narration', slotId: 'slot-1' }], attempt: 0 }).status, 'stale');
  assert.equal(decidePresentationFlowTransition({ basis: bound, candidateHash: 'candidate-1', previousCandidateHash: 'candidate-1', findings: [{ code: 'repeated-narration', slotId: 'slot-1' }], attempt: 0 }).code, 'presentation-flow-no-progress');
  assert.equal(decidePresentationFlowTransition({ basis: bound, candidateHash: 'candidate-2', findings: [{ code: 'repeated-narration', slotId: 'slot-1' }], attempt: 1 }).code, 'presentation-flow-repair-budget-exhausted');
  assert.throws(() => bindPresentationFlowSemanticPlan({ basis, options, selection, skeleton: semanticPlan('details') }), /targets differ/);
});

test('scopes host WebMCP deepening to a current basis, registered option and safe input', async () => {
  const task = createPresentationFlowTask({ id: 'tour-bridge', mode: 'author', artifactKind: 'live-tour', objective: 'Review orders', locale: 'en-US', budgets: { maxRepairRounds: 1, maxDeepeningActions: 1, maxContextQueries: 1 } });
  const adaptation = createProjectAdaptationCapsule({ id: 'maintenance', version: '1', locale: 'en-US', profileRefs: [], rubricRefs: [], capabilityProfiles: [], guidance: [] });
  let generation = 1;
  const executions = [];
  const bridge = createPresentationFlowBridge({
    task,
    adaptation,
    now: () => 10,
    loadContext: async () => ({ lessonContext: lessonContext(generation), generation, expiresAt: 1000 }),
    listActionOptions: async () => [{ id: 'inspect-orders-option', actionId: 'inspect-orders', targetId: 'orders', toolId: 'inspect-orders' }],
    executeAction: async (request) => { executions.push(request); generation += 1; },
  });
  const initial = await bridge.start();
  assert.equal(initial.remainingDeepeningActions, 1);
  await assert.rejects(() => bridge.executeDeepening({ basisHash: initial.basis.hash, actionOptionId: 'unknown' }), /not offered/);
  await assert.rejects(() => bridge.executeDeepening({ basisHash: initial.basis.hash, actionOptionId: 'inspect-orders-option', input: { unexpected: true } }), /input-invalid/);
  const refreshed = await bridge.executeDeepening({ basisHash: initial.basis.hash, actionOptionId: 'inspect-orders-option' });
  assert.equal(executions.length, 1);
  assert.equal(executions[0].actionOption.toolId, 'inspect-orders');
  assert.equal(refreshed.basis.generation, 2);
  assert.equal(refreshed.remainingDeepeningActions, 0);
  await assert.rejects(() => bridge.executeDeepening({ basisHash: initial.basis.hash, actionOptionId: 'inspect-orders-option' }), /basis-stale/);
  await assert.rejects(() => bridge.executeDeepening({ basisHash: refreshed.basis.hash, actionOptionId: 'inspect-orders-option' }), /budget-exhausted/);
});

test('runs a portable text-only authoring loop without giving the host model topology authority', async () => {
  const task = createPresentationFlowTask({ id: 'tour-authoring', mode: 'author', artifactKind: 'live-tour', objective: 'Review orders', locale: 'en-US', budgets: { maxRepairRounds: 1, maxDeepeningActions: 0, maxContextQueries: 1 } });
  const adaptation = createProjectAdaptationCapsule({ id: 'maintenance', version: '1', locale: 'en-US', profileRefs: [], rubricRefs: [], capabilityProfiles: [], guidance: [] });
  const context = lessonContext();
  const basis = createPresentationFlowBasis({ task, adaptation, lessonContext: context, generation: 1, expiresAt: 9999999999 });
  const options = createPresentationFlowPlanOptions({ basis, lessonContext: context });
  const selection = createPresentationFlowPlanSelection({ basis, options, selection: { targetIds: ['orders'], factIds: ['fact:status'], actionOptionIds: [] } });
  const bound = bindPresentationFlowSemanticPlan({ basis, options, selection, skeleton: semanticPlan() });
  const result = await runPresentationFlowAuthoring({
    basis: bound,
    task,
    adaptation,
    skeleton: semanticPlan(),
    draft: async ({ prompt, attempt }) => {
      assert.equal(attempt, 1);
      assert.equal(prompt.responseShape.narrations[0].slotId, 'slot-1-orders');
      assert.equal('sourceSnapshot' in prompt, false);
      assert.equal('toolDescriptors' in prompt, false);
      return { narrationProjection: { narrations: [{ slotId: 'slot-1-orders', text: 'Orders are Approved.' }] } };
    },
  });
  assert.equal(result.attempts, 1);
  assert.equal(result.project.skeletonHash, semanticPlan().hash);
  assert.equal(createPresentationAuthoringPrompt(result.request).schemaVersion, 'workspace-presentation-authoring-prompt-v3');
  const compiled = compilePresentationAuthoringPrompt(result.request);
  assert.match(compiled, /Return one JSON object/);
  assert.doesNotMatch(compiled, /sourceSnapshot|toolDescriptors/);
});

test('compiles model-facing authority from claim-local substantive grounding only', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'und', title: 'Safe prompt', profile: 'brief', personas: { guide: { role: 'operator' } },
    grounding: {
      facts: [
        { id: 'structural', value: 'opaque-layout-id', narration: { role: 'structural', coverage: 'optional' } },
        { id: 'first', value: 'ALPHA-1', narration: { role: 'substantive', coverage: 'required' } },
        { id: 'second', value: 'BETA-2', narration: { role: 'substantive', coverage: 'required' } },
      ],
      claims: [
        { id: 'first-claim', kind: 'state', factRefs: ['first'] },
        { id: 'second-claim', kind: 'state', factRefs: ['second'] },
      ],
    },
    requiredTargets: [
      { targetId: 'orders', factRefs: ['structural', 'first'], claimRefs: ['first-claim'] },
      { targetId: 'details', factRefs: ['second'], claimRefs: ['second-claim'] },
    ],
    orderedCausalRelations: [
      { targetId: 'orders', factRefs: ['structural', 'first'], claimRefs: [{ id: 'first-claim', kind: 'state' }], focusMode: 'frame' },
      { targetId: 'details', factRefs: ['second'], claimRefs: [{ id: 'second-claim', kind: 'state' }], focusMode: 'frame' },
    ],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }, { persona: 'guide', dialogueAct: 'explain' }],
  });
  const task = createPresentationFlowTask({ id: 'safe-prompt', mode: 'author', artifactKind: 'live-tour', objective: 'Review', locale: 'und', budgets: { maxRepairRounds: 1, maxDeepeningActions: 0, maxContextQueries: 1 } });
  const adaptation = createProjectAdaptationCapsule({ id: 'safe-prompt', version: '1', locale: 'und', profileRefs: [], rubricRefs: [], capabilityProfiles: [], guidance: [] });
  const context = lessonContext();
  const basis = createPresentationFlowBasis({ task, adaptation, lessonContext: context, generation: 1, expiresAt: 9999999999 });
  const options = createPresentationFlowPlanOptions({ basis, lessonContext: context });
  const selection = createPresentationFlowPlanSelection({ basis, options, selection: { targetIds: ['orders', 'details'], factIds: [], actionOptionIds: [] } });
  const bound = bindPresentationFlowSemanticPlan({ basis, options, selection, skeleton });
  const prompt = createPresentationAuthoringPrompt(createPresentationAuthoringRequest({ basis: bound, task, adaptation, skeleton, options }));
  assert.equal('grounding' in prompt, false);
  assert.equal(prompt.slots.every((slot) => !Object.hasOwn(slot, 'targetId')), true);
  assert.deepEqual(Object.keys(prompt.slots[0]).sort(), ['persona', 'semanticAct', 'slotId']);
  assert.equal(JSON.stringify(prompt).includes('opaque-layout-id'), false);
  assert.equal(JSON.stringify(prompt.narrationAuthority[0]).includes('ALPHA-1'), true);
  assert.equal(JSON.stringify(prompt.narrationAuthority[0]).includes('BETA-2'), false);
  assert.equal(JSON.stringify(prompt.narrationAuthority[1]).includes('BETA-2'), true);
});

test('repairs only typed inspection findings when a changed candidate makes progress', async () => {
  const task = createPresentationFlowTask({ id: 'tour-repair', mode: 'author', artifactKind: 'live-tour', objective: 'Review', locale: 'en-US', budgets: { maxRepairRounds: 1, maxDeepeningActions: 0, maxContextQueries: 1 } });
  const adaptation = createProjectAdaptationCapsule({ id: 'maintenance', version: '1', locale: 'en-US', profileRefs: [], rubricRefs: [], capabilityProfiles: [], guidance: [] });
  const context = lessonContext();
  const basis = createPresentationFlowBasis({ task, adaptation, lessonContext: context, generation: 1, expiresAt: 9999999999 });
  const options = createPresentationFlowPlanOptions({ basis, lessonContext: context });
  const selection = createPresentationFlowPlanSelection({ basis, options, selection: { targetIds: ['details', 'orders'], factIds: [], actionOptionIds: [] } });
  const bound = bindPresentationFlowSemanticPlan({ basis, options, selection, skeleton: repeatRepairPlan() });
  const repairs = [];
  const result = await runPresentationFlowAuthoring({
    basis: bound,
    task,
    adaptation,
    skeleton: repeatRepairPlan(),
    draft: async ({ request, attempt }) => {
      if (attempt === 1) return { narrationProjection: { narrations: [
        { slotId: 'slot-1-orders', text: 'Review the current workspace.' },
        { slotId: 'slot-2-details', text: 'Review the current workspace.' },
      ] } };
      repairs.push(request.repair);
      return { narrationProjection: { narrations: [
        { slotId: 'slot-1-orders', text: 'First review the order overview.' },
        { slotId: 'slot-2-details', text: 'Then inspect the detailed state.' },
      ] } };
    },
  });
  assert.equal(result.attempts, 2);
  assert.deepEqual(repairs[0].findings, [
    { code: 'repeated-narration', slotId: 'slot-1-orders' },
    { code: 'repeated-narration', slotId: 'slot-2-details' },
  ]);
});

test('preserves a receipt-ready warning project after bounded narration-quality repair is exhausted', async () => {
  const task = createPresentationFlowTask({
    id: 'tour-quality-warning',
    mode: 'author',
    artifactKind: 'live-tour',
    objective: 'Review orders',
    locale: 'en-US',
    qualityDisposition: 'warn-and-play-live',
    budgets: { maxRepairRounds: 0, maxDeepeningActions: 0, maxContextQueries: 1 },
  });
  const adaptation = createProjectAdaptationCapsule({ id: 'maintenance', version: '1', locale: 'en-US', profileRefs: [], rubricRefs: [], capabilityProfiles: [], guidance: [] });
  const context = lessonContext();
  const basis = createPresentationFlowBasis({ task, adaptation, lessonContext: context, generation: 1, expiresAt: 9999999999 });
  const options = createPresentationFlowPlanOptions({ basis, lessonContext: context });
  const selection = createPresentationFlowPlanSelection({ basis, options, selection: { targetIds: ['details', 'orders'], factIds: [], actionOptionIds: [] } });
  const skeleton = repeatRepairPlan();
  const bound = bindPresentationFlowSemanticPlan({ basis, options, selection, skeleton });
  const result = await runPresentationFlowAuthoring({
    basis: bound,
    task,
    adaptation,
    skeleton,
    options,
    draft: async () => ({ narrationProjection: { narrations: [
      { slotId: 'slot-1-orders', text: 'Review the current workspace.' },
      { slotId: 'slot-2-details', text: 'Review the current workspace.' },
    ] } }),
  });
  assert.equal(result.status, 'quality-warning');
  assert.equal(result.project.projectKind, 'quality-warning');
  assert.equal(result.timeline.turns.length, 2);
  assert.deepEqual(result.timeline.turns.map((turn) => turn.claims), [[], []]);
  const live = createLivePresentationProjection(result.project);
  assert.equal(live.projectKind, 'quality-warning');
  assert.equal(live.timelineHash, result.project.timelineHash);
  assert.equal(validateMediaPresentationAncestry(result.project, createMediaPresentationAncestryAssertion(result.project)), true);
  assert.deepEqual(result.warnings, [
    { code: 'repeated-narration', slotId: 'slot-1-orders' },
    { code: 'repeated-narration', slotId: 'slot-2-details' },
  ]);
});

test('materializes an immutable warning project from an exact text-only candidate with unverified factual prose', async () => {
  const task = createPresentationFlowTask({
    id: 'tour-unverified-warning', mode: 'author', artifactKind: 'live-tour', objective: 'Review orders', locale: 'en-US',
    qualityDisposition: 'warn-and-play-live', budgets: { maxRepairRounds: 1, maxDeepeningActions: 0, maxContextQueries: 1 },
  });
  const adaptation = createProjectAdaptationCapsule({ id: 'maintenance', version: '1', locale: 'en-US', profileRefs: [], rubricRefs: [], capabilityProfiles: [], guidance: [] });
  const context = lessonContext();
  const basis = createPresentationFlowBasis({ task, adaptation, lessonContext: context, generation: 1, expiresAt: 9999999999 });
  const options = createPresentationFlowPlanOptions({ basis, lessonContext: context });
  const skeleton = semanticPlan();
  const selection = createPresentationFlowPlanSelection({ basis, options, selection: { targetIds: ['orders'], factIds: ['fact:status'], actionOptionIds: [] } });
  const bound = bindPresentationFlowSemanticPlan({ basis, options, selection, skeleton });
  const result = await runPresentationFlowAuthoring({
    basis: bound, task, adaptation, skeleton, options,
    draft: async () => ({ narrationProjection: { narrations: [{ slotId: skeleton.slots[0].slotId, text: 'Review the orders workspace.' }] } }),
  });
  assert.equal(result.status, 'quality-warning');
  assert.equal(result.project.projectKind, 'quality-warning');
  assert.deepEqual(result.warnings, [{ code: 'unverified-narration', slotId: skeleton.slots[0].slotId }]);
  assert.deepEqual(result.timeline.turns[0].claims, []);
  assert.equal(createLivePresentationProjection(result.project).qualityWarnings[0].code, 'unverified-narration');
});

test('reports exhausted prose inspection with only safe attempt and slot findings', async () => {
  const task = createPresentationFlowTask({ id: 'tour-exhausted', mode: 'author', artifactKind: 'live-tour', objective: 'Review', locale: 'en-US', budgets: { maxRepairRounds: 1, maxDeepeningActions: 0, maxContextQueries: 1 } });
  const adaptation = createProjectAdaptationCapsule({ id: 'maintenance', version: '1', locale: 'en-US', profileRefs: [], rubricRefs: [], capabilityProfiles: [], guidance: [] });
  const context = lessonContext();
  const basis = createPresentationFlowBasis({ task, adaptation, lessonContext: context, generation: 1, expiresAt: 9999999999 });
  const options = createPresentationFlowPlanOptions({ basis, lessonContext: context });
  const skeleton = repeatRepairPlan();
  const selection = createPresentationFlowPlanSelection({ basis, options, selection: { targetIds: ['details', 'orders'], factIds: [], actionOptionIds: [] } });
  const bound = bindPresentationFlowSemanticPlan({ basis, options, selection, skeleton });
  let calls = 0;

  await assert.rejects(() => runPresentationFlowAuthoring({
    basis: bound,
    task,
    adaptation,
    skeleton,
    draft: async () => {
      calls += 1;
      return { narrationProjection: { narrations: [
        { slotId: 'slot-1-orders', text: 'Review the current workspace.' },
        { slotId: 'slot-2-details', text: 'Review the current workspace.' },
      ] } };
    },
  }), (error) => {
    assert.equal(error.code, 'PRESENTATION_NARRATION_INSPECTION_REJECTED');
    assert.equal(error.attempts, 2);
    assert.deepEqual(error.findings, [
      { code: 'repeated-narration', slotId: 'slot-1-orders' },
      { code: 'repeated-narration', slotId: 'slot-2-details' },
    ]);
    assert.equal('message' in error.findings[0], false);
    return true;
  });
  assert.equal(calls, 2);
});

test('authoring can request only one offered context-deepening option and no tool input', () => {
  const task = createPresentationFlowTask({ id: 'tour-deepening-response', mode: 'author', artifactKind: 'live-tour', objective: 'Review orders', locale: 'en-US', budgets: { maxRepairRounds: 1, maxDeepeningActions: 1, maxContextQueries: 1 } });
  const adaptation = createProjectAdaptationCapsule({ id: 'maintenance', version: '1', locale: 'en-US', profileRefs: [], rubricRefs: [], capabilityProfiles: [], guidance: [] });
  const context = lessonContext();
  const basis = createPresentationFlowBasis({ task, adaptation, lessonContext: context, generation: 1, expiresAt: 9999999999 });
  const options = createPresentationFlowPlanOptions({
    basis,
    lessonContext: context,
    actionOptions: [{ id: 'inspect-orders-option', actionId: 'inspect-orders', targetId: 'orders', toolId: 'inspect-orders' }],
  });
  const selection = createPresentationFlowPlanSelection({ basis, options, selection: { targetIds: ['orders'], factIds: ['fact:status'], actionOptionIds: [], dialogueProfileId: '' } });
  const bound = bindPresentationFlowSemanticPlan({ basis, options, selection, skeleton: semanticPlan() });
  const request = createPresentationAuthoringRequest({ basis: bound, task, adaptation, skeleton: semanticPlan(), options });
  const deepening = createPresentationDeepeningRequest({ basis: bound, options });

  assert.equal(request.deepening.hash, deepening.hash);
  assert.match(compilePresentationAuthoringPrompt(request), /needsContext/);
  assert.deepEqual(parsePresentationAuthoringResponse({
    needsContext: { basisHash: deepening.basisHash, actionOptionId: 'inspect-orders-option' },
  }, request), {
    kind: 'needs-context',
    needsContext: { basisHash: deepening.basisHash, actionOptionId: 'inspect-orders-option' },
  });
  assert.throws(() => parsePresentationAuthoringResponse({
    needsContext: { basisHash: deepening.basisHash, actionOptionId: 'unknown', input: {} },
  }, request), /unrecognized field/);
  assert.throws(() => parsePresentationAuthoringResponse({
    needsContext: { basisHash: deepening.basisHash, actionOptionId: 'unknown' },
  }, request), /not offered/);
});
