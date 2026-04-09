'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DraftAnswer, ExtractedQuestion, FillJob } from '@/lib/types';

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

type Filter = 'all' | 'high' | 'review' | 'no_info' | 'edited';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'high', label: 'High confidence' },
  { key: 'review', label: 'Needs review' },
  { key: 'no_info', label: 'No match' },
  { key: 'edited', label: 'Edited' },
];

export default function FillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [job, setJob] = useState<FillJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

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

  // Replace a single draft in local state without refetching the whole job —
  // used by auto-save and re-infer so the UI stays responsive.
  const replaceDraft = useCallback((updated: DraftAnswer) => {
    setJob((prev) => {
      if (!prev) return prev;
      const nextAnswers = [...(prev.answers || [])];
      const idx = nextAnswers.findIndex((a) => a.question_id === updated.question_id);
      if (idx === -1) nextAnswers.push(updated);
      else nextAnswers[idx] = updated;
      return { ...prev, answers: nextAnswers };
    });
  }, []);

  const questionsById = useMemo(() => {
    const map = new Map<string, ExtractedQuestion>();
    job?.questions?.forEach((q) => map.set(q.id, q));
    return map;
  }, [job]);

  const answers = job?.answers || [];

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

  const filteredAnswers = useMemo(() => {
    return answers.filter((a) => {
      if (filter === 'all') return true;
      if (filter === 'high') return a.verdict !== 'no_info' && a.confidence === 'high';
      if (filter === 'review')
        return a.verdict !== 'no_info' && a.confidence !== 'high';
      if (filter === 'no_info') return a.verdict === 'no_info';
      if (filter === 'edited') return Boolean(a.edited);
      return true;
    });
  }, [answers, filter]);

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

  const unanswered = (job.questions || []).filter((q) => !q.existing_answer);
  const preAnswered = (job.questions || []).filter((q) => q.existing_answer);

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
        {job.questions && job.questions.length > 0 && (
          <div className="text-sm text-stone-600">
            {job.questions.length} questions · {unanswered.length} to draft ·{' '}
            {preAnswered.length} already answered
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
          {(job.status === 'pending' || job.status === 'error') && (
            <button
              onClick={runPlan}
              disabled={busy}
              className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Detect structure'}
            </button>
          )}
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

      {answers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const count =
              f.key === 'all'
                ? counts.total
                : f.key === 'high'
                  ? counts.high
                  : f.key === 'review'
                    ? counts.review
                    : f.key === 'no_info'
                      ? counts.noInfo
                      : counts.edited;
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
                }`}
              >
                {f.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {answers.length > 0 && (
        <div className="space-y-4">
          {filteredAnswers.map((a) => {
            const q = questionsById.get(a.question_id);
            if (!q) return null;
            return (
              <ReviewCard
                key={a.question_id}
                jobId={id}
                question={q}
                draft={a}
                onDraftChange={replaceDraft}
              />
            );
          })}
          {filteredAnswers.length === 0 && (
            <p className="text-sm text-stone-500">
              No questions match this filter.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
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
  const savedRef = useRef(draft.draft_answer);

  // Keep local textarea synced when the draft is replaced from outside (e.g.
  // re-infer returns a new body).
  useEffect(() => {
    setText(draft.draft_answer);
    savedRef.current = draft.draft_answer;
  }, [draft.draft_answer]);

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

  async function handleInfer() {
    setInferring(true);
    try {
      const res = await fetch(`/api/fill/${jobId}/infer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: question.id }),
      });
      const data = await res.json();
      if (res.ok) onDraftChange(data.draft as DraftAnswer);
    } finally {
      setInferring(false);
    }
  }

  const isNoInfo = draft.verdict === 'no_info';

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-stone-500">
            {question.sheet} · {question.section} · row {question.row + 1}
          </div>
          <div className="mt-1 font-medium text-stone-900">{question.question}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {draft.edited && (
            <span className="rounded border border-stone-300 bg-stone-50 px-2 py-1 text-xs font-medium text-stone-700">
              edited
            </span>
          )}
          {draft.mode === 'infer' && (
            <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
              inferred
            </span>
          )}
          <span
            className={`rounded border px-2 py-1 text-xs font-medium ${CONFIDENCE_STYLE[draft.confidence]}`}
          >
            {draft.confidence}
          </span>
        </div>
      </div>

      {isNoInfo ? (
        <div className="mt-3 rounded border border-stone-200 bg-stone-50 p-3">
          <p className="text-sm text-stone-700">
            No prior response in the knowledge base directly covers this
            question. You can generate a best-effort inference from related
            material, or edit the draft below manually.
          </p>
          <button
            onClick={handleInfer}
            disabled={inferring}
            className="mt-3 rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {inferring ? 'Generating…' : 'Generate inferred response'}
          </button>
        </div>
      ) : null}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        rows={Math.max(3, Math.min(12, text.split('\n').length + 1))}
        className="mt-3 w-full rounded border border-stone-300 bg-white p-3 text-sm text-stone-800 focus:border-stone-500 focus:outline-none"
        placeholder="Draft answer — edits save automatically when you click away."
      />

      <div className="mt-2 flex items-center justify-between text-xs text-stone-500">
        <span>
          {saving === 'saving' && 'Saving…'}
          {saving === 'saved' && 'Saved'}
          {saving === 'error' && (
            <span className="text-red-600">Save failed — retry by blurring again</span>
          )}
          {saving === 'idle' && 'Auto-saves on blur'}
        </span>
        {!isNoInfo && draft.confidence !== 'high' && (
          <button
            onClick={handleInfer}
            disabled={inferring}
            className="rounded border border-stone-300 px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            {inferring ? 'Re-inferring…' : 'Re-run as inference'}
          </button>
        )}
      </div>

      {draft.needs_review_note && (
        <p className="mt-2 text-xs text-amber-700">
          Review note: {draft.needs_review_note}
        </p>
      )}

      {draft.citations.length > 0 && (
        <details className="mt-3 text-xs text-stone-600">
          <summary className="cursor-pointer">
            {draft.citations.length} citation
            {draft.citations.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 space-y-2">
            {draft.citations.map((c, i) => (
              <li
                key={i}
                className="rounded border border-stone-100 bg-stone-50 p-2"
              >
                <div className="font-medium text-stone-700">
                  {c.source_title}
                  {c.section ? ` — ${c.section}` : ''}
                </div>
                <div className="text-stone-600">{c.question}</div>
                <div className="mt-1 text-stone-500">{c.answer}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
