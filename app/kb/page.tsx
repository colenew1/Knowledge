'use client';

import { useEffect, useState } from 'react';
import type { KbSource } from '@/lib/types';

const SOURCE_TYPES: KbSource['source_type'][] = [
  'past_rfp',
  'sig',
  'caiq',
  'soc2',
  'policy',
  'manual',
  'other',
];

export default function KbPage() {
  const [sources, setSources] = useState<KbSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] =
    useState<KbSource['source_type']>('past_rfp');
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/kb/sources');
      const data = await res.json();
      setSources(data.sources || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('title', title);
      body.append('source_type', sourceType);
      body.append('notes', notes);
      const res = await fetch('/api/kb/ingest', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ingest failed');
      setTitle('');
      setNotes('');
      setFile(null);
      (document.getElementById('kb-file') as HTMLInputElement | null)?.value &&
        ((document.getElementById('kb-file') as HTMLInputElement).value = '');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this source and all its Q&A pairs?')) return;
    await fetch(`/api/kb/sources/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
        <p className="mt-2 text-sm text-stone-600">
          Upload completed xlsx responses. We detect the structure, extract
          Q&amp;A pairs, and index them for retrieval.
        </p>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-medium">Ingest a source</h2>
        <form onSubmit={handleUpload} className="mt-4 grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="text-stone-700">Title</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="Tapestry IA Vendor Questions"
                className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-stone-700">Type</span>
              <select
                value={sourceType}
                onChange={(e) =>
                  setSourceType(e.target.value as KbSource['source_type'])
                }
                className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-stone-700">xlsx file</span>
            <input
              id="kb-file"
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
              className="mt-1 block w-full text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-700">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div>
            <button
              type="submit"
              disabled={uploading || !file || !title}
              className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {uploading ? 'Ingesting…' : 'Ingest source'}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-medium">Sources ({sources.length})</h2>
        {loading ? (
          <p className="mt-4 text-sm text-stone-500">Loading…</p>
        ) : sources.length === 0 ? (
          <p className="mt-4 text-sm text-stone-500">
            No sources yet. Ingest your first xlsx above.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Pairs</th>
                  <th className="px-4 py-3 font-medium">Added</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className="border-t border-stone-100">
                    <td className="px-4 py-3">
                      <div className="font-medium">{s.title}</div>
                      {s.filename && (
                        <div className="text-xs text-stone-500">{s.filename}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-600">{s.source_type}</td>
                    <td className="px-4 py-3 text-stone-600">
                      {s.pair_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
