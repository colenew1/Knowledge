/**
 * Build a compact snapshot of an xlsx workbook that can be handed to Claude
 * for structure detection.
 *
 * Goals:
 * - Small enough to fit comfortably in context for 10+ sheets
 * - Rich enough that Claude can identify the Q&A layout (row+col grid with
 *   truncated cell values + merged ranges)
 */

import * as XLSX from 'xlsx-js-style';

export type SheetSnapshot = {
  sheet: string;
  rows: number;
  cols: number;
  /** Subset of cells shown to Claude; values truncated. */
  cells: Array<{ r: number; c: number; v: string }>;
  /** Merged cell ranges, if any, as "A1:B2" style refs. */
  merges: string[];
  /**
   * Absolute column indexes that contain at least one non-empty cell within
   * the snapshot. Used to force Claude to pick real column indexes instead of
   * normalizing to zero when a sheet's data starts past column A.
   */
  populated_cols: number[];
};

const MAX_ROWS_PER_SHEET = 40;
const MAX_CELL_CHARS = 140;

function truncate(s: string): string {
  if (s.length <= MAX_CELL_CHARS) return s;
  return s.slice(0, MAX_CELL_CHARS - 1) + '…';
}

export function snapshotWorkbook(buffer: Buffer | ArrayBuffer): SheetSnapshot[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const out: SheetSnapshot[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;

    const ref = sheet['!ref'];
    if (!ref) {
      out.push({ sheet: sheetName, rows: 0, cols: 0, cells: [], merges: [], populated_cols: [] });
      continue;
    }
    const range = XLSX.utils.decode_range(ref);
    const totalRows = range.e.r - range.s.r + 1;
    const totalCols = range.e.c - range.s.c + 1;

    const maxRow = Math.min(range.e.r, range.s.r + MAX_ROWS_PER_SHEET - 1);

    const cells: Array<{ r: number; c: number; v: string }> = [];
    for (let r = range.s.r; r <= maxRow; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        if (!cell) continue;
        const raw = cell.w ?? cell.v;
        if (raw === undefined || raw === null || raw === '') continue;
        cells.push({ r, c, v: truncate(String(raw)).trim() });
      }
    }

    const merges = (sheet['!merges'] || []).map((m) =>
      XLSX.utils.encode_range(m)
    );

    const populated_cols = Array.from(
      new Set(cells.map((c) => c.c))
    ).sort((a, b) => a - b);

    out.push({
      sheet: sheetName,
      rows: totalRows,
      cols: totalCols,
      cells,
      merges,
      populated_cols,
    });
  }

  return out;
}
