/**
 * Chat-first, questionnaire-driven demo — construction proof.
 *
 * Verifies that each workspace class is built by answering the system's
 * questionnaire (the agent selects from offered options), that the system then
 * places panels from its canonical template, and that the chat is docked as a
 * global RIGHT panel at full height around a valid, portable config.
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

test('each scenario answers the offered questionnaire', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    assert.ok(scenario.questions.length > 0, `${scenario.key} has no questions`);
    // Every returned question carries a chosen value (we drop skipped ones).
    for (let q of scenario.questions) {
      assert.notEqual(q.chosen, undefined, `${scenario.key}/${q.id} has no chosen value`);
    }
    // The module selection is the agent picking every offered module value.
    let moduleQuestion = scenario.questions.find((q) => q.id === 'module-selection');
    assert.ok(moduleQuestion, `${scenario.key} is missing the module-selection question`);
    assert.equal(moduleQuestion.type, 'multi-select');
    let offered = moduleQuestion.options.map((o) => o.value).sort();
    assert.ok(offered.length > 0, `${scenario.key} module-selection offered no options`);
    assert.deepEqual([...moduleQuestion.chosen].sort(), offered, `${scenario.key} did not select all offered modules`);
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
    let root = scenario.config.layout;
    assert.equal(root.type, 'split', `${scenario.key} root is not a split`);
    assert.equal(root.direction, 'horizontal', `${scenario.key} root split is not horizontal`);
    assert.equal(root.second.type, 'panel', `${scenario.key} root second child is not a panel`);
    assert.equal(root.second.panelType, CHAT_PANEL, `${scenario.key} chat is not the right child`);

    let chatBehavior = scenario.config.panelTypes[CHAT_PANEL].behavior;
    assert.equal(chatBehavior.collapse, 'never', `${scenario.key} chat is collapsible`);
    assert.equal(chatBehavior.importance, 100);

    // The digest agrees the chat is pinned on the right.
    assert.equal(scenario.stages.at(-1).digest.pinnedChatRight, true, `${scenario.key} digest disagrees`);
  }
});

test('at least two workspace panels sit on the left with behavior metadata', async () => {
  let { scenarios } = await build();
  for (let scenario of scenarios) {
    let leftPanels = layoutPanels(scenario.config.layout.first);
    assert.ok(leftPanels.length >= 2, `${scenario.key} has fewer than 2 left panels`);
    assert.ok(!leftPanels.includes(CHAT_PANEL), `${scenario.key} chat leaked into the workspace side`);
    for (let panelType of leftPanels) {
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
