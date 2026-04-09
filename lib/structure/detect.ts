/**
 * Structure detection: hand Claude a compact snapshot of each sheet and ask
 * it to identify the Q&A regions.
 *
 * Returns a StructurePlan with one SheetPlan per sheet in the workbook.
 * Boilerplate sheets return `is_qa_sheet: false` and are skipped downstream.
 *
 * Temperature is hard-zeroed everywhere in this app for reproducibility.
 */

import { anthropic, CLAUDE_MODEL, parseJsonResponse } from '@/lib/anthropic';
import { snapshotWorkbook, type SheetSnapshot } from './snapshot';
import type { StructurePlan, SheetPlan } from '@/lib/types';

const MAX_TOKENS = 2000;

function buildDetectionPrompt(snapshot: SheetSnapshot): string {
  return `You are analyzing a single worksheet from a vendor RFP/security questionnaire xlsx.

Your job is to identify the Q&A layout of the sheet so a downstream program can extract questions and fill in answers at the correct cells.

<sheet name="${snapshot.sheet}" total_rows="${snapshot.rows}" total_cols="${snapshot.cols}">
${snapshot.cells
  .map((c) => `  (r=${c.r}, c=${c.c}): ${JSON.stringify(c.v)}`)
  .join('\n')}
</sheet>

<merged_ranges>
${snapshot.merges.length ? snapshot.merges.join(', ') : '(none)'}
</merged_ranges>

## What to produce

Decide whether this sheet contains vendor-answered questions. Common layouts:

1. **vertical** — one column holds questions (e.g. "REQUIREMENTS" or "QUESTIONS" or "Question"), another column holds vendor responses (e.g. "VENDOR RESPONSE", "Response", "Answer"). Data flows top-to-bottom.
2. **horizontal_pages** — a sheet laid out in blocks left-to-right where each block is a sub-section with its own question and answer columns (e.g. "Exhibit A" workbooks where Page 1, Page 2, Page 3… sit side by side in columns 0-3, 4-7, 8-11…).
3. **boilerplate** — instructions, terms of participation, message center, pricing-only sheets, contact info forms. No vendor-answered questions. Mark is_qa_sheet=false and explain.

Row/column indexes are 0-based and refer to the full sheet (not just the snapshot).

**IMPORTANT**: The snapshot above shows only the FIRST ~40 rows of the sheet. The full sheet has \`total_rows\` rows. If the Q&A data clearly continues past the visible snapshot (same columns, same pattern), set \`end_row\` to \`total_rows - 1\`. A downstream program will trim blank/non-question rows automatically — your job is to set a generous upper bound, not a precise one.

Identify one or more "regions". Each region describes a contiguous vertical range of Q&A rows in a specific pair of (question_col, answer_col). \`start_row\` is the first row with an actual question (skip header rows). \`end_row\` is the last possible data row — default to \`total_rows - 1\` unless you can see a clear terminator inside the snapshot.

If a sheet has a dropdown validation (e.g. answer must be "Yes" / "No" / "OOB" / "Configurable" / "Not Supported"), include it as allowed_values on that region. Infer from headers or sibling columns if possible.

Give each region a short human-friendly \`section\` label. Use the sheet name or nearby sub-section headers.

## Output format

Respond with ONLY this JSON, no preamble, no markdown fences:

{
  "is_qa_sheet": true | false,
  "reason": "short explanation if is_qa_sheet is false, otherwise omit",
  "regions": [
    {
      "section": "short label",
      "question_col": 0,
      "answer_col": 1,
      "start_row": 5,
      "end_row": 42,
      "allowed_values": ["Yes", "No"]  // optional, omit if not a dropdown
    }
  ]
}`;
}

async function detectSheet(snapshot: SheetSnapshot): Promise<SheetPlan> {
  // Truly empty sheets are boilerplate by definition.
  if (snapshot.cells.length === 0) {
    return {
      sheet: snapshot.sheet,
      is_qa_sheet: false,
      reason: 'empty sheet',
      regions: [],
    };
  }

  const client = anthropic();
  const prompt = buildDetectionPrompt(snapshot);

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  type Raw = {
    is_qa_sheet: boolean;
    reason?: string;
    regions?: Array<{
      section?: string;
      question_col: number;
      answer_col: number;
      start_row: number;
      end_row: number;
      allowed_values?: string[];
    }>;
  };

  const parsed = parseJsonResponse<Raw>(message);

  return {
    sheet: snapshot.sheet,
    is_qa_sheet: Boolean(parsed.is_qa_sheet),
    reason: parsed.reason,
    regions: (parsed.regions || []).map((r) => ({
      section: r.section || snapshot.sheet,
      question_col: r.question_col,
      answer_col: r.answer_col,
      start_row: r.start_row,
      end_row: r.end_row,
      allowed_values: r.allowed_values,
    })),
  };
}

/**
 * Detect structure for every sheet in the workbook. Runs in parallel —
 * Anthropic's SDK handles concurrent requests fine and sheet counts are
 * small (typically <10).
 */
export async function detectStructure(
  buffer: Buffer | ArrayBuffer
): Promise<StructurePlan> {
  const snapshots = snapshotWorkbook(buffer);
  const sheets = await Promise.all(snapshots.map(detectSheet));
  return { sheets };
}
