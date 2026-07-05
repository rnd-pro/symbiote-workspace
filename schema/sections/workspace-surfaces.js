import {
  CAPABILITY_ID_PATTERN,
  HOST_SERVICE_CATEGORIES,
  PORTABLE_ID_PATTERN,
  WORKSPACE_EXECUTION_CHANNELS,
} from '../constants.js';

export const WORKSPACE_SURFACES_SECTION_ID = 'workspace-surfaces';
export const WORKSPACE_SURFACE_ROUTE_DERIVATIONS = Object.freeze(['view-id']);
export const WORKSPACE_SURFACE_SESSION_SCOPES = Object.freeze(['workspace']);
export const WORKSPACE_SURFACE_CHAT_MODES = Object.freeze(['shared']);
export const WORKSPACE_SURFACE_THEME_MODES = Object.freeze(['cascade']);
export const WORKSPACE_SURFACE_PROGRESS_CHANNELS = Object.freeze([
  WORKSPACE_EXECUTION_CHANNELS.queue,
  WORKSPACE_EXECUTION_CHANNELS.nodeProgress,
  WORKSPACE_EXECUTION_CHANNELS.nodeOutput,
]);

const DEFAULT_SURFACE_ROUTE_BASE_PATH = '/workspace';
const FORBIDDEN_SURFACE_SHELL_FIELDS = Object.freeze([
  'chat',
  'theme',
  'header',
  'layoutShell',
  'shellHeader',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function declaredHostServices(config = {}) {
  let declared = new Set();
  let hostServices = config.requires?.hostServices;
  if (!isObject(hostServices)) return declared;
  for (let key of ['required', 'optional']) {
    for (let id of asArray(hostServices[key])) {
      if (typeof id === 'string') declared.add(id);
    }
  }
  return declared;
}

function normalizeBasePath(value) {
  let base = hasText(value) ? value.trim() : DEFAULT_SURFACE_ROUTE_BASE_PATH;
  if (!base.startsWith('/')) return base;
  if (base === '/') return '';
  return base.replace(/\/+$/g, '');
}

export function deriveWorkspaceSurfaceRoute(view = {}) {
  if (!isObject(view) || !isObject(view.workspaceSurface)) return null;
  let routeSpec = view.workspaceSurface.route;
  if (!isObject(routeSpec)) return null;
  let derive = routeSpec.derive || 'view-id';
  if (derive !== 'view-id' || !hasText(view.id)) return null;
  let base = normalizeBasePath(routeSpec.basePath);
  return `${base}/${view.id}`;
}

function validatePortableId(value, path, context, label = 'Value') {
  if (!hasText(value)) {
    context.error(path, 'workspaceSurface.id.required', `${label} must be a non-empty portable identifier.`);
    return false;
  }
  if (!PORTABLE_ID_PATTERN.test(value)) {
    context.error(path, 'workspaceSurface.id.portable', `${label} "${value}" must be a portable identifier.`);
    return false;
  }
  return true;
}

function validateCapabilityIds(values, path, context) {
  if (values === undefined) return;
  if (!Array.isArray(values)) {
    context.error(path, 'workspaceSurface.capabilities.shape', `${path} must be an array.`);
    return;
  }
  let seen = new Set();
  for (let index = 0; index < values.length; index++) {
    let value = values[index];
    let itemPath = `${path}[${index}]`;
    if (typeof value !== 'string' || !CAPABILITY_ID_PATTERN.test(value)) {
      context.error(itemPath, 'workspaceSurface.capability.id', `Capability "${value}" must be a dotted capability id.`);
      continue;
    }
    if (seen.has(value)) {
      context.error(itemPath, 'workspaceSurface.capability.duplicate', `Capability "${value}" is declared more than once.`);
    }
    seen.add(value);
  }
}

function hostServiceCategoryKnown(serviceId) {
  return HOST_SERVICE_CATEGORIES.some((category) => (
    serviceId === category || serviceId.startsWith(`${category}.`)
  ));
}

function validateHostServices(values, path, context, declared) {
  if (values === undefined) return;
  if (!Array.isArray(values)) {
    context.error(path, 'workspaceSurface.hostServices.shape', `${path} must be an array.`);
    return;
  }
  let seen = new Set();
  for (let index = 0; index < values.length; index++) {
    let value = values[index];
    let itemPath = `${path}[${index}]`;
    if (typeof value !== 'string' || !CAPABILITY_ID_PATTERN.test(value)) {
      context.error(itemPath, 'workspaceSurface.hostService.id', `Host service "${value}" must be a dotted host-service id.`);
      continue;
    }
    if (!hostServiceCategoryKnown(value)) {
      context.error(itemPath, 'workspaceSurface.hostService.category', `Host service "${value}" does not use a known host-service category.`);
    }
    if (!declared.has(value)) {
      context.error(itemPath, 'workspaceSurface.hostService.undeclared', `Host service "${value}" is not declared in requires.hostServices.`);
    }
    if (seen.has(value)) {
      context.error(itemPath, 'workspaceSurface.hostService.duplicate', `Host service "${value}" is declared more than once.`);
    }
    seen.add(value);
  }
}

function validateHostService(value, path, context, declared) {
  if (typeof value !== 'string' || !CAPABILITY_ID_PATTERN.test(value)) {
    context.error(path, 'workspaceSurface.hostService.id', `Host service "${value}" must be a dotted host-service id.`);
    return;
  }
  if (!hostServiceCategoryKnown(value)) {
    context.error(path, 'workspaceSurface.hostService.category', `Host service "${value}" does not use a known host-service category.`);
  }
  if (!declared.has(value)) {
    context.error(path, 'workspaceSurface.hostService.undeclared', `Host service "${value}" is not declared in requires.hostServices.`);
  }
}

function validateCapabilities(capabilities, basePath, context) {
  if (capabilities === undefined) return;
  if (!isObject(capabilities)) {
    context.error(basePath, 'workspaceSurface.capabilities.shape', 'workspaceSurface.capabilities must be an object with { required, optional } arrays.');
    return;
  }
  validateCapabilityIds(capabilities.required, `${basePath}.required`, context);
  validateCapabilityIds(capabilities.optional, `${basePath}.optional`, context);
}

function validateProgressChannel(value, path, context) {
  if (value === undefined) return;
  if (typeof value !== 'string' || !WORKSPACE_SURFACE_PROGRESS_CHANNELS.includes(value)) {
    context.error(
      path,
      'workspaceSurface.progressChannel.invalid',
      `Progress channel must be one of ${WORKSPACE_SURFACE_PROGRESS_CHANNELS.join(', ')}.`,
    );
  }
}

function validateSession(session, basePath, context) {
  if (!isObject(session)) {
    context.error(basePath, 'workspaceSurface.session.required', 'workspaceSurface.session must declare { scope:"workspace" }.');
    return;
  }
  if (!WORKSPACE_SURFACE_SESSION_SCOPES.includes(session.scope)) {
    context.error(`${basePath}.scope`, 'workspaceSurface.session.scope', 'workspaceSurface.session.scope must be "workspace".');
  }
}

function validateShell(shell, basePath, context) {
  if (!isObject(shell)) {
    context.error(basePath, 'workspaceSurface.shell.required', 'workspaceSurface.shell must declare shared chat and cascade theme invariants.');
    return;
  }
  if (!WORKSPACE_SURFACE_CHAT_MODES.includes(shell.chat)) {
    context.error(`${basePath}.chat`, 'workspaceSurface.shell.chat', 'workspaceSurface.shell.chat must be "shared".');
  }
  if (!WORKSPACE_SURFACE_THEME_MODES.includes(shell.theme)) {
    context.error(`${basePath}.theme`, 'workspaceSurface.shell.theme', 'workspaceSurface.shell.theme must be "cascade".');
  }
}

function validateNoSurfaceOwnedShell(surface, basePath, context) {
  for (let field of FORBIDDEN_SURFACE_SHELL_FIELDS) {
    if (surface[field] === undefined) continue;
    context.error(
      `${basePath}.${field}`,
      'workspaceSurface.shell.owned',
      `workspaceSurface must not declare its own ${field}; use shell:{ chat:"shared", theme:"cascade" } and the global workspace shell.`,
    );
  }
}

function validateRouteDerivation(view, index, context) {
  let surface = view.workspaceSurface;
  let route = surface.route;
  let viewRoute = view.route;
  if (viewRoute !== undefined && route === undefined) {
    context.error(
      `views[${index}].workspaceSurface.route`,
      'workspaceSurface.route.required',
      'A routed workspace surface must declare a derived route contract.',
    );
    return;
  }
  if (route === undefined) return;
  let basePath = `views[${index}].workspaceSurface.route`;
  if (!isObject(route)) {
    context.error(basePath, 'workspaceSurface.route.shape', 'workspaceSurface.route must be an object.');
    return;
  }
  let derive = route.derive || 'view-id';
  if (!WORKSPACE_SURFACE_ROUTE_DERIVATIONS.includes(derive)) {
    context.error(`${basePath}.derive`, 'workspaceSurface.route.derive', 'workspaceSurface.route.derive must be "view-id".');
  }
  if (route.basePath !== undefined && (!hasText(route.basePath) || !route.basePath.startsWith('/'))) {
    context.error(`${basePath}.basePath`, 'workspaceSurface.route.basePath', 'workspaceSurface.route.basePath must be a base-path pattern starting with "/".');
  }
  let derivedPattern = deriveWorkspaceSurfaceRoute(view);
  if (!isObject(viewRoute)) {
    context.error(`views[${index}].route`, 'workspaceSurface.route.view_route', 'A derived workspace surface route requires views[].route.');
    return;
  }
  if (viewRoute.pattern !== derivedPattern) {
    context.error(
      `views[${index}].route.pattern`,
      'workspaceSurface.route.drift',
      `Route pattern must be derived from workspace surface id "${view.id}" as "${derivedPattern}".`,
    );
  }
}

function validateRenderProof(renderProof, basePath, context, declared) {
  if (renderProof === undefined) return;
  if (!isObject(renderProof)) {
    context.error(basePath, 'workspaceSurface.renderProof.shape', 'workspaceSurface.renderProof must be an object.');
    return;
  }
  if (renderProof.capability !== undefined && (
    typeof renderProof.capability !== 'string' || !CAPABILITY_ID_PATTERN.test(renderProof.capability)
  )) {
    context.error(`${basePath}.capability`, 'workspaceSurface.renderProof.capability', 'renderProof.capability must be a dotted capability id.');
  }
  if (renderProof.hostService !== undefined) {
    validateHostService(renderProof.hostService, `${basePath}.hostService`, context, declared);
  }
  validateProgressChannel(renderProof.progressChannel, `${basePath}.progressChannel`, context);
}

function validateSurface(view, index, context, declared) {
  let surface = view.workspaceSurface;
  let basePath = `views[${index}].workspaceSurface`;
  if (!isObject(surface)) {
    context.error(basePath, 'workspaceSurface.shape', 'workspaceSurface must be an object.');
    return;
  }
  if (!validatePortableId(view.id, `views[${index}].id`, context, 'Workspace surface view id')) return;
  if (surface.id !== undefined && surface.id !== view.id) {
    context.error(`${basePath}.id`, 'workspaceSurface.id.drift', 'workspaceSurface.id must equal its owning view id.');
  }
  validatePortableId(surface.kind, `${basePath}.kind`, context, 'Workspace surface kind');
  validateNoSurfaceOwnedShell(surface, basePath, context);
  validateSession(surface.session, `${basePath}.session`, context);
  validateShell(surface.shell, `${basePath}.shell`, context);
  validateCapabilities(surface.capabilities, `${basePath}.capabilities`, context);
  if (surface.hostServices !== undefined && !isObject(surface.hostServices)) {
    context.error(`${basePath}.hostServices`, 'workspaceSurface.hostServices.shape', 'workspaceSurface.hostServices must be an object with { required, optional } arrays.');
  } else if (isObject(surface.hostServices)) {
    validateHostServices(surface.hostServices.required, `${basePath}.hostServices.required`, context, declared);
    validateHostServices(surface.hostServices.optional, `${basePath}.hostServices.optional`, context, declared);
  }
  validateProgressChannel(surface.progressChannel, `${basePath}.progressChannel`, context);
  validateRenderProof(surface.renderProof, `${basePath}.renderProof`, context, declared);
  validateRouteDerivation(view, index, context);
}

function validate(config, context) {
  if (!isObject(config)) return;
  let declared = declaredHostServices(config);
  let views = asArray(config.views);
  for (let index = 0; index < views.length; index++) {
    let view = views[index];
    if (!isObject(view) || view.workspaceSurface === undefined) continue;
    validateSurface(view, index, context, declared);
  }
}

function refProviders(config) {
  let providers = [];
  for (let view of asArray(config?.views)) {
    if (!isObject(view) || !isObject(view.workspaceSurface) || !hasText(view.id)) continue;
    providers.push({
      id: `workspace-surface:${view.id}`,
      path: 'views[].workspaceSurface',
    });
  }
  return providers;
}

function refConsumers() {
  return [];
}

export const workspaceSurfacesSection = Object.freeze({
  id: WORKSPACE_SURFACES_SECTION_ID,
  validate,
  refProviders,
  refConsumers,
});

export default workspaceSurfacesSection;
