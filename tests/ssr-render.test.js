import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderWorkspaceShell,
  loadWorkspaceShell,
  WORKSPACE_SHELL_PLACEHOLDER,
} from '../ssr/index.js';
import { hydrateDataEnvelopes } from '../ssr/data-loader.js';

function workspace(overrides = {}) {
  return {
    version: '1.0.0',
    name: 'SSR Workspace',
    views: [
      {
        id: 'home',
        title: 'Home',
        layout: { $layout: 'home' },
        route: {
          pattern: '/',
          default: true,
          meta: {
            title: { default: 'Home title' },
            description: { default: 'Home description' },
            canonical: '/',
            hreflang: 'auto',
          },
        },
      },
      {
        id: 'order',
        title: 'Order',
        layout: { $layout: 'home' },
        route: {
          pattern: '/orders/:id',
          params: [{ name: 'id', type: 'id' }],
          data: [{
            id: 'record',
            critical: true,
            required: true,
            source: { resource: 'orders', op: 'get', args: { id: '$params.id', mount: '$mount.projectId' } },
            bind: 'state:route.data.record',
          }],
        },
      },
      {
        id: 'admin',
        title: 'Admin',
        layout: { $layout: 'home' },
        route: {
          pattern: '/admin',
          guards: [{ on: 'enter', requires: 'admin.read' }],
        },
      },
      {
        id: 'fallback',
        title: 'Missing',
        layout: { $layout: 'home' },
        route: { kind: 'fallback', pattern: '/*' },
      },
    ],
    layouts: {
      home: {
        kind: 'bsp',
        root: { type: 'panel', id: 'main-panel', panel: 'main' },
      },
    },
    panels: {
      main: { module: 'sn-main', title: 'Main' },
    },
    i18n: { defaultLocale: 'en', locales: ['en', 'ru'] },
    redirects: [{ id: 'legacy-order', pattern: '/wo/:id', to: '/orders/:id', permanent: true }],
    ...overrides,
  };
}

describe('workspace shell SSR', () => {
  it('keeps the no-config placeholder render path as an HTML string', async () => {
    let html = await renderWorkspaceShell();
    assert.equal(typeof html, 'string');
    assert.ok(html.includes('workspace-shell'));
    assert.ok(html.includes('data-workspace-host') || html.includes('workspace-stage'));
  });

  it('exposes the canonical placeholder and isoMode shell class', async () => {
    assert.equal(WORKSPACE_SHELL_PLACEHOLDER, '<workspace-shell class="workspace-shell"></workspace-shell>');
    await renderWorkspaceShell();
    let WorkspaceShell = await loadWorkspaceShell();
    let shell = new WorkspaceShell();
    assert.equal(shell.isoMode, true);
  });

  it('renders fallback-kind matches as HTTP 404 shells', async () => {
    let result = await renderWorkspaceShell({ config: workspace(), url: '/missing' });

    assert.equal(result.status, 404);
    assert.equal(result.route.view, 'fallback');
    assert.ok(result.html.includes('data-route-status="404"'));
    assert.ok(result.html.includes('ctx="panel:fallback:main-panel"'));
  });

  it('renders guard denials as HTTP 403 without gated panel markup', async () => {
    let result = await renderWorkspaceShell({
      config: workspace(),
      url: '/admin',
      capabilitySnapshot: { capabilities: {} },
    });

    assert.equal(result.status, 403);
    assert.equal(result.denied.reason, 'capability-unknown');
    assert.ok(result.html.includes('workspace-denied'));
    assert.equal(result.html.includes('workspace-panel'), false);
  });

  it('serializes data envelopes and promotes required critical missing data to HTTP 404', async () => {
    let missing = await renderWorkspaceShell({ config: workspace(), url: '/orders/abc-1' });
    assert.equal(missing.status, 404);
    assert.ok(missing.html.includes('workspace-panel'), 'healthy shell should still render');
    assert.ok(missing.html.includes('"status":"missing"'));
    assert.ok(missing.html.includes('state:route.data.record'));

    let ok = await renderWorkspaceShell({
      config: workspace(),
      url: '/orders/abc-1',
      mount: { projectId: 'p1' },
      loaders: {
        record: ({ args }) => ({ id: args.id, mount: args.mount }),
      },
    });

    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data.envelopes.record.value, { id: 'abc-1', mount: 'p1' });

    let published = {};
    hydrateDataEnvelopes({
      binds: ok.data.byBind,
    }, published);
    assert.equal(published['state:route.data.record'].status, 'ok');
  });

  it('emits redirect status from the shared matcher redirect table', async () => {
    let result = await renderWorkspaceShell({ config: workspace(), url: '/wo/abc-1' });

    assert.equal(result.status, 301);
    assert.equal(result.redirect.to, '/orders/abc-1');
    assert.equal(result.redirect.permanent, true);
  });

  it('emits localized meta, canonical, and hreflang tags', async () => {
    let result = await renderWorkspaceShell({ config: workspace(), url: '/', locale: 'en' });

    assert.equal(result.status, 200);
    assert.ok(result.html.includes('<title>Home title</title>'));
    assert.ok(result.html.includes('<meta name="description" content="Home description">'));
    assert.ok(result.html.includes('<link rel="canonical" href="/">'));
    assert.ok(result.html.includes('hreflang="ru"'));
  });

  it('serializes overlapping route-aware renders through the same lock', async () => {
    let results = await Promise.all(Array.from({ length: 4 }, () => (
      renderWorkspaceShell({ config: workspace(), url: '/' })
    )));
    for (let result of results) {
      assert.equal(result.status, 200);
      assert.ok(result.html.includes('workspace-shell'));
    }
    assert.equal(results.every((result) => result.html === results[0].html), true);
  });

  it('clears the single-flight lock after a render failure', async () => {
    await assert.rejects(renderWorkspaceShell({ placeholder: 0xbad }));

    let recovered = await renderWorkspaceShell({ config: workspace(), url: '/' });
    assert.equal(recovered.status, 200);
    assert.equal(typeof globalThis.document, 'undefined');
  });
});
