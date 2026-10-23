// Visual inspection of one still image with an OpenAI vision model (Responses API).
// The model describes what it sees; it never declares a part airworthy.
import { config } from './config.mjs';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['component', 'image_quality', 'findings', 'recommended_checks', 'needs_better_view', 'spoken_summary'],
  properties: {
    component: { type: 'string', description: 'What part or area is shown, as a technician would name it.' },
    image_quality: { type: 'string', enum: ['good', 'usable', 'poor'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'location', 'severity', 'confidence', 'evidence'],
        properties: {
          type: { type: 'string', description: 'e.g. corrosion, crack, dent, chafing, missing fastener, fluid leak, burn, wear' },
          location: { type: 'string', description: 'Where in the image, in plain words.' },
          severity: { type: 'string', enum: ['none', 'minor', 'monitor', 'significant', 'stop-work'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence: { type: 'string', description: 'The visual cue that supports this finding.' },
        },
      },
    },
    recommended_checks: { type: 'array', items: { type: 'string' }, description: 'Next physical checks, e.g. measure depth, dye penetrant, torque check.' },
    needs_better_view: { type: 'string', description: 'Empty if the view is fine, otherwise what angle, distance or lighting to try.' },
    spoken_summary: { type: 'string', description: 'One or two short sentences to say aloud on the call.' },
  },
};

const PROMPT = `You are assisting a certificated aircraft maintenance technician during an inspection.
Describe visible condition only. Do not guess hidden damage. Never state that a part is airworthy or serviceable:
the technician decides. Prefer "possible" over certainty when the image is ambiguous. Keep the spoken summary short.`;

export async function inspectImage({ imageDataUrl, context = '' }) {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
    body: JSON.stringify({
      model: config.visionModel,
      instructions: PROMPT,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: `Technician context: ${context || 'none given'}` },
          { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
        ],
      }],
      text: { format: { type: 'json_schema', name: 'inspection', schema: SCHEMA, strict: true } },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Vision request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.output_text
    ?? data.output?.flatMap(o => o.content || []).find(c => c.type === 'output_text')?.text;
  if (!text) throw new Error('Vision model returned no text');
  return JSON.parse(text);
}
