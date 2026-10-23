// LineCheck: the LiveKit agent Chert puts on a FaceTime line.
// Built from Chert's video starter (examples/video-agent in @trychert/facetime).
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AutoSubscribe, cli, defineAgent, llm, ServerOptions, voice } from '@livekit/agents';
import { realtime } from '@livekit/agents-plugin-openai';
import {
  LocalVideoTrack, RoomEvent, TrackKind, TrackSource, VideoBufferType, VideoFrame, VideoSource, VideoStream,
} from '@livekit/rtc-node';
import { config } from '../core/config.mjs';
import { postEvent } from '../core/board-client.mjs';
import { createTools } from './tools.mjs';
import { drawScope, FPS, HEIGHT, WIDTH } from './scope.mjs';
import { greetOnBridgeReady } from './greet.mjs';

const instructions = `You are LineCheck, an AI inspection assistant on a FaceTime call with an aircraft maintenance technician.
Always speak English, whatever language or accent you hear, unless the technician explicitly asks you to switch.
The technician's hands are busy. Speak in one or two short sentences. Ask one question at a time.

How a call goes:
1. Ask for the tail number and aircraft type if you don't have them, then call set_aircraft.
2. When they show you something or ask "what do you see", call look with a short context. Say the spoken_summary.
   If needs_better_view is set, ask for that view before going further.
3. For any finding, call find_procedure with the defect and the component, and quote the citation (for example "AC 43.13-1B, section 6-...").
4. Call known_failures and search_airworthiness_directives for the aircraft and the part. Mention only what is relevant.
5. When the technician is ready, call draft_work_order with a concise discrepancy and a proposed action that follows the cited procedure.

Rules you never break:
- You assist. You never say a part or aircraft is airworthy, serviceable or safe to fly. The certificated technician decides and signs.
- If a tool result has sample_data true, say once that the reference is from sample data, not the official document.
- If you are not sure what you see, say so and ask for a closer or better-lit view.
- Be clear that you are an AI if asked.`;

const greeting = 'In English, greet the technician in one short sentence: you are LineCheck, ready to look at a part with them. Ask for the tail number and aircraft type.';

/** Keeps the newest frame of the caller's FaceTime video, if the bridge publishes one. */
function watchCallerVideo(room, callerIdentity) {
  let latest = null;
  const readers = [];
  room.on(RoomEvent.TrackSubscribed, async (track, _pub, participant) => {
    if (track.kind !== TrackKind.KIND_VIDEO || participant.identity !== callerIdentity) return;
    console.log('[linecheck] caller video subscribed');
    const reader = new VideoStream(track).getReader();
    readers.push(reader);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        latest = value.frame;
      }
    } catch { /* track ended */ }
  });
  return {
    grab() {
      if (!latest) return null;
      const rgba = latest.convert(VideoBufferType.RGBA);
      return { rgba: rgba.data, width: rgba.width, height: rgba.height };
    },
    stop() { for (const r of readers) r.cancel().catch(() => {}); },
  };
}

const s = z.string();

export default defineAgent({
  entry: async ctx => {
    // Subscribe to everything: we want the caller's video as well as their voice.
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
    // Chert prepares a warm room before any caller exists; wait before paid work.
    const caller = await ctx.waitForParticipant();
    const video = watchCallerVideo(ctx.room, caller.identity);

    // Our own picture: the reticle. The Mac shows video only from the participant that speaks.
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('linecheck-scope', source);
    let tick = 0, state = 'listening', speaking = false;
    const frame = () => source.captureFrame(new VideoFrame(drawScope(tick++, speaking ? 'speaking' : state, speaking ? Math.abs(Math.sin(tick * 0.7)) : 0), WIDTH, HEIGHT, VideoBufferType.RGBA));
    frame();
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    const timer = setInterval(frame, 1000 / FPS);

    const impl = createTools({ grabFrame: () => video.grab(), setState: next => { state = next; } });
    const tools = {
      set_aircraft: llm.tool({
        description: 'Record the aircraft tail number and type for this work order.',
        parameters: z.object({ tail: s.describe('Tail number, e.g. N12345'), type: s.describe('Make and model, e.g. Cessna 172S') }),
        execute: args => impl.set_aircraft(args),
      }),
      look: llm.tool({
        description: 'Capture what the technician is showing on camera (or their latest uploaded photo) and inspect it for visible defects.',
        parameters: z.object({ context: s.describe('What the technician said they are looking at, e.g. "left main gear brake line fitting"') }),
        execute: args => impl.look(args),
      }),
      find_procedure: llm.tool({
        description: 'Search maintenance references (FAA AC 43.13-1B and technician handbooks) for the inspection or repair method.',
        parameters: z.object({ query: s.describe('Defect and component, e.g. "corrosion on aluminium skin rivet"') }),
        execute: args => impl.find_procedure(args),
      }),
      search_airworthiness_directives: llm.tool({
        description: 'Search the web (Federal Register first) for Airworthiness Directives on this aircraft type and part.',
        parameters: z.object({ aircraft: s, part: s }),
        execute: args => impl.search_airworthiness_directives(args),
      }),
      known_failures: llm.tool({
        description: 'Look up FAA Service Difficulty Reports for the same aircraft type and part: how often this failure is reported.',
        parameters: z.object({ aircraft: s.describe('Make and/or model'), part: s.describe('Part name or symptom') }),
        execute: args => impl.known_failures(args),
      }),
      draft_work_order: llm.tool({
        description: 'Write the draft discrepancy and proposed corrective action to the work-order board for the technician to sign.',
        parameters: z.object({
          component: s, ata_chapter: s.describe('ATA chapter if known, else empty'),
          discrepancy: s.describe('What was found, factual, one or two sentences'),
          proposed_action: s.describe('Proposed corrective action, citing the procedure used'),
        }),
        execute: args => impl.draft_work_order(args),
      }),
    };

    const session = new voice.AgentSession({
      llm: new realtime.RealtimeModel({ model: config.realtimeModel, voice: config.realtimeVoice }),
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, e => { speaking = e.newState === 'speaking'; });
    ctx.addShutdownCallback(async () => {
      clearInterval(timer);
      video.stop();
      await session.close();
      await track.close();
      await source.close();
    });

    await postEvent('call_started', {}, 'FaceTime call connected');
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions, tools }),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        videoEnabled: false, // frames go through the look tool instead, so every image is logged on the work order
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    });
    const stopGreeting = greetOnBridgeReady(ctx.room, () => session.generateReply({ instructions: greeting }));
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: config.agentName,
}));
