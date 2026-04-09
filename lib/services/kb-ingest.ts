/**
 * Knowledge-base ingest service.
 *
 * Three pipelines share the same kb_sources / kb_pairs storage:
 *
 * xlsx pipeline (past RFP spreadsheets, SIG, CAIQ):
 *   1. Create kb_sources row with a null structure_plan
 *   2. Detect structure (Claude) → update the source row
 *   3. Extract all questions, keep the ones with non-empty vendor answers
 *   4. Insert one kb_pairs row per Q&A pair (with pre-tokenized tokens)
 *
 * docx pipeline (past RFP Word docs, vendor questionnaires):
 *   1. Create kb_sources row
 *   2. Run mammoth + Claude Q&A extraction (lib/kb/docx-extract.ts)
 *   3. Insert one kb_pairs row per extracted pair
 *
 * pdf pipeline (SLAs, policies, SOC 2, whitepapers):
 *   1. Create kb_sources row
 *   2. Run unpdf + Claude Q&A synthesis (lib/kb/pdf-extract.ts) —
 *      narrative docs have no pre-formed Q/A, so we synthesize them
 *      from factual claims with grounded answers.
 *   3. Insert one kb_pairs row per synthesized pair
 *
 * The file extension decides which pipeline runs — we do not sniff the
 * buffer, so uploads must be named correctly.
 */

import { db } from '@/lib/supabase';
import { detectStructure } from '@/lib/structure/detect';
import { extractAllQuestions, partitionQuestions } from '@/lib/structure/extract';
import { extractQaPairsFromDocx } from '@/lib/kb/docx-extract';
import { extractQaPairsFromPdf } from '@/lib/kb/pdf-extract';
import { uniqueTokens } from '@/lib/answer/tokens';
import type { KbSource } from '@/lib/types';

export type IngestResult = {
  source: KbSource;
  total_questions: number;
  pairs_saved: number;
  skipped_no_answer: number;
};

function isDocx(filename: string): boolean {
  return filename.toLowerCase().endsWith('.docx');
}

function isPdf(filename: string): boolean {
  return filename.toLowerCase().endsWith('.pdf');
}

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

  if (isPdf(opts.filename)) {
    return ingestPdf(sourceRow, opts.buffer);
  }
  if (isDocx(opts.filename)) {
    return ingestDocx(sourceRow, opts.buffer);
  }
  return ingestXlsx(sourceRow, opts.buffer);
}

async function ingestPdf(
  sourceRow: KbSource,
  buffer: Buffer
): Promise<IngestResult> {
  const supabase = db();

  // PDFs are narrative docs (SLAs, policies, whitepapers). We synthesize
  // Q&A pairs from factual claims rather than extracting pre-formed ones.
  // No structure_plan since there's no grid.
  const pairs = await extractQaPairsFromPdf(buffer);

  if (pairs.length > 0) {
    const rows = pairs.map((p) => ({
      source_id: sourceRow.id,
      section: p.section || 'General',
      question: p.question,
      answer: p.answer,
      tokens: uniqueTokens(`${p.question} ${p.section || ''}`),
    }));

    const { error: insertErr } = await supabase.from('kb_pairs').insert(rows);
    if (insertErr) {
      throw new Error(`Failed to insert kb_pairs: ${insertErr.message}`);
    }
  }

  return {
    source: sourceRow as KbSource,
    total_questions: pairs.length,
    pairs_saved: pairs.length,
    skipped_no_answer: 0,
  };
}

async function ingestXlsx(
  sourceRow: KbSource,
  buffer: Buffer
): Promise<IngestResult> {
  const supabase = db();

  // 2. Detect structure
  const plan = await detectStructure(buffer);
  await supabase
    .from('kb_sources')
    .update({ structure_plan: plan })
    .eq('id', sourceRow.id);

  // 3. Extract and partition
  const questions = extractAllQuestions(buffer, plan);
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
}

async function ingestDocx(
  sourceRow: KbSource,
  buffer: Buffer
): Promise<IngestResult> {
  const supabase = db();

  // Word docs don't have a structure_plan — the extraction is narrative-
  // based, not grid-based. We leave structure_plan null on kb_sources.
  const pairs = await extractQaPairsFromDocx(buffer);

  if (pairs.length > 0) {
    const rows = pairs.map((p) => ({
      source_id: sourceRow.id,
      section: p.section || 'General',
      question: p.question,
      answer: p.answer,
      tokens: uniqueTokens(`${p.question} ${p.section || ''}`),
    }));

    const { error: insertErr } = await supabase.from('kb_pairs').insert(rows);
    if (insertErr) {
      throw new Error(`Failed to insert kb_pairs: ${insertErr.message}`);
    }
  }

  return {
    source: sourceRow as KbSource,
    total_questions: pairs.length,
    pairs_saved: pairs.length,
    skipped_no_answer: 0,
  };
}
