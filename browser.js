/**
 * symbiote-workspace/browser — Browser-only entry point.
 *
 * Re-exports all isomorphic APIs from the root entry
 * plus browser-specific assembly: DOM mounting, theme application,
 * runtime controller integration.
 *
 * Requires a DOM environment (document, customElements).
 */

export * from './index.js';

/**
 * @param {import('./schema/workspace-schema.js').WorkspaceConfig} config
 * @param {HTMLElement} container
 * @param {Object} [options]
 * @param {Object} [options.catalog] - Component catalog
 * @param {Object} [options.runtimeController] - Optional symbiote-ui runtime controller
 * @returns {{ destroy: function(): void }}
 */
export function mountWorkspace(config, container, options = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new Error('mountWorkspace requires a DOM container element.');
  }

  let { loadWorkspaceConfig } = /** @type {any} */ (this || {});
  let loader = options.loader || loadWorkspaceConfig;
  if (!loader) {
    let mod = /** @type {any} */ (import('./loader/index.js'));
    throw new Error('mountWorkspace: loader not available synchronously. Import symbiote-workspace/browser properly.');
  }

  // Placeholder — v0.1 provides the contract, real DOM assembly in v0.2
  let fragment = container.ownerDocument.createDocumentFragment();
  let wrapper = container.ownerDocument.createElement('div');
  wrapper.dataset.workspaceName = config.name || 'workspace';
  wrapper.dataset.workspaceVersion = config.version || '0.1.0';
  fragment.appendChild(wrapper);
  container.appendChild(fragment);

  return {
    destroy() {
      wrapper.remove();
    },
  };
}
