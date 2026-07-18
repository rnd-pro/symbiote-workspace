import { pageTemplate, url } from './layout.js';

export default pageTemplate({
  title: 'Page Not Found',
  currentPath: '/404.html',
  content: `<section class="hero" aria-labelledby="not-found-title">
  <h1 id="not-found-title" class="hero-title">Page Not Found.</h1>
  <p class="hero-lead">The page may have moved, or the route may not be part of this package.</p>
  <div class="hero-actions"><a class="btn btn-primary" href="${url('/')}">Back to home</a><a class="btn btn-secondary" href="${url('/docs/')}">Read the guide</a></div>
</section>`,
});
