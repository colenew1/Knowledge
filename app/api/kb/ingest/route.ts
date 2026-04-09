import { NextRequest, NextResponse } from 'next/server';
import { ingestKbSource } from '@/lib/services/kb-ingest';

// Structure detection + extraction can be slow on a multi-sheet workbook.
export const maxDuration = 300;

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
  const sourceType = String(form.get('source_type') || 'past_rfp') as
    | 'past_rfp'
    | 'sig'
    | 'caiq'
    | 'soc2'
    | 'policy'
    | 'manual'
    | 'other';
  const notes = String(form.get('notes') || '').trim() || undefined;

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await ingestKbSource({
      title,
      filename: file.name,
      sourceType,
      buffer,
      notes,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ingest failed' },
      { status: 500 }
    );
  }
}
