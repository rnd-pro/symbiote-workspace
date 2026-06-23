/**
 * symbiote-workspace — Node-safe isomorphic SSR entry point.
 *
 * Server-renders the workspace shell chrome at build time (SSG). `SSR.init()`
 * patches Node process globals (document/window/customElements) via linkedom, so
 * it must never run in a live request path — build-time is the isolated, one-shot
 * place for it. The rendered `<workspace-shell>` markup is hydrated on the client
 * via isoMode, so first paint shows the shell chrome before the client boots and
 * reuses the server DOM instead of re-rendering it. Data-driven content (the
 * panel layout, `cascade-theme-widget`) is left as an empty mount and rendered on
 * the client; SSR-ing it would double-render since it does not opt into isoMode.
 *
 * This module has no DOM access at load time. The `WorkspaceShell` class extends
 * `HTMLElement`, which does not exist in Node until `SSR.init()` runs, so the
 * class is loaded lazily via {@link loadWorkspaceShell} rather than statically
 * re-exported.
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
  let { SSR } = await import('@symbiotejs/symbiote/node/SSR.js');
  await SSR.init();
  await import(new URL('./WorkspaceShell.js', import.meta.url).href);
  let placeholder = options.placeholder || WORKSPACE_SHELL_PLACEHOLDER;
  if (options.theme && placeholder === WORKSPACE_SHELL_PLACEHOLDER) {
    placeholder = withThemeStyle(placeholder, options.theme);
  }
  let html = await SSR.processHtml(placeholder);
  SSR.destroy();
  return html;
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
