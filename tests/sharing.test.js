import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  exportConfig,
  importConfig,
  createHostIntegrationContract,
  diffConfigs,
  mergeConfigs,
} from '../sharing/config-portability.js';

const VERSION = '1.0.0';

function fixtureHomePath(...parts) {
  return ['', 'Users', ...parts].join('/');
}

function fixtureFileUrl(path) {
  return ['file:', '', '', 'tmp', path].join('/');
}

function grant() {
  return {
    id: 'g-7',
    principal: { kind: 'agent', id: 'construction' },
    scope: ['views[dashboard].*'],
    kinds: ['config_patch'],
    expiry: 'task',
  };
}

let BASE_CONFIG = {
  version: VERSION,
  name: 'Test Workspace',
  register: 'tool',
  theme: { params: { mode: 'dark', hue: 220 }, overrides: { '--sn-gap': '8px' } },
  components: {
    catalog: ['sn-panel'],
    custom: [{ tagName: 'my-widget', code: 'class X {}' }],
  },
};

describe('exportConfig', () => {
  it('exports a portable config as JSON', () => {
    let result = exportConfig(BASE_CONFIG);
    assert.ok(result.json);
    assert.deepEqual(result.errors, []);
    assert.equal(JSON.parse(result.json).name, 'Test Workspace');
  });

  it('rejects a config that fails the version guard', () => {
    let result = exportConfig({ ...BASE_CONFIG, version: '2.0.0' });
    assert.equal(result.json, null);
    assert.ok(result.errors.some((error) => error.path === 'version'));
  });

  it('silently strips host-local and user-identity fields on non-strict export', () => {
    let result = exportConfig({
      ...BASE_CONFIG,
      host: { endpoint: 'https://internal.example.com', sessionId: 'abc123' },
      runtime: { userId: 'user-123', profile: { email: 'owner@example.com' }, path: 'data.runtime' },
    });

    assert.ok(result.json);
    let parsed = JSON.parse(result.json);
    assert.equal(parsed.host, undefined);
    assert.equal(parsed.runtime.userId, undefined);
    assert.equal(parsed.runtime.profile, undefined);
    assert.equal(parsed.runtime.path, 'data.runtime');
  });

  it('strict export fails on non-portable source fields instead of stripping them', () => {
    let result = exportConfig({
      ...BASE_CONFIG,
      runtime: { userId: 'user-123', server_url: 'prod-primary' },
      components: { ...BASE_CONFIG.components, catalog: ['https://cdn.example.com/sn-panel.js'] },
    }, { strict: true });

    assert.equal(result.json, null);
    assert.ok(result.errors.some((error) => error.path === 'runtime.userId'));
    assert.ok(result.errors.some((error) => error.path === 'runtime.server_url'));
    assert.ok(result.errors.some((error) => error.path === 'components.catalog[0]'));
  });

  it('exempts the pattern value class (route pattern, canonical) from path scanning', () => {
    let config = {
      ...BASE_CONFIG,
      routes: [{ pattern: '/orders/:id', canonical: '/orders/:id' }],
      meta: { canonical: '/dashboard' },
    };

    let strict = exportConfig(config, { strict: true });
    assert.ok(strict.json, JSON.stringify(strict.errors));
    let parsed = JSON.parse(strict.json);
    assert.equal(parsed.routes[0].pattern, '/orders/:id');
    assert.equal(parsed.meta.canonical, '/dashboard');
  });

  it('treats the path value class as pack-relative but rejects URLs by location', () => {
    let portable = exportConfig({
      ...BASE_CONFIG,
      assets: [{ id: 'logo', source: { path: 'assets/logo.png' } }],
    }, { strict: true });
    assert.ok(portable.json, JSON.stringify(portable.errors));

    let urlInPath = exportConfig({
      ...BASE_CONFIG,
      assets: [{ id: 'logo', source: { path: fixtureFileUrl('logo.png') } }],
    }, { strict: true });
    assert.equal(urlInPath.json, null);
    assert.ok(urlInPath.errors.some((error) => error.path === 'assets[0].source.path'));
  });

  it('rejects a grant object anywhere in portable config in both modes', () => {
    let config = { ...BASE_CONFIG, security: { grants: [grant()] } };

    let loose = exportConfig(config);
    assert.equal(loose.json, null);
    assert.ok(loose.errors.some((error) => error.path === 'security.grants[0]'));

    let strict = exportConfig(config, { strict: true });
    assert.equal(strict.json, null);
    assert.ok(strict.errors.some((error) => error.path === 'security.grants[0]'));
  });
});

describe('importConfig', () => {
  it('imports a portable config', () => {
    let result = importConfig(JSON.stringify(BASE_CONFIG));
    assert.ok(result.config);
    assert.deepEqual(result.errors, []);
    assert.equal(result.config.name, 'Test Workspace');
  });

  it('rejects invalid JSON without throwing', () => {
    let result = importConfig('not json');
    assert.equal(result.config, null);
    assert.match(result.errors[0].message, /Invalid JSON/);
  });

  it('rejects host-local fields, absolute paths, and URLs', () => {
    let result = importConfig(JSON.stringify({
      ...BASE_CONFIG,
      host: { endpoint: 'https://internal.example.com' },
      components: {
        ...BASE_CONFIG.components,
        catalog: ['sn-panel', 'https://cdn.example.com/x.js', fixtureHomePath('me', 'x.js')],
      },
    }));

    assert.equal(result.config, null);
    assert.ok(result.errors.some((error) => error.path === 'host'));
    assert.ok(result.errors.some((error) => error.path === 'components.catalog[1]'));
    assert.ok(result.errors.some((error) => error.path === 'components.catalog[2]'));
  });

  it('rejects an imported grant object', () => {
    let result = importConfig(JSON.stringify({ ...BASE_CONFIG, grants: [grant()] }));
    assert.equal(result.config, null);
    assert.ok(result.errors.some((error) => error.path === 'grants[0]'));
  });
});

describe('createHostIntegrationContract', () => {
  it('builds a host contract from portable module requirements', () => {
    let result = createHostIntegrationContract({
      ...BASE_CONFIG,
      components: {
        catalog: ['sn-panel'],
        modules: [{ tagName: 'sn-panel', requiredHostServices: ['storage.project', 'agent.runtime'] }],
      },
    });

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.contract.services.required, ['agent.runtime', 'storage.project']);
    assert.deepEqual(result.contract.persistence.requiredEngineServices, ['storage.project']);
  });

  it('rejects non-portable host service identifiers', () => {
    let result = createHostIntegrationContract({
      ...BASE_CONFIG,
      components: {
        catalog: ['sn-panel'],
        modules: [{ tagName: 'sn-panel', requiredHostServices: ['Storage Project'] }],
      },
    });

    assert.equal(result.status, 'error');
    assert.ok(result.errors.length > 0);
  });
});

describe('diffConfigs and mergeConfigs', () => {
  it('diffs added, removed, and changed fields', () => {
    assert.deepEqual(diffConfigs(BASE_CONFIG, BASE_CONFIG), []);
    assert.ok(diffConfigs(BASE_CONFIG, { ...BASE_CONFIG, name: 'Changed' })
      .some((d) => d.path === 'name' && d.type === 'changed'));
    assert.ok(diffConfigs(BASE_CONFIG, { ...BASE_CONFIG, data: { source: 'api' } })
      .some((d) => d.path === 'data' && d.type === 'added'));
  });

  it('merges theme params and component catalog without shared references', () => {
    let merged = mergeConfigs(BASE_CONFIG, {
      theme: { params: { hue: 180 } },
      components: { catalog: ['sn-tree-panel'] },
    });
    assert.equal(merged.theme.params.hue, 180);
    assert.equal(merged.theme.params.mode, 'dark');
    assert.ok(merged.components.catalog.includes('sn-panel'));
    assert.ok(merged.components.catalog.includes('sn-tree-panel'));

    merged.theme.params.hue = 999;
    assert.notEqual(BASE_CONFIG.theme.params.hue, 999);
  });
});
