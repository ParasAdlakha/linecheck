// The live work-order board: what judges watch fill in during the call, and where the technician signs.
//   GET  /              board page          GET /snap          phone photo upload page
//   GET  /events        server-sent events  GET /api/state     current work order
//   POST /api/events    agent events        POST /api/snap     photo from the phone (image body)
//   POST /api/photos    frame from agent    GET /api/snap/latest  newest upload, for the agent
//   POST /api/signoff   technician signs    POST /api/reset    start a new work order
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, DATA } from '../core/config.mjs';
import { applyEvent, newWorkOrder } from '../core/workorder.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const RECORDS = path.join(DATA, 'records');
const PHOTOS = path.join(RECORDS, 'photos');
fs.mkdirSync(PHOTOS, { recursive: true });

let workOrder = newWorkOrder();
let lastUpload = null; // { file, url, at, type }
const clients = new Set();

function save() {
  fs.writeFileSync(path.join(RECORDS, `${workOrder.id}.json`), JSON.stringify(workOrder, null, 2));
}

function broadcast() {
  const msg = `data: ${JSON.stringify(workOrder)}\n\n`;
  for (const res of clients) res.write(msg);
}

function apply(event) {
  workOrder = applyEvent(workOrder, event);
  save();
  broadcast();
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function sendFile(res, file) {
  if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

// Agent-only routes need the token when one is set; the phone and the board page don't.
const agentOnly = req => !config.boardToken || req.headers['x-board-token'] === config.boardToken;

function storePhoto(buf, type) {
  const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[type] || '.jpg';
  const name = `${Date.now()}${ext}`;
  fs.writeFileSync(path.join(PHOTOS, name), buf);
  return { file: path.join(PHOTOS, name), url: `/photos/${name}`, at: Date.now(), type };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') return sendFile(res, path.join(PUBLIC, 'index.html'));
    if (req.method === 'GET' && url.pathname === '/snap') return sendFile(res, path.join(PUBLIC, 'snap.html'));
    if (req.method === 'GET' && url.pathname.startsWith('/photos/')) return sendFile(res, path.join(PHOTOS, path.basename(url.pathname)));
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, workOrder);

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(workOrder)}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/events') {
      if (!agentOnly(req)) return json(res, 401, { error: 'Bad board token' });
      const event = JSON.parse((await readBody(req)).toString('utf8'));
      apply(event);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/photos') {
      if (!agentOnly(req)) return json(res, 401, { error: 'Bad board token' });
      const photo = storePhoto(await readBody(req), req.headers['content-type']);
      return json(res, 200, { url: photo.url });
    }

    if (req.method === 'POST' && url.pathname === '/api/snap') {
      const type = (req.headers['content-type'] || '').split(';')[0];
      if (!type.startsWith('image/')) return json(res, 415, { error: 'Send the photo as an image file' });
      lastUpload = storePhoto(await readBody(req), type);
      apply({ type: 'photo_uploaded', note: 'Photo received from phone' });
      return json(res, 200, { ok: true, url: lastUpload.url });
    }

    if (req.method === 'GET' && url.pathname === '/api/snap/latest') {
      if (!agentOnly(req)) return json(res, 401, { error: 'Bad board token' });
      const since = Number(url.searchParams.get('since') || 0);
      if (!lastUpload || lastUpload.at <= since) { res.writeHead(204); return res.end(); }
      const b64 = fs.readFileSync(lastUpload.file).toString('base64');
      return json(res, 200, { dataUrl: `data:${lastUpload.type};base64,${b64}`, url: lastUpload.url, at: lastUpload.at });
    }

    if (req.method === 'POST' && url.pathname === '/api/signoff') {
      const p = JSON.parse((await readBody(req)).toString('utf8'));
      apply({ type: 'signoff', payload: p, note: `Signed by ${p.name}` });
      return json(res, 200, workOrder);
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      apply({ type: 'reset' });
      return json(res, 200, workOrder);
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
});

server.listen(config.boardPort, () => {
  console.log(`LineCheck board on http://localhost:${config.boardPort}  (phone upload: /snap)`);
});
