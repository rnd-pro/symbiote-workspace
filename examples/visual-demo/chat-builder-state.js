/**
 * Chat-first, questionnaire-driven construction driver.
 *
 * Each workspace class is built by driving the REAL construction protocol
 * through `dispatch(tool, args, session)`: the system classifies the intent and
 * offers a questionnaire, the agent SELECTS from the offered options, and the
 * system places panels from its canonical template into `session.config`. No
 * hand-authored panel placement — the layout is whatever the template produces.
 *
 * After construction the workspace is wrapped so the chat lives as a global
 * RIGHT panel at full height (withChat-style), exactly as the real agent-portal
 * docks a persistent conversation beside a constructed workspace.
 *
 * @module examples/visual-demo/chat-builder-state
 */

import { createSession, dispatch } from '../../runtime/index.js';

/** Panel-type name for the persistent chat region. */
export const CHAT_PANEL = 'chat';
/** symbiote-ui component tag mounted into the chat region. */
export const CHAT_COMPONENT = 'chat-workspace';

/**
 * Workspace classes to construct. Each drives one session through the real
 * construction protocol; the live-verified template is recorded for reference.
 * @type {Array<{key: string, label: string, intent: string, template: string}>}
 */
const SCENARIOS = [
  {
    key: 'programming',
    label: 'Programming',
    intent: 'agent programming workspace with source editor, diff and dependency graph',
    template: 'editor',
  },
  {
    key: 'video',
    label: 'Video',
    intent: 'media studio for video editing with timeline and preview',
    template: 'video-studio',
  },
  {
    key: 'automation',
    label: 'Automation',
    intent: 'automation workspace for workflow approvals and process queues',
    template: 'social-automation',
  },
];

/** Behavior preset for the persistent chat: always present, full height, on the right. */
const CHAT_BEHAVIOR = {
  collapse: 'never',
  importance: 100,
  minInlineSize: 360,
  minBlockSize: 320,
  overflow: 'scroll-block',
  responsiveMode: 'stack',
  responsiveBreakpoint: 760,
};

/** agent-portal behavior presets keyed by the role a constructed panel plays. */
const ROLE_BEHAVIORS = {
  primary: {
    importance: 95, minInlineSize: 520, minBlockSize: 320,
    collapse: 'never', overflow: 'scroll-inline',
    responsiveMode: 'scroll-inline', responsiveBreakpoint: 860,
  },
  board: {
    importance: 88, minInlineSize: 480, minBlockSize: 320,
    collapse: 'never', overflow: 'scroll-inline',
    responsiveMode: 'scroll-inline', responsiveBreakpoint: 860,
  },
  secondary: {
    importance: 68, minInlineSize: 320, minBlockSize: 260,
    collapse: 'auto', overflow: 'scroll-block',
    responsiveMode: 'stack', responsiveBreakpoint: 760,
  },
};

/** Panel types that read as boards/tables/queues rather than editing surfaces. */
const BOARD_PANELS = new Set([
  'queue', 'workflow', 'timeline', 'node-graph', 'history', 'imports',
]);
/** Panel types that read as side/navigation/inspector surfaces. */
const SECONDARY_PANELS = new Set([
  'files', 'inspector', 'history', 'imports', 'navigation', 'reply',
]);

/**
 * Assign an agent-portal behavior role to a constructed panel.
 * The single most important editing/preview panel becomes `primary`; boards,
 * tables and queues become `board`; navigation and side panels become
 * `secondary`.
 * @param {string} panelType
 * @param {boolean} isPrimary
 * @returns {'primary'|'board'|'secondary'}
 */
function roleFor(panelType, isPrimary) {
  if (isPrimary) return 'primary';
  if (BOARD_PANELS.has(panelType)) return 'board';
  if (SECONDARY_PANELS.has(panelType)) return 'secondary';
  return 'board';
}

/**
 * Collect panel types in layout order from a BSP layout tree.
 * @param {Object|null} node
 * @param {string[]} acc
 * @returns {string[]}
 */
function layoutPanels(node, acc = []) {
  if (!node) return acc;
  if (node.type === 'panel') acc.push(node.panelType);
  else if (node.type === 'split') { layoutPanels(node.first, acc); layoutPanels(node.second, acc); }
  return acc;
}

/**
 * Summarize a config into a small digest for the browser replay.
 * @param {Object|null} config
 * @returns {{panels: string[], panelTypes: string[], pinnedChatRight: boolean, bridges: number}}
 */
function digestConfig(config) {
  if (!config) return { panels: [], panelTypes: [], pinnedChatRight: false, bridges: 0 };
  let root = config.layout;
  let pinnedChatRight = Boolean(
    root
    && root.type === 'split'
    && root.direction === 'horizontal'
    && root.second?.type === 'panel'
    && root.second.panelType === CHAT_PANEL
    && config.panelTypes?.[CHAT_PANEL]?.behavior?.collapse === 'never',
  );
  return {
    panels: layoutPanels(root),
    panelTypes: Object.keys(config.panelTypes || {}),
    pinnedChatRight,
    bridges: (config.events || []).length,
  };
}

/**
 * Require a successful dispatch result or throw with the tool's hint.
 * @param {string} scenarioKey
 * @param {string} tool
 * @param {Object} result
 * @returns {Object}
 */
function requireOk(scenarioKey, tool, result) {
  if (result?.status !== 'ok') {
    throw new Error(`[${scenarioKey}] ${tool} failed: ${result?.hint || JSON.stringify(result)}`);
  }
  return result;
}

/**
 * Drive one workspace class through the real construction protocol and dock the
 * chat on the right.
 * @param {{key: string, label: string, intent: string, template: string}} scenario
 * @returns {Promise<Object>} One scenario entry of the return contract.
 */
async function buildScenario(scenario) {
  let { key, label, intent, template } = scenario;
  let session = createSession();
  let stages = [];

  // 1. The system classifies the intent and names the canonical template.
  let classified = requireOk(key, 'classify_workspace', await dispatch('classify_workspace', { intent }, session));

  // 2. The system builds its questionnaire of offered options.
  let built = requireOk(key, 'build_construction_questions', await dispatch('build_construction_questions', { intent }, session));
  let questionnaire = built.questions;

  // 3. The agent SELECTS from the offered options. At minimum it picks every
  //    offered module; it also confirms the offered register, topology and
  //    theme so the answered set is explicit rather than defaulted.
  let moduleQuestion = questionnaire.find((q) => q.id === 'module-selection');
  let answeredIds = new Set();
  let selections = [
    ['module-selection', moduleQuestion ? moduleQuestion.options.map((o) => o.value) : undefined],
    ['target-register', findOptionDefault(questionnaire, 'target-register')],
    ['layout-topology', findOptionDefault(questionnaire, 'layout-topology')],
    ['theme-mode', findOptionDefault(questionnaire, 'theme-mode')],
  ];
  for (let [questionId, answer] of selections) {
    if (answer === undefined) continue;
    let answered = requireOk(
      key,
      'answer_construction_question',
      await dispatch('answer_construction_question', { questions: questionnaire, questionId, answer }, session),
    );
    questionnaire = answered.questions;
    answeredIds.add(questionId);
  }

  // Collect the answers the system now holds, keyed by question id, to hand to
  // construction so the canonical template is placed from the agent's choices.
  let answers = {};
  for (let q of questionnaire) {
    if (q.answer !== undefined) answers[q.id] = q.answer;
  }

  // Replay seed: a chat-only workspace before the system places any panel.
  let seedSession = createSession();
  requireOk(key, 'scaffold_from_scratch', await dispatch('scaffold_from_scratch', { name: `${label} Console`, register: 'tool' }, seedSession));
  requireOk(key, 'register_panel_type', await dispatch('register_panel_type', {
    name: CHAT_PANEL, title: 'Chat', icon: 'chat', component: CHAT_COMPONENT,
  }, seedSession));
  requireOk(key, 'set_layout', await dispatch('set_layout', {
    layoutTree: { type: 'panel', panelType: CHAT_PANEL, panelState: {} },
  }, seedSession));
  requireOk(key, 'set_behavior', await dispatch('set_behavior', { target: CHAT_PANEL, behavior: CHAT_BEHAVIOR }, seedSession));
  stages.push({
    title: 'Chat-only seed',
    config: cloneConfig(seedSession.config),
    digest: digestConfig(seedSession.config),
  });

  // 4. The system plans, then constructs: it places modules from the canonical
  //    template into session.config. Planning is no-mutation; construction
  //    mutates the session.
  requireOk(key, 'plan_workspace', await dispatch('plan_workspace', { intent, answers }, session));
  let constructed = requireOk(key, 'construct_workspace', await dispatch('construct_workspace', { intent, answers }, session));
  if (constructed.templateName !== template) {
    throw new Error(`[${key}] expected template "${template}" but constructed "${constructed.templateName}"`);
  }
  let workspacePanels = layoutPanels(session.config.layout);

  // 5. Dock the chat on the RIGHT at full height, wrapping the constructed
  //    layout as the LEFT child of a global horizontal split.
  requireOk(key, 'register_panel_type', await dispatch('register_panel_type', {
    name: CHAT_PANEL, title: 'Chat', icon: 'chat', component: CHAT_COMPONENT,
  }, session));
  let constructedLayout = cloneConfig(session.config.layout);
  requireOk(key, 'set_layout', await dispatch('set_layout', {
    layoutTree: {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.64,
      first: constructedLayout,
      second: { type: 'panel', panelType: CHAT_PANEL, panelState: {} },
    },
  }, session));
  requireOk(key, 'set_behavior', await dispatch('set_behavior', { target: CHAT_PANEL, behavior: CHAT_BEHAVIOR }, session));

  // Behavior for each constructed workspace panel: the highest-importance
  // editing/preview panel is primary, boards are board, side panels secondary.
  let primaryPanel = pickPrimaryPanel(session.config, workspacePanels);
  for (let panelType of workspacePanels) {
    let role = roleFor(panelType, panelType === primaryPanel);
    requireOk(key, 'set_behavior', await dispatch('set_behavior', {
      target: panelType, behavior: ROLE_BEHAVIORS[role],
    }, session));
  }
  requireOk(key, 'update_layout_behavior', await dispatch('update_layout_behavior', {
    behavior: { responsiveMode: 'scroll-inline', responsiveBreakpoint: 900 },
  }, session));

  // 6. Validate strict, then export a portable config.
  let validation = await dispatch('validate_config', { strict: true }, session);
  if (validation.valid !== true) {
    throw new Error(`[${key}] strict validation failed: ${JSON.stringify(validation.errors)}`);
  }
  let exported = requireOk(key, 'export_config', await dispatch('export_config', { strict: true }, session));

  stages.push({
    title: 'Constructed workspace with chat docked right',
    config: cloneConfig(session.config),
    digest: digestConfig(session.config),
  });

  let questions = questionnaire
    .filter((q) => q.status !== 'skipped')
    .map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.title,
      options: Array.isArray(q.options)
        ? q.options.map((o) => ({ value: o.value, label: o.label }))
        : [],
      chosen: q.answer,
    }));

  return {
    key,
    label,
    intent,
    template: constructed.templateName,
    classification: classified.intent,
    questions,
    stages,
    config: session.config,
    exportJson: exported.json,
  };
}

/**
 * Read the offered default for a single-select question, if present.
 * @param {Array} questions
 * @param {string} id
 * @returns {string|undefined}
 */
function findOptionDefault(questions, id) {
  let question = questions.find((q) => q.id === id && Array.isArray(q.options) && q.options.length > 0);
  if (!question) return undefined;
  let preferred = question.default ?? question.answer;
  let match = question.options.find((o) => o.value === preferred);
  return (match || question.options[0]).value;
}

/**
 * Pick the primary editing/preview panel: the constructed panel whose template
 * behavior carries the highest importance, preferring an editor/preview surface.
 * @param {Object} config
 * @param {string[]} panels
 * @returns {string|undefined}
 */
function pickPrimaryPanel(config, panels) {
  let best;
  let bestScore = -Infinity;
  for (let panelType of panels) {
    if (BOARD_PANELS.has(panelType) || SECONDARY_PANELS.has(panelType)) continue;
    let importance = config.panelTypes?.[panelType]?.behavior?.importance ?? 0;
    if (importance > bestScore) {
      bestScore = importance;
      best = panelType;
    }
  }
  if (best) return best;
  // Fall back to the highest-importance panel of any kind.
  for (let panelType of panels) {
    let importance = config.panelTypes?.[panelType]?.behavior?.importance ?? 0;
    if (importance > bestScore) {
      bestScore = importance;
      best = panelType;
    }
  }
  return best;
}

/**
 * Deep clone a JSON config value.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function cloneConfig(value) {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Build the chat-first, questionnaire-driven workspaces for every class.
 *
 * @returns {Promise<{
 *   chatPanel: string,
 *   chatComponent: string,
 *   scenarios: Array<{
 *     key: string, label: string, intent: string, template: string,
 *     questions: Array<{id: string, type: string, prompt: string, options: Array<{value: string, label: string}>, chosen: *}>,
 *     stages: Array<{title: string, config: Object, digest: Object}>,
 *     config: Object,
 *     exportJson: string,
 *   }>,
 * }>}
 */
export async function buildChatFirstWorkspace() {
  let scenarios = [];
  for (let scenario of SCENARIOS) {
    scenarios.push(await buildScenario(scenario));
  }
  return {
    chatPanel: CHAT_PANEL,
    chatComponent: CHAT_COMPONENT,
    scenarios,
  };
}
