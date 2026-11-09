// Serves the repo for a browser: index.html shows one frame of the film per URL (?f=432, ?t=18), audio.html is the synth.
//   node tools/serve.mjs [--port 9100]      (ctrl+c to stop)
import { serve, opt } from './lib.mjs';
const { url } = await serve(+opt('port', 9100));
console.log(`serving the repo on ${url}`);
console.log(`  ${url}?f=1116       the ramen close-up (46.5 s)`);
console.log(`  ${url}?t=36.6       any time in seconds (default 22.5)`);
console.log('ctrl+c to stop');
