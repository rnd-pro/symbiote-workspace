import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  answerConstructionQuestion,
  buildConstructionQuestions,
  extractConstructionPlan,
  normalizeConstructionIntent,
  planWorkspaceConstruction,
} from '../constructor/index.js';
import { validateWorkspaceConfig } from '../schema/index.js';

function layoutReferencesPanel(node, panelType) {
  if (!node) return false;
  if (node.type === 'panel') return node.panelType === panelType;
  return layoutReferencesPanel(node.first, panelType) || layoutReferencesPanel(node.second, panelType);
}

describe('normalizeConstructionIntent', () => {
  it('normalizes string intent into a portable construction brief', () => {
    let intent = normalizeConstructionIntent('Build a chat workspace for support teams');

    assert.equal(intent.brief, 'Build a chat workspace for support teams');
    assert.equal(intent.template, 'chat');
    assert.equal(intent.targetRegister, 'tool');
    assert.deepEqual(intent.constraints, []);
    assert.deepEqual(intent.requiredCapabilities, []);
  });

  it('sorts and deduplicates portable array fields', () => {
    let intent = normalizeConstructionIntent({
      brief: 'Marketing dashboard',
      audience: ['executive', 'executive', 'marketing'],
      constraints: ['portable', 'portable', 'no-secrets'],
      requiredCapabilities: ['charts', 'filters', 'charts'],
      targetRegister: 'brand',
    });

    assert.deepEqual(intent.audience, ['executive', 'marketing']);
    assert.deepEqual(intent.constraints, ['no-secrets', 'portable']);
    assert.deepEqual(intent.requiredCapabilities, ['charts', 'filters']);
    assert.equal(intent.targetRegister, 'brand');
  });
});

describe('construction questions', () => {
  it('builds deterministic questions with defaults and skipped dependency state', () => {
    let questions = buildConstructionQuestions('Build a chat workspace');

    assert.deepEqual(questions.map((question) => question.id), [
      'workspace-name',
      'target-register',
      'layout-topology',
      'module-selection',
      'theme-mode',
      'theme-hue',
      'verification-scope',
    ]);

    let themeMode = questions.find((question) => question.id === 'theme-mode');
    let themeHue = questions.find((question) => question.id === 'theme-hue');

    assert.equal(themeMode.answer, 'light');
    assert.equal(themeMode.answerSource, 'default');
    assert.equal(themeHue.status, 'skipped');
    assert.match(themeHue.skippedReason, /theme-mode/);
  });

  it('derives module selection defaults from required capabilities', () => {
    let questions = buildConstructionQuestions({
      brief: 'Build a social automation review desk',
      template: 'social-automation',
      requiredCapabilities: ['automation.reply-template', 'data.import'],
    });

    let moduleSelection = questions.find((question) => question.id === 'module-selection');

    assert.deepEqual(moduleSelection.answer, ['imports', 'reply']);
    assert.equal(moduleSelection.answerSource, 'derived');
    assert.deepEqual(moduleSelection.requiredCapabilities, ['automation.reply-template', 'data.import']);
  });

  it('re-evaluates dependency state when answers change', () => {
    let questions = buildConstructionQuestions('Build a chat workspace');

    questions = answerConstructionQuestion(questions, 'theme-mode', 'custom');
    let enabledHue = questions.find((question) => question.id === 'theme-hue');
    assert.equal(enabledHue.status, 'answered');
    assert.equal(enabledHue.answer, 210);

    questions = answerConstructionQuestion(questions, 'theme-mode', 'dark');
    let skippedHue = questions.find((question) => question.id === 'theme-hue');
    assert.equal(skippedHue.status, 'skipped');
    assert.equal(skippedHue.answer, undefined);
  });
});

describe('planWorkspaceConstruction', () => {
  it('returns deterministic plan output and embeds the plan in config', () => {
    let first = planWorkspaceConstruction('Build a chat workspace');
    let second = planWorkspaceConstruction('Build a chat workspace');

    assert.deepEqual(first.plan, second.plan);
    assert.deepEqual(first.questions, second.questions);
    assert.deepEqual(extractConstructionPlan(first.config), first.plan);
    assert.equal(first.config.intent.template, 'chat');
    assert.equal(first.config.construction.plan.register, 'tool');
  });

  it('supports explicit answers for dependent planning branches', () => {
    let result = planWorkspaceConstruction({
      brief: 'Build a graph workspace',
      targetRegister: 'brand',
    }, {
      answers: {
        'theme-mode': 'custom',
        'theme-hue': 172,
        'verification-scope': ['theme', 'portability'],
      },
    });

    assert.equal(result.plan.register, 'brand');
    assert.equal(result.plan.theme.recipe.mode, 'custom');
    assert.equal(result.plan.theme.recipe.hue, 172);
    assert.deepEqual(
      result.plan.verification.targets.map((target) => target.type),
      ['theme', 'portability'],
    );
  });

  it('carries module capability descriptors into the construction plan', () => {
    let result = planWorkspaceConstruction({
      brief: 'Build a dashboard',
      template: 'dashboard',
    }, {
      moduleCapabilities: [{
        tagName: 'sn-card',
        provider: 'symbiote-ui',
        capabilities: ['admin.metric', 'dashboard.card'],
        actions: [{ id: 'refresh', label: 'Refresh' }],
        settings: [{ id: 'density', label: 'Density', type: 'enum' }],
        events: { emits: [{ name: 'metric-select' }] },
        bindings: [{ id: 'metric', direction: 'input', path: 'data.metrics' }],
        runtimeSlots: [{ id: 'metric-provider', role: 'provider' }],
        requiredHostServices: ['storage.project'],
        placement: { registers: ['admin'], regions: ['main'] },
      }],
      answers: {
        'module-selection': ['panel-1'],
      },
    });

    assert.deepEqual(result.config.components.modules.map((item) => item.tagName), ['sn-card']);
    assert.ok(result.config.components.catalog.includes('sn-card'));
    assert.equal(result.plan.modules.length, 1);
    assert.equal(result.plan.modules[0].component, 'sn-card');
    assert.deepEqual(result.plan.modules[0].capabilities, ['admin.metric', 'dashboard.card']);
    assert.deepEqual(result.plan.modules[0].requiredHostServices, ['storage.project']);
    assert.deepEqual(result.plan.modules[0].actions, [{ id: 'refresh', label: 'Refresh' }]);
    assert.deepEqual(result.plan.modules[0].placement, { registers: ['admin'], regions: ['main'] });
  });

  it('materializes external module capability descriptors into executable config surfaces', () => {
    let result = planWorkspaceConstruction({
      brief: 'Build an operations dashboard with sentiment review',
      template: 'dashboard',
      requiredCapabilities: ['analysis.sentiment'],
    }, {
      moduleCapabilities: [{
        tagName: 'acme-sentiment-panel',
        provider: '@acme/workspace-pack',
        capabilities: ['analysis.sentiment', 'review.queue'],
        actions: [{ id: 'refresh', label: 'Refresh', command: 'sentiment.refresh' }],
        bindings: [{ id: 'items', direction: 'input', path: 'data.sentiment' }],
        requiredHostServices: ['storage.project'],
        placement: {
          panelType: 'sentiment',
          title: 'Sentiment',
          icon: 'sentiment_satisfied',
          behavior: { importance: 72, minInlineSize: 260 },
        },
      }],
    });

    assert.deepEqual(result.plan.answers.moduleSelection, ['sentiment']);
    assert.equal(result.config.panelTypes.sentiment.component, 'acme-sentiment-panel');
    assert.equal(result.config.panelTypes.sentiment.title, 'Sentiment');
    assert.deepEqual(result.config.panelTypes.sentiment.behavior, { importance: 72, minInlineSize: 260 });
    assert.ok(result.config.components.catalog.includes('acme-sentiment-panel'));
    assert.ok(result.config.components.modules.some((item) => item.tagName === 'acme-sentiment-panel'));
    assert.ok(layoutReferencesPanel(result.config.layout, 'sentiment'));
    assert.deepEqual(result.plan.modules.map((module) => module.panelType), ['sentiment']);
    assert.equal(result.plan.modules[0].component, 'acme-sentiment-panel');
    assert.deepEqual(result.plan.modules[0].matchedCapabilities, ['analysis.sentiment']);
    assert.equal(result.plan.modules[0].selectionReason, 'required-capability');
    assert.deepEqual(result.plan.capabilities.missing, []);

    let validation = validateWorkspaceConfig(result.config, { strict: true });
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  });

  it('places modules by required capability coverage when no explicit answer is provided', () => {
    let result = planWorkspaceConstruction({
      brief: 'Build a social automation reply queue with imports',
      template: 'social-automation',
      requiredCapabilities: ['automation.reply-template', 'data.import'],
    });

    assert.deepEqual(result.plan.answers.moduleSelection, ['imports', 'reply']);
    assert.deepEqual(result.plan.modules.map((module) => module.panelType), ['imports', 'reply']);
    assert.deepEqual(result.plan.capabilities.required, ['automation.reply-template', 'data.import']);
    assert.deepEqual(result.plan.capabilities.matched, ['automation.reply-template', 'data.import']);
    assert.deepEqual(result.plan.capabilities.missing, []);
    assert.deepEqual(result.plan.capabilities.byModule, [
      {
        panelType: 'imports',
        component: 'sn-file-upload',
        matchedCapabilities: ['data.import'],
      },
      {
        panelType: 'reply',
        component: 'sn-rich-text-editor',
        matchedCapabilities: ['automation.reply-template'],
      },
    ]);
    assert.deepEqual(result.plan.modules[0].matchedCapabilities, ['data.import']);
    assert.equal(result.plan.modules[0].selectionReason, 'required-capability');
  });

  it('keeps explicit module answers and reports unmatched required capabilities', () => {
    let result = planWorkspaceConstruction({
      brief: 'Build an admin records workspace',
      template: 'admin',
      requiredCapabilities: ['admin.records'],
    }, {
      answers: {
        'module-selection': ['metric'],
      },
    });

    assert.deepEqual(result.plan.answers.moduleSelection, ['metric']);
    assert.deepEqual(result.plan.modules.map((module) => module.panelType), ['metric']);
    assert.equal(result.plan.modules[0].selectionReason, 'user');
    assert.deepEqual(result.plan.capabilities.matched, []);
    assert.deepEqual(result.plan.capabilities.missing, ['admin.records']);
  });

  it('rejects malformed module capability option entries', () => {
    assert.throws(() => planWorkspaceConstruction('Build a dashboard', {
      moduleCapabilities: [{ capabilities: ['admin.metric'] }],
    }), /requires a tagName/);

    assert.throws(() => planWorkspaceConstruction('Build a dashboard', {
      moduleCapabilities: [{
        tagName: 'Widget',
        capabilities: ['Display Label'],
        actions: [{ id: 'refresh', label: '' }],
      }],
    }), /moduleCapabilities\[0\]\.tagName/);
  });

  it('rejects duplicate direct module capability descriptors', () => {
    assert.throws(() => planWorkspaceConstruction('Build a dashboard', {
      moduleCapabilities: [
        { tagName: 'acme-review-panel', capabilities: ['review.queue'] },
        { tagName: 'acme-review-panel', capabilities: ['review.detail'] },
      ],
    }), /duplicates moduleCapabilities\[0\]\.tagName/);
  });

  it('rejects module placement metadata that cannot produce executable panels', () => {
    assert.throws(() => planWorkspaceConstruction('Build a dashboard', {
      moduleCapabilities: [{
        tagName: 'acme-sentiment-panel',
        capabilities: ['analysis.sentiment'],
        placement: { panelType: 'panel-1' },
      }],
    }), /panelType "panel-1" is already registered/);

    assert.throws(() => planWorkspaceConstruction('Build a dashboard', {
      moduleCapabilities: [{
        tagName: 'acme-review-panel',
        capabilities: ['review.queue'],
        placement: { behavior: 'wide' },
      }],
    }), /placement.behavior/);
  });
});

describe('construction schema validation', () => {
  it('accepts valid intent and construction metadata', () => {
    let result = planWorkspaceConstruction('Build a video studio workspace');
    let validation = validateWorkspaceConfig(result.config, { strict: true });

    assert.equal(validation.valid, true);
    assert.equal(validation.errors.length, 0);
  });

  it('rejects invalid construction question dependency metadata', () => {
    let validation = validateWorkspaceConfig({
      version: '0.2.0',
      name: 'Broken Workspace',
      intent: {
        brief: 'Broken workspace',
        template: 'dashboard',
        targetRegister: 'tool',
      },
      construction: {
        questions: [
          {
            id: 'theme-hue',
            title: 'Theme hue',
            type: 'number',
            default: 210,
            status: 'skipped',
          },
        ],
        plan: {
          template: 'dashboard',
          register: 'tool',
          target: { register: 'tool' },
          layout: { topology: 'grid', sectionLayouts: [] },
          modules: [],
          theme: { recipe: { mode: 'light', hue: 210 } },
          verification: { targets: [] },
        },
      },
    }, { strict: true });

    assert.equal(validation.valid, false);
    assert.ok(
      validation.errors.some((error) => error.path === 'construction.questions[0].skippedReason'),
    );
  });
});
