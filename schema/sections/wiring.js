import {
  parseWorkspaceAddress,
  parseWorkspaceEndpoint,
  serializeWorkspaceEndpoint,
  serializeWorkspaceAddress,
  validateEndpointPair,
  parseWhenExpression,
} from '../was.js';
import {
  PORTABLE_ID_PATTERN,
  MODULE_ID_PATTERN,
  RESERVED_ID_CHARACTERS,
  PLATFORM_RT_CHANNELS,
} from '../constants.js';
import { SEMVER_PATTERN } from '../value-classes.js';

/**
 * WIRING section — wires[], channels, actions, commands, keybindings.
 *
 * Registers into the S1.0 validator core via the
 * `{ id, validate, refProviders, refConsumers }` contract. The section owns the
 * ONE `wires[]` model over the WAS v2 endpoint grammar (parsed by schema/was.js —
 * no forked parser), the action `does` union, and the portable command/keybinding
 * layer. Referential resolution rides the core's single referential pass: this
 * section PROVIDES `command:<id>` ids and CONSUMES the surface/action/channel ids
 * declared by the structure, modules, data, and state sections.
 */

export const WIRE_MODES = Object.freeze(['one-way', 'two-way']);
export const DOES_KINDS = Object.freeze(['emit', 'method', 'wire', 'command']);
export const COMMAND_TARGET_KINDS = Object.freeze(['action', 'wire', 'dispatch', 'host']);
export const KEYBINDING_MODIFIERS = Object.freeze(['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta']);
export const ORIGIN_ACTORS = Object.freeze(['user-direct', 'agent-gated', 'system']);
export const PRINCIPAL_KINDS = Object.freeze(['human', 'agent', 'daemon']);

/**
 * Legacy wiring vocabularies deleted by this section. Their presence in a target
 * config is an unknown-key ERROR — the dialects folded into wires[]/does/commands.
 */
const DELETED_DIALECT_ACTION_FIELDS = Object.freeze(['command', 'event', 'method', 'binding']);

const MODULE_VERSION_REF = /^(.+)@([^@]+)$/;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPortableId(value) {
  if (!hasText(value)) return false;
  if (RESERVED_ID_CHARACTERS.some((char) => value.includes(char))) return false;
  return PORTABLE_ID_PATTERN.test(value);
}

function endpointDirection(endpoint) {
  return endpoint.kind === 'place' ? endpoint.surface?.direction : endpoint.direction;
}

function isPattern(raw) {
  return typeof raw === 'string' && (raw.includes('*') || raw.includes('{'));
}

function isModuleVersionRef(value) {
  if (!hasText(value)) return false;
  let match = MODULE_VERSION_REF.exec(value);
  if (!match) return false;
  return MODULE_ID_PATTERN.test(match[1]) && SEMVER_PATTERN.test(match[2]);
}

function lookupStateTier(config, fieldPath) {
  let fields = config?.state?.fields;
  let entries = Array.isArray(fields)
    ? fields
    : isObject(fields)
      ? Object.entries(fields).map(([id, value]) => ({ id, ...(isObject(value) ? value : {}) }))
      : [];
  for (let entry of entries) {
    if (!isObject(entry)) continue;
    let id = entry.id ?? entry.path ?? entry.field;
    if (id === fieldPath) return entry.persistence ?? entry.tier ?? null;
  }
  return null;
}

// --- wires[] ---------------------------------------------------------------

function parseEndpointOrReport(raw, position, path, context) {
  if (!hasText(raw)) {
    context.error(path, 'wiring.endpoint.required', 'Wire endpoints must be non-empty WAS addresses.');
    return null;
  }
  try {
    return parseWorkspaceEndpoint(raw, { position });
  } catch (err) {
    context.error(path, 'wiring.endpoint.invalid', `Wire endpoint ${JSON.stringify(raw)} is invalid: ${err.message}`);
    return null;
  }
}

function validateMap(map, mode, path, context) {
  if (map === undefined) return;
  if (!isObject(map)) {
    context.error(path, 'wiring.map.type', 'Wire map must be an object of source→target field paths.');
    return;
  }
  let targets = [];
  for (let [source, target] of Object.entries(map)) {
    if (!hasText(source)) {
      context.error(path, 'wiring.map.source', 'Wire map source keys must be non-empty field paths.');
    }
    if (!hasText(target)) {
      context.error(`${path}.${source}`, 'wiring.map.target', 'Wire map targets must be non-empty field paths.');
    } else {
      targets.push(target);
    }
  }
  if (mode === 'two-way') {
    let seen = new Set();
    for (let target of targets) {
      if (seen.has(target)) {
        context.error(path, 'wiring.map.non_bijective', `Two-way wire map must be a bijection; target ${JSON.stringify(target)} is bound more than once.`);
      }
      seen.add(target);
    }
  }
}

function validateStreamPlacement(from, to, path, context) {
  for (let [endpoint, field] of [[from, 'from'], [to, 'to']]) {
    if (endpoint?.kind === 'place' && endpoint.surface?.kind === 'stream') {
      let other = field === 'from' ? to : from;
      let onRt = other?.kind === 'value' && other.address?.className === 'rt';
      if (!onRt) {
        context.error(`${path}.${field}`, 'wiring.stream.non_rt', '#stream: endpoints are legal only on rt:* wires.');
      }
    }
  }
}

function validateRealtimeLaundering(config, from, to, path, context) {
  if (!(from?.kind === 'value' && from.address?.className === 'rt')) return;
  if (to?.kind !== 'value') return;
  if (to.address.className === 'doc') {
    context.error(`${path}.to`, 'wiring.rt.durable_target', 'A realtime rt: source cannot target a durable doc: value — realtime is never persisted.');
    return;
  }
  if (to.address.className === 'state') {
    let tier = lookupStateTier(config, to.address.fieldPath);
    if (tier === 'session' || tier === 'workspace') {
      context.error(`${path}.to`, 'wiring.rt.durable_target', `A realtime rt: source cannot target ${tier}-tier state field ${JSON.stringify(to.address.fieldPath)} — realtime is never persisted.`);
    }
  }
}

class CycleIndex {
  constructor() {
    this.parents = new Map();
  }

  find(node) {
    if (!this.parents.has(node)) this.parents.set(node, node);
    let root = node;
    while (this.parents.get(root) !== root) root = this.parents.get(root);
    let cursor = node;
    while (this.parents.get(cursor) !== root) {
      let next = this.parents.get(cursor);
      this.parents.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  connects(a, b) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return true;
    this.parents.set(ra, rb);
    return false;
  }
}

function validateWires(config, context) {
  if (config.wires === undefined) return;
  if (!Array.isArray(config.wires)) {
    context.error('wires', 'wiring.wires.type', 'wires must be an array.');
    return;
  }
  let ids = new Set();
  let cycles = new CycleIndex();
  for (let i = 0; i < config.wires.length; i++) {
    let wire = config.wires[i];
    let path = `wires[${i}]`;
    if (!isObject(wire)) {
      context.error(path, 'wiring.wire.type', 'Each wire must be an object.');
      continue;
    }

    if (!isPortableId(wire.id)) {
      context.error(`${path}.id`, 'wiring.wire.id', 'Wire id must be a portable id with no reserved characters.');
    } else if (ids.has(wire.id)) {
      context.error(`${path}.id`, 'wiring.wire.duplicate_id', `Duplicate wire id ${JSON.stringify(wire.id)}.`);
    } else {
      ids.add(wire.id);
    }

    let mode = wire.mode ?? 'one-way';
    if (!WIRE_MODES.includes(mode)) {
      context.error(`${path}.mode`, 'wiring.wire.mode', `Wire mode must be one of ${WIRE_MODES.join(', ')}.`);
      mode = 'one-way';
    }

    let from = parseEndpointOrReport(wire.from, 'from', `${path}.from`, context);
    let to = parseEndpointOrReport(wire.to, 'to', `${path}.to`, context);

    if (from && to) {
      if (mode === 'two-way') {
        if (endpointDirection(from) !== 'bidirectional') {
          context.error(`${path}.from`, 'wiring.direction.two_way', 'A two-way wire requires a bidirectional from endpoint (#binding:, state:, or doc:).');
        }
        if (endpointDirection(to) !== 'bidirectional') {
          context.error(`${path}.to`, 'wiring.direction.two_way', 'A two-way wire requires a bidirectional to endpoint (#binding:, state:, or doc:).');
        }
      }
      try {
        validateEndpointPair(from, to);
      } catch (err) {
        context.error(`${path}.to`, 'wiring.pattern.unbound_template', err.message);
      }
      validateStreamPlacement(from, to, path, context);
      validateRealtimeLaundering(config, from, to, path, context);

      if (mode === 'two-way' && !isPattern(wire.from) && !isPattern(wire.to)) {
        let a = serializeWorkspaceAddress(from.address);
        let b = serializeWorkspaceAddress(to.address);
        if (cycles.connects(a, b)) {
          context.error(path, 'wiring.cycle', 'Static two-way wire cycle detected across the wires[] graph.');
        }
      }
    }

    validateMap(wire.map, mode, `${path}.map`, context);

    if (wire.suggestedBy !== undefined && !isModuleVersionRef(wire.suggestedBy)) {
      context.error(`${path}.suggestedBy`, 'wiring.suggested_by.format', 'suggestedBy must be "<moduleId>@<version>".');
    }
  }
}

// --- actions (does union, declared in module descriptors) ------------------

function moduleActions(module) {
  if (Array.isArray(module?.actions)) return module.actions;
  if (Array.isArray(module?.descriptor?.actions)) return module.descriptor.actions;
  return [];
}

function validateDoesUnion(does, path, context) {
  if (!isObject(does)) {
    context.error(path, 'wiring.does.required', 'An action must declare a single does union.');
    return;
  }
  if (!DOES_KINDS.includes(does.kind)) {
    context.error(`${path}.kind`, 'wiring.does.kind', `An action does union must declare exactly one kind of ${DOES_KINDS.join(', ')}.`);
    return;
  }
  if (does.kind === 'emit') {
    if (!hasText(does.event)) context.error(`${path}.event`, 'wiring.does.emit', 'does.kind:"emit" requires an event name.');
    if (does.class !== undefined && does.class !== 'telemetry') {
      context.error(`${path}.class`, 'wiring.does.emit_class', 'The only permitted emit class is "telemetry".');
    }
  } else if (does.kind === 'method') {
    if (!hasText(does.method)) context.error(`${path}.method`, 'wiring.does.method', 'does.kind:"method" requires a method name.');
  } else if (does.kind === 'wire') {
    if (!hasText(does.to)) {
      context.error(`${path}.to`, 'wiring.does.wire', 'does.kind:"wire" requires a to endpoint.');
    } else {
      try {
        parseWorkspaceEndpoint(does.to, { position: 'to' });
      } catch (err) {
        context.error(`${path}.to`, 'wiring.does.wire', `does wire endpoint is invalid: ${err.message}`);
      }
    }
  } else if (does.kind === 'command') {
    if (!hasText(does.command)) {
      context.error(`${path}.command`, 'wiring.does.command', 'does.kind:"command" requires a command id (resolved against commands[]).');
    }
    if (does.scope !== undefined && does.scope !== 'host') {
      context.error(`${path}.scope`, 'wiring.does.command_scope', 'does.kind:"command" scope must be "host" when present.');
    }
  }
}

function validateActions(config, context) {
  for (let mi = 0; mi < asArray(config.modules).length; mi++) {
    let module = config.modules[mi];
    if (!isObject(module)) continue;
    let actions = moduleActions(module);
    for (let ai = 0; ai < actions.length; ai++) {
      let action = actions[ai];
      let path = `modules[${mi}].actions[${ai}]`;
      if (!isObject(action)) continue;
      if ('active' in action) {
        context.error(`${path}.active`, 'wiring.action.active_deleted', 'The runtime active flag is deleted from static action declarations.');
      }
      for (let field of DELETED_DIALECT_ACTION_FIELDS) {
        if (field in action) {
          context.error(`${path}.${field}`, 'wiring.action.legacy_dispatch', `Action dispatch field "${field}" is deleted; use the does union.`);
        }
      }
      validateDoesUnion(action.does, `${path}.does`, context);
    }
  }
}

// --- menu / toolbar references ---------------------------------------------

function validateReferenceEntries(entries, path, context) {
  for (let i = 0; i < asArray(entries).length; i++) {
    let entry = entries[i];
    if (!isObject(entry)) continue;
    let entryPath = `${path}[${i}]`;
    for (let field of DELETED_DIALECT_ACTION_FIELDS) {
      if (field in entry) {
        context.error(`${entryPath}.${field}`, 'wiring.menu.legacy_dispatch', `Menu/toolbar entries are references only; dispatch field "${field}" is deleted.`);
      }
    }
    if (entry.ref !== undefined && (!hasText(entry.ref) || !entry.ref.startsWith('action:'))) {
      context.error(`${entryPath}.ref`, 'wiring.menu.ref', 'Menu/toolbar refs must be an action: subject ("action:<id>").');
    }
  }
}

// --- commands[] -------------------------------------------------------------

function validateCommandTarget(target, path, context) {
  if (!isObject(target)) {
    context.error(path, 'wiring.command.target', 'A command requires a target union.');
    return;
  }
  if (!COMMAND_TARGET_KINDS.includes(target.kind)) {
    context.error(`${path}.kind`, 'wiring.command.target_kind', `Command target kind must be one of ${COMMAND_TARGET_KINDS.join(', ')}.`);
    return;
  }
  if (target.kind === 'action') {
    if (!hasText(target.ref) || !target.ref.startsWith('action:')) {
      context.error(`${path}.ref`, 'wiring.command.action_ref', 'Command action target requires an "action:<id>" ref.');
    }
    if (target.panel !== undefined) {
      try {
        parseWorkspaceAddress(target.panel);
      } catch (err) {
        context.error(`${path}.panel`, 'wiring.command.panel', `Command action panel is invalid: ${err.message}`);
      }
    }
  } else if (target.kind === 'wire') {
    if (!hasText(target.to)) {
      context.error(`${path}.to`, 'wiring.command.wire', 'Command wire target requires a to endpoint.');
    } else {
      try {
        parseWorkspaceEndpoint(target.to, { position: 'to' });
      } catch (err) {
        context.error(`${path}.to`, 'wiring.command.wire', `Command wire endpoint is invalid: ${err.message}`);
      }
    }
  } else if (target.kind === 'dispatch') {
    if (!hasText(target.tool)) context.error(`${path}.tool`, 'wiring.command.dispatch', 'Command dispatch target requires a tool name.');
  } else if (target.kind === 'host') {
    if (!hasText(target.command)) context.error(`${path}.command`, 'wiring.command.host', 'Command host target requires a host command id.');
  }
}

function validateCommands(config, context) {
  if (config.commands === undefined) return;
  if (!Array.isArray(config.commands)) {
    context.error('commands', 'wiring.commands.type', 'commands must be an array.');
    return;
  }
  let ids = new Set();
  for (let i = 0; i < config.commands.length; i++) {
    let command = config.commands[i];
    let path = `commands[${i}]`;
    if (!isObject(command)) {
      context.error(path, 'wiring.command.type', 'Each command must be an object.');
      continue;
    }
    if (!isPortableId(command.id)) {
      context.error(`${path}.id`, 'wiring.command.id', 'Command id must be a portable id.');
    } else if (ids.has(command.id)) {
      context.error(`${path}.id`, 'wiring.command.duplicate_id', `Duplicate command id ${JSON.stringify(command.id)}.`);
    } else {
      ids.add(command.id);
    }
    if (typeof command.mutates !== 'boolean') {
      context.error(`${path}.mutates`, 'wiring.command.mutates', 'Command mutates is required and must be a boolean.');
    }
    validateCommandTarget(command.target, `${path}.target`, context);
  }
}

// --- keybindings[] ----------------------------------------------------------

export function validateChord(chord) {
  if (!hasText(chord)) return 'A keybinding chord must be a non-empty string.';
  let combos = chord.split(' ').filter((part) => part.length > 0);
  if (combos.length < 1 || combos.length > 2) {
    return 'A keybinding chord must be one or two space-separated combos.';
  }
  for (let combo of combos) {
    let parts = combo.split('+');
    let key = parts[parts.length - 1];
    let modifiers = parts.slice(0, -1);
    for (let modifier of modifiers) {
      if (!KEYBINDING_MODIFIERS.includes(modifier)) {
        return `Unknown chord modifier ${JSON.stringify(modifier)}.`;
      }
    }
    if (!key || KEYBINDING_MODIFIERS.includes(key) || !/^[A-Za-z0-9]+$/.test(key)) {
      return `Invalid chord key ${JSON.stringify(key)}.`;
    }
  }
  return null;
}

function validateKeybindings(config, context) {
  if (config.keybindings === undefined) return;
  if (!Array.isArray(config.keybindings)) {
    context.error('keybindings', 'wiring.keybindings.type', 'keybindings must be an array.');
    return;
  }
  let scopedChords = new Set();
  for (let i = 0; i < config.keybindings.length; i++) {
    let keybinding = config.keybindings[i];
    let path = `keybindings[${i}]`;
    if (!isObject(keybinding)) {
      context.error(path, 'wiring.keybinding.type', 'Each keybinding must be an object.');
      continue;
    }
    let chordError = validateChord(keybinding.chord);
    if (chordError) {
      context.error(`${path}.chord`, 'wiring.keybinding.chord', chordError);
    }
    if (!hasText(keybinding.command)) {
      context.error(`${path}.command`, 'wiring.keybinding.command', 'A keybinding requires a command id (resolved against commands[]).');
    }
    if (keybinding.when !== undefined) {
      if (!hasText(keybinding.when)) {
        context.error(`${path}.when`, 'wiring.keybinding.when', 'A keybinding when clause must be a WAS address with an optional :focused pseudo-target.');
      } else {
        try {
          parseWhenExpression(keybinding.when);
        } catch (err) {
          context.error(`${path}.when`, 'wiring.keybinding.when', err.message);
        }
      }
    }
    if (!chordError) {
      let scopeKey = `${keybinding.chord}\u0000${keybinding.when ?? ''}`;
      if (scopedChords.has(scopeKey)) {
        context.error(`${path}.chord`, 'wiring.keybinding.duplicate_chord', `Duplicate chord ${JSON.stringify(keybinding.chord)} within the same when scope.`);
      }
      scopedChords.add(scopeKey);
    }
  }
}

// --- deleted dialects -------------------------------------------------------

function validateDeletedDialects(config, context) {
  let deletions = [
    ['events', 'events[] is deleted; event bridges fold into wires[].'],
    ['bindings', 'The runtime-ui-v1 bindings{} dialect is deleted; use wires[].'],
  ];
  for (let [key, message] of deletions) {
    if (config[key] !== undefined) {
      context.error(key, 'wiring.deleted_dialect', message);
    }
  }
  if (isObject(config.data) && config.data.bindings !== undefined) {
    context.error('data.bindings', 'wiring.deleted_dialect', 'data.bindings is deleted; use wires[] over state.fields.');
  }
  if (isObject(config.engine) && config.engine.bindings !== undefined) {
    context.error('engine.bindings', 'wiring.deleted_dialect', 'engine.bindings is deleted; descriptor engine refs materialize into wires[].');
  }
}

// --- section entry ----------------------------------------------------------

/**
 * Shape-pass validator: WAS-parses wires, validates channels, the does union,
 * menu/toolbar refs, commands, keybindings, and reports deleted dialects.
 *
 * @param {Object} config
 * @param {{ error: Function }} context
 */
export function validate(config, context) {
  if (!isObject(config)) return;
  validateWires(config, context);
  validateActions(config, context);
  validateReferenceEntries(config.menus, 'menus', context);
  validateReferenceEntries(config.toolbars, 'toolbars', context);
  validateCommands(config, context);
  validateKeybindings(config, context);
  validateDeletedDialects(config, context);
}

/**
 * Reference providers: every declared command id becomes a `command:<id>`
 * provider so `does.kind:"command"` and keybinding command refs resolve.
 *
 * @param {Object} config
 * @returns {Array<{id: string, path: string}>}
 */
export function refProviders(config) {
  let providers = [];
  let commands = asArray(config?.commands);
  for (let i = 0; i < commands.length; i++) {
    let command = commands[i];
    if (isObject(command) && hasText(command.id)) {
      providers.push({ id: `command:${command.id}`, path: `commands[${i}].id` });
    }
  }
  return providers;
}

function collectEndpointConsumer(raw, position, path, consumers) {
  if (!hasText(raw) || isPattern(raw)) return;
  let endpoint;
  try {
    endpoint = parseWorkspaceEndpoint(raw, { position });
  } catch {
    return;
  }
  if (endpoint.kind === 'place') {
    consumers.push({
      id: serializeWorkspaceEndpoint(endpoint),
      path,
      code: 'wiring.endpoint.unresolved',
      message: `Wire endpoint ${JSON.stringify(raw)} does not resolve to a declared surface.`,
    });
    return;
  }
  let cls = endpoint.address.className;
  if (cls === 'rt') {
    if (!PLATFORM_RT_CHANNELS.includes(endpoint.address.raw)) {
      consumers.push({
        id: endpoint.address.raw,
        path,
        code: 'wiring.rt.undeclared_channel',
        message: `Realtime channel ${JSON.stringify(raw)} is not a platform topic or declared stream channel.`,
      });
    }
  } else if (cls === 'state') {
    consumers.push({
      id: endpoint.address.raw,
      path,
      code: 'wiring.state.unresolved',
      message: `State field ${JSON.stringify(raw)} is not declared in state.fields.`,
    });
  } else if (cls === 'doc') {
    consumers.push({
      id: `doc:${endpoint.address.collectionId}`,
      path,
      code: 'wiring.doc.unknown_collection',
      message: `Document collection ${JSON.stringify(endpoint.address.collectionId)} is not declared.`,
    });
  }
}

function collectActionConsumer(ref, path, consumers) {
  if (!hasText(ref) || !ref.startsWith('action:')) return;
  consumers.push({
    id: ref,
    path,
    code: 'wiring.action.unresolved',
    message: `Action reference ${JSON.stringify(ref)} does not resolve to a placed module action.`,
  });
}

function collectCommandConsumer(commandId, path, consumers) {
  if (!hasText(commandId)) return;
  consumers.push({
    id: `command:${commandId}`,
    path,
    code: 'wiring.command.unresolved',
    message: `Command reference ${JSON.stringify(commandId)} does not resolve to commands[].`,
  });
}

/**
 * Reference consumers resolved by the core's single referential pass: concrete
 * wire endpoint surfaces, action refs (menu/toolbar/command targets), command
 * refs (does/keybindings), and realtime/state/doc value ids. Pattern endpoints
 * are excluded — their instance sets resolve at runtime.
 *
 * @param {Object} config
 * @returns {Array<{id: string, path: string, code?: string, message?: string}>}
 */
export function refConsumers(config) {
  let consumers = [];
  if (!isObject(config)) return consumers;

  let wires = asArray(config.wires);
  for (let i = 0; i < wires.length; i++) {
    let wire = wires[i];
    if (!isObject(wire)) continue;
    collectEndpointConsumer(wire.from, 'from', `wires[${i}].from`, consumers);
    collectEndpointConsumer(wire.to, 'to', `wires[${i}].to`, consumers);
  }

  let commands = asArray(config.commands);
  for (let i = 0; i < commands.length; i++) {
    let command = commands[i];
    if (!isObject(command) || !isObject(command.target)) continue;
    if (command.target.kind === 'action') {
      collectActionConsumer(command.target.ref, `commands[${i}].target.ref`, consumers);
    } else if (command.target.kind === 'wire') {
      collectEndpointConsumer(command.target.to, 'to', `commands[${i}].target.to`, consumers);
    }
  }

  let keybindings = asArray(config.keybindings);
  for (let i = 0; i < keybindings.length; i++) {
    let keybinding = keybindings[i];
    if (isObject(keybinding)) collectCommandConsumer(keybinding.command, `keybindings[${i}].command`, consumers);
  }

  let modules = asArray(config.modules);
  for (let mi = 0; mi < modules.length; mi++) {
    let actions = moduleActions(modules[mi]);
    for (let ai = 0; ai < actions.length; ai++) {
      let action = actions[ai];
      if (isObject(action) && isObject(action.does) && action.does.kind === 'command') {
        collectCommandConsumer(action.does.command, `modules[${mi}].actions[${ai}].does.command`, consumers);
      }
    }
  }

  for (let [entries, label] of [[config.menus, 'menus'], [config.toolbars, 'toolbars']]) {
    let list = asArray(entries);
    for (let i = 0; i < list.length; i++) {
      let entry = list[i];
      if (isObject(entry)) collectActionConsumer(entry.ref, `${label}[${i}].ref`, consumers);
    }
  }

  return consumers;
}

/**
 * The data:change broadcast payload contract (spec §2.3, C6). Runtime broadcasts
 * validate against this shape; `origin` and its `principal.kind` are MANDATORY.
 */
export const DATA_CHANGE_PAYLOAD_SCHEMA = Object.freeze({
  type: 'data:change',
  required: Object.freeze(['revision', 'changedPaths', 'origin']),
  origin: Object.freeze({
    required: Object.freeze(['principal', 'actor', 'reason', 'sessionId']),
    optional: Object.freeze(['verdictId', 'onBehalfOf', 'baseRevision']),
    principalKinds: PRINCIPAL_KINDS,
    actors: ORIGIN_ACTORS,
  }),
});

/**
 * Validates a runtime data:change payload against DATA_CHANGE_PAYLOAD_SCHEMA.
 *
 * @param {unknown} payload
 * @returns {{ ok: boolean, errors: Array<{path: string, message: string}> }}
 */
export function validateDataChangePayload(payload) {
  let errors = [];
  let fail = (path, message) => errors.push({ path, message });
  if (!isObject(payload)) {
    fail('', 'data:change payload must be an object.');
    return { ok: false, errors };
  }
  if (!Number.isInteger(payload.revision)) fail('revision', 'revision must be an integer.');
  if (payload.baseRevision !== undefined && !Number.isInteger(payload.baseRevision)) {
    fail('baseRevision', 'baseRevision must be an integer when present.');
  }
  if (!Array.isArray(payload.changedPaths) || !payload.changedPaths.every(hasText)) {
    fail('changedPaths', 'changedPaths must be an array of path strings.');
  }
  let origin = payload.origin;
  if (!isObject(origin)) {
    fail('origin', 'origin is mandatory on every data:change payload.');
    return { ok: errors.length === 0, errors };
  }
  if (!isObject(origin.principal) || !PRINCIPAL_KINDS.includes(origin.principal.kind)) {
    fail('origin.principal.kind', `origin.principal.kind must be one of ${PRINCIPAL_KINDS.join(', ')}.`);
  }
  if (!hasText(origin.principal?.id)) fail('origin.principal.id', 'origin.principal.id must be a non-empty string.');
  if (!ORIGIN_ACTORS.includes(origin.actor)) {
    fail('origin.actor', `origin.actor must be one of ${ORIGIN_ACTORS.join(', ')}.`);
  }
  if (!hasText(origin.reason)) fail('origin.reason', 'origin.reason must be a non-empty string.');
  if (!hasText(origin.sessionId)) fail('origin.sessionId', 'origin.sessionId must be a non-empty string.');
  return { ok: errors.length === 0, errors };
}

/**
 * The WIRING section registration for the S1.0 validator core.
 *
 * @type {{ id: string, validate: Function, refProviders: Function, refConsumers: Function }}
 */
export const wiringSection = Object.freeze({
  id: 'wiring',
  validate,
  refProviders,
  refConsumers,
});

export default wiringSection;
