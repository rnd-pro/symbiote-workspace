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

const WORKSPACE_TOKENS = /*css*/ `
:root {
  color-scheme: light;
  --page: #ffffff;
  --surface: #f7f7f8;
  --surface-soft: #f0f0f2;
  --surface-code: #f7f7f8;
  --ink: #3d3d45;
  --muted: #68686e;
  --line: #e3e3e5;
  --line-strong: #a6a6ad;
  --brand: #4058bd;
  --brand-strong: #2f449e;
  --brand-soft: #ebedf9;
  --mint: #1c7a65;
  --mint-soft: #e5f5f1;
  --amber: #a36200;
  --amber-soft: #fef5e6;
  --danger: #b82d3e;
  --focus: #4058bd;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #1c1d22;
  --surface: #222329;
  --surface-soft: #2a2b33;
  --surface-code: #222329;
  --ink: #e0e0d8;
  --muted: #9b9ba3;
  --line: #303137;
  --line-strong: #50525d;
  --brand: #8192ff;
  --brand-strong: #acb7ff;
  --brand-soft: #25283d;
  --mint: #33ccaa;
  --mint-soft: #14352f;
  --amber: #ffd075;
  --amber-soft: #382d18;
  --danger: #ff8c9c;
  --focus: #8192ff;
}
`;

const PROSE_STYLES = /*css*/ `
.prose { max-width: 760px; }
.prose h1, .prose h2, .prose h3, .prose h4 { color: var(--ink); line-height: 1.15; letter-spacing: -0.035em; }
.prose h1 { margin: 0 0 1.5rem; font-size: clamp(2.4rem, 5vw, 4rem); }
.prose h2 { margin: 3.5rem 0 1rem; padding-top: 0.5rem; font-size: 1.8rem; }
.prose h3 { margin: 2.4rem 0 0.8rem; font-size: 1.3rem; }
.prose p, .prose ul, .prose ol, .prose blockquote, .prose pre, .prose table { margin: 0 0 1.2rem; }
.prose p, .prose li { color: var(--muted); }
.prose li + li { margin-top: 0.3rem; }
.prose code { padding: 0.1rem 0.35rem; border-radius: 0.35rem; background: var(--surface-soft); color: var(--ink); font-family: var(--mono); font-size: 0.88em; }
.prose pre { overflow-x: auto; padding: 1rem 1.15rem; border: 1px solid var(--line); border-radius: 0.75rem; background: var(--surface); }
.prose pre code { padding: 0; background: transparent; }
.prose blockquote { padding-left: 1rem; border-left: 2px solid var(--brand); color: var(--muted); }
.prose table { width: 100%; border-collapse: collapse; display: block; overflow-x: auto; }
.prose th, .prose td { padding: 0.65rem; border-bottom: 1px solid var(--line); text-align: left; }
.prose th { color: var(--ink); }
`;

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
export function composeSiteConfig({ pageStyles = '', clientEntryPath = '/client/index.js', description } = {}) {
  return defineSiteConfig({
    ...BASE_CONFIG,
    metadata: {
      ...BASE_CONFIG.metadata,
      description: description ?? BASE_CONFIG.metadata.description,
    },
    pageStyles: `${WORKSPACE_TOKENS}${pageStyles}`,
    clientEntryPath,
  });
}

/**
 * @param {Object} currentRoute
 * @returns {Object}
 */
export function docsSiteConfig(currentRoute) {
  return composeSiteConfig({
    pageStyles: PROSE_STYLES,
    description: currentRoute.description,
  });
}
