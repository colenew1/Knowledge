import { NextRequest, NextResponse } from 'next/server';
import { generateFillJob } from '@/lib/services/fill-job';

export const maxDuration = 600;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const job = await generateFillJob(id);
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Generation failed' },
      { status: 500 }
    );
  }
}
