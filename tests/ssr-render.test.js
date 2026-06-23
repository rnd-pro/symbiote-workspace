import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderWorkspaceShell,
  loadWorkspaceShell,
  WORKSPACE_SHELL_PLACEHOLDER,
} from '../ssr/index.js';

describe('workspace shell SSR', () => {
  it('renders a non-empty shell with the workspace-shell element and stage host', async () => {
    let html = await renderWorkspaceShell();
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 0, 'rendered HTML must be non-empty');
    assert.ok(html.includes('workspace-shell'), 'must contain the workspace-shell element');
    assert.ok(
      html.includes('data-workspace-host') || html.includes('workspace-stage'),
      'must contain the stage host marker',
    );
    assert.ok(!html.includes('[object Object]'), 'must not leak [object Object]');
    assert.ok(!html.includes('undefined'), 'must not leak literal undefined');
  });

  it('exposes the canonical placeholder', () => {
    assert.equal(WORKSPACE_SHELL_PLACEHOLDER, '<workspace-shell class="workspace-shell"></workspace-shell>');
  });

  it('registers WorkspaceShell with isoMode enabled for hydration', async () => {
    // SSR.init must run before the class loads (it extends HTMLElement).
    await renderWorkspaceShell();
    let WorkspaceShell = await loadWorkspaceShell();
    let shell = new WorkspaceShell();
    assert.equal(shell.isoMode, true, 'WorkspaceShell must hydrate server markup via isoMode');
  });

  it('is repeatable — balanced init/destroy across calls', async () => {
    let first = await renderWorkspaceShell();
    let second = await renderWorkspaceShell();
    assert.ok(first.includes('workspace-shell'));
    assert.ok(second.includes('workspace-shell'));
    assert.equal(first, second, 'repeated renders must be identical');
  });
});
