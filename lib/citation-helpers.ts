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
