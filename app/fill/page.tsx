'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FillJob } from '@/lib/types';

type JobSummary = Pick<
  FillJob,
  'id' | 'title' | 'filename' | 'status' | 'error_message' | 'created_at' | 'updated_at'
>;

const STATUS_LABEL: Record<FillJob['status'], string> = {
  pending: 'Pending',
  planning: 'Detecting structure…',
  ready_to_generate: 'Ready to generate',
  generating: 'Generating drafts…',
  ready: 'Ready to download',
  error: 'Error',
};

export default function FillListPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/fill');
      const data = await res.json();
      setJobs(data.jobs || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('title', title);
      const res = await fetch('/api/fill', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setTitle('');
      setFile(null);
      const input = document.getElementById('fill-file') as HTMLInputElement | null;
      if (input) input.value = '';
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this fill job?')) return;
    await fetch(`/api/fill/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Fill Jobs</h1>
        <p className="mt-2 text-sm text-stone-600">
          Upload a blank vendor questionnaire. We&apos;ll detect its structure,
          draft grounded answers, and give you back a filled xlsx.
        </p>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-medium">New fill job</h2>
        <form onSubmit={handleCreate} className="mt-4 grid gap-4">
          <label className="block text-sm">
            <span className="text-stone-700">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Tapestry Coach — security questionnaire"
              className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-700">xlsx file</span>
            <input
              id="fill-file"
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
              className="mt-1 block w-full text-sm"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div>
            <button
              type="submit"
              disabled={uploading || !file || !title}
              className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Create fill job'}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-medium">Jobs ({jobs.length})</h2>
        {loading ? (
          <p className="mt-4 text-sm text-stone-500">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="mt-4 text-sm text-stone-500">No jobs yet.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-t border-stone-100">
                    <td className="px-4 py-3">
                      <Link
                        href={`/fill/${j.id}`}
                        className="font-medium hover:underline"
                      >
                        {j.title}
                      </Link>
                      {j.filename && (
                        <div className="text-xs text-stone-500">{j.filename}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {STATUS_LABEL[j.status]}
                      {j.error_message && (
                        <div className="text-xs text-red-600">
                          {j.error_message}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {new Date(j.updated_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(j.id)}
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
