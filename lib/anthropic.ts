import Anthropic from '@anthropic-ai/sdk';

/**
 * Shared Anthropic client with sensible defaults.
 *
 * Temperature is set to 0 everywhere in this app — we want reproducible,
 * grounded extraction and answering, not creative writing.
 */
export function anthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY in .env.local');
  }
  return new Anthropic({ apiKey });
}

/** Model we use for both structure detection and answer synthesis. */
export const CLAUDE_MODEL = 'claude-sonnet-4-5';

/**
 * Parse the first text block of a Claude response as JSON, tolerating
 * markdown code fences.
 */
export function parseJsonResponse<T>(message: Anthropic.Message): T {
  const block = message.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error('No text content in Claude response');
  }
  let text = block.text.trim();
  if (text.startsWith('```json')) text = text.slice(7);
  else if (text.startsWith('```')) text = text.slice(3);
  if (text.endsWith('```')) text = text.slice(0, -3);
  return JSON.parse(text.trim()) as T;
}
