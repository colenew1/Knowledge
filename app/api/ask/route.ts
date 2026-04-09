/**
 * Ad-hoc "Ask" endpoint: answer a single free-form question from the KB.
 * Useful when someone's in a call or Slack and needs a quick grounded
 * lookup without uploading a whole xlsx.
 */

import { NextRequest, NextResponse } from 'next/server';
import { draftAnswerWithCandidates } from '@/lib/answer/generate';
import { retrieveShortlist } from '@/lib/answer/retrieve';
import type { ExtractedQuestion } from '@/lib/types';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const question = String(body?.question || '').trim();
  const section = String(body?.section || 'General').trim();

  if (!question) {
    return NextResponse.json(
      { error: 'question is required' },
      { status: 400 }
    );
  }

  try {
    const shortlist = await retrieveShortlist(question, 12);
    const stubQuestion: ExtractedQuestion = {
      id: 'adhoc',
      sheet: '',
      section,
      question,
      row: 0,
      col: 0,
      answer_row: 0,
      answer_col: 0,
      existing_answer: null,
    };
    const draft = await draftAnswerWithCandidates(stubQuestion, shortlist);
    return NextResponse.json({ draft, candidates: shortlist.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ask failed' },
      { status: 500 }
    );
  }
}
