import { createRouteMatcher } from '../route-matcher.js';
import { defineToolFamily } from './registry.js';

function contextSession(context = {}) {
  return context.session || context;
}

function routerFromContext(context = {}) {
  let session = contextSession(context);
  return session?.router
    || session?.routeRouter
    || session?.runtime?.router
    || session?.routers?.route
    || context.router
    || context.routeRouter;
}

function configFromContext(context = {}) {
  let session = contextSession(context);
  if (context.config) return context.config;
  if (session?.config) return session.config;
  if (typeof session?.ensure === 'function') return session.ensure();
  return null;
}

function actorSource(args, context) {
  let session = contextSession(context);
  return args?.source
    || context?.origin?.principal
    || session?.principal
    || context?.actor
    || session?.actor
    || 'user';
}

export const tools = Object.freeze([
  {
    name: 'navigate',
    description: 'Navigate through the workspace route pipeline by view target or URL.',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          oneOf: [
            {
              type: 'object',
              properties: {
                view: { type: 'string' },
                params: { type: 'object' },
                query: { type: 'object' },
              },
              required: ['view'],
            },
            {
              type: 'object',
              properties: { url: { type: 'string' } },
              required: ['url'],
            },
          ],
        },
        history: { type: 'string', enum: ['push', 'replace'] },
        source: { description: 'Invocation source used to derive navigate.user/navigate.agent intent ids.' },
      },
      required: ['to'],
    },
    mutates: false,
  },
  {
    name: 'resolve_route',
    description: 'Resolve a workspace route target through the shared matcher without navigating.',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          oneOf: [
            {
              type: 'object',
              properties: {
                view: { type: 'string' },
                params: { type: 'object' },
                query: { type: 'object' },
              },
              required: ['view'],
            },
            {
              type: 'object',
              properties: { url: { type: 'string' } },
              required: ['url'],
            },
          ],
        },
      },
      required: ['to'],
    },
    mutates: false,
  },
]);

async function navigate(args = {}, context = {}) {
  let router = routerFromContext(context);
  if (!router || typeof router.navigate !== 'function') {
    throw new Error('navigate requires a session router created by createRouter().');
  }
  return router.navigate({
    to: args.to,
    history: args.history,
    source: actorSource(args, context),
  });
}

async function resolveRoute(args = {}, context = {}) {
  let router = routerFromContext(context);
  if (router && typeof router.resolve === 'function') {
    return router.resolve(args.to);
  }
  let config = configFromContext(context);
  if (!config) throw new Error('resolve_route requires a session config or router.');
  let matcher = createRouteMatcher(config);
  if (args.to?.url) return matcher.resolve(args.to.url);
  if (args.to?.view) {
    return matcher.resolve(matcher.urlForView(args.to.view, args.to.params || {}, args.to.query || {}));
  }
  throw new Error('resolve_route requires to:{ view } or to:{ url }.');
}

export const handlers = Object.freeze({
  navigate,
  resolve_route: resolveRoute,
});

export async function dispatchRouteTool(toolName, args, session) {
  let handler = handlers[toolName];
  if (!handler) throw new Error(`Unknown route tool: ${toolName}`);
  return handler(args, session);
}

export const routeToolFamily = defineToolFamily('route', tools, handlers);

export default routeToolFamily;
