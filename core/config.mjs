// Every setting LineCheck reads, in one place. Values come from .env.local (see .env.example).
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');

const env = process.env;

export const config = {
  openaiKey: env.OPENAI_API_KEY || '',
  visionModel: env.VISION_MODEL || 'gpt-5-mini',
  realtimeModel: env.REALTIME_MODEL || 'gpt-realtime',
  realtimeVoice: env.REALTIME_VOICE || 'marin',
  keenableKey: env.KEENABLE_API_KEY || '',
  boardUrl: (env.BOARD_URL || 'http://localhost:8787').replace(/\/$/, ''),
  boardPort: Number(env.BOARD_PORT || 8787),
  boardToken: env.BOARD_TOKEN || '',
  agentName: env.AGENT_NAME || 'linecheck',
};
