/**
 * Tool-result envelope convention.
 *
 * A tool can return a compact, self-describing envelope: a short summary, an
 * optional warnings list, and the actual data. This keeps an agent trace
 * readable and lets the agent self-correct from the summary/warnings without
 * parsing the full data payload.
 *
 * The envelope is back-compatible by design: parsing a raw value that was never
 * wrapped yields `{ summary: '', warnings: [], data: <raw> }`.
 *
 * @module symbiote-workspace/runtime/tool-result
 */

const ENVELOPE_KIND = 'tool-result/v1';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeWarnings(warnings) {
  if (warnings == null) return [];
  let list = Array.isArray(warnings) ? warnings : [warnings];
  let result = [];
  for (let entry of list) {
    if (entry == null) continue;
    result.push(typeof entry === 'string' ? entry : String(entry));
  }
  return result;
}

/**
 * Build a stable tool-result envelope.
 *
 * @param {Object} input
 * @param {string} [input.summary] - Compact human/agent-readable summary line.
 * @param {string[]|string} [input.warnings] - Optional non-blocking diagnostics.
 * @param {*} input.data - The tool's actual result payload.
 * @returns {{ _kind: string, summary: string, warnings: string[], data: * }}
 */
export function buildToolResultEnvelope({ summary, warnings, data } = {}) {
  return {
    _kind: ENVELOPE_KIND,
    summary: typeof summary === 'string' ? summary : summary == null ? '' : String(summary),
    warnings: normalizeWarnings(warnings),
    data,
  };
}

/**
 * Whether a value is a tool-result envelope produced by buildToolResultEnvelope.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isToolResultEnvelope(value) {
  if (isObject(value)) return value._kind === ENVELOPE_KIND;
  if (typeof value === 'string') {
    try {
      let parsed = JSON.parse(value);
      return isObject(parsed) && parsed._kind === ENVELOPE_KIND;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Parse a tool result into a normalized envelope shape, tolerant of raw values.
 *
 * - An envelope object/string round-trips its summary, warnings, and data.
 * - Any other value parses to `{ summary: '', warnings: [], data: <raw> }`.
 *
 * @param {*} value
 * @returns {{ summary: string, warnings: string[], data: * }}
 */
export function parseToolResultEnvelope(value) {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      let parsed = JSON.parse(value);
      if (isObject(parsed) && parsed._kind === ENVELOPE_KIND) candidate = parsed;
    } catch {
      // Not JSON — treat as raw data below.
    }
  }
  if (isObject(candidate) && candidate._kind === ENVELOPE_KIND) {
    return {
      summary: typeof candidate.summary === 'string' ? candidate.summary : '',
      warnings: normalizeWarnings(candidate.warnings),
      data: candidate.data,
    };
  }
  return { summary: '', warnings: [], data: value };
}
