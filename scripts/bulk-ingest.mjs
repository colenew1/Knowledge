#!/usr/bin/env node
/**
 * Bulk ingest the FanDuel RFP supporting documents + a few extras into the
 * local knowledge base by POSTing to the running dev server.
 *
 * Requires `npm run dev` running on http://localhost:3000.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';

const FOLDER =
  'C:/Users/Owner/Downloads/OneDrive_2026-04-09/AmplifAI & FanDuel RFP Supporting Documents';

const EXTRAS = [
  'C:/Users/Owner/Downloads/Auto QA Model Validation 2025.pdf',
  'C:/Users/Owner/Downloads/Auto QA Timeline v2 2.pdf',
  'C:/Users/Owner/Downloads/Zillow 3rd Party Security Vendor Questionnaire v2.2 - AmplifAI.docx',
];

// Pick a source_type based on filename heuristics. The UI enum is:
// past_rfp | sig | caiq | soc2 | policy | manual | other
function pickSourceType(name) {
  const n = name.toLowerCase();
  if (n.includes('soc2') || n.includes('soc 2')) return 'soc2';
  if (n.includes('zillow') || n.includes('vendor questionnaire'))
    return 'past_rfp';
  if (
    n.includes('policy') ||
    n.includes('privacy') ||
    n.includes('dpa') ||
    n.includes('sla') ||
    n.includes('service level') ||
    n.includes('incident response') ||
    n.includes('disaster recovery plan') ||
    n.includes('encryption') ||
    n.includes('it security') ||
    n.includes('security polic') ||
    n.includes('record retention') ||
    n.includes('asset management') ||
    n.includes('vendor management') ||
    n.includes('governance')
  ) {
    return 'policy';
  }
  return 'other';
}

// Strip extension and tidy into a nice title.
function pickTitle(name) {
  return path.basename(name).replace(/\.(pdf|docx|xlsx)$/i, '').trim();
}

async function ingestOne(filePath) {
  const filename = path.basename(filePath);
  const title = pickTitle(filename);
  const sourceType = pickSourceType(filename);

  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf]);

  const fd = new FormData();
  fd.append('file', blob, filename);
  fd.append('title', title);
  fd.append('source_type', sourceType);

  const started = Date.now();
  process.stdout.write(`  → ${filename} [${sourceType}] ... `);

  try {
    const res = await fetch(`${BASE}/api/kb/ingest`, {
      method: 'POST',
      body: fd,
    });
    const data = await res.json();
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (!res.ok) {
      console.log(`FAIL (${elapsed}s): ${data.error}`);
      return { file: filename, ok: false, error: data.error };
    }
    console.log(
      `ok (${elapsed}s) — ${data.pairs_saved} pairs saved` +
        (data.skipped_no_answer
          ? `, ${data.skipped_no_answer} skipped`
          : '')
    );
    return {
      file: filename,
      ok: true,
      pairs: data.pairs_saved,
      skipped: data.skipped_no_answer,
    };
  } catch (err) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`FAIL (${elapsed}s): ${err.message}`);
    return { file: filename, ok: false, error: err.message };
  }
}

async function main() {
  const files = [];

  if (fs.existsSync(FOLDER)) {
    for (const f of fs.readdirSync(FOLDER)) {
      const full = path.join(FOLDER, f);
      if (fs.statSync(full).isFile()) files.push(full);
    }
  } else {
    console.error(`Folder not found: ${FOLDER}`);
  }

  for (const f of EXTRAS) {
    if (fs.existsSync(f)) files.push(f);
    else console.error(`Missing extra: ${f}`);
  }

  console.log(`Ingesting ${files.length} files...\n`);

  const results = [];
  for (const f of files) {
    results.push(await ingestOne(f));
  }

  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const totalPairs = ok.reduce((s, r) => s + (r.pairs || 0), 0);

  console.log('\n━━━ Summary ━━━');
  console.log(`  ${ok.length} succeeded, ${bad.length} failed`);
  console.log(`  ${totalPairs} total Q/A pairs saved`);
  if (bad.length) {
    console.log('\nFailures:');
    for (const r of bad) console.log(`  - ${r.file}: ${r.error}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
