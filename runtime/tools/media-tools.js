/**
 * Media dispatch-tool family over the portable virtual media sequence contract.
 * @module symbiote-workspace/runtime/tools/media-tools
 */

import { createVirtualSequence, invalidateVirtualSequence, projectVirtualSequenceAt } from '../media-sequence.js';
import { validateMediaEvidenceManifest } from '../media-evidence.js';
import { defineToolFamily } from './registry.js';

export const tools = Object.freeze([
  {
    name: 'media_sequence_validate',
    description: 'Validate a portable virtual media sequence contract and return its derived identity.',
    inputSchema: {
      type: 'object',
      properties: {
        sequence: { type: 'object' },
      },
      required: ['sequence'],
    },
    mutates: false,
  },
  {
    name: 'media_sequence_project',
    description: 'Project a virtual media sequence at a media tick: master/proxy segment, nearest prior keyframe, scrub, sprite cue, audio span, and active layers.',
    inputSchema: {
      type: 'object',
      properties: {
        sequence: { type: 'object' },
        tick: { type: 'integer' },
      },
      required: ['sequence', 'tick'],
    },
    mutates: false,
  },
  {
    name: 'media_sequence_invalidate',
    description: 'Compute range-aware invalidation for a virtual media sequence from changed layer ids, returning merged affected ranges and required recomputations.',
    inputSchema: {
      type: 'object',
      properties: {
        sequence: { type: 'object' },
        changedLayers: { type: 'array', items: { type: 'string' } },
        recomputedOutputHashes: { type: 'object' },
      },
      required: ['sequence', 'changedLayers'],
    },
    mutates: false,
  },
  {
    name: 'media_evidence_validate',
    description: 'Validate a portable media evidence manifest against the current canonical schema.',
    inputSchema: {
      type: 'object',
      properties: {
        manifest: { type: 'object' },
      },
      required: ['manifest'],
    },
    mutates: false,
  },
]);

function mediaSequenceValidate(args = {}) {
  try {
    let sequence = createVirtualSequence(args.sequence);
    return { status: 'ok', valid: true, errors: [], id: sequence.id };
  } catch (error) {
    return { status: 'ok', valid: false, errors: [error?.message || String(error)] };
  }
}

function mediaSequenceProject(args = {}) {
  try {
    return { status: 'ok', projection: projectVirtualSequenceAt(args.sequence, args.tick) };
  } catch (error) {
    return { status: 'error', code: 'media-contract', hint: error?.message || String(error) };
  }
}

function mediaSequenceInvalidate(args = {}) {
  try {
    let result = invalidateVirtualSequence(args.sequence, args.changedLayers, {
      recomputedOutputHashes: args.recomputedOutputHashes,
    });
    return { status: 'ok', ...result };
  } catch (error) {
    return { status: 'error', code: 'media-contract', hint: error?.message || String(error) };
  }
}

function mediaEvidenceValidate(args = {}) {
  let result = validateMediaEvidenceManifest(args.manifest);
  return { status: 'ok', valid: result.ok, errors: result.errors };
}

export const handlers = Object.freeze({
  media_sequence_validate: mediaSequenceValidate,
  media_sequence_project: mediaSequenceProject,
  media_sequence_invalidate: mediaSequenceInvalidate,
  media_evidence_validate: mediaEvidenceValidate,
});

export const mediaToolFamily = defineToolFamily('media', tools, handlers);

export default mediaToolFamily;
