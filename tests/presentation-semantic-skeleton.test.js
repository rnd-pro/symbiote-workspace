import test from 'node:test';
import assert from 'node:assert';
import {
  createSemanticSkeleton as createSemanticSkeletonRaw,
  createNarrationProjection as createNarrationProjectionRaw,
  createNarrationProjectionGrounding,
  normalizeSemanticSkeleton,
  hashRecord,
  WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION,
} from '../runtime/presentation/semantic-skeleton.js';
import {
  createPresentationProject,
  createLivePresentationProjection,
  createMediaPresentationAncestryAssertion,
  validateMediaPresentationAncestry,
  normalizePresentationProject,
  inspectPresentationProject,
  inspectPresentationNarrationQuality,
  inspectPresentationPreAudio,
} from '../runtime/presentation/presentation-project.js';

const createSemanticSkeleton = (input) => createSemanticSkeletonRaw({ ...input, orderedCausalRelations: (input.orderedCausalRelations || []).map((relation) => ({ ...relation, anchors: relation.anchors?.map((anchor) => anchor.binding ? anchor : { ...anchor, binding: { type: 'turn-start' } }) })) });
const createNarrationProjection = (input, skeleton) => createNarrationProjectionRaw({ ...input, narrations: input.narrations.map(({ slotId, text }) => ({ slotId, text })) }, skeleton);

test('validates explicit inputs and generates two-person ask/respond fixture', () => {
  const input = {
    locale: 'unknown-ZZ',
    title: 'Tour',
    profile: 'detailed',
    personas: { p1: { name: 'P1', role: 'learner' }, p2: { name: 'P2', role: 'operator' } },
    grounding: { sources: [{ id: 's1' }], facts: [{ id: 'f1', narration: { role: 'structural', coverage: 'optional' } }] },
    requiredTargets: [{ targetId: 'target-A', tabId: 'tab-1' }],
    orderedCausalRelations: [
      { targetId: 'target-A', factRefs: ['f1'], focusMode: 'none' },
      { targetId: 'target-A', sourceRefs: ['s1'], actionRef: 'select-a', resultRefs: ['res-1'], focusMode: 'none', anchors: [{ intent: 'action' }, { intent: 'emphasize' }] }
    ],
    registeredActions: [
      { actionId: 'select-a', targetId: 'target-A', tabId: 'tab-1', source: 'workspace', tool: 'select', interactionType: 'zoom', reversible: true, resultRef: 'res-1' }
    ],
    dialoguePlan: [
      { persona: 'p1', dialogueAct: 'ask', addressee: 'p2' },
      { persona: 'p2', dialogueAct: 'respond', replyToOffset: -1, addressee: 'p1' }
    ],
  };

  const skel = createSemanticSkeleton(input);
  assert.strictEqual(skel.locale, 'unknown-ZZ');
  assert.strictEqual(skel.slots.length, 2);
  assert.strictEqual(skel.slots[0].focusMode, 'none');
  assert.strictEqual(skel.slots[1].focusMode, 'none'); // Reuses prior retained target
  assert.strictEqual(skel.slots[1].action.interactionType, 'zoom');

  const proj = createNarrationProjection({
    narrations: [
      { slotId: skel.slots[0].slotId, text: 'hello' },
      { slotId: skel.slots[1].slotId, text: 'world now', anchors: [{ quote: 'world', occurrence: 1 }, { quote: 'now', occurrence: 1 }] }
    ]
  }, skel);

  const project = createPresentationProject({ skeleton: skel, projection: proj });
  assert.strictEqual(project.timeline.turns[0].cues.length, 0);
  assert.strictEqual(project.timeline.turns[0].addressee, 'p2');

  // Turn 1: action interaction + annotation, no redundant focus
  assert.strictEqual(project.timeline.turns[1].cues.length, 2);
  assert.strictEqual(project.timeline.turns[1].cues[0].kind, 'interaction');
  assert.strictEqual(project.timeline.turns[1].cues[0].interaction.reversible, true);
  assert.strictEqual(project.timeline.turns[1].cues[1].kind, 'annotation');
  assert.strictEqual(project.timeline.turns[1].cues[0].at.anchor, 'turn-start');
  assert.strictEqual(project.timeline.turns[1].replyTo, project.timeline.turns[0].id);

  // Verify reference closure mapped
  assert.strictEqual(project.timeline.turns[1].sourceRefs[0].targetId, 'target-A');
  assert.strictEqual(project.timeline.turns[1].sourceRefs[0].sourceId, 's1');
});

test('exact-key validation rejects extra/unrecognized topology fields', () => {
  const input = {
    locale: 'en-US', title: 'Tour', profile: 'brief',
    personas: { p1: { name: 'P1', role: 'operator' } },
    requiredTargets: [{ targetId: 'target-A' }],
    orderedCausalRelations: [{ targetId: 'target-A', focusMode: 'frame' }],
    dialoguePlan: [{ persona: 'p1', dialogueAct: 'explain' }]
  };
  const skel = createSemanticSkeleton(input);

  assert.throws(() => {
    createNarrationProjectionRaw({
      narrations: [{ slotId: skel.slots[0].slotId, text: 'hello', extraCue: true }]
    }, skel);
  }, /Unrecognized field "extraCue"/);
});

test('requires each fact-bearing claim to quote immutable slot grounding', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'unknown-ZZ', title: 'Grounded', profile: 'brief',
    personas: { guide: { role: 'operator' } },
    grounding: {
      facts: [{ id: 'fact:queue', value: { record: 'WO-1009', state: 'APPR' }, narration: { role: 'substantive', coverage: 'required' } }],
      claims: [{ id: 'claim:queue', kind: 'state', factRefs: ['fact:queue'] }],
    },
    requiredTargets: [{ targetId: 'queue', factRefs: ['fact:queue'], claimRefs: ['claim:queue'] }],
    orderedCausalRelations: [{ targetId: 'queue', factRefs: ['fact:queue'], claimRefs: [{ id: 'claim:queue', kind: 'state' }], focusMode: 'frame' }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  });
  const grounding = createNarrationProjectionGrounding(skeleton);
  assert.equal(grounding.slots[0].facts[0].tuples[0].atoms.some((atom) => atom.quote === 'WO-1009'), true);
  assert.throws(() => createNarrationProjection({ narrations: [{
    slotId: skeleton.slots[0].slotId, text: 'Объясню очередь.',
    claimTexts: [{ claimId: 'claim:queue', text: 'Объясню очередь.' }], anchors: [],
  }] }, skeleton), /exact bound tuple atom/);
  const inspection = inspectPresentationNarrationQuality(skeleton, { narrations: [{
    slotId: skeleton.slots[0].slotId, text: 'Объясню очередь.',
    claimTexts: [{ claimId: 'claim:queue', text: 'Объясню очередь.' }], anchors: [],
  }] });
  assert.equal(inspection.findings[0].code, 'invalid-narration-authority');
  const accepted = createNarrationProjection({ narrations: [{
    slotId: skeleton.slots[0].slotId, text: 'WO-1009 находится в состоянии APPR.',
    claimTexts: [{ claimId: 'claim:queue', text: 'WO-1009 находится в состоянии APPR.' }], anchors: [],
  }] }, skeleton);
  assert.equal(accepted.narrations[0].claimTexts[0].groundingProof.atoms[0].quote, 'WO-1009');
  const project = createPresentationProject({ skeleton, projection: accepted });
  assert.equal(project.inspection.structural.findings.length, 0);
  assert.equal(inspectPresentationPreAudio(skeleton, accepted).narration.findings.length, 0);
});

test('claim-local grounding rejects generic and sibling-fact narration across languages', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'und', title: 'Local claim proof', profile: 'brief',
    personas: { guide: { role: 'operator' } },
    grounding: {
      facts: [
        { id: 'fact:ru', value: 'Наряд 1009 готов', narration: { role: 'substantive', coverage: 'required' } },
        { id: 'fact:en', value: 'Record 1010 is closed', narration: { role: 'substantive', coverage: 'required' } },
      ],
      claims: [
        { id: 'claim:ru', kind: 'state', factRefs: ['fact:ru'] },
        { id: 'claim:en', kind: 'state', factRefs: ['fact:en'] },
      ],
    },
    requiredTargets: [{ targetId: 'work', factRefs: ['fact:ru', 'fact:en'], claimRefs: ['claim:ru', 'claim:en'] }],
    orderedCausalRelations: [{
      targetId: 'work', factRefs: ['fact:ru', 'fact:en'],
      claimRefs: [{ id: 'claim:ru', kind: 'state' }, { id: 'claim:en', kind: 'state' }], focusMode: 'frame',
    }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  });
  assert.throws(() => createNarrationProjection({ narrations: [{
    slotId: skeleton.slots[0].slotId, text: 'Сверим два состояния.', anchors: [],
    claimTexts: [{ claimId: 'claim:ru', text: 'Состояние известно.' }, { claimId: 'claim:en', text: 'Record 1010 is closed.' }],
  }] }, skeleton), /exact bound tuple atom/);
  assert.throws(() => createNarrationProjection({ narrations: [{
    slotId: skeleton.slots[0].slotId, text: 'Сверим два состояния.', anchors: [],
    claimTexts: [{ claimId: 'claim:ru', text: 'Record 1010 is closed.' }, { claimId: 'claim:en', text: 'Record 1010 is closed.' }],
  }] }, skeleton), /exact bound tuple atom/);
  const accepted = createNarrationProjection({ narrations: [{
    slotId: skeleton.slots[0].slotId, text: 'Наряд 1009 готов. Record 1010 is closed.', anchors: [],
    claimTexts: [{ claimId: 'claim:ru', text: 'Наряд 1009 готов.' }, { claimId: 'claim:en', text: 'Record 1010 is closed.' }],
  }] }, skeleton);
  assert.equal(accepted.narrations[0].claimTexts[0].groundingProof.atoms.length, 1);
  assert.equal(accepted.narrations[0].claimTexts[1].groundingProof.atoms.length, 1);
});

test('structural atoms cannot leak into local narration while substantive atoms remain natural', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'und', title: 'Structural boundary', profile: 'brief', personas: { guide: { role: 'operator' } },
    grounding: { facts: [
      { id: 'opaque', value: 'resource-opaque-41', narration: { role: 'structural', coverage: 'optional' } },
      { id: 'state', value: 'Ready', narration: { role: 'substantive', coverage: 'required' } },
    ], claims: [{ id: 'state', kind: 'state', factRefs: ['state'] }] },
    requiredTargets: [{ targetId: 'panel', factRefs: ['opaque', 'state'], claimRefs: ['state'] }],
    orderedCausalRelations: [{ targetId: 'panel', factRefs: ['opaque', 'state'], claimRefs: [{ id: 'state', kind: 'state' }], focusMode: 'frame' }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  });
  assert.throws(() => createNarrationProjection({ narrations: [{
    slotId: skeleton.slots[0].slotId, text: 'resource-opaque-41 is Ready.', anchors: [], claimTexts: [{ claimId: 'state', text: 'Ready.' }],
  }] }, skeleton), (error) => error.code === 'structural-atom-prose-forbidden' && !error.message.includes('resource-opaque-41'));
  const accepted = createNarrationProjection({ narrations: [{
    slotId: skeleton.slots[0].slotId, text: 'The item is Ready.', anchors: [], claimTexts: [{ claimId: 'state', text: 'Ready.' }],
  }] }, skeleton);
  assert.equal(accepted.narrations[0].claimTexts[0].groundingProof.atoms[0].quote, 'Ready');
});

test('substantive atoms bound to another slot cannot leak into narration prose', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'und', title: 'Substantive locality', profile: 'dialogue',
    personas: { guide: { role: 'learner' }, ops: { role: 'operator' } },
    grounding: { facts: [
      { id: 'queue', value: 'WO-1009', narration: { role: 'substantive', coverage: 'required' } },
      { id: 'asset', value: 'ASSET-7', narration: { role: 'substantive', coverage: 'required' } },
    ], claims: [
      { id: 'queue-claim', kind: 'state', factRefs: ['queue'] },
      { id: 'asset-claim', kind: 'asset', factRefs: ['asset'] },
    ] },
    requiredTargets: [
      { targetId: 'queue', factRefs: ['queue'], claimRefs: ['queue-claim'] },
      { targetId: 'asset', factRefs: ['asset'], claimRefs: ['asset-claim'] },
    ],
    orderedCausalRelations: [
      { targetId: 'queue', factRefs: ['queue'], claimRefs: [{ id: 'queue-claim', kind: 'state' }], focusMode: 'frame' },
      { targetId: 'asset', factRefs: ['asset'], claimRefs: [{ id: 'asset-claim', kind: 'asset' }], focusMode: 'none' },
    ],
    dialoguePlan: [
      { persona: 'guide', dialogueAct: 'explain' },
      { persona: 'ops', dialogueAct: 'explain' },
    ],
  });
  assert.throws(() => createNarrationProjection({ narrations: [
    { slotId: skeleton.slots[0].slotId, text: 'WO-1009 is ready.' },
    { slotId: skeleton.slots[1].slotId, text: 'ASSET-7 is ready; WO-1009 remains priority.' },
  ] }, skeleton), (error) => error.code === 'substantive-atom-prose-forbidden' && !error.message.includes('WO-1009'));
});

test('v7 resolves a claim-atom anchor only from its selected immutable tuple', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'und', title: 'Word anchor', profile: 'brief', personas: { guide: { role: 'operator' } },
    grounding: { facts: [{ id: 'fact', value: 'ANCHOR-7', narration: { role: 'substantive', coverage: 'required' } }], claims: [{ id: 'claim', kind: 'state', factRefs: ['fact'] }] },
    requiredTargets: [{ targetId: 'target', factRefs: ['fact'], claimRefs: ['claim'] }],
    orderedCausalRelations: [{ targetId: 'target', factRefs: ['fact'], claimRefs: [{ id: 'claim', kind: 'state' }], focusMode: 'frame', anchors: [{ intent: 'emphasize', binding: { type: 'claim-atom', claimId: 'claim', atomPath: '', occurrence: 1 } }] }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  });
  assert.equal(skeleton.slots[0].anchors[0].binding.quote, 'ANCHOR-7');
  assert.equal(createNarrationProjectionRaw({ narrations: [{ slotId: skeleton.slots[0].slotId, text: 'ANCHOR-7 is ready.' }] }, skeleton).narrations[0].anchors[0].quote, 'ANCHOR-7');
  assert.throws(() => createSemanticSkeletonRaw({
    locale: 'und', title: 'Bad word anchor', profile: 'brief', personas: { guide: { role: 'operator' } },
    grounding: { facts: [{ id: 'fact', value: 'ANCHOR-7', narration: { role: 'substantive', coverage: 'required' } }], claims: [{ id: 'claim', kind: 'state', factRefs: ['fact'] }] },
    requiredTargets: [{ targetId: 'target', factRefs: ['fact'], claimRefs: ['claim'] }],
    orderedCausalRelations: [{ targetId: 'target', factRefs: ['fact'], claimRefs: [{ id: 'claim', kind: 'state' }], focusMode: 'frame', anchors: [{ intent: 'emphasize', binding: { type: 'claim-atom', claimId: 'claim', atomPath: '/missing', occurrence: 1 } }] }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  }), /selected claim tuple atom/);
});

test('pre-audio quality rejects repeated substantive atoms including fixed response coverage', () => {
  const duplicateInput = {
    locale: 'und', title: 'Novelty', profile: 'brief', personas: { guide: { role: 'operator' } },
    grounding: { facts: [{ id: 'fact', value: 'ATOM-1', narration: { role: 'substantive', coverage: 'required' } }], claims: [{ id: 'claim', kind: 'state', factRefs: ['fact'] }] },
    requiredTargets: [{ targetId: 'one', factRefs: ['fact'], claimRefs: ['claim'] }, { targetId: 'two', factRefs: ['fact'], claimRefs: ['claim'] }],
    orderedCausalRelations: [{ targetId: 'one', factRefs: ['fact'], claimRefs: [{ id: 'claim', kind: 'state' }], focusMode: 'frame' }, { targetId: 'two', factRefs: ['fact'], claimRefs: [{ id: 'claim', kind: 'state' }], focusMode: 'frame' }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }, { persona: 'guide', dialogueAct: 'explain' }],
  };
  const duplicateSkeleton = createSemanticSkeleton(duplicateInput);
  const duplicateProjection = createNarrationProjection({ narrations: duplicateSkeleton.slots.map((slot) => ({ slotId: slot.slotId, text: 'ATOM-1.' })) }, duplicateSkeleton);
  assert.equal(inspectPresentationNarrationQuality(duplicateSkeleton, duplicateProjection).findings.some((finding) => finding.code === 'duplicate-substantive-atom'), true);
  assert.throws(() => createPresentationProject({ skeleton: duplicateSkeleton, projection: duplicateProjection }), /duplicate-substantive-atom/);
  const responseSkeleton = createSemanticSkeleton({ ...duplicateInput,
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'ask', responseCoverage: { responderOffset: 1, claimIds: ['claim'] } }, { persona: 'guide', dialogueAct: 'respond', replyToOffset: -1, addressee: 'guide' }],
  });
  const responseProjection = createNarrationProjection({ narrations: responseSkeleton.slots.map((slot) => ({ slotId: slot.slotId, text: 'ATOM-1.' })) }, responseSkeleton);
  assert.equal(inspectPresentationNarrationQuality(responseSkeleton, responseProjection).findings.some((finding) => finding.code === 'duplicate-substantive-atom'), true);
  const mixedSkeleton = createSemanticSkeleton({ ...duplicateInput,
    grounding: { facts: [...duplicateInput.grounding.facts, { id: 'other', value: 'ATOM-2', narration: { role: 'substantive', coverage: 'required' } }], claims: [...duplicateInput.grounding.claims, { id: 'other-claim', kind: 'state', factRefs: ['other'] }] },
    requiredTargets: duplicateInput.requiredTargets.map((target) => ({ ...target, factRefs: ['fact', 'other'], claimRefs: ['claim', 'other-claim'] })),
    orderedCausalRelations: duplicateInput.orderedCausalRelations.map((relation) => ({ ...relation, factRefs: ['fact', 'other'], claimRefs: [{ id: 'claim', kind: 'state' }, { id: 'other-claim', kind: 'state' }] })),
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'ask', responseCoverage: { responderOffset: 1, claimIds: ['claim'] } }, { persona: 'guide', dialogueAct: 'respond', replyToOffset: -1, addressee: 'guide' }],
  });
  const mixedProjection = createNarrationProjection({ narrations: mixedSkeleton.slots.map((slot) => ({ slotId: slot.slotId, text: 'ATOM-1 and ATOM-2.' })) }, mixedSkeleton);
  assert.equal(inspectPresentationNarrationQuality(mixedSkeleton, mixedProjection).findings.filter((finding) => finding.code === 'duplicate-substantive-atom').length, 2);
});

test('v2 classifies structural data separately and requires required substantive coverage', () => {
  assert.throws(() => createSemanticSkeleton({
    locale: 'und', title: 'Coverage', profile: 'brief', personas: { guide: { role: 'operator' } },
    grounding: { facts: [
      { id: 'title', value: 'Panel title', narration: { role: 'structural', coverage: 'required' } },
      { id: 'value', value: '42', narration: { role: 'substantive', coverage: 'required' } },
    ], claims: [{ id: 'title-claim', kind: 'label', factRefs: ['title'] }] },
    requiredTargets: [{ targetId: 'panel', factRefs: ['title', 'value'], claimRefs: ['title-claim'] }],
    orderedCausalRelations: [{ targetId: 'panel', factRefs: ['title', 'value'], claimRefs: [{ id: 'title-claim', kind: 'label' }], focusMode: 'frame' }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  }), /Required substantive grounding value lacks exact claim-local coverage/);
});

test('explicit dialogue policy enforces responsive two-person contribution but leaves monologue untouched', () => {
  const base = {
    locale: 'und', title: 'Dialogue', profile: 'dialogue', personas: { a: { role: 'x' }, b: { role: 'y' } },
    requiredTargets: [{ targetId: 'one' }, { targetId: 'two' }, { targetId: 'three' }, { targetId: 'four' }],
    orderedCausalRelations: ['one', 'two', 'three', 'four'].map((targetId, index) => ({ targetId, focusMode: index ? 'none' : 'frame' })),
  };
  assert.throws(() => createSemanticSkeleton({ ...base, dialoguePolicy: { mode: 'dialogue', participantIds: ['a', 'b'] }, dialoguePlan: [
    { persona: 'a', dialogueAct: 'ask', addressee: 'b' }, { persona: 'b', dialogueAct: 'respond', replyToOffset: -1, addressee: 'a' }, { persona: 'a', dialogueAct: 'explain' }, { persona: 'a', dialogueAct: 'explain' },
  ] }), /responsive cross-persona handoffs/);
  const natural = createSemanticSkeleton({ ...base, requiredTargets: base.requiredTargets.slice(0, 3), orderedCausalRelations: base.orderedCausalRelations.slice(0, 3), dialoguePolicy: { mode: 'dialogue', participantIds: ['a', 'b'] }, dialoguePlan: [
    { persona: 'a', dialogueAct: 'ask', addressee: 'b' }, { persona: 'b', dialogueAct: 'respond', replyToOffset: -1, addressee: 'a' }, { persona: 'a', dialogueAct: 'explain' },
  ] });
  assert.equal(natural.dialoguePolicy.participantIds.length, 2);
  const monologue = createSemanticSkeleton({ ...base, personas: { a: { role: 'x' } }, dialoguePlan: base.orderedCausalRelations.map(() => ({ persona: 'a', dialogueAct: 'explain' })) });
  assert.equal(monologue.slots.length, 4);
});

test('question response coverage binds a claim-free ask to an audible immutable responder answer', () => {
  const input = {
    locale: 'und', title: 'Question coverage', profile: 'dialogue', personas: { asset: { role: 'learner' }, ops: { role: 'operator' } },
    grounding: { facts: [
      { id: 'asset-fact', value: 'ASSET-7', narration: { role: 'substantive', coverage: 'required' } },
      { id: 'crew-fact', value: 'CREW-2', narration: { role: 'substantive', coverage: 'required' } },
    ], claims: [{ id: 'asset-claim', kind: 'asset', factRefs: ['asset-fact'] }, { id: 'crew-claim', kind: 'crew', factRefs: ['crew-fact'] }] },
    requiredTargets: [
      { targetId: 'asset' }, { targetId: 'crew', factRefs: ['asset-fact', 'crew-fact'], claimRefs: ['asset-claim', 'crew-claim'] }, { targetId: 'summary' }, { targetId: 'close' },
    ],
    orderedCausalRelations: [
      { targetId: 'asset', focusMode: 'frame' },
      { targetId: 'crew', factRefs: ['asset-fact', 'crew-fact'], claimRefs: [{ id: 'asset-claim', kind: 'asset' }, { id: 'crew-claim', kind: 'crew' }], focusMode: 'none' },
      { targetId: 'summary', focusMode: 'frame' }, { targetId: 'close', focusMode: 'frame' },
    ],
    dialoguePlan: [
      { persona: 'asset', dialogueAct: 'ask', addressee: 'ops', responseCoverage: { responderOffset: 1, claimIds: ['asset-claim', 'crew-claim'] } },
      { persona: 'ops', dialogueAct: 'respond', replyToOffset: -1, addressee: 'asset' },
      { persona: 'asset', dialogueAct: 'explain' }, { persona: 'ops', dialogueAct: 'explain' },
    ],
  };
  const skeleton = createSemanticSkeleton(input);
  assert.deepEqual(skeleton.slots[0].responseCoverage, { responderSlotId: skeleton.slots[1].slotId, targetId: 'crew', claimIds: ['asset-claim', 'crew-claim'] });
  assert.deepEqual(normalizeSemanticSkeleton(JSON.parse(JSON.stringify(skeleton))).slots[0].responseCoverage, skeleton.slots[0].responseCoverage);
  const requestGrounding = createNarrationProjectionGrounding(skeleton);
  assert.deepEqual(requestGrounding.slots[0].responseBinding, { responderSlotId: skeleton.slots[1].slotId, targetId: 'crew', claimIds: ['asset-claim', 'crew-claim'] });
  assert.equal('responseBinding' in requestGrounding.slots[1], false);
  const hiddenAsset = { narrations: [
    { slotId: skeleton.slots[0].slotId, text: 'Can you identify this assignment?', anchors: [], claimTexts: [] },
    { slotId: skeleton.slots[1].slotId, text: 'CREW-2 can take it.', anchors: [], claimTexts: [{ claimId: 'asset-claim', text: 'ASSET-7' }, { claimId: 'crew-claim', text: 'CREW-2' }] },
    { slotId: skeleton.slots[2].slotId, text: 'The summary is ready.', anchors: [], claimTexts: [] }, { slotId: skeleton.slots[3].slotId, text: 'We can close this view.', anchors: [], claimTexts: [] },
  ] };
  assert.throws(() => createNarrationProjection(hiddenAsset, skeleton), (error) => error.code === 'tuple-proof-missing');
  const accepted = createNarrationProjection({ narrations: [
    hiddenAsset.narrations[0],
    { slotId: skeleton.slots[1].slotId, text: 'ASSET-7 is assigned to CREW-2.', anchors: [], claimTexts: [{ claimId: 'asset-claim', text: 'ASSET-7' }, { claimId: 'crew-claim', text: 'CREW-2' }] },
    hiddenAsset.narrations[2], hiddenAsset.narrations[3],
  ] }, skeleton);
  assert.equal(accepted.narrations[1].claimTexts.every((claim) => accepted.narrations[1].text.includes(claim.text)), true);
  assert.equal(inspectPresentationNarrationQuality(skeleton, accepted).findings.some((finding) => finding.code === 'duplicate-substantive-atom'), false);
  const tampered = hashRecord(WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION, { ...skeleton, hash: undefined, slots: skeleton.slots.map((slot, index) => index === 0 ? { ...slot, responseCoverage: { ...slot.responseCoverage, targetId: 'asset' } } : slot) });
  assert.throws(() => normalizeSemanticSkeleton(tampered), /response coverage does not match/);
});

test('v5 tuple scopes bind record provenance before narration and reject model proof override', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'und', title: 'Tuple proof', profile: 'brief', personas: { guide: { role: 'operator' } },
    grounding: { facts: [{ id: 'queue', narration: { role: 'substantive', coverage: 'required' }, value: [
      { number: '1010', description: 'alpha', status: 'OPEN' }, { number: '1011', description: 'beta-secret', status: 'OPEN' },
    ] }], claims: [{ id: 'first', kind: 'state', factRefs: ['queue'], tupleScope: { mode: 'single', selectors: [{ sourceId: 'queue', tuplePath: '/value/0' }] } }, { id: 'second', kind: 'state', factRefs: ['queue'], tupleScope: { mode: 'single', selectors: [{ sourceId: 'queue', tuplePath: '/value/1' }] } }] },
    requiredTargets: [{ targetId: 'queue', factRefs: ['queue'], claimRefs: ['first', 'second'] }],
    orderedCausalRelations: [{ targetId: 'queue', factRefs: ['queue'], claimRefs: [{ id: 'first', kind: 'state' }, { id: 'second', kind: 'state' }], focusMode: 'frame' }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  });
  const accepted = createNarrationProjection({ narrations: [{ slotId: skeleton.slots[0].slotId, text: 'Запись 1010: alpha. Запись 1011: beta-secret.', anchors: [], claimTexts: [
    { claimId: 'first', text: 'Запись 1010: alpha.' },
    { claimId: 'second', text: 'Запись 1011: beta-secret.' },
  ] }] }, skeleton);
  assert.equal(accepted.narrations[0].claimTexts.length, 2);
  const serialized = JSON.parse(JSON.stringify(skeleton));
  assert.equal(normalizeSemanticSkeleton(serialized).hash, skeleton.hash);
  const changedSibling = hashRecord(WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION, { ...skeleton, hash: undefined, grounding: { ...skeleton.grounding, facts: skeleton.grounding.facts.map((fact) => fact.id === 'queue' ? { ...fact, narration: { ...fact.narration, coverage: 'optional' }, value: [fact.value[0], { ...fact.value[1], description: 'changed-sibling' }] } : fact) }, requiredTargets: skeleton.requiredTargets.map((target) => ({ ...target, claimRefs: ['first'] })), slots: skeleton.slots.map((slot) => ({ ...slot, claimRefs: slot.claimRefs.filter((claim) => claim.id === 'first') })) });
  assert.equal(createNarrationProjection({ narrations: [{ slotId: skeleton.slots[0].slotId, text: 'Запись 1010: alpha.', anchors: [], claimTexts: [{ claimId: 'first', text: 'Запись 1010: alpha.' }] }] }, changedSibling).narrations[0].claimTexts[0].groundingProof.atoms.some((atom) => atom.quote === '1010'), true);
  const changedTuple = hashRecord(WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION, { ...skeleton, hash: undefined, grounding: { ...skeleton.grounding, facts: skeleton.grounding.facts.map((fact) => fact.id === 'queue' ? { ...fact, value: [{ number: '9999', description: 'alpha', status: 'OPEN' }, ...fact.value.slice(1)] } : fact) } });
  assert.throws(() => createNarrationProjection({ narrations: [{ slotId: skeleton.slots[0].slotId, text: 'Запись 1010: alpha.', anchors: [], claimTexts: [{ claimId: 'first', text: 'Запись 1010: alpha.' }, { claimId: 'second', text: 'Запись 1011: beta-secret.' }] }] }, changedTuple), /tuple binding/);
  const cross = { sourceId: 'queue' };
  assert.throws(() => createNarrationProjectionRaw({ narrations: [{ slotId: skeleton.slots[0].slotId, text: 'Запись 1010: alpha.', anchors: [], claimTexts: [
    { claimId: 'first', text: 'Запись 1010: alpha.', groundingProof: cross }, { claimId: 'second', text: 'Запись 1011: beta-secret.' },
  ] }] }, skeleton), /Unrecognized field "anchors"/);
  assert.throws(() => createNarrationProjection({ narrations: [{ slotId: skeleton.slots[0].slotId, text: 'Запись 1010: alpha.', anchors: [], claimTexts: [
    { claimId: 'first', text: 'Запись 1010: alpha.', sourceId: 'queue' }, { claimId: 'second', text: 'Запись 1011: beta-secret.' },
  ] }] }, skeleton), /exact bound tuple atom/);
  assert.throws(() => createNarrationProjection({ narrations: [{ slotId: skeleton.slots[0].slotId, text: 'Запись 1010: alpha.', anchors: [], claimTexts: [
    { claimId: 'first', text: 'Запись 1010: alpha.', tupleId: 'override' }, { claimId: 'second', text: 'Запись 1011: beta-secret.' },
  ] }] }, skeleton), /exact bound tuple atom/);
});

test('v5 rejects ambiguous array claims before narration while allowing scalar implicit scope', () => {
  const base = {
    locale: 'und', title: 'Scope', profile: 'brief', personas: { guide: { role: 'operator' } },
    grounding: { facts: [{ id: 'records', narration: { role: 'substantive', coverage: 'optional' }, value: [{ id: 'one' }, { id: 'two' }] }], claims: [{ id: 'record', kind: 'state', factRefs: ['records'] }] },
    requiredTargets: [{ targetId: 'records', factRefs: ['records'], claimRefs: ['record'] }],
    orderedCausalRelations: [{ targetId: 'records', factRefs: ['records'], claimRefs: [{ id: 'record', kind: 'state' }], focusMode: 'frame' }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  };
  assert.throws(() => createSemanticSkeleton(base), (error) => error.code === 'tuple-scope-ambiguous');
  const scalar = createSemanticSkeleton({ ...base, grounding: { facts: [{ id: 'record', narration: { role: 'substantive', coverage: 'required' }, value: { id: 'one' } }], claims: [{ id: 'record', kind: 'state', factRefs: ['record'] }] }, requiredTargets: [{ targetId: 'record', factRefs: ['record'], claimRefs: ['record'] }], orderedCausalRelations: [{ targetId: 'record', factRefs: ['record'], claimRefs: [{ id: 'record', kind: 'state' }], focusMode: 'frame' }] });
  assert.equal(scalar.slots[0].claimRefs[0].tupleBindings.length, 1);
});

test('v5 derives proof from text and rejects sibling tuple prose while allowing selected and shared atoms', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'und', title: 'Sibling prose', profile: 'brief', personas: { guide: { role: 'operator' } },
    grounding: { facts: [{ id: 'records', narration: { role: 'substantive', coverage: 'optional' }, value: [
      { number: '1010', description: 'Transformer', status: 'APPR' }, { number: '1011', description: 'Pole', status: 'INPRG' },
    ] }], claims: [{ id: 'record', kind: 'state', factRefs: ['records'], tupleScope: { mode: 'single', selectors: [{ sourceId: 'records', tuplePath: '/value/0' }] } }] },
    requiredTargets: [{ targetId: 'records', factRefs: ['records'], claimRefs: ['record'] }],
    orderedCausalRelations: [{ targetId: 'records', factRefs: ['records'], claimRefs: [{ id: 'record', kind: 'state' }], focusMode: 'frame' }], dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  });
  assert.throws(() => createNarrationProjection({ narrations: [{ slotId: skeleton.slots[0].slotId, text: '1010: Transformer, APPR; Pole, INPRG.', anchors: [], claimTexts: [{ claimId: 'record', text: '1010: Transformer, APPR; Pole, INPRG.' }] }] }, skeleton), (error) => error.code === 'tuple-proof-sibling-atom' && !error.message.includes('Pole') && !error.message.includes('INPRG'));
  const accepted = createNarrationProjection({ narrations: [{ slotId: skeleton.slots[0].slotId, text: '1010: Transformer, APPR.', anchors: [], claimTexts: [{ claimId: 'record', text: '1010: Transformer, APPR.' }] }] }, skeleton);
  assert.equal(accepted.narrations[0].claimTexts[0].groundingProof.atoms.length, 3);
  const sharedStatus = hashRecord(WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION, { ...skeleton, hash: undefined, grounding: { ...skeleton.grounding, facts: skeleton.grounding.facts.map((fact) => fact.id === 'records' ? { ...fact, value: [fact.value[0], { ...fact.value[1], status: 'APPR' }] } : fact) } });
  assert.equal(createNarrationProjection({ narrations: [{ slotId: skeleton.slots[0].slotId, text: '1010: Transformer, APPR.', anchors: [], claimTexts: [{ claimId: 'record', text: '1010: Transformer, APPR.' }] }] }, sharedStatus).narrations[0].claimTexts[0].groundingProof.atoms.filter((atom) => atom.quote === 'APPR').length, 1);
});

test('budget and coverage closure validation', () => {
  const input = {
    locale: 'en-US', title: 'Tour', profile: 'brief',
    personas: { p1: { name: 'P1', role: 'operator' } },
    requiredTargets: [{ targetId: 'target-A' }, { targetId: 'target-B' }],
    orderedCausalRelations: [{ targetId: 'target-A', focusMode: 'frame' }],
    dialoguePlan: [{ persona: 'p1', dialogueAct: 'explain' }]
  };
  assert.throws(() => createSemanticSkeleton(input), /Missing coverage/);
});

test('captures RED for tampered serialized skeleton and missing action result', () => {
  const input = {
    locale: 'en-US', title: 'Tour', profile: 'brief',
    personas: { p1: { name: 'P1', role: 'operator' } },
    requiredTargets: [{ targetId: 'target-A' }],
    registeredActions: [
      { actionId: 'select-a', targetId: 'target-A', source: 'workspace', tool: 't', interactionType: 'select', resultRef: 'res-1' }
    ],
    orderedCausalRelations: [{ targetId: 'target-A', actionRef: 'select-a', focusMode: 'none', anchors: [{ intent: 'action' }] }], // Action without exactly one paired result edge!
    dialoguePlan: [{ persona: 'p1', dialogueAct: 'explain' }]
  };

  assert.throws(() => createSemanticSkeleton(input), /exact single result edge/);

  // Fix the result edge
  input.orderedCausalRelations[0].resultRefs = ['res-1'];
  const skel = createSemanticSkeleton(input);

  // Tamper the hash
  let tamperedSkel = { ...skel, hash: 'workspace-presentation-semantic-skeleton-v1:forged-hash' };

  assert.throws(() => {
    createNarrationProjection({ narrations: [{ slotId: skel.slots[0].slotId, text: 'hello', anchors: [{ quote: 'hello', occurrence: 1 }] }] }, tamperedSkel);
  }, /Integrity hash mismatch/);

  const proj = createNarrationProjection({ narrations: [{ slotId: skel.slots[0].slotId, text: 'hello', anchors: [{ quote: 'hello', occurrence: 1 }] }] }, skel);
  const project = createPresentationProject({ skeleton: skel, projection: proj });

  // Tamper project
  let tamperedProject = { ...project, timelineHash: 'bad' };
  assert.throws(() => createLivePresentationProjection(tamperedProject), /Integrity hash mismatch/);
  assert.throws(() => validateMediaPresentationAncestry(tamperedProject, { projectHash: tamperedProject.hash }), /Integrity hash mismatch/);
});

test('missing claim text rejected', () => {
  const input = {
    locale: 'en-US', title: 'Tour', profile: 'brief',
    personas: { p1: { name: 'P1', role: 'operator' } },
    grounding: { claims: [{ id: 'c1' }] },
    requiredTargets: [{ targetId: 'target-A' }],
    orderedCausalRelations: [{ targetId: 'target-A', focusMode: 'frame', claimRefs: [{ id: 'c1', kind: 'fact' }] }],
    dialoguePlan: [{ persona: 'p1', dialogueAct: 'explain' }]
  };
  const skel = createSemanticSkeleton(input);

  assert.doesNotThrow(() => createNarrationProjection({ narrations: [{ slotId: skel.slots[0].slotId, text: 'hello' }] }, skel));
});

test('projection cannot reorder, retarget, or introduce model-owned topology', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'ru', title: 'Тест', profile: 'dialogue',
    personas: { learner: { role: 'learner' }, guide: { role: 'operator' } },
    requiredTargets: [{ targetId: 'overview', tabId: 'home' }],
    orderedCausalRelations: [
      { targetId: 'overview', focusMode: 'none' },
      { targetId: 'overview', focusMode: 'none', actionRef: 'open-overview', resultRefs: ['opened'], anchors: [{ intent: 'action' }] },
    ],
    registeredActions: [{ actionId: 'open-overview', targetId: 'overview', tabId: 'home', source: 'workspace', tool: 'openPanel', interactionType: 'select', resultRef: 'opened' }],
    dialoguePlan: [
      { persona: 'learner', dialogueAct: 'ask', addressee: 'guide' },
      { persona: 'guide', dialogueAct: 'respond', replyToOffset: -1, addressee: 'learner' },
    ],
  });
  const rows = [
    { slotId: skeleton.slots[0].slotId, text: 'Что здесь видно?' },
    { slotId: skeleton.slots[1].slotId, text: 'Открою обзор.', anchors: [{ quote: 'Открою', occurrence: 1 }] },
  ];
  assert.throws(() => createNarrationProjection({ narrations: [...rows].reverse() }, skeleton), /slotId at index/);
  assert.throws(() => createNarrationProjectionRaw({ narrations: [{ ...rows[0], targetId: 'other' }, rows[1]] }, skeleton), /Unrecognized field/);
  const projection = createNarrationProjection({ narrations: rows }, skeleton);
  const project = createPresentationProject({ skeleton, projection });
  const live = createLivePresentationProjection(project);
  assert.equal(live.projectHash, project.hash);
  assert.equal('audio' in live, false);
  assert.equal(live.timeline.turns[1].cues.filter((cue) => cue.kind === 'focus').length, 0);
  assert.equal(normalizePresentationProject(JSON.parse(JSON.stringify(project))).hash, project.hash);
});

test('recomputed hashes do not bless invalid semantic topology or media ancestry', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'zz-Unknown', title: 'Neutral', profile: 'dialogue',
    personas: { asker: { role: 'learner' }, operator: { role: 'operator' } },
    grounding: { sources: [{ id: 'source-1' }] },
    requiredTargets: [{ targetId: 'panel', tabId: 'tab-a' }],
    registeredActions: [{ actionId: 'act-1', targetId: 'panel', tabId: 'tab-a', source: 'workspace', tool: 'changeScale', interactionType: 'zoom', resultRef: 'result-1' }],
    orderedCausalRelations: [
      { targetId: 'panel', sourceRefs: ['source-1'], focusMode: 'none' },
      { targetId: 'panel', actionRef: 'act-1', resultRefs: ['result-1'], focusMode: 'none', anchors: [{ intent: 'action' }] },
    ],
    dialoguePlan: [{ persona: 'asker', dialogueAct: 'ask', addressee: 'operator' }, { persona: 'operator', dialogueAct: 'respond', replyToOffset: -1, addressee: 'asker' }],
  });
  const projection = createNarrationProjection({ narrations: [
    { slotId: skeleton.slots[0].slotId, text: 'Где панель?' },
    { slotId: skeleton.slots[1].slotId, text: 'Переключаю панель.', anchors: [{ quote: 'Переключаю', occurrence: 1 }] },
  ] }, skeleton);
  const badTab = hashRecord(WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION, { ...skeleton, hash: undefined, slots: skeleton.slots.map((slot, index) => index ? { ...slot, action: { ...slot.action, tabId: 'other' } } : slot) });
  assert.throws(() => normalizeSemanticSkeleton(badTab), /different tab/);
  const badSource = hashRecord(WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION, { ...skeleton, hash: undefined, slots: skeleton.slots.map((slot, index) => index ? { ...slot, action: { ...slot.action, source: 'host' } } : slot) });
  assert.throws(() => normalizeSemanticSkeleton(badSource), /does not exactly match/);
  const badReply = hashRecord(WORKSPACE_PRESENTATION_SEMANTIC_SKELETON_VERSION, { ...skeleton, hash: undefined, slots: skeleton.slots.map((slot, index) => index ? { ...slot, addressee: 'operator' } : slot) });
  assert.throws(() => normalizeSemanticSkeleton(badReply), /addressee does not match/);
  assert.throws(() => createSemanticSkeleton({
    locale: 'zz-Unknown', title: 'Mismatch', profile: 'brief', personas: { operator: { role: 'operator' } },
    requiredTargets: [{ targetId: 'panel', tabId: 'tab-a' }],
    registeredActions: [{ actionId: 'wrong-tab', targetId: 'panel', tabId: 'tab-b', source: 'workspace', tool: 'changeScale', interactionType: 'zoom', resultRef: 'result-1' }],
    orderedCausalRelations: [{ targetId: 'panel', actionRef: 'wrong-tab', resultRefs: ['result-1'], focusMode: 'none', anchors: [{ intent: 'action' }] }],
    dialoguePlan: [{ persona: 'operator', dialogueAct: 'explain' }],
  }), /tab does not match/);
  const report = inspectPresentationProject(skeleton, projection);
  assert.equal(report.schemaVersion, 'presentation-pre-audio-inspection-v1');
  assert.equal(report.stage, 'pre-audio');
  assert.equal(Array.isArray(report.findings), true);
  const invalidReport = inspectPresentationProject(badTab, projection);
  assert.equal(invalidReport.findings[0].code, 'invalid-authority-input');
  const project = createPresentationProject({ skeleton, projection });
  const assertion = createMediaPresentationAncestryAssertion(project, 'final-export');
  assert.equal(validateMediaPresentationAncestry(project, assertion), true);
  assert.throws(() => validateMediaPresentationAncestry(project, { projectHash: project.hash }), /Unrecognized field|unsupported schema/);
  const mismatched = hashRecord('presentation-media-ancestry-assertion-v1', { ...assertion, hash: undefined, timelineHash: 'wrong' });
  assert.throws(() => validateMediaPresentationAncestry(project, mismatched), /different immutable timelineHash/);
});

test('language-neutral narration quality finds Unicode repetition without rejecting a claim-free learner question', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'ru-RU', title: 'Проверка', profile: 'dialogue',
    personas: { learner: { role: 'learner' }, guide: { role: 'operator' } },
    requiredTargets: [{ targetId: 'area-a' }, { targetId: 'area-b' }],
    orderedCausalRelations: [
      { targetId: 'area-a', focusMode: 'frame' },
      { targetId: 'area-b', focusMode: 'frame' },
    ],
    dialoguePlan: [
      { persona: 'learner', dialogueAct: 'ask', addressee: 'guide' },
      { persona: 'guide', dialogueAct: 'respond', replyToOffset: -1, addressee: 'learner' },
    ],
  });
  const duplicateProjection = createNarrationProjection({ narrations: [
    { slotId: skeleton.slots[0].slotId, text: 'Покажи состояние открытых нарядов сегодня.' },
    { slotId: skeleton.slots[1].slotId, text: 'Покажи состояние открытых нарядов сегодня.' },
  ] }, skeleton);
  const repetition = inspectPresentationNarrationQuality(skeleton, duplicateProjection);
  assert.equal(repetition.schemaVersion, 'presentation-narration-quality-inspection-v1');
  assert.equal(repetition.findings.some((item) => item.code === 'repeated-narration'), true);
  const validProjection = createNarrationProjection({ narrations: [
    { slotId: skeleton.slots[0].slotId, text: 'Где посмотреть открытые наряды?' },
    { slotId: skeleton.slots[1].slotId, text: 'Они собраны во второй области, можно быстро сверить статус.' },
  ] }, skeleton);
  const quality = inspectPresentationNarrationQuality(skeleton, validProjection);
  assert.deepEqual(quality.findings, []);
  const bundle = inspectPresentationPreAudio(skeleton, validProjection);
  assert.equal(bundle.structural.schemaVersion, 'presentation-pre-audio-inspection-v1');
  assert.equal(bundle.narration.schemaVersion, 'presentation-narration-quality-inspection-v1');
  const project = createPresentationProject({ skeleton, projection: validProjection });
  assert.equal(project.inspection.schemaVersion, 'presentation-pre-audio-inspection-bundle-v1');
});

test('candidate narration inspection reports duplicate resolved word anchors before project construction', () => {
  const skeleton = createSemanticSkeleton({
    locale: 'any', title: 'Anchors', profile: 'brief', personas: { guide: { role: 'operator' } },
    requiredTargets: [{ targetId: 'target' }],
    orderedCausalRelations: [{ targetId: 'target', focusMode: 'frame', anchors: [{ intent: 'emphasize' }, { intent: 'compare' }] }],
    dialoguePlan: [{ persona: 'guide', dialogueAct: 'explain' }],
  });
  const candidate = createNarrationProjection({ narrations: [{
    slotId: skeleton.slots[0].slotId, text: 'Единый ориентир здесь.',
    anchors: [{ quote: 'ориентир', occurrence: 1 }, { quote: 'ориентир', occurrence: 1 }],
  }] }, skeleton);
  const report = inspectPresentationNarrationQuality(skeleton, candidate);
  assert.equal(report.findings.some((item) => item.code === 'ambiguous-word-anchor'), false);
  assert.throws(() => createPresentationProject({ skeleton, projection: candidate }), /unsupported value "compare"/);
});
