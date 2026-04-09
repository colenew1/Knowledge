/**
 * Deterministic question extraction using a StructurePlan.
 *
 * Given the workbook buffer and the plan Claude produced, pull out the raw
 * cell text at each (question_col, row) and the existing answer cell contents
 * at (answer_col, row). Returns a flat list of ExtractedQuestion records that
 * can be persisted and then fed to the answer-generation pipeline.
 *
 * Two extraction modes share this code:
 *   1. KB ingest — called on a past, completed RFP. All rows where the
 *      answer cell is non-empty become Q&A pairs for the knowledge base.
 *   2. Fill job — called on a new RFP. Rows where the answer cell is empty
 *      become questions to draft; rows where it's already filled are skipped
 *      (we never overwrite a human answer).
 */

import * as XLSX from 'xlsx-js-style';
import type {
  ExtractedQuestion,
  StructurePlan,
  StructureRegion,
} from '@/lib/types';

function cellText(sheet: XLSX.WorkSheet, r: number, c: number): string {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = sheet[addr];
  if (!cell) return '';
  const raw = cell.w ?? cell.v;
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
}

function looksLikeQuestion(s: string): boolean {
  const t = s.trim();
  if (t.length < 6) return false;
  // All-caps short labels like "STAFF", "OUTAGES", "COMPANY BACKGROUND".
  // Don't filter longer all-caps since legitimate "BUSINESS REQUIREMENTS"
  // style headers might be legit questions.
  if (t.length < 40 && t === t.toUpperCase() && !/[?.,]/.test(t)) {
    return false;
  }
  return true;
}

/**
 * Find the last row in the sheet where either the question_col OR the
 * answer_col has content. Used to extend Claude's reported end_row when the
 * snapshot was truncated and Claude couldn't see the real tail of the data.
 */
function findLastDataRow(
  sheet: XLSX.WorkSheet,
  region: StructureRegion
): number {
  const ref = sheet['!ref'];
  if (!ref) return region.end_row;
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.e.r; r >= region.start_row; r--) {
    if (
      cellText(sheet, r, region.question_col) ||
      cellText(sheet, r, region.answer_col)
    ) {
      return r;
    }
  }
  return region.end_row;
}

function extractWithColumns(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  region: StructureRegion,
  questionCol: number,
  answerCol: number,
  effectiveEnd: number
): ExtractedQuestion[] {
  const out: ExtractedQuestion[] = [];
  for (let r = region.start_row; r <= effectiveEnd; r++) {
    const question = cellText(sheet, r, questionCol);
    if (!looksLikeQuestion(question)) continue;

    const existing = cellText(sheet, r, answerCol);

    const id = `${sheetName}!${region.section}!${r}_${questionCol}`;
    out.push({
      id,
      sheet: sheetName,
      section: region.section,
      question,
      row: r,
      col: questionCol,
      answer_row: r,
      answer_col: answerCol,
      existing_answer: existing || null,
      allowed_values: region.allowed_values,
    });
  }
  return out;
}

function extractFromRegion(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  region: StructureRegion
): ExtractedQuestion[] {
  // Extend the region to the last actual data row in the sheet. Claude's
  // snapshot is capped at ~40 rows, so its `end_row` can be too conservative
  // on long sheets. looksLikeQuestion() and the blank-cell check downstream
  // keep us from picking up junk past the real tail.
  const effectiveEnd = Math.max(
    region.end_row,
    findLastDataRow(sheet, region)
  );

  // First attempt: use the columns Claude reported verbatim.
  const primary = extractWithColumns(
    sheet,
    sheetName,
    region,
    region.question_col,
    region.answer_col,
    effectiveEnd
  );
  if (primary.length > 0) return primary;

  // Fallback: Claude sometimes normalizes indexes for sheets that start past
  // column A (e.g. returns 0/1 when the real data is at columns 1/2). If the
  // primary extraction returned nothing, try sliding the column pair by ±1
  // and ±2 while preserving the spacing Claude gave us. The first shift that
  // yields a meaningful number of questions wins.
  const spacing = region.answer_col - region.question_col;
  for (const shift of [1, 2, -1, -2]) {
    const qCol = region.question_col + shift;
    const aCol = qCol + spacing;
    if (qCol < 0 || aCol < 0) continue;
    const shifted = extractWithColumns(
      sheet,
      sheetName,
      region,
      qCol,
      aCol,
      effectiveEnd
    );
    if (shifted.length >= 3) return shifted;
  }

  return primary;
}

/**
 * Extract all questions across all sheets in the plan.
 * Returns every row that passes looksLikeQuestion, with existing_answer
 * populated if the answer cell already has content.
 */
export function extractAllQuestions(
  buffer: Buffer | ArrayBuffer,
  plan: StructurePlan
): ExtractedQuestion[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const out: ExtractedQuestion[] = [];

  for (const sheetPlan of plan.sheets) {
    if (!sheetPlan.is_qa_sheet) continue;
    const sheet = wb.Sheets[sheetPlan.sheet];
    if (!sheet) continue;

    for (const region of sheetPlan.regions) {
      out.push(...extractFromRegion(sheet, sheetPlan.sheet, region));
    }
  }

  return out;
}

/**
 * Filter extracted questions into the two subsets the downstream flows need.
 */
export function partitionQuestions(questions: ExtractedQuestion[]): {
  unanswered: ExtractedQuestion[];
  answered: ExtractedQuestion[];
} {
  const unanswered: ExtractedQuestion[] = [];
  const answered: ExtractedQuestion[] = [];
  for (const q of questions) {
    if (q.existing_answer && q.existing_answer.toLowerCase() !== 'n/a') {
      answered.push(q);
    } else {
      unanswered.push(q);
    }
  }
  return { unanswered, answered };
}
