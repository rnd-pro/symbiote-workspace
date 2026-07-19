import { renderPage } from 'library-pages/shell';
import { buildSearchIndex } from 'library-pages/search';
import { composeSiteConfig, docsRoutes, resolvePath } from './site.config.js';

const errorStyles = /*css*/ `
.not-found {
  padding: clamp(4rem, 10vw, 7rem) 0;
}
.not-found h1 {
  max-width: 620px;
  margin: 0 0 1.4rem;
  color: var(--ink);
  font-size: clamp(2.6rem, 6vw, 4.4rem);
  line-height: 1.05;
  letter-spacing: -0.05em;
}
.not-found p {
  max-width: 560px;
  margin: 0 0 2.2rem;
  color: var(--muted);
  font-size: 1.15rem;
}
.not-found-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0 1.25rem;
  border-radius: 999px;
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
}
.btn-primary { border: 1px solid var(--brand); background: var(--brand); color: var(--page); }
.btn-primary:hover { background: var(--brand-strong); border-color: var(--brand-strong); color: var(--page); }
.btn-secondary { border: 1px solid var(--line); background: transparent; color: var(--ink); }
.btn-secondary:hover { border-color: var(--line-strong); background: var(--surface-soft); }
`;

export default renderPage({
  siteConfig: composeSiteConfig({
    pageStyles: errorStyles,
    description: 'The requested symbiote-workspace page could not be found.',
  }),
  pageTitle: 'Page Not Found',
  contentHtml: /*html*/ `
<section class="not-found" aria-labelledby="not-found-title">
  <h1 id="not-found-title">Page Not Found.</h1>
  <p>The page may have moved, or the route may not be part of this package.</p>
  <div class="not-found-actions">
    <a class="btn btn-primary" href="${resolvePath('/')}">Back to home</a>
    <a class="btn btn-secondary" href="${resolvePath('/docs/')}">Read the guide</a>
  </div>
</section>
`,
  currentPath: '/404.html',
  searchIndex: buildSearchIndex(docsRoutes),
});
