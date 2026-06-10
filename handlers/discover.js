/**
 * Dynamic component discovery for symbiote-ui.
 *
 * Scans the library directory to find all registered custom elements,
 * extracting tag names, file paths, categories, and available state keys.
 * No hardcoded component lists — pure introspection.
 *
 * @module symbiote-workspace/handlers/discover
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, dirname, basename, extname } from 'node:path';

/**
 * @typedef {Object} ComponentDescriptor
 * @property {string} tagName - Custom element tag name
 * @property {string} filePath - Absolute path to the component .js file
 * @property {string} relativePath - Path relative to the UI root
 * @property {string} category - Component category (from directory name)
 * @property {string[]} stateKeys - Available init$ state keys
 * @property {boolean} hasTemplate - Whether .tpl.js exists
 * @property {boolean} hasStyles - Whether .css.js exists
 */

/** File extensions to skip during scanning */
const SKIP_EXTENSIONS = new Set(['.css.js', '.tpl.js']);

/** Directories to skip */
const SKIP_DIRS = new Set(['node_modules', '.git', '.agent-portal', 'demo', 'test', 'tests', 'tmp']);

/**
 * Check if a filename is a presentation file (template or styles).
 * @param {string} filename
 * @returns {boolean}
 */
function isPresentationFile(filename) {
  return filename.endsWith('.css.js') || filename.endsWith('.tpl.js');
}

/**
 * Extract .reg() tag name from file content.
 * Matches patterns like: ClassName.reg('tag-name') or .reg("tag-name")
 * @param {string} content
 * @returns {string|null}
 */
function extractRegCall(content) {
  let match = content.match(/\.reg\(\s*['"`]([a-z][a-z0-9-]*)['"`]\s*\)/);
  return match ? match[1] : null;
}

/**
 * Extract init$ state keys from file content.
 * Matches patterns like: init$ = { 'key': value, ... }
 * @param {string} content
 * @returns {string[]}
 */
function extractStateKeys(content) {
  let keys = [];
  // Match init$ block
  let initMatch = content.match(/init\$\s*=\s*\{([\s\S]*?)\n\s*\};?/);
  if (!initMatch) return keys;

  let block = initMatch[1];
  // Extract quoted keys: 'key' or "key" or `key`
  let quotedKeys = block.matchAll(/['"`](@?[a-zA-Z_$][\w$.-]*)['"`]\s*:/g);
  for (let m of quotedKeys) {
    keys.push(m[1]);
  }
  // Extract unquoted keys (identifier: value)
  let unquotedKeys = block.matchAll(/^\s*([a-zA-Z_$][\w$]*)\s*:/gm);
  for (let m of unquotedKeys) {
    if (!keys.includes(m[1])) {
      keys.push(m[1]);
    }
  }
  return keys;
}

/**
 * Recursively walk a directory and collect file paths.
 * @param {string} dir
 * @param {string[]} [files=[]]
 * @returns {Promise<string[]>}
 */
async function walkDir(dir, files = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (let entry of entries) {
    let fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await walkDir(fullPath, files);
      }
    } else if (entry.isFile() && entry.name.endsWith('.js') && !isPresentationFile(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Check if companion files exist for a component.
 * @param {string} filePath - Path to the main .js file
 * @returns {Promise<{hasTemplate: boolean, hasStyles: boolean}>}
 */
async function checkCompanionFiles(filePath) {
  let dir = dirname(filePath);
  let base = basename(filePath, '.js');
  let hasTemplate = false;
  let hasStyles = false;

  try {
    await stat(join(dir, `${base}.tpl.js`));
    hasTemplate = true;
  } catch { /* no template */ }

  try {
    await stat(join(dir, `${base}.css.js`));
    hasStyles = true;
  } catch { /* no styles */ }

  return { hasTemplate, hasStyles };
}

/**
 * Derive a category from the file's directory path relative to root.
 * @param {string} filePath
 * @param {string} rootPath
 * @returns {string}
 */
function deriveCategory(filePath, rootPath) {
  let rel = relative(rootPath, filePath);
  let parts = rel.split('/');
  if (parts.length >= 2) {
    return parts[0]; // Top-level directory = category
  }
  return 'root';
}

/**
 * Discover all registered custom elements in a symbiote-ui directory.
 *
 * @param {string} uiPath - Absolute path to symbiote-ui root
 * @returns {Promise<{components: ComponentDescriptor[], categories: Object<string, string[]>, totalScanned: number}>}
 */
export async function discoverComponents(uiPath) {
  let jsFiles = await walkDir(uiPath);
  let components = [];
  let categories = {};

  for (let filePath of jsFiles) {
    let content;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    let tagName = extractRegCall(content);
    if (!tagName) continue;

    let stateKeys = extractStateKeys(content);
    let { hasTemplate, hasStyles } = await checkCompanionFiles(filePath);
    let category = deriveCategory(filePath, uiPath);
    let relativePath = relative(uiPath, filePath);

    let descriptor = {
      tagName,
      filePath,
      relativePath,
      category,
      stateKeys,
      hasTemplate,
      hasStyles,
    };

    components.push(descriptor);

    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(tagName);
  }

  // Sort by category then tag name
  components.sort((a, b) => a.category.localeCompare(b.category) || a.tagName.localeCompare(b.tagName));

  return {
    components,
    categories,
    totalScanned: jsFiles.length,
  };
}

/**
 * Cached discovery results.
 * Key: uiPath, Value: { result, timestamp }
 * @type {Map<string, { result: Object, timestamp: number }>}
 */
const _discoverCache = new Map();
const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Discover components with caching.
 * Avoids full filesystem rescan when called multiple times within TTL.
 * @param {string} uiPath
 * @returns {Promise<Object>}
 */
async function cachedDiscover(uiPath) {
  let cached = _discoverCache.get(uiPath);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached.result;
  }
  let result = await discoverComponents(uiPath);
  _discoverCache.set(uiPath, { result, timestamp: Date.now() });
  return result;
}

/**
 * Find a specific component by tag name.
 * @param {string} uiPath - Absolute path to symbiote-ui root
 * @param {string} tagName - Custom element tag name
 * @returns {Promise<ComponentDescriptor|null>}
 */
export async function findComponent(uiPath, tagName) {
  let { components } = await cachedDiscover(uiPath);
  return components.find((c) => c.tagName === tagName) || null;
}

/**
 * List all available component tag names.
 * @param {string} uiPath - Absolute path to symbiote-ui root
 * @returns {Promise<string[]>}
 */
export async function listComponentTags(uiPath) {
  let { components } = await cachedDiscover(uiPath);
  return components.map((c) => c.tagName);
}

/**
 * List categories with component counts.
 * @param {string} uiPath
 * @returns {Promise<Object<string, number>>}
 */
export async function listCategories(uiPath) {
  let { categories } = await cachedDiscover(uiPath);
  let result = {};
  for (let [cat, tags] of Object.entries(categories)) {
    result[cat] = tags.length;
  }
  return result;
}
