'use client';

import { useState } from 'react';
import type { DraftAnswer } from '@/lib/types';

const CONFIDENCE_STYLE: Record<DraftAnswer['confidence'], string> = {
  high: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-red-50 text-red-700 border-red-200',
};

export default function AskPage() {
  const [question, setQuestion] = useState('');
  const [section, setSection] = useState('General');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<DraftAnswer | null>(null);
  const [candidates, setCandidates] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setDraft(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, section }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ask failed');
      setDraft(data.draft);
      setCandidates(data.candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ask failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
        <p className="mt-2 text-sm text-stone-600">
          Quick one-off lookup against the knowledge base. Useful when you&apos;re
          in a call or Slack thread and need a grounded answer without uploading
          an xlsx.
        </p>
      </section>

      <form
        onSubmit={handleAsk}
        className="space-y-4 rounded-lg border border-stone-200 bg-white p-6"
      >
        <label className="block text-sm">
          <span className="text-stone-700">Section (optional)</span>
          <input
            type="text"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            placeholder="e.g. Data Security, Access Controls"
            className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-stone-700">Question</span>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={4}
            required
            placeholder="Does AmplifAI encrypt customer data at rest?"
            className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Drafting…' : 'Ask'}
        </button>
      </form>

      {draft && (
        <section className="rounded-lg border border-stone-200 bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-medium">Draft answer</h2>
            <span
              className={`rounded border px-2 py-1 text-xs font-medium ${CONFIDENCE_STYLE[draft.confidence]}`}
            >
              {draft.confidence}
            </span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-stone-800">
            {draft.draft_answer}
          </p>
          {draft.needs_review_note && (
            <p className="mt-2 text-xs text-amber-700">
              Review note: {draft.needs_review_note}
            </p>
          )}
          {candidates !== null && (
            <p className="mt-3 text-xs text-stone-500">
              Considered {candidates} candidate pair{candidates === 1 ? '' : 's'}.
            </p>
          )}
          {draft.citations.length > 0 && (
            <details className="mt-4 text-xs text-stone-600" open>
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
        </section>
      )}
    </div>
  );
}
