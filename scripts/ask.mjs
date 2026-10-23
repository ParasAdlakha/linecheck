// Run the agent's tools from the terminal, without a FaceTime call. Useful for rehearsing the demo.
//   npm run ask -- procedure "corrosion around rivets on wing skin"
//   npm run ask -- failures "Cessna 172" "skin corrosion"
//   npm run ask -- ads "Cessna 172" "wing attach fitting"
//   npm run ask -- look path/to/photo.jpg "lower wing skin near rivet line"
import fs from 'node:fs';
import path from 'node:path';
import { findProcedure } from '../core/procedures.mjs';
import { knownFailures } from '../core/failures.mjs';
import { searchADs } from '../core/adsearch.mjs';
import { inspectImage } from '../core/vision.mjs';

const [cmd, a = '', b = ''] = process.argv.slice(2);
const show = x => console.log(JSON.stringify(x, null, 2));

switch (cmd) {
  case 'procedure': show(findProcedure(a)); break;
  case 'failures': show(knownFailures({ aircraft: a, part: b })); break;
  case 'ads': show(await searchADs({ aircraft: a, part: b })); break;
  case 'look': {
    const type = { '.png': 'image/png', '.webp': 'image/webp' }[path.extname(a).toLowerCase()] || 'image/jpeg';
    show(await inspectImage({ imageDataUrl: `data:${type};base64,${fs.readFileSync(a).toString('base64')}`, context: b }));
    break;
  }
  default:
    console.log('Usage: npm run ask -- procedure "<query>" | failures "<aircraft>" "<part>" | ads "<aircraft>" "<part>" | look <image> "<context>"');
}
