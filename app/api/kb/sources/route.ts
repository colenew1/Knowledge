import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';

export async function GET() {
  const supabase = db();
  const { data, error } = await supabase
    .from('kb_sources')
    .select('*, kb_pairs(count)')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    title: string;
    filename: string | null;
    source_type: string;
    structure_plan: unknown;
    notes: string | null;
    created_at: string;
    kb_pairs?: Array<{ count: number }>;
  };

  const sources = ((data as Row[] | null) || []).map((s) => ({
    ...s,
    pair_count: s.kb_pairs?.[0]?.count ?? 0,
    kb_pairs: undefined,
  }));

  return NextResponse.json({ sources });
}
