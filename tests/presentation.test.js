import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESENTATION_CONTRACT_VERSION,
  PRESENTATION_LESSON_REVIEW_CODES,
  createPresentationContextSnapshot,
  PRESENTATION_LESSON_AUDIT_SCHEMA_VERSION,
  createPresentationLessonAuditPacket,
  createPresentationReplanRequest,
  createPresentationTimelineContract,
  createPresentationTimelineHash,
  createPresentationTtsProjection,
  createWorkspacePresentationTimeline,
  finalizePresentationReplan,
  alignPresentationTimelineToAudio,
  normalizePresentationPrompt,
  normalizePresentationTimeline,
  presentationTimelineHasTurns,
  reviewPresentationTimeline,
  reviewPresentationTimelineAgainstSnapshot,
} from '../index.js';
import {
  clearRegisteredSections,
  registerSection,
  validateWorkspaceConfig,
} from '../validation/core.js';
import behaviorSection from '../schema/sections/behavior.js';

const VERSION = '1.0.0';

function validationReport(timelines) {
  clearRegisteredSections();
  registerSection(behaviorSection);
  return validateWorkspaceConfig({
    version: VERSION,
    name: 'Presentation Workspace',
    provenance: { revision: 4 },
    narration: { timelines },
  });
}

function context(extra = {}) {
  return {
    workspace: { name: 'Operations review' },
    activeViewId: 'home',
    panels: [
      {
        address: 'panel:home:queue-node',
        kind: 'panel',
        title: 'Work queue',
        module: 'demo.queue',
        panelId: 'queue',
        visible: true,
        safeActions: [{ id: 'queue.refresh', label: 'Refresh' }],
        webmcpTools: [{ name: 'demo.queue.query' }],
      },
      {
        address: 'panel:home:audit-node',
        kind: 'panel',
        title: 'Audit trail',
        module: 'demo.audit',
        panelId: 'audit',
        visible: false,
        hiddenReasons: ['stack-inactive'],
        revealActions: [{
          type: 'stack.select',
          target: 'stack:home:workbench-stack',
          input: { viewId: 'home', stackId: 'workbench-stack', childId: 'audit-node' },
        }],
      },
      {
        address: 'panel:detail:detail-node',
        kind: 'panel',
        title: 'Record detail',
        module: 'demo.detail',
        panelId: 'detail',
        visible: false,
        hiddenReasons: ['view-inactive'],
        revealActions: [{
          type: 'view.select',
          target: 'view:detail',
          input: { viewId: 'detail' },
        }],
      },
    ],
    targets: [
      { address: 'panel:home:queue-node', kind: 'panel', visible: true },
      { address: 'panel:home:audit-node', kind: 'panel', visible: false },
      { address: 'panel:detail:detail-node', kind: 'panel', visible: false },
      {
        address: 'element:queue-row-wo-1',
        kind: 'row',
        title: 'Selected work order row',
        visible: true,
        safeActions: [{ id: 'queue.select-row', input: { id: 'wo-1' } }],
        enrichment: { entity: 'work-order', presentationHint: 'Use selected row data.' },
      },
    ],
    dataContext: {
      route: { data: { workOrder: { id: 'wo-1', status: 'approved' } } },
      selectedRecords: [{ type: 'work-order', id: 'wo-1' }],
      retrievedContext: [{ source: 'sop', title: 'Approval checklist' }],
      mockData: { scenario: 'demo' },
      documentPresentation: { 'doc:notes:wo-1': { scope: 'viewport' } },
    },
    ...extra,
  };
}

describe('presentation timeline generation', () => {
  beforeEach(clearRegisteredSections);

  it('normalizes prompt depth from explicit profile or prompt text', () => {
    assert.equal(normalizePresentationPrompt('краткую презентацию').profile, 'brief');
    assert.equal(normalizePresentationPrompt({ prompt: 'полная подробная презентация' }).profile, 'full');
    assert.equal(normalizePresentationPrompt({ prompt: 'presentation based on data context' }).profile, 'data-grounded');
    assert.equal(normalizePresentationPrompt({ prompt: 'focused task workflow for crew dispatch' }).profile, 'task-specific');
    assert.equal(normalizePresentationPrompt({ prompt: 'two voice podcast walkthrough' }).profile, 'dialogue');
    assert.equal(normalizePresentationPrompt({ depth: 'detailed', prompt: 'summary' }).profile, 'full');
  });

  it('varies scope, narration density, target sequence, and data refs by prompt profile', () => {
    let current = context();
    let brief = createWorkspacePresentationTimeline(current, {
      prompt: 'сделай краткую презентацию интерфейса',
      revision: 4,
    });
    let full = createWorkspacePresentationTimeline(current, {
      prompt: 'сделай полную подробную презентацию интерфейса',
      revision: 4,
    });
    let data = createWorkspacePresentationTimeline(current, {
      prompt: 'сделай презентацию на основе данных и контекста',
      revision: 4,
    });

    assert.equal(brief.summary.profile, 'brief');
    assert.equal(full.summary.profile, 'full');
    assert.equal(data.summary.profile, 'data-grounded');
    assert.equal(brief.segments.length, 1);
    assert.ok(full.segments.length > brief.segments.length);
    assert.ok(full.summary.targetCoverage.includes('panel:home:audit-node'));
    assert.ok(full.summary.targetCoverage.includes('panel:detail:detail-node'));
    assert.equal(full.summary.narrationDensity, 'detailed');
    assert.equal(data.summary.narrationDensity, 'contextual');
    assert.ok(data.summary.dataRefCount > 0);
    assert.ok(data.segments.some((segment) => segment.target === 'element:queue-row-wo-1'));
    assert.ok(data.segments.every((segment) => segment.dataRefs.length > 0));
    assert.notDeepEqual(brief.summary.targetCoverage, full.summary.targetCoverage);
    assert.notDeepEqual(full.summary.targetCoverage, data.summary.targetCoverage);

    let report = validationReport([brief, full, data]);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  });

  it('selects request-relevant targets for task-specific lessons instead of enumerating visible panels', () => {
    let base = context();
    let current = context({
      panels: [
        ...base.panels,
        {
          address: 'panel:home:crew-node',
          kind: 'panel',
          title: 'Crew and feeder availability',
          module: 'demo.crew',
          panelId: 'crew',
          visible: true,
          safeActions: [{ id: 'crew.filter', input: { feeder: 'FEEDER-12' } }],
        },
      ],
      targets: [
        ...base.targets,
        {
          address: 'panel:home:crew-node',
          kind: 'panel',
          title: 'Crew and feeder availability',
          visible: true,
          enrichment: { entity: 'crew', feeder: 'FEEDER-12' },
        },
      ],
    });

    let timeline = createWorkspacePresentationTimeline(current, {
      prompt: 'focused task workflow for crew feeder dispatch',
      maxSegments: 2,
      revision: 4,
    });
    let contract = createPresentationTimelineContract(timeline);
    let review = reviewPresentationTimeline(contract, {
      allowedTargetIds: [
        'panel:home:queue-node',
        'panel:home:audit-node',
        'panel:detail:detail-node',
        'element:queue-row-wo-1',
        'panel:home:crew-node',
      ],
      requestedSurfaceIds: ['panel:home:crew-node'],
      requestPrompt: 'focused task workflow for crew feeder dispatch',
      requireRequestFit: true,
      maxWordsPerTurn: 24,
    });

    assert.equal(timeline.summary.profile, 'task-specific');
    assert.equal(timeline.summary.narrationDensity, 'focused');
    assert.equal(timeline.segments[0].target, 'panel:home:crew-node');
    assert.equal(contract.turns[0].cue.tabId, 'home');
    assert.ok(contract.turns[0].text.includes('crew'));
    assert.ok(contract.turns[0].text.includes('feeder'));
    assert.equal(review.verdict, 'pass');
    assert.deepEqual(review.coverage.missingRequestedSurfaceIds, []);
    assert.deepEqual(review.coverage.missingRequestKeywords, []);
  });

  it('generates dialogue-profile lessons with alternating personas and responsive handoffs', () => {
    let timeline = createWorkspacePresentationTimeline(context(), {
      prompt: 'two voice podcast walkthrough for work order data',
      maxSegments: 4,
      revision: 4,
    });
    let contract = createPresentationTimelineContract(timeline);
    let review = reviewPresentationTimeline(contract, {
      allowedTargetIds: [
        'panel:home:queue-node',
        'panel:home:audit-node',
        'panel:detail:detail-node',
        'element:queue-row-wo-1',
      ],
      requestPrompt: 'two voice podcast walkthrough for work order data',
      requireRequestFit: true,
      requireDialogue: true,
      requireDialogueHandoffs: true,
      strictDialogueQuality: true,
      maxSamePersonaRun: 1,
      turnBudget: { min: 4, max: 4 },
    });

    assert.equal(timeline.summary.profile, 'dialogue');
    assert.equal(timeline.summary.narrationDensity, 'conversational');
    assert.deepEqual(contract.turns.map((turn) => turn.persona), ['guide', 'analyst', 'guide', 'analyst']);
    assert.deepEqual(contract.turns.map((turn) => turn.cue.tabId), ['home', 'home', 'home', 'detail']);
    assert.equal(review.verdict, 'pass');
    assert.equal(review.coverage.handoffCount >= 1, true);
    assert.equal(review.coverage.longestPersonaRun, 1);
    assert.deepEqual(review.coverage.missingRequestKeywords, []);
  });

  it('does not generate timeline targets from invalid runtime addresses', () => {
    let timeline = createWorkspacePresentationTimeline(context({
      targets: [
        { address: 'panel:home:queue-node', kind: 'panel', visible: true },
        { address: 'element:queue-row-WO-1', kind: 'row', visible: true },
      ],
    }), {
      prompt: 'present from data',
      revision: 4,
    });

    assert.equal(timeline.summary.profile, 'data-grounded');
    assert.equal(timeline.summary.targetCoverage.includes('element:queue-row-WO-1'), false);
    let report = validationReport([timeline]);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
  });
});

describe('canonical presentation timeline contract', () => {
  it('normalizes authored turns into a versioned hashable contract', () => {
    let input = {
      id: 'maximo-tour',
      title: 'Adaptive Maximo Workbench',
      locale: 'en',
      profile: 'full',
      personas: {
        ops: { rate: 0.96, lang: 'en-US', name: 'Operations' },
        guide: { name: 'Guide', lang: 'en-US', rate: 1 },
      },
      summary: { ignored: true },
      turns: [
        {
          webmcp: { tool: 'select_window', input: { boardId: 'orders' } },
          actions: [{ source: 'webmcp', name: 'select_window', target: 'panel:orders:queue' }],
          persona: 'guide',
          text: 'Open the active work-order queue.',
          cue: { marker: 'box', tabId: 'orders', targetId: 'panel:orders:queue' },
          renderCue: { durationMs: 1800 },
        },
        {
          cue: { targetId: 'panel:orders:asset', marker: 'circle', tabId: 'orders' },
          text: 'Review the selected asset and crew panel.',
          persona: 'ops',
        },
      ],
    };

    let contract = createPresentationTimelineContract(input);

    assert.equal(contract.contractVersion, PRESENTATION_CONTRACT_VERSION);
    assert.equal(contract.id, 'maximo-tour');
    assert.equal(contract.title, 'Adaptive Maximo Workbench');
    assert.equal(contract.turns.length, 2);
    assert.deepEqual(contract.turns[0].cue, {
      marker: 'box',
      tabId: 'orders',
      targetId: 'panel:orders:queue',
    });
    assert.deepEqual(contract.turns[0].webmcp, { tool: 'select_window', input: { boardId: 'orders' } });
    assert.deepEqual(contract.turns[0].actions, [
      { source: 'webmcp', name: 'select_window', target: 'panel:orders:queue' },
    ]);
    assert.deepEqual(contract.turns[0].renderCue, { durationMs: 1800 });
    assert.match(contract.hash, /^presentation-timeline-v2:sha256-/);
    assert.equal(contract.hash, createPresentationTimelineHash(input));
    assert.equal(presentationTimelineHasTurns(contract), true);
  });

  it('hashes the canonical turn projection independent of object key order', () => {
    let a = {
      id: 'tour',
      title: 'Tour',
      locale: 'en',
      personas: { guide: { name: 'Guide', lang: 'en-US', rate: 1 } },
      turns: [{ persona: 'guide', text: 'Start here.', cue: { targetId: 'a', tabId: 'tab', marker: 'box' } }],
    };
    let b = {
      turns: [{ cue: { marker: 'box', tabId: 'tab', targetId: 'a' }, text: 'Start here.', persona: 'guide' }],
      personas: { guide: { rate: 1, lang: 'en-US', name: 'Guide' } },
      locale: 'en',
      title: 'Tour',
      id: 'tour',
    };

    assert.equal(createPresentationTimelineHash(a), createPresentationTimelineHash(b));
    assert.throws(
      () => createPresentationTimelineHash(a, { contractVersion: 'presentation-timeline-v1' }),
      /unsupported presentation contract version/,
    );
    assert.notEqual(
      createPresentationTimelineHash(a),
      createPresentationTimelineHash({
        ...a,
        turns: [{
          ...a.turns[0],
          actions: [{ source: 'webmcp', name: 'select_window', target: 'a' }],
        }],
      }),
    );
    assert.notEqual(
      createPresentationTimelineHash(a),
      createPresentationTimelineHash({
        ...a,
        grounding: { sources: [{ id: 'queue', kind: 'records', path: 'queue', contentHash: 'sha256-queue' }] },
        turns: [{ ...a.turns[0], sourceRefs: [{ sourceId: 'queue', hash: 'sha256-queue' }] }],
      }),
    );
    assert.notEqual(
      createPresentationTimelineHash(a),
      createPresentationTimelineHash({
        ...a,
        turns: [{ ...a.turns[0], renderCue: { startMs: 300, durationMs: 900 } }],
      }),
    );
  });

  it('derives turns from semantic segments when no authored turns are present', () => {
    let generated = createWorkspacePresentationTimeline(context(), {
      prompt: 'сделай полную подробную презентацию интерфейса',
      revision: 4,
    });
    let contract = createPresentationTimelineContract(generated);

    assert.equal(contract.turns.length, generated.segments.length);
    assert.equal(contract.turns[0].text, generated.segments[0].narration);
    assert.equal(contract.turns[0].cue.targetId, generated.segments[0].focusTarget);
    assert.equal(contract.summary.segmentCount, generated.segments.length);
    assert.equal(contract.hash, createPresentationTimelineHash(generated));
  });

  it('filters non-text turns and fails loud when no narrated turns remain', () => {
    let normalized = normalizePresentationTimeline({
      id: 'empty',
      turns: [
        { persona: 'guide', text: '   ', cue: { targetId: 'a' } },
        { persona: 'guide', cue: { targetId: 'b' } },
      ],
    });

    assert.equal(normalized.turns.length, 0);
    assert.equal(presentationTimelineHasTurns(normalized), false);
    assert.throws(
      () => createPresentationTimelineContract(normalized),
      /presentation timeline requires at least one narrated turn/,
    );
  });

  it('reviews a valid task-scoped dialogue timeline', () => {
    let timeline = createPresentationTimelineContract({
      id: 'orders-tour',
      title: 'Orders tour',
      turns: [
        {
          id: 'orders-open',
          persona: 'guide',
          dialogueAct: 'open',
          text: 'Open the storm queue and start with the priority work order.',
          cue: { targetId: 'panel:orders:queue', tabId: 'orders' },
          webmcp: { tool: 'select_window', input: { boardId: 'orders' } },
        },
        {
          id: 'orders-response',
          persona: 'ops',
          dialogueAct: 'respond',
          replyTo: 'orders-open',
          text: 'The asset panel confirms the feeder location and crew state.',
          cue: { targetId: 'panel:orders:asset', tabId: 'orders' },
        },
      ],
    });

    let review = reviewPresentationTimeline(timeline, {
      allowedTargetIds: ['panel:orders:queue', 'panel:orders:asset'],
      allowedToolNames: ['select_window'],
      requestedSurfaceIds: ['panel:orders:queue'],
      selectedTabIds: ['orders'],
      turnBudget: { min: 2, max: 4 },
      requireDialogue: true,
    });

    assert.equal(review.verdict, 'pass');
    assert.deepEqual(review.issues, []);
    assert.equal(review.coverage.turnCount, 2);
    assert.deepEqual(review.coverage.personas.sort(), ['guide', 'ops']);
  });

  it('audits generated brief and full lessons before TTS without losing requested coverage', () => {
    let current = context();
    let targetIds = [
      'panel:home:queue-node',
      'panel:home:audit-node',
      'panel:detail:detail-node',
      'element:queue-row-wo-1',
    ];
    let brief = createPresentationTimelineContract(createWorkspacePresentationTimeline(current, {
      prompt: 'сделай краткую презентацию интерфейса',
      revision: 4,
    }));
    let full = createPresentationTimelineContract(createWorkspacePresentationTimeline(current, {
      prompt: 'сделай полную подробную презентацию интерфейса',
      revision: 4,
    }));

    let briefReview = reviewPresentationTimeline(brief, {
      allowedTargetIds: targetIds,
      allowedToolNames: ['demo.queue.query'],
      requestedSurfaceIds: ['panel:home:queue-node'],
      maxWordsPerTurn: 24,
    });
    let fullReview = reviewPresentationTimeline(full, {
      allowedTargetIds: targetIds,
      allowedToolNames: ['demo.queue.query'],
      requestedSurfaceIds: targetIds,
      maxWordsPerTurn: 24,
      turnBudget: { min: 4, max: 4 },
    });

    assert.equal(briefReview.verdict, 'pass');
    assert.equal(fullReview.verdict, 'pass');
    assert.equal(brief.turns.length, 1);
    assert.equal(full.turns.length, 4);
    assert.deepEqual(fullReview.coverage.missingRequestedSurfaceIds, []);
    assert.equal(createPresentationTtsProjection(full).items.every((item) => !/^(guide|ops)\s*:/i.test(item.text)), true);
  });

  it('passes a source-grounded two-host dialogue with responsive handoffs', () => {
    let timeline = createPresentationTimelineContract({
      id: 'notebook-style-tour',
      title: 'API flow graph deep dive',
      grounding: {
        sources: [
          { id: 'api-flow', kind: 'interface', path: 'tools.apiGraph', contentHash: 'sha256-api', summary: 'Request path and adapter handoff.' },
          { id: 'source-code', kind: 'code', path: 'sample-adapter/uniapi.js', contentHash: 'sha256-source', summary: 'Adapter implementation.' },
          { id: 'work-orders', kind: 'records', path: 'orders.current', contentHash: 'sha256-orders', summary: 'Visible work order result.' },
        ],
      },
      turns: [
        {
          id: 'turn-api-open',
          persona: 'guide',
          dialogueAct: 'open',
          text: 'Start with the API graph so the viewer sees the request path.',
          cue: { targetId: 'panel:tools:api-graph', tabId: 'tools' },
          sourceRefs: [{ sourceId: 'api-flow', targetId: 'panel:tools:api-graph', hash: 'sha256-api' }],
        },
        {
          id: 'turn-api-answer',
          persona: 'ops',
          dialogueAct: 'respond',
          replyTo: 'turn-api-open',
          text: 'Right, that graph shows where the adapter hands control to Maximo.',
          cue: { targetId: 'panel:tools:api-graph', tabId: 'tools' },
          sourceRefs: [
            { sourceId: 'api-flow', targetId: 'panel:tools:api-graph', hash: 'sha256-api' },
            { sourceId: 'source-code', targetId: 'panel:tools:api-graph', hash: 'sha256-source' },
          ],
        },
        {
          id: 'turn-source-question',
          persona: 'guide',
          dialogueAct: 'ask',
          replyTo: 'turn-api-answer',
          text: 'How does the source viewer connect the script to that path?',
          cue: { targetId: 'panel:tools:source-viewer', tabId: 'tools' },
          sourceRefs: [{ sourceId: 'source-code', targetId: 'panel:tools:source-viewer', hash: 'sha256-source' }],
        },
        {
          id: 'turn-source-answer',
          persona: 'ops',
          dialogueAct: 'respond',
          replyTo: 'turn-source-question',
          text: 'Exactly, the highlighted code connects the implementation the board calls.',
          cue: { targetId: 'panel:tools:source-viewer', tabId: 'tools' },
          sourceRefs: [
            { sourceId: 'source-code', targetId: 'panel:tools:source-viewer', hash: 'sha256-source' },
            { sourceId: 'work-orders', targetId: 'panel:tools:source-viewer', hash: 'sha256-orders' },
          ],
        },
        {
          id: 'turn-orders-clarify',
          persona: 'guide',
          dialogueAct: 'clarify',
          replyTo: 'turn-source-answer',
          text: 'Does the work order board confirm the data flowing back?',
          cue: { targetId: 'panel:tools:orders', tabId: 'tools' },
          sourceRefs: [{ sourceId: 'work-orders', targetId: 'panel:tools:orders', hash: 'sha256-orders' }],
        },
        {
          id: 'turn-orders-confirm',
          persona: 'ops',
          dialogueAct: 'confirm',
          replyTo: 'turn-orders-clarify',
          text: 'That closes the loop: request, adapter, script, and visible result.',
          cue: { targetId: 'panel:tools:orders', tabId: 'tools' },
          sourceRefs: [{ sourceId: 'work-orders', targetId: 'panel:tools:orders', hash: 'sha256-orders' }],
        },
      ],
    });

    let review = reviewPresentationTimeline(timeline, {
      allowedTargetIds: [
        'panel:tools:api-graph',
        'panel:tools:source-viewer',
        'panel:tools:orders',
      ],
      requestedSurfaceIds: [
        'panel:tools:api-graph',
        'panel:tools:source-viewer',
        'panel:tools:orders',
      ],
      selectedTabIds: ['tools'],
      requestPrompt: 'show the API flow graph and explain how source code connects to work orders',
      requireRequestFit: true,
      requireDialogue: true,
      requireDialogueHandoffs: true,
      strictDialogueQuality: true,
      requireGrounding: true,
      minQuestions: 1,
      minClarifications: 1,
      maxSamePersonaRun: 1,
      turnBudget: { min: 6, max: 6 },
    });

    assert.equal(review.verdict, 'pass');
    assert.equal(review.coverage.handoffCount >= 2, true);
    assert.equal(review.coverage.longestPersonaRun, 1);
    assert.deepEqual(review.coverage.missingRequestedSurfaceIds, []);
    assert.deepEqual(review.coverage.missingSelectedTabIds, []);
  });

  it('audits flexible lesson scenarios before TTS across workspace surface types', () => {
    let base = context();
    let operationsContext = context({
      panels: [
        ...base.panels,
        {
          address: 'panel:home:crew-node',
          kind: 'panel',
          title: 'Crew feeder dispatch board',
          module: 'demo.crew',
          panelId: 'crew',
          visible: true,
          safeActions: [{ id: 'crew.filter', input: { feeder: 'FEEDER-12' } }],
        },
      ],
      targets: [
        ...base.targets,
        {
          address: 'panel:home:crew-node',
          kind: 'panel',
          title: 'Crew feeder dispatch board',
          visible: true,
          enrichment: { entity: 'crew', feeder: 'FEEDER-12', workflow: 'dispatch' },
        },
      ],
    });
    let toolsContext = context({
      workspace: { name: 'Developer tools' },
      activeViewId: 'tools',
      panels: [
        {
          address: 'panel:tools:api-graph-node',
          kind: 'panel',
          title: 'API flow graph',
          module: 'demo.apiGraph',
          panelId: 'api-graph',
          visible: true,
          webmcpTools: [{ name: 'demo.apiGraph.expand', input: { node: 'adapter' } }],
        },
        {
          address: 'panel:tools:source-viewer-node',
          kind: 'panel',
          title: 'UNIAPI adapter source code viewer',
          module: 'demo.source',
          panelId: 'source-viewer',
          visible: true,
          safeActions: [{ id: 'source.open', input: { file: 'sample-adapter/autoscripts/uniapi.js' } }],
        },
        {
          address: 'panel:tools:registry-node',
          kind: 'panel',
          title: 'Adapter registry metadata',
          module: 'demo.registry',
          panelId: 'registry',
          visible: true,
        },
        {
          address: 'panel:tools:script-sync-node',
          kind: 'panel',
          title: 'Automation script deploy sync',
          module: 'demo.sync',
          panelId: 'script-sync',
          visible: false,
          revealActions: [{
            type: 'view.select',
            target: 'view:tools',
            input: { viewId: 'tools', panelId: 'script-sync' },
          }],
        },
      ],
      targets: [
        { address: 'panel:tools:api-graph-node', kind: 'panel', visible: true },
        { address: 'panel:tools:source-viewer-node', kind: 'panel', visible: true },
        { address: 'panel:tools:registry-node', kind: 'panel', visible: true },
        { address: 'panel:tools:script-sync-node', kind: 'panel', visible: false },
      ],
      dataContext: {
        route: { data: { adapter: { id: 'uniapi', endpoint: '/maximo/oslc' } } },
        retrievedContext: [{ source: 'code-map', title: 'UNIAPI deploy path' }],
      },
    });
    let workflowContext = context({
      workspace: { name: 'Approval workflow' },
      activeViewId: 'workflow',
      panels: [
        {
          address: 'panel:workflow:process-graph-node',
          kind: 'panel',
          title: 'Approval workflow process graph',
          module: 'demo.workflow',
          panelId: 'process-graph',
          visible: true,
          webmcpTools: [{ name: 'demo.workflow.trace', input: { order: 'wo-1' } }],
        },
        {
          address: 'panel:workflow:approval-detail-node',
          kind: 'panel',
          title: 'Approval detail state',
          module: 'demo.approval',
          panelId: 'approval-detail',
          visible: true,
        },
        {
          address: 'panel:workflow:history-node',
          kind: 'panel',
          title: 'Workflow history events',
          module: 'demo.history',
          panelId: 'history',
          visible: false,
          revealActions: [{
            type: 'stack.select',
            target: 'stack:workflow:workflow-stack',
            input: { viewId: 'workflow', childId: 'history-node' },
          }],
        },
      ],
      targets: [
        { address: 'panel:workflow:process-graph-node', kind: 'panel', visible: true },
        { address: 'panel:workflow:approval-detail-node', kind: 'panel', visible: true },
        { address: 'panel:workflow:history-node', kind: 'panel', visible: false },
      ],
      dataContext: {
        route: { data: { approval: { status: 'pending', step: 'supervisor-review' } } },
        selectedRecords: [{ type: 'work-order', id: 'wo-1' }],
      },
    });
    let scenarios = [
      {
        name: 'operations-task',
        context: operationsContext,
        prompt: 'focused crew feeder dispatch board',
        profile: 'task-specific',
        maxSegments: 3,
        selectedTabIds: ['home'],
        requestedSurfaceIds: ['panel:home:crew-node'],
        allowedToolNames: ['demo.queue.query'],
      },
      {
        name: 'developer-dialogue',
        context: toolsContext,
        prompt: 'two voice podcast api graph adapter source code flow',
        profile: 'dialogue',
        maxSegments: 4,
        selectedTabIds: ['tools'],
        requestedSurfaceIds: ['panel:tools:api-graph-node', 'panel:tools:source-viewer-node'],
        allowedToolNames: ['demo.apiGraph.expand'],
        requireDialogue: true,
      },
      {
        name: 'workflow-full',
        context: workflowContext,
        prompt: 'full approval workflow process graph presentation',
        profile: 'full',
        maxSegments: 3,
        selectedTabIds: ['workflow'],
        requestedSurfaceIds: [
          'panel:workflow:process-graph-node',
          'panel:workflow:approval-detail-node',
          'panel:workflow:history-node',
        ],
        allowedToolNames: ['demo.workflow.trace'],
      },
    ];

    for (let scenario of scenarios) {
      let timeline = createWorkspacePresentationTimeline(scenario.context, {
        prompt: scenario.prompt,
        maxSegments: scenario.maxSegments,
        revision: 4,
      });
      let contract = createPresentationTimelineContract(timeline);
      let allowedTargetIds = [...new Set([
        ...scenario.context.panels.map((panel) => panel.address),
        ...scenario.context.targets.map((target) => target.address),
      ])];
      let intent = {
        allowedTargetIds,
        allowedToolNames: scenario.allowedToolNames,
        requestedSurfaceIds: scenario.requestedSurfaceIds,
        selectedTabIds: scenario.selectedTabIds,
        requestPrompt: scenario.prompt,
        requireRequestFit: true,
        maxWordsPerTurn: 30,
        turnBudget: { min: scenario.maxSegments, max: scenario.maxSegments },
        requireDialogue: scenario.requireDialogue,
        requireDialogueHandoffs: scenario.requireDialogue,
        strictDialogueQuality: scenario.requireDialogue,
        maxSamePersonaRun: 1,
      };
      let review = reviewPresentationTimeline(contract, intent);
      let audit = createPresentationLessonAuditPacket(contract, {
        intent,
        renderSettings: { width: 1920, height: 1080, fps: 30, speakerMode: scenario.requireDialogue ? 'dialogue' : 'single' },
        source: { surface: scenario.selectedTabIds[0], tabId: scenario.selectedTabIds[0], title: scenario.name },
        contextSummary: { scenario: scenario.name, targetCount: allowedTargetIds.length },
      });

      assert.equal(timeline.summary.profile, scenario.profile, scenario.name);
      assert.equal(contract.turns.length, scenario.maxSegments, scenario.name);
      assert.equal(review.verdict, 'pass', `${scenario.name}: ${JSON.stringify(review.issues)}`);
      assert.deepEqual(review.coverage.missingRequestedSurfaceIds, [], scenario.name);
      assert.deepEqual(review.coverage.missingSelectedTabIds, [], scenario.name);
      assert.equal(audit.review.verdict, 'pass', scenario.name);
      assert.equal(audit.ttsProjection.items.length, contract.turns.length, scenario.name);
      assert.equal(contract.turns.every((turn) => turn.cue?.targetId && turn.cue?.tabId), true, scenario.name);
      assert.equal(contract.turns.every((turn) => !/^(guide|ops)\s*:/i.test(turn.text)), true, scenario.name);
      if (scenario.requireDialogue) {
        assert.deepEqual(contract.turns.map((turn) => turn.persona), ['guide', 'analyst', 'guide', 'analyst']);
        assert.equal(review.coverage.handoffCount >= 1, true, scenario.name);
      }
    }
  });

  it('flags monologue runs inside two-voice dialogue mode', () => {
    let timeline = createPresentationTimelineContract({
      id: 'runaway-dialogue-tour',
      title: 'Runaway dialogue tour',
      turns: [
        { persona: 'guide', text: 'Open the queue.', cue: { targetId: 'panel:orders:queue', tabId: 'orders' } },
        { persona: 'guide', text: 'Now review the asset card.', cue: { targetId: 'panel:orders:asset', tabId: 'orders' } },
        { persona: 'guide', text: 'Then explain the crew row.', cue: { targetId: 'panel:orders:crew', tabId: 'orders' } },
        { persona: 'ops', text: 'Right, the crew row confirms the assignment.', cue: { targetId: 'panel:orders:crew', tabId: 'orders' } },
      ],
    });

    let review = reviewPresentationTimeline(timeline, {
      requireDialogue: true,
      strictDialogueQuality: true,
      maxSamePersonaRun: 2,
    });

    assert.equal(review.verdict, 'reject');
    assert.ok(review.issues.some((issue) => issue.code === 'dialogue-monologue-run'));
    assert.equal(review.coverage.longestPersonaRun, 3);
  });

  it('rejects unsafe targets, tools, and missing requested coverage', () => {
    let timeline = createPresentationTimelineContract({
      id: 'bad-tour',
      title: 'Bad tour',
      turns: [{
        persona: 'guide',
        text: 'Show the queue.',
        cue: { targetId: 'panel:other:queue', tabId: 'other' },
        webmcp: { tool: 'dangerous_tool', input: {} },
      }],
    });

    let review = reviewPresentationTimeline(timeline, {
      allowedTargetIds: ['panel:orders:queue'],
      allowedToolNames: ['select_window'],
      requestedSurfaceIds: ['panel:orders:queue'],
      selectedTabIds: ['orders'],
    });

    assert.equal(review.verdict, 'reject');
    assert.deepEqual(
      review.issues.map((issue) => issue.code).sort(),
      ['disallowed-target', 'disallowed-tool', 'missing-requested-surface', 'missing-requested-tab'].sort(),
    );
  });

  it('flags TTS and dialogue quality issues before audio generation', () => {
    let timeline = createPresentationTimelineContract({
      id: 'rough-tour',
      title: 'Rough tour',
      turns: [
        {
          persona: 'guide',
          text: 'This **undefined** queue explanation has far too many words for a clean short model-service speech segment today.',
          cue: { targetId: 'panel:orders:queue', tabId: 'orders' },
        },
        {
          persona: 'guide',
          text: 'The second line stays on the same voice.',
          cue: { targetId: 'panel:orders:asset', tabId: 'orders' },
        },
      ],
    });

    let review = reviewPresentationTimeline(timeline, {
      allowedTargetIds: ['panel:orders:queue', 'panel:orders:asset'],
      maxWordsPerTurn: 8,
      turnBudget: { min: 3, max: 4 },
      requireDialogue: true,
    });

    assert.equal(review.verdict, 'reject');
    assert.ok(review.issues.some((issue) => issue.code === 'unsafe-tts-text'));
    assert.equal(review.issues.find((issue) => issue.code === 'tts-long-turn')?.severity, 'error');
    assert.ok(review.issues.some((issue) => issue.code === 'dialogue-role-count'));
    assert.ok(review.issues.some((issue) => issue.code === 'turn-budget-underflow'));
  });

  it('rejects spoken labels and weak multi-turn dialogue before TTS', () => {
    let timeline = createPresentationTimelineContract({
      id: 'weak-dialogue-tour',
      title: 'Weak dialogue tour',
      turns: [
        { persona: 'guide', text: 'GUIDE: Open the queue.', cue: { targetId: 'panel:orders:queue', tabId: 'orders' } },
        { persona: 'ops', text: 'The queue has current work.', cue: { targetId: 'panel:orders:queue', tabId: 'orders' } },
        { persona: 'guide', text: 'The queue has current work.', cue: { targetId: 'panel:orders:queue', tabId: 'orders' } },
        { persona: 'ops', text: 'The queue has current work.', cue: { targetId: 'panel:orders:queue', tabId: 'orders' } },
      ],
    });

    let review = reviewPresentationTimeline(timeline, {
      requireDialogue: true,
      requireDialogueHandoffs: true,
      strictDialogueQuality: true,
    });

    assert.equal(review.verdict, 'reject');
    assert.ok(review.issues.some((issue) => issue.code === 'spoken-speaker-label'));
    assert.ok(review.issues.some((issue) => issue.code === 'repeated-boilerplate'));
    assert.ok(review.issues.some((issue) => issue.code === 'missing-dialogue-handoff'));
  });

  it('rejects same-persona overlap and keeps overlap turns short', () => {
    let timeline = createPresentationTimelineContract({
      id: 'bad-overlap-tour',
      title: 'Bad overlap tour',
      turns: [
        {
          persona: 'guide',
          text: 'First guide line.',
          renderCue: { startMs: 0, durationMs: 1500 },
        },
        {
          persona: 'guide',
          text: 'This overlapping line is much too long for a natural interruption.',
          renderCue: { startMs: 500, durationMs: 1000 },
        },
      ],
    });

    let review = reviewPresentationTimeline(timeline, {
      strictDialogueQuality: true,
      maxOverlapWords: 4,
    });

    assert.equal(review.verdict, 'reject');
    assert.ok(review.issues.some((issue) => issue.code === 'self-overlap'));
    assert.ok(review.issues.some((issue) => issue.code === 'overlong-overlap-turn'));
  });

  it('creates a deterministic portable lesson audit packet without provider data', () => {
    let timeline = createPresentationTimelineContract({
      id: 'audit-tour',
      title: 'Audit tour',
      turns: [
        { id: 'audit-open', persona: 'guide', dialogueAct: 'open', text: 'Open the queue.', cue: { targetId: 'panel:orders:queue', tabId: 'orders' } },
        { id: 'audit-answer', persona: 'ops', dialogueAct: 'respond', replyTo: 'audit-open', text: 'Right, the asset panel confirms the crew.', cue: { targetId: 'panel:orders:asset', tabId: 'orders' } },
      ],
    });
    let options = {
      intent: { requireDialogue: true },
      renderSettings: { width: 1920, height: 1080, fps: 30, speakerMode: 'dialogue' },
      source: { url: '/?surface=orders', surface: 'orders', tabId: 'orders' },
      contextSummary: { visibleTargetCount: 2 },
    };

    let audit = createPresentationLessonAuditPacket(timeline, options);
    let auditAgain = createPresentationLessonAuditPacket(timeline, options);
    let projection = createPresentationTtsProjection(timeline);

    assert.equal(audit.schemaVersion, PRESENTATION_LESSON_AUDIT_SCHEMA_VERSION);
    assert.equal(audit.hash, auditAgain.hash);
    assert.equal(audit.review.verdict, 'pass');
    assert.equal(audit.ttsProjection.model, 'deterministic-text-only');
    assert.equal(audit.ttsProjection.items.length, 2);
    assert.equal(projection.items[0].text, 'Open the queue.');
    assert.equal(JSON.stringify(audit).includes('providerId'), false);
    assert.equal(audit.readyForTts, true);
    assert.equal(audit.source.url, '/');
  });

  it('keeps the lesson review code registry complete', () => {
    let timeline = createPresentationTimelineContract({
      title: 'Registry audit',
      turns: [{ text: 'GUIDE: inspect #queue and targetId.', cue: { targetId: '#queue' } }],
    });
    let review = reviewPresentationTimeline(timeline, {
      requireDialogue: true,
      allowedTargetIds: ['panel:orders:queue'],
    });
    for (let issue of review.issues) assert.ok(PRESENTATION_LESSON_REVIEW_CODES.includes(issue.code), issue.code);
  });

  it('rejects request mismatch, missing cues, and invalid actions', () => {
    let timeline = createPresentationTimelineContract({
      id: 'bad-actions-tour',
      title: 'Generic tour',
      turns: [
        {
          persona: 'guide',
          text: 'This gives a generic introduction.',
          cue: { targetId: 'panel:orders:queue', tabId: 'orders' },
          actions: [{ source: 'dom-click', name: 'click', target: 'panel:orders:queue' }],
        },
        {
          persona: 'ops',
          text: 'This line has no stable focus target.',
        },
      ],
    });

    let review = reviewPresentationTimeline(timeline, {
      allowedTargetIds: ['panel:orders:queue'],
      requestKeywords: ['feeder', 'crew'],
      requireRequestKeywords: true,
      requiredPersonas: ['guide', 'ops', 'planner'],
    });

    assert.equal(review.verdict, 'reject');
    assert.ok(review.issues.some((issue) => issue.code === 'request-keyword-missing'));
    assert.ok(review.issues.some((issue) => issue.code === 'unsupported-action-source'));
    assert.ok(review.issues.some((issue) => issue.code === 'missing-required-persona'));
    assert.equal(review.issues.find((issue) => issue.code === 'missing-cue-target')?.severity, 'error');
    assert.deepEqual(review.coverage.missingRequiredPersonas, ['planner']);
    assert.deepEqual(review.coverage.missingRequestKeywords.sort(), ['crew', 'feeder']);
  });

  it('does not reject broad overview requests on generic tour words', () => {
    let timeline = createPresentationTimelineContract({
      id: 'workspace-overview-tour',
      title: 'Workspace overview',
      turns: [
        {
          persona: 'guide',
          text: 'The operations board, developer panel, and agent dock are ready for review.',
          cue: { targetId: 'panel:workspace:overview', tabId: 'home' },
        },
      ],
    });

    let review = reviewPresentationTimeline(timeline, {
      allowedTargetIds: ['panel:workspace:overview'],
      requestedSurfaceIds: ['panel:workspace:overview'],
      requestPrompt: 'Walk me through all available workspaces',
      requireRequestFit: true,
    });

    assert.equal(review.verdict, 'pass');
    assert.deepEqual(review.coverage.requestKeywords, []);
    assert.deepEqual(review.coverage.missingRequestKeywords, []);
  });

  it('aligns render cues to audio authority without estimating missing overlap starts', () => {
    let sequential = alignPresentationTimelineToAudio({
      id: 'audio-authority-tour',
      title: 'Audio authority tour',
      turns: [
        { persona: 'guide', text: 'First turn.', cue: { targetId: 'panel:a' } },
        { persona: 'ops', text: 'Second turn.', cue: { targetId: 'panel:b' } },
      ],
    }, {
      audioItems: [{ durationMs: 1200 }, { durationMs: 900 }],
      sequenceMode: 'sequential',
    });

    assert.deepEqual(
      sequential.turns.map((turn) => turn.renderCue),
      [
        { startMs: 0, durationMs: 1200, endMs: 1200, source: 'audio' },
        { startMs: 1200, durationMs: 900, endMs: 2100, source: 'audio' },
      ],
    );
    assert.equal(sequential.metadata.audioAuthority.durationMs, 2100);
    assert.equal(sequential.metadata.audioAuthority.sequenceMode, 'sequential');

    let overlap = alignPresentationTimelineToAudio({
      id: 'overlap-tour',
      title: 'Overlap tour',
      turns: [
        { persona: 'guide', text: 'Guide.', renderCue: { startMs: 0 } },
        { persona: 'ops', text: 'Ops.', renderCue: { startMs: 500 } },
      ],
    }, {
      audioItems: [{ durationMs: 1000 }, { durationMs: 800 }],
      sequenceMode: 'overlap',
    });

    assert.deepEqual(overlap.turns.map((turn) => turn.renderCue.startMs), [0, 500]);
    assert.equal(overlap.metadata.audioAuthority.durationMs, 1300);
    assert.throws(
      () => alignPresentationTimelineToAudio({
        id: 'bad-overlap-tour',
        title: 'Bad overlap tour',
        turns: [
          { persona: 'guide', text: 'Guide.', renderCue: { startMs: 0 } },
          { persona: 'ops', text: 'Ops.' },
        ],
      }, {
        audioItems: [{ durationMs: 1000 }, { durationMs: 800 }],
        sequenceMode: 'overlap',
      }),
      /audio authority overlap timing requires renderCue.startMs/,
    );
  });
});

describe('presentation replan contracts', () => {
  it('separates stable viewport identity from volatile data hashes', () => {
    let base = context({
      source: { url: 'https://demo.test/workbench?token=secret', surface: 'orders', tabId: 'home' },
    });
    let first = createPresentationContextSnapshot(base, {
      generation: 1,
      viewport: { width: 1920, height: 1080, fps: 30 },
      source: base.source,
      stability: { settled: true, waitedFor: ['layout', 'webmcp'] },
    });
    let changedData = createPresentationContextSnapshot({
      ...base,
      dataContext: { ...base.dataContext, liveData: { clock: 99, queueDepth: 7 } },
    }, {
      generation: 1,
      viewport: { width: 1920, height: 1080, fps: 30 },
      source: base.source,
      stability: { settled: true, waitedFor: ['layout', 'webmcp'] },
    });
    let vertical = createPresentationContextSnapshot(base, {
      generation: 1,
      viewport: { width: 1080, height: 1920, fps: 30 },
      source: base.source,
      stability: { settled: true, waitedFor: ['layout', 'webmcp'] },
    });

    assert.equal(first.identityHash, changedData.identityHash);
    assert.equal(first.identityHash, createPresentationContextSnapshot(base, {
      generation: 2,
      viewport: { width: 1920, height: 1080, fps: 30 },
      source: base.source,
      stability: { settled: true, waitedFor: ['layout', 'webmcp'] },
    }).identityHash);
    assert.notEqual(first.dataHash, changedData.dataHash);
    assert.notEqual(first.identityHash, vertical.identityHash);
    assert.equal(first.source.url, 'https://demo.test/workbench');
  });

  it('finalizes only a current, grounded planner result', () => {
    let snapshot = createPresentationContextSnapshot(context(), {
      generation: 2,
      viewport: { width: 1920, height: 1080, fps: 30 },
      stability: { settled: true },
    });
    let source = snapshot.dataSources[0];
    let request = createPresentationReplanRequest({
      request: { prompt: 'Explain the active queue', profile: 'data-grounded' },
      turnBudget: { min: 1, max: 6 },
      targetSnapshot: snapshot,
      sourceSnapshot: snapshot,
    });
    assert.deepEqual(request.turnBudget, { minTurns: 1, maxTurns: 6 });
    let candidate = {
      status: 'ready',
      basis: { targetSnapshotHash: snapshot.identityHash, generation: 2 },
      timeline: {
        title: 'Grounded queue',
        grounding: { sources: snapshot.dataSources },
        turns: [{
          id: 'queue-explain',
          persona: 'guide',
          dialogueAct: 'explain',
          text: 'The active queue contains the selected work order.',
          cue: { targetId: 'panel:home:queue-node', tabId: 'home' },
          sourceRefs: [{ sourceId: source.id, targetId: 'panel:home:queue-node', hash: source.contentHash }],
        }],
      },
    };
    let result = finalizePresentationReplan(candidate, request, {
      snapshot,
      intent: { requireGrounding: true },
    });

    assert.equal(result.status, 'ready');
    assert.equal(result.timelineHash, result.timeline.hash);
    assert.equal(result.review.verdict, 'pass');
    assert.throws(
      () => finalizePresentationReplan({
        ...candidate,
        basis: { targetSnapshotHash: snapshot.identityHash, generation: 1 },
      }, request, { snapshot }),
      (error) => error.code === 'TARGET_CONTEXT_STALE',
    );
    assert.equal(reviewPresentationTimelineAgainstSnapshot(result.timeline, snapshot).verdict, 'pass');
  });

  it('blocks unsafe speech before exposing synthesis items', () => {
    let timeline = createPresentationTimelineContract({
      title: 'Unsafe speech',
      turns: [{ id: 'unsafe', persona: 'guide', text: 'Open #queue and read targetId.', cue: { targetId: 'panel:orders:queue' } }],
    });
    let review = reviewPresentationTimeline(timeline, { allowedTargetIds: ['panel:orders:queue'] });
    let projection = createPresentationTtsProjection(timeline, { review });
    assert.equal(review.verdict, 'reject');
    assert.equal(projection.status, 'blocked');
    assert.equal(projection.readyForTts, false);
    assert.deepEqual(projection.items, []);
  });
});
