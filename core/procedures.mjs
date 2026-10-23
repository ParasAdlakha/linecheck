// Procedure lookup: BM25 keyword search over chunked maintenance documents.
// The index is built by scripts/ingest.mjs from PDFs in data/raw/. Without it,
// the clearly labelled sample chunks in data/sample/ are used so the agent still runs.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './config.mjs';

const INDEX = path.join(DATA, 'index', 'procedures.json');
const SAMPLE = path.join(DATA, 'sample', 'procedures.json');

const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the this to was were will with which may should can not no all any be been than then there these those such into'.split(' '));

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9\-]*/g) || [])
    .map(t => t.replace(/-+$/, ''))
    .filter(t => t.length > 1 && !STOP.has(t))
    .map(stem);
}

// A light suffix stripper: enough to match "corroded"/"corrosion", "cracks"/"cracked".
function stem(t) {
  if (/^\d/.test(t)) return t;
  for (const s of ['ations', 'ation', 'ings', 'ing', 'ions', 'ion', 'edly', 'ed', 'es', 's']) {
    if (t.length - s.length >= 4 && t.endsWith(s)) return t.slice(0, -s.length);
  }
  return t.length > 4 && t.endsWith('e') ? t.slice(0, -1) : t;
}

export function buildIndex(chunks) {
  const docs = chunks.map(c => {
    const terms = tokenize(`${c.section || ''} ${c.title || ''} ${c.text}`);
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    return { chunk: c, tf, len: terms.length };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(docs.length, 1);
  return { docs, df, avgLen, n: docs.length };
}

export function search(index, query, k = 3) {
  const q = [...new Set(tokenize(query))];
  const k1 = 1.4, b = 0.75;
  const scored = [];
  for (const d of index.docs) {
    let score = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (index.n - index.df.get(t) + 0.5) / (index.df.get(t) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / index.avgLen));
    }
    if (score > 0) scored.push({ score, ...d.chunk });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

let cached;
export function loadIndex() {
  if (cached) return cached;
  const file = fs.existsSync(INDEX) ? INDEX : SAMPLE;
  const chunks = JSON.parse(fs.readFileSync(file, 'utf8'));
  cached = { ...buildIndex(chunks), sample: file === SAMPLE, file };
  return cached;
}

/** What the agent calls. Returns short, citable passages. */
export function findProcedure(query, k = 3) {
  const index = loadIndex();
  return {
    sample_data: index.sample,
    results: search(index, query, k).map(r => ({
      citation: `${r.source}${r.section ? ` ${/^\d/.test(r.section) ? '§' : ''}${r.section}` : ''}${r.page ? `, p.${r.page}` : ''}`,
      title: r.title || '',
      text: r.text.length > 900 ? `${r.text.slice(0, 900)}…` : r.text,
      score: Number(r.score.toFixed(2)),
    })),
  };
}
