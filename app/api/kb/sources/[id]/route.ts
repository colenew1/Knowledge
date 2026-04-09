import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = db();
  const { data: source, error } = await supabase
    .from('kb_sources')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !source) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: pairs } = await supabase
    .from('kb_pairs')
    .select('*')
    .eq('source_id', id)
    .order('created_at', { ascending: true });

  return NextResponse.json({ source, pairs: pairs || [] });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = db();
  const { error } = await supabase.from('kb_sources').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
