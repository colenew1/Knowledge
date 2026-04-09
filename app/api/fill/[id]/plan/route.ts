import { NextRequest, NextResponse } from 'next/server';
import { planFillJob } from '@/lib/services/fill-job';

export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const job = await planFillJob(id);
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Planning failed' },
      { status: 500 }
    );
  }
}
