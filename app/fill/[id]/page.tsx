'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DraftAnswer, ExtractedQuestion, FillJob } from '@/lib/types';
import { shouldShowCitationQuestion } from '@/lib/citation-helpers';

const STATUS_LABEL: Record<FillJob['status'], string> = {
  pending: 'Pending',
  planning: 'Detecting structure…',
  ready_to_generate: 'Ready to generate',
  generating: 'Generating drafts…',
  ready: 'Ready to review',
  error: 'Error',
};

const CONFIDENCE_STYLE: Record<DraftAnswer['confidence'], string> = {
  high: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-red-50 text-red-700 border-red-200',
};

export default function FillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [job, setJob] = useState<FillJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/fill/${id}`);
    const data = await res.json();
    if (res.ok) setJob(data.job);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  async function runPlan() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/fill/${id}/plan`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Planning failed');
      setJob(data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planning failed');
    } finally {
      setBusy(false);
    }
  }

  async function runGenerate() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/fill/${id}/generate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setJob(data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  // Replace a single draft in local state without refetching.
  const replaceDraft = useCallback((updated: DraftAnswer) => {
    setJob((prev) => {
      if (!prev) return prev;
      const nextAnswers = [...(prev.answers || [])];
      const idx = nextAnswers.findIndex(
        (a) => a.question_id === updated.question_id
      );
      if (idx === -1) nextAnswers.push(updated);
      else nextAnswers[idx] = updated;
      return { ...prev, answers: nextAnswers };
    });
  }, []);

  const questions = job?.questions || [];
  const answers = job?.answers || [];

  const answerById = useMemo(() => {
    const map = new Map<string, DraftAnswer>();
    answers.forEach((a) => map.set(a.question_id, a));
    return map;
  }, [answers]);

  // Group questions by sheet, preserving discovery order and sorting by row.
  const sheetGroups = useMemo(() => {
    const order: string[] = [];
    const groups = new Map<string, ExtractedQuestion[]>();
    for (const q of questions) {
      if (!groups.has(q.sheet)) {
        groups.set(q.sheet, []);
        order.push(q.sheet);
      }
      groups.get(q.sheet)!.push(q);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.row - b.row);
    }
    return order.map((sheet) => ({ sheet, rows: groups.get(sheet)! }));
  }, [questions]);

  // Pick a default active tab once the job loads.
  useEffect(() => {
    if (!activeSheet && sheetGroups.length > 0) {
      setActiveSheet(sheetGroups[0].sheet);
    }
  }, [sheetGroups, activeSheet]);

  const counts = useMemo(() => {
    let high = 0;
    let review = 0;
    let noInfo = 0;
    let edited = 0;
    for (const a of answers) {
      if (a.verdict === 'no_info') noInfo++;
      else if (a.confidence === 'high') high++;
      else review++;
      if (a.edited) edited++;
    }
    return { total: answers.length, high, review, noInfo, edited };
  }, [answers]);

  if (loading || !id) {
    return <p className="text-sm text-stone-500">Loading…</p>;
  }
  if (!job) {
    return (
      <div>
        <p className="text-sm text-stone-500">Job not found.</p>
        <Link href="/fill" className="text-sm text-stone-700 hover:underline">
          ← Back to fill jobs
        </Link>
      </div>
    );
  }

  const activeGroup = sheetGroups.find((g) => g.sheet === activeSheet);
  const preAnsweredCount = questions.filter((q) => q.existing_answer).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/fill" className="text-sm text-stone-600 hover:underline">
          ← All fill jobs
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{job.title}</h1>
        {job.filename && <p className="text-sm text-stone-500">{job.filename}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-sm">
          Status: <span className="font-medium">{STATUS_LABEL[job.status]}</span>
        </div>
        {questions.length > 0 && (
          <div className="text-sm text-stone-600">
            {questions.length} questions · {preAnsweredCount} pre-answered · {' '}
            {questions.length - preAnsweredCount} to draft
          </div>
        )}
        {counts.total > 0 && (
          <div className="text-sm text-stone-600">
            {counts.high} high · {counts.review} need review · {counts.noInfo} no match
            {counts.edited > 0 && ` · ${counts.edited} edited`}
          </div>
        )}
        {job.error_message && (
          <div className="text-sm text-red-600">{job.error_message}</div>
        )}
        <div className="ml-auto flex gap-2">
          <button
            onClick={runPlan}
            disabled={busy}
            className="rounded border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            {busy
              ? 'Working…'
              : job.structure_plan
                ? 'Re-detect structure'
                : 'Detect structure'}
          </button>
          {(job.status === 'ready_to_generate' || job.status === 'ready') && (
            <button
              onClick={runGenerate}
              disabled={busy}
              className="rounded border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
            >
              {busy
                ? 'Generating…'
                : job.status === 'ready'
                  ? 'Re-generate all'
                  : 'Generate drafts'}
            </button>
          )}
          {job.status === 'ready' && (
            <a
              href={`/api/fill/${job.id}/download`}
              className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
            >
              Download xlsx
            </a>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {job.structure_plan && (
        <details className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <summary className="cursor-pointer font-medium text-stone-700">
            Structure detection results ({job.structure_plan.sheets.length} sheets)
          </summary>
          <div className="mt-3 space-y-2">
            {job.structure_plan.sheets.map((s) => (
              <div
                key={s.sheet}
                className="rounded border border-stone-100 bg-stone-50 p-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-stone-800">{s.sheet}</span>
                  <span
                    className={
                      s.is_qa_sheet
                        ? 'rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700'
                        : 'rounded border border-stone-300 bg-white px-2 py-0.5 text-stone-500'
                    }
                  >
                    {s.is_qa_sheet ? 'Q&A sheet' : 'skipped'}
                  </span>
                </div>
                {!s.is_qa_sheet && s.reason && (
                  <div className="mt-1 text-stone-500">Reason: {s.reason}</div>
                )}
                {s.is_qa_sheet && s.regions.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-stone-600">
                    {s.regions.map((r, i) => (
                      <li key={i}>
                        {r.section} — question col {r.question_col}, answer col{' '}
                        {r.answer_col}, rows {r.start_row}-{r.end_row}
                      </li>
                    ))}
                  </ul>
                )}
                {s.is_qa_sheet && s.regions.length === 0 && (
                  <div className="mt-1 text-amber-700">
                    Marked as Q&A but no regions detected.
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {job.status !== 'pending' &&
        job.status !== 'planning' &&
        questions.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Structure detection ran but found no question rows. This usually
            means the workbook has no recognizable Q&amp;A layout, or every
            sheet was classified as boilerplate. Try <button
              onClick={runPlan}
              className="underline"
              disabled={busy}
            >re-detecting structure</button>, or check that you uploaded the
            blank RFP (not the already-filled version).
          </div>
        )}

      {sheetGroups.length > 0 && (
        <div className="border-b border-stone-200">
          <nav className="-mb-px flex flex-wrap gap-1">
            {sheetGroups.map((g) => {
              const draftCount = g.rows.filter((q) => answerById.has(q.id)).length;
              const active = activeSheet === g.sheet;
              return (
                <button
                  key={g.sheet}
                  onClick={() => setActiveSheet(g.sheet)}
                  className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
                    active
                      ? 'border-stone-900 text-stone-900'
                      : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-700'
                  }`}
                >
                  {g.sheet}
                  <span className="ml-2 text-xs text-stone-400">
                    {draftCount}/{g.rows.length}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {activeGroup && (
        <div className="space-y-3">
          {activeGroup.rows.map((q) => {
            const draft = answerById.get(q.id);
            return (
              <RowCard
                key={q.id}
                jobId={id}
                question={q}
                draft={draft}
                onDraftChange={replaceDraft}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function RowCard({
  jobId,
  question,
  draft,
  onDraftChange,
}: {
  jobId: string;
  question: ExtractedQuestion;
  draft: DraftAnswer | undefined;
  onDraftChange: (draft: DraftAnswer) => void;
}) {
  // If the row was already answered in the source file we just display the
  // existing answer as a read-only pre-answered row.
  if (question.existing_answer) {
    return (
      <div className="flex gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4">
        <div className="w-10 shrink-0 text-xs font-medium text-stone-400">
          #{question.row + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-stone-400">
            {question.section} · already answered
          </div>
          <div className="mt-1 text-sm font-medium text-stone-700">
            {question.question}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-stone-500">
            {question.existing_answer}
          </p>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="flex gap-3 rounded-lg border border-dashed border-stone-300 bg-white p-4">
        <div className="w-10 shrink-0 text-xs font-medium text-stone-400">
          #{question.row + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-stone-500">
            {question.section}
          </div>
          <div className="mt-1 text-sm font-medium">{question.question}</div>
          <p className="mt-2 text-xs text-stone-500">
            Not yet drafted — click Generate drafts in the header.
          </p>
        </div>
      </div>
    );
  }

  return (
    <EditableRow
      jobId={jobId}
      question={question}
      draft={draft}
      onDraftChange={onDraftChange}
    />
  );
}

function EditableRow({
  jobId,
  question,
  draft,
  onDraftChange,
}: {
  jobId: string;
  question: ExtractedQuestion;
  draft: DraftAnswer;
  onDraftChange: (draft: DraftAnswer) => void;
}) {
  const [text, setText] = useState(draft.draft_answer);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle'
  );
  const [inferring, setInferring] = useState(false);
  const [preview, setPreview] = useState<DraftAnswer | null>(null);
  const savedRef = useRef(draft.draft_answer);

  useEffect(() => {
    setText(draft.draft_answer);
    savedRef.current = draft.draft_answer;
  }, [draft.draft_answer]);

  const isNoInfo = draft.verdict === 'no_info';
  const isEdited = Boolean(draft.edited);
  const isInferred = draft.mode === 'infer';

  // Color accent on the left border communicates status at a glance as the
  // reviewer scrolls through a long sheet.
  const borderAccent = isNoInfo
    ? 'border-l-4 border-l-red-400'
    : isInferred
      ? 'border-l-4 border-l-amber-400'
      : isEdited
        ? 'border-l-4 border-l-blue-400'
        : draft.confidence === 'high'
          ? 'border-l-4 border-l-emerald-400'
          : 'border-l-4 border-l-stone-200';

  async function handleBlur() {
    if (text === savedRef.current) return;
    setSaving('saving');
    try {
      const res = await fetch(`/api/fill/${jobId}/answer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: question.id, draft_answer: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      savedRef.current = text;
      onDraftChange(data.draft as DraftAnswer);
      setSaving('saved');
      setTimeout(() => setSaving('idle'), 1500);
    } catch {
      setSaving('error');
    }
  }

  async function handleTryInfer() {
    setInferring(true);
    try {
      const res = await fetch(`/api/fill/${jobId}/infer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: question.id, preview: true }),
      });
      const data = await res.json();
      if (res.ok) setPreview(data.draft as DraftAnswer);
    } finally {
      setInferring(false);
    }
  }

  async function confirmPreview() {
    if (!preview) return;
    setSaving('saving');
    try {
      // Persist the previewed inference by running infer non-preview, which
      // regenerates once more and writes. For now we take the simpler route:
      // patch the text into the existing row via /answer so it survives
      // downloads. We also carry forward the citations/mode via a dedicated
      // save call below.
      const res = await fetch(`/api/fill/${jobId}/answer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: question.id,
          draft_answer: preview.draft_answer,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      // Merge the previewed metadata (confidence, mode, citations, review
      // note) onto the saved row so the UI reflects the accepted inference.
      const merged: DraftAnswer = {
        ...(data.draft as DraftAnswer),
        confidence: preview.confidence,
        citations: preview.citations,
        other_candidates: preview.other_candidates,
        needs_review_note: preview.needs_review_note,
        mode: 'infer',
        verdict: 'answered',
      };
      onDraftChange(merged);
      setPreview(null);
      setSaving('saved');
      setTimeout(() => setSaving('idle'), 1500);
    } catch {
      setSaving('error');
    }
  }

  return (
    <div className={`rounded-lg border border-stone-200 bg-white p-4 ${borderAccent}`}>
      <div className="flex gap-3">
        <div className="w-10 shrink-0 text-xs font-medium text-stone-400">
          #{question.row + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wide text-stone-500">
                {question.section}
              </div>
              <div className="mt-1 text-sm font-medium text-stone-900">
                {question.question}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isEdited && (
                <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                  edited
                </span>
              )}
              {isInferred && (
                <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  inferred
                </span>
              )}
              <span
                className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CONFIDENCE_STYLE[draft.confidence]}`}
              >
                {draft.confidence}
              </span>
            </div>
          </div>

          {isNoInfo && !preview && (
            <p className="mt-2 rounded border border-stone-200 bg-stone-50 p-2 text-xs text-stone-700">
              No prior response in the knowledge base directly covers this
              question. Use Try inference to draw on related material, or
              type an answer manually below.
            </p>
          )}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleBlur}
            rows={Math.max(
              3,
              Math.min(
                40,
                text
                  .split('\n')
                  .reduce(
                    (n, line) => n + Math.max(1, Math.ceil(line.length / 80)),
                    0
                  ) + 1
              )
            )}
            className="mt-2 w-full rounded border border-stone-300 bg-white p-2 text-sm text-stone-800 focus:border-stone-500 focus:outline-none"
            placeholder="Draft answer — edits save automatically when you click away."
          />

          <div className="mt-1 flex items-center justify-between text-[11px] text-stone-500">
            <span>
              {saving === 'saving' && 'Saving…'}
              {saving === 'saved' && 'Saved'}
              {saving === 'error' && (
                <span className="text-red-600">Save failed — click out again to retry</span>
              )}
              {saving === 'idle' && 'Auto-saves on blur'}
            </span>
            <button
              onClick={handleTryInfer}
              disabled={inferring}
              className="rounded border border-stone-300 px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              {inferring ? 'Generating…' : 'Try inference'}
            </button>
          </div>

          {preview && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                  Inference preview
                </span>
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CONFIDENCE_STYLE[preview.confidence]}`}
                >
                  {preview.confidence}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-stone-800">
                {preview.draft_answer}
              </p>
              {preview.needs_review_note && (
                <p className="mt-2 text-xs text-amber-800">
                  {preview.needs_review_note}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={confirmPreview}
                  className="rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Confirm & apply
                </button>
                <button
                  onClick={() => setPreview(null)}
                  className="rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  Discard
                </button>
              </div>
              {preview.citations.length > 0 && (
                <details className="mt-2 text-[11px] text-stone-600" open>
                  <summary className="cursor-pointer">
                    {preview.citations.length} citation
                    {preview.citations.length === 1 ? '' : 's'} used
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {preview.citations.map((c, i) => (
                      <li
                        key={i}
                        className="rounded border border-emerald-100 bg-white p-2"
                      >
                        <div className="font-medium text-stone-800">
                          {c.source_title}
                          {c.section ? ` — ${c.section}` : ''}
                        </div>
                        {shouldShowCitationQuestion(c) && (
                          <div className="mt-1 whitespace-pre-wrap text-stone-700">
                            {c.question}
                          </div>
                        )}
                        <div className="mt-1 whitespace-pre-wrap text-stone-600">
                          {c.answer}
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {preview.other_candidates &&
                preview.other_candidates.length > 0 && (
                  <details className="mt-2 text-[11px] text-stone-600">
                    <summary className="cursor-pointer">
                      {preview.other_candidates.length} other considered source
                      {preview.other_candidates.length === 1 ? '' : 's'}
                    </summary>
                    <ul className="mt-2 space-y-2">
                      {preview.other_candidates.map((c, i) => (
                        <li key={i} className="rounded bg-white p-2">
                          <div className="font-medium text-stone-700">
                            {c.source_title}
                            {c.section ? ` — ${c.section}` : ''}
                          </div>
                          {shouldShowCitationQuestion(c) && (
                            <div className="mt-1 whitespace-pre-wrap text-stone-600">
                              {c.question}
                            </div>
                          )}
                          <div className="mt-1 whitespace-pre-wrap text-stone-500">
                            {c.answer}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
            </div>
          )}

          {draft.needs_review_note && !preview && (
            <p className="mt-2 text-[11px] text-amber-700">
              Review note: {draft.needs_review_note}
            </p>
          )}

          {draft.citations.length > 0 && !preview && (
            <details className="mt-2 text-[11px] text-stone-600">
              <summary className="cursor-pointer">
                {draft.citations.length} citation
                {draft.citations.length === 1 ? '' : 's'} used
              </summary>
              <ul className="mt-2 space-y-2">
                {draft.citations.map((c, i) => (
                  <li
                    key={i}
                    className="rounded border border-emerald-100 bg-emerald-50/50 p-2"
                  >
                    <div className="font-medium text-stone-800">
                      {c.source_title}
                      {c.section ? ` — ${c.section}` : ''}
                    </div>
                    {shouldShowCitationQuestion(c) && (
                      <div className="mt-1 whitespace-pre-wrap text-stone-700">
                        {c.question}
                      </div>
                    )}
                    <div className="mt-1 whitespace-pre-wrap text-stone-600">
                      {c.answer}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {draft.other_candidates &&
            draft.other_candidates.length > 0 &&
            !preview && (
              <details className="mt-2 text-[11px] text-stone-600">
                <summary className="cursor-pointer">
                  {draft.other_candidates.length} other considered source
                  {draft.other_candidates.length === 1 ? '' : 's'}
                </summary>
                <ul className="mt-2 space-y-2">
                  {draft.other_candidates.map((c, i) => (
                    <li
                      key={i}
                      className="rounded border border-stone-100 bg-stone-50 p-2"
                    >
                      <div className="font-medium text-stone-700">
                        {c.source_title}
                        {c.section ? ` — ${c.section}` : ''}
                      </div>
                      {shouldShowCitationQuestion(c) && (
                        <div className="mt-1 whitespace-pre-wrap text-stone-600">
                          {c.question}
                        </div>
                      )}
                      <div className="mt-1 whitespace-pre-wrap text-stone-500">
                        {c.answer}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
        </div>
      </div>
    </div>
  );
}
