/**
 * POST /api/fill/[id]/infer
 *
 * Re-runs answer generation for a single question in INFER mode. Used from
 * the review workspace when a question came back as `no_info` under strict
 * mode and the reviewer wants a best-effort inference from related KB
 * material.
 *
 * Body: { question_id: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { retrieveShortlist } from '@/lib/answer/retrieve';
import { draftAnswerWithCandidates } from '@/lib/answer/generate';
import type { DraftAnswer, ExtractedQuestion } from '@/lib/types';

export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const questionId = String(body?.question_id || '').trim();
  const preview = Boolean(body?.preview);
  if (!questionId) {
    return NextResponse.json(
      { error: 'question_id is required' },
      { status: 400 }
    );
  }

  const supabase = db();
  const { data: job, error: fetchErr } = await supabase
    .from('fill_jobs')
    .select('questions, answers')
    .eq('id', id)
    .single();

  if (fetchErr || !job) {
    return NextResponse.json({ error: 'Fill job not found' }, { status: 404 });
  }

  const questions = (job.questions || []) as ExtractedQuestion[];
  const question = questions.find((q) => q.id === questionId);
  if (!question) {
    return NextResponse.json(
      { error: 'Question not found in job' },
      { status: 404 }
    );
  }

  try {
    const shortlist = await retrieveShortlist(question.question, 12);
    const draft = await draftAnswerWithCandidates(question, shortlist, 'infer');

    // Preview mode: return the draft without touching the stored job. The
    // client then shows a preview card with Confirm/Discard controls.
    if (preview) {
      return NextResponse.json({ draft });
    }

    const answers = (job.answers || []) as DraftAnswer[];
    const idx = answers.findIndex((a) => a.question_id === questionId);
    const nextAnswers = [...answers];
    if (idx === -1) {
      nextAnswers.push(draft);
    } else {
      nextAnswers[idx] = draft;
    }

    const { error: updErr } = await supabase
      .from('fill_jobs')
      .update({ answers: nextAnswers, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ draft });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Infer failed' },
      { status: 500 }
    );
  }
}
