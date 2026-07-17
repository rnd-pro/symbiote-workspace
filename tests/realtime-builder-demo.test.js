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
import {
  browserPackageImports,
  startRealtimeBrowserPreview,
} from '../examples/visual-demo/browser-smoke.js';
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

    assert.deepEqual(
      demo.stages.map((stage) => stage.id),
      [
        'workspace-name',
        'target-register',
        'layout-topology',
        'module-selection',
        'execution-model',
        'required-host-services',
        'theme-mode',
        'theme-hue',
        'verification-scope',
      ]
    );
    assert.equal(demo.acceptanceMatrix.every((item) => item.status === 'pass'), true);
    assert.ok(demo.acceptanceMatrix.some((item) => item.id === 'construction-tool-lineage'));
    assert.ok(demo.acceptanceMatrix.some((item) => item.id === 'current-protocol-visible'));
    assert.ok(demo.acceptanceMatrix.some((item) => item.id === 'package-readiness-visible'));
    assert.ok(demo.acceptanceMatrix.some((item) => item.id === 'runtime-import-contract-visible'));
    assert.ok(demo.acceptanceMatrix.some((item) => item.id === 'professional-scenario-matrix'));
    assert.ok(demo.acceptanceMatrix.some((item) => item.id === 'professional-library-surfaces'));
    assert.ok(demo.acceptanceMatrix.some((item) => item.id === 'template-manual-edit-existing-modes'));
    assert.equal(demo.defaultScenarioId, 'video-editing');
    assert.deepEqual(
      demo.professionalScenarios.map((scenario) => scenario.id),
      ['video-editing', 'automation-editing', 'agent-programming', 'constructor-control']
    );
    assert.deepEqual(
      demo.professionalScenarios.map((scenario) => scenario.sourceTemplate),
      ['video-studio', 'social-automation', 'agent-workspace + editor', 'template/manual/edit-existing']
    );
    assert.deepEqual(
      demo.professionalScenarios.map((scenario) => scenario.topology),
      ['timeline-first', 'canvas-first', 'chat-first-workbench', 'constructor-shell']
    );
    assert.deepEqual(
      demo.professionalComponentContract.templateContractGaps,
      ['sn-timeline-editor', 'sn-canvas-viewport']
    );
    assert.deepEqual(
      [
        'chat-workspace',
        'sn-video-player',
        'node-canvas',
        'canvas-graph',
        'sn-data-table',
        'sn-rich-text-editor',
        'sn-kanban-board',
        'source-editor',
        'sn-source-diff',
        'code-block',
        'cascade-theme-editor',
      ].filter((component) => !demo.professionalComponentContract.publicComponents.includes(component)),
      []
    );
    let scenarioPanels = Object.fromEntries(demo.professionalScenarios.map((scenario) => [
      scenario.id,
      Object.values(scenario.config.panelTypes).map((panelConfig) => panelConfig.component),
    ]));
    assert.deepEqual(
      scenarioPanels['video-editing'],
      ['chat-workspace', 'sn-video-player', 'sn-timeline', 'node-canvas', 'canvas-graph']
    );
    assert.deepEqual(
      scenarioPanels['automation-editing'],
      ['chat-workspace', 'node-canvas', 'sn-data-table', 'sn-rich-text-editor', 'sn-kanban-board', 'sn-timeline', 'sn-file-upload']
    );
    assert.deepEqual(
      scenarioPanels['agent-programming'],
      ['chat-workspace', 'sn-tree-panel', 'source-editor', 'sn-source-diff', 'code-block', 'sn-event-feed', 'node-canvas', 'canvas-graph']
    );
    assert.deepEqual(
      scenarioPanels['constructor-control'],
      ['layout-shell-menu', 'project-tabs', 'palette-browser', 'panel-layout', 'inspector-panel', 'cascade-theme-editor', 'sn-menu']
    );
    let chatScenarios = demo.professionalScenarios.filter((scenario) => scenario.panelData?.chat);
    assert.ok(chatScenarios.length >= 3);
    for (let scenario of chatScenarios) {
      let chatState = scenario.panelData?.chat?.workspaceState;
      assert.equal(chatState?.voiceControls?.input?.visible, true);
      assert.equal(chatState?.voiceControls?.input?.state, 'idle');
      assert.equal(chatState?.voiceControls?.command?.visible, false);
      assert.equal(chatState?.voiceControls?.language?.mode, 'auto');
      assert.equal(chatState?.composer?.leadingControls?.[0]?.icon, 'attach_file');
      assert.ok(chatState?.composer?.attachedContext?.length >= 2);
      assert.ok(chatState?.messages?.some((message) => message.role === 'agent'));
      assert.ok(chatState?.messages?.some((message) => message.role === 'tool'));
      assert.ok(chatState?.messages?.some((message) => message.role === 'thinking'));
      assert.ok(chatState?.messages?.some((message) => message.role === 'board'));
    }
    let expectedScenarioConfigTemplates = {
      'video-editing': 'video-studio',
      'automation-editing': 'social-automation',
      'agent-programming': 'agent-workspace',
      'constructor-control': 'template/manual/edit-existing',
    };
    for (let scenario of demo.professionalScenarios) {
      let validation = validateWorkspaceConfig(scenario.config, { strict: true });
      assert.equal(validation.valid ?? validation.ok, true, JSON.stringify(validation.errors || validation.warnings || validation));
      assert.equal(scenario.config.construction.plan.scenarioId, scenario.id);
      assert.equal(scenario.config.construction.sourceTemplate, expectedScenarioConfigTemplates[scenario.id]);
      assert.ok(scenario.panelData);
      assert.ok(scenario.acceptance.length >= 5);
    }
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
    assert.deepEqual(
      demo.constructionTrace.visibleQuestionIds,
      demo.constructionTrace.canonicalQuestionIds
    );
    assert.equal(demo.constructionTrace.currentFunctionality.executionModel, 'automation-bridge');
    assert.equal(demo.constructionTrace.executionEvidence.model, 'automation-bridge');
    assert.deepEqual(
      demo.constructionTrace.currentFunctionality.hostServices,
      ['agent.runtime', 'storage.project']
    );
    assert.deepEqual(
      demo.constructionTrace.executionEvidence.requiredHostServices,
      ['agent.runtime', 'storage.project']
    );
    assert.equal(demo.constructionTrace.packageEvidence.readiness.strictExport, true);
    assert.equal(demo.constructionTrace.packageEvidence.readiness.strictImport, true);
    assert.deepEqual(
      demo.constructionTrace.currentFunctionality.importMapKeys,
      [
        '@symbiotejs/symbiote',
        '@symbiotejs/symbiote/',
        'symbiote-engine',
        'symbiote-engine/',
        'symbiote-engine/contracts',
        'symbiote-ui/',
        'symbiote-ui/ui',
        'symbiote-workspace/browser',
      ]
    );
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
      let validation = validateWorkspaceConfig(stage.config, { strict: true });
      assert.equal(validation.valid ?? validation.ok, true, JSON.stringify(validation.errors || validation.warnings || validation));
      assert.ok(stage.chat.length > 0);
      assert.ok(stage.config.construction.questions.length > 0);
      assert.equal(stage.chatState.activeQuestionId, stage.activeQuestionId);
      assert.equal(stage.id, stage.activeQuestionId);
      assert.ok(stage.chatState.nextPatch);
      assert.ok(stage.chatState.decisionTrace.length > 0);
      assert.ok(stage.chatState.currentFunctionality);
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
    assert.equal(finalStage.config.intent.executionModel, 'automation-bridge');
    assert.deepEqual(finalStage.config.intent.hostServices, ['agent.runtime', 'storage.project']);
    assert.deepEqual(finalStage.config.execution, {
      model: 'automation-bridge',
      hostServices: ['agent.runtime', 'storage.project'],
    });
    assert.deepEqual(finalStage.config.construction.plan.execution.requiredHostServices, [
      'agent.runtime',
      'storage.project',
    ]);
    assert.deepEqual(finalStage.chatState.currentFunctionality.hostServices, [
      'agent.runtime',
      'storage.project',
    ]);
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
      assert.equal(contract.defaultScenarioId, 'video-editing');
      assert.deepEqual(
        contract.professionalScenarios.map((scenario) => scenario.id),
        ['video-editing', 'automation-editing', 'agent-programming', 'constructor-control']
      );
      assert.deepEqual(
        contract.professionalScenarios.map((scenario) => scenario.sourceTemplate),
        ['video-studio', 'social-automation', 'agent-workspace + editor', 'template/manual/edit-existing']
      );
      assert.deepEqual(
        [
          'sn-video-player',
          'node-canvas',
          'canvas-graph',
          'sn-data-table',
          'sn-rich-text-editor',
          'sn-kanban-board',
          'source-editor',
          'sn-source-diff',
          'code-block',
          'cascade-theme-editor',
        ].filter((component) => !contract.professionalScenarios
          .flatMap((scenario) => scenario.components)
          .includes(component)),
        []
      );
      assert.deepEqual(
        contract.professionalComponentContract.templateContractGaps,
        ['sn-timeline-editor', 'sn-canvas-viewport']
      );
      assert.deepEqual(contract.playStages, [
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
      assert.deepEqual(contract.constructionTrace.capabilityCoverage.missing, []);
      assert.equal(contract.constructionTrace.exportImportEvidence.valid, true);
      assert.equal(contract.currentFunctionality.executionModel, 'automation-bridge');
      assert.equal(contract.executionEvidence.model, 'automation-bridge');
      assert.deepEqual(contract.currentFunctionality.hostServices, ['agent.runtime', 'storage.project']);
      assert.deepEqual(contract.executionEvidence.requiredHostServices, ['agent.runtime', 'storage.project']);
      assert.equal(contract.packageEvidence.readiness.strictExport, true);
      assert.equal(contract.packageEvidence.readiness.strictImport, true);
      assert.deepEqual(
        contract.currentFunctionality.visibleQuestionIds,
        contract.constructionTrace.canonicalQuestionIds
      );
      assert.equal(contract.currentFunctionality.packageReadiness.strictExport, true);
      assert.equal(contract.currentFunctionality.packageReadiness.strictImport, true);
      assert.equal(contract.currentFunctionality.runtimeImportContract.hasBarePackageRoutes, true);
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
      assert.deepEqual(
        contract.buildStreamTimeline.map((item) => item.stage),
        contract.playStages
      );
      assert.deepEqual(
        contract.buildStreamTimeline.map((item) => item.progress),
        [11, 22, 33, 44, 56, 67, 78, 89, 100]
      );
      assert.equal(contract.buildStreamTimeline.at(-1).operations.length, 4);
      assert.equal(contract.chatStateTimeline.length, 9);
      assert.deepEqual(
        contract.chatStateTimeline.map((item) => item.activeQuestionId),
        contract.playStages
      );
      assert.equal(contract.chatStateTimeline.at(-1).requiredElements.includes('theme-editor'), true);
      assert.deepEqual(
        contract.chatStateTimeline.at(-1).currentFunctionality.hostServices,
        ['agent.runtime', 'storage.project']
      );
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
      assert.equal(contract.chatStateTimeline.at(-1).decisionTrace.length, 9);
      assert.match(html, /<script type="importmap">/);
      assert.match(app, /mountWorkspace/);
      assert.match(app, /from 'symbiote-ui\/ui'/);
      assert.match(app, /symbiote-ui\/board/);
      assert.doesNotMatch(app, /symbiote-ui\/layout\/Layout\/Layout\.js/);
      assert.doesNotMatch(app, /symbiote-ui\/chat\/ChatWorkspace\/ChatWorkspace\.js/);
      assert.doesNotMatch(app, /symbiote-ui\/themes\/CascadeThemeEditor\/CascadeThemeEditor\.js/);
      assert.doesNotMatch(app, /symbiote-ui\/themes\/CascadeThemeWidget\/CascadeThemeWidget\.js/);
      assert.doesNotMatch(app, /symbiote-ui\/control\/Button\/Button\.js/);
      assert.equal(app.includes('CASCADE_THEME_DEFAULTS'), true);
      assert.match(app, /createSymbioteLayoutRuntime/);
      assert.equal(app.includes("document.createElement('panel-layout')"), true);
      assert.equal(app.includes('customElements.define'), false);
      assert.match(app, /defineModule\(tagName/);
      assert.match(app, /chat-workspace/);
      assert.match(app, /cascade-theme-editor/);
      assert.match(app, /cascade-theme-widget/);
      assert.match(app, /sn-card/);
      assert.match(app, /sn-description-list/);
      assert.match(app, /sn-segmented-control/);
      assert.match(app, /chat-workspace/);
      assert.match(app, /panel-layout/);
      assert.match(app, /cascade-theme-editor/);
      assert.doesNotMatch(app, /sn-agent-chat-panel/);
      assert.doesNotMatch(app, /sn-service-blueprint-panel/);
      assert.doesNotMatch(app, /sn-layout-builder-surface/);
      assert.doesNotMatch(app, /sn-widget-registry-panel/);
      assert.doesNotMatch(app, /sn-bindings-inspector-panel/);
      assert.doesNotMatch(app, /sn-adaptive-rules-panel/);
      assert.doesNotMatch(app, /sn-validation-checklist-panel/);
      assert.doesNotMatch(app, /sn-theme-editor-widget/);
      assert.match(app, /activeScenarioId/);
      assert.match(app, /renderScenarioRail/);
      assert.match(app, /scenarioSidebarSections/);
      assert.match(app, /syncScenarioSidebar/);
      assert.match(app, /sidebarActiveByScenario/);
      assert.match(app, /scenarioPanelOrder/);
      assert.match(app, /visibleScenarioPanelTypes/);
      assert.match(app, /mountedScenarioPanelTypes/);
      assert.match(app, /hydratedScenarioPanelTypes/);
      assert.match(app, /buildPhaseState/);
      assert.match(app, /progressiveScenarioConfig/);
      assert.match(app, /pruneLayoutNode/);
      assert.match(app, /filterScenarioModules/);
      assert.match(app, /sn-empty-state/);
      assert.match(app, /layoutSidebar\.setSections/);
      assert.match(app, /sidebarVisible: false/);
      assert.match(app, /dataset\.contextScenarioId/);
      assert.match(app, /dataset\.activeSidebarSection/);
      assert.match(app, /dataset\.mountedSectionIds/);
      assert.match(app, /dataset\.pendingSectionIds/);
      assert.match(app, /professional-scenario:\$\{scenario\.id\}/);
      assert.match(app, /dataset\.scenarioId/);
      assert.match(app, /dataset\.scenarioTemplate/);
      assert.match(app, /dataset\.professionalScenario/);
      assert.match(app, /dataset\.assemblyPhase/);
      assert.match(app, /dataset\.assemblyPhaseProgress/);
      assert.match(app, /dataset\.visibleScenarioPanels/);
      assert.match(app, /dataset\.visibleScenarioPanelCount/);
      assert.match(app, /dataset\.mountedScenarioPanels/);
      assert.match(app, /dataset\.mountedScenarioPanelCount/);
      assert.match(app, /dataset\.hydratedScenarioPanels/);
      assert.match(app, /dataset\.hydratedScenarioPanelCount/);
      assert.match(app, /dataset\.plannedScenarioPanels/);
      assert.match(app, /dataset\.plannedScenarioPanelCount/);
      assert.match(app, /dataset\.uiAssemblyStep/);
      assert.match(app, /dataset\.uiAssemblyTotal/);
      assert.match(app, /dataset\.buildPanelTypes/);
      assert.match(app, /dataset\.mountedPanelTypes/);
      assert.match(app, /dataset\.hydratedPanelTypes/);
      assert.match(app, /dataset\.plannedPanelTypes/);
      assert.match(app, /video-editing/);
      assert.match(app, /automation-editing/);
      assert.match(app, /agent-programming/);
      assert.match(app, /constructor-control/);
      assert.match(app, /sn-video-player/);
      assert.match(app, /node-canvas/);
      assert.match(app, /canvas-graph/);
      assert.match(app, /sn-data-table/);
      assert.match(app, /sn-rich-text-editor/);
      assert.match(app, /sn-kanban-board/);
      assert.match(app, /sn-file-upload/);
      assert.match(app, /sn-tree-panel/);
      assert.match(app, /source-editor/);
      assert.match(app, /sn-source-diff/);
      assert.match(app, /code-block/);
      assert.match(app, /sn-event-feed/);
      assert.match(app, /layout-shell-menu/);
      assert.match(app, /project-tabs/);
      assert.match(app, /palette-browser/);
      assert.match(app, /Play/);
      assert.match(app, /demo-action-label/);
      assert.match(app, /demo-build-progress/);
      assert.match(app, /demo-operation-chip/);
      assert.match(app, /chat-workspace-view/);
      assert.match(app, /demoVoiceControls/);
      assert.match(app, /operationIndex/);
      assert.match(app, /dataset\.buildKind/);
      assert.match(app, /dataset\.executionModel/);
      assert.match(app, /dataset\.hostServices/);
      assert.match(app, /dataset\.packageReadiness/);
      assert.match(app, /currentFunctionality/);
      assert.match(app, /Host services/);
      assert.match(app, /Package readiness/);
      assert.match(app, /Runtime imports/);
      assert.match(app, /packageEvidence\.dataset\.packageReadiness/);
      assert.match(app, /dataset\.collapsedPanels/);
      assert.match(app, /dataset\.themeEditorState/);
      assert.match(app, /defineModule\(tagName/);
      assert.doesNotMatch(app, /customElements\.define\(tagName, class extends HTMLElement/);
      assert.match(app, /mounted\.updateConfig\(config/);
      assert.doesNotMatch(app, /\b(?:attachShadow|shadowRoot)\b/);
      assert.match(app, /updateConfig\(nextConfig, options = \{\}\)/);
      assert.match(app, /dataset\.runtimeInstanceId/);
      assert.match(app, /dataset\.atomicUpdateCount/);
      assert.match(app, /dataset\.lastUpdatedStage/);
      assert.match(app, /recordThemeTransitionEvidence/);
      assert.match(app, /dataset\.themeTransitionStage/);
      assert.match(app, /themeTransitionSource = 'cascade-theme-change'/);
      assert.match(app, /themeTransitionChanged/);
      assert.match(app, /themeTransitionFromComputedHue/);
      assert.match(app, /themeTransitionToComputedHue/);
      assert.match(app, /themeTransitionComputedChanged/);
      assert.match(app, /themeTransitionUpdateCount/);
      assert.match(app, /layout\.\$\.layoutTree = normalizeLayoutNode\(nextConfig\.layout\)/);
      assert.doesNotMatch(app, /mounted\.destroy\(\);\s*mounted = null;/);
      assert.match(app, /cascade-theme-open-full/);
      assert.match(app, /openPanel\?\.\('theme-editor'/);
      assert.match(app, /applyAdaptiveScenario/);
      assert.match(app, /renderStage\(0\);/);
      assert.doesNotMatch(app, /renderStage\(demo\.stages\.length - 1\)/);
      assert.doesNotMatch(app, /operationIndex = buildOperations\(demo\.stages\.at\(-1\)\)\.length - 1/);
      assert.match(app, /data-adaptive-state="collapsed"/);
      assert.doesNotMatch(app, /class="demo-chat"/);
      assert.doesNotMatch(app, /class="demo-inspector"/);
      assert.doesNotMatch(states, /default-light/);
      assert.match(states, /default-dark-cascade/);
      assert.match(states, /"voiceControls"/);
      assert.match(states, /"role": "tool"/);
      assert.match(states, /"role": "thinking"/);
      assert.match(states, /"role": "board"/);
      assert.equal(html.includes('"symbiote-ui/"'), true);
      assert.equal(html.includes('"symbiote-ui/ui"'), true);
      assert.equal(html.includes('"symbiote-engine/"'), true);
      assert.equal(html.includes('"symbiote-engine/contracts"'), true);
      assert.equal(html.includes('"/__symbiote_engine__/contracts/index.js"'), true);
      assert.equal(html.includes('"@symbiotejs/symbiote"'), true);
      assert.doesNotMatch(app, /\/Users\//);
      assert.doesNotMatch(states, /localhost|\/Users\//);
      assert.equal(config.panelTypes['theme-editor'].component, 'cascade-theme-editor');
    });
  });

  it('exposes realtime builder browser smoke mode', async () => {
    let smoke = await readFile('examples/visual-demo/browser-smoke.js', 'utf8');

    assert.match(smoke, /--demo/);
    assert.match(smoke, /realtime-builder/);
    assert.match(smoke, /browserCacheCandidates/);
    assert.match(smoke, /symbiote-ui-browsers/);
    assert.match(smoke, /puppeteer/);
    assert.match(smoke, /Google Chrome for Testing/);
    assert.match(smoke, /SYMBIOTE_BROWSER_HEADLESS/);
    assert.match(smoke, /--headless/);
    assert.match(smoke, /`--headless=\$\{headless\}`/);
    assert.match(smoke, /SYMBIOTE_BROWSER_DRIVER/);
    assert.match(smoke, /--driver/);
    assert.match(smoke, /playwright/);
    assert.match(smoke, /SYMBIOTE_PLAYWRIGHT_BROWSER/);
    assert.match(smoke, /--playwright-browser/);
    assert.match(smoke, /runPlaywrightSmoke/);
    assert.match(smoke, /createPlaywrightDiagnostics/);
    assert.match(smoke, /page\.evaluate\(\(source\) => globalThis\.eval\(source\), expression\)/);
    assert.match(smoke, /browser: `playwright:\$\{result\.browserName\}`/);
    assert.match(smoke, /SYMBIOTE_BROWSER_CDP_PORT/);
    assert.match(smoke, /DevToolsActivePort/);
    assert.match(smoke, /readDevToolsActivePort/);
    assert.match(smoke, /Invalid Chrome DevTools Protocol port/);
    assert.match(smoke, /if \(cdpPort === 0\)/);
    assert.match(smoke, /waitForCdp\(cdpPort, timeout, browserProcess\)/);
    assert.match(smoke, /Browser exited before Chrome DevTools Protocol/);
    assert.match(smoke, /Browser exited before Chrome wrote DevToolsActivePort/);
    assert.match(smoke, /Realtime builder Play/);
    assert.match(smoke, /data-action="play"/);
    assert.match(smoke, /mobile adaptive preview/);
    assert.match(smoke, /panel-layout/);
    assert.match(smoke, /chat-workspace/);
    assert.match(smoke, /cascade-theme-widget/);
    assert.match(smoke, /cascade-theme-editor/);
    assert.match(smoke, /video-editing/);
    assert.match(smoke, /automation-editing/);
    assert.match(smoke, /agent-programming/);
    assert.match(smoke, /constructor-control/);
    assert.match(smoke, /sn-video-player/);
    assert.match(smoke, /node-canvas/);
    assert.match(smoke, /canvas-graph/);
    assert.match(smoke, /sn-data-table/);
    assert.match(smoke, /sn-rich-text-editor/);
    assert.match(smoke, /sn-kanban-board/);
    assert.match(smoke, /sn-file-upload/);
    assert.match(smoke, /sn-tree-panel/);
    assert.match(smoke, /source-editor/);
    assert.match(smoke, /sn-source-diff/);
    assert.match(smoke, /code-block/);
    assert.match(smoke, /sn-event-feed/);
    assert.match(smoke, /layout-shell-menu/);
    assert.match(smoke, /project-tabs/);
    assert.match(smoke, /palette-browser/);
    assert.match(smoke, /hasAttribute\('storage-key'\)/);
    assert.match(smoke, /hasAttribute\('target-selector'\)/);
    assert.match(smoke, /customElements\.get\('cascade-theme-editor'\)/);
    assert.match(smoke, /themeWidgetUsesDefaults/);
    assert.match(smoke, /themeEditorDefined/);
    assert.match(smoke, /\.demo-chat, \.demo-inspector/);
    assert.match(smoke, /appShadowHosts\.length === 0/);
    assert.match(smoke, /runtimeInstanceId/);
    assert.match(smoke, /atomicUpdateCount/);
    assert.match(smoke, /scenarioRailReady/);
    assert.match(smoke, /sidebarContextReady/);
    assert.match(smoke, /sidebarSectionIds/);
    assert.match(smoke, /id\.startsWith\(scenarioId \+ ':'\)/);
    assert.match(smoke, /switchScenario/);
    assert.match(smoke, /scenarioUpdateCounts/);
    assert.match(smoke, /scenarioDataProofs/);
    assert.match(smoke, /scenarioDataProofReady/);
    assert.match(smoke, /scenarioProviderDefinitionState/);
    assert.match(smoke, /scenarioProvidersDefined/);
    assert.match(smoke, /customElements\.get\(tagName\)/);
    assert.match(smoke, /scenarioProviderDefinitionEvidence/);
    assert.match(smoke, /data-demo-proof/);
    assert.match(smoke, /Product shot/);
    assert.match(smoke, /LinkedIn/);
    assert.match(smoke, /applyPatch/);
    assert.match(smoke, /validateWorkspacePatch/);
    assert.match(smoke, /video-studio/);
    assert.match(smoke, /agent-workspace/);
    assert.match(smoke, /Export workspace/);
    assert.match(smoke, /professionalScenario/);
    assert.match(smoke, /history\.length/);
    assert.match(smoke, /initialHistoryLength/);
    assert.match(smoke, /initialLocationHref/);
    assert.match(smoke, /atomicStageCounts/);
    assert.match(smoke, /atomicStageCountsReady/);
    assert.match(smoke, /initialAssemblyEvidence/);
    assert.match(smoke, /assemblySamples/);
    assert.match(smoke, /Realtime builder UI assembly moved backward/);
    assert.match(smoke, /previousAssemblyState/);
    assert.match(smoke, /initialAssemblyWasFullEmptyLayout/);
    assert.match(smoke, /Realtime builder initial state is not a full empty layout assembly/);
    assert.match(smoke, /finalAssemblyComplete/);
    assert.match(smoke, /mountedPanelTypes/);
    assert.match(smoke, /assemblyPhase === 'layout'/);
    assert.match(smoke, /visiblePanelCount === plannedPanelCount/);
    assert.match(smoke, /mountedPanelCount === 0/);
    assert.match(smoke, /hydratedPanelCount === 0/);
    assert.match(smoke, /emptyStateCount >= plannedPanelCount/);
    assert.match(smoke, /assemblyPhase === 'theme'/);
    assert.match(smoke, /__symbioteRealtimeSmokePromise/);
    assert.match(smoke, /mobileLayoutIdentityPreserved/);
    assert.match(smoke, /mobileWorkspaceIdentityPreserved/);
    assert.match(smoke, /\['theme-mode', 'theme-hue'\]\.includes\(themeTransitionStage\)/);
    assert.match(smoke, /themeTransitionSource === 'cascade-theme-change'/);
    assert.match(smoke, /themeTransitionChanged === 'true'/);
    assert.match(smoke, /themeTransitionFromMode === 'dark'/);
    assert.match(smoke, /themeTransitionToMode === 'dark'/);
    assert.match(smoke, /Number\(themeTransitionFromHue\) !== Number\(themeTransitionToHue\)/);
    assert.match(smoke, /themeTransitionFromComputedHue !== themeTransitionToComputedHue/);
    assert.match(smoke, /themeTransitionComputedChanged === 'true'/);
    assert.match(smoke, /themeTransitionUpdateCount > 0/);
    assert.match(smoke, /queryState/);
    assert.match(smoke, /mountedWorkspace/);
    assert.match(smoke, /lastUpdatedStage === 'verification-scope'/);
    assert.match(smoke, /data-current-evidence/);
    assert.match(smoke, /dataset\.executionModel/);
    assert.match(smoke, /dataset\.hostServices/);
    assert.match(smoke, /data-package-readiness/);
    assert.match(smoke, /cascade-theme-open-full/);
    assert.match(smoke, /data-adaptive-state/);
    assert.match(smoke, /themeEditorState/);
    assert.doesNotMatch(smoke, /demo-build-step/);
    assert.doesNotMatch(smoke, /Adaptive and theme state/);
    assert.doesNotMatch(smoke, /Adaptive preview/);
    assert.doesNotMatch(smoke, /Construction tool trace/);
    assert.doesNotMatch(smoke, /themeMode === 'light'/);
  });

  it('passes the current mounted revision to generated workspace updates', async () => {
    await withTempDir(async (dir) => {
      await writeRealtimeChatStateDemo({ outputDir: dir, port: 4567 });
      let app = await readFile(join(dir, 'app.js'), 'utf8');
      let updateCall = app.match(/mounted\.updateConfig\(config, \{([\s\S]*?)\n\s*\}\);/);

      assert.ok(updateCall, 'generated runtime must update the mounted workspace');
      assert.match(updateCall[1], /baseRevision: mounted\.revision,/);
      assert.doesNotMatch(updateCall[1], /baseRevision:\s*\d+/);
    });
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

  it('serves realtime browser imports from the installed package graph', async () => {
    await withTempDir(async (dir) => {
      let outputDir = join(dir, 'out');
      let preview = await startRealtimeBrowserPreview({ outputDir, port: 0 });
      try {
        let html = await readFile(join(outputDir, 'index.html'), 'utf8');
        let marker = '<script type="importmap">';
        let start = html.indexOf(marker) + marker.length;
        let end = html.indexOf('</script>', start);
        let importMap = JSON.parse(html.slice(start, end));

        assert.equal(preview.host.packages['symbiote-ui'].version, '0.3.0-alpha.63');
        assert.equal(preview.host.packages['symbiote-engine'].version, '0.3.0-alpha.13');
        assert.equal(preview.host.packages['@symbiotejs/symbiote'].version, '3.8.0-webmcp.2');
        assert.equal(
          importMap.imports['@symbiotejs/symbiote/utils'],
          '/__symbiote__/utils/index.js'
        );
        assert.equal(
          importMap.imports['symbiote-ui/ui'],
          '/__symbiote_ui__/ui/index.js'
        );
        assert.equal(
          importMap.imports['symbiote-engine/FocusController.js'],
          '/__symbiote_engine__/FocusController.js'
        );
        assert.equal(
          Object.values(importMap.imports).some((value) => value.includes('node_modules')),
          false
        );

        let routes = [
          '/__symbiote_ui__/control/Mentions/Mentions.js',
          '/__symbiote__/utils/index.js',
          '/__symbiote__/utils/setNestedProp.js',
          '/__symbiote__/utils/UID.js',
          '/__symbiote__/utils/dom-helpers.js',
          '/__symbiote__/utils/kebabToCamel.js',
          '/__symbiote__/utils/reassignDictionary.js',
          '/__symbiote_engine__/FocusController.js',
        ];
        let port = preview.server.address().port;
        for (let route of routes) {
          let response = await httpText(port, route);
          assert.equal(response.statusCode, 200, route);
          assert.match(response.contentType, /text\/javascript/, route);
          assert.notEqual(response.body.length, 0, route);
        }
      } finally {
        await new Promise((resolveClose) => preview.server.close(resolveClose));
      }
    });
  });

  it('maps package export aliases and wildcard prefixes to opaque browser routes', () => {
    let imports = browserPackageImports({
      name: '@scope/example',
      exports: {
        '.': {
          import: './browser.js',
          default: './index.js',
        },
        './utils': './utils/index.js',
        './features/*': './features/*',
      },
    }, '/__example__/');

    assert.deepEqual(imports, {
      '@scope/example': '/__example__/browser.js',
      '@scope/example/': '/__example__/',
      '@scope/example/features/': '/__example__/features/',
      '@scope/example/utils': '/__example__/utils/index.js',
    });
  });
});
