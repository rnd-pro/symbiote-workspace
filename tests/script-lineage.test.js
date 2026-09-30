import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPOSITION_SCHEMA_VERSION,
  PRESENTATION_SEMANTIC_SCRIPT_MISMATCH,
  PresentationSemanticScriptMismatchError,
  SEMANTIC_SCRIPT_SCHEMA_VERSION,
  VOICE_PLAN_SCHEMA_VERSION,
  assertPresentationSemanticScriptEquality,
  createComposition,
  createSemanticScript,
  createVoicePlan,
} from '../index.js';

const semanticTurns = Object.freeze([
  Object.freeze({
    id: 'turn-overview',
    text: 'The status panel keeps the current work order and its evidence together.',
    semanticAct: 'explain',
    replyToTurnId: null,
    factRefs: ['fact-status'],
    claimRefs: ['claim-status'],
    targetRefs: ['target-status-panel'],
    actionRefs: ['action-open-status'],
  }),
]);

function semanticInput(overrides = {}) {
  return {
    locale: 'en-US',
    turns: semanticTurns.map((turn) => ({ ...turn })),
    styleRefs: ['presentation-style:balanced@1'],
    profileRefs: ['persona:guide@1', 'relationship:guided@1'],
    ...overrides,
  };
}

function voiceInput(semanticHash, overrides = {}) {
  return {
    semanticHash,
    sequenceMode: 'sequential',
    speakerRefs: ['speaker:guide'],
    personaRefs: ['persona:guide@1'],
    voiceRefs: ['voice:guide@1'],
    deliveryRefs: ['delivery:balanced@1'],
    ...overrides,
  };
}

function compositionInput(semanticHash, voiceHash, output) {
  return {
    semanticHash,
    voiceHash,
    cues: [{ id: 'cue-status', turnId: 'turn-overview', atMs: 250 }],
    targets: [{ id: 'target-status-panel', rect: { x: 40, y: 50, width: 600, height: 360 } }],
    appearance: { theme: 'dark', captions: true },
    output,
  };
}

test('semantic-script-v1 is deterministic and sorts semantic reference sets', () => {
  let forward = createSemanticScript(semanticInput());
  let reordered = createSemanticScript({
    profileRefs: ['persona:guide@1', 'relationship:guided@1'],
    styleRefs: ['presentation-style:balanced@1'],
    turns: [{
      actionRefs: ['action-open-status', 'action-open-status'],
      targetRefs: ['target-status-panel'],
      claimRefs: ['claim-status'],
      factRefs: ['fact-status', 'fact-status'],
      replyToTurnId: null,
      semanticAct: 'explain',
      text: semanticTurns[0].text,
      id: 'turn-overview',
    }],
    locale: 'en-US',
  });

  assert.equal(forward.schemaVersion, SEMANTIC_SCRIPT_SCHEMA_VERSION);
  assert.equal(forward.hash, reordered.hash);
  assert.deepEqual(reordered.turns[0].factRefs, ['fact-status']);
  assert.deepEqual(reordered.turns[0].actionRefs, ['action-open-status']);
});

test('semantic-script-v1 normalizes CRLF to LF without changing other text', () => {
  let script = createSemanticScript(semanticInput({
    turns: [{ ...semanticTurns[0], text: 'First line.\r\nSecond line.' }],
  }));
  assert.equal(script.turns[0].text, 'First line.\nSecond line.');
});

test('semantic-script-v1 normalizes decomposed Unicode text to NFC', () => {
  let decomposed = 'El panel esta\u0301 listo para la revisio\u0301n.';
  let script = createSemanticScript(semanticInput({
    locale: 'es-ES',
    turns: [{ ...semanticTurns[0], text: decomposed }],
  }));
  assert.equal(script.turns[0].text, 'El panel está listo para la revisión.');
  assert.equal(script.turns[0].text, script.turns[0].text.normalize('NFC'));
});

test('semantic-script-v1 rejects leading or trailing whitespace', () => {
  for (let value of [' Leading whitespace.', 'Trailing whitespace.\n', '\tTabbed text.']) {
    assert.throws(
      () => createSemanticScript(semanticInput({ turns: [{ ...semanticTurns[0], text: value }] })),
      /edge whitespace/,
    );
  }
});

test('semantic-script-v1 accepts only exact supported locales', () => {
  for (let locale of ['en', 'ru', 'es', 'en-us', 'fr-FR', '']) {
    assert.throws(() => createSemanticScript(semanticInput({ locale })), /en-US, ru-RU, es-ES/);
  }
});

test('semantic identity excludes delivery, timing, cues, geometry, and output', () => {
  let baseline = createSemanticScript(semanticInput({
    speaker: 'guide',
    persona: 'measured',
    voice: 'voice-a',
    delivery: { pace: 'steady' },
    timing: { startMs: 0 },
    cues: [{ kind: 'focus' }],
    geometry: { x: 10 },
    output: { width: 1920, height: 1080 },
    turns: [{
      ...semanticTurns[0],
      speaker: 'guide',
      persona: 'measured',
      voice: 'voice-a',
      delivery: { pace: 'steady' },
      timing: { startMs: 0 },
      cues: [{ kind: 'focus' }],
      geometry: { x: 10 },
      output: { width: 1920, height: 1080 },
    }],
  }));
  let changedDelivery = createSemanticScript(semanticInput({
    speaker: 'expert',
    persona: 'friendly',
    voice: 'voice-b',
    delivery: { pace: 'fast' },
    timing: { startMs: 900 },
    cues: [{ kind: 'annotation' }],
    geometry: { x: 800 },
    output: { width: 1080, height: 1920 },
    turns: [{
      ...semanticTurns[0],
      speaker: 'expert',
      persona: 'friendly',
      voice: 'voice-b',
      delivery: { pace: 'fast' },
      timing: { startMs: 900 },
      cues: [{ kind: 'annotation' }],
      geometry: { x: 800 },
      output: { width: 1080, height: 1920 },
    }],
  }));
  assert.equal(baseline.hash, changedDelivery.hash);
});

test('semantic identity preserves authoring style and profile reference order', () => {
  let baseline = createSemanticScript(semanticInput());
  let reorderedStyles = createSemanticScript(semanticInput({
    styleRefs: ['presentation-style:detail@1', 'presentation-style:balanced@1'],
  }));
  let reversedStyles = createSemanticScript(semanticInput({
    styleRefs: ['presentation-style:balanced@1', 'presentation-style:detail@1'],
  }));
  let reversedProfiles = createSemanticScript(semanticInput({
    profileRefs: ['relationship:guided@1', 'persona:guide@1'],
  }));

  assert.notEqual(reorderedStyles.hash, reversedStyles.hash);
  assert.notEqual(baseline.hash, reversedProfiles.hash);
});

test('semantic identity includes exact text and every semantic reference family', () => {
  let baseline = createSemanticScript(semanticInput());
  let variants = [
    { text: 'The status panel keeps the current work order and the evidence together.' },
    { semanticAct: 'observe' },
    { replyToTurnId: 'turn-introduction' },
    { factRefs: ['fact-owner'] },
    { claimRefs: ['claim-owner'] },
    { targetRefs: ['target-owner'] },
    { actionRefs: ['action-open-owner'] },
  ];
  for (let patch of variants) {
    let changed = createSemanticScript(semanticInput({
      turns: [{ ...semanticTurns[0], ...patch }],
    }));
    assert.notEqual(changed.hash, baseline.hash, JSON.stringify(patch));
  }
});

test('voice-plan-v1 binds delivery identities and sequenceMode to one semantic script', () => {
  let semantic = createSemanticScript(semanticInput());
  let sequential = createVoicePlan(voiceInput(semantic.hash));
  let overlap = createVoicePlan(voiceInput(semantic.hash, { sequenceMode: 'overlap' }));
  let changedVoice = createVoicePlan(voiceInput(semantic.hash, { voiceRefs: ['voice:alternate@1'] }));

  assert.equal(sequential.schemaVersion, VOICE_PLAN_SCHEMA_VERSION);
  assert.equal(sequential.semanticHash, semantic.hash);
  assert.notEqual(sequential.hash, overlap.hash);
  assert.notEqual(sequential.hash, changedVoice.hash);
});

test('composition-v1 varies by supported output while preserving semantic identity', () => {
  let semantic = createSemanticScript(semanticInput());
  let voice = createVoicePlan(voiceInput(semantic.hash));
  let outputs = [
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
    { width: 1080, height: 1080 },
  ];
  let compositions = outputs.map((output) => createComposition(compositionInput(semantic.hash, voice.hash, output)));

  assert.equal(new Set(compositions.map((value) => value.hash)).size, outputs.length);
  for (let [index, composition] of compositions.entries()) {
    assert.equal(composition.schemaVersion, COMPOSITION_SCHEMA_VERSION);
    assert.equal(composition.semanticHash, semantic.hash);
    assert.equal(composition.voiceHash, voice.hash);
    assert.deepEqual(composition.output, outputs[index]);
  }
});

test('semantic equality assertion returns the shared hash and throws a typed mismatch', () => {
  let expected = createSemanticScript(semanticInput());
  let actual = createSemanticScript(semanticInput({
    turns: [{ ...semanticTurns[0], text: 'The owner panel shows a different part of the workflow.' }],
  }));

  assert.equal(assertPresentationSemanticScriptEquality(expected.hash, expected), expected.hash);
  assert.throws(
    () => assertPresentationSemanticScriptEquality(expected, actual),
    (error) => {
      assert.ok(error instanceof PresentationSemanticScriptMismatchError);
      assert.equal(error.code, PRESENTATION_SEMANTIC_SCRIPT_MISMATCH);
      assert.equal(error.expectedHash, expected.hash);
      assert.equal(error.actualHash, actual.hash);
      return true;
    },
  );
  assert.throws(
    () => assertPresentationSemanticScriptEquality(expected, { semanticHash: expected.hash }),
    /actual semantic turns, not an echoed semanticHash/,
  );
});

test('semantic-script-v1 preserves representative natural EN, RU, and ES narration', () => {
  let fixtures = [
    ['en-US', 'Start with the work order header: it tells us which asset we are checking and why it matters.'],
    ['ru-RU', 'Начнём с заголовка наряда: здесь видно, какой актив мы проверяем и почему это важно.'],
    ['es-ES', 'Empecemos por el encabezado de la orden: aquí vemos qué activo revisamos y por qué importa.'],
  ];
  for (let [locale, text] of fixtures) {
    let script = createSemanticScript(semanticInput({
      locale,
      turns: [{ ...semanticTurns[0], text }],
    }));
    assert.equal(script.turns[0].text, text);
  }
});

test('lineage constructors reject missing, malformed, or non-portable contract data', () => {
  assert.throws(() => createSemanticScript({ locale: 'en-US', turns: [] }), /turns must contain/);
  assert.throws(() => createSemanticScript(semanticInput({ styleRefs: undefined })), /styleRefs must be an array/);
  assert.throws(() => createSemanticScript(semanticInput({
    turns: [{ ...semanticTurns[0], semanticAct: '' }],
  })), /semanticAct is required/);

  let semantic = createSemanticScript(semanticInput());
  assert.throws(() => createVoicePlan(voiceInput('not-a-semantic-hash')), /semanticHash/);
  assert.throws(() => createVoicePlan(voiceInput(semantic.hash, { deliveryRefs: undefined })), /deliveryRefs must be an array/);

  let voice = createVoicePlan(voiceInput(semantic.hash));
  assert.throws(
    () => createComposition(compositionInput(semantic.hash, voice.hash, { width: Infinity, height: 1080 })),
    /finite/,
  );
  assert.throws(
    () => createComposition({ ...compositionInput(semantic.hash, voice.hash, {}), cues: undefined }),
    /cues must be an array/,
  );
});

test('lineage API is exported from the browser entry point', async () => {
  let browser = await import('../browser.js');
  assert.equal(browser.createSemanticScript, createSemanticScript);
  assert.equal(browser.assertPresentationSemanticScriptEquality, assertPresentationSemanticScriptEquality);
  assert.equal(browser.PRESENTATION_SEMANTIC_SCRIPT_MISMATCH, PRESENTATION_SEMANTIC_SCRIPT_MISMATCH);
});
