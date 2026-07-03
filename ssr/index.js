import { createRouteMatcher, buildPathFromPattern } from '../runtime/route-matcher.js';
import {
  buildHydrationPayload,
  hasRequiredCriticalMissing,
  runRouteDataLoaders,
  serializeHydrationPayload,
} from './data-loader.js';
import { renderWorkspaceShellTemplate } from './workspace-shell.tpl.js';

/**
 * symbiote-workspace — Node-safe isomorphic SSR entry point.
 *
 * The Symbiote SSR harness patches process globals, so all shell renders serialize
 * through a module-level lock. Route matching and data loading stay pure and reuse
 * the runtime matcher; the custom element class is still loaded lazily after
 * `SSR.init()` because it extends HTMLElement.
 */

/**
 * Placeholder element that build-time SSG replaces with the rendered shell HTML.
 * @type {string}
 */
export const WORKSPACE_SHELL_PLACEHOLDER = '<workspace-shell class="workspace-shell"></workspace-shell>';

/**
 * Lazily load the `WorkspaceShell` custom element class.
 *
 * Must be called after `SSR.init()` (or in a real browser); importing the class
 * before DOM globals exist throws because it extends `HTMLElement`.
 *
 * @returns {Promise<typeof import('./WorkspaceShell.js').WorkspaceShell>}
 */
export async function loadWorkspaceShell() {
  let { WorkspaceShell } = await import(new URL('./WorkspaceShell.js', import.meta.url).href);
  return WorkspaceShell;
}

/**
 * Server-render the workspace shell chrome to an HTML string.
 *
 * Initializes the SSR environment, registers the shell custom element, renders
 * the placeholder, and tears the environment back down. Init/destroy are balanced
 * so repeated calls are safe.
 *
 * @param {object} [options]
 * @param {string} [options.placeholder] Element markup to render. Defaults to
 *   {@link WORKSPACE_SHELL_PLACEHOLDER}.
 * @param {Record<string, string>} [options.theme] Optional CSS custom properties
 *   to apply to the shell wrapper as an inline `style`, e.g.
 *   `{ '--sn-theme-hue': '210' }`. Only applied when the placeholder is the
 *   default single-element wrapper.
 * @returns {Promise<string>} The rendered shell HTML.
 */
export async function renderWorkspaceShell(options = {}) {
  let previous = _inFlight ?? Promise.resolve();
  let current = previous
    .catch(() => {})
    .then(() => renderShellOnce(options));
  _inFlight = current.then(
    () => { if (_inFlight === current) _inFlight = null; },
    () => { if (_inFlight === current) _inFlight = null; },
  );
  return current;
}

/**
 * Module-level single-flight lock. Holds the tail of the render chain so the
 * shared SSR globals are never patched by two renders at once.
 * @type {Promise<void>|null}
 */
let _inFlight = null;

/**
 * Render the shell once with a balanced SSR environment. The try/finally
 * guarantees `SSR.destroy()` runs even if `processHtml` throws, so the process
 * globals are never left patched and the single-flight lock cannot deadlock.
 *
 * @param {object} options See {@link renderWorkspaceShell}.
 * @returns {Promise<string>}
 */
async function renderShellOnce(options) {
  let { SSR } = await import('@symbiotejs/symbiote/node/SSR.js');
  await SSR.init();
  try {
    let { WorkspaceShell } = await import(new URL('./WorkspaceShell.js', import.meta.url).href);
    let routeContext = await buildRouteContext(options);
    let template = renderWorkspaceShellTemplate(routeContext || {});
    if (globalThis.customElements?.get('workspace-shell')) {
      WorkspaceShell.template = template;
    } else if (globalThis.customElements) {
      class SSRWorkspaceShell extends WorkspaceShell {}
      SSRWorkspaceShell.template = template;
      SSRWorkspaceShell.reg('workspace-shell');
    } else {
      WorkspaceShell.template = template;
    }
    let placeholder = options.placeholder || WORKSPACE_SHELL_PLACEHOLDER;
    if (routeContext && options.placeholder === undefined) {
      placeholder = `<workspace-shell class="workspace-shell">${template}</workspace-shell>`;
    }
    if (options.theme && placeholder === WORKSPACE_SHELL_PLACEHOLDER) {
      placeholder = withThemeStyle(placeholder, options.theme);
    }
    let html = await SSR.processHtml(placeholder);
    if (routeContext) html = placeholder;
    if (!routeContext) return html;
    let fullHtml = `${routeContext.head}${html}`;
    return {
      status: routeContext.status,
      html: fullHtml,
      head: routeContext.head,
      route: routeContext.route,
      redirects: routeContext.redirects,
      redirect: routeContext.redirect,
      data: routeContext.data,
      meta: routeContext.meta,
      denied: routeContext.denied,
    };
  } finally {
    SSR.destroy();
  }
}

/**
 * Inject inline theme CSS variables into the default shell wrapper open tag.
 *
 * @param {string} placeholder
 * @param {Record<string, string>} theme
 * @returns {string}
 */
function withThemeStyle(placeholder, theme) {
  let style = Object.entries(theme)
    .filter(([name, value]) => typeof name === 'string' && value != null)
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ');
  if (!style) return placeholder;
  return placeholder.replace('<workspace-shell ', `<workspace-shell style="${style}" `);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value) {
  return typeof value === 'string' && value.length > 0;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function defaultRouteUrl(config) {
  let matcher = createRouteMatcher(config);
  let view = asArray(config.views).find((entry) => entry?.route?.default === true)
    || asArray(config.views).find((entry) => entry?.route && entry.route.kind !== 'fallback');
  if (!view) return '/';
  try {
    return matcher.urlForView(view.id, {}, {});
  } catch {
    return view.route?.pattern && !view.route.pattern.includes(':') ? view.route.pattern : '/';
  }
}

function routeView(config, viewId) {
  return asArray(config.views).find((view) => view?.id === viewId) || null;
}

function capabilityRecord(snapshot, capability) {
  if (!isObject(snapshot)) return undefined;
  if (isObject(snapshot.capabilities)) return snapshot.capabilities[capability];
  return snapshot[capability];
}

async function guardVerdict(guard, match, options) {
  if (hasText(guard.requires)) {
    let snapshot = typeof options.capabilitySnapshot === 'function'
      ? options.capabilitySnapshot()
      : options.capabilitySnapshot;
    if (snapshot && typeof snapshot.then === 'function') snapshot = await snapshot;
    let record = capabilityRecord(snapshot, guard.requires);
    if (!isObject(record) || record.auth?.policy !== 'allow') {
      return {
        action: 'deny',
        reason: record ? 'capability-denied' : 'capability-unknown',
        requires: guard.requires,
      };
    }
    return { action: 'allow' };
  }
  if (hasText(guard.hook)) {
    let runner = options.runGuard || options.guardHooks?.[guard.hook];
    if (typeof runner !== 'function') return { action: 'deny', reason: 'guard-hook-missing' };
    let value = await runner({ guard, route: match.route, params: match.params, query: match.query, edge: 'enter' });
    if (value === false || value === 'deny') return { action: 'deny', reason: 'guard-denied' };
    if (isObject(value) && (value.action === 'deny' || value.verdict === 'deny')) {
      return { action: 'deny', reason: value.reason || 'guard-denied', requires: value.requires };
    }
  }
  return { action: 'allow' };
}

async function evaluateEnterGuards(match, options) {
  for (let guard of asArray(match?.route?.guards).filter((entry) => entry?.on === 'enter')) {
    let verdict = await guardVerdict(guard, match, options);
    if (verdict.action === 'allow') continue;
    return {
      denied: {
        view: match.viewId,
        reason: verdict.reason || 'guard-denied',
        requires: verdict.requires,
      },
    };
  }
  return { denied: null };
}

function resolveLocalizable(value, config, locale) {
  if (typeof value === 'string') {
    if (value.startsWith('content:')) return value;
    return value;
  }
  if (!isObject(value)) return '';
  if (typeof value.default === 'string') {
    return value.locales?.[locale] || value.default;
  }
  if (typeof value.$t === 'string') {
    let i18n = config.i18n || {};
    let defaultLocale = i18n.defaultLocale || i18n.locale || 'en';
    return i18n.messages?.[locale]?.[value.$t]
      || i18n.messages?.[defaultLocale]?.[value.$t]
      || value.$t;
  }
  return '';
}

function fillPattern(pattern, params = {}) {
  if (!hasText(pattern)) return '';
  try {
    return buildPathFromPattern(pattern, params);
  } catch {
    return pattern.replace(/:([A-Za-z_][A-Za-z0-9_]*)(\+)?/g, (_, name) => (
      encodeURIComponent(params[name] ?? '')
    ));
  }
}

function resolveAsset(metaOg, config, options) {
  if (!hasText(metaOg)) return '';
  let id = metaOg.startsWith('asset:') ? metaOg.slice('asset:'.length) : metaOg;
  let asset = asArray(config.assets).find((entry) => entry?.id === id);
  let resolver = options.resolveAsset || options.assetResolver;
  if (typeof resolver === 'function') return resolver(id, asset);
  return asset?.url || asset?.href || metaOg;
}

function metaForRoute(config, match, options) {
  let routeMeta = match?.route?.meta || {};
  let locale = options.locale || config.i18n?.defaultLocale || config.i18n?.locale || 'en';
  let title = resolveLocalizable(routeMeta.title, config, locale) || config.name || 'Symbiote Workspace';
  let description = resolveLocalizable(routeMeta.description, config, locale);
  let canonical = routeMeta.canonical ? fillPattern(routeMeta.canonical, match?.params || {}) : match?.url || '';
  let og = resolveAsset(routeMeta.og, config, options);
  let hreflang = [];
  if (routeMeta.hreflang === 'auto') {
    for (let item of asArray(config.i18n?.locales)) {
      let tag = typeof item === 'string' ? item : item?.locale || item?.tag;
      if (tag) hreflang.push({ locale: tag, href: canonical });
    }
  } else {
    hreflang = asArray(routeMeta.hreflang).map((item) => ({
      locale: item.locale,
      href: fillPattern(item.pattern, match?.params || {}),
    }));
  }
  return { title, description, canonical, og, hreflang, locale };
}

function renderHead(meta) {
  let parts = [`<title>${escapeHtml(meta.title)}</title>`];
  if (meta.description) parts.push(`<meta name="description" content="${escapeHtml(meta.description)}">`);
  if (meta.og) parts.push(`<meta property="og:image" content="${escapeHtml(meta.og)}">`);
  if (meta.canonical) parts.push(`<link rel="canonical" href="${escapeHtml(meta.canonical)}">`);
  for (let item of meta.hreflang || []) {
    if (item.locale && item.href) {
      parts.push(`<link rel="alternate" hreflang="${escapeHtml(item.locale)}" href="${escapeHtml(item.href)}">`);
    }
  }
  return parts.join('');
}

async function buildRouteContext(options) {
  if (!options.config && !options.url) return null;
  let config = options.config || {};
  let matcher = options.matcher || createRouteMatcher(config);
  let url = options.url || defaultRouteUrl(config);
  let resolved = matcher.resolve(url);

  if (resolved.type !== 'route') {
    let redirect = resolved.redirects?.[resolved.redirects.length - 1];
    if (redirect) {
      return {
        status: redirect.status,
        head: '',
        route: null,
        redirects: resolved.redirects,
        redirect,
        data: { envelopes: {}, ordered: [], byBind: {} },
        meta: {},
        config,
        title: config.name || 'Symbiote Workspace',
        statusText: 'redirect',
        omitPanels: true,
      };
    }
    let meta = { title: config.name || 'Symbiote Workspace', description: '', canonical: '', og: '', hreflang: [] };
    return {
      status: 404,
      head: renderHead(meta),
      route: null,
      redirects: resolved.redirects || [],
      data: { envelopes: {}, ordered: [], byBind: {} },
      meta,
      config,
      title: meta.title,
      omitPanels: false,
    };
  }

  if (resolved.redirects?.length > 0) {
    let redirect = resolved.redirects[0];
    return {
      status: redirect.status,
      head: '',
      route: {
        view: resolved.match?.viewId,
        params: resolved.match?.params || {},
        query: resolved.match?.query || {},
        url: resolved.url,
      },
      redirects: resolved.redirects,
      redirect,
      data: { envelopes: {}, ordered: [], byBind: {} },
      meta: {},
      config,
      title: config.name || 'Symbiote Workspace',
      omitPanels: true,
    };
  }

  let match = resolved.match;
  let deniedResult = await evaluateEnterGuards(match, options);
  let data = deniedResult.denied
    ? { envelopes: {}, ordered: [], byBind: {} }
    : await runRouteDataLoaders(match, options);
  let meta = metaForRoute(config, match, options);
  let status = 200;
  let denied = deniedResult.denied;
  if (match.kind === 'fallback') status = 404;
  if (denied) status = 403;
  if (!denied && hasRequiredCriticalMissing(data)) status = 404;

  let payload = buildHydrationPayload(match, data);
  return {
    status,
    head: renderHead(meta),
    route: {
      view: match.viewId,
      params: match.params,
      query: match.query,
      url: resolved.url,
    },
    redirects: resolved.redirects || [],
    data,
    meta,
    config,
    view: denied ? null : routeView(config, match.viewId),
    denied,
    title: meta.title,
    dataPayload: serializeHydrationPayload(payload),
    omitPanels: denied ? true : false,
  };
}
