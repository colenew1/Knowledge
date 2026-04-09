/**
 * Extract Q&A pairs from a PDF policy / SLA / SOC 2 / whitepaper.
 *
 * PDFs in the knowledge base are almost always narrative documents — a
 * support SLA, a security policy, a SOC 2 report, a whitepaper. Unlike
 * past-RFP xlsx/docx files, there are no pre-formed question/answer pairs
 * to extract. Retrieval still wants Q&A shaped rows, so we ask Claude to
 * **synthesize** questions a prospect might plausibly ask, each paired
 * with a grounded answer drawn verbatim from the document text.
 *
 * Pipeline:
 *   1. unpdf pulls the raw page text (works in Node + Vercel, unlike
 *      pdf-parse which breaks on bundlers).
 *   2. Long docs get chunked by character budget so each Claude call stays
 *      inside context.
 *   3. Claude produces { pairs: [{ section, question, answer }] } with a
 *      prompt that forbids invention and requires answers to be direct
 *      quotes (or very close paraphrases) of document content.
 */

import { extractText, getDocumentProxy } from 'unpdf';
import { anthropic, CLAUDE_MODEL, parseJsonResponse } from '@/lib/anthropic';

const MAX_TOKENS = 4000;
const CHUNK_CHAR_BUDGET = 8000;

export type PdfQaPair = {
  section: string;
  question: string;
  answer: string;
};

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  // unpdf occasionally returns an array when mergePages is ignored by the
  // underlying build; coerce defensively.
  return Array.isArray(text) ? text.join('\n') : text;
}

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_CHAR_BUDGET) return [text];

  const chunks: string[] = [];
  // Prefer paragraph breaks, but the unpdf output often arrives as one
  // long line per page, so fall back to sentence breaks if needed.
  const paragraphs = text.split(/\n\s*\n/);
  let current = '';
  for (const p of paragraphs) {
    if (current.length + p.length + 2 > CHUNK_CHAR_BUDGET && current) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n\n' : '') + p;
  }
  if (current) chunks.push(current);
  return chunks;
}

function buildSynthesisPrompt(text: string): string {
  return `You are reading a policy / SLA / security / whitepaper document that belongs to AmplifAI's knowledge base. A future RFP or security questionnaire may ask about topics this document covers. Your job is to generate a set of Q&A pairs so a downstream retrieval system can surface this document's facts when a prospect asks about them.

<document>
${text}
</document>

## What to produce

Generate between 5 and 25 Q&A pairs, one for each substantive factual claim in the document. Aim for coverage — if the document describes a table of severity levels with response times, produce one pair per severity level rather than one pair covering all of them.

### Question guidelines
- Write questions the way a prospect in a security questionnaire or RFP would phrase them. Examples: "What is AmplifAI's response SLA for critical incidents?" or "Does AmplifAI provide 24/7 technical support?"
- Each question must be answerable using only this document. Do not write questions the document doesn't answer.
- Vary phrasing. Don't write every question as "What is…"; use "Does…", "How…", "Within what timeframe…", "What severity level…".

### Answer guidelines
- Answers must be grounded in the document text. Prefer direct quotes where possible. If you paraphrase, stay extremely close to the original wording — do not invent numbers, timeframes, or capabilities.
- Answers should be 1–4 sentences. Long enough to be useful, short enough to be readable.
- Do NOT add disclaimers, marketing copy, or cross-references to other AmplifAI documents. Only use what's in this document.

### Section labels
- Assign each pair a short \`section\` label describing which part of the document it came from. Use the document's visible headings if present (e.g. "Technical Support", "Severity Levels"), or invent a concise topic label if the document has no headings.

## Output format

Respond with ONLY this JSON — no preamble, no markdown code fences:

{
  "pairs": [
    {
      "section": "Severity Levels",
      "question": "What is the expected resolution time for severity 1 incidents?",
      "answer": "Severity 1 issues are expected to be resolved within 4 hours."
    }
  ]
}`;
}

async function synthesizeChunk(text: string): Promise<PdfQaPair[]> {
  const client = anthropic();
  const prompt = buildSynthesisPrompt(text);

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  const parsed = parseJsonResponse<{ pairs?: PdfQaPair[] }>(message);
  return (parsed.pairs || []).filter(
    (p) => p.question?.trim() && p.answer?.trim()
  );
}

/**
 * Top-level entry point. Parse a PDF buffer and synthesize Q&A pairs
 * covering its factual content.
 */
export async function extractQaPairsFromPdf(
  buffer: Buffer
): Promise<PdfQaPair[]> {
  const text = await extractPdfText(buffer);
  if (!text.trim()) return [];

  const chunks = chunkText(text);
  const results: PdfQaPair[] = [];
  for (const chunk of chunks) {
    const pairs = await synthesizeChunk(chunk);
    results.push(...pairs);
  }
  return results;
}
