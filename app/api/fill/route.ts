import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { createFillJob } from '@/lib/services/fill-job';

export const maxDuration = 60;

export async function GET() {
  const supabase = db();
  const { data, error } = await supabase
    .from('fill_jobs')
    .select(
      'id, title, filename, structure_plan, questions, answers, status, error_message, created_at, updated_at, generated_at'
    )
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ jobs: data || [] });
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data' },
      { status: 400 }
    );
  }

  const file = form.get('file');
  const title = String(form.get('title') || '').trim();

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const job = await createFillJob({
      title,
      filename: file.name,
      buffer,
    });
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
