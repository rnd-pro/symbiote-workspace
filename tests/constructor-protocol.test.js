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
    let result = planWorkspaceConstruction('Build an admin dashboard', {
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

  it('rejects malformed module capability option entries', () => {
    assert.throws(() => planWorkspaceConstruction('Build a dashboard', {
      moduleCapabilities: [{ capabilities: ['admin.metric'] }],
    }), /require a tagName/);
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
