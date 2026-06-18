import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildRealtimeChatStateDemo,
  writeRealtimeChatStateDemo,
} from '../examples/visual-demo/realtime-builder.js';
import { startStaticServer } from '../examples/visual-demo/server-utils.js';
import { validateWorkspaceConfig } from '../schema/index.js';

async function withTempDir(run) {
  let dir = await mkdtemp(join(tmpdir(), 'symbiote-realtime-builder-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function httpText(port, path) {
  return new Promise((resolveText, rejectText) => {
    let req = request({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolveText({
          statusCode: res.statusCode,
          contentType: res.headers['content-type'],
          body,
        });
      });
    });
    req.on('error', rejectText);
    req.end();
  });
}

function collectLayoutPanels(node, panels = []) {
  if (!node || typeof node !== 'object') return panels;
  if (node.type === 'panel' && node.panelType) {
    panels.push(node.panelType);
    return panels;
  }
  collectLayoutPanels(node.first, panels);
  collectLayoutPanels(node.second, panels);
  return panels;
}

describe('realtime builder demo', () => {
  it('builds strict portable chat-state stages with required builder panels', () => {
    let demo = buildRealtimeChatStateDemo();
    let finalStage = demo.stages.at(-1);
    let panels = Object.keys(finalStage.config.panelTypes);

    assert.equal(demo.stages.length, 4);
    assert.equal(demo.acceptanceMatrix.every((item) => item.status === 'pass'), true);
    assert.ok(demo.acceptanceMatrix.some((item) => item.id === 'construction-tool-lineage'));
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
    assert.deepEqual(demo.constructionTrace.canonicalQuestionIds, [
      'workspace-name',
      'target-register',
      'layout-topology',
      'module-selection',
      'execution-model',
      'required-host-services',
      'theme-mode',
      'theme-hue',
      'verification-scope',
    ]);
    assert.deepEqual(demo.constructionTrace.capabilityCoverage.missing, []);
    assert.equal(demo.constructionTrace.exportImportEvidence.valid, true);
    assert.equal(demo.constructionTrace.constructionPlanEvidence.topology, 'bsp-workbench');
    assert.deepEqual(
      demo.constructionTrace.constructionPlanEvidence.layoutIds,
      ['conversation', 'builder', 'quality']
    );
    assert.equal(demo.constructionTrace.constructionPlanEvidence.moduleCount, demo.requiredWidgets.length);
    assert.equal(demo.constructionTrace.constructionPlanEvidence.regionCount >= 4, true);
    assert.equal(demo.constructionTrace.constructionPlanEvidence.actionCount >= 3, true);
    assert.equal(demo.constructionTrace.constructionPlanEvidence.toolbarItemCount >= 3, true);
    assert.equal(demo.constructionTrace.constructionPlanEvidence.settingCount >= 5, true);
    assert.equal(demo.constructionTrace.constructionPlanEvidence.eventCount >= 6, true);
    assert.equal(demo.constructionTrace.constructionPlanEvidence.bindingCount >= 6, true);
    assert.equal(demo.constructionTrace.constructionPlanEvidence.slotCount >= 4, true);
    assert.equal(demo.constructionTrace.constructionPlanEvidence.theme.editorPanel, 'theme-editor');
    assert.equal(demo.constructionTrace.adaptiveThemeEvidence.responsiveMode, 'drawer');
    assert.equal(demo.constructionTrace.adaptiveThemeEvidence.themeParams.mode, 'dark');
    assert.equal(
      demo.constructionTrace.adaptiveThemeEvidence.themeEditorBinding.path,
      'theme'
    );
    assert.deepEqual(
      demo.constructionTrace.selectedModules.map((item) => item.panelType).sort(),
      demo.requiredWidgets.slice().sort()
    );
    for (let stage of demo.stages) {
      assert.equal(validateWorkspaceConfig(stage.config, { strict: true }).valid, true);
      assert.ok(stage.chat.length > 0);
      assert.ok(stage.config.construction.questions.length > 0);
      assert.equal(stage.chatState.activeQuestionId, stage.activeQuestionId);
      assert.ok(stage.chatState.nextPatch);
      assert.ok(stage.chatState.decisionTrace.length > 0);
    }
    let answeredQuestionIds = finalStage.config.construction.questions
      .filter((question) => question.status === 'answered')
      .map((question) => question.id);
    assert.deepEqual(
      finalStage.chatState.decisionTrace.map((decision) => decision.questionId),
      answeredQuestionIds
    );
    for (let required of demo.requiredWidgets) {
      assert.ok(panels.includes(required), `${required} panel is registered`);
    }
    assert.deepEqual(
      collectLayoutPanels(finalStage.config.layout).sort(),
      demo.requiredWidgets.slice().sort()
    );
    assert.ok(finalStage.config.events.length >= 4);
    assert.ok(finalStage.config.data.bindings.length >= 6);
    assert.equal(finalStage.config.components.modules.length, demo.requiredWidgets.length);
    assert.deepEqual(
      finalStage.config.components.modules.map((item) => item.provider),
      Array(demo.requiredWidgets.length).fill('symbiote-ui')
    );
    assert.deepEqual(
      finalStage.config.construction.plan.modules.map((item) => item.panelType).sort(),
      demo.requiredWidgets.slice().sort()
    );
    assert.equal(finalStage.config.construction.plan.layout.topology, 'bsp-workbench');
    assert.equal(finalStage.config.construction.plan.layout.regions.quality.includes('theme-editor'), true);
    assert.equal(
      finalStage.config.construction.plan.modules
        .find((item) => item.panelType === 'theme-editor')
        .bindings[0].path,
      'theme'
    );
    assert.equal(
      finalStage.config.construction.plan.modules
        .find((item) => item.panelType === 'layout-builder')
        .settings.length >= 2,
      true
    );
    assert.equal(
      finalStage.config.construction.plan.modules
        .find((item) => item.panelType === 'agent-chat')
        .events.emits.some((event) => event.name === 'questionnaire-answer'),
      true
    );
    assert.ok(finalStage.config.validation.reports.some((report) => report.check === 'theme'));
    assert.deepEqual(
      finalStage.chatState.requiredElements,
      demo.requiredWidgets
    );
    assert.equal(finalStage.chatState.themeCascade.editorWidget, 'theme-editor');
    assert.ok(finalStage.chatState.adaptiveBehavior.collapseOrder.includes('adaptive-rules'));
    assert.deepEqual(
      finalStage.chatState.adaptiveScenarios.map((scenario) => scenario.mode),
      ['wide', 'tablet', 'mobile']
    );
    assert.ok(
      finalStage.chatState.adaptiveScenarios
        .find((scenario) => scenario.mode === 'mobile')
        .dockedPanels.includes('theme-editor')
    );
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
      assert.deepEqual(contract.constructionTrace.capabilityCoverage.missing, []);
      assert.equal(contract.constructionTrace.exportImportEvidence.valid, true);
      assert.equal(contract.constructionTrace.constructionPlanEvidence.topology, 'bsp-workbench');
      assert.equal(contract.constructionTrace.constructionPlanEvidence.moduleCount, 8);
      assert.equal(contract.constructionTrace.constructionPlanEvidence.eventCount >= 6, true);
      assert.equal(contract.constructionTrace.adaptiveThemeEvidence.breakpoint, 860);
      assert.equal(
        contract.constructionTrace.adaptiveThemeEvidence.themeEditorSubtree.params.hue,
        280
      );
      assert.equal(config.construction.plan.layout.topology, 'bsp-workbench');
      assert.equal(config.construction.plan.modules.length, 8);
      assert.equal(config.components.modules.length, 8);
      assert.equal(
        config.construction.plan.modules
          .find((item) => item.panelType === 'theme-editor')
          .bindings[0].path,
        'theme'
      );
      assert.deepEqual(contract.buildStreamTimeline.map((item) => item.progress), [25, 50, 75, 100]);
      assert.equal(contract.buildStreamTimeline.at(-1).operations.length, 4);
      assert.equal(contract.chatStateTimeline.length, 4);
      assert.equal(contract.chatStateTimeline.at(-1).requiredElements.includes('theme-editor'), true);
      assert.deepEqual(
        contract.chatStateTimeline.at(-1).adaptiveScenarios.map((scenario) => scenario.mode),
        ['wide', 'tablet', 'mobile']
      );
      assert.equal(
        contract.chatStateTimeline.at(-1).adaptiveScenarios
          .find((scenario) => scenario.mode === 'mobile')
          .themeEditor,
        'visible-or-docked'
      );
      assert.equal(contract.chatStateTimeline.at(-1).decisionTrace.length, 5);
      assert.match(html, /<script type="importmap">/);
      assert.match(app, /mountWorkspace/);
      assert.match(app, /from 'symbiote-ui\/ui'/);
      assert.doesNotMatch(app, /symbiote-ui\/layout\/Layout\/Layout\.js/);
      assert.doesNotMatch(app, /symbiote-ui\/chat\/ChatWorkspace\/ChatWorkspace\.js/);
      assert.doesNotMatch(app, /symbiote-ui\/themes\/CascadeThemeEditor\/CascadeThemeEditor\.js/);
      assert.doesNotMatch(app, /symbiote-ui\/themes\/CascadeThemeWidget\/CascadeThemeWidget\.js/);
      assert.doesNotMatch(app, /symbiote-ui\/control\/Button\/Button\.js/);
      assert.equal(app.includes('CASCADE_THEME_DEFAULTS'), true);
      assert.match(app, /createSymbioteLayoutRuntime/);
      assert.equal(app.includes("document.createElement('panel-layout')"), true);
      assert.equal(app.includes('customElements.define'), true);
      assert.match(app, /chat-workspace/);
      assert.match(app, /cascade-theme-editor/);
      assert.match(app, /cascade-theme-widget/);
      assert.match(app, /sn-card/);
      assert.match(app, /sn-description-list/);
      assert.match(app, /sn-segmented-control/);
      assert.match(app, /sn-agent-chat-panel/);
      assert.match(app, /sn-theme-editor-widget/);
      assert.match(app, /Play/);
      assert.match(app, /demo-build-progress/);
      assert.match(app, /operationIndex/);
      assert.match(app, /dataset\.buildKind/);
      assert.match(app, /Service blueprint/);
      assert.match(app, /Widget registry/);
      assert.match(app, /dataset\.collapsedPanels/);
      assert.match(app, /dataset\.themeEditorState/);
      assert.match(app, /mounted\.updateConfig\(stage\.config/);
      assert.doesNotMatch(app, /\b(?:attachShadow|shadowRoot)\b/);
      assert.match(app, /updateConfig\(nextConfig, options = \{\}\)/);
      assert.match(app, /dataset\.runtimeInstanceId/);
      assert.match(app, /dataset\.atomicUpdateCount/);
      assert.match(app, /dataset\.lastUpdatedStage/);
      assert.match(app, /layout\.\$\.layoutTree = normalizeLayoutNode\(nextConfig\.layout\)/);
      assert.doesNotMatch(app, /mounted\.destroy\(\);\s*mounted = null;/);
      assert.match(app, /cascade-theme-open-full/);
      assert.match(app, /openPanel\?\.\('theme-editor'/);
      assert.match(app, /applyAdaptiveScenario/);
      assert.match(app, /renderStage\(demo\.stages\.length - 1\)/);
      assert.match(app, /data-adaptive-state="collapsed"/);
      assert.doesNotMatch(app, /class="demo-chat"/);
      assert.doesNotMatch(app, /class="demo-inspector"/);
      assert.doesNotMatch(states, /default-light/);
      assert.match(states, /default-dark-cascade/);
      assert.equal(html.includes('"symbiote-ui/"'), true);
      assert.equal(html.includes('"symbiote-ui/ui"'), true);
      assert.equal(html.includes('"symbiote-engine/"'), true);
      assert.equal(html.includes('"symbiote-engine/contracts"'), true);
      assert.equal(html.includes('"/__symbiote_engine__/contracts/index.js"'), true);
      assert.equal(html.includes('"@symbiotejs/symbiote"'), true);
      assert.doesNotMatch(app, /\/Users\//);
      assert.doesNotMatch(states, /localhost|\/Users\//);
      assert.equal(config.panelTypes['theme-editor'].component, 'sn-theme-editor-widget');
    });
  });

  it('exposes realtime builder browser smoke mode', async () => {
    let smoke = await readFile('examples/visual-demo/browser-smoke.js', 'utf8');

    assert.match(smoke, /--demo/);
    assert.match(smoke, /realtime-builder/);
    assert.match(smoke, /Realtime builder Play/);
    assert.match(smoke, /data-action="play"/);
    assert.match(smoke, /mobile adaptive preview/);
    assert.match(smoke, /panel-layout/);
    assert.match(smoke, /chat-workspace/);
    assert.match(smoke, /cascade-theme-widget/);
    assert.match(smoke, /cascade-theme-editor/);
    assert.match(smoke, /hasAttribute\('storage-key'\)/);
    assert.match(smoke, /hasAttribute\('target-selector'\)/);
    assert.match(smoke, /customElements\.get\('cascade-theme-editor'\)/);
    assert.match(smoke, /themeWidgetUsesDefaults/);
    assert.match(smoke, /themeEditorDefined/);
    assert.match(smoke, /sn-card/);
    assert.match(smoke, /sn-button/);
    assert.match(smoke, /sn-segmented-control/);
    assert.match(smoke, /\.demo-chat, \.demo-inspector/);
    assert.match(smoke, /appShadowHosts\.length === 0/);
    assert.match(smoke, /runtimeInstanceId/);
    assert.match(smoke, /atomicUpdateCount/);
    assert.match(smoke, /mountedWorkspace/);
    assert.match(smoke, /mountedWorkspace = workspace\?\.querySelector\('\.symbiote-workspace'\)/);
    assert.match(smoke, /lastUpdatedStage === 'validation'/);
    assert.match(smoke, /cascade-theme-open-full/);
    assert.match(smoke, /data-adaptive-state="docked"/);
    assert.match(smoke, /themeEditorState/);
    assert.doesNotMatch(smoke, /demo-build-step/);
    assert.doesNotMatch(smoke, /Adaptive and theme state/);
    assert.doesNotMatch(smoke, /Adaptive preview/);
    assert.doesNotMatch(smoke, /Construction tool trace/);
    assert.doesNotMatch(smoke, /themeMode === 'light'/);
  });

  it('serves extensionless package subpaths for browser import maps', async () => {
    await withTempDir(async (dir) => {
      let outputDir = join(dir, 'out');
      let workspaceRoot = join(dir, 'workspace');
      let uiRoot = join(dir, 'ui');
      let engineRoot = join(dir, 'engine');
      let symbioteRoot = join(dir, 'symbiote');
      await Promise.all([
        mkdir(outputDir, { recursive: true }),
        mkdir(workspaceRoot, { recursive: true }),
        mkdir(uiRoot, { recursive: true }),
        mkdir(join(engineRoot, 'contracts'), { recursive: true }),
        mkdir(symbioteRoot, { recursive: true }),
      ]);
      await writeFile(join(outputDir, 'index.html'), '<!doctype html>');
      await writeFile(join(engineRoot, 'contracts', 'index.js'), 'export const contract = true;');
      let server = await startStaticServer({
        outputDir,
        workspaceRoot,
        uiRoot,
        engineRoot,
        symbioteRoot,
        port: 0,
      });
      try {
        let port = server.address().port;
        let response = await httpText(port, '/__symbiote_engine__/contracts');
        assert.equal(response.statusCode, 200);
        assert.match(response.contentType, /text\/javascript/);
        assert.equal(response.body, 'export const contract = true;');
      } finally {
        await new Promise((resolveClose) => server.close(resolveClose));
      }
    });
  });
});
