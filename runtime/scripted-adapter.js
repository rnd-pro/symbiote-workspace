/**
 * Scripted construction adapter + in-memory trace sink.
 *
 * A scripted adapter replays a declarative `plan` (a sequence of {@link Step}s)
 * deterministically, with no model and no network. It satisfies the same
 * {@link ConstructionAgent} contract an LLM-backed adapter would, so the
 * construction loop can be driven offline and in tests by encoding the same
 * knowledge the visual demo's per-class variants encode: classify → answer each
 * construction question → plan → construct → the workspace-shaping calls → export.
 *
 * The in-memory trace sink collects every emitted message and auto-resolves
 * confirms, so the deterministic loop never blocks even though most shaping tools
 * mutate and therefore pass through the confirm policy.
 *
 * @module symbiote-workspace/runtime/scripted-adapter
 */

/**
 * Create an adapter that replays a fixed plan of construction steps.
 *
 * The plan is a flat array of {@link import('./construction-agent.js').Step}
 * objects. `nextStep` returns plan[i++] each turn; once the plan is exhausted it
 * yields a `done` step so the loop terminates cleanly even if the plan omits an
 * explicit terminal step.
 *
 * A tool step may carry a non-contract `resolveArgs(ctx, baseArgs)` function to
 * thread state from prior turns (e.g. the live questionnaire array that
 * `answer_construction_question` needs) into its args. The adapter calls it
 * against the read-only ctx and strips it before yielding, so the emitted step
 * stays on-contract.
 *
 * @param {Array<Object>} plan
 * @returns {import('./construction-agent.js').ConstructionAgent & { index: number, plan: Array }}
 */
export function createScriptedAdapter(plan) {
  if (!Array.isArray(plan)) {
    throw new Error('createScriptedAdapter requires a plan array.');
  }
  let steps = plan.slice();
  let adapter = {
    plan: steps,
    index: 0,
    async nextStep(ctx) {
      if (adapter.index >= steps.length) {
        return { type: 'done', display: 'Plan complete.' };
      }
      let entry = steps[adapter.index++];
      if (entry.type !== 'tool' || typeof entry.resolveArgs !== 'function') return entry;
      let { resolveArgs, ...step } = entry;
      return { ...step, args: resolveArgs(ctx, entry.args || {}) };
    },
  };
  return adapter;
}

/**
 * Create an in-memory trace sink for offline/test runs.
 *
 * - `emit(msg)` collects every message into `messages`.
 * - `confirm()` auto-resolves to `{ action: 'confirm' }` so the deterministic
 *   loop is never blocked by the mutating-tool confirm policy.
 *
 * @param {Object} [options]
 * @param {{action: string}} [options.confirmDecision] - Override the confirm verdict.
 * @returns {{ messages: object[], confirms: object[], emit: (msg: object) => void, confirm: (req: object) => Promise<{action: string}> }}
 */
export function createMemoryTrace({ confirmDecision = { action: 'confirm' } } = {}) {
  let messages = [];
  let confirms = [];
  return {
    messages,
    confirms,
    emit(message) {
      messages.push(message);
    },
    async confirm(request) {
      confirms.push(request);
      return confirmDecision;
    },
  };
}

/**
 * Build a deterministic construction plan from the same per-variant knowledge the
 * visual demo encodes. The returned plan drives the loop through the full
 * pipeline: the construction protocol (classify → questions → answers → plan →
 * construct), the demo's workspace-shaping calls (register chat panel, dock chat
 * right, chat + per-panel behaviors, root reflow), and export.
 *
 * This mirrors `examples/visual-demo/chat-builder-state.js#buildVariant` step
 * order so a scripted run yields the SAME constructed config the demo produces.
 *
 * @param {Object} input
 * @param {string|Object} input.intent
 * @param {string} input.template
 * @param {string} [input.name] - Workspace label used in shaping (cosmetic).
 * @param {Array<[string, *]>} input.answers - Ordered [questionId, answer] pairs.
 * @param {Object} [input.extras] - Construction extras (workspaceTemplates, moduleCapabilities, requiredCapabilities).
 * @param {Object} input.chat - { panel, component, behavior }.
 * @param {Object} input.dock - { layoutTree } horizontal split docking chat right.
 * @param {Array<{target: string, behavior: Object}>} input.panelBehaviors - Per-panel + chat behaviors.
 * @param {Object} input.rootBehavior - update_layout_behavior payload.
 * @returns {import('./construction-agent.js').Step[]}
 */
export function buildConstructionPlan(input) {
  let {
    intent,
    template,
    answers = [],
    extras = {},
    chat,
    dock,
    panelBehaviors = [],
    rootBehavior,
  } = input;

  /** @type {import('./construction-agent.js').Step[]} */
  let plan = [];

  plan.push({
    type: 'tool',
    toolName: 'classify_workspace',
    args: { intent, ...extras },
    display: 'Classifying the workspace intent.',
  });
  plan.push({
    type: 'tool',
    toolName: 'build_construction_questions',
    args: { intent, template, ...extras },
    display: 'Building the construction questionnaire.',
  });

  let answerObject = {};
  for (let [questionId, answer] of answers) {
    if (answer === undefined) continue;
    answerObject[questionId] = answer;
    plan.push({
      type: 'tool',
      toolName: 'answer_construction_question',
      args: { questionId, answer },
      // Thread the live questionnaire from the previous turn's result, exactly as
      // the demo threads its evolving `questionnaire` array between answers.
      resolveArgs(ctx, baseArgs) {
        let questions = Array.isArray(ctx.lastResult?.questions) ? ctx.lastResult.questions : [];
        return { ...baseArgs, questions };
      },
      display: `Answering ${questionId}.`,
    });
  }

  plan.push({
    type: 'tool',
    toolName: 'plan_workspace',
    args: { intent, template, answers: answerObject, ...extras },
    display: 'Planning the workspace construction.',
  });
  plan.push({
    type: 'tool',
    toolName: 'construct_workspace',
    args: { intent, template, answers: answerObject, ...extras },
    display: 'Constructing the workspace from the template.',
  });

  // ── Workspace-shaping calls (mirror the demo's buildVariant) ──
  if (chat) {
    plan.push({
      type: 'tool',
      toolName: 'register_panel_type',
      args: { name: chat.panel, title: 'Chat', icon: 'chat', component: chat.component },
      display: 'Registering the chat panel type.',
    });
  }
  if (dock) {
    plan.push({
      type: 'tool',
      toolName: 'set_layout',
      args: { layoutTree: dock.layoutTree },
      display: 'Docking the chat on the right.',
    });
  }
  for (let { target, behavior } of panelBehaviors) {
    plan.push({
      type: 'tool',
      toolName: 'set_behavior',
      args: { target, behavior },
      display: `Setting behavior for ${target}.`,
    });
  }
  if (rootBehavior) {
    plan.push({
      type: 'tool',
      toolName: 'update_layout_behavior',
      args: { behavior: rootBehavior },
      display: 'Setting the root reflow policy.',
    });
  }

  plan.push({
    type: 'tool',
    toolName: 'export_config',
    args: { strict: true },
    display: 'Exporting the portable config.',
  });
  plan.push({ type: 'done', display: 'Workspace constructed and exported.' });

  return plan;
}
