import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { findProcedure, tokenize } from '../core/procedures.mjs';
import { knownFailures, normaliseSdr, parseCsv } from '../core/failures.mjs';
import { applyEvent, newWorkOrder } from '../core/workorder.mjs';
import { encodePng, downscale } from '../core/png.mjs';

test('procedure search finds corrosion guidance and flags sample data', () => {
  const out = findProcedure('corroded rivets on wing skin');
  assert.equal(out.sample_data, true);
  assert.match(out.results[0].title, /corrosion/i);
  assert.match(out.results[0].citation, /AC 43\.13-1B/);
});

test('procedure search routes wiring questions to the electrical chapter', () => {
  const out = findProcedure('chafed wire bundle at firewall clamp');
  assert.match(out.results[0].citation, /Ch\. 11/);
});

test('tokenize folds simple suffixes', () => {
  assert.deepEqual(tokenize('Corroded cracks'), tokenize('corrode crack'));
});

test('known failures match make+model and part, and tally conditions', () => {
  const out = knownFailures({ aircraft: 'Cessna 172', part: 'skin corrosion' });
  assert.ok(out.total_matches >= 3);
  assert.equal(out.top_conditions[0].condition, 'CORRODED');
  assert.ok(out.reports.every(r => r.aircraft.startsWith('CESSNA')));
});

test('known failures for another type exclude Cessna rows', () => {
  const out = knownFailures({ aircraft: 'PA-28', part: 'brake line leak' });
  assert.equal(out.total_matches, 1);
});

test('CSV parser handles quotes, commas and doubled quotes', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
});

test('SDR normaliser maps FAA-style headers by name', () => {
  const csv = 'Difficulty Date,Aircraft Make,Aircraft Model,Part Name,Part Condition,Discrepancy\n2025-01-01,CESSNA,172S,SKIN,CORRODED,"Corrosion, lower skin"\n';
  const [row] = normaliseSdr(csv);
  assert.equal(row.make, 'CESSNA');
  assert.equal(row.condition, 'CORRODED');
  assert.equal(row.description, 'Corrosion, lower skin');
});

test('work order folds events and requires a signature to be signed', () => {
  let wo = newWorkOrder('WO-TEST');
  wo = applyEvent(wo, { type: 'aircraft', payload: { tail: 'N123AB', type: 'Cessna 172S' } });
  wo = applyEvent(wo, { type: 'inspection', payload: { component: 'Lower wing skin', findings: [{ type: 'corrosion', location: 'rivet row', severity: 'monitor', confidence: 0.7, evidence: 'white deposits' }] } });
  wo = applyEvent(wo, { type: 'procedure', payload: { results: [{ citation: 'AC §6', title: 't', text: 'x' }, { citation: 'AC §6', title: 't', text: 'x' }] } });
  wo = applyEvent(wo, { type: 'draft', payload: { discrepancy: 'Corrosion at rivet row', proposed_action: 'Clean, inspect, treat per AC 43.13-1B Ch. 6' } });
  assert.equal(wo.aircraft.tail, 'N123AB');
  assert.equal(wo.findings.length, 1);
  assert.equal(wo.references.length, 1, 'duplicate citations are merged');
  assert.equal(wo.status, 'ready_for_signoff');
  assert.throws(() => applyEvent(wo, { type: 'signoff', payload: { name: 'A' } }));
  wo = applyEvent(wo, { type: 'signoff', payload: { name: 'A. Mechanic', certificate: '1234567' } });
  assert.equal(wo.status, 'signed');
});

test('PNG encoder writes a decodable image', () => {
  const rgba = new Uint8Array(4 * 4 * 4).fill(200);
  const png = encodePng(rgba, 4, 4);
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  // IDAT payload inflates to (stride + filter byte) * height
  const idatLen = png.readUInt32BE(33);
  const raw = zlib.inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, (4 * 4 + 1) * 4);
});

test('downscale caps the long side', () => {
  const out = downscale(new Uint8Array(2000 * 1000 * 4), 2000, 1000, 1024);
  assert.equal(out.width, 1024);
  assert.equal(out.height, 512);
});
