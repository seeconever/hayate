// Keyframes + light test: renders labelled stills, measures YAVG / SATAVG (ffmpeg signalstats, tv range) and Clawd's body
// hue / sat / val (window.__hsv() after each frame), writes WORK/<out>/meas.json and (--sheet 1) the labelled contact sheet
// WORK/<out>/keyframes.jpg (the 12 default keys = docs/keyframes.jpg).
//   node tools/keys.mjs [--times 3.5,12,...] [--labels "a|b|..."] [--query "&x=1"] [--sheet 1] [--sheetname x.jpg] [--out keys] [--cols 4] [--w 960]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openPage, opt, WORK, ffmpeg, drawFont } from './lib.mjs';

const KEYS = [[1.5, 's01 the dive'], [4.0, 's02 kitchen'], [9.0, 's04 scan'], [12.4, 's06 avenue'], [17.2, 's08 slide'], [22.5, 's10 face'], [25.2, 's11 truck'], [26.7, 's12 the jump'], [44.3, 's20 the frog'], [46.2, 's20 ramen'], [51.6, 's22 deflated'], [54.5, 's22 laugh']];
const times = opt('times') ? opt('times').split(',').map(Number) : KEYS.map(k => k[0]);
const labels = opt('labels') ? opt('labels').split('|') : (opt('times') ? times.map(() => '') : KEYS.map(k => k[1]));
const outDir = path.resolve(WORK, opt('out', 'keys')); fs.mkdirSync(outDir, { recursive: true });
function stats(file) { const out = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-vf', 'signalstats,metadata=mode=print:file=-', '-f', 'null', '-'], { encoding: 'utf8' });
  const g = (k) => +(out.match(new RegExp(`signalstats\\.${k}=([\\d.]+)`)) || [])[1]; return { yavg: g('YAVG'), sat: g('SATAVG') }; }
const { page, close } = await openPage({ port: +opt('port', 9101), query: opt('query', '') });
const meas = [];
for (let i = 0; i < times.length; i++) { const t = times[i], t0 = Date.now();
  const url = await page.evaluate((t) => window.renderFrame(t, { fmt: 'png' }), t); const ms = Date.now() - t0;
  const hsv = await page.evaluate(() => window.__hsv ? window.__hsv() : null);
  const f = path.join(outDir, `k_${t.toFixed(2)}.png`); fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  const s = stats(f); meas.push({ t, label: labels[i] || '', ...s, hsv, ms, file: f });
  console.log(`${t.toFixed(2).padStart(6)}  ${ms} ms  Y ${s.yavg.toFixed(1)}  S ${s.sat.toFixed(1)}` + (hsv && hsv.hue != null ? `  Clawd h ${hsv.hue.toFixed(1)} s ${hsv.sat.toFixed(2)} v ${hsv.val.toFixed(2)} (n ${hsv.n})` : '') + `  ${labels[i] || ''}`);
}
fs.writeFileSync(path.join(outDir, 'meas.json'), JSON.stringify(meas, null, 1));
await close();
if (opt('sheet', '0') === '1') {
  const W = +opt('w', 960), H = Math.round(W * 9 / 16), cols = +opt('cols', 4);
  const esc = (s) => s.replace(/\\/g, '').replace(/:/g, '\\:').replace(/'/g, '').replace(/%/g, '\\%');
  const parts = meas.map((m, i) => { const txt = `${m.t.toFixed(1)} s  ${m.label}   Y ${m.yavg.toFixed(0)} S ${m.sat.toFixed(0)}` + (m.hsv && m.hsv.hue != null && m.hsv.n > 20 ? `  Clawd h ${m.hsv.hue.toFixed(0)} s ${m.hsv.sat.toFixed(2)}` : '');
    return `[${i}:v]scale=${W}:${H}:flags=lanczos,drawbox=x=0:y=0:w=${W}:h=30:color=black@0.55:t=fill,drawtext=${drawFont}text='${esc(txt)}':x=10:y=7:fontsize=${Math.round(W / 52)}:fontcolor=white[v${i}]`; });
  const layout = meas.map((m, i) => `${(i % cols) * W}_${Math.floor(i / cols) * H}`).join('|');
  const fc = parts.join(';') + ';' + meas.map((m, i) => `[v${i}]`).join('') + `xstack=inputs=${meas.length}:layout=${layout}:fill=black[out]`;
  const out = opt('sheetname') ? path.join(outDir, opt('sheetname')) : path.join(outDir, 'keyframes.jpg');
  execFileSync(ffmpeg, ['-y', '-v', 'error', ...meas.flatMap(m => ['-i', m.file]), '-filter_complex', fc, '-map', '[out]', '-frames:v', '1', '-q:v', '3', out]);
  console.log('sheet ->', out, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
}
