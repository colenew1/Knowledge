/**
 * Shared types for RFP Knowledge Base.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Structure detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A "region" of a sheet containing Q&A rows.
 *
 * - Simple vertical layouts produce one region per sheet.
 * - Horizontal-pages layouts (like the Exhibit A-D workbook where sub-sections
 *   are laid out left-to-right) produce multiple regions per sheet, each
 *   pointing at a different pair of question/answer columns.
 * - Boilerplate sheets (Instructions, Terms, Message Center) produce zero
 *   regions and are skipped entirely.
 *
 * Row/column indexes are 0-based.
 */
export type StructureRegion = {
  section: string;            // Human-friendly label for this region
  question_col: number;       // Column containing the question text
  answer_col: number;         // Column where the vendor response goes
  start_row: number;          // First data row (inclusive)
  end_row: number;            // Last data row (inclusive)
  /** Optional: allowed values when the answer column is a dropdown-validated cell. */
  allowed_values?: string[];
};

export type SheetPlan = {
  sheet: string;
  is_qa_sheet: boolean;
  reason?: string;            // If not a Q&A sheet, short explanation
  regions: StructureRegion[];
};

export type StructurePlan = {
  sheets: SheetPlan[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Extracted questions
// ─────────────────────────────────────────────────────────────────────────────

export type ExtractedQuestion = {
  id: string;                 // Stable id (sheet + row + col), used as row key
  sheet: string;
  section: string;
  question: string;
  row: number;                // Row of the question cell
  col: number;                // Column of the question cell
  answer_row: number;         // Row to write the answer into (usually same as row)
  answer_col: number;
  existing_answer: string | null; // If the cell already has content, we show and skip
  allowed_values?: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge base pairs
// ─────────────────────────────────────────────────────────────────────────────

export type KbPair = {
  id: string;
  source_id: string;
  section: string | null;
  question: string;
  answer: string;
  tokens: string[];
  created_at: string;
};

export type KbSource = {
  id: string;
  title: string;
  filename: string | null;
  source_type: 'past_rfp' | 'sig' | 'caiq' | 'soc2' | 'policy' | 'manual' | 'other';
  structure_plan: StructurePlan | null;
  notes: string | null;
  created_at: string;
  pair_count?: number;        // Computed on list
};

// ─────────────────────────────────────────────────────────────────────────────
// Draft answers
// ─────────────────────────────────────────────────────────────────────────────

export type Citation = {
  source_id: string;
  source_title: string;
  section: string | null;
  question: string;
  answer: string;
};

/**
 * Answer generation mode.
 * - `strict` — only answer if the candidates cover the question. Otherwise
 *   return `verdict: 'no_info'` so the UI can offer to fall back to infer.
 * - `infer`  — allowed to combine/extrapolate from related KB material. Must
 *   flag inferred claims inline and cite the sources it drew from.
 */
export type AnswerMode = 'strict' | 'infer';

export type AnswerVerdict = 'answered' | 'no_info';

export type DraftAnswer = {
  question_id: string;
  draft_answer: string;
  confidence: 'high' | 'medium' | 'low';
  citations: Citation[];
  needs_review_note?: string;
  /** Only populated by the ask endpoint. Fill-job drafts leave this undefined. */
  verdict?: AnswerVerdict;
  /** Echoes the mode the draft was produced under (ask endpoint only). */
  mode?: AnswerMode;
  /** True if a reviewer has hand-edited this draft via the review workspace. */
  edited?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Fill jobs
// ─────────────────────────────────────────────────────────────────────────────

export type FillJobStatus =
  | 'pending'
  | 'planning'
  | 'ready_to_generate'
  | 'generating'
  | 'ready'
  | 'error';

export type FillJob = {
  id: string;
  title: string;
  filename: string | null;
  original_xlsx_b64: string;
  structure_plan: StructurePlan | null;
  questions: ExtractedQuestion[];
  answers: DraftAnswer[];
  status: FillJobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  generated_at: string | null;
};
