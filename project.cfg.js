import { createPagesJsdaConfig } from 'library-pages/jsda';

export default createPagesJsdaConfig({
  sourceDir: './site',
  outputDir: './_site',
  entryPatterns: [
    'index.html.js',
    '**/index.html.js',
    '404.html.js',
    '**/index.js',
    'robots.txt.js',
    'sitemap.xml.js',
  ],
});
