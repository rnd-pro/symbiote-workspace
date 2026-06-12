export const BROWSER_REQUIRED_IMPORTS = Object.freeze([
  'symbiote-workspace/browser',
  'symbiote-ui',
]);

const BROWSER_IMPORT_MAP_CONTRACT = Object.freeze({
  required: true,
  scriptType: 'importmap',
  featureDetection: "HTMLScriptElement.supports?.('importmap')",
  mustLoadBeforeModuleScript: true,
  appliesTo: 'document-modules',
  unsupportedContexts: Object.freeze(['workers', 'worklets']),
});

export function createBrowserRuntimeContract(extra = {}) {
  return {
    entrypoint: 'symbiote-workspace/browser',
    mountFunction: 'mountWorkspace',
    themeAdapter: 'symbiote-ui.applyCascadeTheme',
    requiredImports: [...BROWSER_REQUIRED_IMPORTS],
    importMap: {
      ...BROWSER_IMPORT_MAP_CONTRACT,
      unsupportedContexts: [...BROWSER_IMPORT_MAP_CONTRACT.unsupportedContexts],
    },
    ...extra,
  };
}
