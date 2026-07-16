import { lessonTextTokens } from '../lesson-context.js';
import {
  PRESENTATION_DIALOGUE_ACTS,
  normalizePresentationTimeline,
} from './contract.js';

export const PRESENTATION_DIALOGUE_QUALITY_PROFILE_VERSION = 'presentation-dialogue-quality-v2';
export const PRESENTATION_DIALOGUE_QUALITY_PROFILE = Object.freeze({
  version: PRESENTATION_DIALOGUE_QUALITY_PROFILE_VERSION,
  closureWindow: 3,
  maxSamePersonaRun: 2,
  maxOverlapWords: 5,
  minTurnWords: 3,
  maxTurnWords: 36,
  maxRepeatedDiscourseMarker: 2,
  minAlternatingDependencyRatio: 0.5,
  repetitionNgramSize: 3,
  maxCrossTurnNgramOccurrences: 3,
  maxCrossTurnContentTokenOccurrences: 3,
  maxRepeatedContentTokenRatio: 0.5,
  minPersonaContributionRatio: 0.2,
  maxPersonaContributionRatio: 0.8,
});
export const PRESENTATION_DIALOGUE_ISSUE_CODES = Object.freeze({
  invalidAct: 'dialogue-act-invalid',
  undeclaredPersona: 'dialogue-persona-undeclared',
  replyContentDisconnected: 'dialogue-reply-content-disconnected',
  roleIndistinct: 'dialogue-role-indistinct',
  repeatedDiscourseMarker: 'dialogue-discourse-marker-repeated',
  alternatingMonologues: 'dialogue-alternating-monologues',
  turnPacing: 'dialogue-turn-pacing',
  terminalPunctuation: 'dialogue-terminal-punctuation-missing',
  questionPunctuation: 'dialogue-question-punctuation-missing',
  pronounceabilityHazard: 'dialogue-pronounceability-hazard',
  deliveryDiscontinuity: 'dialogue-delivery-discontinuity',
  weakSemanticAct: 'dialogue-semantic-act-weak',
  repetitionFlood: 'dialogue-repetition-flood',
  roleContributionImbalanced: 'dialogue-role-contribution-imbalanced',
});

const ACT_SET = new Set(PRESENTATION_DIALOGUE_ACTS);
const CLAIM_EXEMPT_ACTS = new Set(['ask', 'acknowledge', 'handoff']);
const RESPONSE_ACTS = new Set(['respond', 'clarify', 'confirm', 'acknowledge', 'disagree']);
const REPLY_REQUIRED_ACTS = new Set(['respond', 'confirm', 'acknowledge', 'disagree']);
const SEMANTIC_ACTS = new Set(['handoff', 'summarize', 'conclude']);
const DELIVERY_SHIFT_ACTS = new Set(['challenge', 'disagree']);
const TERMINAL_PUNCTUATION = /[.!?…]["'»”)]*$/u;
const QUESTION_PUNCTUATION = /\?["'»”)]*$/u;
const DISCOURSE_MARKERS = Object.freeze([
  ['right', /^right\b[,:-]?/iu],
  ['exactly', /^exactly\b[,:-]?/iu],
  ['so', /^so\b[,:-]?/iu],
  ['now', /^now\b[,:-]?/iu],
  ['well', /^well\b[,:-]?/iu],
  ['yes', /^yes\b[,:-]?/iu],
  ['верно', /^верно\b[,:-]?/iu],
  ['точно', /^точно\b[,:-]?/iu],
  ['итак', /^итак\b[,:-]?/iu],
  ['теперь', /^теперь\b[,:-]?/iu],
  ['да', /^да\b[,:-]?/iu],
]);
const GENERIC_SEMANTIC_TOKENS = new Set([
  'handoff', 'over', 'next', 'summary', 'summarize', 'conclusion', 'conclude', 'close', 'done',
  'передаю', 'дальше', 'итог', 'итоги', 'завершая', 'заключение', 'закончим', 'готово',
]);

function list(value) {
  return Array.isArray(value) ? value : [];
}

function wordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function contentTokens(value, locale) {
  return lessonTextTokens(value, locale, { contentOnly: true });
}

function sharesContent(left, right, locale) {
  let leftTokens = new Set(contentTokens(left, locale));
  return contentTokens(right, locale).some((token) => leftTokens.has(token));
}

function discourseMarker(value) {
  let text = String(value || '').trim();
  return DISCOURSE_MARKERS.find(([, pattern]) => pattern.test(text))?.[0] || '';
}

function pronounceabilityHazard(value) {
  let text = String(value || '');
  let url = text.match(/(?:https?:\/\/|www\.)\S+/iu)?.[0];
  if (url) return url;
  let tokens = text.match(/[\p{L}\p{N}_./:-]+/gu) || [];
  return tokens.find((token) => (
    /(?:[^_/]*[_/]){2}/u.test(token) || /[_/]/u.test(token) && /\d/u.test(token) ||
    token.length >= 18 && /\d/u.test(token) && /\p{L}/u.test(token) ||
    /[bcdfghjklmnpqrstvwxyzбвгджзйклмнпрстфхцчшщ]{7,}/iu.test(token)
  )) || '';
}

function effectiveDelivery(turn, persona) {
  return {
    emotion: turn.delivery?.emotion || persona?.delivery?.emotion || '',
    pace: turn.delivery?.pace || persona?.delivery?.pace || '',
    tone: turn.delivery?.tone || persona?.delivery?.tone || '',
  };
}

function weakSemanticAct(turn, priorText, locale) {
  let meaningful = contentTokens(turn.text, locale).filter((token) => !GENERIC_SEMANTIC_TOKENS.has(token));
  if (meaningful.length < 2) return true;
  if (turn.dialogueAct === 'handoff') return false;
  return priorText && !sharesContent(turn.text, priorText, locale);
}

function roleSignature(persona, locale) {
  return [...new Set(contentTokens(persona?.role, locale))].sort().join(' ');
}

function contentNgrams(tokens, size) {
  let ngrams = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    ngrams.add(tokens.slice(index, index + size).join(' '));
  }
  return ngrams;
}

function dialogueRepetitionMetrics(turns, locale, ngramSize, maxNgramOccurrences, maxContentTokenOccurrences) {
  let tokenTurnCounts = new Map();
  let ngramTurnCounts = new Map();
  let totalContentTokens = 0;
  for (let turn of turns) {
    let tokens = contentTokens(turn.text, locale);
    totalContentTokens += tokens.length;
    for (let token of new Set(tokens)) tokenTurnCounts.set(token, (tokenTurnCounts.get(token) || 0) + 1);
    for (let ngram of contentNgrams(tokens, ngramSize)) ngramTurnCounts.set(ngram, (ngramTurnCounts.get(ngram) || 0) + 1);
  }
  let repeatedContentTokens = turns.reduce((count, turn) => count + contentTokens(turn.text, locale)
    .filter((token) => (tokenTurnCounts.get(token) || 0) > maxContentTokenOccurrences).length, 0);
  let repeatedNgrams = [...ngramTurnCounts.entries()]
    .filter(([, occurrences]) => occurrences > maxNgramOccurrences)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([ngram, occurrences]) => ({ ngram, occurrences }));
  return {
    ngramSize,
    maxNgramTurnOccurrences: Math.max(0, ...ngramTurnCounts.values()),
    repeatedNgrams,
    repeatedContentTokens,
    totalContentTokens,
    repeatedContentTokenRatio: totalContentTokens ? repeatedContentTokens / totalContentTokens : 0,
  };
}

function dialogueContributionMetrics(turns, locale) {
  let totalContentTokens = turns.reduce((count, turn) => count + contentTokens(turn.text, locale).length, 0);
  let personas = {};
  for (let persona of [...new Set(turns.map((turn) => turn.persona))].sort()) {
    let personaTurns = turns.filter((turn) => turn.persona === persona);
    let contentTokenCount = personaTurns.reduce((count, turn) => count + contentTokens(turn.text, locale).length, 0);
    personas[persona] = {
      turnCount: personaTurns.length,
      contentTokenCount,
      ratio: totalContentTokens ? contentTokenCount / totalContentTokens : 0,
    };
  }
  return { totalContentTokens, personas };
}

export function reviewPresentationDialogue(input = {}, intent = {}) {
  let timeline = normalizePresentationTimeline(input);
  let turns = timeline.turns;
  let issues = [];
  let requireDialogue = intent.requireDialogue === true;
  let strict = intent.strictDialogueQuality === true || intent.hardGate === true;
  let qualityEnabled = requireDialogue || strict || timeline.profile === 'dialogue';
  let {
    closureWindow,
    maxSamePersonaRun,
    maxOverlapWords,
    minTurnWords,
    maxTurnWords,
    maxRepeatedDiscourseMarker,
    minAlternatingDependencyRatio,
    repetitionNgramSize,
    maxCrossTurnNgramOccurrences,
    maxCrossTurnContentTokenOccurrences,
    maxRepeatedContentTokenRatio,
    minPersonaContributionRatio,
    maxPersonaContributionRatio,
  } = PRESENTATION_DIALOGUE_QUALITY_PROFILE;
  let personaIds = new Set(Object.keys(timeline.personas));
  let spokenPersonas = new Set(turns.map((turn) => turn.persona));
  let groundingSources = new Set(list(timeline.grounding?.sources).map((source) => source.id));
  let longestPersonaRun = 0;
  let run = 0;
  let previousPersona = '';
  let questionCount = 0;
  let clarificationCount = 0;
  let markerCounts = new Map();
  let previousDeliveryByPersona = new Map();
  let dependentAlternations = 0;
  let alternations = 0;

  if (requireDialogue && spokenPersonas.size !== 2) {
    issues.push({ code: 'dialogue-role-count', severity: 'error', message: `Dialogue requires exactly two speaking personas; found ${spokenPersonas.size}.` });
  }

  if (qualityEnabled && spokenPersonas.size > 1) {
    let signatures = [...spokenPersonas].map((personaId) => roleSignature(timeline.personas[personaId], timeline.locale));
    if (signatures.some((signature) => !signature) || new Set(signatures).size !== signatures.length) {
      issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.roleIndistinct, severity: strict ? 'error' : 'warning', message: 'Speaking personas need distinct authored roles.' });
    }
  }

  for (let [index, turn] of turns.entries()) {
    if (!ACT_SET.has(turn.dialogueAct)) {
      issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.invalidAct, severity: 'error', message: 'Turn has no valid dialogue act.', turnIndex: index, turnId: turn.id });
    }
    if (!personaIds.has(turn.persona)) {
      issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.undeclaredPersona, severity: 'error', message: 'Turn persona is not declared.', turnIndex: index, turnId: turn.id });
    }
    if (turn.addressee && !personaIds.has(turn.addressee)) {
      issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.undeclaredPersona, severity: 'error', message: 'Turn addressee is not declared.', turnIndex: index, turnId: turn.id });
    }
    if (turn.persona === previousPersona) run += 1;
    else {
      previousPersona = turn.persona;
      run = 1;
    }
    longestPersonaRun = Math.max(longestPersonaRun, run);

    if (qualityEnabled) {
      let words = wordCount(turn.text);
      if (words < minTurnWords || words > maxTurnWords) {
        issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.turnPacing, severity: strict ? 'error' : 'warning', message: `Turn has ${words} words; authored dialogue bounds are ${minTurnWords}-${maxTurnWords}.`, turnIndex: index, turnId: turn.id, wordCount: words });
      }
      if (!TERMINAL_PUNCTUATION.test(turn.text)) {
        issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.terminalPunctuation, severity: strict ? 'error' : 'warning', message: 'Turn needs terminal punctuation for deterministic speech delivery.', turnIndex: index, turnId: turn.id });
      }
      if (turn.dialogueAct === 'ask' && !QUESTION_PUNCTUATION.test(turn.text)) {
        issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.questionPunctuation, severity: strict ? 'error' : 'warning', message: 'Question dialogue acts must end with question punctuation.', turnIndex: index, turnId: turn.id });
      }
      let hazard = pronounceabilityHazard(turn.text);
      if (hazard) {
        issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.pronounceabilityHazard, severity: strict ? 'error' : 'warning', message: `Turn contains a likely pronunciation hazard: ${hazard}.`, turnIndex: index, turnId: turn.id, token: hazard });
      }
      let marker = discourseMarker(turn.text);
      if (marker) {
        let count = (markerCounts.get(marker) || 0) + 1;
        markerCounts.set(marker, count);
        if (count === maxRepeatedDiscourseMarker + 1) {
          issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.repeatedDiscourseMarker, severity: strict ? 'error' : 'warning', message: `Discourse marker "${marker}" is repeated more than ${maxRepeatedDiscourseMarker} times.`, turnIndex: index, turnId: turn.id, marker, count });
        }
      }
      let delivery = effectiveDelivery(turn, timeline.personas[turn.persona]);
      let previousDelivery = previousDeliveryByPersona.get(turn.persona);
      if (previousDelivery && !DELIVERY_SHIFT_ACTS.has(turn.dialogueAct) && (
        previousDelivery.emotion && delivery.emotion && previousDelivery.emotion !== delivery.emotion ||
        previousDelivery.pace && delivery.pace && previousDelivery.pace !== delivery.pace ||
        previousDelivery.tone && delivery.tone && previousDelivery.tone !== delivery.tone
      )) {
        issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.deliveryDiscontinuity, severity: strict ? 'error' : 'warning', message: 'Persona delivery changes without a dialogue-act reason.', turnIndex: index, turnId: turn.id, persona: turn.persona });
      }
      previousDeliveryByPersona.set(turn.persona, delivery);
      if (SEMANTIC_ACTS.has(turn.dialogueAct)) {
        let priorText = turns.slice(0, index).map((candidate) => candidate.text).join(' ');
        if (weakSemanticAct(turn, priorText, timeline.locale)) {
          issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.weakSemanticAct, severity: strict ? 'error' : 'warning', message: `${turn.dialogueAct} turn does not carry forward useful lesson content.`, turnIndex: index, turnId: turn.id });
        }
      }
    }

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
      } else {
        let referenced = turns[replyIndex];
        let referencedSources = new Set(list(referenced.sourceRefs).map((ref) => ref.sourceId));
        let sharesSource = list(turn.sourceRefs).some((ref) => referencedSources.has(ref.sourceId));
        if (qualityEnabled && RESPONSE_ACTS.has(turn.dialogueAct)
          && !sharesSource && !sharesContent(turn.text, referenced.text, timeline.locale)) {
          issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.replyContentDisconnected, severity: strict ? 'error' : 'warning', message: 'Reply has no lexical content dependency on its referenced turn.', turnIndex: index, turnId: turn.id, relatedTurnId: turn.replyTo });
        }
        if (intent.requireGrounding === true || strict) {
          if (!sharesSource && !CLAIM_EXEMPT_ACTS.has(turn.dialogueAct)) {
            issues.push({ code: 'dialogue-grounding-disconnected', severity: 'error', message: 'Reply shares no grounding source with the referenced turn.', turnIndex: index, turnId: turn.id, relatedTurnId: turn.replyTo });
          }
        }
      }
    }

    if (qualityEnabled && index > 0 && turn.persona !== turns[index - 1].persona) {
      alternations += 1;
      let priorSources = new Set(list(turns[index - 1].sourceRefs).map((ref) => ref.sourceId));
      let sharesPriorSource = list(turn.sourceRefs).some((ref) => priorSources.has(ref.sourceId));
      if (sharesPriorSource || sharesContent(turn.text, turns[index - 1].text, timeline.locale)) dependentAlternations += 1;
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
  if (qualityEnabled && turns.length >= 4 && alternations > 0 && dependentAlternations / alternations < minAlternatingDependencyRatio) {
    issues.push({ code: PRESENTATION_DIALOGUE_ISSUE_CODES.alternatingMonologues, severity: strict ? 'error' : 'warning', message: 'Persona alternation lacks enough reply or lexical dependencies to form dialogue.', alternations, dependentAlternations });
  }
  let repetitionMetrics = dialogueRepetitionMetrics(
    turns,
    timeline.locale,
    repetitionNgramSize,
    maxCrossTurnNgramOccurrences,
    maxCrossTurnContentTokenOccurrences,
  );
  if (qualityEnabled && (
    repetitionMetrics.repeatedNgrams.length > 0
    || repetitionMetrics.repeatedContentTokenRatio > maxRepeatedContentTokenRatio
  )) {
    issues.push({
      code: PRESENTATION_DIALOGUE_ISSUE_CODES.repetitionFlood,
      severity: strict ? 'error' : 'warning',
      message: 'Dialogue repeats broad phrases or content across too many turns.',
      maxCrossTurnNgramOccurrences,
      maxCrossTurnContentTokenOccurrences,
      maxRepeatedContentTokenRatio,
      repetitionMetrics,
    });
  }
  let contributionMetrics = dialogueContributionMetrics(turns, timeline.locale);
  if (qualityEnabled && spokenPersonas.size > 1) {
    for (let [persona, contribution] of Object.entries(contributionMetrics.personas)) {
      if (contribution.ratio < minPersonaContributionRatio || contribution.ratio > maxPersonaContributionRatio) {
        issues.push({
          code: PRESENTATION_DIALOGUE_ISSUE_CODES.roleContributionImbalanced,
          severity: strict ? 'error' : 'warning',
          message: `Persona "${persona}" contributes outside the authored content bounds.`,
          persona,
          contribution,
          minPersonaContributionRatio,
          maxPersonaContributionRatio,
        });
      }
    }
  }
  let minQuestions = Math.max(0, Math.floor(Number(intent.minQuestions || intent.dialogue?.minQuestions || 0)));
  let minClarifications = Math.max(0, Math.floor(Number(intent.minClarifications || intent.dialogue?.minClarifications || 0)));
  if (questionCount < minQuestions) issues.push({ code: 'dialogue-question-missing', severity: 'error', message: `Dialogue requires ${minQuestions} question turn(s); found ${questionCount}.` });
  if (clarificationCount < minClarifications) issues.push({ code: 'dialogue-clarification-missing', severity: 'error', message: `Dialogue requires ${minClarifications} clarification turn(s); found ${clarificationCount}.` });

  return {
    issues,
    qualityProfileVersion: PRESENTATION_DIALOGUE_QUALITY_PROFILE_VERSION,
    longestPersonaRun,
    maxSamePersonaRun,
    maxOverlapWords,
    questionCount,
    clarificationCount,
    dependencyMetrics: {
      alternations,
      dependentAlternations,
      ratio: alternations ? dependentAlternations / alternations : 0,
    },
    repetitionMetrics,
    contributionMetrics,
  };
}
