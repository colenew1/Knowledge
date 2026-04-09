# RFP Knowledge Base

A tool for drafting RFP / security questionnaire responses grounded in your own
past answers. Upload completed xlsx responses once. When the next questionnaire
arrives, the tool detects its structure, drafts answers against the knowledge
base, and hands you back a filled xlsx with confidence labels and citations so
a sales rep can review before sending.

> **Not the last line of defense.** Drafts always go through a human before
> leaving the building. That's why every answer carries a confidence label, a
> review note when warranted, and citations back to the KB entry it was drawn
> from.

## What it does

- **Ingest** — Upload a completed xlsx (past RFP, SIG/CAIQ, etc.). Claude
  detects the sheet structure (vertical layout, horizontal-pages layout,
  boilerplate sheets to skip), extracts Q&A pairs, and indexes them by keyword.
- **Fill** — Upload a blank questionnaire. Same structure detection runs, then
  every unanswered question is drafted in parallel against the KB. Existing
  human answers are never overwritten.
- **Ask** — One-off lookup against the KB. Useful when you need a grounded
  answer during a live call or Slack thread.
- **Download** — Filled xlsx preserves the original formatting and adds an
  "AI Review Notes" helper column (confidence + citation per row) that a
  reviewer can delete before sending.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind
- Supabase (Postgres) via service role key
- Anthropic SDK (`claude-sonnet-4-5`, temperature 0)
- SheetJS (`xlsx`) for parsing and write-back

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
```

### 3. Database

Run the migration against your Supabase project:

```bash
# Via the Supabase SQL editor, paste the contents of:
supabase/migrations/001_init.sql
```

This creates three tables:

- `kb_sources` — ingested source documents with detected structure plan
- `kb_pairs` — extracted Q&A pairs, tokenized for GIN-indexed retrieval
- `fill_jobs` — in-flight and completed fill jobs (stores the original xlsx as
  base64 so downloads preserve formatting)

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000.

## Workflow

1. **Seed the KB** (`/kb`) — ingest a handful of past responses. Each ingest
   runs structure detection and pulls out answered Q&A pairs.
2. **Create a fill job** (`/fill`) — upload a blank questionnaire.
3. **Detect structure** — Claude produces a plan per sheet (which columns hold
   questions, which hold answers, which sheets to skip).
4. **Generate drafts** — every unanswered question is retrieved-then-drafted
   in parallel (concurrency capped at 4).
5. **Review** — flip through drafts with confidence labels and citations.
6. **Download** — filled xlsx with the "AI Review Notes" helper column.

## How grounding works

Drafts are grounded three ways:

1. **Retrieval.** Questions are tokenized, candidates are prefiltered via a
   Postgres GIN index on `kb_pairs.tokens`, and the top candidates are scored
   by weighted token overlap (question ×3, section ×2, answer ×1).
2. **Prompt guardrails.** The draft prompt tells Claude to use only information
   from the candidates — no inventing facts, certifications, compliance claims,
   dates, numbers, or product capabilities. If the candidates don't support a
   confident answer, Claude is instructed to say so and lower the confidence.
3. **Confidence + citations.** Every draft comes back with `high | medium |
   low` confidence, an optional review note, and citations back to the KB
   entries it drew from.

Temperature 0 is used for reproducibility, not as the main anti-hallucination
defense — grounding and guardrails do the real work.

## Project layout

```
app/
  api/
    ask/                 # Ad-hoc question lookup
    fill/                # Fill job CRUD, plan, generate, download
    kb/                  # KB source CRUD + ingest
  ask/                   # Ask UI
  fill/                  # Fill job list + detail
  kb/                    # KB management UI
  page.tsx               # Dashboard
lib/
  answer/                # Retrieval + draft generation
  anthropic.ts           # Claude client + JSON parsing
  services/              # kb-ingest, fill-job lifecycle
  structure/             # snapshot, detect, extract, writeback
  supabase.ts            # Service-role client
  types.ts               # Shared types
supabase/migrations/
  001_init.sql
```

## Scope

- xlsx only. Word docs are out of scope — if a questionnaire arrives as docx,
  paste the questions into an xlsx first.
- Human review is required before sending any filled response.
