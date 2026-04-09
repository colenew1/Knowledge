/**
 * PATCH /api/fill/[id]/answer
 *
 * Updates a single draft answer within the fill job's `answers` JSON blob.
 * Called from the review workspace on textarea blur to persist reviewer edits.
 *
 * Body: { question_id: string, draft_answer: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import type { DraftAnswer } from '@/lib/types';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const questionId = String(body?.question_id || '').trim();
  const draftText = typeof body?.draft_answer === 'string' ? body.draft_answer : null;

  if (!questionId || draftText === null) {
    return NextResponse.json(
      { error: 'question_id and draft_answer are required' },
      { status: 400 }
    );
  }

  const supabase = db();
  const { data: job, error: fetchErr } = await supabase
    .from('fill_jobs')
    .select('answers')
    .eq('id', id)
    .single();

  if (fetchErr || !job) {
    return NextResponse.json({ error: 'Fill job not found' }, { status: 404 });
  }

  const answers = (job.answers || []) as DraftAnswer[];
  const idx = answers.findIndex((a) => a.question_id === questionId);
  if (idx === -1) {
    return NextResponse.json(
      { error: 'Question not found in job' },
      { status: 404 }
    );
  }

  const updated: DraftAnswer = {
    ...answers[idx],
    draft_answer: draftText,
    edited: true,
  };
  const nextAnswers = [...answers];
  nextAnswers[idx] = updated;

  const { error: updErr } = await supabase
    .from('fill_jobs')
    .update({ answers: nextAnswers, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ draft: updated });
}
