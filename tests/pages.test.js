import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';

import { parseHTML } from 'linkedom';

import { renderDocsMarkdown } from '../site/layout.js';
import { routes } from '../site/manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const SITE_DIR = join(ROOT, '_site');
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '/');
const ORIGIN = process.env.ORIGIN || 'https://rnd-pro.github.io';
const BASE_URL = process.env.BASE_URL || `${ORIGIN}${BASE_PATH}`;
const CANONICAL_BASE = BASE_URL.replace(/\/$/, '');
const LOCAL_ORIGIN = 'https://pages.test';
const EXPECTED_ENTRYPOINTS = [
  'symbiote-workspace/browser.js',
  'symbiote-workspace/ssr/WorkspaceShell.js',
  'symbiote-ui/ui/index.js',
  'symbiote-ui/tokens/scale.js',
  'symbiote-ui/board/index.js',
  'symbiote-ui/canvas/CanvasViewport.js',
  'symbiote-ui/icons/material-symbols.css',
  'symbiote-ui/icons/material-symbols-outlined-400.ttf',
  'symbiote-engine/browser.js',
  'symbiote-engine/contracts/index.js',
  '@symbiotejs/symbiote/core/index.js',
  '@symbiotejs/symbiote/utils/index.js',
];
const EXPECTED_LAZY_NODE_IMPORTS = ['symbiote-engine/Persistence.js::node:fs/promises'];
const FORBIDDEN_VENDOR_PATHS = [
  /(^|\/)(?:test|tests|docs|skills|scripts|examples|types|server)(\/|$)/i,
  /(^|\/)(?:cli|GraphServer|HandlerLoader)\.js$/i,
  /(^|\/)package\.json$/i,
];

function normalizeBasePath(value) {
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

function outputForRoute(path) {
  if (path === '/') return 'index.html';
  return `${path.replace(/^\//, '')}index.html`;
}

function sortedEntries(directory) {
  return readdirSync(directory).sort();
}

function recursiveFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...recursiveFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unexpected non-file artifact: ${path}`);
  }
  return files.sort();
}

function htmlDocument(relativePath) {
  return parseHTML(readFileSync(join(SITE_DIR, relativePath), 'utf8')).document;
}

function localOutputPath(pathname) {
  assert.ok(pathname.startsWith(BASE_PATH), `Local URL escaped BASE_PATH: ${pathname}`);
  let relativePath = decodeURIComponent(pathname.slice(BASE_PATH.length));
  if (!relativePath || relativePath.endsWith('/')) relativePath += 'index.html';
  return relativePath;
}

function assertLocalReferences(relativePath) {
  const document = htmlDocument(relativePath);
  const publicPath = relativePath === 'index.html'
    ? BASE_PATH
    : `${BASE_PATH}${relativePath.replace(/index\.html$/, '')}`;
  const pageUrl = new URL(publicPath, LOCAL_ORIGIN);

  for (const element of document.querySelectorAll('[href], [src]')) {
    const attribute = element.hasAttribute('href') ? 'href' : 'src';
    const value = element.getAttribute(attribute);
    if (!value || value.startsWith('#') || /^(?:data:|mailto:|tel:)/.test(value)) continue;
    const target = new URL(value, pageUrl);
    if (target.origin !== LOCAL_ORIGIN) continue;

    const targetPath = localOutputPath(target.pathname);
    const diskPath = join(SITE_DIR, targetPath);
    assert.ok(existsSync(diskPath), `${relativePath} references missing ${targetPath}`);
    if (target.hash && statSync(diskPath).isFile() && targetPath.endsWith('.html')) {
      const targetDocument = htmlDocument(targetPath);
      const id = decodeURIComponent(target.hash.slice(1));
      assert.ok(targetDocument.getElementById(id), `${relativePath} references missing #${id} in ${targetPath}`);
    }
  }
}

test('manifest routes and generated output are exact', () => {
  assert.deepEqual(routes, [
    { path: '/', label: 'Home', inNav: false, inSitemap: true },
    { path: '/docs/', label: 'Guide', inNav: true, inSitemap: true, isDocs: true },
    { path: '/docs/reference/', label: 'Reference', inNav: true, inSitemap: true, isDocs: true },
    { path: '/demo/', label: 'Demo', inNav: true, inSitemap: true },
    { path: '/docs/getting-started/', label: 'Getting Started', inNav: false, inSitemap: true, isDocs: true },
  ]);
  assert.deepEqual(sortedEntries(SITE_DIR), [
    '.nojekyll',
    '404.html',
    'client',
    'demo',
    'docs',
    'index.html',
    'robots.txt',
    'sitemap.xml',
  ]);
  assert.deepEqual(sortedEntries(join(SITE_DIR, 'client')), ['index.js']);
  assert.deepEqual(sortedEntries(join(SITE_DIR, 'docs')), ['getting-started', 'index.html', 'reference']);
  assert.deepEqual(sortedEntries(join(SITE_DIR, 'docs', 'getting-started')), ['index.html']);
  assert.deepEqual(sortedEntries(join(SITE_DIR, 'docs', 'reference')), ['index.html']);
  assert.deepEqual(sortedEntries(join(SITE_DIR, 'demo')), [
    'app.js',
    'index.html',
    'scenarios.json',
    'vendor',
    'vendor-manifest.json',
  ]);
  for (const route of routes) assert.ok(existsSync(join(SITE_DIR, outputForRoute(route.path))));
});

test('canonical URLs, internal links, assets, sitemap, robots, and 404 honor BASE_PATH', () => {
  for (const route of routes.filter((route) => route.path !== '/demo/')) {
    const output = outputForRoute(route.path);
    const document = htmlDocument(output);
    assert.equal(document.querySelector('base'), null, `${output} must not use <base>`);
    assert.equal(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), `${CANONICAL_BASE}${route.path}`);
    assertLocalReferences(output);
  }

  const notFound = htmlDocument('404.html');
  assert.match(notFound.documentElement.textContent, /Page Not Found/);
  assert.equal(notFound.querySelector('link[rel="canonical"]')?.getAttribute('href'), `${CANONICAL_BASE}/404.html`);
  assertLocalReferences('404.html');
  assertLocalReferences('demo/index.html');

  const expectedLocations = routes
    .filter((route) => route.inSitemap)
    .map((route) => `${CANONICAL_BASE}${route.path}`);
  const sitemap = readFileSync(join(SITE_DIR, 'sitemap.xml'), 'utf8');
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]), expectedLocations);
  const robots = readFileSync(join(SITE_DIR, 'robots.txt'), 'utf8');
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/m);
  assert.match(robots, new RegExp(`Sitemap: ${escapeRegExp(`${CANONICAL_BASE}/sitemap.xml`)}`));
});

test('synthetic project path is applied to rendered links, assets, canonicals, sitemap, and robots', () => {
  const script = `
    import { pathToFileURL } from 'node:url';
    const root = pathToFileURL(process.cwd() + '/');
    const modules = ${JSON.stringify([
      ['/', 'site/index.html.js'],
      ['/docs/', 'site/docs/index.html.js'],
      ['/docs/getting-started/', 'site/docs/getting-started/index.html.js'],
      ['/docs/reference/', 'site/docs/reference/index.html.js'],
      ['/404.html', 'site/404.html.js'],
      ['sitemap', 'site/sitemap.xml.js'],
      ['robots', 'site/robots.txt.js'],
    ])};
    const output = {};
    for (const [key, path] of modules) output[key] = (await import(new URL(path, root))).default;
    process.stdout.write(JSON.stringify(output));
  `;
  const rendered = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: ROOT,
    env: {
      ...process.env,
      ORIGIN: 'https://example.test',
      BASE_PATH: '/synthetic-project/',
      BASE_URL: 'https://example.test/synthetic-project/',
    },
    encoding: 'utf8',
  }));

  for (const path of ['/', '/docs/', '/docs/getting-started/', '/docs/reference/', '/404.html']) {
    const document = parseHTML(rendered[path]).document;
    assert.equal(document.querySelector('base'), null);
    assert.equal(
      document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      `https://example.test/synthetic-project${path}`,
    );
    for (const element of document.querySelectorAll('[href], [src]')) {
      const value = element.getAttribute(element.hasAttribute('href') ? 'href' : 'src');
      if (!value || value.startsWith('#') || /^(?:https?:|\/\/|data:|mailto:|tel:)/.test(value)) continue;
      assert.ok(value.startsWith('/synthetic-project/'), `${path} contains unprefixed URL ${value}`);
    }
  }
  assert.deepEqual(
    [...rendered.sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
    routes.filter((route) => route.inSitemap).map((route) => `https://example.test/synthetic-project${route.path}`),
  );
  assert.match(rendered.robots, /Sitemap: https:\/\/example\.test\/synthetic-project\/sitemap\.xml/);
});

test('the landing narrative remains semantic, restrained, and visible without JavaScript', () => {
  const document = htmlDocument('index.html');
  const pipeline = document.querySelector('ol[data-pipeline]');
  assert.ok(pipeline);
  assert.equal(pipeline.classList.contains('motion-ready'), false);
  assert.deepEqual(
    [...pipeline.children].map((item) => item.querySelector('.ill-header')?.textContent),
    ['Register', 'Compose', 'Validate', 'Export'],
  );
  assert.match(document.documentElement.textContent, /turns chat intent into portable, executable workspaces/i);
  assert.ok(document.querySelector('[data-search-trigger]'));
  assert.ok(document.querySelector('a[href*="/docs/"]'));
  assert.equal(document.querySelectorAll('.motion-surface button, .motion-surface input, .motion-surface select').length, 0);

  const css = [
    readFileSync(join(ROOT, 'site', 'site.config.js'), 'utf8'),
    readFileSync(join(ROOT, 'site', 'index.html.js'), 'utf8'),
  ].join('\n');
  const javascript = readFileSync(join(ROOT, 'site', 'client', 'index.js'), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
  assert.match(css, /animation:/);
  assert.match(css, /\.motion-surface\s*\{[^}]*background:\s*transparent;/);
  assert.doesNotMatch(css, /\.motion-surface\s*\{[^}]*border(?:-radius)?\s*:/);
  assert.match(javascript, /classList\.add\('motion-ready'\)/);

  const definitions = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
  const references = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((match) => match[1]));
  assert.deepEqual([...references].filter((name) => !definitions.has(name)), []);
});

test('Pages shell and generated demo assets are production optimized', () => {
  const clientSource = readFileSync(join(ROOT, 'site', 'client', 'index.js'), 'utf8');
  const clientOutput = readFileSync(join(SITE_DIR, 'client', 'index.js'), 'utf8');
  const htmlOutput = readFileSync(join(SITE_DIR, 'index.html'), 'utf8');
  const demoHtml = readFileSync(join(SITE_DIR, 'demo', 'index.html'), 'utf8');
  const demoApp = readFileSync(join(SITE_DIR, 'demo', 'app.js'), 'utf8');
  const scenarios = readFileSync(join(SITE_DIR, 'demo', 'scenarios.json'), 'utf8');
  const vendorManifest = readFileSync(join(SITE_DIR, 'demo', 'vendor-manifest.json'), 'utf8');

  assert.ok(clientOutput.length > clientSource.length, 'bundled client must inline the shared enhancement runtime');
  assert.ok(clientOutput.trim().split('\n').length <= 2);
  assert.doesNotMatch(clientOutput, /from\s*['"]@rnd-pro\/library-pages/);
  assert.equal(htmlOutput.trim().split('\n').length, 1);
  assert.equal(demoHtml.trim().split('\n').length, 1);
  assert.equal(demoApp.slice(0, 4096).includes('\n'), false);
  assert.match(demoApp, /\.\/vendor\//);
  assert.equal(scenarios.trim().split('\n').length, 1);
  assert.equal(vendorManifest.trim().split('\n').length, 1);
});

test('canonical documentation is required', () => {
  assert.throws(
    () => renderDocsMarkdown('docs/__missing-pages-canonical__.md', '/docs/'),
    /ENOENT/,
  );
});

test('demo import map and vendor manifest describe an exact bounded browser artifact', () => {
  const demoDocument = htmlDocument('demo/index.html');
  assert.equal(demoDocument.querySelector('base'), null);
  const imports = JSON.parse(demoDocument.querySelector('script[type="importmap"]')?.textContent || '{}').imports;
  assert.deepEqual(imports, {
    'symbiote-workspace/browser': './vendor/symbiote-workspace/browser.js',
    'symbiote-ui/ui': './vendor/symbiote-ui/ui/index.js',
    'symbiote-ui/board': './vendor/symbiote-ui/board/index.js',
    'symbiote-ui/': './vendor/symbiote-ui/',
    'symbiote-engine': './vendor/symbiote-engine/browser.js',
    'symbiote-engine/contracts': './vendor/symbiote-engine/contracts/index.js',
    'symbiote-engine/': './vendor/symbiote-engine/',
    '@symbiotejs/symbiote': './vendor/@symbiotejs/symbiote/core/index.js',
    '@symbiotejs/symbiote/utils': './vendor/@symbiotejs/symbiote/utils/index.js',
    '@symbiotejs/symbiote/': './vendor/@symbiotejs/symbiote/',
  });

  const manifest = JSON.parse(readFileSync(join(SITE_DIR, 'demo', 'vendor-manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.strategy, 'browser-esm-minified-transitive-closure');
  assert.deepEqual(manifest.optimization, {
    javascript: {
      tool: 'esbuild',
      format: 'esm',
      target: 'esnext',
      minify: true,
      keepNames: true,
      legalComments: 'none',
    },
    css: { tool: 'jsda-kit/cssMin', minify: true },
    json: { tool: 'JSON.stringify', compact: true },
  });
  assert.deepEqual(manifest.entrypoints, EXPECTED_ENTRYPOINTS);
  assert.deepEqual(manifest.allowedLazyNodeImports, EXPECTED_LAZY_NODE_IMPORTS);
  assert.deepEqual(manifest.limits, {
    maxFiles: 640,
    maxBytes: 10 * 1024 * 1024,
    maxSingleFileBytes: 1024 * 1024,
  });
  assert.ok(manifest.totals.files <= manifest.limits.maxFiles);
  assert.ok(manifest.totals.bytes <= manifest.limits.maxBytes);

  const vendorDir = join(SITE_DIR, 'demo', 'vendor');
  const diskFiles = recursiveFiles(vendorDir)
    .map((path) => relative(vendorDir, path).split(sep).join('/'))
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual(diskFiles, manifest.files.map((file) => file.path));
  assert.equal(new Set(diskFiles).size, diskFiles.length);

  let totalSourceBytes = 0;
  let totalBytes = 0;
  const lazyNodeImports = new Set();
  for (const file of manifest.files) {
    assert.equal(FORBIDDEN_VENDOR_PATHS.some((pattern) => pattern.test(file.path)), false, file.path);
    const data = readFileSync(join(vendorDir, ...file.path.split('/')));
    const packageName = manifest.packages
      .map((entry) => entry.name)
      .sort((left, right) => right.length - left.length)
      .find((name) => file.path.startsWith(`${name}/`));
    assert.ok(packageName, file.path);
    const packagePath = file.path.slice(packageName.length + 1);
    const packageRoot = packageName === 'symbiote-workspace'
      ? ROOT
      : join(ROOT, 'node_modules', ...packageName.split('/'));
    const source = readFileSync(join(packageRoot, ...packagePath.split('/')));
    assert.equal(file.sourceBytes, source.byteLength, file.path);
    assert.equal(file.sourceSha256, createHash('sha256').update(source).digest('hex'), file.path);
    assert.equal(data.byteLength, file.bytes, file.path);
    assert.ok(file.bytes <= manifest.limits.maxSingleFileBytes, file.path);
    assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256, file.path);
    if (file.path.endsWith('/LICENSE')) {
      assert.equal(file.optimization, 'copied', file.path);
      assert.deepEqual(data, source, file.path);
    }
    totalSourceBytes += file.sourceBytes;
    totalBytes += file.bytes;

    if (file.path.endsWith('.js')) {
      const source = data.toString('utf8');
      assert.doesNotMatch(source, /(?:from\s*|import\s*)['"]node:/, file.path);
      for (const match of source.matchAll(/import\(\s*['"](node:[^'"]+)['"]\s*\)/g)) {
        lazyNodeImports.add(`${file.path}::${match[1]}`);
      }
    }
  }
  assert.equal(totalSourceBytes, manifest.totals.sourceBytes);
  assert.equal(totalBytes, manifest.totals.bytes);
  assert.ok(manifest.totals.bytes < manifest.totals.sourceBytes);
  assert.equal(manifest.files.length, manifest.totals.files);
  assert.deepEqual([...lazyNodeImports].sort(), EXPECTED_LAZY_NODE_IMPORTS);

  const packageFiles = new Map(manifest.packages.map((entry) => [entry.name, { files: 0, sourceBytes: 0, bytes: 0 }]));
  for (const file of manifest.files) {
    const packageName = [...packageFiles.keys()].find((name) => file.path.startsWith(`${name}/`));
    assert.ok(packageName, file.path);
    const totals = packageFiles.get(packageName);
    totals.files += 1;
    totals.sourceBytes += file.sourceBytes;
    totals.bytes += file.bytes;
  }
  for (const entry of manifest.packages) {
    assert.deepEqual(
      { files: entry.files, sourceBytes: entry.sourceBytes, bytes: entry.bytes },
      packageFiles.get(entry.name),
    );
  }
});

test('Pages-only sources and generated output stay out of the npm package', () => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const files = JSON.parse(output)[0].files.map((file) => file.path);
  const forbidden = [
    /^site\//,
    /^_site\//,
    /^\.github\//,
    /^project\.cfg\.js$/,
    /^scripts\/build-pages\.js$/,
    /^tests\/pages(?:-browser)?\.test\.js$/,
    /^tests\/site-package-output\.test\.js$/,
  ];
  for (const file of files) {
    assert.equal(forbidden.some((pattern) => pattern.test(file)), false, file);
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
