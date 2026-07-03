import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateModulesConfig,
  validateIdLifecycle,
  validateVerdictMap,
  splitModuleId,
  modulesSection,
} from '../schema/sections/modules.js';
import { computeIntegrity } from '../schema/canonical-json.js';
import { validateModuleCapabilityDescriptor, encodeModuleIdent } from '../schema/module-capability.js';
import {
  registerSection,
  clearRegisteredSections,
  validateWorkspaceConfig,
} from '../validation/core.js';
import { WORKSPACE_SCHEMA_VERSION } from '../schema/value-classes.js';

function codes(errors) {
  return errors.map((error) => error.code);
}

function hasCode(errors, code) {
  return errors.some((error) => error.code === code);
}

function packageModule(overrides = {}) {
  return {
    id: 'symbiote-ui:data-table',
    source: { kind: 'package', package: 'symbiote-ui', export: 'DataTable' },
    tagName: 'sn-data-table',
    title: 'Data Table',
    capabilities: ['data.table'],
    actions: [{ id: 'refresh', label: 'Refresh', does: { kind: 'emit', event: 'refresh' } }],
    settings: [{ id: 'density', label: 'Density', type: 'enum' }],
    state: [{ id: 'sort', type: 'string', persistence: 'ephemeral' }],
    events: { emits: [{ name: 'row-select' }] },
    bindings: [{ id: 'rows', direction: 'input' }],
    slots: [{ id: 'toolbar', accepts: ['action-bar'] }],
    runtimeSlots: [{ id: 'provider' }],
    streams: [{ id: 'live', direction: 'source', encoding: 'json' }],
    hostServices: { required: ['storage.project'], optional: [] },
    lifecycle: { readiness: 'auto' },
    ...overrides,
  };
}

function requiresBlock(overrides = {}) {
  return {
    packages: [{ id: 'symbiote-ui', version: '^4' }],
    hostServices: { required: ['storage.project'], optional: [] },
    ...overrides,
  };
}

function inlineSource(fields = {}) {
  let code = fields.code !== undefined ? fields.code : 'export default class extends HTMLElement {}';
  let payload = { code };
  if (fields.template !== undefined) payload.template = fields.template;
  if (fields.styles !== undefined) payload.styles = fields.styles;
  return {
    kind: 'inline',
    code,
    ...(fields.template !== undefined ? { template: fields.template } : {}),
    ...(fields.styles !== undefined ? { styles: fields.styles } : {}),
    integrity: fields.integrity !== undefined ? fields.integrity : computeIntegrity(payload),
    provenance: { authoredBy: 'agent', revision: 1 },
    review: fields.review !== undefined ? fields.review : { verdict: 'accepted', reviewedBy: 'human' },
  };
}

describe('splitModuleId', () => {
  it('splits on the single colon; namespace keeps dots', () => {
    assert.deepEqual(splitModuleId('acme.video:sequence-editor'), { namespace: 'acme.video', localName: 'sequence-editor' });
    assert.deepEqual(splitModuleId('local:widget'), { namespace: 'local', localName: 'widget' });
    assert.equal(splitModuleId('no-colon'), null);
  });
});

describe('module id + source rules', () => {
  it('accepts a well-formed package module with zero errors', () => {
    let errors = validateModulesConfig({ modules: [packageModule()], requires: requiresBlock() });
    assert.deepEqual(errors, []);
  });

  it('rejects an id that fails the grammar', () => {
    let errors = validateModulesConfig({ modules: [packageModule({ id: 'NoNamespace' })], requires: requiresBlock() });
    assert.ok(hasCode(errors, 'modules.id.grammar'));
  });

  it('rejects duplicate module ids', () => {
    let errors = validateModulesConfig({
      modules: [packageModule(), packageModule({ tagName: 'sn-data-table-2' })],
      requires: requiresBlock(),
    });
    assert.ok(hasCode(errors, 'modules.id.duplicate'));
  });

  it('rejects a namespace that does not equal the source authority', () => {
    let errors = validateModulesConfig({
      modules: [packageModule({ id: 'other:data-table' })],
      requires: requiresBlock({ packages: [{ id: 'symbiote-ui', version: '^4' }] }),
    });
    assert.ok(hasCode(errors, 'modules.namespace.authority'));
  });

  it('reserves the local namespace for inline modules', () => {
    let errors = validateModulesConfig({
      modules: [packageModule({ id: 'local:data-table', source: { kind: 'package', package: 'local' } })],
      requires: requiresBlock({ packages: [{ id: 'local', version: '1.0.0' }] }),
    });
    assert.ok(hasCode(errors, 'modules.namespace.reserved_local'));
  });

  it('rejects a duplicate tagName preference', () => {
    let errors = validateModulesConfig({
      modules: [
        packageModule(),
        packageModule({ id: 'symbiote-ui:data-grid' }),
      ],
      requires: requiresBlock(),
    });
    assert.ok(hasCode(errors, 'modules.tagName.duplicate'));
  });

  it('rejects an unknown source kind', () => {
    let errors = validateModulesConfig({
      modules: [{ id: 'symbiote-ui:data-table', source: { kind: 'remote' } }],
      requires: requiresBlock(),
    });
    assert.ok(hasCode(errors, 'modules.source.kind'));
  });

  it('rejects a plugin module carrying an embedded descriptor', () => {
    let errors = validateModulesConfig({
      modules: [{
        id: 'acme.video:sequence-editor',
        source: { kind: 'plugin', plugin: 'acme.video' },
        tagName: 'acme-sequence-editor',
      }],
      requires: requiresBlock({
        plugins: [{ id: 'acme.video', version: '1.0.0', integrity: computeIntegrity({ p: 1 }) }],
      }),
    });
    assert.ok(hasCode(errors, 'modules.source.plugin_embedded'));
  });

  it('rejects a module whose plugin/package is not declared in requires', () => {
    let missingPlugin = validateModulesConfig({
      modules: [{ id: 'acme.video:sequence-editor', source: { kind: 'plugin', plugin: 'acme.video' } }],
      requires: requiresBlock(),
    });
    assert.ok(hasCode(missingPlugin, 'modules.requires.plugin_missing'));

    let missingPackage = validateModulesConfig({
      modules: [packageModule({ id: 'other-ui:data-table', source: { kind: 'package', package: 'other-ui' } })],
      requires: requiresBlock(),
    });
    assert.ok(hasCode(missingPackage, 'modules.requires.package_missing'));
  });
});

describe('inline module rules', () => {
  it('accepts an inline module with a matching integrity and accepted verdict', () => {
    let errors = validateModulesConfig({
      modules: [packageModule({
        id: 'local:shift-summary',
        source: inlineSource(),
        tagName: 'local-shift-summary',
        hostServices: { required: [], optional: [] },
      })],
      requires: requiresBlock({ packages: [] }),
    });
    assert.deepEqual(errors, []);
  });

  it('rejects inline missing code or integrity', () => {
    let missingCode = validateModulesConfig({
      modules: [packageModule({
        id: 'local:x', tagName: 'local-x', hostServices: { required: [] },
        source: { kind: 'inline', integrity: 'sha256-AAA', review: { verdict: 'accepted' } },
      })],
      requires: requiresBlock({ packages: [] }),
    });
    assert.ok(hasCode(missingCode, 'modules.inline.code'));
  });

  it('rejects an inline integrity that does not match the canonical hash', () => {
    let errors = validateModulesConfig({
      modules: [packageModule({
        id: 'local:x', tagName: 'local-x', hostServices: { required: [] },
        source: inlineSource({ integrity: computeIntegrity({ code: 'different' }) }),
      })],
      requires: requiresBlock({ packages: [] }),
    });
    assert.ok(hasCode(errors, 'modules.inline.integrity_mismatch'));
  });

  it('rejects an inline module without an accepted verdict', () => {
    let blocked = validateModulesConfig({
      modules: [packageModule({
        id: 'local:x', tagName: 'local-x', hostServices: { required: [] },
        source: inlineSource({ review: { verdict: 'blocked', reviewedBy: 'human' } }),
      })],
      requires: requiresBlock({ packages: [] }),
    });
    assert.ok(hasCode(blocked, 'modules.inline.unreviewed'));
  });

  it('rejects a verdict value that never serializes', () => {
    let errors = validateModulesConfig({
      modules: [packageModule({
        id: 'local:x', tagName: 'local-x', hostServices: { required: [] },
        source: inlineSource({ review: { verdict: 'pendingApproval' } }),
      })],
      requires: requiresBlock({ packages: [] }),
    });
    assert.ok(hasCode(errors, 'modules.inline.verdict_value'));
  });
});

describe('descriptor capability contract', () => {
  function descriptorErrors(overrides) {
    let errors = [];
    validateModuleCapabilityDescriptor(packageModule(overrides), 'm', errors, { moduleId: overrides.id || 'symbiote-ui:data-table' });
    return errors.map((error) => error.message);
  }

  it('rejects duplicate action ids', () => {
    let errors = [];
    validateModuleCapabilityDescriptor(packageModule({
      actions: [
        { id: 'go', label: 'Go', does: { kind: 'emit', event: 'go' } },
        { id: 'go', label: 'Again', does: { kind: 'emit', event: 'go2' } },
      ],
    }), 'm', errors, {});
    assert.ok(errors.some((e) => /Duplicate action ID/.test(e.message)));
  });

  it('rejects a does union with zero or more than one kind', () => {
    let zero = [];
    validateModuleCapabilityDescriptor(packageModule({ actions: [{ id: 'go', label: 'Go', does: {} }] }), 'm', zero, {});
    assert.ok(zero.some((e) => /does.kind/.test(e.path)));

    let legacy = [];
    validateModuleCapabilityDescriptor(packageModule({ actions: [{ id: 'go', label: 'Go', does: { kind: 'emit', event: 'x' }, method: 'legacy' }] }), 'm', legacy, {});
    assert.ok(legacy.some((e) => /\.method$/.test(e.path)));
  });

  it('rejects graphOwnership with both or neither of graph/nodeType', () => {
    let both = [];
    validateModuleCapabilityDescriptor(packageModule({ graphOwnership: [{ graph: 'g', nodeType: 't', policy: 'user-direct' }] }), 'm', both, {});
    assert.ok(both.some((e) => /exactly one of/.test(e.message)));

    let neither = [];
    validateModuleCapabilityDescriptor(packageModule({ graphOwnership: [{ policy: 'agent-gated' }] }), 'm', neither, {});
    assert.ok(neither.some((e) => /exactly one of/.test(e.message)));
  });

  it('rejects instance-level engine references anywhere in the descriptor', () => {
    let onRow = [];
    validateModuleCapabilityDescriptor(packageModule({
      settings: [{ id: 'd', label: 'D', type: 'boolean', engine: { graphId: 'g', nodeId: 'n' } }],
    }), 'm', onRow, {});
    assert.ok(onRow.some((e) => /not part of the module capability contract/.test(e.message)));

    let onWire = [];
    validateModuleCapabilityDescriptor(packageModule({
      suggests: { wires: [{ from: '#binding:rows', to: { engine: { graphId: 'g', nodeId: 'n' } } }] },
    }), 'm', onWire, {});
    assert.ok(onWire.some((e) => /instance-level/.test(e.message)));
  });

  it('accepts type-level engine references in suggests.wires', () => {
    let errors = [];
    validateModuleCapabilityDescriptor(packageModule({
      suggests: { wires: [{ from: '#binding:rows', to: { engine: { nodeType: 'timeline.render', input: 'graph' } } }] },
    }), 'm', errors, {});
    assert.deepEqual(errors, []);
  });

  it('restricts descriptor state rows to ephemeral or runtime tiers', () => {
    let errors = [];
    validateModuleCapabilityDescriptor(packageModule({ state: [{ id: 's', type: 'string', persistence: 'workspace' }] }), 'm', errors, {});
    assert.ok(errors.some((e) => /persistence must be/.test(e.message)));
  });

  it('validates streams direction and encoding', () => {
    let errors = [];
    validateModuleCapabilityDescriptor(packageModule({ streams: [{ id: 's', direction: 'both', encoding: 'proto' }] }), 'm', errors, {});
    assert.ok(errors.some((e) => /direction/.test(e.path)));
    assert.ok(errors.some((e) => /encoding/.test(e.path)));
  });

  it('rejects flat requiredHostServices in favour of hostServices{required,optional}', () => {
    let errors = [];
    validateModuleCapabilityDescriptor(packageModule({ requiredHostServices: ['x.y'], hostServices: undefined }), 'm', errors, {});
    assert.ok(errors.some((e) => /requiredHostServices/.test(e.path)));
  });

  it('validates lifecycle.readiness', () => {
    let errors = [];
    validateModuleCapabilityDescriptor(packageModule({ lifecycle: { readiness: 'eager' } }), 'm', errors, {});
    assert.ok(errors.some((e) => /readiness/.test(e.path)));
  });
});

describe('webmcp tools', () => {
  it('requires agent.webmcp in hostServices when tools are declared', () => {
    let errors = [];
    validateModuleCapabilityDescriptor(packageModule({
      webmcp: { tools: [{ name: `${encodeModuleIdent('symbiote-ui:data-table')}_query` }] },
      hostServices: { required: ['storage.project'] },
    }), 'm', errors, { moduleId: 'symbiote-ui:data-table' });
    assert.ok(errors.some((e) => /agent\.webmcp/.test(e.message)));
  });

  it('accepts tool names derived from the module id when agent.webmcp is present', () => {
    let errors = [];
    validateModuleCapabilityDescriptor(packageModule({
      webmcp: { tools: [{ name: `${encodeModuleIdent('symbiote-ui:data-table')}_query` }] },
      hostServices: { required: ['agent.webmcp'] },
    }), 'm', errors, { moduleId: 'symbiote-ui:data-table' });
    assert.deepEqual(errors, []);
  });

  it('rejects tool names that do not derive from the module id', () => {
    let errors = [];
    validateModuleCapabilityDescriptor(packageModule({
      webmcp: { tools: [{ name: 'sn-data-table_query' }] },
      hostServices: { required: ['agent.webmcp'] },
    }), 'm', errors, { moduleId: 'symbiote-ui:data-table' });
    assert.ok(errors.some((e) => /must derive from the module id/.test(e.message)));
  });
});

describe('requires{} rules', () => {
  it('requires mandatory integrity on plugin and pack entries', () => {
    let errors = validateModulesConfig({
      modules: [{ id: 'acme.video:x', source: { kind: 'plugin', plugin: 'acme.video' } }],
      requires: {
        plugins: [{ id: 'acme.video', version: '1.0.0' }],
        packs: [{ id: 'media.video', version: '0.3.0' }],
      },
    });
    assert.ok(hasCode(errors, 'requires.plugin.integrity'));
    assert.ok(hasCode(errors, 'requires.pack.integrity'));
  });

  it('rejects an invalid semver range', () => {
    let errors = validateModulesConfig({
      requires: { packages: [{ id: 'symbiote-ui', version: 'not-a-version' }] },
    });
    assert.ok(hasCode(errors, 'requires.package.version'));
  });

  it('accepts ranges and exact versions', () => {
    let errors = validateModulesConfig({
      modules: [{ id: 'acme.video:x', source: { kind: 'plugin', plugin: 'acme.video' } }],
      requires: { plugins: [{ id: 'acme.video', version: '^1.2', integrity: computeIntegrity({ p: 1 }) }] },
    });
    assert.ok(!hasCode(errors, 'requires.plugin.version'));
  });

  it('flags a hostServices aggregate that omits a module-declared service', () => {
    let errors = validateModulesConfig({
      modules: [packageModule()],
      requires: requiresBlock({ hostServices: { required: [], optional: [] } }),
    });
    assert.ok(hasCode(errors, 'requires.hostServices.drift'));
  });

  it('flags a dead plugin dependency and honours role:handlers-only', () => {
    let dead = validateModulesConfig({
      requires: { plugins: [{ id: 'acme.video', version: '1.0.0', integrity: computeIntegrity({ p: 1 }) }] },
    });
    assert.ok(hasCode(dead, 'requires.plugin.dead'));

    let handlersOnly = validateModulesConfig({
      requires: { plugins: [{ id: 'acme.video', version: '1.0.0', integrity: computeIntegrity({ p: 1 }), role: 'handlers-only' }] },
    });
    assert.ok(!hasCode(handlersOnly, 'requires.plugin.dead'));
  });

  it('rejects non accepted|blocked hook verdict values', () => {
    let errors = validateModulesConfig({
      modules: [{ id: 'acme.video:x', source: { kind: 'plugin', plugin: 'acme.video' } }],
      requires: {
        plugins: [{
          id: 'acme.video', version: '1.0.0', integrity: computeIntegrity({ p: 1 }),
          hooks: { 'acme.video:guard': 'pendingApproval' },
        }],
      },
    });
    assert.ok(hasCode(errors, 'verdict.value'));
  });
});

describe('idLifecycle + verdict map helpers', () => {
  it('rejects a rename whose key still exists in current contributes', () => {
    let errors = [];
    validateIdLifecycle({ renames: { 'acme.video:timeline': 'acme.video:editor' } }, new Set(['acme.video:timeline', 'acme.video:editor']), 'idLifecycle', errors);
    assert.ok(errors.some((e) => e.code === 'idLifecycle.renames.key_present'));
  });

  it('rejects a rename whose value is absent from current contributes', () => {
    let errors = [];
    validateIdLifecycle({ renames: { 'acme.video:timeline': 'acme.video:missing' } }, new Set([]), 'idLifecycle', errors);
    assert.ok(errors.some((e) => e.code === 'idLifecycle.renames.value_absent'));
  });

  it('rejects a rename chain', () => {
    let errors = [];
    validateIdLifecycle(
      { renames: { 'acme.video:a': 'acme.video:b', 'acme.video:b': 'acme.video:c' } },
      new Set(['acme.video:b', 'acme.video:c']),
      'idLifecycle',
      errors,
    );
    assert.ok(errors.some((e) => e.code === 'idLifecycle.renames.chain'));
  });

  it('flags unreviewed ids when declaredIds is supplied', () => {
    let errors = [];
    validateVerdictMap({ 'p:a': 'accepted' }, 'hooks', errors, { declaredIds: new Set(['p:a', 'p:b']), itemNoun: 'hook' });
    assert.ok(errors.some((e) => e.code === 'verdict.unreviewed'));
  });
});

describe('deleted config vocabulary', () => {
  it('reports removed keys as errors', () => {
    let errors = validateModulesConfig({
      components: { catalog: [] },
      engine: { packs: [] },
      execution: { hostServices: [] },
      intent: { hostServices: [] },
    });
    assert.ok(hasCode(errors, 'modules.deleted.components'));
    assert.ok(hasCode(errors, 'modules.deleted.engine_packs'));
    assert.ok(hasCode(errors, 'modules.deleted.execution_hostServices'));
    assert.ok(hasCode(errors, 'modules.deleted.intent_hostServices'));
  });
});

describe('registration into the S1.0 validator core', () => {
  beforeEach(() => clearRegisteredSections());
  afterEach(() => clearRegisteredSections());

  it('exports a registerable {id, validate, refProviders, refConsumers} section', () => {
    assert.equal(modulesSection.id, 'modules');
    assert.equal(typeof modulesSection.validate, 'function');
    assert.equal(typeof modulesSection.refProviders, 'function');
    assert.equal(typeof modulesSection.refConsumers, 'function');
  });

  it('validates a clean config through the registry with no errors', () => {
    registerSection(modulesSection);
    let report = validateWorkspaceConfig({
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Studio',
      modules: [packageModule()],
      requires: requiresBlock(),
    });
    assert.equal(report.ok, true);
    assert.deepEqual(report.errors, []);
  });

  it('surfaces module errors through the registry shape pass', () => {
    registerSection(modulesSection);
    let report = validateWorkspaceConfig({
      version: WORKSPACE_SCHEMA_VERSION,
      name: 'Studio',
      modules: [packageModule({ id: 'BAD' })],
      requires: requiresBlock(),
    });
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === 'modules.id.grammar'));
  });

  it('publishes module ids as reference providers', () => {
    let providers = modulesSection.refProviders({ modules: [packageModule()] });
    assert.deepEqual(providers.map((p) => p.id), ['module:symbiote-ui:data-table']);
  });
});
