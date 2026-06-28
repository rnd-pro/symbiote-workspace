/**
 * Construction-loop proof.
 *
 * Drives runConstructionLoop with a scripted adapter through the real
 * construction protocol (classify → build questions → answer → plan → construct
 * → export) plus the workspace-shaping calls the visual demo makes, and asserts:
 *   - a valid, portable config results;
 *   - confirm() is invoked only for mutating tools (per toolConfirmPolicy);
 *   - tool results are envelope-wrapped in history;
 *   - a scripted run yields the SAME constructed config the direct dispatch path
 *     produces from the same args (loop is a faithful driver, not a rewrite);
 *   - the loop-guard terminates on no-progress and on maxSteps;
 *   - a dispatch error status is surfaced and fed back so an adapter can
 *     self-correct, and a repeated error aborts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSession, dispatch } from '../runtime/index.js';
import { validateWorkspaceConfig } from '../schema/index.js';
import { importConfig } from '../sharing/index.js';
import { runConstructionLoop } from '../runtime/agent-loop.js';
import { isToolResultEnvelope } from '../runtime/tool-result.js';
import { isDataChangeMessage } from '../runtime/data-change.js';
import {
  createScriptedAdapter,
  createMemoryTrace,
  buildConstructionPlan,
} from '../runtime/scripted-adapter.js';

const CHAT_PANEL = 'chat';
const CHAT_COMPONENT = 'chat-workspace';
const CHAT_BEHAVIOR = {
  collapse: 'manual', importance: 100, minInlineSize: 360, minBlockSize: 320,
  overflow: 'scroll-block', responsiveMode: 'stack', responsiveBreakpoint: 760,
};
const ROOT_BEHAVIOR = { responsiveMode: 'stack', responsiveBreakpoint: 760 };

const INTENT = 'agent programming workspace with source editor, diff and dependency graph';
const TEMPLATE = 'editor';
/** The demo's programming/standard variant answers (probed from the live demo). */
const ANSWERS = [
  ['module-selection', ['files', 'source', 'preview']],
  ['target-register', 'tool'],
  ['layout-topology', 'workbench'],
  ['theme-mode', 'light'],
];

function layoutPanels(node, acc = []) {
  if (!node) return acc;
  if (node.type === 'panel') acc.push(node.panelType);
  else if (node.type === 'split') { layoutPanels(node.first, acc); layoutPanels(node.second, acc); }
  return acc;
}

/**
 * Run the demo's exact shaping pipeline directly through dispatch and return the
 * resulting session config and the docking layout + per-panel behaviors used, so
 * the scripted plan can be built from the SAME shaping and compared.
 */
async function constructDirect() {
  let session = createSession();
  let answerObject = Object.fromEntries(ANSWERS);

  await dispatch('classify_workspace', { intent: INTENT }, session);
  await dispatch('build_construction_questions', { intent: INTENT, template: TEMPLATE }, session);
  for (let [questionId, answer] of ANSWERS) {
    await dispatch('answer_construction_question', { questions: [], questionId, answer }, session);
  }
  await dispatch('plan_workspace', { intent: INTENT, template: TEMPLATE, answers: answerObject }, session);
  await dispatch('construct_workspace', { intent: INTENT, template: TEMPLATE, answers: answerObject }, session);

  let workspacePanels = layoutPanels(session.config.layout);

  await dispatch('register_panel_type', {
    name: CHAT_PANEL, title: 'Chat', icon: 'chat', component: CHAT_COMPONENT,
  }, session);
  let constructedLayout = structuredClone(session.config.layout);
  let dockLayout = {
    type: 'split', direction: 'horizontal', ratio: 0.64,
    first: constructedLayout,
    second: { type: 'panel', panelType: CHAT_PANEL, panelState: {} },
  };
  await dispatch('set_layout', { layoutTree: dockLayout }, session);

  // Per-panel behaviors: read the demo's actual constructed values so the plan
  // and the direct path stay byte-identical without re-deriving roles here.
  let panelBehaviors = [{ target: CHAT_PANEL, behavior: CHAT_BEHAVIOR }];
  await dispatch('set_behavior', { target: CHAT_PANEL, behavior: CHAT_BEHAVIOR }, session);
  for (let panelType of workspacePanels) {
    let behavior = session.config.panelTypes[panelType].behavior;
    panelBehaviors.push({ target: panelType, behavior });
  }
  await dispatch('update_layout_behavior', { behavior: ROOT_BEHAVIOR }, session);

  return { config: session.config, dockLayout, panelBehaviors };
}

describe('runConstructionLoop — full construction pipeline', () => {
  it('drives classify→questions→answers→plan→construct→shape→export to a valid portable config', async () => {
    let direct = await constructDirect();

    let plan = buildConstructionPlan({
      intent: INTENT,
      template: TEMPLATE,
      answers: ANSWERS,
      chat: { panel: CHAT_PANEL, component: CHAT_COMPONENT, behavior: CHAT_BEHAVIOR },
      dock: { layoutTree: direct.dockLayout },
      panelBehaviors: direct.panelBehaviors,
      rootBehavior: ROOT_BEHAVIOR,
    });

    let session = createSession();
    let trace = createMemoryTrace();
    let adapter = createScriptedAdapter(plan);

    let { config, history, stoppedReason } = await runConstructionLoop({
      adapter, session, dispatch, trace, intent: INTENT,
    });

    assert.equal(stoppedReason, 'exported');

    // A valid, portable config results.
    let validation = validateWorkspaceConfig(config);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
    assert.deepEqual(layoutPanels(config.layout), ['files', 'source', 'preview', 'chat']);

    // The scripted run yields the SAME constructed config the direct path makes.
    assert.deepEqual(config, direct.config);

    // The exported envelope carried portable JSON that round-trips.
    let exportEntry = history.at(-1);
    assert.equal(exportEntry.toolName, 'export_config');
    let exportedJson = exportEntry.envelope.data.json;
    assert.ok(importConfig(exportedJson).config, 'exported JSON imports to a config');
  });

  it('envelope-wraps every tool result in history', async () => {
    let direct = await constructDirect();
    let plan = buildConstructionPlan({
      intent: INTENT, template: TEMPLATE, answers: ANSWERS,
      chat: { panel: CHAT_PANEL, component: CHAT_COMPONENT, behavior: CHAT_BEHAVIOR },
      dock: { layoutTree: direct.dockLayout },
      panelBehaviors: direct.panelBehaviors, rootBehavior: ROOT_BEHAVIOR,
    });
    let session = createSession();
    let trace = createMemoryTrace();
    let { history } = await runConstructionLoop({
      adapter: createScriptedAdapter(plan), session, dispatch, trace, intent: INTENT,
    });

    for (let entry of history) {
      assert.ok(isToolResultEnvelope(entry.envelope), `${entry.toolName} result not an envelope`);
      assert.equal(typeof entry.envelope.summary, 'string');
      assert.ok(Array.isArray(entry.envelope.warnings));
    }
    // The trace emitted a tool_result envelope part for each tool call.
    let toolResultParts = trace.messages.flatMap((m) => (m.parts || []))
      .filter((p) => p.type === 'tool_result');
    assert.equal(toolResultParts.length, history.length);
    for (let part of toolResultParts) assert.ok(isToolResultEnvelope(part.result));
  });

  it('invokes confirm() only for mutating tools, per toolConfirmPolicy', async () => {
    let direct = await constructDirect();
    let plan = buildConstructionPlan({
      intent: INTENT, template: TEMPLATE, answers: ANSWERS,
      chat: { panel: CHAT_PANEL, component: CHAT_COMPONENT, behavior: CHAT_BEHAVIOR },
      dock: { layoutTree: direct.dockLayout },
      panelBehaviors: direct.panelBehaviors, rootBehavior: ROOT_BEHAVIOR,
    });
    let session = createSession();
    let trace = createMemoryTrace();
    let { history } = await runConstructionLoop({
      adapter: createScriptedAdapter(plan), session, dispatch, trace, intent: INTENT,
    });

    let mutatingCalls = history.filter((e) => ['construct_workspace', 'register_panel_type', 'set_layout', 'set_behavior', 'update_layout_behavior'].includes(e.toolName));
    let readOnlyCalls = history.filter((e) => ['classify_workspace', 'build_construction_questions', 'answer_construction_question', 'plan_workspace', 'export_config'].includes(e.toolName));

    // One confirm per mutating tool call; no confirm for read-only ones.
    assert.equal(trace.confirms.length, mutatingCalls.length);
    let confirmedTools = new Set(trace.confirms.map((c) => c.toolName));
    for (let entry of readOnlyCalls) assert.ok(!confirmedTools.has(entry.toolName), `${entry.toolName} should not be confirmed`);
    for (let entry of mutatingCalls) assert.ok(confirmedTools.has(entry.toolName), `${entry.toolName} should be confirmed`);
  });

  it('broadcasts a data-change for mutating/file-writing tools when a broadcast sink is provided', async () => {
    let direct = await constructDirect();
    let plan = buildConstructionPlan({
      intent: INTENT, template: TEMPLATE, answers: ANSWERS,
      chat: { panel: CHAT_PANEL, component: CHAT_COMPONENT, behavior: CHAT_BEHAVIOR },
      dock: { layoutTree: direct.dockLayout },
      panelBehaviors: direct.panelBehaviors, rootBehavior: ROOT_BEHAVIOR,
    });
    let session = createSession();
    let trace = createMemoryTrace();
    let broadcasts = [];
    await runConstructionLoop({
      adapter: createScriptedAdapter(plan), session, dispatch, trace,
      broadcast: (msg) => broadcasts.push(msg), intent: INTENT,
    });

    assert.ok(broadcasts.length > 0);
    for (let msg of broadcasts) assert.ok(isDataChangeMessage(msg));
    // No data-change for the read-only export_config.
    assert.ok(broadcasts.every((m) => m.payload.payload.tool !== 'export_config'));
  });
});

describe('runConstructionLoop — confirm denial', () => {
  it('aborts with a confirm-denied reason when a mutating tool is denied', async () => {
    let plan = [
      { type: 'tool', toolName: 'classify_workspace', args: { intent: INTENT } },
      { type: 'tool', toolName: 'construct_workspace', args: { intent: INTENT, template: TEMPLATE } },
    ];
    let session = createSession();
    let trace = createMemoryTrace({ confirmDecision: { action: 'deny' } });
    let { stoppedReason, history } = await runConstructionLoop({
      adapter: createScriptedAdapter(plan), session, dispatch, trace, intent: INTENT,
    });
    assert.match(stoppedReason, /confirm-denied: construct_workspace/);
    // classify ran (read-only, auto), construct never dispatched.
    assert.deepEqual(history.map((e) => e.toolName), ['classify_workspace']);
  });
});

describe('runConstructionLoop — error surfacing and self-correction', () => {
  it('surfaces a dispatch error status in the envelope and feeds it back via lastResult', async () => {
    // First a tool that errors (missing config), then the adapter self-corrects.
    let seen = [];
    let adapter = {
      async nextStep(ctx) {
        seen.push({ step: seen.length, lastStatus: ctx.lastResult?.status, lastNextAction: ctx.lastNextAction });
        if (seen.length === 1) {
          // add_group with no active config → dispatch returns status:'error'.
          return { type: 'tool', toolName: 'add_group', args: { id: 'g', name: 'G' } };
        }
        if (seen.length === 2) {
          // Self-correct: classify is read-only and always ok.
          return { type: 'tool', toolName: 'classify_workspace', args: { intent: INTENT } };
        }
        return { type: 'done' };
      },
    };
    let session = createSession();
    let trace = createMemoryTrace();
    let { history, stoppedReason } = await runConstructionLoop({
      adapter, session, dispatch, trace, intent: INTENT,
    });

    assert.equal(stoppedReason, 'done');
    assert.equal(history[0].toolName, 'add_group');
    assert.equal(history[0].status, 'error');
    assert.ok(history[0].envelope.summary.length > 0);
    // The error was fed back to the next turn.
    assert.equal(seen[1].lastStatus, 'error');
    // After self-correction the second call succeeded.
    assert.equal(history[1].toolName, 'classify_workspace');
    assert.equal(history[1].status, 'ok');
  });

  it('aborts after repeated errors (errorLimit)', async () => {
    let adapter = {
      async nextStep() {
        return { type: 'tool', toolName: 'add_group', args: { id: 'g', name: 'G' } };
      },
    };
    let session = createSession();
    let trace = createMemoryTrace();
    let { stoppedReason, history } = await runConstructionLoop({
      adapter, session, dispatch, trace, errorLimit: 3,
    });
    assert.match(stoppedReason, /repeated-error/);
    assert.equal(history.length, 3);
  });
});

describe('runConstructionLoop — loop guards', () => {
  it('terminates on no-progress: same tool repeated with config unchanged', async () => {
    // validate_config is read-only (no confirm), never mutates config → no progress.
    let adapter = {
      async nextStep() {
        return { type: 'tool', toolName: 'validate_config', args: {} };
      },
    };
    let session = createSession();
    session.config = {
      version: '0.2.0', name: 'WS', register: 'tool', groups: [], sections: [],
      panelTypes: { default: { title: 'D', component: 'sn-data-table' } }, layouts: {},
      layout: { type: 'panel', panelType: 'default' }, events: [], components: { catalog: [] },
    };
    let trace = createMemoryTrace();
    let { stoppedReason, history } = await runConstructionLoop({
      adapter, session, dispatch, trace, noProgressLimit: 3,
    });
    assert.match(stoppedReason, /no-progress: validate_config/);
    assert.equal(history.length, 3);
  });

  it('terminates when maxSteps is exceeded', async () => {
    // An adapter that only ever emits messages never reaches a terminal step.
    let adapter = {
      async nextStep() {
        return { type: 'message', display: 'thinking…' };
      },
    };
    let session = createSession();
    let trace = createMemoryTrace();
    let { stoppedReason } = await runConstructionLoop({
      adapter, session, dispatch, trace, maxSteps: 5,
    });
    assert.match(stoppedReason, /max-steps \(5\) exceeded/);
    assert.equal(trace.messages.length, 5);
  });
});

describe('runConstructionLoop — invalid adapter output', () => {
  it('stops when the adapter returns an off-contract step', async () => {
    let adapter = {
      async nextStep() {
        return { type: 'tool', toolName: 'does_not_exist' };
      },
    };
    let session = createSession();
    let trace = createMemoryTrace();
    let { stoppedReason } = await runConstructionLoop({ adapter, session, dispatch, trace });
    assert.match(stoppedReason, /adapter error/);
  });
});
