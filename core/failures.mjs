// Known failures: FAA Service Difficulty Reports (SDR), normalised by scripts/ingest.mjs.
// The FAA's CSV headers vary by year, so ingest maps columns by name patterns.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './config.mjs';
import { tokenize } from './procedures.mjs';

const INDEX = path.join(DATA, 'index', 'sdr.json');
const SAMPLE = path.join(DATA, 'sample', 'sdr.json');

// Normalised field -> header patterns, tried in order.
const FIELDS = {
  date: [/difficulty\s*date/i, /^date/i, /occur/i],
  make: [/aircraft\s*make/i, /^make/i, /mfr|manufacturer/i],
  model: [/aircraft\s*model/i, /^model/i],
  part_name: [/part\s*name/i, /component\s*name/i],
  part_number: [/part\s*number|part\s*no|p\/?n/i],
  location: [/part\s*location|location/i],
  condition: [/part\s*condition|condition/i],
  ata: [/jasc|ata/i],
  nature: [/nature/i, /stage/i],
  description: [/discrepancy|remarks|description|narrative/i],
};

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === '\t') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function normaliseSdr(csvText) {
  const [header, ...body] = parseCsv(csvText);
  const map = {};
  for (const [name, patterns] of Object.entries(FIELDS)) {
    for (const p of patterns) {
      const i = header.findIndex((h, idx) => p.test(h) && !Object.values(map).includes(idx));
      if (i >= 0) { map[name] = i; break; }
    }
  }
  return body
    .filter(r => r.length > 1)
    .map(r => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, (r[i] || '').trim()])))
    .filter(r => r.description || r.part_name);
}

let cached;
function load() {
  if (cached) return cached;
  const file = fs.existsSync(INDEX) ? INDEX : SAMPLE;
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  cached = { rows: rows.map(r => ({ r, terms: new Set(tokenize(`${r.part_name} ${r.location} ${r.condition} ${r.description}`)) })), sample: file === SAMPLE };
  return cached;
}

/** Reports matching an aircraft model and a part or symptom, newest first, with a short tally. */
export function knownFailures({ aircraft = '', part = '', limit = 5 }) {
  const { rows, sample } = load();
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const wantModel = norm(aircraft);
  const want = tokenize(part);
  const hits = [];
  for (const { r, terms } of rows) {
    const full = norm(`${r.make}${r.model}`), model = norm(r.model);
    // "Cessna 172" should match make CESSNA + model 172S, and "172" alone should too.
    if (wantModel && !full.includes(wantModel) && !(model && wantModel.includes(model))) continue;
    const overlap = want.filter(t => terms.has(t)).length;
    if (want.length && overlap === 0) continue;
    hits.push({ overlap, r });
  }
  hits.sort((a, b) => b.overlap - a.overlap || String(b.r.date).localeCompare(String(a.r.date)));
  const conditions = {};
  for (const { r } of hits) if (r.condition) conditions[r.condition] = (conditions[r.condition] || 0) + 1;
  return {
    sample_data: sample,
    total_matches: hits.length,
    top_conditions: Object.entries(conditions).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([condition, count]) => ({ condition, count })),
    reports: hits.slice(0, limit).map(({ r }) => ({
      date: r.date, aircraft: `${r.make} ${r.model}`.trim(), part: r.part_name, location: r.location,
      condition: r.condition, summary: r.description.length > 280 ? `${r.description.slice(0, 280)}…` : r.description,
    })),
  };
}
