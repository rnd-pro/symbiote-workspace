import { defineSiteConfig, defineDocsRoutes } from 'library-pages/shell';
import { readPagesEnv, createUrlHelpers } from 'library-pages/url';

export const pagesEnv = readPagesEnv(process.env);
export const { resolvePath, resolveUrl } = createUrlHelpers({
  basePath: pagesEnv.basePath,
  baseUrl: pagesEnv.baseUrl,
});

const BRAND_MARK_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' fill='none'%3E%3Cpath d='m4 10 12-7 12 7v12l-12 7-12-7V10Z' stroke='%234058bd' stroke-width='1.8'/%3E%3Cpath d='m4 10 12 7 12-7M16 17v12' stroke='%234058bd' stroke-width='1.8'/%3E%3Ccircle cx='16' cy='17' r='2.4' fill='%234058bd'/%3E%3C/svg%3E";

export const docsRoutes = defineDocsRoutes([
  {
    path: '/docs/',
    title: 'Guide',
    section: 'Guide',
    headers: ['workspace', 'construction', 'protocol', 'portable', 'chat'],
    description: 'How symbiote-workspace turns chat intent into portable, executable workspace configurations.',
  },
  {
    path: '/docs/getting-started/',
    title: 'Getting Started',
    section: 'Guide',
    headers: ['install', 'construct', 'mount', 'host', 'quick'],
    description: 'Installation, guided construction, and mounting a first portable workspace in a host.',
  },
  {
    path: '/docs/reference/',
    title: 'Reference',
    section: 'Reference',
    headers: ['architecture', 'host', 'contracts', 'plugins', 'templates', 'entry'],
    description: 'Architecture and entry points, host contracts, construction protocol, plugins, and templates.',
  },
]);

const SYMBIOTE_STACK = {
  title: 'The Symbiote stack',
  items: [
    {
      label: 'symbiote-workspace',
      description: 'The workspace-as-config layer and primary track of the stack. You are here.',
      current: true,
    },
    {
      label: 'symbiote-engine',
      description: 'Executes workspace graphs: portable DAG execution with composable server primitives.',
      path: 'https://rnd-pro.github.io/symbiote-engine/',
    },
    {
      label: 'symbiote-ui',
      description: 'Supplies the Web Components, themes, and canvas primitives workspaces mount.',
      path: 'https://rnd-pro.github.io/symbiote-ui/',
    },
  ],
};

const BASE_CONFIG = {
  brand: {
    title: 'symbiote-workspace',
    logo: BRAND_MARK_URI,
  },
  metadata: {
    title: 'symbiote-workspace',
    description: 'Construct portable, executable Symbiote workspaces from chat intent.',
    baseUrl: pagesEnv.baseUrl,
    icon: BRAND_MARK_URI,
  },
  navigation: [
    { label: 'Guide', path: '/docs/' },
    { label: 'Reference', path: '/docs/reference/' },
    { label: 'Demo', path: '/demo/' },
    { label: 'GitHub', path: 'https://github.com/RND-PRO/symbiote-workspace' },
  ],
  footer: {
    copyright: 'Released under the MIT License. symbiote-workspace',
    links: [
      { label: 'Built with JSDA-Kit', path: 'https://rnd-pro.com/pulse/jsda-kit-1-6/' },
      { label: 'GitHub', path: 'https://github.com/RND-PRO/symbiote-workspace' },
    ],
  },
  themeStorageKey: 'symbiote-theme',
  basePath: pagesEnv.basePath,
};

/**
 * @param {Object} [family]
 * @param {string} [family.pageStyles]
 * @param {string} [family.clientEntryPath]
 * @param {string} [family.description]
 * @returns {Object}
 */
export function composeSiteConfig({ pageStyles = '', clientEntryPath = '/client/index.js', description, withStack = false } = {}) {
  return defineSiteConfig({
    ...BASE_CONFIG,
    ...(withStack ? { stack: SYMBIOTE_STACK } : {}),
    metadata: {
      ...BASE_CONFIG.metadata,
      description: description ?? BASE_CONFIG.metadata.description,
    },
    pageStyles,
    clientEntryPath,
  });
}

/**
 * @param {Object} currentRoute
 * @returns {Object}
 */
export function docsSiteConfig(currentRoute) {
  return composeSiteConfig({
    clientEntryPath: '/docs/index.js',
    description: currentRoute.description,
  });
}
