/** @type { import('jsda-kit/cfg').JSDA_CFG } */
export default {
  static: {
    sourceDir: './site',
    outputDir: './_site',
    port: 3000,
    entryPatterns: [
      'index.html.js',
      '**/index.js',
      '**/index.*.js',
      '404.html.js',
      'robots.txt.js',
      'sitemap.xml.js',
    ],
  },
  importmap: {
    packageList: [],
  },
  minify: { js: true, css: true, html: true, svg: true, exclude: [] },
  ssr: { enabled: false },
  sitemap: { enabled: false },
  log: true,
};
