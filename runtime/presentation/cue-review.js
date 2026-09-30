import { normalizePresentationTimeline } from './contract.js';

function list(value) {
  return Array.isArray(value) ? value : [];
}

export function primaryPresentationCue(turn = {}) {
  return list(turn.cues).find((cue) => cue.targetId) || null;
}

export function reviewPresentationCues(input = {}, intent = {}) {
  let timeline = normalizePresentationTimeline(input);
  let allowedTargetIds = new Set(list(intent.allowedTargetIds));
  let allowedToolNames = new Set(list(intent.allowedToolNames));
  let allowedActionSources = new Set(list(intent.allowedActionSources || ['webmcp', 'workspace', 'host']));
  let issues = [];
  let targetIds = new Set();
  let tabIds = new Set();
  let interactionCount = 0;
  let annotationCount = 0;
  let stateCount = 0;

  for (let [turnIndex, turn] of timeline.turns.entries()) {
    for (let [cueIndex, cue] of list(turn.cues).entries()) {
      let detail = { turnIndex, turnId: turn.id, cueIndex, cueId: `${turnIndex}.${cueIndex}` };
      if (cue.targetId) targetIds.add(cue.targetId);
      if (cue.tabId) tabIds.add(cue.tabId);
      if (allowedTargetIds.size && cue.targetId && !allowedTargetIds.has(cue.targetId)) {
        issues.push({ code: 'disallowed-target', severity: 'error', message: `Cue targets disallowed target "${cue.targetId}".`, ...detail });
      }
      if (cue.kind === 'interaction') {
        interactionCount += 1;
        let binding = cue.interaction.binding;
        if (binding && !allowedActionSources.has(binding.source)) {
          issues.push({ code: 'unsupported-action-source', severity: 'error', message: `Cue uses unsupported action source "${binding.source}".`, source: binding.source, ...detail });
        }
        if (binding?.source === 'webmcp' && allowedToolNames.size && !allowedToolNames.has(binding.tool)) {
          issues.push({ code: 'disallowed-tool', severity: 'error', message: `Cue uses disallowed WebMCP tool "${binding.tool}".`, name: binding.tool, ...detail });
        }
      }
      if (cue.kind === 'annotation') annotationCount += 1;
      if (cue.kind === 'state') stateCount += 1;
    }
  }
  return {
    issues,
    targetIds: [...targetIds],
    tabIds: [...tabIds],
    interactionCount,
    annotationCount,
    stateCount,
  };
}
