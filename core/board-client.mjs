// How the agent talks to the live work-order board (board/server.mjs).
// Failures here never break the call: the board is a display, the conversation comes first.
import { config } from './config.mjs';

const headers = { 'Content-Type': 'application/json', ...(config.boardToken ? { 'X-Board-Token': config.boardToken } : {}) };

export async function postEvent(type, payload = {}, note = '') {
  try {
    await fetch(`${config.boardUrl}/api/events`, {
      method: 'POST', headers, body: JSON.stringify({ type, payload, note }), signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    console.warn(`[board] could not post ${type}: ${err.message}`);
  }
}

/** The most recent photo uploaded from the phone page, as a data URL, if it is newer than `sinceMs`. */
export async function latestUpload(sinceMs = 0) {
  try {
    const res = await fetch(`${config.boardUrl}/api/snap/latest?since=${sinceMs}`, { headers, signal: AbortSignal.timeout(3000) });
    if (res.status !== 200) return null;
    return await res.json(); // { dataUrl, url, at }
  } catch {
    return null;
  }
}

/** Saves a captured video frame on the board so it appears on the work order. Returns its URL. */
export async function savePhoto(pngBuffer) {
  try {
    const res = await fetch(`${config.boardUrl}/api/photos`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: pngBuffer, signal: AbortSignal.timeout(5000),
    });
    return res.ok ? (await res.json()).url : null;
  } catch {
    return null;
  }
}
