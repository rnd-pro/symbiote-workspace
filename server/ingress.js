/**
 * Host-neutral ingress endpoint router.
 *
 * Mounts portable `server.endpoints[]` declarations at host-allocated paths,
 * keeps auth fail-closed, respects deployment exposure, and dispatches trigger,
 * graph/node, or handler bindings through injected host seams.
 *
 * @module symbiote-workspace/server/ingress
 */

import { createHash, randomBytes } from 'node:crypto';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function errorWithCode(message, code, statusCode = 400) {
  let error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function headersFromRequest(request = {}) {
  let headers = new Map();
  for (let [key, value] of Object.entries(request.headers || {})) {
    headers.set(key.toLowerCase(), value);
  }
  return headers;
}

function pathFromRequest(request = {}) {
  if (typeof request.path === 'string') return request.path;
  if (typeof request.url === 'string') {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(request.url)) return new URL(request.url).pathname;
    return request.url.split('?')[0] || '/';
  }
  throw errorWithCode('Ingress request requires path or url.', 'ingress_path_required', 404);
}

function methodFromRequest(request = {}) {
  return String(request.method || 'GET').toUpperCase();
}

function defaultEndpointMethods(endpoint) {
  if (Array.isArray(endpoint.methods) && endpoint.methods.length > 0) {
    return endpoint.methods.map((method) => String(method).toUpperCase());
  }
  return endpoint.kind === 'webhook' ? ['POST'] : [];
}

function defaultMintToken() {
  return randomBytes(16).toString('hex');
}

function normalizeExposureMap(options = {}) {
  if (isObject(options.exposureMap)) return options.exposureMap;
  if (isObject(options.deployment?.exposureMap)) return options.deployment.exposureMap;
  if (isObject(options.deployment?.exposure)) return options.deployment.exposure;
  return {};
}

function exposedState(endpointId, exposureMap) {
  let state = exposureMap[endpointId];
  return state === undefined ? 'exposed' : state;
}

function firingIdForRequest(registration, request) {
  let headers = headersFromRequest(request);
  let explicit = request.firingId
    || headers.get('x-symbiote-firing-id')
    || headers.get('x-request-id')
    || headers.get('idempotency-key');
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  return hashValue({
    registrationId: registration.registrationId,
    method: methodFromRequest(request),
    path: pathFromRequest(request),
    query: request.query,
    body: request.body,
  });
}

function normalizeResponse(statusCode, body, headers = {}) {
  return { statusCode, status: statusCode, headers, body };
}

export class IngressRouter {
  constructor(options = {}) {
    this.config = options.config || {};
    this.exposureMap = normalizeExposureMap(options);
    this.mintToken = typeof options.mintToken === 'function' ? options.mintToken : defaultMintToken;
    this.authenticate = options.authenticate;
    this.invokeHostService = options.invokeHostService;
    this.hostServices = options.hostServices || {};
    this.executionRuntime = options.executionRuntime || options.jobs || options.jobRuntime;
    this.submitExecution = options.submitExecution;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.registrations = new Map();
  }

  endpoints() {
    return Array.isArray(this.config?.server?.endpoints) ? this.config.server.endpoints : [];
  }

  registerAll() {
    return this.endpoints().map((endpoint) => this.registerEndpoint(endpoint));
  }

  registerEndpoint(endpoint) {
    if (!isObject(endpoint) || typeof endpoint.id !== 'string' || endpoint.id.length === 0) {
      throw errorWithCode('Ingress endpoint requires an id.', 'ingress_endpoint_invalid');
    }
    let token = this.mintToken(endpoint);
    if (typeof token !== 'string' || token.length === 0) {
      throw errorWithCode('Ingress token minting returned an empty token.', 'ingress_token_invalid');
    }
    let registration = {
      endpointId: endpoint.id,
      registrationId: `ingress:${endpoint.id}:${hashValue({ endpointId: endpoint.id, token }).slice(0, 16)}`,
      endpoint: cloneJson(endpoint),
      token,
      path: `/ingress/${encodeURIComponent(endpoint.id)}/${encodeURIComponent(token)}`,
      methods: defaultEndpointMethods(endpoint),
      exposure: exposedState(endpoint.id, this.exposureMap),
      registeredAt: this.now(),
    };
    this.registrations.set(endpoint.id, registration);
    return cloneJson(registration);
  }

  unregisterEndpoint(endpointId) {
    return this.registrations.delete(endpointId);
  }

  deactivate() {
    let removed = [...this.registrations.keys()].reverse();
    this.registrations.clear();
    return removed;
  }

  match(request = {}) {
    let path = pathFromRequest(request);
    for (let registration of this.registrations.values()) {
      if (registration.path === path) return registration;
    }
    return null;
  }

  async authorize(registration, request) {
    let endpoint = registration.endpoint;
    if (endpoint.auth === 'public') return { accepted: true, principal: null };
    if (typeof endpoint.auth !== 'string' || endpoint.auth.length === 0) {
      throw errorWithCode('Ingress endpoint has no auth declaration.', 'ingress_auth_required', 403);
    }

    let context = {
      endpoint: cloneJson(endpoint),
      registration: cloneJson(registration),
      request,
    };
    let result;
    if (typeof this.authenticate === 'function') {
      result = await this.authenticate(endpoint.auth, request, context);
    } else {
      result = await this.invokeService(endpoint.auth, 'authorize', { request, endpoint, registration }, context);
    }

    if (result === true) return { accepted: true, principal: null };
    if (result?.accepted === true || result?.ok === true || result?.status === 'accepted') {
      return { accepted: true, principal: cloneJson(result.principal) };
    }
    throw errorWithCode(`Ingress auth "${endpoint.auth}" rejected the request.`, 'ingress_auth_rejected', 403);
  }

  async invokeService(hostService, method, payload, context) {
    if (typeof this.invokeHostService === 'function') {
      return this.invokeHostService(hostService, method, payload, context);
    }
    let service = this.hostServices[hostService];
    if (typeof service === 'function') return service(method, payload, context);
    if (service && typeof service[method] === 'function') return service[method](payload, context);
    throw errorWithCode(`Host service "${hostService}" does not provide method "${method}".`, 'ingress_host_service_missing', 502);
  }

  async submitIngressExecution(registration, request, target) {
    let endpointId = registration.endpointId;
    let firingId = firingIdForRequest(registration, request);
    let trigger = {
      kind: 'ingress',
      endpointId,
      registrationId: registration.registrationId,
      firingId,
    };
    let payload = {
      mode: 'job',
      target: { ...cloneJson(target), endpointId },
      trigger,
      jobKey: `${registration.registrationId}:${firingId}`,
      principal: { kind: 'daemon', id: endpointId },
      actor: { principal: { kind: 'daemon', id: endpointId }, actor: 'system' },
      request: cloneJson({
        method: methodFromRequest(request),
        path: pathFromRequest(request),
        query: request.query,
        body: request.body,
      }),
    };

    let result;
    if (typeof this.submitExecution === 'function') {
      result = await this.submitExecution(payload);
    } else if (this.executionRuntime && typeof this.executionRuntime.submit === 'function') {
      result = await this.executionRuntime.submit(payload);
    } else {
      throw errorWithCode('Ingress execution dispatch requires an execution runtime.', 'ingress_execution_missing', 502);
    }

    let runId = result?.runId || result?.record?.runId;
    if (!runId) throw errorWithCode('Execution runtime did not return runId.', 'ingress_execution_run_id_missing', 502);
    return { runId, result };
  }

  async dispatchBinding(registration, request, authResult) {
    let binding = registration.endpoint.binding || {};
    if (isObject(binding.trigger)) {
      let submitted = await this.submitIngressExecution(registration, request, {
        pack: binding.trigger.pack,
        nodeType: binding.trigger.nodeType,
      });
      return normalizeResponse(202, { runId: submitted.runId });
    }
    if (typeof binding.graph === 'string') {
      let submitted = await this.submitIngressExecution(registration, request, {
        graphId: binding.graph,
        nodeId: binding.node,
      });
      return normalizeResponse(202, { runId: submitted.runId });
    }
    if (isObject(binding.handler)) {
      let principal = { kind: 'daemon', id: registration.endpointId };
      let result = await this.invokeService(binding.handler.hostService, binding.handler.method, {
        request,
        endpoint: cloneJson(registration.endpoint),
        principal,
        authPrincipal: authResult.principal || null,
      }, {
        registration: cloneJson(registration),
        principal,
        actor: 'system',
      });
      if (isObject(result) && Number.isInteger(result.statusCode)) return result;
      return normalizeResponse(200, result === undefined ? { ok: true } : result);
    }
    throw errorWithCode('Ingress endpoint binding must be trigger, graph, or handler.', 'ingress_binding_invalid', 500);
  }

  async route(request = {}) {
    let registration = this.match(request);
    if (!registration) throw errorWithCode('Ingress endpoint not found.', 'ingress_not_found', 404);
    if (registration.exposure !== 'exposed') {
      throw errorWithCode(`Ingress endpoint "${registration.endpointId}" is disabled by deployment exposure.`, 'ingress_disabled', 404);
    }
    let method = methodFromRequest(request);
    if (!registration.methods.includes(method)) {
      throw errorWithCode(`Ingress endpoint "${registration.endpointId}" does not allow ${method}.`, 'ingress_method_not_allowed', 405);
    }
    let authResult = await this.authorize(registration, request);
    return this.dispatchBinding(registration, request, authResult);
  }
}

export function createIngressRouter(options = {}) {
  return new IngressRouter(options);
}

export function createIngressPlugin(options = {}) {
  let router = null;
  return {
    name: options.name || 'symbiote.workspace.ingress',
    version: options.version || '0.3.0-alpha.2',
    activate(context = {}) {
      router = createIngressRouter({ ...options, ...context, config: options.config || context.config || {} });
      router.registerAll();
      if (context && isObject(context.serverPlane)) context.serverPlane.ingress = router;
      return router;
    },
    deactivate() {
      let removed = router ? router.deactivate() : [];
      router = null;
      return removed;
    },
    router() {
      return router;
    },
  };
}

export default createIngressRouter;
