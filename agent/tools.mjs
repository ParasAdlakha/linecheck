// The agent's tools as plain async functions, so they can be tested without LiveKit or a call.
// agent.mjs wraps each one with llm.tool() and a zod schema.
import { findProcedure } from '../core/procedures.mjs';
import { knownFailures } from '../core/failures.mjs';
import { searchADs } from '../core/adsearch.mjs';
import { inspectImage } from '../core/vision.mjs';
import { encodePng, downscale } from '../core/png.mjs';
import { postEvent, latestUpload, savePhoto } from '../core/board-client.mjs';

/**
 * @param {{ grabFrame: () => ({rgba: Uint8Array, width: number, height: number} | null), setState: (s: string) => void }} io
 */
export function createTools(io) {
  let lastLookAt = 0;

  return {
    async set_aircraft({ tail, type }) {
      await postEvent('aircraft', { tail, type }, `${tail || ''} ${type || ''}`.trim());
      return { ok: true };
    },

    async look({ context }) {
      io.setState('looking');
      try {
        // Prefer a photo the technician just uploaded (sharper than video), then the live FaceTime video.
        const upload = await latestUpload(lastLookAt);
        let imageDataUrl, photo, source;
        if (upload?.dataUrl) {
          ({ dataUrl: imageDataUrl, url: photo } = upload); source = 'uploaded photo';
        } else {
          const frame = io.grabFrame();
          if (!frame) {
            io.setState('listening');
            return { error: 'no_image', say: 'I can\'t see your camera yet. Switch to a FaceTime video call, or open the LineCheck snap page on your phone and send me a photo.' };
          }
          const small = downscale(frame.rgba, frame.width, frame.height, 1024);
          const png = encodePng(small.rgba, small.width, small.height);
          imageDataUrl = `data:image/png;base64,${png.toString('base64')}`;
          photo = await savePhoto(png); source = 'video frame';
        }
        lastLookAt = Date.now();
        const result = await inspectImage({ imageDataUrl, context });
        await postEvent('inspection', { ...result, photo }, result.spoken_summary);
        const serious = result.findings.some(f => ['significant', 'stop-work'].includes(f.severity));
        io.setState(serious ? 'finding' : 'listening');
        return { source, ...result };
      } catch (err) {
        io.setState('listening');
        return { error: err.message, say: 'I could not analyse that image. Try again in a moment.' };
      }
    },

    async find_procedure({ query }) {
      io.setState('searching');
      const out = findProcedure(query, 3);
      await postEvent('procedure', out, query);
      io.setState('listening');
      return out;
    },

    async search_airworthiness_directives({ aircraft, part }) {
      io.setState('searching');
      try {
        const out = await searchADs({ aircraft, part });
        await postEvent('ads', out, out.query);
        return out;
      } catch (err) {
        return { error: err.message, results: [] };
      } finally {
        io.setState('listening');
      }
    },

    async known_failures({ aircraft, part }) {
      io.setState('searching');
      const out = knownFailures({ aircraft, part, limit: 5 });
      await postEvent('known_failures', out, `${aircraft} ${part}`);
      io.setState('listening');
      return out;
    },

    async draft_work_order({ component, ata_chapter, discrepancy, proposed_action }) {
      await postEvent('draft', { component, ata_chapter, discrepancy, proposed_action }, 'Draft ready for sign-off');
      return { ok: true, status: 'ready_for_signoff', say: 'The draft is on the board. It needs your signature before anything is returned to service.' };
    },
  };
}
