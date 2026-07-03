/**
 * Deterministic catalog fingerprinting.
 *
 * @module symbiote-workspace/catalog/fingerprint
 */

import { createHash } from 'node:crypto';

import { canonicalize } from '../schema/canonical-json.js';
import { CATALOG_FINGERPRINT_PATTERN } from '../schema/constants.js';
import { stripCatalogTagNames } from './entry.js';

function fingerprintEntry(entry) {
  let normalized = stripCatalogTagNames(entry);
  return Object.fromEntries(
    Object.entries(normalized)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function normalizeCatalogFingerprintState(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('catalogFingerprint requires an array of catalog entries.');
  }
  return entries
    .map(fingerprintEntry)
    .sort((a, b) => {
      if (a.id !== b.id) return a.id.localeCompare(b.id);
      if (a.origin !== b.origin) return a.origin.localeCompare(b.origin);
      return String(a.kind || '').localeCompare(String(b.kind || ''));
    });
}

export function computeCatalogFingerprint(entries) {
  let state = normalizeCatalogFingerprintState(entries);
  let digest = createHash('sha256').update(canonicalize(state)).digest('hex');
  return `sha256-${digest}`;
}

export function catalogFingerprint(entries, options = {}) {
  let fingerprint = computeCatalogFingerprint(entries);
  let result = { fingerprint, unchanged: false };

  if (options.knownFingerprint !== undefined) {
    if (!CATALOG_FINGERPRINT_PATTERN.test(String(options.knownFingerprint))) {
      return result;
    }
    if (options.knownFingerprint === fingerprint) {
      return { fingerprint, unchanged: true };
    }
  }

  return result;
}
