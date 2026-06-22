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

test('all three workspace classes are present', async () => {
  let { scenarios, chatPanel, chatComponent } = await build();
  assert.equal(chatPanel, CHAT_PANEL);
  assert.equal(chatComponent, CHAT_COMPONENT);
  let keys = scenarios.map((s) => s.key).sort();
  assert.deepEqual(keys, ['automation', 'programming', 'video']);
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
    assert.ok(scenario.exportJson, `${scenario.key} produced no export JSON`);
    let relaunch = createSession();
    let imported = await dispatch('import_config', { json: scenario.exportJson }, relaunch);
    assert.equal(imported.status, 'ok', `${scenario.key} import failed: ${imported.hint}`);
    assert.deepEqual(
      Object.keys(relaunch.config.panelTypes).sort(),
      Object.keys(scenario.config.panelTypes).sort(),
      `${scenario.key} panel types changed on round-trip`,
    );
    assert.deepEqual(
      layoutPanels(relaunch.config.layout).sort(),
      layoutPanels(scenario.config.layout).sort(),
      `${scenario.key} layout panels changed on round-trip`,
    );
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
