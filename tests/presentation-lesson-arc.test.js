import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PRESENTATION_CONTRACT_VERSION } from '../runtime/presentation/contract.js';
import { reviewPresentationTimeline } from '../runtime/presentation.js';

const ARC = Object.freeze({
  subjectSourceIds: ['subject'],
  outcomeSourceIds: ['outcome'],
  requiredFactIds: ['fact-routing', 'fact-result'],
  requiredTargetIds: ['panel:chat:input', 'panel:workspace:result'],
  orderedTargetIds: ['panel:chat:input', 'panel:workspace:result'],
});

const SOURCE_SUMMARIES = Object.freeze({
  subject: 'Build a workspace from the submitted request.',
  outcome: 'The resulting workspace process is verified, complete, and ready to use.',
  'fact-routing': 'The request enters chat before the agent starts its work.',
  'fact-result': 'The completed run creates the workspace result.',
});

function ref(sourceId) {
  return { sourceId };
}

function makeTimeline(turnOverrides = [], options = {}) {
  let defaults = [
    {
      persona: 'guide',
      dialogueAct: 'open',
      text: 'We will build a workspace and verify the resulting process.',
      targetId: 'panel:chat:input',
      sourceRefs: [ref('subject'), ref('outcome')],
    },
    {
      persona: 'expert',
      dialogueAct: 'explain',
      text: 'The request is entered here before the agent starts its work.',
      targetId: 'panel:chat:input',
      sourceRefs: [ref('subject'), ref('fact-routing')],
    },
    {
      persona: 'guide',
      dialogueAct: 'respond',
      text: 'The completed run exposes the created workspace and its result.',
      targetId: 'panel:workspace:result',
      sourceRefs: [ref('fact-routing'), ref('fact-result')],
    },
    {
      persona: 'expert',
      dialogueAct: 'summarize',
      text: 'The request led to the verified workspace result.',
      targetId: 'panel:workspace:result',
      sourceRefs: [ref('outcome'), ref('fact-routing'), ref('fact-result')],
    },
    {
      persona: 'guide',
      dialogueAct: 'conclude',
      text: 'The demonstrated workspace is complete and ready to use.',
      targetId: 'panel:workspace:result',
      sourceRefs: [ref('outcome'), ref('fact-result')],
    },
  ];
  let turns = defaults.map((turn, index) => {
    let override = turnOverrides[index] || {};
    let targetId = override.targetId || turn.targetId;
    let turnSource = { ...turn };
    let overrideSource = { ...override };
    delete turnSource.targetId;
    delete overrideSource.targetId;
    return {
      ...turnSource,
      ...overrideSource,
      id: `turn-${index + 1}`,
      addressee: turn.persona === 'guide' ? 'expert' : 'guide',
      replyTo: index > 0 ? `turn-${index}` : undefined,
      cues: [{
        kind: 'focus',
        targetId,
        at: { anchor: 'turn-start' },
        until: { anchor: 'turn-end' },
        focus: { mode: 'cursor' },
      }],
      claims: Array.isArray(override.claims) ? override.claims : [],
    };
  });
  return {
    contractVersion: PRESENTATION_CONTRACT_VERSION,
    id: 'timeline-1',
    title: 'Build a workspace',
    locale: options.locale || 'en-US',
    profile: 'dialogue',
    personas: {
      guide: { name: 'Guide', role: 'lesson guide' },
      expert: { name: 'Expert', role: 'domain expert' },
    },
    grounding: {
      sources: ['subject', 'outcome', 'fact-routing', 'fact-result'].map((id) => ({
        id,
        contentHash: `sha256-${id}`,
        summary: options.summaries?.[id] || SOURCE_SUMMARIES[id],
      })),
    },
    turns,
  };
}

function review(timeline, overrides = {}) {
  return reviewPresentationTimeline(timeline, {
    strictLessonArc: true,
    lessonArc: ARC,
    ...overrides,
  });
}

describe('strict lesson-arc review policy', () => {
  it('remains opt-in', () => {
    let result = reviewPresentationTimeline(makeTimeline(), { strictLessonArc: false });
    assert.equal(result.issues.some((issue) => issue.code.startsWith('lesson-arc-')), false);
  });

  it('requires explicit source and target identities instead of keyword heuristics', () => {
    let result = reviewPresentationTimeline(makeTimeline(), {
      strictLessonArc: true,
      prompt: 'workspace result route complete',
    });
    assert.equal(result.verdict, 'reject');
    assert.ok(result.issues.some((issue) => issue.code === 'lesson-arc-contract-invalid'));
  });

  it('requires the opening to cite both subject and expected outcome', () => {
    let timeline = makeTimeline([{ dialogueAct: 'explain', text: 'Welcome to the workspace.', sourceRefs: [ref('subject')] }]);
    let result = review(timeline);
    assert.ok(result.issues.some((issue) => issue.code === 'lesson-arc-start-invalid'));
  });

  it('reports exact missing facts, targets, and ordered target violations', () => {
    let timeline = makeTimeline([
      null,
      { targetId: 'panel:workspace:result', sourceRefs: [] },
      { targetId: 'panel:chat:input', sourceRefs: [ref('fact-result')] },
    ]);
    let result = review(timeline);
    let issue = result.issues.find((item) => item.code === 'lesson-arc-body-invalid');
    assert.deepEqual(issue.missingFactIds, ['fact-routing']);
    assert.deepEqual(issue.missingTargetIds, []);
    assert.deepEqual(issue.outOfOrderTargetIds, ['panel:workspace:result']);
  });

  it('rejects empty and unknown declared target ordering instead of skipping it', () => {
    let empty = review(makeTimeline(), { lessonArc: { ...ARC, orderedTargetIds: [] } });
    let emptyIssue = empty.issues.find((issue) => issue.code === 'lesson-arc-contract-invalid');
    assert.ok(emptyIssue.emptyFields.includes('orderedTargetIds'));

    let unknown = review(makeTimeline(), {
      lessonArc: { ...ARC, orderedTargetIds: ['typo:first', 'typo:second'] },
    });
    let unknownIssue = unknown.issues.find((issue) => issue.code === 'lesson-arc-contract-invalid');
    assert.deepEqual(unknownIssue.unknownOrderedTargetIds, ['typo:first', 'typo:second']);
  });

  it('requires a grounded summary window and an outcome-grounded final turn', () => {
    let timeline = makeTimeline([
      null,
      null,
      null,
      { dialogueAct: 'explain', sourceRefs: [ref('fact-result')] },
      { dialogueAct: 'summarize', sourceRefs: [ref('fact-result')] },
    ]);
    let result = review(timeline);
    assert.ok(result.issues.some((issue) => issue.code === 'lesson-arc-closure-invalid'));
    assert.ok(result.issues.some((issue) => issue.code === 'lesson-arc-final-invalid'));
  });

  it('rejects structurally correct but semantically unrelated arc metadata', () => {
    let timeline = makeTimeline([
      { text: 'Ocean tides follow lunar gravity.' },
      { text: 'Garden roses need water during summer.' },
      { text: 'A violin melody changes after the chorus.' },
      { text: 'Cloud layers drift across the northern sky.' },
      { text: 'Fresh bread cools beside the kitchen window.' },
    ]);
    let result = review(timeline);
    let bodyIssue = result.issues.find((issue) => issue.code === 'lesson-arc-body-invalid');

    assert.equal(result.verdict, 'reject');
    assert.ok(result.issues.some((issue) => issue.code === 'lesson-arc-start-invalid'));
    assert.deepEqual(bodyIssue.incoherentFactIds, ARC.requiredFactIds);
    assert.ok(result.issues.some((issue) => issue.code === 'lesson-arc-closure-invalid'));
    assert.ok(result.issues.some((issue) => issue.code === 'lesson-arc-final-invalid'));
  });

  it('does not accept source or content hashes as semantic proof', () => {
    let timeline = makeTimeline();
    timeline.grounding.sources = timeline.grounding.sources.map((source) => ({
      id: source.id,
      contentHash: `truthy-${source.id}`,
    }));
    timeline.turns = timeline.turns.map((turn) => ({
      ...turn,
      sourceRefs: turn.sourceRefs.map((sourceRef) => ({
        ...sourceRef,
        hash: `truthy-${sourceRef.sourceId}`,
      })),
    }));
    let result = review(timeline);
    let contractIssue = result.issues.find((issue) => issue.code === 'lesson-arc-contract-invalid');

    assert.equal(result.verdict, 'reject');
    assert.deepEqual(contractIssue.unverifiableSourceIds, ['subject', 'outcome']);
    assert.deepEqual(contractIssue.unverifiableFactIds, ['fact-routing', 'fact-result']);
  });

  it('accepts coherent evidence-linked claims and rejects unrelated claim metadata', () => {
    let claim = (id, text, factId, evidenceId, targetId) => ({
      id,
      kind: 'state',
      text,
      factRefs: [factId],
      evidenceRefs: [evidenceId],
      targetRefs: [targetId],
    });
    let timeline = makeTimeline([
      null,
      { claims: [claim(
        'routing-claim',
        'The request enters chat before the agent starts work.',
        'routing-fact',
        'fact-routing',
        'panel:chat:input',
      )] },
      { claims: [claim(
        'result-claim',
        'The completed run creates the workspace result.',
        'result-fact',
        'fact-result',
        'panel:workspace:result',
      )] },
      { claims: [claim(
        'summary-result-claim',
        'The completed run produced the workspace result.',
        'result-fact',
        'fact-result',
        'panel:workspace:result',
      )] },
      { claims: [claim(
        'final-result-claim',
        'The completed workspace result is ready to use.',
        'result-fact',
        'fact-result',
        'panel:workspace:result',
      )] },
    ]);
    let claimIntent = {
      lessonArc: {
        ...ARC,
        requiredFactIds: ['routing-fact', 'result-fact'],
      },
      lessonContext: {
        lesson: { locale: 'en-US' },
        facts: [
          {
            id: 'routing-fact',
            label: 'Request routing',
            value: 'The request enters chat before the agent starts work.',
            evidenceRefs: ['fact-routing'],
          },
          {
            id: 'result-fact',
            label: 'Workspace result',
            value: 'The completed run creates the workspace result.',
            evidenceRefs: ['fact-result'],
          },
        ],
        evidence: [
          { id: 'fact-routing', summary: SOURCE_SUMMARIES['fact-routing'] },
          { id: 'fact-result', summary: SOURCE_SUMMARIES['fact-result'] },
        ],
      },
    };
    let result = review(timeline, claimIntent);

    assert.equal(result.issues.some((issue) => issue.code.startsWith('lesson-arc-')), false);
    assert.notEqual(result.verdict, 'reject', JSON.stringify(result.issues));

    let unrelated = structuredClone(timeline);
    unrelated.turns[1].text = 'Garden roses need water during summer.';
    unrelated.turns[1].claims[0].text = 'Garden roses need water during summer.';
    unrelated.turns[2].text = 'A violin melody changes after the chorus.';
    unrelated.turns[2].claims[0].text = 'A violin melody changes after the chorus.';
    let rejected = review(unrelated, claimIntent);
    let bodyIssue = rejected.issues.find((issue) => issue.code === 'lesson-arc-body-invalid');

    assert.deepEqual(bodyIssue.incoherentFactIds, ['routing-fact', 'result-fact']);
  });

  it('accepts bounded lexical coherence for Russian and Spanish paraphrases', () => {
    let fixtures = [
      {
        locale: 'ru-RU',
        summaries: {
          subject: 'Создание рабочего пространства по запросу.',
          outcome: 'Проверенный результат рабочего пространства готов к использованию.',
          'fact-routing': 'Запрос вводится в чат до начала работы агента.',
          'fact-result': 'Завершенный запуск создает рабочее пространство и результат.',
        },
        texts: [
          'Мы создадим рабочее пространство и проверим готовый результат.',
          'Сначала запрос вводится в чат, затем агент начинает работу.',
          'Завершенный запуск показывает созданное рабочее пространство и результат.',
          'Запрос привел к проверенному результату рабочего пространства.',
          'Рабочее пространство завершено, а результат готов к использованию.',
        ],
      },
      {
        locale: 'es-ES',
        summaries: {
          subject: 'Creación del espacio de trabajo solicitado.',
          outcome: 'Resultado verificado del espacio de trabajo listo para usar.',
          'fact-routing': 'La solicitud entra en el chat antes de iniciar el agente.',
          'fact-result': 'La ejecución terminada crea el espacio de trabajo y su resultado.',
        },
        texts: [
          'Crearemos un espacio de trabajo y verificaremos el resultado final.',
          'La solicitud entra en el chat antes de que el agente inicie su trabajo.',
          'La ejecución terminada muestra el espacio de trabajo creado y su resultado.',
          'La solicitud produjo el resultado verificado del espacio de trabajo.',
          'El espacio de trabajo está terminado y el resultado está listo para usar.',
        ],
      },
    ];

    for (let fixture of fixtures) {
      let timeline = makeTimeline(
        fixture.texts.map((text) => ({ text })),
        { locale: fixture.locale, summaries: fixture.summaries },
      );
      let result = review(timeline);
      assert.equal(
        result.issues.some((issue) => issue.code.startsWith('lesson-arc-')),
        false,
        `${fixture.locale}: ${JSON.stringify(result.issues)}`,
      );
    }
  });

  it('accepts a structurally complete two-voice lesson arc', () => {
    let result = review(makeTimeline());
    assert.equal(result.issues.some((issue) => issue.code.startsWith('lesson-arc-')), false);
    assert.notEqual(result.verdict, 'reject', JSON.stringify(result.issues));

    let closeTimeline = makeTimeline();
    closeTimeline.turns.at(-1).dialogueAct = 'close';
    let closeResult = review(closeTimeline);
    assert.equal(closeResult.issues.some((issue) => issue.code.startsWith('lesson-arc-')), false);
    assert.notEqual(closeResult.verdict, 'reject');
  });

  it('requires two dependent voices by default and permits an explicit single-narrator output', () => {
    let singleVoice = makeTimeline();
    singleVoice.turns = singleVoice.turns.map((turn) => ({ ...turn, persona: 'guide' }));

    let rejected = review(singleVoice);
    assert.equal(rejected.verdict, 'reject');
    assert.ok(rejected.issues.some((issue) => issue.code === 'dialogue-role-count'));
    assert.equal(rejected.coverage.strictLessonDialogue, true);

    let accepted = review(singleVoice, { speakerMode: 'single' });
    assert.equal(accepted.issues.some((issue) => issue.code === 'dialogue-role-count'), false);
    assert.equal(accepted.coverage.strictLessonDialogue, false);
    assert.notEqual(accepted.verdict, 'reject');
  });
});
