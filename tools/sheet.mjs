// Labelled contact sheet from stills in WORK (ffmpeg xstack + drawtext), e.g. after tools/render.mjs stills.
//   node tools/sheet.mjs [--dir stills] [--prefix key_] [--times 0.3,...] [--digits 2] [--labels "a|b"] [--cols 4] [--w 960] [--out keys_sheet.png]
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { opt, WORK, ffmpeg, drawFont } from './lib.mjs';
const dir = path.resolve(WORK, opt('dir', 'stills')), prefix = opt('prefix', 'key_'), cols = +opt('cols', 4), W = +opt('w', 960), H = Math.round(W * 9 / 16);
const times = opt('times', '0.3,2.4,3.6,6.5,9.8,11.2,12.4,15.5').split(',').map(Number);
const labels = (opt('labels', '') || '').split('|');
const files = times.map(t => path.join(dir, `${prefix}${t.toFixed(+opt('digits', 1))}.${opt('ext', 'png')}`)).filter(f => fs.existsSync(f));
const inputs = files.flatMap(f => ['-i', f]);
const parts = files.map((f, i) => `[${i}:v]scale=${W}:${H}:flags=lanczos,drawbox=x=0:y=0:w=${W}:h=34:color=black@0.55:t=fill,drawtext=${drawFont}text='${(times[i].toFixed(2) + ' s' + (labels[i] ? '  ' + labels[i] : '')).replace(/:/g, '\\:')}':x=12:y=8:fontsize=22:fontcolor=white[v${i}]`);
const layout = files.map((f, i) => `${(i % cols) * W}_${Math.floor(i / cols) * H}`).join('|');
const fc = parts.join(';') + ';' + files.map((f, i) => `[v${i}]`).join('') + `xstack=inputs=${files.length}:layout=${layout}:fill=black[out]`;
const out = path.resolve(dir, opt('out', 'keys_sheet.png'));
execFileSync(ffmpeg, ['-y', '-v', 'error', ...inputs, '-filter_complex', fc, '-map', '[out]', '-frames:v', '1', '-q:v', '2', out]);
console.log('sheet ->', out);

