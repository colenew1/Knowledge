/**
 * Answer generation: given a new question and a shortlist of KB candidates,
 * ask Claude to draft a grounded response.
 *
 * Key guardrails baked into the prompt:
 * - "Use ONLY information from the candidates — do not invent facts,
 *   certifications, dates, compliance claims, or product capabilities that
 *   aren't in the candidates."
 * - Confidence level is required and tied to grounding.
 * - If the question maps to a dropdown-validated cell, the answer MUST be
 *   drawn from allowed_values.
 */

import { anthropic, CLAUDE_MODEL, parseJsonResponse } from '@/lib/anthropic';
import { retrieveShortlist, type ScoredPair } from './retrieve';
import type { Citation, DraftAnswer, ExtractedQuestion } from '@/lib/types';

const MAX_TOKENS = 1200;

type RawResponse = {
  draft_answer: string;
  used_candidate_indexes: number[];
  confidence: 'high' | 'medium' | 'low';
  needs_review_note?: string;
};

function buildPrompt(
  section: string,
  question: string,
  candidates: ScoredPair[],
  allowedValues?: string[]
): string {
  const candidateBlocks = candidates
    .map(
      (c, idx) => `<candidate index="${idx}">
  <source>${escapeXml(c.source_title)}</source>
  <section>${escapeXml(c.pair.section || '')}</section>
  <prior_question>${escapeXml(c.pair.question)}</prior_question>
  <prior_answer>${escapeXml(c.pair.answer)}</prior_answer>
</candidate>`
    )
    .join('\n\n');

  const allowedBlock = allowedValues && allowedValues.length
    ? `\n<allowed_values>\nThis question goes into a dropdown-validated cell. Your \`draft_answer\` MUST be exactly one of these values: ${allowedValues
        .map((v) => `"${v}"`)
        .join(', ')}\n</allowed_values>\n`
    : '';

  return `You are drafting a vendor response for AmplifAI to a prospect RFP or security questionnaire.

AmplifAI is an AI-powered contact center performance enablement platform. It provides post-interaction automated QA, AI coaching, performance management, gamification, and speech/sentiment analytics. AmplifAI does NOT provide real-time agent assist.

Your job: draft a single vendor response to NEW_QUESTION, grounded in the CANDIDATE prior Q&A pairs retrieved from AmplifAI's past RFP responses and security questionnaires. Use ONLY information from the candidates — do not invent facts, certifications, compliance claims, dates, numbers, or product capabilities that are not in the candidates.

If the candidates don't cover the question well enough, say so honestly: set confidence to "low" and write a \`needs_review_note\` explaining what's missing. Never fabricate security, compliance, or certification claims.

<new_question>
  <section>${escapeXml(section)}</section>
  <text>${escapeXml(question)}</text>
</new_question>
${allowedBlock}
<candidates>
${candidateBlocks || '(no candidates — this question has no prior answer in the knowledge base)'}
</candidates>

Instructions:
1. Identify which candidates are actually relevant to the new question (not just sharing keywords).
2. Draft a concise vendor response (2-5 sentences) in a professional tone. Write as AmplifAI speaking directly to the prospect. No greeting, no sign-off.
3. Record the candidate indexes you used in \`used_candidate_indexes\`.
4. Set confidence:
   - "high"   — candidates directly answer the question and you can write a grounded response with zero invention.
   - "medium" — candidates partially answer it; you had to generalize.
   - "low"    — candidates don't really cover it; you're guessing OR deliberately declining. Include a needs_review_note.
5. If allowed_values is specified, draft_answer must exactly match one of them.
6. No personalization tokens. Do not name other AmplifAI customers.

Respond with ONLY this JSON — no preamble, no markdown code fences:
{
  "draft_answer": "...",
  "used_candidate_indexes": [0, 2],
  "confidence": "high" | "medium" | "low",
  "needs_review_note": "optional string, omit or empty if confidence is high"
}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Generate a draft answer for a single question. Retrieves its own shortlist.
 */
export async function draftAnswer(
  question: ExtractedQuestion
): Promise<DraftAnswer> {
  const shortlist = await retrieveShortlist(question.question, 12);
  return draftAnswerWithCandidates(question, shortlist);
}

/**
 * Same as draftAnswer but with a pre-computed shortlist — useful when the
 * caller wants to bulk-retrieve once per job for efficiency, though in
 * practice we shortlist per question to get the best candidates per query.
 */
export async function draftAnswerWithCandidates(
  question: ExtractedQuestion,
  candidates: ScoredPair[]
): Promise<DraftAnswer> {
  const client = anthropic();
  const prompt = buildPrompt(
    question.section,
    question.question,
    candidates,
    question.allowed_values
  );

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const parsed = parseJsonResponse<RawResponse>(message);

    const citations: Citation[] = (parsed.used_candidate_indexes || [])
      .map((idx) => candidates[idx])
      .filter((c): c is ScoredPair => Boolean(c))
      .map((c) => ({
        source_id: c.pair.source_id,
        source_title: c.source_title,
        section: c.pair.section,
        question: c.pair.question,
        answer: c.pair.answer,
      }));

    return {
      question_id: question.id,
      draft_answer: parsed.draft_answer,
      confidence: parsed.confidence,
      citations,
      needs_review_note: parsed.needs_review_note,
    };
  } catch (err) {
    return {
      question_id: question.id,
      draft_answer: '',
      confidence: 'low',
      citations: [],
      needs_review_note:
        err instanceof Error
          ? `Generation error: ${err.message}`
          : 'Generation error',
    };
  }
}

/**
 * Bulk draft answers for all unanswered questions in a fill job. Runs with
 * a small concurrency cap to keep API pressure reasonable on larger RFPs.
 */
export async function draftAllAnswers(
  questions: ExtractedQuestion[],
  concurrency = 4
): Promise<DraftAnswer[]> {
  const results: DraftAnswer[] = new Array(questions.length);

  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= questions.length) return;
      results[i] = await draftAnswer(questions[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, questions.length) }, worker);
  await Promise.all(workers);
  return results;
}
