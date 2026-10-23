// Airworthiness Directive search through Keenable (https://docs.keenable.ai).
// ADs are published in the Federal Register, so results are pinned to that site first,
// then widened to the open web if nothing comes back.
import { config } from './config.mjs';

async function keenable(body) {
  const keyed = Boolean(config.keenableKey);
  const res = await fetch(`https://api.keenable.ai/v1/search${keyed ? '' : '/public'}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(keyed ? { 'X-API-Key': config.keenableKey } : { 'X-Keenable-Title': 'LineCheck' }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Keenable search failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function searchADs({ aircraft = '', part = '' }) {
  const query = `airworthiness directive ${aircraft} ${part}`.replace(/\s+/g, ' ').trim();
  const base = { query, max_results: 5, snippet_max_length: 400 };
  let data = await keenable({ ...base, site: 'federalregister.gov' });
  let scope = 'federalregister.gov';
  if (!data.results?.length) { data = await keenable(base); scope = 'web'; }
  return {
    query, scope,
    results: (data.results || []).slice(0, 5).map(r => ({
      title: r.title, url: r.url,
      snippet: (r.snippet || r.description || '').slice(0, 400),
      published_at: r.published_at || null,
    })),
  };
}
