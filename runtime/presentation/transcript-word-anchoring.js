export const TRANSCRIPT_WORD_ANCHORING_VERSION = 'workspace-transcript-word-anchoring-v1';

function text(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function canonicalWordKey(value) {
  return text(value)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('und');
}

export function canonicalTranscriptWordTokens(value) {
  return text(value)
    .match(/[\p{L}\p{M}\p{N}]+/gu)
    ?.map((token) => ({ text: token, key: canonicalWordKey(token) }))
    .filter((token) => token.key) || [];
}

function finiteTiming(word, unit) {
  let start = unit === 'ms'
    ? Number(word?.startMs)
    : Number(word?.startSec ?? word?.start);
  let end = unit === 'ms'
    ? Number(word?.endMs)
    : Number(word?.endSec ?? word?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  return unit === 'ms'
    ? { startMs: start, endMs: end }
    : { startMs: start * 1000, endMs: end * 1000 };
}

function timedWordTokens(words) {
  if (!Array.isArray(words)) return [];
  let result = [];
  for (let [wordIndex, word] of words.entries()) {
    let timing = finiteTiming(word, 'ms') || finiteTiming(word, 'sec');
    let observedText = text(word?.text ?? word?.word ?? word?.token);
    let tokens = canonicalTranscriptWordTokens(observedText);
    for (let token of tokens) {
      result.push({
        ...token,
        wordIndex,
        observedWordText: observedText,
        ...(timing || {}),
      });
    }
  }
  return result;
}

function firstMismatch(left, right) {
  let length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index]?.key !== right[index]?.key) return index;
  }
  return null;
}

function alignTokenSequences(authored, observed, timed) {
  let rows = authored.length + 1;
  let columns = observed.length + 1;
  let costs = Array.from({ length: rows }, () => Array(columns).fill(0));
  for (let row = 0; row < rows; row += 1) costs[row][0] = row;
  for (let column = 0; column < columns; column += 1) costs[0][column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      costs[row][column] = Math.min(
        costs[row - 1][column] + 1,
        costs[row][column - 1] + 1,
        costs[row - 1][column - 1] + (authored[row - 1].key === observed[column - 1].key ? 0 : 1),
      );
    }
  }
  let operations = [];
  let row = authored.length;
  let column = observed.length;
  while (row > 0 || column > 0) {
    let diagonalCost = row > 0 && column > 0
      ? costs[row - 1][column - 1] + (authored[row - 1].key === observed[column - 1].key ? 0 : 1)
      : Infinity;
    if (diagonalCost === costs[row][column]) {
      let authoredToken = authored[row - 1];
      let observedToken = observed[column - 1];
      let timedToken = timed[column - 1];
      operations.push({
        type: authoredToken.key === observedToken.key ? 'match' : 'substitute',
        authoredIndex: row - 1,
        observedIndex: column - 1,
        authoredText: authoredToken.text,
        observedText: observedToken.text,
        ...(timedToken ? {
          observedWordIndex: timedToken.wordIndex,
          observedWordText: timedToken.observedWordText,
          startMs: timedToken.startMs,
          endMs: timedToken.endMs,
        } : {}),
      });
      row -= 1;
      column -= 1;
      continue;
    }
    if (row > 0 && costs[row - 1][column] + 1 === costs[row][column]) {
      operations.push({
        type: 'delete',
        authoredIndex: row - 1,
        authoredText: authored[row - 1].text,
      });
      row -= 1;
      continue;
    }
    let timedToken = timed[column - 1];
    operations.push({
      type: 'insert',
      observedIndex: column - 1,
      observedText: observed[column - 1].text,
      ...(timedToken ? {
        observedWordIndex: timedToken.wordIndex,
        observedWordText: timedToken.observedWordText,
        startMs: timedToken.startMs,
        endMs: timedToken.endMs,
      } : {}),
    });
    column -= 1;
  }
  return { editDistance: costs[authored.length][observed.length], operations: operations.reverse() };
}

export function createTranscriptWordAnchoring(input = {}) {
  let authored = canonicalTranscriptWordTokens(input.authoredTranscript);
  let observed = canonicalTranscriptWordTokens(input.observedTranscript ?? input.whisperTranscript);
  let timed = timedWordTokens(input.observedWords ?? input.words);
  let observedWordMismatchIndex = firstMismatch(observed, timed);
  let allWordsTimed = timed.length > 0 && timed.every((token) => (
    Number.isFinite(token.startMs) && Number.isFinite(token.endMs) && token.endMs > token.startMs
  ));
  let observedWordsMatch = observed.length > 0
    && observed.length === timed.length
    && observedWordMismatchIndex === null
    && allWordsTimed;
  let reason = observedWordsMatch ? 'exact'
    : !observed.length ? 'observed-words-missing'
        : !timed.length ? 'timed-words-missing'
          : !allWordsTimed ? 'word-timing-invalid'
            : observed.length !== timed.length ? 'timed-word-token-count-mismatch'
              : 'timed-word-token-mismatch';
  let alignment = alignTokenSequences(authored, observed, timed);
  return {
    version: TRANSCRIPT_WORD_ANCHORING_VERSION,
    observedWordsMatch,
    reason,
    authoredTokenCount: authored.length,
    observedTokenCount: observed.length,
    timedWordTokenCount: timed.length,
    observedWordMismatchIndex,
    editDistance: alignment.editDistance,
    exactCorrespondence: authored.length > 0
      && authored.length === observed.length
      && alignment.editDistance === 0,
    operations: alignment.operations,
  };
}

export function resolveTranscriptWordAnchor(words, quote, occurrence = 1, edge = 'start') {
  let quoteTokens = canonicalTranscriptWordTokens(quote);
  let observed = timedWordTokens(words);
  if (!quoteTokens.length || !observed.length || !Number.isInteger(occurrence) || occurrence < 1) return null;
  let matches = [];
  for (let index = 0; index <= observed.length - quoteTokens.length; index += 1) {
    if (quoteTokens.every((token, offset) => token.key === observed[index + offset].key)) matches.push(index);
  }
  let matchIndex = matches[occurrence - 1];
  if (matchIndex === undefined) return null;
  let token = edge === 'end'
    ? observed[matchIndex + quoteTokens.length - 1]
    : observed[matchIndex];
  return {
    wordIndex: token.wordIndex,
    text: token.observedWordText,
    startMs: token.startMs,
    endMs: token.endMs,
    resolution: matches.length === 1 ? 'exact' : 'occurrence',
  };
}
