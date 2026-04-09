/**
 * Retrieve a shortlist of KB pairs that are likely relevant to a new question.
 *
 * Strategy:
 *   1. Tokenize the incoming question.
 *   2. Use Postgres GIN index on kb_pairs.tokens for a fast "any token
 *      overlaps" candidate pre-filter.
 *   3. Score candidates by weighted token overlap (question weight >
 *      section weight > answer weight) and return top N.
 *
 * No embeddings. If we ever need them we can add a pgvector column to
 * kb_pairs and a re-rank step — but token overlap + Claude's re-rank inside
 * the answer prompt is plenty for a corpus of hundreds of pairs.
 */

import { db } from '@/lib/supabase';
import { tokenize } from './tokens';
import type { KbPair } from '@/lib/types';

export type ScoredPair = {
  pair: KbPair;
  source_title: string;
  score: number;
};

export async function retrieveShortlist(
  question: string,
  limit = 12
): Promise<ScoredPair[]> {
  const supabase = db();
  const qTokens = tokenize(question);
  if (qTokens.length === 0) return [];

  // Use the GIN index with && overlap operator. If the corpus is small we
  // just load everything.
  const { data, error } = await supabase
    .from('kb_pairs')
    .select(
      `
      id,
      source_id,
      section,
      question,
      answer,
      tokens,
      created_at,
      kb_sources ( title )
    `
    )
    .overlaps('tokens', qTokens)
    .limit(200);

  if (error) {
    throw new Error(`Shortlist query failed: ${error.message}`);
  }
  if (!data || data.length === 0) return [];

  type Row = KbPair & {
    kb_sources: { title: string } | { title: string }[] | null;
  };

  const qSet = new Set(qTokens);

  const scored: ScoredPair[] = (data as Row[]).map((row) => {
    const questionTokens = tokenize(row.question);
    const sectionTokens = tokenize(row.section || '');
    const answerTokens = tokenize(row.answer);

    let score = 0;
    for (const t of questionTokens) if (qSet.has(t)) score += 3;
    for (const t of sectionTokens) if (qSet.has(t)) score += 2;
    for (const t of answerTokens) if (qSet.has(t)) score += 1;

    const sources = row.kb_sources;
    const source_title = Array.isArray(sources)
      ? sources[0]?.title || ''
      : sources?.title || '';

    return {
      pair: {
        id: row.id,
        source_id: row.source_id,
        section: row.section,
        question: row.question,
        answer: row.answer,
        tokens: row.tokens,
        created_at: row.created_at,
      },
      source_title,
      score,
    };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
