import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { renderDocsPage } from 'library-pages/shell';
import { createMarkdownRenderer } from '../../layout.js';
import { docsRoutes, docsSiteConfig } from '../../site.config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../../..');

const files = [
  { path: 'docs/architecture.md', title: 'Architecture and Entry Points' },
  { path: 'docs/host-contracts.md', title: 'Host Contracts and Construction Protocol' },
  { path: 'docs/plugins-and-templates.md', title: 'Plugins, Portability, and Templates' }
];

let markdown = '# Reference Manual\n\n';
markdown += 'This section contains the comprehensive reference manual for the `symbiote-workspace` library, compiled from the canonical documentation.\n\n';
markdown += '## Table of Contents\n\n';

for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const anchor = f.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  markdown += `${i + 1}. [${f.title}](#${anchor})\n`;
}

markdown += '\n---\n\n';

for (const f of files) {
  const fullPath = join(workspaceRoot, f.path);
  const content = readFileSync(fullPath, 'utf8');
  const anchor = f.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  markdown += `<section id="${anchor}">\n\n${content}\n\n</section>\n\n---\n\n`;
}

const contentHtml = marked.parse(markdown, { renderer: createMarkdownRenderer() });
const currentRoute = docsRoutes.find((route) => route.path === '/docs/reference/');

export default renderDocsPage({
  siteConfig: docsSiteConfig(currentRoute),
  routes: docsRoutes,
  currentRoute,
  contentHtml: `<article class="prose">${contentHtml}</article>`,
});
