// Builds the search indexes from files you put in data/raw/:
//   *.pdf  maintenance references (e.g. FAA AC 43.13-1B, AMT handbooks) -> data/index/procedures.json
//   *.csv  FAA Service Difficulty Report downloads                      -> data/index/sdr.json
// FAA.gov blocks scripted downloads, so fetch those files in a browser (see README).
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../core/config.mjs';
import { normaliseSdr } from '../core/failures.mjs';

const RAW = path.join(DATA, 'raw');
const OUT = path.join(DATA, 'index');
fs.mkdirSync(OUT, { recursive: true });

if (!fs.existsSync(RAW)) {
  console.error(`Put PDFs and SDR CSVs in ${RAW} first.`);
  process.exit(1);
}
const files = fs.readdirSync(RAW);

// AC 43.13-1B numbers paragraphs like "6-12. INSPECTION OF ...". Track the latest heading per page.
const HEADING = /(?:^|\n)\s*(\d{1,2}-\d{1,3})\.\s+([A-Z][A-Z0-9 ,'()/\-]{3,80})/g;
const CHUNK = 1100, OVERLAP = 150;

async function pdfChunks(file) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  const source = path.basename(file, '.pdf').replace(/[_]+/g, ' ');
  const chunks = [];
  let section = '', title = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = '';
    let lastY;
    for (const item of content.items) {
      const y = item.transform?.[5];
      text += (lastY !== undefined && Math.abs(y - lastY) > 2 ? '\n' : ' ') + item.str;
      lastY = y;
    }
    text = text.replace(/[ \t]+/g, ' ').trim();
    if (text.length < 40) continue;
    // Split the page into chunks; each chunk inherits the most recent heading seen before it.
    for (let start = 0; start < text.length; start += CHUNK - OVERLAP) {
      const piece = text.slice(start, start + CHUNK);
      for (const m of text.slice(0, start + CHUNK).matchAll(HEADING)) { section = m[1]; title = m[2].trim(); }
      chunks.push({ source, section, title, page: p, text: piece.replace(/\n/g, ' ') });
      if (start + CHUNK >= text.length) break;
    }
    if (p % 50 === 0) console.log(`  ${source}: page ${p}/${doc.numPages}`);
  }
  return chunks;
}

let procedures = [], sdr = [];
for (const name of files) {
  const file = path.join(RAW, name);
  if (/\.pdf$/i.test(name)) {
    console.log(`Reading ${name}…`);
    const c = await pdfChunks(file);
    console.log(`  ${c.length} chunks`);
    procedures = procedures.concat(c);
  } else if (/\.(csv|txt)$/i.test(name)) {
    console.log(`Reading ${name}…`);
    const rows = normaliseSdr(fs.readFileSync(file, 'latin1'));
    console.log(`  ${rows.length} reports`);
    sdr = sdr.concat(rows);
  }
}

if (procedures.length) fs.writeFileSync(path.join(OUT, 'procedures.json'), JSON.stringify(procedures));
if (sdr.length) fs.writeFileSync(path.join(OUT, 'sdr.json'), JSON.stringify(sdr));
console.log(`Done: ${procedures.length} procedure chunks, ${sdr.length} SDR reports in ${OUT}`);
if (!procedures.length && !sdr.length) console.log('Nothing found. The agent will keep using the sample data in data/sample/.');
