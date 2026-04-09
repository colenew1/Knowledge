/**
 * Write drafted answers back into the original xlsx buffer.
 *
 * Strategy:
 * - Read the original buffer with SheetJS.
 * - For each draft answer, write the text into the question's answer_row/col.
 * - Add a helper "AI Review Notes" column immediately to the right of the
 *   answer column so the reviewer can see confidence + short citation inline.
 *   The reviewer is expected to delete this column before sending the xlsx
 *   to the prospect.
 * - Preserve everything else (formatting, other sheets, formulas) by not
 *   touching cells we don't explicitly write.
 *
 * Known limitations documented in the README:
 * - If the answer column is inside a merged range, we still write the top-
 *   left cell but the helper column might land inside formatting oddness.
 * - If the answer column has dropdown data-validation we try to respect
 *   allowed_values at generation time, but SheetJS doesn't expose validation
 *   rules so we can't verify post-write.
 */

import * as XLSX from 'xlsx';
import type { DraftAnswer, ExtractedQuestion } from '@/lib/types';

const REVIEW_COL_HEADER = 'AI Review Notes';

/**
 * Write answers back into the workbook and return a fresh xlsx buffer.
 */
export function writeAnswersToWorkbook(
  originalBuffer: Buffer | ArrayBuffer,
  questions: ExtractedQuestion[],
  answers: DraftAnswer[]
): Buffer {
  const wb = XLSX.read(originalBuffer, { type: 'buffer' });

  const answerById = new Map(answers.map((a) => [a.question_id, a]));

  // Group questions by sheet so we only widen each sheet's range once.
  const bySheet = new Map<string, ExtractedQuestion[]>();
  for (const q of questions) {
    if (!bySheet.has(q.sheet)) bySheet.set(q.sheet, []);
    bySheet.get(q.sheet)!.push(q);
  }

  for (const [sheetName, sheetQuestions] of bySheet.entries()) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;

    const currentRef = sheet['!ref'];
    if (!currentRef) continue;
    const range = XLSX.utils.decode_range(currentRef);

    // Figure out the furthest-right answer column so the helper review
    // column sits immediately past the widest answer.
    const reviewCol = Math.max(
      ...sheetQuestions.map((q) => q.answer_col + 1),
      range.e.c + 1
    );

    // Add the header cell for the review column.
    const headerRow = Math.max(0, range.s.r);
    const headerAddr = XLSX.utils.encode_cell({ r: headerRow, c: reviewCol });
    if (!sheet[headerAddr]) {
      sheet[headerAddr] = { t: 's', v: REVIEW_COL_HEADER, w: REVIEW_COL_HEADER };
    }

    for (const q of sheetQuestions) {
      // Never overwrite an existing human-filled answer.
      if (q.existing_answer && q.existing_answer.toLowerCase() !== 'n/a') continue;

      const draft = answerById.get(q.id);
      if (!draft || !draft.draft_answer) continue;

      const answerAddr = XLSX.utils.encode_cell({
        r: q.answer_row,
        c: q.answer_col,
      });
      sheet[answerAddr] = {
        t: 's',
        v: draft.draft_answer,
        w: draft.draft_answer,
      };

      // Helper review note in the adjacent column on the same row.
      const reviewAddr = XLSX.utils.encode_cell({
        r: q.answer_row,
        c: reviewCol,
      });
      const noteParts = [draft.confidence.toUpperCase()];
      if (draft.needs_review_note) {
        noteParts.push(`NEEDS REVIEW: ${draft.needs_review_note}`);
      }
      if (draft.citations.length > 0) {
        const firstCite = draft.citations[0];
        noteParts.push(
          `source: ${firstCite.source_title}${firstCite.section ? ` — ${firstCite.section}` : ''}`
        );
      }
      const note = noteParts.join(' · ');
      sheet[reviewAddr] = { t: 's', v: note, w: note };
    }

    // Update the sheet range so writers/readers see the new cells.
    const newRange = {
      s: { r: range.s.r, c: range.s.c },
      e: {
        r: Math.max(range.e.r, ...sheetQuestions.map((q) => q.answer_row)),
        c: Math.max(range.e.c, reviewCol),
      },
    };
    sheet['!ref'] = XLSX.utils.encode_range(newRange);
  }

  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return out;
}
