import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  auditPresentationLessonContext,
  auditPresentationTimelineClaims,
  createPresentationLessonContext,
  lessonTextTokens,
  lessonToolIsSafeForDeepening,
  normalizeLessonToolDescriptor,
  validateLessonToolInput,
} from '../runtime/lesson-context.js';

function target(id, title = id) {
  return { id, address: id, title, visible: true, rendered: true };
}

function evidence(id, value, targetRefs = []) {
  return { id, source: 'fixture', path: id, value, targetRefs };
}

function fact(id, value, targetRefs, kind = 'text') {
  return { id, kind, label: id, value, evidenceRefs: [`e-${id}`], targetRefs };
}

function relation(id, kind, from, to) {
  return { id, kind, from, to };
}

function tool(name = 'inspect_record') {
  return {
    name,
    description: `Inspect ${name}`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1 } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  };
}

function packetFor(type, overrides = {}) {
  let targets = overrides.targets || [target('orders', 'Orders'), target('details', 'Details'), target('history', 'History')];
  let facts = overrides.facts || [
    fact('status', 'Approved', ['orders']),
    fact('owner', 'Morgan', ['details']),
  ];
  let evidenceRecords = overrides.evidence || facts.map((item) => evidence(item.evidenceRefs[0], item.value, item.targetRefs));
  return createPresentationLessonContext({
    targets,
    facts,
    evidence: evidenceRecords,
    relations: overrides.relations || [relation('r1', 'affects', 'orders', 'details')],
    toolDescriptors: overrides.toolDescriptors || [tool()],
  }, {
    lesson: {
      type,
      title: `${type} lesson`,
      objective: `Explain ${type}`,
      locale: overrides.locale || 'en-US',
      requiredFactIds: overrides.requiredFactIds || facts.map((item) => item.id),
      requiredTargetIds: overrides.requiredTargetIds || targets.slice(0, 2).map((item) => item.id),
    },
    sourceSnapshot: { schemaVersion: 'presentation-context-snapshot-v2', identityHash: 'source', generation: 0, viewport: { width: 1920, height: 1080, fps: 30 }, targets },
    targetSnapshot: { schemaVersion: 'presentation-context-snapshot-v2', identityHash: 'target', generation: 0, viewport: { width: 1920, height: 1080, fps: 30 }, targets: targets.map((item) => ({ address: item.id })) },
  });
}

function claim(id, kind, text, factRefs, targetRefs) {
  return { id, kind, text, factRefs, evidenceRefs: factRefs.map((ref) => `e-${ref}`), targetRefs };
}

function timeline(turns) {
  return { turns: turns.map((item, index) => ({ id: `turn-${index + 1}`, persona: 'guide', dialogueAct: 'explain', ...item })) };
}

describe('lesson context contract', () => {
  it('canonicalizes descriptor object and string schemas to the same identity', () => {
    let object = normalizeLessonToolDescriptor(tool());
    let string = normalizeLessonToolDescriptor({ ...tool(), inputSchema: JSON.stringify(tool().inputSchema) });
    assert.deepEqual(string, object);
  });

  it('normalizes safety fail closed and validates the supported schema subset', () => {
    let safe = normalizeLessonToolDescriptor(tool());
    let unknown = normalizeLessonToolDescriptor({ ...tool(), annotations: {} });
    let contradictory = normalizeLessonToolDescriptor({ ...tool(), annotations: { readOnlyHint: true, destructiveHint: true } });
    assert.equal(lessonToolIsSafeForDeepening(safe), true);
    assert.equal(lessonToolIsSafeForDeepening(unknown), false);
    assert.equal(lessonToolIsSafeForDeepening(contradictory), false);
    assert.deepEqual(validateLessonToolInput(safe.inputSchema, { id: '1001' }), []);
    assert.equal(validateLessonToolInput(safe.inputSchema, {}).some((issue) => issue.code === 'tool-input-required'), true);
    assert.equal(validateLessonToolInput(safe.inputSchema, { id: '1', extra: true }).some((issue) => issue.code === 'tool-input-additional-property'), true);
    assert.equal(validateLessonToolInput({ type: 'object', oneOf: [] }, {}).some((issue) => issue.code === 'tool-schema-keyword-unsupported'), true);
  });

  it('pins deterministic English and Russian number token normalization', () => {
    assert.deepEqual(lessonTextTokens('Total 1,234.5', 'en-US'), ['total', '1234.5']);
    assert.deepEqual(lessonTextTokens('Итого 1 234,5', 'ru-RU'), ['итого', '1234.5']);
  });

  it('audits five materially different lesson types before planning and TTS', () => {
    let scenarios = [
      {
        type: 'operational-task',
        packet: packetFor('operational-task'),
        turns: [
          { text: 'Orders status Approved', claims: [claim('c1', 'state', 'Orders status Approved', ['status'], ['orders'])], actions: [{ name: 'inspect_record' }] },
          { text: 'Details outcome Morgan', claims: [claim('c2', 'outcome', 'Details outcome Morgan', ['owner'], ['details'])] },
        ],
      },
      {
        type: 'developer-source',
        packet: packetFor('developer-source', {
          facts: [fact('status', 'Approved', ['orders'], 'source'), fact('owner', 'Morgan', ['details'], 'source')],
          relations: [relation('r1', 'depends-on', 'orders', 'details')],
        }),
        turns: [
          { text: 'Orders source Approved', claims: [claim('c1', 'state', 'Orders source Approved', ['status'], ['orders'])] },
          { text: 'Details source Morgan', claims: [claim('c2', 'procedure', 'Details source Morgan', ['owner'], ['details'])] },
        ],
      },
      {
        type: 'data-analysis',
        packet: packetFor('data-analysis'),
        turns: [
          { text: 'Orders compare Approved Morgan', claims: [claim('c1', 'comparison', 'Orders compare Approved Morgan', ['status', 'owner'], ['orders'])] },
          { text: 'Details conclusion Approved', claims: [claim('c2', 'conclusion', 'Details conclusion Approved', ['status'], ['details'])] },
        ],
      },
      {
        type: 'workflow-process',
        packet: packetFor('workflow-process', { relations: [relation('r1', 'precedes', 'orders', 'details'), relation('r2', 'transitions-to', 'details', 'history')] }),
        turns: [
          { text: 'Orders begin Approved', claims: [claim('c1', 'procedure', 'Orders begin Approved', ['status'], ['orders'])], actions: [{ name: 'inspect_record' }] },
          { text: 'Details continue Morgan', claims: [claim('c2', 'procedure', 'Details continue Morgan', ['owner'], ['details'])], actions: [{ name: 'inspect_record' }] },
          { text: 'History outcome Approved', claims: [claim('c3', 'outcome', 'History outcome Approved', ['status'], ['history'])] },
        ],
      },
      {
        type: 'concise-overview',
        packet: packetFor('concise-overview'),
        turns: [
          { text: 'Orders status Approved', claims: [claim('c1', 'state', 'Orders status Approved', ['status'], ['orders'])] },
          { text: 'Details owner Morgan', claims: [claim('c2', 'state', 'Details owner Morgan', ['owner'], ['details'])] },
        ],
      },
    ];

    for (let scenario of scenarios) {
      let packetAudit = auditPresentationLessonContext(scenario.packet);
      assert.equal(packetAudit.verdict, 'accept', `${scenario.type}: ${packetAudit.issueCodes.join(', ')}`);
      let timelineAudit = auditPresentationTimelineClaims(timeline(scenario.turns), scenario.packet);
      assert.equal(timelineAudit.verdict, 'accept', `${scenario.type}: ${timelineAudit.issueCodes.join(', ')}`);
    }
    assert.equal(new Set(scenarios.map((scenario) => scenario.packet.hash)).size, scenarios.length);
  });

  it('rejects malformed references, insufficient depth, unsupported literals, generic and duplicate narration', () => {
    let malformed = packetFor('operational-task', { requiredFactIds: ['missing'] });
    let packetAudit = auditPresentationLessonContext(malformed);
    assert.equal(packetAudit.verdict, 'reject');
    assert.ok(packetAudit.issueCodes.includes('required-fact-missing'));

    let packet = packetFor('operational-task');
    let weak = timeline([
      { text: 'Generic explanation 42', claims: [claim('c1', 'state', 'Generic explanation 42', ['status'], ['orders'])] },
      { text: 'Generic explanation 42', claims: [claim('c2', 'outcome', 'Generic explanation 42', ['owner'], ['details'])] },
    ]);
    let timelineAudit = auditPresentationTimelineClaims(weak, packet);
    assert.equal(timelineAudit.verdict, 'reject');
    assert.ok(timelineAudit.issueCodes.includes('unsupported-claim'));
    assert.ok(timelineAudit.issueCodes.includes('generic-narration'));
    assert.ok(timelineAudit.issueCodes.includes('duplicate-narration'));
  });

  it('rejects an impossible concise overview budget before planning', () => {
    let targets = ['one', 'two', 'three', 'four', 'five'].map((id) => target(id));
    let packet = packetFor('concise-overview', { targets, requiredTargetIds: targets.map((item) => item.id) });
    let audit = auditPresentationLessonContext(packet);
    assert.equal(audit.verdict, 'reject');
    assert.ok(audit.issueCodes.includes('lesson-budget-inconsistent'));
  });

  it('grounds localized Russian dates against canonical ISO evidence', () => {
    let packet = packetFor('concise-overview', {
      locale: 'ru-RU',
      facts: [fact('date', '2026-07-12', ['orders'])],
      requiredFactIds: ['date'],
    });
    let valid = timeline([
      { text: 'Заказы подтверждены 12 июля 2026', claims: [claim('date-claim', 'state', 'Заказы подтверждены 12 июля 2026', ['date'], ['orders'])] },
      { text: 'Детали используют дату 2026-07-12', claims: [claim('date-confirm', 'conclusion', 'Детали используют дату 2026-07-12', ['date'], ['details'])] },
    ]);
    assert.equal(auditPresentationTimelineClaims(valid, packet).verdict, 'accept');
    let invalid = structuredClone(valid);
    invalid.turns[0].text = 'Заказы подтверждены 13 июля 2026';
    invalid.turns[0].claims[0].text = invalid.turns[0].text;
    assert.ok(auditPresentationTimelineClaims(invalid, packet).issueCodes.includes('unsupported-claim'));
  });
});
