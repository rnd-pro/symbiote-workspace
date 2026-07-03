import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSession, dispatch, isMutating, TOOLS } from '../runtime/index.js';

function withBase(session, args = {}) {
  return { ...args, baseRevision: session.revision };
}

describe('construction tool rename wave', () => {
  it('registers construction_* names without legacy construction names', () => {
    let names = new Set(TOOLS.map((tool) => tool.name));
    for (let name of [
      'construction_template_list',
      'construction_scaffold_blank',
      'construction_classify',
      'construction_questions_build',
      'construction_question_answer',
      'construction_plan',
      'construction_construct',
    ]) {
      assert.equal(names.has(name), true, `${name} must be registered`);
    }
    for (let name of [
      'list_templates',
      'scaffold_workspace',
      'scaffold_from_scratch',
      'classify_workspace',
      'build_construction_questions',
      'answer_construction_question',
      'plan_workspace',
      'construct_workspace',
    ]) {
      assert.equal(names.has(name), false, `${name} must not be registered`);
    }
  });

  it('classifies, builds questions, plans, and constructs under renamed tools', async () => {
    let session = createSession();

    let templates = await dispatch('construction_template_list', {}, session, { actor: 'agent-gated' });
    assert.ok(templates.count >= 1);

    let classified = await dispatch('construction_classify', { intent: 'chat workspace' }, session, {
      actor: 'agent-gated',
    });
    assert.equal(classified.status, 'ok');
    assert.equal(classified.nextAction, 'construction_plan');

    let questions = await dispatch('construction_questions_build', {
      intent: 'chat workspace',
      template: classified.templateName,
    }, session, { actor: 'agent-gated' });
    assert.equal(questions.status, 'ok');
    assert.ok(Array.isArray(questions.questions));

    let planned = await dispatch('construction_plan', {
      intent: 'chat workspace',
      template: classified.templateName,
    }, session, { actor: 'agent-gated' });
    assert.equal(planned.status, 'ok');
    assert.ok(planned.config);
    assert.equal(session.config, null);

    let constructed = await dispatch('construction_construct', withBase(session, {
      intent: 'chat workspace',
      template: classified.templateName,
    }), session, { actor: 'agent-gated' });
    assert.equal(constructed.status, 'ok');
    assert.equal(session.revision, 1);
    assert.ok(session.config);
  });

  it('keeps construction_construct mutating and construction_plan read-only', () => {
    assert.equal(isMutating('construction_plan'), false);
    assert.equal(isMutating('construction_construct'), true);
  });
});

describe('pack_* tools', () => {
  it('exports, validates, inspects, creates context, and imports a workspace package', async () => {
    let session = createSession();
    await dispatch('construction_scaffold_blank', withBase(session, { name: 'Pack Source' }), session, {
      actor: 'agent-gated',
    });
    await dispatch('module_register', withBase(session, {
      name: 'main',
      title: 'Main',
      component: 'sn-main',
    }), session, { actor: 'agent-gated' });

    let exported = await dispatch('pack_export', {
      manifest: { id: 'pack-source', name: 'Pack Source', version: '1.0.0' },
    }, session, { actor: 'agent-gated' });
    assert.equal(exported.status, 'ok');
    assert.ok(exported.json);

    let validated = await dispatch('pack_validate', { json: exported.json }, createSession(), {
      actor: 'agent-gated',
    });
    assert.equal(validated.status, 'ok');
    assert.equal(validated.valid, true);

    let inspected = await dispatch('pack_inspect', { json: exported.json }, createSession(), {
      actor: 'agent-gated',
    });
    assert.equal(inspected.status, 'ok');
    assert.equal(inspected.valid, true);

    let context = await dispatch('pack_context_create', { json: exported.json }, createSession(), {
      actor: 'agent-gated',
    });
    assert.equal(context.status, 'ok');
    assert.equal(context.valid, true);

    let importedSession = createSession();
    let imported = await dispatch('pack_import', withBase(importedSession, { json: exported.json }), importedSession, {
      actor: 'agent-gated',
    });
    assert.equal(imported.status, 'ok');
    assert.equal(importedSession.config.name, 'Pack Source');
    assert.equal(importedSession.revision, 1);
  });

  it('feeds pack handoffs into construction_plan without mutating the session', async () => {
    let handoff = await dispatch('pack_handoff_create', {
      context: {
        valid: false,
        ready: false,
        workspaceTemplates: [],
        moduleCapabilities: [],
        requiredCapabilities: [],
        errors: [{ path: 'kind', message: 'Invalid package kind.', severity: 'error' }],
        warnings: [],
      },
      intent: { brief: 'chat workspace', template: 'chat' },
    }, createSession(), { actor: 'agent-gated' });
    assert.equal(handoff.status, 'ok');

    let session = createSession();
    let planned = await dispatch('construction_plan', handoff, session, { actor: 'agent-gated' });

    assert.equal(planned.status, 'error');
    assert.equal(planned.code, 'construction_handoff_invalid');
    assert.equal(session.config, null);
  });
});
