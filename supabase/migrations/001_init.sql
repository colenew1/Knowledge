-- RFP Knowledge Base — initial schema
--
-- Three tables:
--   1. kb_sources   — uploaded prior RFPs (each source = one completed xlsx)
--   2. kb_pairs     — extracted Q&A pairs flattened across all sources
--   3. fill_jobs    — a new RFP being filled out; stores original xlsx, plan, drafts
--
-- All tables use simple service-role access; no multi-tenant auth for v1.

-- ============================================
-- kb_sources
-- ============================================
CREATE TABLE IF NOT EXISTS kb_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  filename TEXT,
  source_type TEXT NOT NULL DEFAULT 'past_rfp'
    CHECK (source_type IN ('past_rfp', 'sig', 'caiq', 'soc2', 'policy', 'manual', 'other')),
  -- Structure plan Claude produced during ingest (for debugging / re-extraction).
  structure_plan JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_sources_created_at ON kb_sources(created_at DESC);

-- ============================================
-- kb_pairs — flattened Q&A pairs
-- ============================================
CREATE TABLE IF NOT EXISTS kb_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
  section TEXT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  -- Lowercased tokens of question + section, used for keyword shortlist.
  -- Stored as text[] so we can index with GIN.
  tokens TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_pairs_source ON kb_pairs(source_id);
CREATE INDEX IF NOT EXISTS idx_kb_pairs_tokens ON kb_pairs USING GIN (tokens);

-- ============================================
-- fill_jobs — a new RFP being autofilled
-- ============================================
CREATE TABLE IF NOT EXISTS fill_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  filename TEXT,

  -- Base64-encoded bytes of the uploaded xlsx. Small enough (<1MB typically)
  -- to fit comfortably in Postgres; swap to Supabase Storage if this ever grows.
  original_xlsx_b64 TEXT NOT NULL,

  -- Full structure plan Claude produced, across all sheets.
  structure_plan JSONB,

  -- Extracted questions from the structure plan.
  -- Array of { id, sheet, section, question, row, col, answer_row, answer_col,
  --           allowed_values, is_merged }
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Drafted answers. Array of { question_id, draft_answer, confidence,
  --   citations, needs_review_note }
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'planning', 'ready_to_generate', 'generating', 'ready', 'error')),
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fill_jobs_created_at ON fill_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fill_jobs_status ON fill_jobs(status);
