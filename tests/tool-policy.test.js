import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  toolConfirmPolicy,
  isMutatingTool,
  needsConfirm,
} from '../runtime/tool-policy.js';
import { TOOLS, isMutating } from '../runtime/dispatch.js';

describe('tool confirm policy', () => {
  it('requires confirm for mutating tools', () => {
    for (let name of ['add_group', 'construct_workspace', 'apply_workspace_patch', 'save_config']) {
      assert.equal(toolConfirmPolicy(name), 'confirm', `${name} should confirm`);
      assert.equal(isMutatingTool(name), true, `${name} should be mutating`);
      assert.equal(needsConfirm(name), true, `${name} should need confirm`);
    }
  });

  it('auto-approves read-only tools', () => {
    for (let name of ['describe_workspace', 'list_groups', 'validate_config', 'check_guardrails']) {
      assert.equal(toolConfirmPolicy(name), 'auto', `${name} should be auto`);
      assert.equal(isMutatingTool(name), false, `${name} should be read-only`);
      assert.equal(needsConfirm(name), false, `${name} should not need confirm`);
    }
  });

  it('defaults unknown tools to confirm (fail safe)', () => {
    assert.equal(toolConfirmPolicy('not_a_real_tool'), 'confirm');
    assert.equal(needsConfirm('not_a_real_tool'), true);
    assert.equal(isMutatingTool('not_a_real_tool'), false);
  });

  it('defaults empty or non-string names to confirm', () => {
    assert.equal(toolConfirmPolicy(''), 'confirm');
    assert.equal(toolConfirmPolicy(undefined), 'confirm');
    assert.equal(toolConfirmPolicy(null), 'confirm');
  });

  it('derives policy from the registry without duplicating the mutates flag', () => {
    for (let tool of TOOLS) {
      let expected = isMutating(tool.name) ? 'confirm' : 'auto';
      assert.equal(toolConfirmPolicy(tool.name), expected, `${tool.name} policy mismatch`);
    }
  });
});
