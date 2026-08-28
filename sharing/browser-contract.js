export const BROWSER_THEME_IMPORT = 'symbiote-ui/ui';
export const BROWSER_ENGINE_IMPORT = 'symbiote-engine';
export const BROWSER_ENGINE_CONTRACTS_IMPORT = 'symbiote-engine/contracts';
export const BROWSER_ENGINE_PREFIX_IMPORT = 'symbiote-engine/';

export const BROWSER_REQUIRED_IMPORTS = Object.freeze([
  'symbiote-workspace/browser',
  BROWSER_THEME_IMPORT,
  BROWSER_ENGINE_IMPORT,
  BROWSER_ENGINE_CONTRACTS_IMPORT,
  BROWSER_ENGINE_PREFIX_IMPORT,
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
    themeAdapter: `${BROWSER_THEME_IMPORT}.applyCascadeTheme`,
    themeAdapterModule: BROWSER_THEME_IMPORT,
    themeAdapterExport: 'applyCascadeTheme',
    themeGeometryAdapter: `${BROWSER_THEME_IMPORT}.applyCascadeGeometryRegister`,
    themeGeometryAdapterExport: 'applyCascadeGeometryRegister',
    themeAdapterExports: ['applyCascadeTheme', 'applyCascadeGeometryRegister'],
    requiredImports: [...BROWSER_REQUIRED_IMPORTS],
    importMap: {
      ...BROWSER_IMPORT_MAP_CONTRACT,
      unsupportedContexts: [...BROWSER_IMPORT_MAP_CONTRACT.unsupportedContexts],
    },
    ...extra,
  };
}
