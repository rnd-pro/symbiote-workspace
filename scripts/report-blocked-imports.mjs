#!/usr/bin/env node
// Report which of a project's `symbiote-workspace` imports stopped resolving.
//
// 2.0 removed two wildcard entry points, `./schema/*` and `./runtime/*`. A
// consumer that reached a file through one of them keeps working until the file
// is loaded, and then fails with ERR_PACKAGE_PATH_NOT_EXPORTED — in production,
// at the first screen that needed it. This walks a checkout and names every
// specifier that would fail, so the migration is a list rather than a surprise.
//
//   node scripts/report-blocked-imports.mjs <path-to-project> [more paths...]
//
// Exit code is 1 when something would fail, 0 otherwise, so it can gate a build.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const manifest = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
const ALLOWED = new Set(Object.keys(manifest.exports ?? {}));

const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const SCANNED = /\.(m?js|cjs|ts|tsx|jsx)$/;

/** Every symbiote-workspace specifier appearing in a source string. */
function specifiers(source) {
  const found = new Set();
  const pattern = /['"`](symbiote-workspace(?:\/[^'"`\s]*)?)['"`]/g;
  for (let match of source.matchAll(pattern)) found.add(match[1]);
  return found;
}

function walk(root, files = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (SCANNED.test(entry.name)) files.push(path);
  }
  return files;
}

/** `./runtime/foo.js` -> the export key that would have to exist. */
function exportKeyFor(specifier) {
  const rest = specifier.replace(/^symbiote-workspace/, '');
  return rest === '' ? '.' : `.${rest}`;
}

let failed = false;

for (const arg of process.argv.slice(2)) {
  const root = resolve(arg);
  let stats;
  try { stats = statSync(root); } catch {
    console.error(`report-blocked-imports: ${arg} does not exist`);
    failed = true;
    continue;
  }
  const files = stats.isDirectory() ? walk(root) : [root];

  const blocked = new Map();
  const used = new Map();

  for (const file of files) {
    let source;
    try { source = readFileSync(file, 'utf8'); } catch { continue; }
    for (const specifier of specifiers(source)) {
      const key = exportKeyFor(specifier);
      const entry = blocked.get(specifier) ?? [];
      entry.push(relative(stats.isDirectory() ? root : join(root, '..'), file) || file);
      blocked.set(specifier, entry);
      if (ALLOWED.has(key)) used.set(specifier, true);
    }
  }

  // A specifier ending in a slash is a browser import-map *prefix* mapping, not
  // an import. It is reported separately because the `exports` map does not
  // govern it: a prefix map hands the browser the whole package directory, which
  // is exactly the surface 2.0 closed, and it fails nowhere.
  const prefixes = [...blocked.keys()].filter((s) => s.endsWith('/')).sort();
  const broken = [...blocked.keys()].filter((s) => !used.has(s) && !s.endsWith('/')).sort();

  console.log(`\n${arg} — ${files.length} files scanned`);
  if (prefixes.length) {
    console.log(`  ${prefixes.length} browser import-map prefix mapping(s) — these do NOT go through exports:`);
    for (const specifier of prefixes) {
      console.log(`    ${specifier}  in ${blocked.get(specifier).slice(0, 3).join(', ')}`);
    }
    console.log('    They make every file in the package reachable in the browser, so a path 2.0');
    console.log('    refuses will still load there. Replace with the exact paths you import.');
  }
  if (broken.length === 0) {
    console.log('  every symbiote-workspace import resolves against 2.0 exports');
  } else {
    failed = true;
    console.log(`  ${broken.length} specifier(s) would fail with ERR_PACKAGE_PATH_NOT_EXPORTED:`);
    for (const specifier of broken) {
      console.log(`\n    ${specifier}`);
      console.log(`      expected export key: ${exportKeyFor(specifier)}`);
      for (const file of blocked.get(specifier).slice(0, 5)) console.log(`      used in: ${file}`);
      if (blocked.get(specifier).length > 5) {
        console.log(`      … and ${blocked.get(specifier).length - 5} more file(s)`);
      }
    }
  }
}

process.exit(failed ? 1 : 0);
