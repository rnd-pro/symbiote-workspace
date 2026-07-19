import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';

import { parseHTML } from 'linkedom';
import { createArtifactChecks } from 'library-pages/testing';
import { createUrlHelpers, readPagesEnv } from 'library-pages/url';

const ROOT = resolve(import.meta.dirname, '..');
const SITE_DIR = join(ROOT, '_site');
process.env.BASE_PATH ||= '/';
process.env.BASE_URL ||= 'https://rnd-pro.github.io/';
const { basePath, baseUrl } = readPagesEnv(process.env);
const { resolveUrl } = createUrlHelpers({ basePath, baseUrl });

const SHELL_PAGES = [
  'index.html',
  '404.html',
  'docs/index.html',
  'docs/getting-started/index.html',
  'docs/reference/index.html',
];

function collectFiles(directory, files = new Set()) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) collectFiles(path, files);
    else files.add(relative(SITE_DIR, path).split(sep).join('/'));
  }
  return files;
}

test('shell pages satisfy the shared library-pages artifact contract', () => {
  const checks = createArtifactChecks({ parseHTML });
  const existingFiles = collectFiles(SITE_DIR);

  for (const relativePath of SHELL_PAGES) {
    const htmlFile = join(SITE_DIR, relativePath);
    const { document } = parseHTML(readFileSync(htmlFile, 'utf8'));
    const urlPath = relativePath.endsWith('index.html')
      ? relativePath.slice(0, -'index.html'.length)
      : relativePath;

    checks.checkNoBase(document);
    checks.checkCanonical(document, { expectedUrl: resolveUrl(urlPath) });
    checks.checkBasePathSafety(document, { basePath });
    checks.checkSearchHooks(document);
    checks.checkFiniteReducedMotion(document, { htmlFile, outputDir: SITE_DIR, basePath });
    checks.checkForbiddenSelectors(document, { htmlFile, outputDir: SITE_DIR, basePath });
    checks.checkLinkIntegrity(document, { htmlFile, outputDir: SITE_DIR, existingFiles, basePath });
  }
});
