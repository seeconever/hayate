// Film renderer: drives index.html?render=1 in headless GPU Chromium. The page exposes window.renderFrame(t, {fmt}) -> data URL
// (frame index = round(t * 24)), window.__info, window.ready. Everything goes to WORK (see tools/lib.mjs).
//   node tools/render.mjs stills --times 0,18.1,36.6 [--out stills] [--prefix key_] [--fmt png]
//   node tools/render.mjs film [--from 0] [--to 1392] [--chunk 150] [--out draft/frames] [--fmt jpg|png]
// Film mode: 150-frame chunks with .ok markers (resumable); prints "done" only if every chunk + file is present.
import fs from 'node:fs';
import path from 'node:path';
import { openFilm, opt, args, WORK } from './lib.mjs';

const mode = args[0] || 'stills', FPS = 24, FMT = opt('fmt', mode === 'film' ? 'jpg' : 'png'), MINKB = FMT === 'jpg' ? 25 : 150;
const { page, info, close } = await openFilm({ port: +opt('port', mode === 'film' ? 9102 : 9103), query: opt('query', '') });
console.log(JSON.stringify(info));
async function frame(t) { const t0 = Date.now(); const url = await page.evaluate(({ t, fmt }) => window.renderFrame(t, { fmt }), { t, fmt: FMT });
  return { buf: Buffer.from(url.split(',')[1], 'base64'), ms: Date.now() - t0 }; }
if (mode === 'stills') {
  const out = path.resolve(WORK, opt('out', 'stills')), prefix = opt('prefix', 'key_'); fs.mkdirSync(out, { recursive: true });
  const times = opt('times', '0').split(',').map(Number);
  for (const t of times) { const { buf, ms } = await frame(t); const f = path.join(out, `${prefix}${t.toFixed(2)}.${FMT}`); fs.writeFileSync(f, buf); console.log(`t=${t.toFixed(2)}  ${ms} ms  ${(buf.length / 1024).toFixed(0)} KB`); }
} else if (mode === 'film') {
  const out = path.resolve(WORK, opt('out', 'draft/frames')); fs.mkdirSync(out, { recursive: true });
  const from = +opt('from', 0), to = +opt('to', 1392), CH = +opt('chunk', 150);
  const chunks = []; for (let c = Math.floor(from / CH); c * CH < to; c++) chunks.push(c);
  let tot = 0, nf = 0;
  for (const c of chunks) {
    const dir = path.join(out, `chunk_${String(c).padStart(4, '0')}`), ok = dir + '.ok';
    if (fs.existsSync(ok)) { console.log(`chunk ${c}: ok, skipped`); continue; }
    fs.mkdirSync(dir, { recursive: true });
    for (let f = Math.max(from, c * CH); f < Math.min(to, (c + 1) * CH); f++) {
      const fp = path.join(dir, `f_${String(f).padStart(5, '0')}.${FMT}`);
      if (fs.existsSync(fp) && fs.statSync(fp).size > MINKB * 1024) continue;
      const { buf, ms } = await frame(f / FPS); fs.writeFileSync(fp + '.tmp', buf); fs.renameSync(fp + '.tmp', fp); tot += ms; nf++;
      if (f % 24 === 0) console.log(`frame ${f}  ${ms} ms  (avg ${(tot / nf).toFixed(0)} ms)`);
    }
    if (Math.min(to, (c + 1) * CH) === (c + 1) * CH || to >= 1392) fs.writeFileSync(ok, new Date().toISOString()); console.log(`chunk ${c} ok`);
  }
  let bad = 0; for (const c of chunks) { const dir = path.join(out, `chunk_${String(c).padStart(4, '0')}`);
    for (let f = Math.max(from, c * CH); f < Math.min(to, (c + 1) * CH); f++) { const fp = path.join(dir, `f_${String(f).padStart(5, '0')}.${FMT}`);
      if (!fs.existsSync(fp) || fs.statSync(fp).size < MINKB * 1024) { bad++; console.log('missing/small', fp); } } }
  console.log(nf ? `avg render ${(tot / nf).toFixed(0)} ms/frame over ${nf} frames` : 'no new frames');
  console.log(bad ? `INCOMPLETE: ${bad} problems` : 'done');
}
await close();
