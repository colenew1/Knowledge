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

import * as XLSX from 'xlsx';
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

function extractFromRegion(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  region: StructureRegion
): ExtractedQuestion[] {
  const out: ExtractedQuestion[] = [];

  for (let r = region.start_row; r <= region.end_row; r++) {
    const question = cellText(sheet, r, region.question_col);
    if (!looksLikeQuestion(question)) continue;

    const existing = cellText(sheet, r, region.answer_col);

    const id = `${sheetName}!${region.section}!${r}_${region.question_col}`;
    out.push({
      id,
      sheet: sheetName,
      section: region.section,
      question,
      row: r,
      col: region.question_col,
      answer_row: r,
      answer_col: region.answer_col,
      existing_answer: existing || null,
      allowed_values: region.allowed_values,
    });
  }

  return out;
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
