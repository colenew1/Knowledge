/**
 * Fill job service.
 *
 * Lifecycle:
 *   pending           -- row just created, xlsx stored
 *   planning          -- structure detection running
 *   ready_to_generate -- plan + questions stored, user can trigger generate
 *   generating        -- draftAllAnswers running
 *   ready             -- answers stored, download available
 *   error             -- something blew up, error_message populated
 *
 * We separate plan-and-extract from generate-answers so that:
 *   (a) the user can sanity-check the parsed question count before burning
 *       Claude calls, and
 *   (b) generation can be re-run without re-detecting structure.
 */

import { db } from '@/lib/supabase';
import { detectStructure } from '@/lib/structure/detect';
import { extractAllQuestions, partitionQuestions } from '@/lib/structure/extract';
import { draftAllAnswers } from '@/lib/answer/generate';
import { writeAnswersToWorkbook } from '@/lib/structure/writeback';
import type { FillJob } from '@/lib/types';

export async function createFillJob(opts: {
  title: string;
  filename: string;
  buffer: Buffer;
}): Promise<FillJob> {
  const supabase = db();
  const b64 = opts.buffer.toString('base64');

  const { data, error } = await supabase
    .from('fill_jobs')
    .insert({
      title: opts.title,
      filename: opts.filename,
      original_xlsx_b64: b64,
      status: 'pending',
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create fill_job: ${error?.message}`);
  }
  return data as FillJob;
}

/**
 * Detect structure for a fill job and extract the unanswered question list.
 * Safe to re-run; overwrites plan + questions.
 */
export async function planFillJob(id: string): Promise<FillJob> {
  const supabase = db();
  const { data: job, error } = await supabase
    .from('fill_jobs')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !job) throw new Error(`Fill job not found: ${id}`);

  await supabase
    .from('fill_jobs')
    .update({ status: 'planning', error_message: null })
    .eq('id', id);

  try {
    const buffer = Buffer.from(job.original_xlsx_b64, 'base64');
    const plan = await detectStructure(buffer);
    const all = extractAllQuestions(buffer, plan);
    const { unanswered } = partitionQuestions(all);

    const { data: updated, error: updErr } = await supabase
      .from('fill_jobs')
      .update({
        structure_plan: plan,
        questions: unanswered,
        status: 'ready_to_generate',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (updErr || !updated) throw updErr || new Error('Update failed');
    return updated as FillJob;
  } catch (err) {
    await supabase
      .from('fill_jobs')
      .update({
        status: 'error',
        error_message: err instanceof Error ? err.message : 'Planning failed',
      })
      .eq('id', id);
    throw err;
  }
}

/**
 * Generate drafts for every unanswered question in the job. Leaves the job
 * in status=ready on success.
 */
export async function generateFillJob(id: string): Promise<FillJob> {
  const supabase = db();
  const { data: job, error } = await supabase
    .from('fill_jobs')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !job) throw new Error(`Fill job not found: ${id}`);

  await supabase
    .from('fill_jobs')
    .update({ status: 'generating', error_message: null })
    .eq('id', id);

  try {
    const questions = (job.questions || []) as FillJob['questions'];
    const answers = await draftAllAnswers(questions);

    const { data: updated, error: updErr } = await supabase
      .from('fill_jobs')
      .update({
        answers,
        status: 'ready',
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (updErr || !updated) throw updErr || new Error('Update failed');
    return updated as FillJob;
  } catch (err) {
    await supabase
      .from('fill_jobs')
      .update({
        status: 'error',
        error_message: err instanceof Error ? err.message : 'Generation failed',
      })
      .eq('id', id);
    throw err;
  }
}

/**
 * Build the downloadable xlsx with answers written back.
 */
export async function buildDownloadBuffer(id: string): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const supabase = db();
  const { data: job, error } = await supabase
    .from('fill_jobs')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !job) throw new Error(`Fill job not found: ${id}`);

  const original = Buffer.from(job.original_xlsx_b64, 'base64');
  const questions = (job.questions || []) as FillJob['questions'];
  const answers = (job.answers || []) as FillJob['answers'];

  const buffer = writeAnswersToWorkbook(original, questions, answers);
  const base = (job.filename || job.title || 'rfp').replace(/\.xlsx$/i, '');
  const safe = base.replace(/[^a-z0-9-_]+/gi, '_');
  return { buffer, filename: `${safe}_filled.xlsx` };
}
