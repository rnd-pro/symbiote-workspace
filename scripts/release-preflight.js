#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let ROOT_URL = new URL('..', import.meta.url);
let ROOT = fileURLToPath(ROOT_URL);
let args = process.argv.slice(2);
let skip = new Set();

function hasFlag(name) {
  return args.includes(name);
}

function readOption(name, fallback = null) {
  let index = args.indexOf(name);
  if (index >= 0) return args[index + 1] || fallback;
  let prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);
  return fallback;
}

function printUsage() {
  console.log([
    'Usage: npm run release:preflight -- [options]',
    '',
    'Options:',
    '  --target-version <version>   Required package version for this run. Defaults to 1.0.0.',
    '  --skip-npm-ci                Skip npm ci --ignore-scripts.',
    '  --skip-tests                 Skip npm test.',
    '  --skip-package-consumer      Skip npm run test:package-consumer.',
    '  --skip-pack                  Skip npm pack --dry-run --json.',
    '  --skip-browser               Skip realtime-builder browser smoke.',
    '  --skip-git-clean            Skip git status cleanliness check.',
    '  --help                       Show this help.',
  ].join('\n'));
}

if (hasFlag('--help') || hasFlag('-h')) {
  printUsage();
  process.exit(0);
}

for (let name of [
  'npm-ci',
  'tests',
  'package-consumer',
  'pack',
  'browser',
  'git-clean',
]) {
  if (hasFlag(`--skip-${name}`)) skip.add(name);
}

let targetVersion = readOption('--target-version', '1.0.0');
let failures = [];

function fail(message) {
  failures.push(message);
  console.error(`preflight: ${message}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, ROOT_URL), 'utf8'));
}

async function run(label, command, commandArgs, options = {}) {
  console.log(`\n> ${label}`);
  console.log([command, ...commandArgs].join(' '));
  return new Promise((resolve, reject) => {
    let child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, ...options.env },
    });
    let stdout = '';
    let stderr = '';
    if (options.capture) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${label} failed with exit code ${code}${stderr ? `\n${stderr}` : ''}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function isStableVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

async function verifyReleaseMetadata() {
  let packageMeta = await readJson('package.json');
  let changelog = await readFile(new URL('CHANGELOG.md', ROOT_URL), 'utf8');
  if (packageMeta.version !== targetVersion) {
    fail(`package.json version is ${packageMeta.version}; expected ${targetVersion}`);
  }
  if (isStableVersion(targetVersion)) {
    let escaped = targetVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let releaseHeading = new RegExp(`^##\\s+\\[?${escaped}\\]?\\s+-\\s+\\d{4}-\\d{2}-\\d{2}`, 'm');
    if (!releaseHeading.test(changelog)) {
      fail(`CHANGELOG.md is missing a dated ${targetVersion} release heading`);
    }
  } else if (!/^##\s+Unreleased/m.test(changelog)) {
    fail('CHANGELOG.md is missing an Unreleased heading for prerelease validation');
  }
}

async function verifyNoProjectMjs() {
  let tracked = await run('tracked .mjs scan', 'git', ['ls-files', '*.mjs'], { capture: true });
  let untracked = await run('untracked .mjs scan', 'git', [
    'ls-files',
    '--others',
    '--exclude-standard',
    '*.mjs',
  ], { capture: true });
  let files = [tracked.stdout, untracked.stdout].join('\n').trim();
  if (files) fail(`project-owned .mjs files found:\n${files}`);
}

async function verifyToolRegistry() {
  let { stdout } = await run('workflow_kanban registry check', 'node', [
    '--input-type=module',
    '-e',
    [
      "import { TOOLS } from './runtime/dispatch.js';",
      "let hasWorkflowKanban = TOOLS.some((tool) => tool.name === 'workflow_kanban');",
      'console.log(JSON.stringify({ count: TOOLS.length, hasWorkflowKanban }));',
      'if (TOOLS.length !== 69 || !hasWorkflowKanban) process.exit(1);',
    ].join(' '),
  ], { capture: true });
  console.log(stdout.trim());
}

function verifyPackList(pack) {
  for (let file of pack.files || []) {
    let path = file.path || '';
    if (
      path.startsWith('tmp/') ||
      path.startsWith('.agent-portal/') ||
      path.startsWith('tests/') ||
      path.includes('node_modules/') ||
      path.includes('npm-cache') ||
      path.endsWith('.tgz') ||
      path.endsWith('.mjs')
    ) {
      fail(`npm pack contains forbidden entry ${path}`);
    }
  }
  for (let required of [
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'scripts/release-preflight.js',
    'handlers/workflow-kanban.js',
    'examples/visual-demo/browser-smoke.js',
  ]) {
    if (!pack.files?.some((file) => file.path === required)) {
      fail(`npm pack is missing ${required}`);
    }
  }
}

async function verifyPack() {
  let { stdout } = await run('npm pack dry-run', 'npm', ['pack', '--dry-run', '--json'], { capture: true });
  let [pack] = JSON.parse(stdout);
  verifyPackList(pack);
  console.log(JSON.stringify({
    name: pack.name,
    version: pack.version,
    files: pack.files.length,
    filename: pack.filename,
  }));
}

async function verifyGitClean() {
  let { stdout } = await run('git status clean check', 'git', ['status', '--short'], { capture: true });
  if (stdout.trim()) fail(`git status is not clean:\n${stdout.trim()}`);
}

async function main() {
  await verifyReleaseMetadata();
  await verifyNoProjectMjs();
  await verifyToolRegistry();

  if (!skip.has('npm-ci')) {
    await run('npm ci', 'npm', ['ci', '--ignore-scripts']);
  }
  if (!skip.has('tests')) {
    await run('unit test suite', 'npm', ['test']);
  }
  if (!skip.has('package-consumer')) {
    await run('package consumer test', 'npm', ['run', 'test:package-consumer']);
  }
  if (!skip.has('pack')) {
    await verifyPack();
  }
  if (!skip.has('browser')) {
    await run('realtime-builder browser proof', 'npm', [
      'run',
      'test:visual-demo-browser',
      '--',
      '--demo',
      'realtime-builder',
      '--timeout',
      '70000',
    ], {
      env: {
        SYMBIOTE_BROWSER_DRIVER: process.env.SYMBIOTE_BROWSER_DRIVER || 'playwright',
        SYMBIOTE_PLAYWRIGHT_BROWSER: process.env.SYMBIOTE_PLAYWRIGHT_BROWSER || 'webkit',
      },
    });
  }
  if (!skip.has('git-clean')) {
    await verifyGitClean();
  }

  if (failures.length) {
    console.error(`\nRelease preflight failed with ${failures.length} issue(s).`);
    process.exit(1);
  }
  console.log('\nRelease preflight passed.');
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
