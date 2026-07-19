import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { renderDocsPage } from 'library-pages/shell';
import { docsRoutes, docsSiteConfig, resolvePath } from './site.config.js';

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

function resolveMarkdownLink(href) {
  const normalized = href.replace(/^\.\//, '');
  const [path, fragment = ''] = normalized.split('#', 2);
  const canonical = canonicalDocLinks.get(path);
  if (canonical) return `${resolvePath(canonical)}${fragment ? `#${fragment}` : ''}`;
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

export function renderDocsMarkdown(mdRelativePath, currentPath) {
  const markdown = readFileSync(join(workspaceRoot, mdRelativePath), 'utf8');
  const currentRoute = docsRoutes.find((route) => route.path === currentPath);
  if (!currentRoute) throw new Error(`Unknown docs route: ${currentPath}`);
  const contentHtml = marked.parse(markdown, { renderer: createMarkdownRenderer() });
  return renderDocsPage({
    siteConfig: docsSiteConfig(currentRoute),
    routes: docsRoutes,
    currentRoute,
    contentHtml: `<article class="prose">${contentHtml}</article>`,
  });
}
