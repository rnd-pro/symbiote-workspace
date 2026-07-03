import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorkspacePresentationTimeline,
  normalizePresentationPrompt,
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
