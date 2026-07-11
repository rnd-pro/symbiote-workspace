import {
  PRESENTATION_DIALOGUE_ACTS,
  normalizePresentationTimeline,
} from './contract.js';

const ACT_SET = new Set(PRESENTATION_DIALOGUE_ACTS);
const CLAIM_EXEMPT_ACTS = new Set(['ask', 'acknowledge', 'handoff']);
const RESPONSE_ACTS = new Set(['respond', 'clarify', 'confirm', 'acknowledge', 'disagree']);
const REPLY_REQUIRED_ACTS = new Set(['respond', 'confirm', 'acknowledge', 'disagree']);

function list(value) {
  return Array.isArray(value) ? value : [];
}

function wordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

export function reviewPresentationDialogue(input = {}, intent = {}) {
  let timeline = normalizePresentationTimeline(input);
  let turns = timeline.turns;
  let issues = [];
  let requireDialogue = intent.requireDialogue === true;
  let strict = intent.strictDialogueQuality === true || intent.hardGate === true;
  let closureWindow = Math.max(1, Math.floor(Number(intent.dialogue?.closureWindow || 3)));
  let maxSamePersonaRun = Math.max(1, Math.floor(Number(intent.maxSamePersonaRun || intent.dialogue?.maxSamePersonaRun || 2)));
  let maxOverlapWords = Math.max(1, Math.floor(Number(intent.maxOverlapWords || intent.dialogue?.maxOverlapWords || 5)));
  let personaIds = new Set(Object.keys(timeline.personas));
  let spokenPersonas = new Set(turns.map((turn) => turn.persona));
  let groundingSources = new Set(list(timeline.grounding?.sources).map((source) => source.id));
  let longestPersonaRun = 0;
  let run = 0;
  let previousPersona = '';
  let questionCount = 0;
  let clarificationCount = 0;

  if (requireDialogue && spokenPersonas.size !== 2) {
    issues.push({ code: 'dialogue-role-count', severity: 'error', message: `Dialogue requires exactly two speaking personas; found ${spokenPersonas.size}.` });
  }

  for (let [index, turn] of turns.entries()) {
    if (!ACT_SET.has(turn.dialogueAct)) {
      issues.push({ code: 'dialogue-reply-missing', severity: 'error', message: 'Turn has no valid dialogue act.', turnIndex: index, turnId: turn.id });
    }
    if (!personaIds.has(turn.persona)) {
      issues.push({ code: 'dialogue-role-count', severity: 'error', message: 'Turn persona is not declared.', turnIndex: index, turnId: turn.id });
    }
    if (turn.addressee && !personaIds.has(turn.addressee)) {
      issues.push({ code: 'dialogue-role-count', severity: 'error', message: 'Turn addressee is not declared.', turnIndex: index, turnId: turn.id });
    }
    if (turn.persona === previousPersona) run += 1;
    else {
      previousPersona = turn.persona;
      run = 1;
    }
    longestPersonaRun = Math.max(longestPersonaRun, run);

    if (turn.transition?.overlapMs && index > 0) {
      let previous = turns[index - 1];
      if (previous.persona === turn.persona) {
        issues.push({ code: 'self-overlap', severity: 'error', message: 'A persona cannot overlap its own previous turn.', turnIndex: index, turnId: turn.id });
      }
      if (wordCount(turn.text) > maxOverlapWords) {
        issues.push({ code: 'overlong-overlap-turn', severity: strict ? 'error' : 'warning', message: `Overlapping turn exceeds ${maxOverlapWords} words.`, turnIndex: index, turnId: turn.id });
      }
    }

    if (requireDialogue && REPLY_REQUIRED_ACTS.has(turn.dialogueAct) && !turn.replyTo) {
      issues.push({ code: 'dialogue-reply-missing', severity: 'error', message: 'Response-class dialogue turn must link to an earlier turn.', turnIndex: index, turnId: turn.id });
    }
    if (turn.replyTo) {
      let replyIndex = turns.findIndex((candidate) => candidate.id === turn.replyTo);
      if (replyIndex < 0 || replyIndex >= index) {
        issues.push({ code: 'dialogue-reply-missing', severity: 'error', message: 'Reply link must resolve to an earlier turn.', turnIndex: index, turnId: turn.id, relatedTurnId: turn.replyTo });
      } else if (intent.requireGrounding === true || strict) {
        let priorRefs = new Set(list(turns[replyIndex].sourceRefs).map((ref) => ref.sourceId));
        let sharesSource = list(turn.sourceRefs).some((ref) => priorRefs.has(ref.sourceId));
        if (!sharesSource && !CLAIM_EXEMPT_ACTS.has(turn.dialogueAct)) {
          issues.push({ code: 'dialogue-grounding-disconnected', severity: 'error', message: 'Reply shares no grounding source with the referenced turn.', turnIndex: index, turnId: turn.id, relatedTurnId: turn.replyTo });
        }
      }
    }

    if (turn.dialogueAct === 'ask') questionCount += 1;
    if (turn.dialogueAct === 'clarify') clarificationCount += 1;
    if (['ask', 'clarify', 'challenge'].includes(turn.dialogueAct)) {
      let responses = turns.slice(index + 1, index + closureWindow + 1);
      let answered = responses.some((candidate) => (
        candidate.persona !== turn.persona && candidate.replyTo === turn.id && RESPONSE_ACTS.has(candidate.dialogueAct)
      ));
      if (!answered) {
        let code = turn.dialogueAct === 'clarify' ? 'dialogue-clarification-missing' : 'dialogue-question-unanswered';
        issues.push({ code, severity: 'error', message: `Turn has no structured response within ${closureWindow} turns.`, turnIndex: index, turnId: turn.id });
      }
    }
    if (turn.dialogueAct === 'disagree') {
      if (!turn.claims.length || !turn.sourceRefs.length || turn.sourceRefs.some((ref) => !groundingSources.has(ref.sourceId))) {
        issues.push({ code: 'grounding-required', severity: 'error', message: 'Disagreement requires a grounded counter-claim.', turnIndex: index, turnId: turn.id });
      }
    }
  }

  if (requireDialogue && longestPersonaRun > maxSamePersonaRun) {
    issues.push({ code: 'dialogue-monologue-run', severity: strict ? 'error' : 'warning', message: `Dialogue has ${longestPersonaRun} consecutive turns from one persona; max is ${maxSamePersonaRun}.`, longestPersonaRun, maxSamePersonaRun });
  }
  let minQuestions = Math.max(0, Math.floor(Number(intent.minQuestions || intent.dialogue?.minQuestions || 0)));
  let minClarifications = Math.max(0, Math.floor(Number(intent.minClarifications || intent.dialogue?.minClarifications || 0)));
  if (questionCount < minQuestions) issues.push({ code: 'dialogue-question-missing', severity: 'error', message: `Dialogue requires ${minQuestions} question turn(s); found ${questionCount}.` });
  if (clarificationCount < minClarifications) issues.push({ code: 'dialogue-clarification-missing', severity: 'error', message: `Dialogue requires ${minClarifications} clarification turn(s); found ${clarificationCount}.` });

  return { issues, longestPersonaRun, maxSamePersonaRun, maxOverlapWords, questionCount, clarificationCount };
}
