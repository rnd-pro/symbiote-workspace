/**
 * Session tool-family projection.
 *
 * This module keeps session-document persistence, snapshots, and layout overlay
 * affordances behind the injected session-store seam.
 *
 * @module symbiote-workspace/runtime/tools/session-tools
 */

import { createSessionStore } from '../session-store.js';
import { defineToolFamily } from './registry.js';

function objectSchema(properties = {}, required = []) {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

const actorSchema = {
  type: 'object',
  properties: {
    principal: { type: 'object' },
    actor: { type: 'string' },
    reason: { type: 'string' },
  },
};

export const tools = Object.freeze([
  {
    name: 'workspace.session.load',
    description: 'Load the principal-scoped session document through the workspace.session persistence seam.',
    inputSchema: objectSchema({
      knownViews: { type: 'array', items: { type: 'string' } },
      knownVerdictIds: { type: 'array', items: { type: 'string' } },
    }),
  },
  {
    name: 'workspace.session.commit',
    description: 'Commit lenient session-document presentation operations with CAS and last-writer-wins stale fallback.',
    inputSchema: objectSchema({
      ops: { type: 'array', items: { type: 'object' } },
      actor: actorSchema,
    }, ['ops']),
    mutates: true,
    revisionScope: 'session',
  },
  {
    name: 'workspace.session.snapshot.save',
    description: 'Save a frozen session snapshot for snap= route resolution.',
    inputSchema: objectSchema({
      snapshotId: { type: 'string' },
    }, ['snapshotId']),
    mutates: true,
    revisionScope: 'session',
  },
  {
    name: 'workspace.session.snapshot.load',
    description: 'Load a frozen session snapshot by runtime-minted id, returning a notice for unknown ids.',
    inputSchema: objectSchema({
      snapshotId: { type: 'string' },
    }, ['snapshotId']),
  },
  {
    name: 'workspace.session.snapshot.list',
    description: 'List saved session snapshot ids.',
    inputSchema: objectSchema(),
  },
  {
    name: 'layout_promote_geometry',
    description: 'Promote session geometry overlay entries into config and attach restoreOverlay metadata for undo.',
    inputSchema: objectSchema({
      overlay: { type: 'object' },
      ops: { type: 'array', items: { type: 'object' } },
      actor: actorSchema,
      sessionBaseRevision: { type: 'integer' },
    }),
    mutates: true,
    revisionScope: 'session',
  },
  {
    name: 'session.layout.undo',
    description: 'Explicit session-layout undo/redo command target with the session restoreOverlay executor injected.',
    inputSchema: objectSchema({
      action: { type: 'string', enum: ['undo', 'redo'] },
      actor: actorSchema,
      principal: { type: 'object' },
    }),
    mutates: true,
    revisionScope: 'session',
  },
]);

function contextSession(context = {}) {
  return context.session || context;
}

function contextActor(args = {}, context = {}) {
  return args.actor || context.origin || context.actor || contextSession(context).actor;
}

export function resolveSessionStore(context = {}, options = {}) {
  if (options.store) return options.store;
  if (context.sessionStore) return context.sessionStore;
  let session = contextSession(context);
  if (session.sessionStore) return session.sessionStore;
  if (!session.__sessionStore) {
    session.__sessionStore = createSessionStore({
      workspaceId: session.workspaceId || session.workspaceInstanceId || session.workspaceName || 'workspace',
      principal: session.principal,
      config: session.config,
      persistence: session.sessionPersistence || session.workspaceSessionPersistence,
      knownViews: session.knownViews,
      knownNodesByView: session.knownNodesByView,
      knownVerdictIds: session.knownVerdictIds,
      verdictExists: session.verdictExists,
      gate: session.gate || session.toolGate,
      documentPresentation: session.documentPresentation,
      now: session.now,
    });
  }
  return session.__sessionStore;
}

function configStackFromContext(args = {}, context = {}) {
  let session = contextSession(context);
  return args.configStack
    || context.configStack
    || context.workspaceState
    || session.configStack
    || session.workspaceState
    || session.state;
}

async function settleOverlayResult(result) {
  let next = await Promise.resolve(result);
  if (next && typeof next === 'object') {
    if (next.restoreOverlayResult && typeof next.restoreOverlayResult.then === 'function') {
      next = { ...next, restoreOverlayResult: await next.restoreOverlayResult };
    }
    if (next.clearOverlayResult && typeof next.clearOverlayResult.then === 'function') {
      next = { ...next, clearOverlayResult: await next.clearOverlayResult };
    }
  }
  return next;
}

export function createSessionToolHandlers(options = {}) {
  let storeFor = options.storeFor || ((context) => resolveSessionStore(context, options));
  return {
    'workspace.session.load': async (args = {}, context = {}) => (
      storeFor(context, args).load(args)
    ),
    'workspace.session.commit': async (args = {}, context = {}) => (
      storeFor(context, args).commit(args.ops, {
        baseRevision: args.baseRevision,
        actor: contextActor(args, context),
      })
    ),
    'workspace.session.snapshot.save': async (args = {}, context = {}) => (
      storeFor(context, args).saveSnapshot(args.snapshotId, args)
    ),
    'workspace.session.snapshot.load': async (args = {}, context = {}) => (
      storeFor(context, args).loadSnapshot(args.snapshotId, args)
    ),
    'workspace.session.snapshot.list': async (args = {}, context = {}) => (
      storeFor(context, args).listSnapshots(args)
    ),
    layout_promote_geometry: async (args = {}, context = {}) => (
      storeFor(context, args).promoteGeometry({
        ...args,
        configStack: configStackFromContext(args, context),
        actor: contextActor(args, context),
        baseRevision: args.baseRevision,
      })
    ),
    'session.layout.undo': async (args = {}, context = {}) => {
      let action = args.action || 'undo';
      let stack = configStackFromContext(args, context);
      if (!stack || typeof stack[action] !== 'function') {
        throw new Error(`session.layout.undo requires a config stack with ${action}().`);
      }
      let store = storeFor(context, args);
      let session = contextSession(context);
      return settleOverlayResult(stack[action]({
        ...args,
        principal: args.principal || context.actor?.principal || session.principal,
        actor: args.actor?.actor || args.actor || action,
        restoreOverlayExecutor: store.restoreOverlayExecutor(),
      }));
    },
  };
}

export const handlers = createSessionToolHandlers();

export const sessionTools = Object.freeze({
  tools,
  handlers,
});

export const sessionToolFamily = defineToolFamily('session', tools, handlers);

export async function dispatchSessionTool(toolName, args, context) {
  let handler = handlers[toolName];
  if (!handler) throw new Error(`Unknown session tool: ${toolName}`);
  return handler(args, context);
}

export default sessionToolFamily;
