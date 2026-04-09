/**
 * Knowledge-base ingest service.
 *
 * Pipeline for a prior RFP upload:
 *   1. Create kb_sources row with a null structure_plan
 *   2. Detect structure (Claude) → update the source row
 *   3. Extract all questions, keep the ones with non-empty vendor answers
 *   4. Insert one kb_pairs row per Q&A pair (with pre-tokenized tokens)
 */

import { db } from '@/lib/supabase';
import { detectStructure } from '@/lib/structure/detect';
import { extractAllQuestions, partitionQuestions } from '@/lib/structure/extract';
import { uniqueTokens } from '@/lib/answer/tokens';
import type { KbSource } from '@/lib/types';

export type IngestResult = {
  source: KbSource;
  total_questions: number;
  pairs_saved: number;
  skipped_no_answer: number;
};

export async function ingestKbSource(opts: {
  title: string;
  filename: string;
  sourceType?: KbSource['source_type'];
  buffer: Buffer;
  notes?: string;
}): Promise<IngestResult> {
  const supabase = db();

  // 1. Create the source row upfront so the ingest is crash-recoverable.
  const { data: sourceRow, error: createErr } = await supabase
    .from('kb_sources')
    .insert({
      title: opts.title,
      filename: opts.filename,
      source_type: opts.sourceType || 'past_rfp',
      notes: opts.notes || null,
    })
    .select('*')
    .single();
  if (createErr || !sourceRow) {
    throw new Error(`Failed to create kb_source: ${createErr?.message}`);
  }

  try {
    // 2. Detect structure
    const plan = await detectStructure(opts.buffer);
    await supabase
      .from('kb_sources')
      .update({ structure_plan: plan })
      .eq('id', sourceRow.id);

    // 3. Extract and partition
    const questions = extractAllQuestions(opts.buffer, plan);
    const { answered } = partitionQuestions(questions);

    // 4. Bulk insert Q&A pairs
    if (answered.length > 0) {
      const rows = answered.map((q) => ({
        source_id: sourceRow.id,
        section: q.section,
        question: q.question,
        answer: q.existing_answer!,
        tokens: uniqueTokens(`${q.question} ${q.section}`),
      }));

      const { error: insertErr } = await supabase.from('kb_pairs').insert(rows);
      if (insertErr) {
        throw new Error(`Failed to insert kb_pairs: ${insertErr.message}`);
      }
    }

    return {
      source: { ...sourceRow, structure_plan: plan } as KbSource,
      total_questions: questions.length,
      pairs_saved: answered.length,
      skipped_no_answer: questions.length - answered.length,
    };
  } catch (err) {
    // Best-effort cleanup: leave the source row so the user can inspect
    // error state, but surface the error.
    throw err;
  }
}
