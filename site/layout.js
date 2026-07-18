import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { routes } from './manifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '..');
const repositoryBlobUrl = 'https://github.com/RND-PRO/symbiote-workspace/blob/main/';
const repositoryRawUrl = 'https://raw.githubusercontent.com/RND-PRO/symbiote-workspace/main/';
const canonicalDocLinks = new Map([
  ['README.md', '/docs/'],
  ['docs/getting-started.md', '/docs/getting-started/'],
  ['docs/architecture.md', '/docs/reference/#architecture-and-entry-points'],
  ['docs/host-contracts.md', '/docs/reference/#host-contracts-and-construction-protocol'],
  ['docs/plugins-and-templates.md', '/docs/reference/#plugins-portability-and-templates'],
]);

const origin = process.env.ORIGIN || 'https://rnd-pro.github.io';
const basePath = process.env.BASE_PATH || '/';
const baseUrl = process.env.BASE_URL || `${origin}${basePath.endsWith('/') ? basePath : `${basePath}/`}`;

export function url(path) {
  if (!path.startsWith('/')) return path;
  const prefix = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${prefix}${path}`;
}

function icon(name) {
  if (name === 'search') {
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="10.8" cy="10.8" r="6.5"></circle><path d="m16 16 5 5"></path></svg>';
  }
  if (name === 'sun') {
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path></svg>';
  }
  return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M20.5 15.2A8.6 8.6 0 0 1 8.8 3.5 8.7 8.7 0 1 0 20.5 15.2Z"></path></svg>';
}

function navLink(route, currentPath) {
  const active = currentPath === route.path || (route.path !== '/' && currentPath.startsWith(route.path));
  return `<a href="${url(route.path)}"${active ? ' aria-current="page" class="is-current"' : ''}>${route.label}</a>`;
}

function header(currentPath) {
  const nav = routes.filter((route) => route.inNav).map((route) => navLink(route, currentPath)).join('');
  return `<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="${url('/')}" aria-label="symbiote-workspace home">
      <svg class="brand-mark" aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="m4 10 12-7 12 7v12l-12 7-12-7V10Z"/><path d="m4 10 12 7 12-7M16 17v12"/><circle cx="16" cy="17" r="2.4"/></svg>
      <span>symbiote-workspace</span>
    </a>
    <a class="header-search" href="${url('/docs/')}" aria-label="Open the guide">
      ${icon('search')}<span>Search docs</span><kbd>⌘K</kbd>
    </a>
    <div class="header-actions">
      <nav class="main-nav" aria-label="Main navigation">${nav}</nav>
      <a class="github-link" href="https://github.com/RND-PRO/symbiote-workspace" target="_blank" rel="noopener noreferrer">GitHub</a>
      <button id="theme-toggle" class="theme-toggle-btn" type="button" aria-label="Toggle color theme">${icon('sun')}${icon('moon')}</button>
    </div>
  </div>
</header>`;
}

function docsSidebar(currentPath) {
  const links = routes.filter((route) => route.isDocs && route.path !== '/docs/getting-started/')
    .map((route) => `<li><a href="${url(route.path)}"${currentPath === route.path ? ' aria-current="page" class="is-current"' : ''}>${route.label}</a></li>`)
    .join('');
  return `<aside class="docs-sidebar"><p class="sidebar-kicker">Guide</p><nav aria-label="Documentation navigation"><ul>${links}</ul></nav></aside>`;
}

export function pageTemplate({ title, content, currentPath, isDocs = false }) {
  const canonicalBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const canonicalUrl = `${canonicalBase}${currentPath}`;
  const bodyClass = isDocs ? 'page-docs' : 'page-landing';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Construct portable, executable Symbiote workspaces from chat intent.">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:title" content="${title} · symbiote-workspace">
  <meta property="og:description" content="Construct portable, executable Symbiote workspaces from chat intent.">
  <meta property="og:url" content="${canonicalUrl}">
  <title>${title} · symbiote-workspace</title>
  <script>(function(){let mode='light';try{mode=localStorage.getItem('symbiote-theme')|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch{};document.documentElement.dataset.theme=mode}())</script>
  <link rel="stylesheet" href="${url('/css/styles.css')}">
  <script type="module" src="${url('/js/main.js')}"></script>
</head>
<body class="${bodyClass}">
  <a class="skip-link" href="#main-content">Skip to content</a>
  ${header(currentPath)}
  <div class="page-frame ${isDocs ? 'page-frame-docs' : ''}">
    ${isDocs ? docsSidebar(currentPath) : ''}
    <main id="main-content" tabindex="-1">${content}</main>
  </div>
  <footer class="site-footer"><div class="site-width"><span>Released under the MIT License.</span><a href="https://rnd-pro.com/pulse/jsda-kit-1-6/" target="_blank" rel="noopener noreferrer">Built with JSDA-Kit</a></div></footer>
</body>
</html>`;
}

function resolveMarkdownLink(href) {
  const normalized = href.replace(/^\.\//, '');
  const [path, fragment = ''] = normalized.split('#', 2);
  const canonical = canonicalDocLinks.get(path);
  if (canonical) return `${url(canonical)}${fragment ? `#${fragment}` : ''}`;
  return `${repositoryBlobUrl}${normalized}`;
}

export function createMarkdownRenderer() {
  const renderer = new marked.Renderer();
  const originalLink = renderer.link.bind(renderer);
  renderer.link = (arg1, arg2, arg3) => {
    const href = typeof arg1 === 'object' && arg1 !== null ? arg1.href || '' : arg1 || '';
    let html = typeof arg1 === 'object' && arg1 !== null ? originalLink(arg1) : originalLink(arg1, arg2, arg3);
    if (href && /^(?:https?:|\/\/)/.test(href)) {
      return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
    }
    if (href && !href.startsWith('#')) {
      const rewrittenHref = resolveMarkdownLink(href);
      html = html.replace(`href="${href}"`, `href="${rewrittenHref}"`);
      if (rewrittenHref.startsWith('https://')) html = html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
    }
    return html;
  };
  const originalImage = renderer.image.bind(renderer);
  renderer.image = (arg1, arg2, arg3) => {
    if (typeof arg1 === 'object' && arg1 !== null) {
      if (arg1.href && !arg1.href.startsWith('http')) arg1.href = repositoryRawUrl + arg1.href.replace(/^\.\//, '');
      return originalImage(arg1);
    }
    const src = arg1 && !arg1.startsWith('http') ? repositoryRawUrl + arg1.replace(/^\.\//, '') : arg1;
    return originalImage(src, arg2, arg3);
  };
  return renderer;
}

export function renderDocsMarkdown(mdRelativePath, title, currentPath) {
  const markdown = readFileSync(join(workspaceRoot, mdRelativePath), 'utf8');
  const contentHtml = marked.parse(markdown, { renderer: createMarkdownRenderer() });
  return pageTemplate({ title, content: `<article class="prose">${contentHtml}</article>`, currentPath, isDocs: true });
}
