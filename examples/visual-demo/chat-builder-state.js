/**
 * Chat-first, questionnaire-driven construction driver.
 *
 * Each workspace class is built by driving the REAL construction protocol
 * through `dispatch(tool, args, session)`: the system classifies the intent and
 * offers a questionnaire, the agent SELECTS from the offered options, and the
 * system places panels from its canonical template into `session.config`. No
 * hand-authored panel placement — the layout is whatever the template produces.
 *
 * The selection is a REAL choice. Each class offers two or three fully
 * constructed `variants`, each answering `module-selection` and
 * `layout-topology` differently, so the demo can switch between distinct
 * left-panel sets arranged with a class-appropriate topology. The scenario's
 * top-level `config`/`exportJson` mirror the default variant.
 *
 * The topology answer materially reshapes the WORKSPACE side: the constructor
 * maps it to a split arrangement (`grid` → balanced 2D, `workbench` →
 * horizontal workbench, `focus-canvas` → one dominant panel, `studio` →
 * vertical timeline-first stack), so each class lands in a fitting layout
 * instead of the bare template default. The chat is still docked RIGHT after
 * construction regardless of topology.
 *
 * After construction the workspace is wrapped so the chat lives as a global
 * RIGHT panel at full height (withChat-style), exactly as the real agent-portal
 * docks a persistent conversation beside a constructed workspace.
 *
 * @module examples/visual-demo/chat-builder-state
 */

import { createSession, dispatch } from '../../runtime/index.js';
import { symbioteUiRoot, workspacePackageRoot } from './server-utils.js';

/** Panel-type name for the persistent chat region. */
export const CHAT_PANEL = 'chat';
/** symbiote-ui component tag mounted into the chat region. */
export const CHAT_COMPONENT = 'chat-workspace';

/**
 * Free-created module for the CUSTOMIZATION class. Its capability tokens
 * (`geospatial`, `map`, `layers`) deliberately do not overlap any canonical
 * module capability, so `construct_workspace` with `requiredCapabilities:
 * ['geospatial.map']` genuinely rejects until this module is authored — the one
 * place the agent free-creates instead of selecting from the catalog. The tag
 * aliases to the real `sn-data-table` component for RENDERING; it is a clear
 * demo stand-in for a geospatial surface.
 */
const CUSTOM_INTENT = 'geospatial situational map operations workspace';
const CUSTOM_TEMPLATE_NAME = 'custom-geospatial';
const CUSTOM_REQUIRED_CAPABILITY = 'geospatial.map';
const CUSTOM_MODULE_TAG = 'geo-situation-map';
const CUSTOM_MODULE_CAPABILITIES = [
  { tagName: CUSTOM_MODULE_TAG, capabilities: ['geospatial.map', 'geospatial.layers'] },
];
/** One-panel workspace template entry whose panel mounts the free-created tag. */
const CUSTOM_PANEL_TYPE = {
  title: 'Situation Map',
  icon: 'public',
  component: CUSTOM_MODULE_TAG,
};
/**
 * Hand-authored workspace template. It pairs the free-created module with two
 * canonical companions (a records table and an activity feed) so the class can
 * offer the questionnaire more than one module and the variants differ by which
 * canonical panels join the new module.
 */
const CUSTOM_WORKSPACE_TEMPLATE = {
  name: CUSTOM_TEMPLATE_NAME,
  description: 'Free-created geospatial situational workspace with records and activity.',
  config: {
    version: '0.1.0',
    name: 'Geospatial Console',
    register: 'tool',
    groups: [{ id: 'ops', name: 'Operations', icon: 'public' }],
    sections: [{ id: 'map', label: 'Map', icon: 'public', order: 0, groupId: 'ops' }],
    panelTypes: {
      situationMap: { ...CUSTOM_PANEL_TYPE, behavior: { importance: 90, minInlineSize: 420 } },
      records: { title: 'Records', icon: 'table', component: 'sn-data-table', behavior: { importance: 70, minInlineSize: 320 } },
      activity: { title: 'Activity', icon: 'history', component: 'sn-event-feed', behavior: { importance: 60, minInlineSize: 280 } },
    },
    layout: {
      type: 'split', direction: 'horizontal', ratio: 0.6,
      first: { type: 'panel', panelType: 'situationMap' },
      second: {
        type: 'split', direction: 'vertical', ratio: 0.5,
        first: { type: 'panel', panelType: 'records' },
        second: { type: 'panel', panelType: 'activity' },
      },
    },
    components: {
      catalog: [CUSTOM_MODULE_TAG, 'sn-data-table', 'sn-event-feed'],
      modules: [
        ...CUSTOM_MODULE_CAPABILITIES,
        { tagName: 'sn-data-table', capabilities: ['data.table', 'admin.records'] },
        { tagName: 'sn-event-feed', capabilities: ['activity.feed'] },
      ],
    },
  },
};

/**
 * Workspace classes to construct. Each drives one session through the real
 * construction protocol; the live-verified template is recorded for reference.
 *
 * `variants` are curated answer-sets. Each picks a DIFFERENT meaningful
 * `module-selection` so the constructed left-panel set is distinct, and a
 * class-appropriate `layout-topology` so the workspace side is arranged to fit
 * the class; `theme` supplies the `theme-mode` (+ `theme-hue` when custom)
 * answers that drive the cascade theme. `default` names the variant the
 * scenario surfaces at the top level. Module values are the canonical template
 * modules (verified live): editor → files/preview/source, video-studio →
 * inspector/node-graph/timeline/viewport, social-automation →
 * history/imports/queue/reply/workflow. Topology values are drawn from the
 * offered `layout-topology` options; only `grid`, `workbench`, `focus-canvas`
 * and `studio` produce a distinct constructed arrangement.
 * @type {Array<{
 *   key: string, label: string, intent: string, template: string,
 *   default: string,
 *   variants: Array<{id: string, label: string, modules: string[], topology?: string, theme: {mode: string, hue?: number}}>,
 * }>}
 */
const SCENARIOS = [
  {
    key: 'programming',
    label: 'Programming',
    intent: 'agent programming workspace with source editor, diff and dependency graph',
    template: 'editor',
    default: 'standard',
    // The recommended first-run class: the canonical editor template is the most
    // recognizable to a newcomer, and its standard variant builds a balanced
    // three-panel workbench that best shows the questionnaire-to-panels payoff.
    recommended: true,
    // Only three modules are offered, so the two-module subsets must differ by
    // WHICH modules they keep rather than only by count. The standard variant
    // keeps all three so the workspace reads as a balanced workbench instead of
    // one dominant editor with empty space.
    variants: [
      { id: 'minimal', label: 'Minimal — source + files', modules: ['source', 'files'], topology: 'focus-canvas', theme: { mode: 'dark' } },
      { id: 'standard', label: 'Standard — files, source, preview', modules: ['files', 'source', 'preview'], topology: 'workbench', theme: { mode: 'light' } },
      { id: 'full', label: 'Full — files, preview, source', modules: ['files', 'preview', 'source'], topology: 'grid', theme: { mode: 'custom', hue: 265 } },
    ],
  },
  {
    key: 'video',
    label: 'Video',
    intent: 'media studio for video editing with timeline and preview',
    template: 'video-studio',
    default: 'standard',
    variants: [
      { id: 'minimal', label: 'Minimal — viewport + timeline', modules: ['viewport', 'timeline'], topology: 'studio', theme: { mode: 'dark' } },
      { id: 'standard', label: 'Standard — viewport, timeline, inspector', modules: ['viewport', 'timeline', 'inspector'], topology: 'studio', theme: { mode: 'dark' } },
      { id: 'full', label: 'Full — all four modules', modules: ['inspector', 'node-graph', 'timeline', 'viewport'], topology: 'studio', theme: { mode: 'custom', hue: 300 } },
    ],
  },
  {
    key: 'automation',
    label: 'Automation',
    intent: 'automation workspace for workflow approvals and process queues',
    template: 'social-automation',
    default: 'standard',
    variants: [
      { id: 'minimal', label: 'Minimal — queue + workflow', modules: ['queue', 'workflow'], topology: 'grid', theme: { mode: 'light' } },
      { id: 'standard', label: 'Standard — queue, workflow, reply', modules: ['queue', 'workflow', 'reply'], topology: 'grid', theme: { mode: 'dark' } },
      { id: 'full', label: 'Full — all five modules', modules: ['history', 'imports', 'queue', 'reply', 'workflow'], topology: 'grid', theme: { mode: 'custom', hue: 200 } },
    ],
  },
  {
    // CUSTOMIZATION class: the canonical catalog cannot satisfy a geospatial
    // capability, so the agent free-creates a module and a workspace template and
    // constructs from them. `construction` carries those extras into every
    // dispatch in the build pipeline so the same docking/topology/export path the
    // other classes use also serves the custom class.
    key: 'custom',
    label: 'Customization',
    intent: CUSTOM_INTENT,
    template: CUSTOM_TEMPLATE_NAME,
    default: 'standard',
    construction: {
      workspaceTemplates: [CUSTOM_WORKSPACE_TEMPLATE],
      moduleCapabilities: CUSTOM_MODULE_CAPABILITIES,
      requiredCapabilities: [CUSTOM_REQUIRED_CAPABILITY],
    },
    variants: [
      { id: 'minimal', label: 'Lean — new module + activity', modules: ['situationMap', 'activity'], topology: 'focus-canvas', theme: { mode: 'dark' } },
      { id: 'standard', label: 'Full desk — new module + records + activity', modules: ['situationMap', 'records', 'activity'], topology: 'grid', theme: { mode: 'custom', hue: 150 } },
    ],
  },
];

/**
 * Behavior preset for the docked chat: full height on the right, high importance
 * so responsive compression never auto-collapses it, but `collapse: 'manual'` so
 * the user can fold it away with the panel-layout's standard collapse control once
 * the workspace is built.
 */
const CHAT_BEHAVIOR = {
  collapse: 'manual',
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
    responsiveMode: 'stack', responsiveBreakpoint: 760,
  },
  board: {
    importance: 88, minInlineSize: 480, minBlockSize: 320,
    collapse: 'never', overflow: 'scroll-inline',
    responsiveMode: 'stack', responsiveBreakpoint: 760,
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
 * Count the workspace-side panels of a constructed config: the panels under the
 * LEFT child of the chat-docking root split (the docked chat on the right is not
 * a workspace panel and is excluded). Falls back to the whole layout minus the
 * chat panel if the config is not yet chat-docked.
 * @param {Object|null} config
 * @returns {number}
 */
function workspacePanelCount(config) {
  let root = config?.layout;
  if (!root) return 0;
  let workspaceSide = (root.type === 'split' && root.second?.panelType === CHAT_PANEL)
    ? root.first
    : root;
  return layoutPanels(workspaceSide).filter((panelType) => panelType !== CHAT_PANEL).length;
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
    && config.panelTypes?.[CHAT_PANEL]?.behavior?.collapse === 'manual',
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
 * Translate a variant definition into the explicit questionnaire answers the
 * agent submits: a curated module selection, the offered register and topology,
 * and the variant's theme mode (plus a hue when the mode is custom).
 * @param {Object} questionnaire
 * @param {{modules: string[], topology?: string, theme: {mode: string, hue?: number}}} variant
 * @returns {Array<[string, *]>}
 */
function variantSelections(questionnaire, variant) {
  let moduleQuestion = questionnaire.find((q) => q.id === 'module-selection');
  let offered = moduleQuestion ? new Set(moduleQuestion.options.map((o) => o.value)) : new Set();
  // Keep only modules the system actually offers, in the curated order.
  let modules = variant.modules.filter((value) => offered.has(value));
  let selections = [
    ['module-selection', modules.length ? modules : undefined],
    ['target-register', findOptionDefault(questionnaire, 'target-register')],
    ['layout-topology', variant.topology ?? findOptionDefault(questionnaire, 'layout-topology')],
    ['theme-mode', variant.theme.mode],
  ];
  if (variant.theme.mode === 'custom' && typeof variant.theme.hue === 'number') {
    selections.push(['theme-hue', variant.theme.hue]);
  }
  return selections;
}

/**
 * Read the variant's theme back from the answered questionnaire, so the runtime
 * can apply the cascade theme. Defaults to dark when the questionnaire skips the
 * theme question entirely.
 * @param {Array} questionnaire
 * @param {{theme: {mode: string, hue?: number}}} variant
 * @returns {{mode: string, hue: number}}
 */
function themeFromQuestions(questionnaire, variant) {
  let modeQuestion = questionnaire.find((q) => q.id === 'theme-mode');
  let hueQuestion = questionnaire.find((q) => q.id === 'theme-hue');
  let mode = modeQuestion?.answer ?? variant.theme.mode ?? 'dark';
  let hue = (mode === 'custom' && typeof variant.theme.hue === 'number')
    ? variant.theme.hue
    : (hueQuestion?.answer ?? hueQuestion?.default ?? variant.theme.hue ?? 210);
  return { mode, hue };
}

/**
 * Drive one VARIANT of a workspace class through the real construction protocol
 * and dock the chat on the right.
 * @param {{key: string, label: string, intent: string, template: string}} scenario
 * @param {{id: string, label: string, modules: string[], topology?: string, theme: {mode: string, hue?: number}}} variant
 * @returns {Promise<{
 *   id: string, label: string,
 *   answers: Object, config: Object, exportJson: string,
 *   theme: {mode: string, hue: number}, topology: string,
 *   questions: Array, stages: Array,
 *   digest: {panels: string[], panelTypes: string[], pinnedChatRight: boolean, bridges: number},
 * }>}
 */
async function buildVariant(scenario, variant) {
  let { key, label, intent, template } = scenario;
  // Construction extras let a class hand the system a free-created module and
  // workspace template (the CUSTOMIZATION class); canonical classes pass none.
  let extras = scenario.construction || {};
  let session = createSession();
  let stages = [];

  // 1. The system classifies the intent and names the (canonical or free-created)
  //    template.
  let classified = requireOk(key, 'classify_workspace', await dispatch('classify_workspace', { intent, ...extras }, session));

  // 2. The system builds its questionnaire of offered options.
  let built = requireOk(key, 'build_construction_questions', await dispatch('build_construction_questions', { intent, template, ...extras }, session));
  let questionnaire = built.questions;

  // 3. The agent SELECTS from the offered options. This variant submits a
  //    curated module subset (not blanket select-all), the offered register and
  //    topology, and its theme so the answered set is an explicit choice.
  let answeredIds = new Set();
  for (let [questionId, answer] of variantSelections(questionnaire, variant)) {
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
  requireOk(key, 'plan_workspace', await dispatch('plan_workspace', { intent, template, answers, ...extras }, session));
  let constructed = requireOk(key, 'construct_workspace', await dispatch('construct_workspace', { intent, template, answers, ...extras }, session));
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
  // Root reflow policy: below the narrow breakpoint the whole workspace STACKS
  // vertically (Queue/Flow → Chat) instead of scroll-compressing the panels
  // below their minInlineSize. Matched to CHAT_BEHAVIOR and the role presets so
  // the demo tells one coherent narrow-reflow story rather than two contradictory
  // ones (a 720px viewport clearly stacks).
  requireOk(key, 'update_layout_behavior', await dispatch('update_layout_behavior', {
    behavior: { responsiveMode: 'stack', responsiveBreakpoint: 760 },
  }, session));

  // 6. Validate strict, then export a portable config.
  let validation = await dispatch('validate_config', { strict: true }, session);
  if (validation.valid !== true) {
    throw new Error(`[${key}/${variant.id}] strict validation failed: ${JSON.stringify(validation.errors)}`);
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

  // The topology the construction actually used, read back from the answered
  // questionnaire so it always reflects the choice the system accepted.
  let topologyQuestion = questionnaire.find((q) => q.id === 'layout-topology');
  let topology = topologyQuestion?.answer ?? variant.topology;

  return {
    id: variant.id,
    label: variant.label,
    answers,
    config: session.config,
    exportJson: exported.json,
    theme: themeFromQuestions(questionnaire, variant),
    topology,
    questions,
    stages,
    digest: digestConfig(session.config),
  };
}

/**
 * Build every variant of a workspace class and surface the default variant's
 * config, export, questions and stages at the scenario top level.
 * @param {Object} scenario
 * @returns {Promise<Object>} One scenario entry of the return contract.
 */
async function buildScenario(scenario) {
  let { key, label, intent } = scenario;
  let variants = [];
  for (let variantDef of scenario.variants) {
    let variant = await buildVariant(scenario, variantDef);
    variants.push({
      id: variant.id,
      label: variant.label,
      answers: variant.answers,
      config: variant.config,
      exportJson: variant.exportJson,
      theme: variant.theme,
      topology: variant.topology,
      digest: variant.digest,
    });
  }

  let defaultIndex = pickDefaultVariantIndex(scenario, variants);
  let defaultVariant = variants[defaultIndex];
  // Re-run the default variant to recover its full questions/stages without
  // bloating every variant with the heavy replay payloads.
  let defaultBuild = await buildVariant(scenario, scenario.variants[defaultIndex]);

  // Menu teaser, derived from the REAL constructed default so the questionnaire
  // value-prop is shown, not just told: how many questions the class answers and
  // how many panels the default variant builds (chat docks separately and is not
  // a workspace panel, so it is excluded from the count).
  let questionsCount = defaultBuild.questions.length;
  let panelCount = workspacePanelCount(defaultVariant.config);
  let teaser = `${questionsCount} questions → ${panelCount} panels`;

  return {
    key,
    label,
    intent,
    template: scenario.template,
    classification: intent,
    default: defaultVariant.id,
    recommended: scenario.recommended === true,
    questionsCount,
    panelCount,
    teaser,
    variants,
    theme: defaultVariant.theme,
    topology: defaultVariant.topology,
    questions: defaultBuild.questions,
    stages: defaultBuild.stages,
    config: defaultVariant.config,
    exportJson: defaultVariant.exportJson,
  };
}

/**
 * Resolve which constructed variant is the scenario default: the configured
 * `default` id, else `standard`, else `full`, else the first variant.
 * @param {{default?: string}} scenario
 * @param {Array<{id: string}>} variants
 * @returns {number}
 */
function pickDefaultVariantIndex(scenario, variants) {
  let preference = [scenario.default, 'standard', 'full'].filter(Boolean);
  for (let id of preference) {
    let index = variants.findIndex((v) => v.id === id);
    if (index !== -1) return index;
  }
  return 0;
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
 * Read the symbiote-ui catalog through `discover_components` and reduce it to a
 * small digest. Falls back to a minimal digest (never throws) when symbiote-ui
 * cannot be resolved, so the demo build stays offline-safe.
 * @returns {Promise<{categories: string[], sampleTags: string[]}>}
 */
async function readCatalogDigest() {
  let fallback = { categories: ['display', 'board'], sampleTags: ['sn-data-table', 'sn-event-feed'] };
  try {
    let uiPath = await symbioteUiRoot(workspacePackageRoot());
    let session = createSession();
    let result = await dispatch('discover_components', { uiPath }, session);
    let categories = Object.keys(result?.categories || {});
    if (categories.length === 0) return fallback;
    let sampleTags = Object.values(result.categories).flat().slice(0, 8);
    return { categories: categories.sort(), sampleTags };
  } catch {
    return fallback;
  }
}

/**
 * Drive the genuine capability rejection: `construct_workspace` with a required
 * capability the canonical catalog cannot cover. Returns the gap (capability,
 * recovery, alternatives) read straight from the rejection's readiness; throws
 * if the rejection does NOT fire, since a covered capability would contradict
 * the "catalog cannot satisfy" premise.
 * @returns {Promise<{capability: string, recovery: object[], alternatives: object[]}>}
 */
async function readConstructionGap() {
  let session = createSession();
  let rejection = await dispatch('construct_workspace', {
    intent: CUSTOM_INTENT,
    template: 'admin',
    requiredCapabilities: [CUSTOM_REQUIRED_CAPABILITY],
  }, session);
  if (rejection.status !== 'error' || rejection.code !== 'construction_capabilities_missing') {
    throw new Error(`[custom] expected a capability rejection but got: ${JSON.stringify(rejection.status)}/${rejection.code}`);
  }
  let recovery = rejection.readiness?.recovery || [];
  if (recovery.length === 0) {
    throw new Error('[custom] capability rejection carried no recovery steps');
  }
  let alternatives = recovery.flatMap((step) => step.alternatives || []);
  return {
    capability: CUSTOM_REQUIRED_CAPABILITY,
    recovery: cloneConfig(recovery),
    alternatives: cloneConfig(alternatives),
  };
}

/**
 * Run the organic-fit check: PREVIEW-only `validate_workspace_patch` +
 * `propose_workspace_patch` for adding the free-created module beside the panels
 * of a constructed base, on the `modules` patch surface. Never applies the patch
 * and never writes to disk.
 * @param {Object} baseConfig Constructed (pre-dock) workspace config.
 * @returns {Promise<{
 *   organicFit: {accepted: boolean, surface: string, summary: string, diagnostics: object[]},
 *   patchPreview: {count: number, changes: object[]},
 * }>}
 */
async function readOrganicFit(baseConfig) {
  let session = createSession();
  session.config = cloneConfig(baseConfig);
  // The modules patch keeps every existing panel and ADDS the free-created
  // module, so the workspace-level design policy validates a clean superset.
  let patch = {
    modules: {
      panelTypes: {
        ...session.config.panelTypes,
        situationMap: { ...CUSTOM_PANEL_TYPE, behavior: { importance: 80, minInlineSize: 420 } },
      },
    },
  };
  let validation = await dispatch('validate_workspace_patch', { patch }, session);
  let proposal = await dispatch('propose_workspace_patch', { patch }, session);
  let summary = validation.accepted
    ? `Free-created module fits the modules surface (${proposal.count} change${proposal.count === 1 ? '' : 's'}).`
    : 'Free-created module was rejected by the design policy.';
  return {
    organicFit: {
      accepted: validation.accepted === true,
      // The patch-key surface being validated (a `{modules:{panelTypes}}` patch),
      // i.e. the dimension the free-created module fits — distinct from the tool's
      // top-level `surface` ('workspace'). The modules-surface routing is asserted
      // in tests/dispatch-construction-tools.test.js.
      surface: 'modules',
      summary,
      diagnostics: cloneConfig(validation.diagnostics || []),
    },
    patchPreview: {
      count: proposal.count,
      changes: cloneConfig(proposal.changes || []),
    },
  };
}

/**
 * Build the CUSTOMIZATION class. It first reuses the shared variant pipeline to
 * construct the workspace from the free-created module + template, then records
 * the customization seam (catalog digest, genuine gap, hand-authored recipe,
 * organic fit, and a preview-only patch) the render side reads.
 * @param {Object} scenario
 * @returns {Promise<Object>} One scenario entry plus its `customization` payload.
 */
async function buildCustomScenario(scenario) {
  let entry = await buildScenario(scenario);

  let catalogDigest = await readCatalogDigest();
  let gap = await readConstructionGap();

  // Constructed (pre-dock) CANONICAL base for the organic-fit preview: the patch
  // ADDS the free-created module beside the catalog panels, proving it fits a
  // workspace it was never part of. Throwaway session; nothing writes to disk.
  let baseSession = createSession();
  requireOk('custom', 'construct_workspace', await dispatch('construct_workspace', {
    intent: 'admin records operations console',
    template: 'admin',
    answers: { 'theme-mode': 'dark' },
  }, baseSession));
  let { organicFit, patchPreview } = await readOrganicFit(baseSession.config);

  return {
    ...entry,
    customization: {
      catalogDigest,
      gap,
      recipe: {
        tagName: CUSTOM_MODULE_TAG,
        capabilities: CUSTOM_MODULE_CAPABILITIES[0].capabilities.slice(),
        panelType: { ...CUSTOM_PANEL_TYPE },
      },
      organicFit,
      patchPreview,
    },
  };
}

/**
 * Build the chat-first, questionnaire-driven workspaces for every class.
 *
 * @returns {Promise<{
 *   chatPanel: string,
 *   chatComponent: string,
 *   scenarios: Array<{
 *     key: string, label: string, intent: string, template: string,
 *     default: string, recommended: boolean,
 *     questionsCount: number, panelCount: number, teaser: string,
 *     theme: {mode: string, hue: number}, topology: string,
 *     variants: Array<{id: string, label: string, answers: Object, config: Object, exportJson: string, theme: {mode: string, hue: number}, topology: string, digest: Object}>,
 *     questions: Array<{id: string, type: string, prompt: string, options: Array<{value: string, label: string}>, chosen: *}>,
 *     stages: Array<{title: string, config: Object, digest: Object}>,
 *     config: Object,
 *     exportJson: string,
 *     customization?: {
 *       catalogDigest: {categories: string[], sampleTags: string[]},
 *       gap: {capability: string, recovery: object[], alternatives: object[]},
 *       recipe: {tagName: string, capabilities: string[], panelType: {title: string, icon: string, component: string}},
 *       organicFit: {accepted: boolean, surface: string, summary: string, diagnostics: object[]},
 *       patchPreview: {count: number, changes: object[]},
 *     },
 *   }>,
 * }>}
 */
export async function buildChatFirstWorkspace() {
  let scenarios = [];
  for (let scenario of SCENARIOS) {
    scenarios.push(scenario.key === 'custom'
      ? await buildCustomScenario(scenario)
      : await buildScenario(scenario));
  }
  return {
    chatPanel: CHAT_PANEL,
    chatComponent: CHAT_COMPONENT,
    scenarios,
  };
}
