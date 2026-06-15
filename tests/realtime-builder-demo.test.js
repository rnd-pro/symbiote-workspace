import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildRealtimeChatStateDemo,
  writeRealtimeChatStateDemo,
} from '../examples/visual-demo/realtime-builder.js';
import { validateWorkspaceConfig } from '../schema/index.js';

async function withTempDir(run) {
  let dir = await mkdtemp(join(tmpdir(), 'symbiote-realtime-builder-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('realtime builder demo', () => {
  it('builds strict portable chat-state stages with required builder panels', () => {
    let demo = buildRealtimeChatStateDemo();
    let finalStage = demo.stages.at(-1);
    let panels = Object.keys(finalStage.config.panelTypes);

    assert.equal(demo.stages.length, 4);
    assert.equal(demo.acceptanceMatrix.every((item) => item.status === 'pass'), true);
    assert.deepEqual(demo.requiredWidgets, [
      'agent-chat',
      'service-blueprint',
      'layout-builder',
      'widget-registry',
      'bindings-inspector',
      'adaptive-rules',
      'validation-checklist',
      'theme-editor',
    ]);
    for (let stage of demo.stages) {
      assert.equal(validateWorkspaceConfig(stage.config, { strict: true }).valid, true);
      assert.ok(stage.chat.length > 0);
      assert.ok(stage.config.construction.questions.length > 0);
      assert.equal(stage.chatState.activeQuestionId, stage.activeQuestionId);
      assert.ok(stage.chatState.nextPatch);
    }
    for (let required of demo.requiredWidgets) {
      assert.ok(panels.includes(required), `${required} panel is registered`);
    }
    assert.ok(finalStage.config.events.length >= 4);
    assert.ok(finalStage.config.data.bindings.length >= 6);
    assert.ok(finalStage.config.validation.reports.some((report) => report.check === 'theme'));
    assert.deepEqual(
      finalStage.chatState.requiredElements,
      demo.requiredWidgets
    );
    assert.equal(finalStage.chatState.themeCascade.editorWidget, 'theme-editor');
    assert.ok(finalStage.chatState.adaptiveBehavior.collapseOrder.includes('adaptive-rules'));
    assert.equal(finalStage.config.rootBehavior.responsiveMode, 'drawer');
  });

  it('writes a browser demo runtime without local host state', async () => {
    await withTempDir(async (dir) => {
      let result = await writeRealtimeChatStateDemo({ outputDir: dir, port: 4777 });
      let app = await readFile(join(dir, 'app.js'), 'utf8');
      let html = await readFile(join(dir, 'index.html'), 'utf8');
      let states = await readFile(join(dir, 'mock-states.json'), 'utf8');
      let contract = JSON.parse(await readFile(join(dir, 'demo.contract.json'), 'utf8'));
      let config = JSON.parse(await readFile(join(dir, 'workspace.config.json'), 'utf8'));

      assert.equal(result.status, 'ok');
      assert.equal(contract.requiredWidgets.includes('theme-editor'), true);
      assert.equal(contract.acceptanceMatrix.every((item) => item.status === 'pass'), true);
      assert.deepEqual(contract.playStages, ['intent', 'questionnaire', 'builder', 'validation']);
      assert.equal(contract.chatStateTimeline.length, 4);
      assert.equal(contract.chatStateTimeline.at(-1).requiredElements.includes('theme-editor'), true);
      assert.match(html, /<script type="importmap">/);
      assert.match(app, /mountWorkspace/);
      assert.match(app, /Play/);
      assert.match(app, /Service blueprint/);
      assert.match(app, /Widget registry/);
      assert.doesNotMatch(app, /\/Users\//);
      assert.doesNotMatch(states, /localhost|\/Users\//);
      assert.equal(config.panelTypes['theme-editor'].component, 'sn-theme-editor-widget');
    });
  });
});
