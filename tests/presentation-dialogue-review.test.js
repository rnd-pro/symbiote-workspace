import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PRESENTATION_CONTRACT_VERSION } from '../runtime/presentation/contract.js';
import {
  PRESENTATION_DIALOGUE_ISSUE_CODES,
  PRESENTATION_DIALOGUE_QUALITY_PROFILE,
  PRESENTATION_DIALOGUE_QUALITY_PROFILE_VERSION,
  reviewPresentationDialogue,
} from '../runtime/presentation/dialogue-review.js';

function timeline({ locale = 'en-US', roles, turns }) {
  return {
    contractVersion: PRESENTATION_CONTRACT_VERSION,
    id: `dialogue-${locale}`,
    title: 'Portable dialogue',
    locale,
    profile: 'dialogue',
    personas: {
      guide: { name: 'Guide', role: roles?.guide || (locale.startsWith('ru') ? 'ведущий урока' : locale.startsWith('es') ? 'guía de la lección' : 'lesson guide'), delivery: { emotion: 'warm', pace: 'normal' } },
      expert: { name: 'Expert', role: roles?.expert || (locale.startsWith('ru') ? 'технический эксперт' : locale.startsWith('es') ? 'experto técnico' : 'technical expert'), delivery: { emotion: 'curious', pace: 'normal' } },
    },
    grounding: { sources: [{ id: 'lesson', contentHash: 'sha256-lesson' }] },
    turns: turns.map((turn, index) => ({
      id: turn.id || `turn-${index + 1}`,
      persona: turn.persona,
      addressee: turn.persona === 'guide' ? 'expert' : 'guide',
      dialogueAct: turn.dialogueAct || 'explain',
      text: turn.text,
      ...(turn.replyTo ? { replyTo: turn.replyTo } : {}),
      ...(turn.delivery ? { delivery: turn.delivery } : {}),
      sourceRefs: turn.sourceRefs ?? [{ sourceId: 'lesson', hash: 'sha256-lesson' }],
      claims: [],
      cues: [],
    })),
  };
}

function codes(review) {
  return new Set(review.issues.map((issue) => issue.code));
}

describe('portable presentation dialogue quality profile', () => {
  it('exports frozen versioned thresholds and stable issue codes', () => {
    assert.equal(PRESENTATION_DIALOGUE_QUALITY_PROFILE_VERSION, 'presentation-dialogue-quality-v2');
    assert.equal(PRESENTATION_DIALOGUE_QUALITY_PROFILE.version, PRESENTATION_DIALOGUE_QUALITY_PROFILE_VERSION);
    assert.equal(Object.isFrozen(PRESENTATION_DIALOGUE_QUALITY_PROFILE), true);
    assert.equal(Object.isFrozen(PRESENTATION_DIALOGUE_ISSUE_CODES), true);
    assert.equal(PRESENTATION_DIALOGUE_ISSUE_CODES.invalidAct, 'dialogue-act-invalid');
    assert.equal(PRESENTATION_DIALOGUE_ISSUE_CODES.undeclaredPersona, 'dialogue-persona-undeclared');
    assert.equal(PRESENTATION_DIALOGUE_QUALITY_PROFILE.repetitionNgramSize, 3);
    assert.equal(PRESENTATION_DIALOGUE_QUALITY_PROFILE.minPersonaContributionRatio, 0.2);
  });

  it('passes cohesive, paced English dialogue with useful closure', () => {
    let review = reviewPresentationDialogue(timeline({
      turns: [
        { id: 'open', persona: 'guide', dialogueAct: 'ask', text: 'How does the adapter route each request?' },
        { id: 'reply', persona: 'expert', dialogueAct: 'respond', replyTo: 'open', text: 'The adapter routes each request through dispatch.' },
        { id: 'follow', persona: 'guide', dialogueAct: 'clarify', replyTo: 'reply', text: 'Does dispatch preserve the selected target?' },
        { id: 'answer', persona: 'expert', dialogueAct: 'confirm', replyTo: 'follow', text: 'Dispatch preserves the selected target for rendering.' },
        { id: 'summary', persona: 'guide', dialogueAct: 'summarize', replyTo: 'answer', text: 'In summary, dispatch preserves each selected rendering target.' },
      ],
    }), { requireDialogue: true, strictDialogueQuality: true });

    assert.deepEqual(review.issues, []);
  });

  it('passes cohesive Russian dialogue with useful conclusion', () => {
    let review = reviewPresentationDialogue(timeline({
      locale: 'ru-RU',
      turns: [
        { id: 'open', persona: 'guide', dialogueAct: 'ask', text: 'Как диспетчер передает запрос адаптеру?' },
        { id: 'reply', persona: 'expert', dialogueAct: 'respond', replyTo: 'open', text: 'Диспетчер передает запрос адаптеру через единый маршрут.' },
        { id: 'close', persona: 'guide', dialogueAct: 'conclude', replyTo: 'reply', text: 'В итоге единый маршрут связывает диспетчер и адаптер.' },
      ],
    }), { requireDialogue: true, strictDialogueQuality: true });

    assert.deepEqual(review.issues, []);
  });

  it('passes cohesive Spanish dialogue without locale-specific grading rules', () => {
    let review = reviewPresentationDialogue(timeline({
      locale: 'es-AR',
      turns: [
        { id: 'open', persona: 'guide', dialogueAct: 'ask', text: '¿Cómo dirige el adaptador cada solicitud?' },
        { id: 'reply', persona: 'expert', dialogueAct: 'respond', replyTo: 'open', text: 'El adaptador dirige cada solicitud mediante el despachador.' },
        { id: 'close', persona: 'guide', dialogueAct: 'conclude', replyTo: 'reply', text: 'En conclusión, el despachador mantiene la ruta seleccionada.' },
      ],
    }), { requireDialogue: true, strictDialogueQuality: true });

    assert.deepEqual(review.issues, []);
    assert.equal(review.dependencyMetrics.alternations, 2);
    assert.equal(review.dependencyMetrics.dependentAlternations, 2);
  });

  it('rejects cross-turn repetition floods in English, Russian, and Spanish', () => {
    for (let [locale, phrase] of [
      ['en-US', 'The adapter repeats the same routing explanation now.'],
      ['ru-RU', 'Адаптер повторяет одно и то же объяснение маршрута.'],
      ['es-AR', 'El adaptador repite la misma explicación de la ruta.'],
    ]) {
      let review = reviewPresentationDialogue(timeline({
        locale,
        turns: [
          { persona: 'guide', text: phrase },
          { persona: 'expert', text: phrase },
          { persona: 'guide', text: phrase },
          { persona: 'expert', text: phrase },
        ],
      }), { requireDialogue: true, strictDialogueQuality: true });

      assert.equal(codes(review).has(PRESENTATION_DIALOGUE_ISSUE_CODES.repetitionFlood), true, locale);
      assert.equal(review.repetitionMetrics.repeatedNgrams.length > 0, true, locale);
      assert.equal(review.repetitionMetrics.maxNgramTurnOccurrences, 4, locale);
    }
  });

  it('rejects weak persona contribution and exposes deterministic contribution evidence', () => {
    let review = reviewPresentationDialogue(timeline({
      turns: [
        { persona: 'guide', text: 'The guide introduces routing.' },
        { persona: 'expert', text: 'The expert explains how dispatch validates each request, selects the portable handler, preserves source evidence, records the result, and returns a stable response for rendering.' },
      ],
    }), { requireDialogue: true, strictDialogueQuality: true });

    assert.equal(codes(review).has(PRESENTATION_DIALOGUE_ISSUE_CODES.roleContributionImbalanced), true);
    assert.equal(review.contributionMetrics.personas.guide.turnCount, 1);
    assert.equal(review.contributionMetrics.personas.guide.ratio < PRESENTATION_DIALOGUE_QUALITY_PROFILE.minPersonaContributionRatio, true);
    assert.equal(review.contributionMetrics.totalContentTokens, review.repetitionMetrics.totalContentTokens);
  });

  it('flags disconnected replies, indistinct roles, and alternating monologues', () => {
    let review = reviewPresentationDialogue(timeline({
      roles: { guide: 'speaker', expert: 'speaker' },
      turns: [
        { id: 'a', persona: 'guide', dialogueAct: 'open', text: 'The adapter routes requests through dispatch.' },
        { id: 'b', persona: 'expert', dialogueAct: 'respond', replyTo: 'a', text: 'Fresh oranges arrive before lunchtime today.', sourceRefs: [] },
        { id: 'c', persona: 'guide', dialogueAct: 'explain', text: 'Database indexes improve lookup performance.' },
        { id: 'd', persona: 'expert', dialogueAct: 'explain', text: 'Winter trains cross the northern valley.' },
      ],
    }), { requireDialogue: true, strictDialogueQuality: true });
    let found = codes(review);

    assert.equal(found.has(PRESENTATION_DIALOGUE_ISSUE_CODES.replyContentDisconnected), true);
    assert.equal(found.has(PRESENTATION_DIALOGUE_ISSUE_CODES.roleIndistinct), true);
    assert.equal(found.has(PRESENTATION_DIALOGUE_ISSUE_CODES.alternatingMonologues), true);
  });

  it('flags repeated interjections without treating duplicate narration as that issue', () => {
    let repeated = reviewPresentationDialogue(timeline({
      turns: [
        { persona: 'guide', text: 'Right, the queue shows active work.' },
        { persona: 'expert', text: 'Right, the asset card shows location.' },
        { persona: 'guide', text: 'Right, the crew row shows ownership.' },
        { persona: 'expert', text: 'The final panel shows status clearly.' },
      ],
    }), { requireDialogue: true, strictDialogueQuality: true });
    let duplicates = reviewPresentationDialogue(timeline({
      turns: [
        { persona: 'guide', text: 'The queue shows active work.' },
        { persona: 'expert', text: 'The queue shows active work.' },
      ],
    }), { requireDialogue: true, strictDialogueQuality: true });

    assert.equal(codes(repeated).has(PRESENTATION_DIALOGUE_ISSUE_CODES.repeatedDiscourseMarker), true);
    assert.equal(codes(duplicates).has(PRESENTATION_DIALOGUE_ISSUE_CODES.repeatedDiscourseMarker), false);
  });

  it('flags pacing, punctuation, pronunciation, and delivery discontinuity', () => {
    let review = reviewPresentationDialogue(timeline({
      turns: [
        { persona: 'guide', text: 'Too short' },
        { persona: 'expert', dialogueAct: 'ask', text: 'Can path/to/file route this request.' },
        { persona: 'guide', text: 'The request follows the visible adapter route.', delivery: { emotion: 'concerned', pace: 'brisk', tone: 'urgent' } },
      ],
    }), { requireDialogue: true, strictDialogueQuality: true });
    let found = codes(review);

    assert.equal(found.has(PRESENTATION_DIALOGUE_ISSUE_CODES.turnPacing), true);
    assert.equal(found.has(PRESENTATION_DIALOGUE_ISSUE_CODES.terminalPunctuation), true);
    assert.equal(found.has(PRESENTATION_DIALOGUE_ISSUE_CODES.questionPunctuation), true);
    assert.equal(found.has(PRESENTATION_DIALOGUE_ISSUE_CODES.pronounceabilityHazard), true);
    assert.equal(found.has(PRESENTATION_DIALOGUE_ISSUE_CODES.deliveryDiscontinuity), true);
  });

  it('flags weak English and Russian handoff, summary, and conclusion acts', () => {
    for (let sample of [
      timeline({ turns: [
        { persona: 'guide', text: 'The adapter routes the visible request.' },
        { persona: 'expert', dialogueAct: 'handoff', text: 'Next, over to you.' },
        { persona: 'guide', dialogueAct: 'summarize', text: 'Summary is now done.' },
        { persona: 'expert', dialogueAct: 'conclude', text: 'Conclusion is now done.' },
      ] }),
      timeline({ locale: 'ru-RU', turns: [
        { persona: 'guide', text: 'Адаптер передает видимый запрос.' },
        { persona: 'expert', dialogueAct: 'handoff', text: 'Дальше передаю слово.' },
        { persona: 'guide', dialogueAct: 'summarize', text: 'Итоги теперь готовы.' },
        { persona: 'expert', dialogueAct: 'conclude', text: 'Заключение теперь готово.' },
      ] }),
    ]) {
      let review = reviewPresentationDialogue(sample, { requireDialogue: true, strictDialogueQuality: true });
      assert.equal(review.issues.filter((issue) => issue.code === PRESENTATION_DIALOGUE_ISSUE_CODES.weakSemanticAct).length, 3);
    }
  });

  it('ignores caller attempts to tune portable grader thresholds', () => {
    let review = reviewPresentationDialogue(timeline({
      turns: [
        { persona: 'guide', text: 'First authored guide statement.' },
        { persona: 'guide', text: 'Second authored guide statement.' },
        { persona: 'guide', text: 'Third authored guide statement.' },
        { persona: 'expert', text: 'The expert finally answers clearly.' },
      ],
    }), {
      requireDialogue: true,
      strictDialogueQuality: true,
      maxSamePersonaRun: 99,
      maxOverlapWords: 99,
      dialogue: { closureWindow: 99, maxSamePersonaRun: 99, maxOverlapWords: 99 },
    });

    assert.equal(review.maxSamePersonaRun, PRESENTATION_DIALOGUE_QUALITY_PROFILE.maxSamePersonaRun);
    assert.equal(review.maxOverlapWords, PRESENTATION_DIALOGUE_QUALITY_PROFILE.maxOverlapWords);
    assert.equal(codes(review).has('dialogue-monologue-run'), true);
  });
});
