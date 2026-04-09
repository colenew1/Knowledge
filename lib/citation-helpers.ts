/**
 * Helpers for rendering Citation objects in the UI.
 *
 * Some KB sources (particularly older past-RFP ingests where the question and
 * answer columns weren't cleanly separated) end up with pairs where
 * `question` and `answer` contain the same or near-identical text. Showing
 * both stacked makes the citation look like it's printed twice. These helpers
 * normalize what to render so the UI can stay declarative.
 */

import type { Citation } from './types';

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Decide whether the citation's question field is worth showing alongside
 * the answer. Returns false when the two strings are effectively identical,
 * when one is a prefix of the other, or when the question is so long that
 * it's clearly not a real question (a wall of narrative copy that happened
 * to land in the question column).
 */
export function shouldShowCitationQuestion(c: Citation): boolean {
  const q = normalize(c.question || '');
  const a = normalize(c.answer || '');
  if (!q) return false;
  if (q === a) return false;
  if (q.length > 400) return false;
  if (a.startsWith(q) || q.startsWith(a)) return false;
  return true;
}

/**
 * Split a block of text into alternating plain / highlighted chunks based
 * on a list of verbatim excerpts. Matches are case-insensitive and
 * overlapping ranges are merged. Used to visually mark the specific
 * passages Claude drew from inside a full citation answer.
 */
export type TextChunk = { text: string; highlight: boolean };

export function splitHighlightChunks(
  text: string,
  excerpts: string[] | undefined
): TextChunk[] {
  if (!text) return [];
  if (!excerpts || excerpts.length === 0) {
    return [{ text, highlight: false }];
  }

  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];

  for (const raw of excerpts) {
    const needle = (raw || '').trim();
    if (!needle) continue;

    // Try exact match first.
    let idx = lower.indexOf(needle.toLowerCase());

    // Fall back to a whitespace-tolerant match: collapse both sides to
    // single spaces and search. If found, map back to the original text
    // by scanning word-by-word. This handles cases where Claude normalized
    // whitespace when copying an excerpt out of a wrapped answer.
    if (idx < 0) {
      const normNeedle = needle.replace(/\s+/g, ' ').toLowerCase();
      const normHay = lower.replace(/\s+/g, ' ');
      const hit = normHay.indexOf(normNeedle);
      if (hit >= 0) {
        // Rough mapping: count non-whitespace chars up to `hit` in the
        // collapsed haystack, then walk the original until we've seen that
        // many non-whitespace chars. Not perfect but good enough for
        // highlighting.
        let nonWsTarget = 0;
        for (let i = 0; i < hit; i++) {
          if (normHay[i] !== ' ') nonWsTarget++;
        }
        let origStart = -1;
        let seen = 0;
        for (let i = 0; i < text.length; i++) {
          if (!/\s/.test(text[i])) {
            if (seen === nonWsTarget) {
              origStart = i;
              break;
            }
            seen++;
          }
        }
        if (origStart >= 0) {
          // Walk forward in original until we match the needle's non-ws char count.
          const needleNonWs = normNeedle.replace(/\s/g, '').length;
          let end = origStart;
          let consumed = 0;
          while (end < text.length && consumed < needleNonWs) {
            if (!/\s/.test(text[end])) consumed++;
            end++;
          }
          ranges.push([origStart, end]);
          continue;
        }
      }
      continue;
    }

    ranges.push([idx, idx + needle.length]);
  }

  if (ranges.length === 0) return [{ text, highlight: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) {
      last[1] = Math.max(last[1], ranges[i][1]);
    } else {
      merged.push(ranges[i]);
    }
  }

  const chunks: TextChunk[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      chunks.push({ text: text.slice(cursor, start), highlight: false });
    }
    chunks.push({ text: text.slice(start, end), highlight: true });
    cursor = end;
  }
  if (cursor < text.length) {
    chunks.push({ text: text.slice(cursor), highlight: false });
  }
  return chunks;
}
