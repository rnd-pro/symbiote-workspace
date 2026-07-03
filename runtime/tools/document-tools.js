/**
 * Document tool-family projection.
 *
 * This module keeps the collection/document capability surface isolated from
 * the dispatch composition root while using the runtime/documents.js seam.
 *
 * @module symbiote-workspace/runtime/tools/document-tools
 */

import { createDocumentRuntime } from '../documents.js';
import { defineToolFamily } from './registry.js';

function objectSchema(properties = {}, required = []) {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

export const tools = Object.freeze([
  {
    name: 'collection.list',
    description: 'List configured document collections and persistence readiness.',
    inputSchema: objectSchema(),
  },
  {
    name: 'collection.query',
    description: 'List document envelopes in a collection.',
    inputSchema: objectSchema({
      collectionId: { type: 'string', description: 'Document collection id.' },
    }, ['collectionId']),
  },
  {
    name: 'collection.create',
    description: 'Create a document envelope and initial body in a collection.',
    inputSchema: objectSchema({
      collectionId: { type: 'string', description: 'Document collection id.' },
      id: { type: 'string', description: 'Runtime document id.' },
      name: { type: 'string', description: 'Display name.' },
      tags: { type: 'array', items: { type: 'string' } },
      enabled: { type: 'boolean' },
      folder: { type: 'string' },
      envelope: { type: 'object' },
      body: { type: 'object' },
      actor: { type: 'object' },
    }, ['collectionId', 'id']),
    mutates: true,
    revisionScope: 'document',
  },
  {
    name: 'collection.delete',
    description: 'Delete a document by collection id and document id.',
    inputSchema: objectSchema({
      collectionId: { type: 'string', description: 'Document collection id.' },
      id: { type: 'string', description: 'Runtime document id.' },
      actor: { type: 'object' },
    }, ['collectionId', 'id']),
    mutates: true,
    revisionScope: 'document',
  },
  {
    name: 'document.load',
    description: 'Load a document envelope, body, and revision.',
    inputSchema: objectSchema({
      docAddress: { type: 'string', description: 'WAS document address: doc:<collection>:<id>.' },
    }, ['docAddress']),
  },
  {
    name: 'document.commit',
    description: 'Commit CAS document operations using schema/config-path.js path syntax.',
    inputSchema: objectSchema({
      docAddress: { type: 'string', description: 'WAS document address: doc:<collection>:<id>.' },
      ops: { type: 'array', items: { type: 'object' } },
      baseRevision: { type: 'integer' },
      actor: { type: 'object' },
      label: { type: 'string' },
      coalesceKey: { type: 'string' },
      gestureBoundary: { type: 'boolean' },
      pointerUp: { type: 'boolean' },
    }, ['docAddress', 'ops']),
    mutates: true,
    revisionScope: 'document',
  },
  {
    name: 'document.patches',
    description: 'Return document ops after a revision, or null when a full snapshot is required.',
    inputSchema: objectSchema({
      docAddress: { type: 'string', description: 'WAS document address: doc:<collection>:<id>.' },
      sinceRevision: { type: 'integer' },
    }, ['docAddress', 'sinceRevision']),
  },
  {
    name: 'document.delete',
    description: 'Delete a document and its presentation sidecar.',
    inputSchema: objectSchema({
      docAddress: { type: 'string', description: 'WAS document address: doc:<collection>:<id>.' },
      actor: { type: 'object' },
    }, ['docAddress']),
    mutates: true,
    revisionScope: 'document',
  },
  {
    name: 'document.snapshot',
    description: 'Return the document body and revision.',
    inputSchema: objectSchema({
      docAddress: { type: 'string', description: 'WAS document address: doc:<collection>:<id>.' },
    }, ['docAddress']),
  },
  {
    name: 'document.presentation.save',
    description: 'Save a presentation sidecar value outside the document revision stream.',
    inputSchema: objectSchema({
      docAddress: { type: 'string', description: 'WAS document address: doc:<collection>:<id>.' },
      value: {},
      scope: { type: 'string', description: 'Presentation sidecar scope; defaults to viewport.' },
    }, ['docAddress', 'value']),
    mutates: true,
    revisionScope: 'document',
  },
  {
    name: 'document.presentation.load',
    description: 'Load a presentation sidecar value without touching document revision state.',
    inputSchema: objectSchema({
      docAddress: { type: 'string', description: 'WAS document address: doc:<collection>:<id>.' },
      scope: { type: 'string', description: 'Presentation sidecar scope; defaults to viewport.' },
    }, ['docAddress']),
  },
]);

function documentAddressFromParts(collectionId, id) {
  return `doc:${collectionId}:${id}`;
}

function contextSession(context = {}) {
  return context.session || context;
}

export function resolveDocumentRuntime(context = {}, options = {}) {
  if (options.runtime) return options.runtime;
  let session = contextSession(context);
  if (context.documentRuntime) return context.documentRuntime;
  if (context.documents) return context.documents;
  if (session.documentRuntime) return session.documentRuntime;
  if (session.documents) return session.documents;
  if (!session.__documentRuntime) {
    session.__documentRuntime = createDocumentRuntime({
      config: context.config || session.config || {},
      persistence: session.documentPersistence,
      persistenceAdapters: session.documentPersistenceAdapters,
      broadcast: session.broadcast,
      gate: session.documentGate || session.toolGate,
    });
  }
  return session.__documentRuntime;
}

export function createDocumentToolHandlers(options = {}) {
  let runtimeFor = options.runtimeFor || ((context) => resolveDocumentRuntime(context, options));
  return {
    'collection.list': async (args = {}, context = {}) => runtimeFor(context, args).listCollections(),
    'collection.query': async (args = {}, context = {}) => (
      runtimeFor(context, args).queryCollection(args.collectionId)
    ),
    'collection.create': async (args = {}, context = {}) => (
      runtimeFor(context, args).createDocument(args.collectionId, args)
    ),
    'collection.delete': async (args = {}, context = {}) => (
      runtimeFor(context, args).deleteDocument(documentAddressFromParts(args.collectionId, args.id), args)
    ),
    'document.load': async (args = {}, context = {}) => runtimeFor(context, args).load(args.docAddress),
    'document.commit': async (args = {}, context = {}) => (
      runtimeFor(context, args).commit(args.docAddress, args.ops, args)
    ),
    'document.patches': async (args = {}, context = {}) => (
      runtimeFor(context, args).getPatches(args.docAddress, args.sinceRevision)
    ),
    'document.delete': async (args = {}, context = {}) => (
      runtimeFor(context, args).deleteDocument(args.docAddress, args)
    ),
    'document.snapshot': async (args = {}, context = {}) => runtimeFor(context, args).snapshot(args.docAddress),
    'document.presentation.save': async (args = {}, context = {}) => (
      runtimeFor(context, args).savePresentation(args.docAddress, args.value, args)
    ),
    'document.presentation.load': async (args = {}, context = {}) => (
      runtimeFor(context, args).loadPresentation(args.docAddress, args)
    ),
  };
}

export const handlers = createDocumentToolHandlers();

export const documentTools = Object.freeze({
  tools,
  handlers,
});

export const documentToolFamily = defineToolFamily('document', tools, handlers);

export default documentToolFamily;
