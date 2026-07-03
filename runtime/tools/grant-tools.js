/**
 * Grant dispatch-tool family.
 *
 * Storage is injected by the host/session. This family only exposes the
 * host-neutral operations needed by dispatch integration: list current grants
 * and revoke one by id. Importing this family into dispatch is owned by a later
 * integration slice.
 *
 * @module symbiote-workspace/runtime/tools/grant-tools
 */

import { defineToolFamily } from './registry.js';

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function grantStoreFrom(session = {}, context = {}) {
  return context.grantStore
    || session.grantStore
    || session.grantsStore
    || session.runtime?.grantStore
    || null;
}

async function listFromStore(store, args) {
  if (store && typeof store.list === 'function') return store.list(args);
  return null;
}

async function revokeFromStore(store, grantId, args) {
  if (store && typeof store.revoke === 'function') return store.revoke(grantId, args);
  if (store && typeof store.delete === 'function') return store.delete(grantId, args);
  return null;
}

function grantMatchesFilter(grant, args = {}) {
  if (args.principalKind && grant.principal?.kind !== args.principalKind) return false;
  if (args.principalId && grant.principal?.id !== args.principalId) return false;
  if (args.kind && !grant.kinds?.includes(args.kind)) return false;
  if (args.expiry && grant.expiry !== args.expiry) return false;
  return true;
}

export const grantTools = [
  {
    name: 'grant_list',
    description: 'List host/session grants visible to the current runtime context.',
    inputSchema: {
      type: 'object',
      properties: {
        principalKind: { type: 'string', enum: ['human', 'agent', 'daemon'] },
        principalId: { type: 'string' },
        kind: { type: 'string', description: 'Tool kind/name to filter grants by.' },
        expiry: { type: 'string', enum: ['task', 'session', 'install'] },
      },
    },
  },
  {
    name: 'grant_revoke',
    description: 'Revoke a host/session grant by id.',
    inputSchema: {
      type: 'object',
      properties: {
        grantId: { type: 'string', description: 'Grant id to revoke.' },
        reason: { type: 'string', description: 'Optional host-visible revoke reason.' },
      },
      required: ['grantId'],
    },
    mutates: true,
  },
];

async function grantList(args = {}, context = {}) {
  let session = context.session || context;
  let store = grantStoreFrom(session, context);
  let stored = await listFromStore(store, args);
  let grants = Array.isArray(stored) ? stored : Array.isArray(session.grants) ? session.grants : [];
  let filtered = grants.filter((grant) => grantMatchesFilter(grant, args)).map(cloneJson);
  return {
    status: 'ok',
    grants: filtered,
    count: filtered.length,
  };
}

async function grantRevoke(args = {}, context = {}) {
  let session = context.session || context;
  let store = grantStoreFrom(session, context);
  let revoked = await revokeFromStore(store, args.grantId, args);
  if (revoked !== null) {
    return {
      status: revoked === false ? 'not_found' : 'ok',
      grantId: args.grantId,
      revoked: revoked !== false,
    };
  }

  if (!Array.isArray(session.grants)) {
    return { status: 'not_found', grantId: args.grantId, revoked: false };
  }
  let before = session.grants.length;
  session.grants = session.grants.filter((grant) => grant.id !== args.grantId);
  let didRevoke = session.grants.length !== before;
  return {
    status: didRevoke ? 'ok' : 'not_found',
    grantId: args.grantId,
    revoked: didRevoke,
  };
}

export const grantHandlers = {
  grant_list: grantList,
  grant_revoke: grantRevoke,
};

export const grantToolFamily = defineToolFamily('grant', grantTools, grantHandlers);

export default grantToolFamily;
