import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESENTATION_CONTRACT_VERSION,
  createPresentationTimelineContract,
  createPresentationTimelineHash,
  createWorkspacePresentationTimeline,
  normalizePresentationPrompt,
  normalizePresentationTimeline,
  presentationTimelineHasTurns,
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
    assert.deepEqual(contract.turns[0].renderCue, { durationMs: 1800 });
    assert.match(contract.hash, /^presentation-timeline-v1:sha256-/);
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
    assert.equal(createPresentationTimelineHash(a, { contractVersion: 'presentation-timeline-v2' }).startsWith('presentation-timeline-v2:'), true);
    assert.notEqual(
      createPresentationTimelineHash(a),
      createPresentationTimelineHash(a, { contractVersion: 'presentation-timeline-v2' }),
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
});
