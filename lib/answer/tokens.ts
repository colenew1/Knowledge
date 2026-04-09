/**
 * Shared tokenization for keyword shortlisting.
 *
 * Used in two places:
 *   1. At KB ingest time — we tokenize (question + section) and store the
 *      result in kb_pairs.tokens so the Postgres GIN index can do fast
 *      candidate pre-filtering.
 *   2. At retrieval time — we tokenize the incoming question and use those
 *      tokens for overlap scoring against the candidates.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'at', 'by', 'for', 'with',
  'about', 'to', 'from', 'in', 'on', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'could', 'can', 'may', 'might', 'must', 'shall', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'any', 'some', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'your',
  'our', 'their', 'its', 'please', 'describe', 'provide', 'explain', 'list',
  'indicate', 'detail', 'details', 'company', 'vendor', 'firm', 'system',
  'product', 'service', 'solution', 'platform', 'tool', 'software',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export function uniqueTokens(text: string): string[] {
  return Array.from(new Set(tokenize(text)));
}
