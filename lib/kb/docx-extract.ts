/**
 * Extract Q&A pairs from a .docx past-response or vendor questionnaire.
 *
 * Strategy:
 *   1. mammoth pulls raw text out of the docx, preserving paragraph breaks
 *      so the line ordering mirrors the reading order of the document.
 *   2. We hand the flat line list to Claude with a prompt that asks it to
 *      identify section headers, question paragraphs, and the vendor answer
 *      that immediately follows each question.
 *   3. Claude returns a JSON array of { section, question, answer } objects.
 *      Pairs with empty answers (like the trailing "To be filled out by the
 *      client" section in many questionnaires) are filtered out.
 *
 * Long documents are chunked: we split by detected section headers when the
 * raw line count pushes us past ~8k chars in a single prompt, so each chunk
 * stays comfortably inside Claude's context without the response blowing
 * past MAX_TOKENS.
 */

import mammoth from 'mammoth';
import { anthropic, CLAUDE_MODEL, parseJsonResponse } from '@/lib/anthropic';

const MAX_TOKENS = 4000;
const CHUNK_CHAR_BUDGET = 8000;

export type DocxQaPair = {
  section: string;
  question: string;
  answer: string;
};

/**
 * Pull numbered lines out of a .docx. Blank lines are dropped so the line
 * numbers Claude sees map cleanly to the non-empty paragraph sequence, but
 * we keep the original indexing for debugging.
 */
async function extractLines(buffer: Buffer): Promise<string[]> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Split lines into chunks that each stay below CHUNK_CHAR_BUDGET. We break
 * only between lines so a question and its answer never cross a chunk
 * boundary (assuming the answer immediately follows the question, which is
 * the contract for this extraction strategy).
 */
function chunkLines(lines: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const line of lines) {
    const lineCost = line.length + 8; // +8 for index prefix and newline
    if (currentChars + lineCost > CHUNK_CHAR_BUDGET && current.length > 0) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(line);
    currentChars += lineCost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function buildExtractionPrompt(lines: string[]): string {
  const numbered = lines
    .map((l, i) => `${i.toString().padStart(4, ' ')}: ${l}`)
    .join('\n');

  return `You are extracting Q&A pairs from a past vendor security questionnaire / RFP response that was originally a Word document.

The document is represented below as a numbered list of non-empty paragraphs in reading order. Each line is either:
- A section header (short label, often title-cased, e.g. "Authentication Questions", "Data Collection Storage Questions", "Vendor Policies, Standards, and Business Practices")
- A question (usually a full sentence ending in "?" or starting with "Please describe / Please provide / Does the vendor / Will the…")
- An answer (the vendor's response, typically directly after the question line)
- Boilerplate (title page, legal notice, "What is it?" intro paragraphs, instructions)

Your job: return every real question the vendor answered, along with the section it was under and the vendor's answer text.

<document>
${numbered}
</document>

## Rules

1. **Section assignment**: use the most recent section header that appears before the question. If no section header has appeared yet, use "General".
2. **Question text**: take the full text of the question paragraph. If a question spans multiple consecutive lines (rare), concatenate them with a space.
3. **Answer text**: the line or lines that immediately follow the question, up until the next question or section header. Concatenate multiple-line answers with a space.
4. **Skip boilerplate**: title page, "What is it?" blurbs, cover page contact info, tables of contents, instructions to the reviewer. Only emit rows that are genuine vendor-answered questions.
5. **Skip blank-answer sections**: many questionnaires have a trailing "To be filled out by Zillow" / "Internal Use Only" section where the answers are empty because the vendor wasn't supposed to fill them. Do NOT emit those — if a question has no visible vendor answer, omit the pair entirely.
6. **Do not invent answers**. If the document shows a question with no answer text after it, skip it. Do not fabricate, paraphrase, or write "N/A" yourself.
7. **Preserve answer text verbatim**. Do not summarize or shorten. Copy the vendor's response exactly as it appears in the document.

## Output format

Respond with ONLY a JSON object of this shape — no preamble, no markdown code fences:

{
  "pairs": [
    {
      "section": "Authentication Questions",
      "question": "Does the application or service support Single Sign-On (SSO) via OATH, SAML, OKTA, or equivalent integration providers?",
      "answer": "OATH, SAML"
    }
  ]
}`;
}

async function extractChunk(lines: string[]): Promise<DocxQaPair[]> {
  const client = anthropic();
  const prompt = buildExtractionPrompt(lines);

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  const parsed = parseJsonResponse<{ pairs?: DocxQaPair[] }>(message);
  return (parsed.pairs || []).filter(
    (p) => p.question?.trim() && p.answer?.trim()
  );
}

/**
 * Top-level entry point. Parse the docx buffer and return every clean Q&A
 * pair we can find.
 */
export async function extractQaPairsFromDocx(
  buffer: Buffer
): Promise<DocxQaPair[]> {
  const lines = await extractLines(buffer);
  if (lines.length === 0) return [];

  const chunks = chunkLines(lines);
  const results: DocxQaPair[] = [];
  for (const chunk of chunks) {
    const pairs = await extractChunk(chunk);
    results.push(...pairs);
  }
  return results;
}
