'use client';

/**
 * Shared UI bits for rendering citations and draft answers:
 *
 * - <HighlightedAnswer> renders a full KB answer with the specific
 *   excerpts Claude drew from wrapped in a highlight span.
 * - <CopyButton> is a small click-to-copy button used on draft/preview
 *   answers so a reviewer can grab the text without applying it.
 */

import { useState } from 'react';
import { splitHighlightChunks } from '@/lib/citation-helpers';

export function HighlightedAnswer({
  text,
  excerpts,
  className,
}: {
  text: string;
  excerpts?: string[];
  className?: string;
}) {
  const chunks = splitHighlightChunks(text, excerpts);
  return (
    <div className={`whitespace-pre-wrap ${className || ''}`}>
      {chunks.map((c, i) =>
        c.highlight ? (
          <mark
            key={i}
            className="rounded bg-yellow-200/80 px-0.5 text-stone-900"
          >
            {c.text}
          </mark>
        ) : (
          <span key={i}>{c.text}</span>
        )
      )}
    </div>
  );
}

export function CopyButton({
  text,
  label = 'Copy',
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 1500);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={
        className ||
        'rounded border border-stone-300 bg-white px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50'
      }
    >
      {state === 'copied' ? 'Copied!' : state === 'error' ? 'Copy failed' : label}
    </button>
  );
}
