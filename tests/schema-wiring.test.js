import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearRegisteredSections,
  registerSection,
  validateWorkspaceConfig,
} from '../validation/core.js';
import {
  wiringSection,
  validate,
  refProviders,
  refConsumers,
  validateChord,
  validateDataChangePayload,
  DATA_CHANGE_PAYLOAD_SCHEMA,
  WIRE_MODES,
} from '../schema/sections/wiring.js';

const VERSION = '1.0.0';

/** Registers the wiring section plus an optional provider stub, then validates. */
function run(config, providerIds = []) {
  clearRegisteredSections();
  registerSection(wiringSection);
  if (providerIds.length > 0) {
    let ids = [...new Set(providerIds)];
    registerSection({ id: 'test-providers', refProviders: () => ids.map((id) => ({ id, path: '' })) });
  }
  return validateWorkspaceConfig({ version: VERSION, ...config });
}

/** Error codes emitted for a config. */
function codes(report) {
  return report.errors.map((issue) => issue.code);
}

function assertHasCode(report, code, message) {
  assert.ok(codes(report).includes(code), message || `expected error code ${code}, got ${JSON.stringify(codes(report))}`);
}

function assertNoWiringErrors(report) {
  let wiring = report.errors.filter((issue) => issue.code.startsWith('wiring.') || issue.code.startsWith('references.'));
  assert.deepEqual(wiring, [], `expected no wiring errors, got ${JSON.stringify(wiring)}`);
}

// --- section contract -------------------------------------------------------

test('exports a registerable section with the S1.0 contract', () => {
  assert.equal(wiringSection.id, 'wiring');
  assert.equal(typeof wiringSection.validate, 'function');
  assert.equal(typeof wiringSection.refProviders, 'function');
  assert.equal(typeof wiringSection.refConsumers, 'function');
  clearRegisteredSections();
  assert.doesNotThrow(() => registerSection(wiringSection));
  clearRegisteredSections();
});

test('empty config validates cleanly under the wiring section', () => {
  assertNoWiringErrors(run({}));
});

// --- wires: identity, mode, endpoints, direction ---------------------------

test('a valid one-way wire resolves against registered providers', () => {
  let report = run(
    { wires: [{ id: 'w-select', from: 'panel:main:records#event:row-select', to: 'panel:main:inspector#property:selection', map: { 'detail.row': 'value' } }] },
    ['panel:main:records#event:row-select', 'panel:main:inspector#property:selection'],
  );
  assertNoWiringErrors(report);
});

test('duplicate wire id is an ERROR', () => {
  let report = run(
    { wires: [
      { id: 'w', from: 'panel:a:b#event:x', to: 'panel:c:d#method:y' },
      { id: 'w', from: 'panel:a:b#event:x', to: 'panel:c:d#method:z' },
    ] },
    ['panel:a:b#event:x', 'panel:c:d#method:y', 'panel:c:d#method:z'],
  );
  assertHasCode(report, 'wiring.wire.duplicate_id');
});

test('non-portable wire id is an ERROR', () => {
  let report = run({ wires: [{ id: 'Bad Id', from: 'panel:a:b#event:x', to: 'panel:c:d#method:y' }] });
  assertHasCode(report, 'wiring.wire.id');
});

test('direction legality: #event: in a to position is an ERROR', () => {
  let report = run({ wires: [{ id: 'w', from: 'panel:a:b#binding:v', to: 'panel:c:d#event:x' }] });
  assertHasCode(report, 'wiring.endpoint.invalid');
});

test('direction legality: #method: in a from position is an ERROR', () => {
  let report = run({ wires: [{ id: 'w', from: 'panel:a:b#method:m', to: 'state:x.y' }] });
  assertHasCode(report, 'wiring.endpoint.invalid');
});

test('unknown wire mode is an ERROR', () => {
  let report = run(
    { wires: [{ id: 'w', from: 'panel:a:b#event:x', to: 'panel:c:d#method:y', mode: 'broadcast' }] },
    ['panel:a:b#event:x', 'panel:c:d#method:y'],
  );
  assertHasCode(report, 'wiring.wire.mode');
});

// --- two-way + map ----------------------------------------------------------

test('a two-way binding<->state wire is valid', () => {
  let report = run(
    { wires: [{ id: 'w-draft', from: 'panel:main:composer#binding:draft', to: 'state:chat.draft', mode: 'two-way' }] },
    ['panel:main:composer#binding:draft', 'state:chat.draft'],
  );
  assertNoWiringErrors(report);
});

test('two-way with a source-only end is an ERROR', () => {
  let report = run(
    { wires: [{ id: 'w', from: 'panel:main:records#event:row-select', to: 'state:chat.draft', mode: 'two-way' }] },
    ['panel:main:records#event:row-select', 'state:chat.draft'],
  );
  assertHasCode(report, 'wiring.direction.two_way');
});

test('non-bijective map on a two-way wire is an ERROR', () => {
  let report = run(
    { wires: [{ id: 'w', from: 'panel:a:b#binding:v', to: 'doc:notes:n1', mode: 'two-way', map: { a: 'value', b: 'value' } }] },
    ['panel:a:b#binding:v', 'doc:notes'],
  );
  assertHasCode(report, 'wiring.map.non_bijective');
});

test('a bijective pick/rename map on a two-way wire is valid', () => {
  let report = run(
    { wires: [{ id: 'w', from: 'panel:a:b#binding:v', to: 'doc:notes:n1', mode: 'two-way', map: { a: 'x', b: 'y' } }] },
    ['panel:a:b#binding:v', 'doc:notes'],
  );
  assertNoWiringErrors(report);
});

// --- pattern wires ----------------------------------------------------------

test('a pattern wire with a bound capture template is valid and emits no referential consumer', () => {
  let report = run({ wires: [{ id: 'w-prev', from: 'node:main-graph:*#out:image', to: 'panel:gallery:preview-{nodeId}#property:src' }] });
  assertNoWiringErrors(report);
});

test('a to-side template variable unbound by the from pattern is an ERROR', () => {
  let report = run({ wires: [{ id: 'w', from: 'node:main-graph:*#out:image', to: 'panel:gallery:preview-{socketId}#property:src' }] });
  assertHasCode(report, 'wiring.pattern.unbound_template');
});

test('a wildcard in the to position is an ERROR', () => {
  let report = run({ wires: [{ id: 'w', from: 'panel:a:b#event:x', to: 'node:g:*#in:y' }] });
  assertHasCode(report, 'wiring.endpoint.invalid');
});

// --- realtime rules ---------------------------------------------------------

test('a platform rt topic needs no channel declaration', () => {
  let report = run(
    { wires: [{ id: 'w', from: 'rt:workspace:execution:queue', to: 'panel:a:b#in:frames' }] },
    ['panel:a:b#in:frames'],
  );
  assertNoWiringErrors(report);
});

test('an undeclared rt channel is an unresolved-reference ERROR', () => {
  let report = run(
    { wires: [{ id: 'w', from: 'rt:my.channel', to: 'panel:a:b#in:frames' }] },
    ['panel:a:b#in:frames'],
  );
  assertHasCode(report, 'wiring.rt.undeclared_channel');
});

test('rt: source into a doc: target is always an ERROR', () => {
  let report = run(
    { wires: [{ id: 'w', from: 'rt:workspace:execution:queue', to: 'doc:notes:n1' }] },
    ['doc:notes'],
  );
  assertHasCode(report, 'wiring.rt.durable_target');
});

test('rt: source into a session-tier state field is an ERROR', () => {
  let report = run(
    {
      state: { fields: [{ id: 'app.saved', persistence: 'session' }] },
      wires: [{ id: 'w', from: 'rt:workspace:execution:queue', to: 'state:app.saved' }],
    },
    ['state:app.saved'],
  );
  assertHasCode(report, 'wiring.rt.durable_target');
});

test('rt: source into an ephemeral-tier state field is legal', () => {
  let report = run(
    {
      state: { fields: [{ id: 'live.tick', persistence: 'ephemeral' }] },
      wires: [{ id: 'w', from: 'rt:workspace:execution:queue', to: 'state:live.tick' }],
    },
    ['state:live.tick'],
  );
  assertNoWiringErrors(report);
});

test('a #stream: endpoint on a non-rt wire is an ERROR', () => {
  let report = run(
    { wires: [{ id: 'w', from: 'panel:a:b#stream:frames', to: 'node:g:n#in:x' }] },
    ['panel:a:b#stream:frames', 'node:g:n#in:x'],
  );
  assertHasCode(report, 'wiring.stream.non_rt');
});

// --- suggestedBy + cycles ---------------------------------------------------

test('a well-formed suggestedBy stamp is accepted; a malformed one is an ERROR', () => {
  let ok = run(
    { wires: [{ id: 'w', from: 'panel:a:b#event:x', to: 'panel:c:d#method:y', suggestedBy: 'acme.video:sequence-editor@1.1.0' }] },
    ['panel:a:b#event:x', 'panel:c:d#method:y'],
  );
  assertNoWiringErrors(ok);
  let bad = run(
    { wires: [{ id: 'w', from: 'panel:a:b#event:x', to: 'panel:c:d#method:y', suggestedBy: 'not-a-ref' }] },
    ['panel:a:b#event:x', 'panel:c:d#method:y'],
  );
  assertHasCode(bad, 'wiring.suggested_by.format');
});

test('a static two-way cycle across wires is an ERROR', () => {
  let report = run(
    { wires: [
      { id: 'w1', from: 'panel:a:b#binding:v', to: 'state:x.y', mode: 'two-way' },
      { id: 'w2', from: 'panel:a:b#binding:w', to: 'state:x.y', mode: 'two-way' },
    ] },
    ['panel:a:b#binding:v', 'panel:a:b#binding:w', 'state:x.y'],
  );
  assertHasCode(report, 'wiring.cycle');
});

// --- actions: the does union ------------------------------------------------

test('an action does union with exactly one kind is valid; command kind resolves to commands[]', () => {
  let report = run({
    commands: [{ id: 'data.refresh', mutates: false, target: { kind: 'dispatch', tool: 'state_undo' } }],
    modules: [{ id: 'acme:panel', actions: [{ id: 'refresh', does: { kind: 'command', command: 'data.refresh' } }] }],
  });
  assertNoWiringErrors(report);
});

test('an action does:command that does not resolve to commands[] is an ERROR', () => {
  let report = run({
    modules: [{ id: 'acme:panel', actions: [{ id: 'refresh', does: { kind: 'command', command: 'missing.cmd' } }] }],
  });
  assertHasCode(report, 'wiring.command.unresolved');
});

test('an action does with no valid kind is an ERROR', () => {
  let report = run({ modules: [{ id: 'acme:panel', actions: [{ id: 'a', does: {} }] }] });
  assertHasCode(report, 'wiring.does.kind');
});

test('an emit action may carry class:"telemetry" but not another class', () => {
  let ok = run({ modules: [{ id: 'm:x', actions: [{ id: 'a', does: { kind: 'emit', event: 'ping', class: 'telemetry' } }] }] });
  assertNoWiringErrors(ok);
  let bad = run({ modules: [{ id: 'm:x', actions: [{ id: 'a', does: { kind: 'emit', event: 'ping', class: 'audit' } }] }] });
  assertHasCode(bad, 'wiring.does.emit_class');
});

test('a runtime active flag on an action is a deleted-key ERROR', () => {
  let report = run({ modules: [{ id: 'm:x', actions: [{ id: 'a', active: true, does: { kind: 'method', method: 'refresh' } }] }] });
  assertHasCode(report, 'wiring.action.active_deleted');
});

test('a legacy four-field dispatch on an action is a deleted-dialect ERROR', () => {
  let report = run({ modules: [{ id: 'm:x', actions: [{ id: 'a', event: 'ping', does: { kind: 'method', method: 'refresh' } }] }] });
  assertHasCode(report, 'wiring.action.legacy_dispatch');
});

// --- commands[] + keybindings[] --------------------------------------------

test('a command requires mutates and a valid target union', () => {
  let missing = run({ commands: [{ id: 'c.one', target: { kind: 'dispatch', tool: 'undo' } }] });
  assertHasCode(missing, 'wiring.command.mutates');
  let badKind = run({ commands: [{ id: 'c.two', mutates: true, target: { kind: 'nope' } }] });
  assertHasCode(badKind, 'wiring.command.target_kind');
});

test('a command action target ref resolves through the registry', () => {
  let report = run(
    { commands: [{ id: 'c.act', mutates: true, target: { kind: 'action', ref: 'action:refresh', panel: 'panel:main:records' } }] },
    ['action:refresh'],
  );
  assertNoWiringErrors(report);
});

test('an unresolved command action ref is an ERROR', () => {
  let report = run({ commands: [{ id: 'c.act', mutates: true, target: { kind: 'action', ref: 'action:ghost' } }] });
  assertHasCode(report, 'wiring.action.unresolved');
});

test('a valid keybinding resolves its command and chord/when grammar', () => {
  let report = run({
    commands: [{ id: 'data.refresh', mutates: false, target: { kind: 'dispatch', tool: 'refresh' } }],
    keybindings: [{ chord: 'Mod+Shift+R', command: 'data.refresh', when: 'panel:main:records:focused' }],
  });
  assertNoWiringErrors(report);
});

test('an invalid chord and an invalid when clause are ERRORs', () => {
  let report = run({
    commands: [{ id: 'c', mutates: false, target: { kind: 'dispatch', tool: 't' } }],
    keybindings: [{ chord: 'Super+Q', command: 'c', when: 'panel:main:records' }],
  });
  assertHasCode(report, 'wiring.keybinding.chord');
  assertHasCode(report, 'wiring.keybinding.when');
});

test('duplicate chord within the same when scope is an ERROR', () => {
  let report = run({
    commands: [{ id: 'c', mutates: false, target: { kind: 'dispatch', tool: 't' } }],
    keybindings: [
      { chord: 'Mod+K', command: 'c', when: 'panel:a:b:focused' },
      { chord: 'Mod+K', command: 'c', when: 'panel:a:b:focused' },
    ],
  });
  assertHasCode(report, 'wiring.keybinding.duplicate_chord');
});

test('validateChord accepts one/two combos and rejects bad grammar', () => {
  assert.equal(validateChord('Mod+K Mod+S'), null);
  assert.equal(validateChord('Ctrl+Alt+Delete'), null);
  assert.ok(validateChord('A+B+C+D'));
  assert.ok(validateChord('Nope+X'));
  assert.ok(validateChord(''));
});

// --- menu / toolbar references ---------------------------------------------

test('a menu action ref resolves; a legacy dispatch field on a menu entry is an ERROR', () => {
  let ok = run({ menus: [{ ref: 'action:refresh', order: 1 }] }, ['action:refresh']);
  assertNoWiringErrors(ok);
  let bad = run({ toolbars: [{ command: 'legacy.cmd' }] });
  assertHasCode(bad, 'wiring.menu.legacy_dispatch');
});

// --- deleted dialects -------------------------------------------------------

test('deleted wiring dialects are unknown-key ERRORs', () => {
  assertHasCode(run({ events: [] }), 'wiring.deleted_dialect');
  assertHasCode(run({ bindings: {} }), 'wiring.deleted_dialect');
  assertHasCode(run({ data: { bindings: [] } }), 'wiring.deleted_dialect');
  assertHasCode(run({ engine: { bindings: [] } }), 'wiring.deleted_dialect');
});

// --- data:change payload contract ------------------------------------------

test('the data:change payload contract is exported and validates origin as mandatory', () => {
  assert.equal(DATA_CHANGE_PAYLOAD_SCHEMA.type, 'data:change');
  let valid = validateDataChangePayload({
    revision: 18,
    baseRevision: 17,
    changedPaths: ['status', 'assignee'],
    origin: { principal: { kind: 'agent', id: 'opaque-1' }, actor: 'agent-gated', reason: 'tool:update', sessionId: 's-1' },
  });
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));
  let missingOrigin = validateDataChangePayload({ revision: 1, changedPaths: ['x'] });
  assert.equal(missingOrigin.ok, false);
  assert.ok(missingOrigin.errors.some((e) => e.path === 'origin'));
  let badPrincipal = validateDataChangePayload({
    revision: 1,
    changedPaths: ['x'],
    origin: { principal: { kind: 'robot', id: 'r' }, actor: 'system', reason: 'r', sessionId: 's' },
  });
  assert.equal(badPrincipal.ok, false);
});

// --- direct ref-hook shape --------------------------------------------------

test('refProviders exposes declared command ids and refConsumers gathers surface/action refs', () => {
  let config = {
    wires: [{ id: 'w', from: 'panel:a:b#event:x', to: 'panel:c:d#method:y' }],
    commands: [{ id: 'data.refresh', mutates: false, target: { kind: 'action', ref: 'action:refresh' } }],
    keybindings: [{ chord: 'Mod+R', command: 'data.refresh' }],
  };
  let providerIds = refProviders(config).map((p) => p.id);
  assert.ok(providerIds.includes('command:data.refresh'));
  let consumerIds = refConsumers(config).map((c) => c.id);
  assert.ok(consumerIds.includes('panel:a:b#event:x'));
  assert.ok(consumerIds.includes('panel:c:d#method:y'));
  assert.ok(consumerIds.includes('action:refresh'));
  assert.ok(consumerIds.includes('command:data.refresh'));
});

test('WIRE_MODES enumerates one-way and two-way and validate is a no-op on non-objects', () => {
  assert.deepEqual([...WIRE_MODES], ['one-way', 'two-way']);
  assert.doesNotThrow(() => validate(null, { error() {} }));
});
