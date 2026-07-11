import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyWorkspaceTheme,
  collectWorkspaceInterfaceContext,
  mountWorkspace,
  prepareWorkspacePresentation,
} from '../browser.js';

function timelineV3(input = {}) {
  let turns = (input.turns || []).map((turn, index) => {
    let cues = turn.cues || [];
    if (turn.cue) {
      cues.push({
        kind: 'focus',
        targetId: turn.cue.targetId,
        ...(turn.cue.tabId ? { tabId: turn.cue.tabId } : {}),
        at: { anchor: 'turn-start' },
        until: { anchor: 'turn-end' },
        focus: { mode: 'cursor' },
      });
    }
    for (let action of turn.actions || []) {
      cues.push({
        kind: 'interaction',
        targetId: action.target,
        at: { anchor: 'turn-start' },
        interaction: {
          type: /reveal/i.test(action.name || '') ? 'panel-reveal' : 'click',
          binding: { source: action.source || 'workspace', tool: action.name, input: action.input || {} },
        },
      });
    }
    return {
      id: turn.id || `turn-${index + 1}`,
      persona: turn.persona || 'guide',
      dialogueAct: turn.dialogueAct || 'explain',
      ...(turn.addressee ? { addressee: turn.addressee } : {}),
      ...(turn.replyTo ? { replyTo: turn.replyTo } : {}),
      text: turn.text,
      sourceRefs: turn.sourceRefs || [],
      claims: turn.claims || [],
      cues,
    };
  });
  let personaIds = [...new Set(turns.map((turn) => turn.persona))];
  return {
    contractVersion: 'presentation-timeline-v3',
    title: input.title || 'Presentation',
    locale: input.locale || 'en-US',
    profile: input.profile || 'task-specific',
    personas: Object.fromEntries(personaIds.map((id) => [id, { name: id, role: id === 'guide' ? 'lesson guide' : 'domain operator', locale: input.locale || 'en-US' }])),
    grounding: input.grounding || { sources: [] },
    turns,
  };
}

async function compositionFixture({ timeline, output, targetSnapshot }) {
  return {
    measuredViewport: { width: output.width, height: output.height, visualWidth: output.width, visualHeight: output.height, dpr: 1 },
    baselineStructuralHash: targetSnapshot.identityHash,
    restoredStructuralHash: targetSnapshot.identityHash,
    simulationFrozen: true,
    steps: timeline.turns.map((turn, index) => {
      let y = 100 + index * 80;
      return {
        turnId: turn.id,
        slotIndex: 0,
        targetId: turn.cues.find((cue) => cue.targetId)?.targetId,
        stateActions: [],
        scroll: [],
        measurement: {
          targetRect: { x: 80, y: y - 20, width: 600, height: 300 },
          focusRect: { x: 100, y, width: 160, height: 40 },
          visibleRect: { x: 100, y, width: 160, height: 40 },
          visibleRatio: 1,
          visible: true,
          reachable: true,
          hasText: true,
          fontSizePx: 14,
          textTruncated: false,
          occluders: [],
          pointerTransparentOccluders: [],
        },
        annotation: { placement: 'right', rect: { x: 280, y, width: 120, height: 40 } },
      };
    }),
  };
}

it('prepares a presentation with one bounded WebMCP deepening round', async () => {
  let revealed = false;
  let planCalls = 0;
  let executed = [];
  let events = [];
  let collectContext = () => ({
    targets: [{
      address: 'panel:orders:detail',
      kind: 'panel',
      tabId: 'orders',
      title: 'Order detail',
      visible: revealed,
      webmcpTools: [{ name: 'orders.reveal-detail' }],
    }],
    panels: [],
    dataContext: { selectedRecords: [{ id: 'wo-1', status: revealed ? 'approved' : 'queued' }] },
  });

  let result = await prepareWorkspacePresentation({
    viewport: { width: 1080, height: 1920, fps: 30 },
    source: { url: '/workbench?token=secret', surface: 'orders', tabId: 'orders' },
    request: { prompt: 'Explain the order detail', profile: 'data-grounded' },
    async rehydrate() {},
    async waitForSettlement() {},
    inspectComposition: compositionFixture,
    collectContext,
    async executeSafeAction(action) {
      executed.push(action.tool);
      revealed = true;
    },
    async plan(request, snapshot) {
      planCalls += 1;
      if (planCalls === 1) {
        return {
          status: 'needs-context',
          requestedActions: [{ source: 'webmcp', tool: 'orders.reveal-detail', target: 'panel:orders:detail', reason: 'Reveal details' }],
        };
      }
      let source = snapshot.dataSources[0];
      return {
        status: 'ready',
        basis: { targetSnapshotHash: request.targetSnapshotHash, outputSpecHash: request.outputSpecHash, generation: request.generation },
        timeline: timelineV3({
          title: 'Order detail',
          grounding: { sources: snapshot.dataSources },
          turns: [{
            id: 'detail-explain',
            persona: 'guide',
            dialogueAct: 'explain',
            text: 'The visible order detail confirms the approved state.',
            cue: { targetId: 'panel:orders:detail', tabId: 'orders' },
            sourceRefs: [{ sourceId: source.id, targetId: 'panel:orders:detail', hash: source.contentHash }],
          }],
        }),
      };
    },
    reviewIntent: { requireGrounding: true },
    onEvent(event) { events.push(event.type); },
  });

  assert.equal(planCalls, 2);
  assert.deepEqual(executed, ['orders.reveal-detail']);
  assert.notEqual(result.sourceSnapshot.identityHash, result.targetSnapshot.identityHash);
  assert.equal(result.targetSnapshot.generation, 1);
  assert.equal(result.status, 'ready');
  assert.ok(events.includes('tour.deepening.action.done'));
});

function groundedDeepeningOptions(overrides = {}) {
  let revealed = false;
  let ordersId = 'panel:orders:list';
  let detailsId = 'panel:orders:detail';
  let collectContext = () => {
    let targets = [
      { address: ordersId, id: ordersId, title: 'Orders', visible: true, rendered: true },
      {
        address: detailsId,
        id: detailsId,
        title: 'Details',
        visible: revealed,
        rendered: revealed,
        webmcpTools: [{
          name: 'orders.reveal-detail',
          description: 'Reveal order details',
          inputSchema: { type: 'object', additionalProperties: false },
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        }],
      },
    ];
    let facts = [{ id: 'status', kind: 'enum', label: 'status', value: 'queued', evidenceRefs: ['e-status'], targetRefs: [ordersId] }];
    let evidence = [{ id: 'e-status', source: 'fixture', path: 'order.status', value: 'queued', targetRefs: [ordersId] }];
    if (revealed) {
      facts.push({ id: 'detail', kind: 'enum', label: 'detail', value: 'approved', evidenceRefs: ['e-detail'], targetRefs: [detailsId] });
      evidence.push({ id: 'e-detail', source: 'fixture', path: 'order.detail', value: 'approved', targetRefs: [detailsId] });
    }
    return {
      targets,
      facts,
      evidence,
      relations: [{ id: 'order-detail', kind: 'affects', from: ordersId, to: detailsId }],
      dataContext: { liveData: { revealed } },
    };
  };
  let calls = 0;
  return {
    viewport: { width: 1080, height: 1920, fps: 30 },
    source: { surface: 'orders', tabId: 'orders' },
    lesson: {
      type: 'operational-task',
      title: 'Approve an order',
      objective: 'Explain the approval task',
      locale: 'en-US',
      requiredFactIds: ['status', 'detail'],
      requiredTargetIds: [ordersId, detailsId],
    },
    request: { prompt: 'Explain the approval task', profile: 'task-specific' },
    async rehydrate() {},
    async waitForSettlement() {},
    inspectComposition: compositionFixture,
    collectContext,
    async executeSafeAction() {
      revealed = true;
      return { content: [{ type: 'text', text: 'Detail revealed' }] };
    },
    async plan(request) {
      calls += 1;
      if (calls === 1) {
        return {
          status: 'needs-context',
          requestedActions: [{
            source: 'webmcp',
            tool: 'orders.reveal-detail',
            target: detailsId,
            input: {},
            requestedGaps: ['detail'],
          }],
        };
      }
      return {
        status: 'ready',
        basis: {
          targetSnapshotHash: request.targetSnapshotHash,
          lessonContextHash: request.lessonContextHash,
          outputSpecHash: request.outputSpecHash,
          generation: request.generation,
        },
        timeline: timelineV3({
          title: 'Approve an order',
          grounding: {
            sources: [
              { id: 'e-status', kind: 'fixture', path: 'order.status', targetId: ordersId },
              { id: 'e-detail', kind: 'fixture', path: 'order.detail', targetId: detailsId },
            ],
          },
          turns: [
            {
              id: 'status',
              persona: 'guide',
              dialogueAct: 'explain',
              text: 'Orders status queued',
              cue: { targetId: ordersId },
              sourceRefs: [{ sourceId: 'e-status', targetId: ordersId }],
              claims: [{ id: 'c-status', kind: 'state', text: 'Orders status queued', factRefs: ['status'], evidenceRefs: ['e-status'], targetRefs: [ordersId] }],
              actions: [{ source: 'webmcp', name: 'orders.reveal-detail', target: detailsId, input: {} }],
            },
            {
              id: 'outcome',
              persona: 'guide',
              dialogueAct: 'explain',
              text: 'Details outcome approved',
              cue: { targetId: detailsId },
              sourceRefs: [{ sourceId: 'e-detail', targetId: detailsId }],
              claims: [{ id: 'c-detail', kind: 'outcome', text: 'Details outcome approved', factRefs: ['detail'], evidenceRefs: ['e-detail'], targetRefs: [detailsId] }],
            },
          ],
        }),
      };
    },
    ...overrides,
  };
}

it('binds planning to a full lesson packet and records per-action deepening evidence', async () => {
  let result = await prepareWorkspacePresentation(groundedDeepeningOptions());
  assert.equal(result.status, 'ready');
  assert.equal(result.lessonContext.lesson.type, 'operational-task');
  assert.equal(result.lessonContext.deepening.actions.length, 1);
  assert.deepEqual(result.lessonContext.deepening.actions[0].satisfiedGaps, ['detail']);
  assert.ok(result.lessonContext.deepening.actions[0].changedRefs.includes('facts:detail'));
  assert.equal(result.review.verdict, 'accept');
});

it('rejects invalid or irrelevant grounded deepening before final planning', async () => {
  let invalid = groundedDeepeningOptions();
  let originalPlan = invalid.plan;
  invalid.plan = async (...args) => {
    let result = await originalPlan(...args);
    if (result.status === 'needs-context') result.requestedActions[0].input = { unexpected: true };
    return result;
  };
  await assert.rejects(prepareWorkspacePresentation(invalid), { code: 'DEEPENING_INPUT_INVALID' });

  let irrelevant = groundedDeepeningOptions();
  let irrelevantPlan = irrelevant.plan;
  irrelevant.plan = async (...args) => {
    let result = await irrelevantPlan(...args);
    if (result.status === 'needs-context') result.requestedActions[0].requestedGaps = ['missing-other-fact'];
    return result;
  };
  await assert.rejects(prepareWorkspacePresentation(irrelevant), { code: 'DEEPENING_IRRELEVANT_CHANGE' });

  let partial = groundedDeepeningOptions();
  let partialPlan = partial.plan;
  partial.plan = async (...args) => {
    let result = await partialPlan(...args);
    if (result.status === 'needs-context') result.requestedActions[0].requestedGaps = ['e'];
    return result;
  };
  await assert.rejects(prepareWorkspacePresentation(partial), { code: 'DEEPENING_IRRELEVANT_CHANGE' });
});

it('allows one review-guided repair on the same target snapshot', async () => {
  let planCalls = 0;
  let requests = [];
  let events = [];
  let result = await prepareWorkspacePresentation({
    viewport: { width: 1920, height: 1080, fps: 30 },
    source: { surface: 'api-graph', tabId: 'tab-1' },
    request: { prompt: 'Explain the API graph', profile: 'data-grounded' },
    async rehydrate() {},
    async waitForSettlement() {},
    inspectComposition: compositionFixture,
    async executeSafeAction() {},
    collectContext() {
      return {
        targets: [{ address: 'panel:api:graph', tabId: 'tab-1', visible: true }],
        dataContext: { selectedRecords: [{ id: 'api-graph', nodes: 4 }] },
      };
    },
    async plan(request, snapshot) {
      planCalls += 1;
      requests.push(request);
      let source = snapshot.dataSources[0];
      return {
        status: 'ready',
        basis: { targetSnapshotHash: request.targetSnapshotHash, outputSpecHash: request.outputSpecHash, generation: request.generation },
        timeline: timelineV3({
          profile: 'data-grounded',
          grounding: { sources: snapshot.dataSources },
          turns: [{
            id: 'api-explain',
            persona: 'guide',
            dialogueAct: 'explain',
            text: planCalls === 1 ? 'Open https://example.test for the graph.' : 'The graph shows four connected API nodes.',
            cue: { targetId: 'panel:api:graph', tabId: 'tab-1' },
            sourceRefs: [{ sourceId: source.id, targetId: 'panel:api:graph', hash: source.contentHash }],
          }],
        }),
      };
    },
    reviewIntent: { requireGrounding: true },
    reviewRepairAttempts: 1,
    onEvent(event) { events.push(event.type); },
  });

  assert.equal(planCalls, 2);
  assert.equal(requests[1].targetSnapshotHash, requests[0].targetSnapshotHash);
  assert.equal(requests[1].generation, requests[0].generation);
  assert.deepEqual(requests[1].reviewFeedback.issues.map((issue) => issue.code), ['unsafe-tts-text']);
  assert.equal(result.review.verdict, 'pass');
  assert.ok(events.includes('tour.replan.review-repair.done'));
});

it('reruns composition after one planner repair on the same output', async () => {
  let planCalls = 0;
  let inspectCalls = 0;
  let events = [];
  let result = await prepareWorkspacePresentation({
    viewport: { width: 1080, height: 1080, fps: 30 },
    source: { surface: 'orders', tabId: 'orders' },
    request: { prompt: 'Explain the queue', profile: 'brief' },
    async rehydrate() {},
    async waitForSettlement() {},
    async executeSafeAction() {},
    collectContext() {
      return { targets: [{ address: 'panel:orders:queue', tabId: 'orders', visible: true }] };
    },
    async plan(request) {
      planCalls += 1;
      return {
        status: 'ready',
        basis: { targetSnapshotHash: request.targetSnapshotHash, outputSpecHash: request.outputSpecHash, generation: request.generation },
        timeline: timelineV3({
          turns: [{
            id: 'queue',
            persona: 'guide',
            dialogueAct: 'explain',
            text: planCalls === 1 ? 'Explain the queue.' : 'Explain the visible queue.',
            cue: { targetId: 'panel:orders:queue', tabId: 'orders' },
          }],
        }),
      };
    },
    async inspectComposition(input) {
      inspectCalls += 1;
      let fixture = await compositionFixture(input);
      if (inspectCalls === 1) fixture.steps[0].measurement.visible = false;
      return fixture;
    },
    reviewRepairAttempts: 1,
    onEvent(event) { events.push(event.type); },
  });

  assert.equal(planCalls, 2);
  assert.equal(inspectCalls, 2);
  assert.equal(result.output.orientation, 'square');
  assert.equal(result.compositionAudit.verdict, 'accept');
  assert.ok(events.includes('tour.composition.review-repair.done'));
});

it('allows a composition repair to revise claims without changing lesson requirements', async () => {
  let options = groundedDeepeningOptions();
  let originalPlan = options.plan;
  let readyCalls = 0;
  options.reviewRepairAttempts = 1;
  options.plan = async (...args) => {
    let candidate = await originalPlan(...args);
    if (candidate.status !== 'ready') return candidate;
    readyCalls += 1;
    if (readyCalls === 2) candidate.timeline.turns[0].claims[0].kind = 'procedure';
    return candidate;
  };
  let inspectCalls = 0;
  options.inspectComposition = async (input) => {
    inspectCalls += 1;
    let fixture = await compositionFixture(input);
    if (inspectCalls === 1) fixture.steps[0].measurement.visible = false;
    return fixture;
  };

  let result = await prepareWorkspacePresentation(options);

  assert.equal(readyCalls, 2);
  assert.equal(inspectCalls, 2);
  assert.equal(result.timeline.turns[0].claims[0].kind, 'procedure');
  assert.equal(result.compositionAudit.verdict, 'accept');
});

function deepeningFailureOptions({ plan, executeSafeAction = async () => {} } = {}) {
  return {
    viewport: { width: 1080, height: 1920, fps: 30 },
    source: { surface: 'orders', tabId: 'orders' },
    request: { prompt: 'Explain the order detail', profile: 'data-grounded' },
    async rehydrate() {},
    async waitForSettlement() {},
    inspectComposition: compositionFixture,
    executeSafeAction,
    collectContext() {
      return {
        targets: [{
          address: 'panel:orders:detail',
          tabId: 'orders',
          visible: false,
          webmcpTools: [{ name: 'orders.reveal-detail' }],
        }],
        dataContext: { selectedRecords: [{ id: 'wo-1', status: 'queued' }] },
      };
    },
    plan,
  };
}

it('rejects a deepening action outside the exact snapshot allowlist', async () => {
  await assert.rejects(prepareWorkspacePresentation(deepeningFailureOptions({
    async plan() {
      return {
        status: 'needs-context',
        requestedActions: [{ source: 'webmcp', tool: 'orders.delete', target: 'panel:orders:detail' }],
      };
    },
  })), { code: 'DEEPENING_ACTION_UNSAFE' });
});

it('fails closed when an allowed deepening action fails', async () => {
  await assert.rejects(prepareWorkspacePresentation(deepeningFailureOptions({
    async plan() {
      return {
        status: 'needs-context',
        requestedActions: [{ source: 'webmcp', tool: 'orders.reveal-detail', target: 'panel:orders:detail' }],
      };
    },
    async executeSafeAction() { throw new Error('action failed'); },
  })), { code: 'DEEPENING_ACTION_FAILED' });
});

it('fails closed when deepening does not change interface or data context', async () => {
  await assert.rejects(prepareWorkspacePresentation(deepeningFailureOptions({
    async plan() {
      return {
        status: 'needs-context',
        requestedActions: [{ source: 'webmcp', tool: 'orders.reveal-detail', target: 'panel:orders:detail' }],
      };
    },
  })), { code: 'DEEPENING_NO_EFFECT' });
});

it('does not permit a review repair to request another deepening round', async () => {
  let calls = 0;
  await assert.rejects(prepareWorkspacePresentation({
    ...deepeningFailureOptions(),
    reviewRepairAttempts: 1,
    reviewIntent: { requireGrounding: true },
    async plan(request, snapshot) {
      calls += 1;
      if (calls > 1) {
        return {
          status: 'needs-context',
          requestedActions: [{ source: 'webmcp', tool: 'orders.reveal-detail', target: 'panel:orders:detail' }],
        };
      }
      let source = snapshot.dataSources[0];
      return {
        status: 'ready',
        basis: { targetSnapshotHash: request.targetSnapshotHash, outputSpecHash: request.outputSpecHash, generation: request.generation },
        timeline: timelineV3({
          grounding: { sources: snapshot.dataSources },
          turns: [{
            id: 'unsafe-turn',
            persona: 'guide',
            dialogueAct: 'explain',
            text: 'Open https://example.test now.',
            cue: { targetId: 'panel:orders:detail', tabId: 'orders' },
            sourceRefs: [{ sourceId: source.id, targetId: 'panel:orders:detail', hash: source.contentHash }],
          }],
        }),
      };
    },
  }), { code: 'DEEPENING_BUDGET_EXHAUSTED' });
  assert.equal(calls, 2);
});

class TestStyle {
  values = new Map();

  setProperty(name, value) {
    this.values.set(name, String(value));
  }

  getPropertyValue(name) {
    return this.values.get(name) || '';
  }
}

class TestElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = new TestStyle();
    this.className = '';
    this.id = '';
    this.textContent = '';
    this.listeners = new Map();
    this.attributes = new Map();
  }

  appendChild(child) {
    if (child?.isFragment) {
      for (let item of [...child.children]) this.appendChild(item);
      child.children = [];
      return child;
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  addEventListener(type, listener) {
    let listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    let listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((item) => item !== listener));
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    for (let listener of this.listeners.get(event.type) || []) listener(event);
    if (event.bubbles && this.parentElement) this.parentElement.dispatchEvent(event);
    return true;
  }

  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    let results = [];
    for (let child of this.children) {
      if (child.matches(selector)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }
}

class TestDocument {
  constructor() {
    this.defaultView = {
      location: { pathname: '/', search: '', hash: '' },
      history: { length: 1 },
    };
  }

  createElement(tagName) {
    return new TestElement(tagName, this);
  }

  createDocumentFragment() {
    return {
      isFragment: true,
      children: [],
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    };
  }
}

function createThemeAdapter(calls = []) {
  return {
    applyCascadeTheme(element, options, eventOptions) {
      calls.push({ type: 'theme', element, options, eventOptions });
      if (options.hue !== undefined) element.style.setProperty('--sn-theme-hue', options.hue);
      if (options.density !== undefined) element.style.setProperty('--sn-theme-density', options.density);
      return { state: options, tokens: {} };
    },
    applyCascadeGeometryRegister(element, register, eventOptions) {
      calls.push({ type: 'geometry', element, register, eventOptions });
      element.style.setProperty('--sn-theme-register', register || 'default');
      return register || '';
    },
  };
}

function createContainer() {
  let document = new TestDocument();
  return document.createElement('main');
}

function workspace(overrides = {}) {
  return {
    version: '1.0.0',
    name: 'Mounted Workspace',
    views: [{
      id: 'home',
      title: 'Home',
      layout: { $layout: 'main' },
      route: { pattern: '/', default: true },
    }],
    layouts: {
      main: {
        kind: 'bsp',
        root: { type: 'panel', id: 'main-panel', panel: 'main' },
      },
    },
    panels: {
      main: { module: 'sn-main-panel', title: 'Main' },
    },
    ...overrides,
  };
}

describe('applyWorkspaceTheme', () => {
  it('applies cascade params, relations, overrides, and subtree overrides', () => {
    let root = createContainer();
    let side = root.ownerDocument.createElement('aside');
    side.className = 'sidebar';
    root.appendChild(side);
    let calls = [];

    let result = applyWorkspaceTheme({
      version: '1.0.0',
      name: 'Theme',
      theme: {
        params: { hue: 220 },
        relations: { surfaceStep: 1.1 },
        overrides: { '--sn-gap': '8px' },
        subtrees: [{ selector: '.sidebar', overrides: { '--sn-panel-bg': 'black' } }],
      },
    }, root, { themeAdapter: createThemeAdapter(calls) });

    assert.equal(root.style.getPropertyValue('--sn-theme-hue'), '220');
    assert.equal(root.style.getPropertyValue('--sn-gap'), '8px');
    assert.equal(side.style.getPropertyValue('--sn-panel-bg'), 'black');
    assert.equal(calls[0].options.relations.surfaceStep, 1.1);
    assert.deepEqual(result.warnings, []);
  });

  it('applies geometry registers through the theme adapter without passing them as cascade params', () => {
    let root = createContainer();
    let side = root.ownerDocument.createElement('aside');
    side.className = 'sidebar';
    root.appendChild(side);
    let calls = [];

    applyWorkspaceTheme({
      version: '1.0.0',
      name: 'Theme Geometry',
      theme: {
        params: { hue: 220, register: 'tool' },
        subtrees: [{ selector: '.sidebar', params: { register: 'spacious' } }],
      },
    }, root, { themeAdapter: createThemeAdapter(calls) });

    assert.equal(root.style.getPropertyValue('--sn-theme-hue'), '220');
    assert.equal(root.style.getPropertyValue('--sn-theme-register'), 'tool');
    assert.equal(side.style.getPropertyValue('--sn-theme-register'), 'spacious');
    assert.equal(calls.find((call) => call.type === 'theme').options.register, undefined);
    assert.equal(calls.filter((call) => call.type === 'geometry').length, 2);
  });

  it('reports unmatched subtree selectors without hiding the warning', () => {
    let root = createContainer();
    let result = applyWorkspaceTheme({
      version: '1.0.0',
      name: 'Theme',
      theme: {
        subtrees: [{ selector: '.missing', overrides: { '--sn-panel-bg': 'red' } }],
      },
    }, root);

    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].path, 'theme.subtrees.0');
  });

  it('throws when cascade params or relations require a missing theme adapter', () => {
    let root = createContainer();
    assert.throws(() => applyWorkspaceTheme({
      version: '1.0.0',
      name: 'Theme',
      theme: { params: { hue: 220, themeVariant: 'modern', tabShape: 'frame' } },
    }, root), /requires options\.themeAdapter\.applyCascadeTheme/);

    assert.throws(() => applyWorkspaceTheme({
      version: '1.0.0',
      name: 'Theme',
      theme: { relations: { surfaceStep: 1.2 } },
    }, root), /requires options\.themeAdapter\.applyCascadeTheme/);
  });

  it('throws when subtree params or relations require a missing theme adapter', () => {
    let root = createContainer();
    let sidebar = root.ownerDocument.createElement('aside');
    sidebar.className = 'sidebar';
    root.appendChild(sidebar);

    assert.throws(() => applyWorkspaceTheme({
      version: '1.0.0',
      name: 'Theme',
      theme: {
        subtrees: [{
          selector: '.sidebar',
          params: { hue: 180 },
          relations: { radiusScale: 0.8 },
        }],
      },
    }, root), /requires options\.themeAdapter\.applyCascadeTheme/);
  });

  it('applies override-only themes without a cascade theme adapter', () => {
    let root = createContainer();
    let result = applyWorkspaceTheme({
      version: '1.0.0',
      name: 'Theme',
      theme: {
        overrides: { '--sn-panel-bg': 'black' },
      },
    }, root);

    assert.equal(root.style.getPropertyValue('--sn-panel-bg'), 'black');
    assert.deepEqual(result.warnings, []);
  });
});

describe('mountWorkspace', () => {
  it('creates a per-workspace memory router and stamps panel ctx attributes', async () => {
    let container = createContainer();
    let mounted = mountWorkspace(workspace(), container);
    await mounted.ready;

    let panel = mounted.element.querySelectorAll('.symbiote-workspace__panel')[0];
    assert.equal(mounted.router.mode, 'memory');
    assert.equal(mounted.router.getState('state:route.view'), 'home');
    assert.equal(panel.getAttribute('ctx'), 'panel:home:main-panel');
    assert.equal(panel.dataset.module || panel.dataset.component, 'sn-main-panel');

    mounted.destroy();
    assert.equal(container.children.length, 0);
    assert.equal(mounted.router.events.some((event) => event.subject === 'route:destroy'), true);
  });

  it('collects full interface context with hidden views, stack panels, and reveal actions', async () => {
    let config = workspace({
      views: [
        { id: 'home', title: 'Home', layout: { $layout: 'main' }, route: { pattern: '/', default: true } },
        { id: 'detail', title: 'Detail', layout: { $layout: 'detail' }, route: { pattern: '/detail' } },
      ],
      layouts: {
        main: {
          kind: 'bsp',
          root: {
            type: 'stack',
            id: 'workbench-stack',
            active: 'queue-node',
            children: [
              { type: 'panel', id: 'queue-node', panel: 'queue' },
              { type: 'panel', id: 'audit-node', panel: 'audit' },
            ],
          },
        },
        detail: {
          kind: 'bsp',
          root: { type: 'panel', id: 'detail-node', panel: 'detail' },
        },
      },
      panels: {
        queue: {
          module: 'demo:queue',
          title: 'Work queue',
        },
        audit: { module: 'sn-event-feed', title: 'Audit trail' },
        detail: { module: 'sn-rich-text-editor', title: 'Detail brief' },
      },
      modules: [{
        id: 'demo:queue',
        source: { kind: 'package', package: 'symbiote-ui', export: 'DataTable' },
        tagName: 'sn-data-table',
        title: 'Work queue module',
        capabilities: ['data.table'],
        actions: [{ id: 'queue.select', label: 'Select row', does: { kind: 'emit', event: 'row-select' } }],
        webmcp: { tools: [{ name: 'demo--queue_query' }] },
        hostServices: { required: ['agent.webmcp'] },
      }],
    });
    let mounted = mountWorkspace(config, createContainer());
    await mounted.ready;

    let context = mounted.getInterfaceContext();
    assert.equal(context.activeViewId, 'home');
    assert.deepEqual(context.summary, {
      viewCount: 2,
      stackCount: 1,
      panelCount: 3,
      visiblePanelCount: 1,
      hiddenPanelCount: 2,
      runtimeTargetCount: 0,
    });

    let queue = context.panels.find((panel) => panel.panelId === 'queue');
    let audit = context.panels.find((panel) => panel.panelId === 'audit');
    let detail = context.panels.find((panel) => panel.panelId === 'detail');
    assert.equal(queue.address, 'panel:home:queue-node');
    assert.equal(queue.visible, true);
    assert.equal(queue.rendered, true);
    assert.deepEqual(queue.safeActions, [{
      id: 'queue.select',
      label: 'Select row',
      does: { kind: 'emit', event: 'row-select' },
    }]);
    assert.deepEqual(queue.webmcpTools, [{ name: 'demo--queue_query' }]);

    assert.equal(audit.visible, false);
    assert.deepEqual(audit.hiddenReasons, ['stack-inactive']);
    assert.deepEqual(audit.revealActions, [{
      type: 'stack.select',
      target: 'stack:home:workbench-stack',
      input: { viewId: 'home', stackId: 'workbench-stack', childId: 'audit-node' },
    }]);

    assert.equal(detail.visible, false);
    assert.deepEqual(detail.hiddenReasons, ['view-inactive']);
    assert.deepEqual(detail.revealActions, [{
      type: 'view.select',
      target: 'view:detail',
      input: { viewId: 'detail' },
    }]);
    assert.ok(context.targets.some((target) => target.address === 'panel:detail:detail-node'));

    let detailOnly = collectWorkspaceInterfaceContext(config, null, { viewId: 'detail' });
    assert.equal(detailOnly.panels.find((panel) => panel.panelId === 'detail').visible, true);
    assert.equal(detailOnly.panels.find((panel) => panel.panelId === 'queue').visible, false);
    mounted.destroy();

    let unrendered = mountWorkspace(config, createContainer(), { renderDefaultPreview: false });
    await unrendered.ready;
    let unrenderedContext = unrendered.getInterfaceContext();
    let unrenderedQueue = unrenderedContext.panels.find((panel) => panel.panelId === 'queue');
    assert.equal(unrenderedQueue.visibleByState, true);
    assert.equal(unrenderedQueue.rendered, false);
    assert.equal(unrenderedQueue.visible, false);
    assert.deepEqual(unrenderedQueue.hiddenReasons, ['not-rendered']);
    unrendered.destroy();
  });

  it('merges live WebMCP targets and data context without leaking DOM references', async () => {
    let config = workspace({
      views: [{
        id: 'home',
        title: 'Home',
        layout: { $layout: 'main' },
        route: {
          pattern: '/',
          default: true,
          data: [{
            id: 'workOrder',
            source: { resource: 'work-orders', op: 'get', args: { id: 'WO-1' } },
            bind: 'state:route.data.workOrder',
          }],
        },
      }],
      layouts: {
        main: {
          kind: 'bsp',
          root: { type: 'panel', id: 'queue-node', panel: 'queue' },
        },
      },
      panels: {
        queue: { module: 'demo:queue', title: 'Work queue' },
      },
      modules: [{
        id: 'demo:queue',
        source: { kind: 'package', package: 'symbiote-ui', export: 'DataTable' },
        tagName: 'sn-data-table',
        title: 'Work queue module',
        capabilities: ['data.table'],
        actions: [{ id: 'queue.refresh', label: 'Refresh', does: { kind: 'emit', event: 'refresh' } }],
      }],
    });
    let mounted = mountWorkspace(config, createContainer(), {
      loaders: {
        workOrder: () => ({ id: 'WO-1', status: 'APPR', priority: 1 }),
      },
    });
    await mounted.ready;

    let context = mounted.getInterfaceContext({
      targetCollector(root, meta) {
        let panelElement = root.querySelectorAll('.symbiote-workspace__panel')[0];
        assert.equal(meta.activeViewId, 'home');
        assert.equal(meta.panels.length, 1);
        return {
          targets: [
            {
              address: 'panel:home:queue-node',
              kind: 'panel',
              visible: true,
              element: panelElement,
              safeActions: [{ id: 'runtime.focus-panel', label: 'Focus panel' }],
              enrichment: { runtimeRole: 'primary-queue' },
            },
            {
              address: 'element:queue-row-WO-1',
              kind: 'row',
              panelAddress: 'panel:home:queue-node',
              element: panelElement,
              safeActions: [{ id: 'queue.select-row', input: { id: 'WO-1' } }],
              enrichment: { entity: 'work-order' },
            },
            {
              address: 'element:queue-row-WO-1',
              kind: 'row',
              element: panelElement,
              enrichment: { currentStatus: 'APPR' },
            },
          ],
        };
      },
      targetEnrichment: {
        'element:queue-row-WO-1': { presentationHint: 'Open the selected work order row.' },
      },
      dataContext: {
        selectedRecords: [{ type: 'work-order', id: 'WO-1' }],
        retrievedContext: [{ source: 'sop', title: 'Approval checklist' }],
        mockData: { scenario: 'demo' },
        documentPresentation: { 'doc:notes:wo-1': { scope: 'viewport', zoom: 1.2 } },
      },
    });

    assert.equal(context.summary.runtimeTargetCount, 3);
    assert.equal(context.runtimeTargets.some((target) => 'element' in target), false);
    let mergedPanel = context.targets.find((target) => target.address === 'panel:home:queue-node');
    assert.deepEqual(mergedPanel.sources, ['config', 'runtime']);
    assert.ok(mergedPanel.safeActions.some((action) => action.id === 'runtime.focus-panel'));
    assert.equal(mergedPanel.enrichment.runtimeRole, 'primary-queue');

    let rowTargets = context.targets.filter((target) => target.address === 'element:queue-row-WO-1');
    assert.equal(rowTargets.length, 1);
    assert.deepEqual(rowTargets[0].safeActions, [{ id: 'queue.select-row', input: { id: 'WO-1' } }]);
    assert.deepEqual(rowTargets[0].enrichment, {
      entity: 'work-order',
      presentationHint: 'Open the selected work order row.',
      currentStatus: 'APPR',
    });

    assert.deepEqual(context.dataContext.route.data.workOrder, { id: 'WO-1', status: 'APPR', priority: 1 });
    assert.deepEqual(context.dataContext.selectedRecords, [{ type: 'work-order', id: 'WO-1' }]);
    assert.deepEqual(context.dataContext.retrievedContext, [{ source: 'sop', title: 'Approval checklist' }]);
    assert.deepEqual(context.dataContext.mockData, { scenario: 'demo' });
    assert.deepEqual(context.dataContext.documentPresentation, { 'doc:notes:wo-1': { scope: 'viewport', zoom: 1.2 } });
    mounted.destroy();
  });

  it('plays a presentation timeline by revealing hidden targets before narration', async () => {
    let config = workspace({
      views: [
        { id: 'home', title: 'Home', layout: { $layout: 'home' }, route: { pattern: '/', default: true } },
        { id: 'detail', title: 'Detail', layout: { $layout: 'detail' }, route: { pattern: '/detail' } },
      ],
      layouts: {
        home: { kind: 'bsp', root: { type: 'panel', id: 'queue-node', panel: 'queue' } },
        detail: { kind: 'bsp', root: { type: 'panel', id: 'detail-node', panel: 'detail' } },
      },
      panels: {
        queue: { module: 'sn-data-table', title: 'Queue' },
        detail: { module: 'sn-rich-text-editor', title: 'Detail' },
      },
    });
    let mounted = mountWorkspace(config, createContainer());
    await mounted.ready;
    assert.equal(mounted.router.getState('state:route.view'), 'home');

    let generated = mounted.createPresentationTimeline({
      prompt: 'сделай полную презентацию интерфейса',
      revision: 1,
    });
    assert.equal(generated.metadata.presentationSummary.profile, 'full');
    assert.ok(generated.metadata.presentationSummary.targetCoverage.includes('panel:detail:detail-node'));

    let callbackOrder = [];
    let events = await mounted.playPresentationTimeline(timelineV3({
      title: 'Detail tour',
      turns: [{
        id: 'show-detail',
        persona: 'guide',
        dialogueAct: 'explain',
        text: 'This is the detail panel.',
        cue: { targetId: 'panel:detail:detail-node' },
        actions: [{ source: 'webmcp', name: 'demo--detail_focus', target: 'panel:detail:detail-node' }],
      }],
    }), {
      onFocus: async () => {
        callbackOrder.push('focus');
        assert.equal(mounted.router.getState('state:route.view'), 'detail');
      },
      onCue: async () => callbackOrder.push('cue'),
      executeAction: async (action) => {
        callbackOrder.push(`action:${action.source}`);
        assert.equal(action.tool, 'demo--detail_focus');
      },
      onNarration: async () => {
        callbackOrder.push('narration');
        assert.equal(mounted.router.getState('state:route.view'), 'detail');
      },
    });

    assert.deepEqual(events.map((event) => event.type), ['reveal', 'focus', 'interaction', 'narration']);
    assert.deepEqual(callbackOrder, ['focus', 'cue', 'action:webmcp', 'cue', 'narration']);
    assert.equal(mounted.router.getState('state:route.view'), 'detail');

    await assert.rejects(
      () => mounted.playPresentationTimeline({
        ...timelineV3({ turns: [{ id: 'bad-action', persona: 'guide', text: 'Bad action.', actions: [{ source: 'dom', name: 'click', target: 'panel:detail:detail-node' }] }] }),
      }, { executeAction: async () => {} }),
      /unsupported value "dom"/,
    );
    mounted.destroy();
  });

  it('routes updateConfig through WorkspaceState commit and broadcasts origin envelopes', () => {
    let container = createContainer();
    let sent = [];
    let mounted = mountWorkspace(workspace(), container, {
      broadcast: (message) => sent.push(message),
    });

    assert.throws(() => mounted.updateConfig(workspace({ name: 'Missing Base' })), /baseRevision/);

    let result = mounted.updateConfig(workspace({ name: 'Committed Workspace' }), {
      baseRevision: 0,
      principal: { kind: 'human', id: 'u-1' },
      sessionId: 's-1',
      reason: 'rename',
    });

    assert.equal(result, mounted);
    assert.equal(mounted.revision, 1);
    assert.equal(mounted.config.name, 'Committed Workspace');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.channel, 'workspace:config');
    assert.equal(sent[0].payload.revision, 1);
    assert.deepEqual(sent[0].payload.changedPaths, ['/']);
    assert.deepEqual(sent[0].payload.origin.principal, { kind: 'human', id: 'u-1' });
    assert.equal(sent[0].payload.origin.actor, 'user-direct');
    assert.equal(sent[0].payload.origin.reason, 'rename');
    assert.equal(sent[0].payload.origin.sessionId, 's-1');
  });

  it('routes applyPatch through the same baseRevision commit interface', async () => {
    let mounted = mountWorkspace(workspace(), createContainer());

    await assert.rejects(
      mounted.applyPatch({ overlay: { name: 'No Base' } }),
      /baseRevision/,
    );

    let result = await mounted.applyPatch({
      overlay: { name: 'Patched Workspace' },
    }, {
      baseRevision: 0,
      principal: { kind: 'human', id: 'u-1' },
      sessionId: 's-1',
    });

    assert.equal(result.status, 'ok');
    assert.equal(result.commit.revision, 1);
    assert.equal(mounted.config.name, 'Patched Workspace');
  });

  it('resets the router when host mount params change', () => {
    let mounted = mountWorkspace(workspace(), createContainer(), {
      router: {
        mode: 'path',
        basePath: '/p/:projectId',
        mount: { projectId: 'one' },
      },
    });

    mounted.updateConfig(workspace({ name: 'Other Mount' }), {
      baseRevision: 0,
      router: {
        mode: 'path',
        basePath: '/p/:projectId',
        mount: { projectId: 'two' },
      },
    });

    assert.equal(mounted.router.mode, 'path');
    assert.equal(mounted.router.getState('state:route.mount.projectId'), 'two');
  });

  it('commits theme editor writeback on the current revision', () => {
    let mounted = mountWorkspace(workspace({
      theme: { params: { hue: 220 } },
    }), createContainer(), {
      themeAdapter: createThemeAdapter(),
    });

    mounted.element.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: { state: { hue: 180, themeVariant: 'classic', tabShape: 'classic-ear', tabRadius: 24, cellRadius: 17 }, targetSelector: null },
    });

    assert.equal(mounted.revision, 1);
    assert.equal(mounted.config.theme.params.hue, 180);
    assert.equal(mounted.config.theme.params.themeVariant, 'classic');
    assert.equal(mounted.config.theme.params.tabShape, 'classic-ear');
    assert.equal(mounted.config.theme.params.tabRadius, 24);
    assert.equal(mounted.config.theme.params.cellRadius, 17);
    assert.equal(mounted.lastCommit.reason, 'themeChange');
  });

  it('calls theme-change subscribers and writes subtree editor changes into config', () => {
    let changes = [];
    let mounted = mountWorkspace(workspace({
      theme: {
        params: { hue: 220 },
        subtrees: [{ selector: '.preview', params: { hue: 40 } }],
      },
    }), createContainer(), {
      themeAdapter: createThemeAdapter(),
      onThemeChange: (change) => changes.push(change),
    });

    mounted.element.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: { state: { hue: 90 }, targetSelector: '.preview' },
    });

    assert.equal(mounted.config.theme.subtrees[0].params.hue, 90);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].targetSelector, '.preview');
  });

  it('preserves structured root and subtree theme writeback state', () => {
    let mounted = mountWorkspace(workspace({
      theme: {
        params: { mode: 'dark', hue: 220 },
        relations: { surfaceStep: 1.1 },
        overrides: { '--sn-gap': '8px' },
        subtrees: [{
          selector: '.preview',
          params: { hue: 40 },
          relations: { radiusScale: 0.75 },
          overrides: { '--sn-node-radius': '4px' },
        }],
      },
    }), createContainer(), {
      themeAdapter: createThemeAdapter(),
    });

    mounted.element.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: {
        state: {
          params: { hue: 180, contrast: 70 },
          relations: { surfaceStep: 1.25 },
          overrides: { '--sn-gap': '10px' },
        },
        targetSelector: null,
      },
    });
    mounted.element.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: {
        state: {
          params: { hue: 90, brightness: 65 },
          relations: { radiusScale: 0.9 },
          overrides: { '--sn-node-radius': '6px' },
        },
        targetSelector: '.preview',
      },
    });

    assert.deepEqual(mounted.config.theme.params, {
      mode: 'dark',
      hue: 180,
      contrast: 70,
    });
    assert.deepEqual(mounted.config.theme.relations, { surfaceStep: 1.25 });
    assert.deepEqual(mounted.config.theme.overrides, { '--sn-gap': '10px' });
    assert.deepEqual(mounted.config.theme.subtrees[0].params, {
      hue: 90,
      brightness: 65,
    });
    assert.deepEqual(mounted.config.theme.subtrees[0].relations, { radiusScale: 0.9 });
    assert.deepEqual(mounted.config.theme.subtrees[0].overrides, {
      '--sn-node-radius': '6px',
    });
  });

  it('writes geometry register changes into portable theme config and reapplies them', () => {
    let calls = [];
    let mounted = mountWorkspace(workspace({
      theme: {
        params: { hue: 220 },
        subtrees: [{ selector: '.preview', params: { hue: 40 } }],
      },
    }), createContainer(), {
      themeAdapter: createThemeAdapter(calls),
    });
    let preview = mounted.element.ownerDocument.createElement('section');
    preview.className = 'preview';
    mounted.element.appendChild(preview);

    mounted.element.dispatchEvent({
      type: 'cascade-geometry-register-change',
      bubbles: true,
      detail: { register: 'tool', targetSelector: null },
    });
    mounted.element.dispatchEvent({
      type: 'cascade-geometry-register-change',
      bubbles: true,
      detail: { register: 'spacious', targetSelector: '.preview' },
    });

    assert.equal(mounted.config.theme.params.register, 'tool');
    assert.equal(mounted.config.theme.subtrees[0].params.register, 'spacious');
    assert.equal(mounted.element.style.getPropertyValue('--sn-theme-register'), 'tool');
    assert.equal(preview.style.getPropertyValue('--sn-theme-register'), 'spacious');

    let remountCalls = [];
    let remount = mountWorkspace(mounted.config, createContainer(), {
      themeAdapter: createThemeAdapter(remountCalls),
    });
    let remountPreview = remount.element.ownerDocument.createElement('section');
    remountPreview.className = 'preview';
    remount.element.appendChild(remountPreview);
    remount.theme = applyWorkspaceTheme(remount.config, remount.element, {
      themeAdapter: createThemeAdapter(remountCalls),
    });

    assert.equal(remount.element.style.getPropertyValue('--sn-theme-register'), 'tool');
    assert.equal(remountPreview.style.getPropertyValue('--sn-theme-register'), 'spacious');
    assert.ok(remountCalls.some((call) => call.type === 'geometry' && call.register === 'tool'));
    assert.ok(remountCalls.some((call) => call.type === 'geometry' && call.register === 'spacious'));
  });

  it('exposes missing panel modules and only fails when strict components are enabled', () => {
    let emptyCatalog = { has: () => false, list: () => [] };
    let mounted = mountWorkspace(workspace(), createContainer(), {
      catalog: emptyCatalog,
    });

    assert.deepEqual(mounted.loaderResult.missingComponents, ['sn-main-panel']);
    assert.ok(mounted.loaderResult.warnings.some((warning) => warning.path === 'components'));

    assert.throws(() => mountWorkspace(workspace(), createContainer(), {
      catalog: emptyCatalog,
      strictComponents: true,
    }), /Missing components: sn-main-panel/);
  });

  it('renders portable split layouts and panel previews without a runtime controller', () => {
    let mounted = mountWorkspace(workspace({
      name: 'Visual Demo',
      layouts: {
        main: {
          kind: 'bsp',
          root: {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.65,
            first: { type: 'panel', id: 'timeline-node', panel: 'timeline' },
            second: { type: 'panel', id: 'preview-node', panel: 'preview' },
          },
        },
      },
      panels: {
        timeline: {
          title: 'Timeline',
          module: 'sn-video-timeline',
          slots: [{ id: 'tracks', role: 'content' }],
        },
        preview: {
          title: 'Preview',
          module: 'sn-video-preview',
        },
      },
    }), createContainer());

    let panels = mounted.element.querySelectorAll('.symbiote-workspace__panel');
    let split = mounted.element.querySelectorAll('.symbiote-workspace__split')[0];

    assert.equal(panels.length, 2);
    assert.equal(split.dataset.direction, 'horizontal');
    assert.equal(split.style.getPropertyValue('display'), 'flex');
    assert.equal(split.style.getPropertyValue('flex-direction'), 'row');
    assert.equal(split.style.getPropertyValue('--symbiote-workspace-preview-ratio'), '0.65');
    assert.equal(panels[0].style.getPropertyValue('border-radius'), '8px');
    assert.equal(panels[0].style.getPropertyValue('min-height'), '8rem');
    assert.equal(panels[0].dataset.panel, 'timeline');
    assert.equal(panels[0].dataset.component, 'sn-video-timeline');
    assert.equal(panels[0].children[0].textContent, 'Timeline');
    assert.equal(panels[0].querySelectorAll('.symbiote-workspace__panel-slot')[0].dataset.slotId, 'tracks');
    assert.equal(panels[1].dataset.panel, 'preview');
    assert.equal(panels[1].children[0].textContent, 'Preview');
  });

  it('updates the mounted default preview without replacing the workspace wrapper', () => {
    let mounted = mountWorkspace(workspace(), createContainer());
    let wrapper = mounted.element;
    let initialPanel = mounted.element.querySelectorAll('.symbiote-workspace__panel')[0];

    mounted.updateConfig(workspace({
      name: 'Updated Workspace',
      panels: {
        preview: { module: 'sn-video-preview', title: 'Preview' },
      },
      layouts: {
        main: {
          kind: 'bsp',
          root: { type: 'panel', id: 'preview-panel', panel: 'preview' },
        },
      },
      theme: {
        overrides: { '--sn-panel-bg': 'black' },
      },
    }), { baseRevision: 0 });

    let updatedPanel = mounted.element.querySelectorAll('.symbiote-workspace__panel')[0];
    assert.equal(mounted.element, wrapper);
    assert.notEqual(updatedPanel, initialPanel);
    assert.equal(mounted.config.name, 'Updated Workspace');
    assert.equal(mounted.element.dataset.workspaceName, 'Updated Workspace');
    assert.equal(updatedPanel.dataset.panel, 'preview');
    assert.equal(updatedPanel.dataset.component, 'sn-video-preview');
    assert.equal(mounted.element.style.getPropertyValue('--sn-panel-bg'), 'black');
  });

  it('delegates mounted updates to runtime handles without destroying them', () => {
    let destroyCalls = 0;
    let updates = [];
    let mounted = mountWorkspace(workspace({ name: 'Runtime Workspace' }), createContainer(), {
      runtimeController: {
        mountWorkspace() {
          return {
            updateConfig(update) {
              updates.push(update);
            },
            destroy() {
              destroyCalls += 1;
            },
          };
        },
      },
    });

    let wrapper = mounted.element;
    mounted.updateConfig(workspace({ name: 'Runtime Workspace Updated' }), { baseRevision: 0 });

    assert.equal(mounted.element, wrapper);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].config.name, 'Runtime Workspace Updated');
    assert.equal(updates[0].previousConfig.name, 'Runtime Workspace');
    assert.equal(destroyCalls, 0);

    mounted.destroy();
    assert.equal(destroyCalls, 1);
  });

  it('delegates mounted updates to runtime controllers with the controller context', () => {
    let updates = [];
    let controller = {
      name: 'controller',
      mountWorkspace() {
        return {};
      },
      updateConfig(update) {
        updates.push({
          thisValue: this,
          update,
        });
      },
    };
    let mounted = mountWorkspace(workspace({ name: 'Controller Workspace' }), createContainer(), {
      runtimeController: controller,
    });

    mounted.updateConfig(workspace({ name: 'Controller Workspace Updated' }), { baseRevision: 0 });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].thisValue, controller);
    assert.equal(updates[0].update.config.name, 'Controller Workspace Updated');
    assert.equal(updates[0].update.previousConfig.name, 'Controller Workspace');
  });

  it('rejects invalid mounted updates before mutating the existing workspace', () => {
    let mounted = mountWorkspace(workspace(), createContainer());
    let wrapper = mounted.element;
    let panel = wrapper.querySelectorAll('.symbiote-workspace__panel')[0];

    assert.throws(() => mounted.updateConfig(workspace({
      panels: {
        main: { module: 'sn-main-panel', title: 'Main' },
      },
    }), {
      baseRevision: 0,
      catalog: { has: () => false, list: () => [] },
      strictComponents: true,
    }), /Missing components: sn-main-panel/);

    assert.equal(mounted.element, wrapper);
    assert.equal(mounted.config.name, 'Mounted Workspace');
    assert.equal(wrapper.dataset.workspaceName, 'Mounted Workspace');
    assert.equal(wrapper.querySelectorAll('.symbiote-workspace__panel')[0], panel);
  });

  it('applies validated workspace patches through the mounted update contract', async () => {
    let mounted = mountWorkspace(workspace({ name: 'Patch Workspace' }), createContainer());
    let wrapper = mounted.element;

    let result = await mounted.applyPatch({
      overlay: {
        name: 'Patched Workspace',
        panels: {
          preview: { module: 'sn-video-preview', title: 'Preview' },
        },
        layouts: {
          main: {
            kind: 'bsp',
            root: { type: 'panel', id: 'preview-panel', panel: 'preview' },
          },
        },
      },
    }, { baseRevision: 0 });

    assert.equal(result.status, 'ok');
    assert.equal(result.mounted, mounted);
    assert.equal(result.commit.revision, 1);
    assert.equal(mounted.element, wrapper);
    assert.equal(mounted.config.name, 'Patched Workspace');
    assert.equal(wrapper.dataset.workspaceName, 'Patched Workspace');
    assert.equal(
      wrapper.querySelectorAll('.symbiote-workspace__panel')[0].dataset.panel,
      'preview'
    );
  });

  it('applies workspace patches through runtime updates without navigation or remounting', async () => {
    let container = createContainer();
    let history = container.ownerDocument.defaultView.history;
    let initialHistoryLength = history.length;
    let destroyCalls = 0;
    let runtimeUpdates = [];
    let runtimeElement;

    let mounted = mountWorkspace(workspace({ name: 'Realtime Patch Workspace' }), container, {
      runtimeController: {
        mountWorkspace({ element }) {
          runtimeElement = element.ownerDocument.createElement('panel-layout');
          runtimeElement.dataset.runtimeInstanceId = 'runtime-1';
          runtimeElement.dataset.atomicUpdateCount = '0';
          element.dataset.runtimeInstanceId = runtimeElement.dataset.runtimeInstanceId;
          element.dataset.atomicUpdateCount = '0';
          element.appendChild(runtimeElement);
          return {
            updateConfig(update) {
              runtimeUpdates.push(update);
              let updateCount = Number(runtimeElement.dataset.atomicUpdateCount || '0') + 1;
              runtimeElement.dataset.atomicUpdateCount = String(updateCount);
              runtimeElement.dataset.lastUpdateReason = update.reason || '';
              runtimeElement.dataset.lastUpdatedStage = update.stage?.id || '';
              update.element.dataset.runtimeInstanceId = runtimeElement.dataset.runtimeInstanceId;
              update.element.dataset.atomicUpdateCount = String(updateCount);
              update.element.dataset.lastUpdatedStage = update.stage?.id || '';
            },
            destroy() {
              destroyCalls += 1;
            },
          };
        },
      },
    });
    let wrapper = mounted.element;

    let result = await mounted.applyPatch({
      overlay: {
        name: 'Realtime Patch Workspace Updated',
        panels: {
          preview: { module: 'sn-video-preview', title: 'Preview' },
        },
        layouts: {
          main: {
            kind: 'bsp',
            root: { type: 'panel', id: 'preview-panel', panel: 'preview' },
          },
        },
      },
    }, {
      baseRevision: 0,
      stage: { id: 'validation' },
    });

    assert.equal(result.status, 'ok');
    assert.equal(result.mounted, mounted);
    assert.equal(mounted.element, wrapper);
    assert.equal(container.children[0], wrapper);
    assert.equal(runtimeElement.parentElement, wrapper);
    assert.equal(runtimeElement.dataset.runtimeInstanceId, 'runtime-1');
    assert.equal(runtimeElement.dataset.atomicUpdateCount, '1');
    assert.equal(runtimeElement.dataset.lastUpdatedStage, 'validation');
    assert.equal(wrapper.dataset.runtimeInstanceId, 'runtime-1');
    assert.equal(wrapper.dataset.atomicUpdateCount, '1');
    assert.equal(wrapper.dataset.lastUpdatedStage, 'validation');
    assert.equal(mounted.config.name, 'Realtime Patch Workspace Updated');
    assert.equal(runtimeUpdates.length, 1);
    assert.equal(runtimeUpdates[0].reason, 'applyPatch');
    assert.equal(runtimeElement.dataset.lastUpdateReason, 'applyPatch');
    assert.equal(runtimeUpdates[0].previousConfig.name, 'Realtime Patch Workspace');
    assert.equal(destroyCalls, 0);
    assert.equal(history.length, initialHistoryLength);
  });

  it('preserves theme writeback across mounted runtime updates', () => {
    let destroyCalls = 0;
    let runtimeElement;
    let themeChanges = [];

    let mounted = mountWorkspace(workspace({
      name: 'Theme Runtime Workspace',
      theme: { params: { mode: 'light', hue: 220 } },
    }), createContainer(), {
      themeAdapter: createThemeAdapter(),
      onThemeChange: (change) => themeChanges.push(change),
      runtimeController: {
        mountWorkspace({ element }) {
          runtimeElement = element.ownerDocument.createElement('panel-layout');
          element.appendChild(runtimeElement);
          return {
            updateConfig({ config: nextConfig, element }) {
              runtimeElement.dataset.updatedThemeMode = nextConfig.theme?.params?.mode || '';
              element.dataset.updatedThemeMode = runtimeElement.dataset.updatedThemeMode;
            },
            destroy() {
              destroyCalls += 1;
            },
          };
        },
      },
    });
    let wrapper = mounted.element;

    wrapper.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: {
        state: { mode: 'dark', hue: 180 },
        targetSelector: null,
      },
    });
    assert.deepEqual(mounted.config.theme.params, {
      mode: 'dark',
      hue: 180,
    });

    mounted.updateConfig(workspace({
      ...mounted.config,
      name: 'Theme Runtime Workspace Updated',
      theme: { params: { ...mounted.config.theme.params, density: 92 } },
    }), {
      baseRevision: mounted.revision,
      stage: { id: 'builder' },
      reason: 'realtime-stage',
    });
    assert.deepEqual(mounted.config.theme.params, {
      mode: 'dark',
      hue: 180,
      density: 92,
    });

    wrapper.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: {
        state: { mode: 'contrast', hue: 90 },
        targetSelector: null,
      },
    });

    assert.equal(mounted.element, wrapper);
    assert.equal(runtimeElement.parentElement, wrapper);
    assert.equal(runtimeElement.dataset.updatedThemeMode, 'contrast');
    assert.equal(wrapper.dataset.updatedThemeMode, 'contrast');
    assert.equal(mounted.config.name, 'Theme Runtime Workspace Updated');
    assert.deepEqual(mounted.config.theme.params, {
      mode: 'contrast',
      hue: 90,
      density: 92,
    });
    assert.equal(themeChanges.length, 2);
    assert.equal(themeChanges[0].state.mode, 'dark');
    assert.equal(themeChanges[1].state.mode, 'contrast');
    assert.equal(destroyCalls, 0);
  });

  it('cleans up runtime handles and stops writeback after destroy', () => {
    let config = workspace({
      theme: { params: { hue: 220 } },
    });
    let destroyCalls = 0;

    let mounted = mountWorkspace(config, createContainer(), {
      themeAdapter: createThemeAdapter(),
      runtimeController: {
        mountWorkspace() {
          return {
            destroy() {
              destroyCalls += 1;
            },
          };
        },
      },
    });

    mounted.destroy();
    mounted.element.dispatchEvent({
      type: 'cascade-theme-change',
      bubbles: true,
      detail: { state: { hue: 90 }, targetSelector: null },
    });

    assert.equal(destroyCalls, 1);
    assert.equal(mounted.element.parentElement, null);
    assert.equal(config.theme.params.hue, 220);
  });
});
