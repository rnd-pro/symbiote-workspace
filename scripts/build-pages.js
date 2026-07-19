#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { init, parse } from 'es-module-lexer';
import { cssMin, htmlMin } from 'jsda-kit/node';

import { writeChatBuilderDemo } from '../examples/visual-demo/chat-builder-runtime.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, '_site');
const DEMO_DIR = join(OUT_DIR, 'demo');
const VENDOR_DIR = join(DEMO_DIR, 'vendor');
const JSDA_CLI = join(ROOT, 'node_modules', 'jsda-kit', 'cli', 'index.js');

const PACKAGES = [
  { name: 'symbiote-workspace', root: ROOT },
  { name: 'symbiote-ui', root: join(ROOT, 'node_modules', 'symbiote-ui') },
  { name: 'symbiote-engine', root: join(ROOT, 'node_modules', 'symbiote-engine') },
  { name: '@symbiotejs/symbiote', root: join(ROOT, 'node_modules', '@symbiotejs', 'symbiote') },
].sort((left, right) => right.root.length - left.root.length);

const VENDOR_LIMITS = Object.freeze({
  maxFiles: 640,
  maxBytes: 10 * 1024 * 1024,
  maxSingleFileBytes: 1024 * 1024,
});

const VENDOR_ENTRYPOINTS = [
  ['symbiote-workspace', 'browser.js'],
  ['symbiote-workspace', 'ssr/WorkspaceShell.js'],
  ['symbiote-ui', 'ui/index.js'],
  ['symbiote-ui', 'tokens/scale.js'],
  ['symbiote-ui', 'board/index.js'],
  ['symbiote-ui', 'canvas/CanvasViewport.js'],
  ['symbiote-ui', 'icons/material-symbols.css'],
  ['symbiote-ui', 'icons/material-symbols-outlined-400.ttf'],
  ['symbiote-engine', 'browser.js'],
  ['symbiote-engine', 'contracts/index.js'],
  ['@symbiotejs/symbiote', 'core/index.js'],
  ['@symbiotejs/symbiote', 'utils/index.js'],
];

const LICENSE_FILES = PACKAGES.map(({ name }) => [name, 'LICENSE']);
const ALLOWED_VENDOR_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.css', '.svg', '.woff', '.woff2', '.ttf']);
const FORBIDDEN_VENDOR_PATHS = [
  /(^|\/)(?:test|tests|docs|skills|scripts|examples|types|server)(\/|$)/i,
  /(^|\/)(?:cli|GraphServer|HandlerLoader)\.js$/i,
  /(^|\/)package\.json$/i,
];
const ALLOWED_LAZY_NODE_IMPORTS = new Set([
  'symbiote-engine/Persistence.js::node:fs/promises',
]);
const OPTIMIZATION = Object.freeze({
  javascript: Object.freeze({
    tool: 'esbuild',
    format: 'esm',
    target: 'esnext',
    minify: true,
    keepNames: true,
    legalComments: 'none',
  }),
  css: Object.freeze({ tool: 'jsda-kit/cssMin', minify: true }),
  json: Object.freeze({ tool: 'JSON.stringify', compact: true }),
});

function packageByName(name) {
  const descriptor = PACKAGES.find((candidate) => candidate.name === name);
  if (!descriptor) throw new Error(`Unknown vendor package: ${name}`);
  return descriptor;
}

function sourcePath(packageName, packagePath) {
  return join(packageByName(packageName).root, ...packagePath.split('/'));
}

function classifySource(file) {
  const absolute = resolve(file);
  const descriptor = PACKAGES.find(({ root }) => absolute === root || absolute.startsWith(`${root}${sep}`));
  if (!descriptor) throw new Error(`Vendor dependency escaped the approved package roots: ${absolute}`);
  const packagePath = relative(descriptor.root, absolute).split(sep).join('/');
  return { ...descriptor, packagePath };
}

function assertVendorPath(packageName, packagePath) {
  if (!packagePath || packagePath.startsWith('../') || packagePath.includes('/../')) {
    throw new Error(`Invalid vendor path for ${packageName}: ${packagePath}`);
  }
  if (FORBIDDEN_VENDOR_PATHS.some((pattern) => pattern.test(packagePath))) {
    throw new Error(`Forbidden browser artifact reached from ${packageName}: ${packagePath}`);
  }
  if (packagePath !== 'LICENSE' && !ALLOWED_VENDOR_EXTENSIONS.has(extname(packagePath))) {
    throw new Error(`Unsupported browser artifact reached from ${packageName}: ${packagePath}`);
  }
}

async function existingFile(candidate) {
  try {
    const metadata = await stat(candidate);
    return metadata.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

async function resolveFile(candidate) {
  const variants = extname(candidate)
    ? [candidate]
    : [candidate, `${candidate}.js`, `${candidate}.json`, join(candidate, 'index.js')];
  for (const variant of variants) {
    const found = await existingFile(variant);
    if (found) return found;
  }
  throw new Error(`Unable to resolve browser dependency: ${candidate}`);
}

async function resolveBareSpecifier(specifier) {
  if (specifier === 'symbiote-workspace/browser') return sourcePath('symbiote-workspace', 'browser.js');
  if (specifier.startsWith('symbiote-workspace/')) {
    return resolveFile(sourcePath('symbiote-workspace', specifier.slice('symbiote-workspace/'.length)));
  }
  if (specifier === 'symbiote-ui') return sourcePath('symbiote-ui', 'index.js');
  if (specifier.startsWith('symbiote-ui/')) {
    return resolveFile(sourcePath('symbiote-ui', specifier.slice('symbiote-ui/'.length)));
  }
  if (specifier === 'symbiote-engine') return sourcePath('symbiote-engine', 'browser.js');
  if (specifier.startsWith('symbiote-engine/')) {
    return resolveFile(sourcePath('symbiote-engine', specifier.slice('symbiote-engine/'.length)));
  }
  if (specifier === '@symbiotejs/symbiote') return sourcePath('@symbiotejs/symbiote', 'core/index.js');
  if (specifier === '@symbiotejs/symbiote/utils') return sourcePath('@symbiotejs/symbiote', 'utils/index.js');
  if (specifier.startsWith('@symbiotejs/symbiote/')) {
    return resolveFile(sourcePath('@symbiotejs/symbiote', specifier.slice('@symbiotejs/symbiote/'.length)));
  }
  if (specifier.startsWith('node:')) {
    throw new Error(`Node builtin reached the browser artifact: ${specifier}`);
  }
  if (/^(?:https?:|data:)/.test(specifier)) {
    throw new Error(`Remote module imports are not allowed in the browser artifact: ${specifier}`);
  }
  throw new Error(`Unmapped browser dependency: ${specifier}`);
}

async function resolveImport(specifier, importer) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    if (importer === join(DEMO_DIR, 'app.js') && specifier.startsWith('./vendor/')) {
      const vendorPath = specifier.slice('./vendor/'.length);
      const descriptor = PACKAGES.find(({ name }) => vendorPath === name || vendorPath.startsWith(`${name}/`));
      if (!descriptor) throw new Error(`Generated demo references an unknown vendor path: ${specifier}`);
      return resolveFile(sourcePath(descriptor.name, vendorPath.slice(descriptor.name.length + 1)));
    }
    return resolveFile(resolve(dirname(importer), specifier));
  }
  if (specifier.startsWith('/')) {
    throw new Error(`Unrewritten absolute module path in generated demo: ${specifier}`);
  }
  return resolveBareSpecifier(specifier);
}

async function moduleImports(file) {
  if (!['.js', '.mjs'].includes(extname(file))) return [];
  const source = await readFile(file, 'utf8');
  const [imports] = parse(source);
  return imports.flatMap((record) => typeof record.n === 'string'
    ? [{ specifier: record.n, dynamic: record.d >= 0 }]
    : []);
}

function optimizationForPath(file) {
  const extension = extname(file);
  if (extension === '.js' || extension === '.mjs') return 'javascript';
  if (extension === '.css') return 'css';
  if (extension === '.json') return 'json';
  return 'copied';
}

async function optimizeBrowserAsset(file, source) {
  const optimization = optimizationForPath(file);
  if (optimization === 'javascript') {
    const result = await transform(source.toString('utf8'), {
      format: 'esm',
      target: 'esnext',
      minify: true,
      keepNames: true,
      legalComments: 'none',
    });
    return { data: Buffer.from(result.code), optimization };
  }
  if (optimization === 'css') {
    return { data: Buffer.from(cssMin(source.toString('utf8'))), optimization };
  }
  if (optimization === 'json') {
    return {
      data: Buffer.from(JSON.stringify(JSON.parse(source.toString('utf8')))),
      optimization,
    };
  }
  return { data: source, optimization };
}

async function copyVendorClosure() {
  await init;
  const queue = VENDOR_ENTRYPOINTS.map(([name, packagePath]) => sourcePath(name, packagePath));
  queue.push(...LICENSE_FILES.map(([name, packagePath]) => sourcePath(name, packagePath)));

  for (const { specifier } of await moduleImports(join(DEMO_DIR, 'app.js'))) {
    queue.push(await resolveImport(specifier, join(DEMO_DIR, 'app.js')));
  }

  const seen = new Set();
  const copied = [];
  const lazyNodeImports = new Set();
  while (queue.length > 0) {
    const file = resolve(queue.shift());
    if (seen.has(file)) continue;
    seen.add(file);

    const descriptor = classifySource(file);
    assertVendorPath(descriptor.name, descriptor.packagePath);
    const source = await readFile(file);
    const optimized = await optimizeBrowserAsset(file, source);
    if (optimized.data.byteLength > VENDOR_LIMITS.maxSingleFileBytes) {
      throw new Error(`Vendor file exceeds the single-file budget: ${descriptor.name}/${descriptor.packagePath}`);
    }

    const outputPath = join(VENDOR_DIR, descriptor.name, ...descriptor.packagePath.split('/'));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, optimized.data);
    copied.push({
      path: `${descriptor.name}/${descriptor.packagePath}`,
      optimization: optimized.optimization,
      sourceBytes: source.byteLength,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      bytes: optimized.data.byteLength,
      sha256: createHash('sha256').update(optimized.data).digest('hex'),
    });

    for (const { specifier, dynamic } of await moduleImports(file)) {
      if (dynamic && specifier.startsWith('node:')) {
        const key = `${descriptor.name}/${descriptor.packagePath}::${specifier}`;
        if (!ALLOWED_LAZY_NODE_IMPORTS.has(key)) {
          throw new Error(`Unapproved lazy Node import reached the browser artifact: ${key}`);
        }
        lazyNodeImports.add(key);
        continue;
      }
      queue.push(await resolveImport(specifier, file));
    }
  }

  copied.sort((left, right) => left.path.localeCompare(right.path));
  const totalSourceBytes = copied.reduce((sum, file) => sum + file.sourceBytes, 0);
  const totalBytes = copied.reduce((sum, file) => sum + file.bytes, 0);
  if (copied.length > VENDOR_LIMITS.maxFiles) {
    throw new Error(`Vendor artifact has ${copied.length} files; budget is ${VENDOR_LIMITS.maxFiles}.`);
  }
  if (totalBytes > VENDOR_LIMITS.maxBytes) {
    throw new Error(`Vendor artifact has ${totalBytes} bytes; budget is ${VENDOR_LIMITS.maxBytes}.`);
  }

  const packageVersions = new Map();
  for (const descriptor of PACKAGES) {
    const packageJson = JSON.parse(await readFile(join(descriptor.root, 'package.json'), 'utf8'));
    packageVersions.set(descriptor.name, packageJson.version);
  }
  const packages = PACKAGES
    .map(({ name }) => {
      const files = copied.filter((file) => file.path.startsWith(`${name}/`));
      return {
        name,
        version: packageVersions.get(name),
        files: files.length,
        sourceBytes: files.reduce((sum, file) => sum + file.sourceBytes, 0),
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const manifest = {
    schemaVersion: 2,
    strategy: 'browser-esm-minified-transitive-closure',
    optimization: OPTIMIZATION,
    entrypoints: VENDOR_ENTRYPOINTS.map(([name, packagePath]) => `${name}/${packagePath}`),
    allowedLazyNodeImports: [...lazyNodeImports].sort(),
    limits: VENDOR_LIMITS,
    totals: { files: copied.length, sourceBytes: totalSourceBytes, bytes: totalBytes },
    packages,
    files: copied,
  };
  await writeFile(join(DEMO_DIR, 'vendor-manifest.json'), JSON.stringify(manifest));
  return manifest;
}

async function rewriteDemoImports() {
  for (const filename of ['index.html', 'app.js']) {
    const path = join(DEMO_DIR, filename);
    let content = await readFile(path, 'utf8');
    content = content
      .replaceAll('/__workspace__/', './vendor/symbiote-workspace/')
      .replaceAll('/__symbiote_ui__/', './vendor/symbiote-ui/')
      .replaceAll('/__symbiote_engine__/', './vendor/symbiote-engine/')
      .replaceAll('/__symbiote__/', './vendor/@symbiotejs/symbiote/')
      .replaceAll('./vendor/symbiote-engine/index.js', './vendor/symbiote-engine/browser.js');
    if (filename === 'index.html') {
      content = content.replace(
        /<link rel="stylesheet"\s+href="https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined:[^"]+"\s*\/>/,
        '<link rel="stylesheet" href="./vendor/symbiote-ui/icons/material-symbols.css">',
      );
      content = content.replace(
        /(<script type="importmap">)([\s\S]*?)(<\/script>)/,
        (_, open, importMap, close) => `${open}${JSON.stringify(JSON.parse(importMap))}${close}`,
      );
      if (content.includes('fonts.googleapis.com')) {
        throw new Error('The generated demo still depends on the remote Material Symbols stylesheet.');
      }
    }
    if (/\/(?:__workspace__|__symbiote_ui__|__symbiote_engine__|__symbiote__)\//.test(content)) {
      throw new Error(`Virtual demo imports remain in ${filename}.`);
    }
    await writeFile(path, content);
  }
}

async function optimizeGeneratedDemo() {
  const appPath = join(DEMO_DIR, 'app.js');
  const app = await optimizeBrowserAsset(appPath, await readFile(appPath));
  await writeFile(appPath, app.data);

  const htmlPath = join(DEMO_DIR, 'index.html');
  const html = await readFile(htmlPath, 'utf8');
  await writeFile(htmlPath, htmlMin(html));

  const scenariosPath = join(DEMO_DIR, 'scenarios.json');
  const scenarios = JSON.parse(await readFile(scenariosPath, 'utf8'));
  await writeFile(scenariosPath, JSON.stringify(scenarios));
}

async function requireOutput(relativePath) {
  if (!await existingFile(join(OUT_DIR, ...relativePath.split('/')))) {
    throw new Error(`Required Pages output is missing: ${relativePath}`);
  }
}

async function main() {
  process.env.BASE_PATH ||= '/';
  process.env.BASE_URL ||= 'https://rnd-pro.github.io/';

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  execFileSync(process.execPath, [JSDA_CLI, 'build'], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });

  await writeFile(join(OUT_DIR, '.nojekyll'), '');

  await mkdir(DEMO_DIR, { recursive: true });
  const demo = await writeChatBuilderDemo({ outputDir: DEMO_DIR });
  if (demo.scenarioCount < 1) throw new Error('The generated visual demo has no scenarios.');
  await rewriteDemoImports();
  const vendor = await copyVendorClosure();
  await optimizeGeneratedDemo();

  for (const path of [
    'index.html',
    '404.html',
    'robots.txt',
    'sitemap.xml',
    'docs/index.html',
    'docs/getting-started/index.html',
    'docs/reference/index.html',
    'demo/index.html',
    'demo/app.js',
    'demo/scenarios.json',
    'demo/vendor-manifest.json',
  ]) {
    await requireOutput(path);
  }

  console.log(`Pages build complete: ${demo.scenarioCount} demo scenarios, ${vendor.totals.files} vendor files, ${vendor.totals.bytes} vendor bytes.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
