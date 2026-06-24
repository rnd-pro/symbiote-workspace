/**
 * Chat-first, questionnaire-driven demo — construction proof.
 *
 * Verifies that each workspace class is built by answering the system's
 * questionnaire (the agent selects a REAL, curated subset from offered options),
 * that the system then places panels from its canonical template, that each
 * class offers two or three distinct constructed variants, and that the chat is
 * docked as a global RIGHT panel at full height around a valid, portable config.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatFirstWorkspace,
  CHAT_PANEL,
  CHAT_COMPONENT,
} from '../examples/visual-demo/chat-builder-state.js';
import { dispatch, createSession } from '../runtime/index.js';
import { validateWorkspaceConfig } from '../schema/index.js';

function layoutPanels(node, acc = []) {
  if (!node) return acc;
  if (node.type === 'panel') acc.push(node.panelType);
  else if (node.type === 'split') { layoutPanels(node.first, acc); layoutPanels(node.second, acc); }
  return acc;
}

/** Panels of the workspace side (left child of the root split). */
function leftPanels(config) {
  return layoutPanels(config.layout.first);
}

/** The workspace-side root node (left child of the chat-docking root split). */
function workspaceRoot(config) {
  return config.layout.first;
}

/**
 * Walk a layout subtree and collect the (direction, ratio) of every split, so a
 * topology's arrangement can be checked structurally rather than by a single
 * brittle root ratio.
 */
function splitSignature(node, acc = []) {
  if (!node || node.type !== 'split') return acc;
  acc.push({ direction: node.direction, ratio: node.ratio });
  splitSignature(node.first, acc);
  splitSignature(node.second, acc);
  return acc;
}

/**
 * Assert two layout trees are structurally identical: same node type, and at
 * every split the same direction, ratio (or sizes) and child ordering, recursing
 * into both children. Unlike a flat panel-key comparison this catches a reordered
 * or reshaped tree that happens to keep the same panel set.
 */
function assertLayoutTreeEqual(a, b, path = 'layout') {
  assert.ok(a && b, `${path} missing on one side`);
  assert.equal(a.type, b.type, `${path} node type differs (${a.type} vs ${b.type})`);
  if (a.type === 'panel') {
    assert.equal(a.panelType, b.panelType, `${path} panel type differs`);
    assert.deepEqual(a.panelState ?? {}, b.panelState ?? {}, `${path} panel state differs`);
    return;
  }
  assert.equal(a.direction, b.direction, `${path} split direction differs`);
  assert.equal(a.ratio, b.ratio, `${path} split ratio differs`);
  assert.deepEqual(a.sizes, b.sizes, `${path} split sizes differ`);
  assertLayoutTreeEqual(a.first, b.first, `${path}.first`);
  assertLayoutTreeEqual(a.second, b.second, `${path}.second`);
}

/**
 * Assert that a workspace-side subtree matches the arrangement the constructor
 * produces for a given topology. Robust to the exact panel count: it checks the
 * direction/ratio family rather than a hardcoded tree shape.
 */
function assertTopologyArrangement(root, topology, label) {
  let splits = splitSignature(root);
  assert.ok(splits.length >= 1, `${label} workspace side has no splits for topology ${topology}`);
  if (topology === 'grid') {
    // Balanced 2D: ratios sit at 0.5 and, with >=3 panels, directions mix.
    for (let { ratio } of splits) {
      assert.ok(Math.abs(ratio - 0.5) < 1e-6, `${label} grid split ratio ${ratio} is not balanced`);
    }
    let panels = layoutPanels(root);
    if (panels.length >= 3) {
      let dirs = new Set(splits.map((s) => s.direction));
      assert.equal(dirs.size, 2, `${label} grid with ${panels.length} panels is not a mixed 2D arrangement`);
    }
    return;
  }
  // Linear topologies: a single split direction across the subtree at a
  // topology-specific ratio family.
  let expected = {
    workbench: { direction: 'horizontal', ratio: 0.36 },
    'focus-canvas': { direction: 'horizontal', ratio: 0.78 },
    studio: { direction: 'vertical', ratio: 0.72 },
  }[topology];
  assert.ok(expected, `${label} unexpected topology ${topology}`);
  for (let { direction, ratio } of splits) {
    assert.equal(direction, expected.direction, `${label} ${topology} split direction ${direction} unexpected`);
    assert.ok(Math.abs(ratio - expected.ratio) < 0.06, `${label} ${topology} split ratio ${ratio} far from ${expected.ratio}`);
  }
}

/** Assert a config docks the chat on the right of a horizontal root split. */
function assertChatDockedRight(config, label) {
  let root = config.layout;
  assert.equal(root.type, 'split', `${label} root is not a split`);
  assert.equal(root.direction, 'horizontal', `${label} root split is not horizontal`);
  assert.equal(root.second.type, 'panel', `${label} root second child is not a panel`);
  assert.equal(root.second.panelType, CHAT_PANEL, `${label} chat is not the right child`);
  let chatBehavior = config.panelTypes[CHAT_PANEL].behavior;
  assert.equal(chatBehavior.collapse, 'never', `${label} chat is collapsible`);
  assert.equal(chatBehavior.importance, 100, `${label} chat importance changed`);
}

let cached;
async function build() {
  if (!cached) cached = await buildChatFirstWorkspace();
  return cached;
}

test('all workspace classes are present', async () => {
  let { scenarios, chatPanel, chatComponent } = await build();
  assert.equal(chatPanel, CHAT_PANEL);
  assert.equal(chatComponent, CHAT_COMPONENT);
  let keys = scenarios.map((s) => s.key).sort();
  assert.deepEqual(keys, ['automation', 'custom', 'programming', 'video']);
});

test('each scenario answers the offered questionnaire with a curated choice', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    assert.ok(scenario.questions.length > 0, `${scenario.key} has no questions`);
    // Every returned question carries a chosen value (we drop skipped ones).
    for (let q of scenario.questions) {
      assert.notEqual(q.chosen, undefined, `${scenario.key}/${q.id} has no chosen value`);
    }
    // The module selection is a real multi-select of offered modules; the
    // default (standard) variant is a curated subset, not blanket select-all.
    let moduleQuestion = scenario.questions.find((q) => q.id === 'module-selection');
    assert.ok(moduleQuestion, `${scenario.key} is missing the module-selection question`);
    assert.equal(moduleQuestion.type, 'multi-select');
    let offered = moduleQuestion.options.map((o) => o.value);
    assert.ok(offered.length > 0, `${scenario.key} module-selection offered no options`);
    assert.ok(Array.isArray(moduleQuestion.chosen) && moduleQuestion.chosen.length >= 2,
      `${scenario.key} chose fewer than 2 modules`);
    for (let value of moduleQuestion.chosen) {
      assert.ok(offered.includes(value), `${scenario.key} chose unoffered module "${value}"`);
    }
  }
});

test('each scenario exposes at least two constructed variants', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    assert.ok(Array.isArray(scenario.variants), `${scenario.key} has no variants array`);
    assert.ok(scenario.variants.length >= 2, `${scenario.key} has fewer than 2 variants`);
    let ids = scenario.variants.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length, `${scenario.key} has duplicate variant ids`);
    // The named default must exist among the variants.
    assert.ok(ids.includes(scenario.default), `${scenario.key} default "${scenario.default}" is not a variant`);
  }
});

test('every variant validates strict, docks the chat right, and keeps behavior metadata', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    for (let variant of scenario.variants) {
      let label = `${scenario.key}/${variant.id}`;
      let validation = validateWorkspaceConfig(variant.config, { strict: true });
      assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);

      assertChatDockedRight(variant.config, label);
      assert.equal(variant.digest.pinnedChatRight, true, `${label} digest disagrees on pinned chat`);

      let left = leftPanels(variant.config);
      assert.ok(left.length >= 2, `${label} has fewer than 2 left panels`);
      assert.ok(!left.includes(CHAT_PANEL), `${label} chat leaked into the workspace side`);
      for (let panelType of left) {
        let behavior = variant.config.panelTypes[panelType]?.behavior;
        assert.ok(behavior && typeof behavior.importance === 'number', `${label}/${panelType} has no behavior metadata`);
      }
    }
  }
});

test('at least one scenario has two variants with different left-panel sets', async () => {
  let { scenarios } = await build();
  let anyDistinct = false;
  for (let scenario of scenarios) {
    let sets = scenario.variants.map((v) => leftPanels(v.config).slice().sort().join(','));
    if (new Set(sets).size >= 2) {
      anyDistinct = true;
      break;
    }
  }
  assert.ok(anyDistinct, 'no scenario produced two variants with distinct left-panel sets');
});

test('each scenario exposes a theme with a mode', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    assert.ok(scenario.theme && typeof scenario.theme === 'object', `${scenario.key} has no theme`);
    assert.equal(typeof scenario.theme.mode, 'string', `${scenario.key} theme has no mode`);
    assert.ok(scenario.theme.mode.length > 0, `${scenario.key} theme mode is empty`);
    for (let variant of scenario.variants) {
      assert.equal(typeof variant.theme.mode, 'string', `${scenario.key}/${variant.id} variant theme has no mode`);
    }
  }
});

test('the scenario config and export mirror the default variant', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    let defaultVariant = scenario.variants.find((v) => v.id === scenario.default);
    assert.ok(defaultVariant, `${scenario.key} default variant missing`);
    assert.deepEqual(scenario.config, defaultVariant.config, `${scenario.key} config is not the default variant`);
    assert.equal(scenario.exportJson, defaultVariant.exportJson, `${scenario.key} export is not the default variant`);
    assert.deepEqual(scenario.theme, defaultVariant.theme, `${scenario.key} theme is not the default variant`);
  }
});

test('the final config validates strict', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    let validation = validateWorkspaceConfig(scenario.config, { strict: true });
    assert.equal(validation.valid, true, `${scenario.key}: ${JSON.stringify(validation.errors)}`);
  }
});

test('chat is docked on the right of the root horizontal split', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    assertChatDockedRight(scenario.config, scenario.key);
    // The digest agrees the chat is pinned on the right.
    assert.equal(scenario.stages.at(-1).digest.pinnedChatRight, true, `${scenario.key} digest disagrees`);
  }
});

test('at least two workspace panels sit on the left with behavior metadata', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    let left = leftPanels(scenario.config);
    assert.ok(left.length >= 2, `${scenario.key} has fewer than 2 left panels`);
    assert.ok(!left.includes(CHAT_PANEL), `${scenario.key} chat leaked into the workspace side`);
    for (let panelType of left) {
      let behavior = scenario.config.panelTypes[panelType]?.behavior;
      assert.ok(behavior && typeof behavior.importance === 'number', `${scenario.key}/${panelType} has no behavior metadata`);
    }
  }
});

test('exported config round-trips through export/import', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    for (let variant of scenario.variants) {
      let label = `${scenario.key}/${variant.id}`;
      assert.ok(variant.exportJson, `${label} produced no export JSON`);

      // Import the portable JSON into a fresh session.
      let relaunch = createSession();
      let imported = await dispatch('import_config', { json: variant.exportJson }, relaunch);
      assert.equal(imported.status, 'ok', `${label} import failed: ${imported.hint}`);

      // The export must preserve the in-memory BUILD config, not merely import
      // deterministically. exportConfig strips top-level host/identity keys, but
      // the layout tree, panel-type set and theme block survive identically — so
      // the config imported from the portable artifact must match the variant's
      // own build config on exactly those dimensions (topology + theme identity,
      // not byte-identity).
      // (a) Full layout-tree equality at every node: split direction, ratio/sizes
      //     and child ordering, not just the flat panel-key set.
      assertLayoutTreeEqual(relaunch.config.layout, variant.config.layout, `${label} layout`);

      // The panel-type set survives the round-trip identically.
      assert.deepEqual(
        Object.keys(relaunch.config.panelTypes).sort(),
        Object.keys(variant.config.panelTypes).sort(),
        `${label} panel types changed on round-trip`,
      );

      // (b) Theme-block equality on the theme sub-object that survives export.
      assert.deepEqual(
        relaunch.config.theme,
        variant.config.theme,
        `${label} theme block changed on round-trip`,
      );
    }
  }
});

test('replay stages start chat-only and end with the constructed workspace', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    assert.ok(scenario.stages.length >= 2, `${scenario.key} has fewer than 2 replay stages`);
    let seed = scenario.stages[0];
    assert.deepEqual(seed.digest.panels, [CHAT_PANEL], `${scenario.key} seed is not chat-only`);
    let final = scenario.stages.at(-1);
    assert.ok(final.digest.panels.includes(CHAT_PANEL), `${scenario.key} final stage dropped the chat`);
    assert.ok(final.digest.panels.length >= 3, `${scenario.key} final stage has too few panels`);
  }
});

test('each scenario answers layout-topology with a chosen offered value', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    let topologyQuestion = scenario.questions.find((q) => q.id === 'layout-topology');
    assert.ok(topologyQuestion, `${scenario.key} is missing the layout-topology question`);
    assert.notEqual(topologyQuestion.chosen, undefined, `${scenario.key} did not choose a topology`);
    let offered = topologyQuestion.options.map((o) => o.value);
    assert.ok(offered.includes(topologyQuestion.chosen),
      `${scenario.key} chose unoffered topology "${topologyQuestion.chosen}"`);

    // The scenario and every variant carry the chosen topology on the contract.
    assert.equal(typeof scenario.topology, 'string', `${scenario.key} has no scenario.topology`);
    assert.ok(offered.includes(scenario.topology), `${scenario.key} topology "${scenario.topology}" is not offered`);
    let defaultVariant = scenario.variants.find((v) => v.id === scenario.default);
    assert.equal(scenario.topology, defaultVariant.topology,
      `${scenario.key} scenario topology is not the default variant topology`);
    for (let variant of scenario.variants) {
      assert.equal(typeof variant.topology, 'string', `${scenario.key}/${variant.id} has no topology`);
      assert.ok(offered.includes(variant.topology),
        `${scenario.key}/${variant.id} topology "${variant.topology}" is not offered`);
      // The recorded topology is exactly the answer the construction accepted.
      assert.equal(variant.answers['layout-topology'], variant.topology,
        `${scenario.key}/${variant.id} topology disagrees with the answered questionnaire`);
    }
  }
});

test('the chosen topology shapes the constructed workspace layout', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    for (let variant of scenario.variants) {
      let label = `${scenario.key}/${variant.id}`;
      let root = workspaceRoot(variant.config);
      // The workspace side is a real split arrangement (not a lone panel).
      assert.equal(root.type, 'split', `${label} workspace side is not a split`);
      // ...and that arrangement matches the chosen topology's signature.
      assertTopologyArrangement(root, variant.topology, label);
    }
  }
});

test('topology produces distinct workspace arrangements across the demo', async () => {
  let { scenarios } = await build();
  // Collect the workspace-side root (direction, ratio) for every variant; the
  // topology choice must yield more than one arrangement family across classes,
  // proving the answer drives layout shape rather than a fixed template default.
  let roots = new Set();
  for (let scenario of scenarios) {
    for (let variant of scenario.variants) {
      let root = workspaceRoot(variant.config);
      roots.add(`${root.direction}:${root.ratio}`);
    }
  }
  assert.ok(roots.size >= 2,
    `topology never changed the workspace arrangement (roots: ${[...roots].join(', ')})`);

  // Per class the default variant's arrangement signature is the one we expect
  // for that class's topology (grid mixes directions, studio is vertical, etc.).
  let byKey = Object.fromEntries(scenarios.map((s) => [s.key, s]));
  let programmingDefault = byKey.programming.variants.find((v) => v.id === byKey.programming.default);
  // Programming default reads as a balanced multi-panel workbench, not one
  // dominant editor: at least three workspace panels under a workbench split.
  assert.ok(leftPanels(programmingDefault.config).length >= 3,
    'programming default has fewer than 3 workspace panels (sparse layout)');
  assert.equal(programmingDefault.topology, 'workbench', 'programming default is not the workbench topology');
  assert.equal(workspaceRoot(programmingDefault.config).direction, 'horizontal',
    'programming workbench is not horizontal');

  // Video default uses the studio topology: a vertical, timeline-first stack.
  let videoDefault = byKey.video.variants.find((v) => v.id === byKey.video.default);
  assert.equal(videoDefault.topology, 'studio', 'video default is not the studio topology');
  assert.equal(workspaceRoot(videoDefault.config).direction, 'vertical', 'video studio is not vertical');

  // Automation default uses the grid topology: a balanced 2D desk.
  let automationDefault = byKey.automation.variants.find((v) => v.id === byKey.automation.default);
  assert.equal(automationDefault.topology, 'grid', 'automation default is not the grid topology');
  assert.ok(Math.abs(workspaceRoot(automationDefault.config).ratio - 0.5) < 1e-6,
    'automation grid root is not balanced');
});

test('the custom scenario surfaces a customization payload', async () => {
  let { scenarios } = await build();
  let custom = scenarios.find((s) => s.key === 'custom');
  assert.ok(custom, 'custom scenario is missing');
  let c = custom.customization;
  assert.ok(c && typeof c === 'object', 'custom scenario has no customization payload');
  assert.deepEqual(
    Object.keys(c).sort(),
    ['catalogDigest', 'gap', 'organicFit', 'patchPreview', 'recipe'],
    'customization payload keys differ from the contract',
  );
  assert.ok(Array.isArray(c.catalogDigest.categories), 'catalogDigest.categories is not an array');
  assert.ok(Array.isArray(c.catalogDigest.sampleTags), 'catalogDigest.sampleTags is not an array');
});

test('customization.gap captures a real, uncovered capability rejection', async () => {
  let { scenarios } = await build();
  let { gap } = scenarios.find((s) => s.key === 'custom').customization;
  assert.equal(typeof gap.capability, 'string', 'gap has no capability');
  assert.ok(gap.capability.length > 0, 'gap capability is empty');
  assert.ok(Array.isArray(gap.recovery) && gap.recovery.length > 0, 'gap recovery is empty');
  // The recovery names the agent action that unblocks the gap: author a module.
  assert.ok(
    gap.recovery.every((step) => step.action === 'provide-module-capability'),
    'gap recovery action is not provide-module-capability',
  );
  assert.ok(Array.isArray(gap.alternatives), 'gap alternatives is not an array');
});

test('customization.recipe is the free-created module and renders a real component', async () => {
  let { scenarios } = await build();
  let custom = scenarios.find((s) => s.key === 'custom');
  let { recipe, gap } = custom.customization;
  assert.equal(typeof recipe.tagName, 'string', 'recipe has no tagName');
  assert.ok(recipe.tagName.length > 0, 'recipe tagName is empty');
  assert.ok(Array.isArray(recipe.capabilities), 'recipe capabilities is not an array');
  assert.ok(recipe.capabilities.includes(gap.capability),
    'recipe does not cover the gap capability it was authored for');
  assert.equal(recipe.panelType.component, recipe.tagName,
    'recipe panelType component is not the free-created tag');
  // The free-created tag is materialized as a real panel in the constructed config.
  for (let variant of custom.variants) {
    let situation = variant.config.panelTypes.situationMap;
    assert.ok(situation, `${variant.id} did not construct the free-created module panel`);
    assert.equal(situation.component, recipe.tagName,
      `${variant.id} free-created panel renders the wrong component`);
  }
});

test('customization.organicFit accepts on the modules surface with a non-empty preview', async () => {
  let { scenarios } = await build();
  let { organicFit, patchPreview } = scenarios.find((s) => s.key === 'custom').customization;
  assert.equal(organicFit.accepted, true, 'organic fit was not accepted');
  assert.equal(organicFit.surface, 'modules', 'organic fit surface is not modules');
  assert.equal(typeof organicFit.summary, 'string', 'organic fit has no summary');
  assert.ok(Array.isArray(organicFit.diagnostics), 'organic fit diagnostics is not an array');
  assert.ok(patchPreview.count > 0, 'patch preview produced no changes');
  assert.ok(Array.isArray(patchPreview.changes), 'patch preview changes is not an array');
  assert.equal(patchPreview.changes.length, patchPreview.count,
    'patch preview count disagrees with the changes list');
});

test('the custom scenario constructs a strict, chat-right workspace', async () => {
  let { scenarios } = await build();
  let custom = scenarios.find((s) => s.key === 'custom');
  assert.ok(custom.variants.length >= 2, 'custom scenario has fewer than 2 variants');
  for (let variant of custom.variants) {
    let label = `custom/${variant.id}`;
    let validation = validateWorkspaceConfig(variant.config, { strict: true });
    assert.equal(validation.valid, true, `${label}: ${JSON.stringify(validation.errors)}`);
    assertChatDockedRight(variant.config, label);

    // The constructed config also passes the strict dispatch validator.
    let session = createSession();
    session.config = variant.config;
    let strict = await dispatch('validate_config', { strict: true }, session);
    assert.equal(strict.valid, true, `${label} dispatch strict validation failed: ${JSON.stringify(strict.errors)}`);

    // The free-created module sits on the workspace side, beside the docked chat.
    let left = leftPanels(variant.config);
    assert.ok(left.includes('situationMap'), `${label} free-created module is not on the workspace side`);
    assert.ok(!left.includes(CHAT_PANEL), `${label} chat leaked into the workspace side`);
  }
});
