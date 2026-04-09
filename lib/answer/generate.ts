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
import type {
  AnswerMode,
  AnswerVerdict,
  Citation,
  ConsideredCandidate,
  DraftAnswer,
  ExtractedQuestion,
} from '@/lib/types';

// Bumped from 1200 → 3000 so long grounded responses (especially in infer
// mode where we may cite multiple candidates) aren't truncated mid-sentence.
const MAX_TOKENS = 3000;

type RawUsedCandidate = {
  index: number;
  /** Verbatim substrings from the candidate's prior_answer that were drawn on. */
  excerpts?: string[];
};

type RawResponse = {
  verdict?: AnswerVerdict;
  draft_answer: string;
  /** New, preferred shape — per-candidate excerpts for highlighting. */
  used_candidates?: RawUsedCandidate[];
  /** Legacy fallback. */
  used_candidate_indexes?: number[];
  confidence: 'high' | 'medium' | 'low';
  needs_review_note?: string;
};

function buildPrompt(
  section: string,
  question: string,
  candidates: ScoredPair[],
  allowedValues?: string[],
  mode: AnswerMode = 'strict'
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

  const modeBlock =
    mode === 'strict'
      ? `## Mode: STRICT

Use ONLY information directly present in the candidates. Do not invent facts, certifications, compliance claims, dates, numbers, or product capabilities that are not in the candidates. Do not extrapolate or combine unrelated material.

If the candidates do not meaningfully address the new question (no direct coverage, only tangential keyword overlap), set \`verdict\` to "no_info", leave \`draft_answer\` as a short one-sentence acknowledgement like "No prior response in the knowledge base covers this question.", set confidence to "low", and leave \`used_candidates\` empty. Do NOT try to piece something together in strict mode — that's what infer mode is for.

Otherwise set \`verdict\` to "answered" and draft the grounded response.`
      : `## Mode: INFER

There is no direct answer in the knowledge base for this question, and the user has explicitly asked you to make a best-effort inference from related material. You are allowed to:

- Combine information from multiple candidates that each cover part of the question.
- Generalize from related capabilities (e.g. if KB covers SOC2, you can reason about adjacent compliance frameworks the KB mentions).
- Extrapolate cautiously from documented policies and architectural patterns.

You must NOT:
- Invent specific certifications, customer names, numbers, dates, or SLA figures that aren't in the candidates.
- Fabricate compliance claims (HIPAA, PCI, FedRAMP, etc.) that aren't established in the candidates.

Do NOT add any "(inferred)" markers, caveats, or disclaimers inline in the draft_answer text — the UI already flags inferred drafts with a badge. Write the response as clean prose a reviewer could send as-is after validating. Instead, use \`needs_review_note\` to explicitly describe what you extrapolated from vs what was direct. Confidence should almost always be "low" or "medium" in this mode — "high" is only for inferences that are near-direct paraphrases of the candidates.

Always set \`verdict\` to "answered" in infer mode.`;

  return `You are drafting a vendor response for AmplifAI to a prospect RFP or security questionnaire.

AmplifAI is an AI-powered contact center performance enablement platform. It provides post-interaction automated QA, AI coaching, performance management, gamification, and speech/sentiment analytics. AmplifAI does NOT provide real-time agent assist.

Your job: draft a single vendor response to NEW_QUESTION, using the CANDIDATE prior Q&A pairs retrieved from AmplifAI's past RFP responses and security questionnaires.

${modeBlock}

<new_question>
  <section>${escapeXml(section)}</section>
  <text>${escapeXml(question)}</text>
</new_question>
${allowedBlock}
<candidates>
${candidateBlocks || '(no candidates — this question has no prior answer in the knowledge base)'}
</candidates>

Common instructions:
1. Identify which candidates are actually relevant to the new question (not just sharing keywords).
2. Draft a concise vendor response (2-5 sentences) in a professional tone. Write as AmplifAI speaking directly to the prospect. No greeting, no sign-off.
3. For each candidate you drew from, record it in \`used_candidates\` with:
   - \`index\`: the candidate's index number.
   - \`excerpts\`: 1-4 **exact verbatim substrings** copied character-for-character from that candidate's \`prior_answer\`. These are the specific passages you actually relied on — not paraphrases, not your own summaries. A reviewer will see these highlighted inside the full candidate text, so they must match exactly (including punctuation and capitalization). Keep each excerpt focused: a sentence or short phrase, not the whole paragraph.
4. Set confidence:
   - "high"   — candidates directly answer the question and you can write a grounded response with zero invention.
   - "medium" — candidates partially answer it; you had to generalize.
   - "low"    — candidates don't really cover it; you're guessing OR deliberately declining. Include a needs_review_note.
5. If allowed_values is specified, draft_answer must exactly match one of them.
6. No personalization tokens. Do not name other AmplifAI customers. Never fabricate security, compliance, or certification claims.

Respond with ONLY this JSON — no preamble, no markdown code fences:
{
  "verdict": "answered" | "no_info",
  "draft_answer": "...",
  "used_candidates": [
    { "index": 0, "excerpts": ["verbatim phrase from prior_answer", "another verbatim phrase"] },
    { "index": 2, "excerpts": ["..."] }
  ],
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
  const shortlist = await retrieveShortlist(question.question, 20);
  return draftAnswerWithCandidates(question, shortlist);
}

/**
 * Same as draftAnswer but with a pre-computed shortlist — useful when the
 * caller wants to bulk-retrieve once per job for efficiency, though in
 * practice we shortlist per question to get the best candidates per query.
 */
export async function draftAnswerWithCandidates(
  question: ExtractedQuestion,
  candidates: ScoredPair[],
  mode: AnswerMode = 'strict'
): Promise<DraftAnswer> {
  const client = anthropic();
  const prompt = buildPrompt(
    question.section,
    question.question,
    candidates,
    question.allowed_values,
    mode
  );

  try {
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const parsed = parseJsonResponse<RawResponse>(message);

    // Prefer the new `used_candidates` shape (with excerpts); fall back to
    // the legacy index-only array if Claude returned that instead.
    const usedList: RawUsedCandidate[] = parsed.used_candidates?.length
      ? parsed.used_candidates
      : (parsed.used_candidate_indexes || []).map((index) => ({ index }));

    const excerptsByIdx = new Map<number, string[]>();
    for (const u of usedList) {
      if (typeof u.index !== 'number') continue;
      excerptsByIdx.set(
        u.index,
        (u.excerpts || []).filter((e) => typeof e === 'string' && e.trim())
      );
    }
    const usedIdxSet = new Set(excerptsByIdx.keys());

    const toCitation = (c: ScoredPair, excerpts?: string[]): Citation => ({
      source_id: c.pair.source_id,
      source_title: c.source_title,
      section: c.pair.section,
      question: c.pair.question,
      answer: c.pair.answer,
      excerpts,
    });

    const citations: Citation[] = Array.from(usedIdxSet)
      .map((idx) => {
        const c = candidates[idx];
        return c ? toCitation(c, excerptsByIdx.get(idx)) : null;
      })
      .filter((c): c is Citation => Boolean(c));

    // Everything that was retrieved but not chosen — surfaced in the UI
    // under "Other considered sources" so reviewers can see what else
    // the retriever thought was relevant.
    const other_candidates: ConsideredCandidate[] = candidates
      .map((c, idx) => ({ c, idx }))
      .filter(({ idx }) => !usedIdxSet.has(idx))
      .map(({ c }) => ({ ...toCitation(c), score: c.score }));

    return {
      question_id: question.id,
      draft_answer: parsed.draft_answer,
      confidence: parsed.confidence,
      citations,
      other_candidates,
      needs_review_note: parsed.needs_review_note,
      verdict: parsed.verdict ?? 'answered',
      mode,
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
      verdict: 'no_info',
      mode,
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
