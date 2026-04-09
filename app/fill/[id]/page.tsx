'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DraftAnswer, ExtractedQuestion, FillJob } from '@/lib/types';

const STATUS_LABEL: Record<FillJob['status'], string> = {
  pending: 'Pending',
  planning: 'Detecting structure…',
  ready_to_generate: 'Ready to generate',
  generating: 'Generating drafts…',
  ready: 'Ready to download',
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

  const questionsById = useMemo(() => {
    const map = new Map<string, ExtractedQuestion>();
    job?.questions?.forEach((q) => map.set(q.id, q));
    return map;
  }, [job]);

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
  const answered = (job.questions || []).filter((q) => q.existing_answer);
  const answers = job.answers || [];

  return (
    <div className="space-y-8">
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
              className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy
                ? 'Generating…'
                : job.status === 'ready'
                  ? 'Re-generate drafts'
                  : 'Generate drafts'}
            </button>
          )}
          {job.status === 'ready' && (
            <a
              href={`/api/fill/${job.id}/download`}
              className="rounded border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50"
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

      {job.questions && job.questions.length > 0 && (
        <section>
          <h2 className="text-lg font-medium">
            Questions: {job.questions.length} total · {unanswered.length} to draft
            · {answered.length} already answered
          </h2>
        </section>
      )}

      {answers.length > 0 && (
        <section>
          <h2 className="text-lg font-medium">Drafts</h2>
          <div className="mt-4 space-y-4">
            {answers.map((a) => {
              const q = questionsById.get(a.question_id);
              if (!q) return null;
              return (
                <div
                  key={a.question_id}
                  className="rounded-lg border border-stone-200 bg-white p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-stone-500">
                        {q.sheet} · {q.section}
                      </div>
                      <div className="mt-1 font-medium">{q.question}</div>
                    </div>
                    <span
                      className={`shrink-0 rounded border px-2 py-1 text-xs font-medium ${CONFIDENCE_STYLE[a.confidence]}`}
                    >
                      {a.confidence}
                    </span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-stone-800">
                    {a.draft_answer}
                  </p>
                  {a.needs_review_note && (
                    <p className="mt-2 text-xs text-amber-700">
                      Review note: {a.needs_review_note}
                    </p>
                  )}
                  {a.citations.length > 0 && (
                    <details className="mt-3 text-xs text-stone-600">
                      <summary className="cursor-pointer">
                        {a.citations.length} citation
                        {a.citations.length === 1 ? '' : 's'}
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {a.citations.map((c, i) => (
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
            })}
          </div>
        </section>
      )}
    </div>
  );
}
