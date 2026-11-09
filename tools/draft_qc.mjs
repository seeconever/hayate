// Encode + QC. Frames in WORK -> silent H.264 MP4 + QC files in WORK/qa:
//   node tools/draft_qc.mjs [--frames draft/frames] [--ext jpg|png] [--outdir draft] [--name draft_noaudio.mp4] [--qa prefix_]
//                           [--crf 18] [--preset medium] [--maxrate 26M --bufsize 52M] [--skip-encode] [--strips "430-445:1,1088-1106:2"]
// -> WORK/<outdir>/<name> (H.264 High, 24 fps CFR, yuv420p, bt709), WORK/qa/sheet16.jpg (16 stills), WORK/qa/lumscan.txt (YAVG per
//    frame, jumps, blank frames, frame-diff outliers), WORK/qa/mpdecimate.txt (near-duplicates), WORK/<outdir>/qc.json
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { opt, args, WORK, ffmpeg, ffprobe, drawFont } from './lib.mjs';

const framesDir = path.resolve(WORK, opt('frames', 'draft/frames')), ext = opt('ext', 'jpg'), out = path.resolve(WORK, opt('outdir', 'draft')), qaDir = path.join(WORK, 'qa'), QP = opt('qa', '');
const qf = (n) => path.join(qaDir, QP + n);
const FPS = 24, N = 1392; fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(qaDir, { recursive: true }); const mp4 = path.join(out, opt('name', 'draft_noaudio.mp4'));
const ff = (a) => execFileSync(ffmpeg, ['-y', '-v', 'error', ...a], { maxBuffer: 1 << 28 });
const fp = (f) => path.join(framesDir, `chunk_${String(Math.floor(f / 150)).padStart(4, '0')}`, `f_${String(f).padStart(5, '0')}.${ext}`);
if (!args.includes('--skip-encode')) {
  const flat = path.join(out, '_flat'); fs.rmSync(flat, { recursive: true, force: true }); fs.mkdirSync(flat, { recursive: true });
  for (let f = 0; f < N; f++) { if (!fs.existsSync(fp(f))) throw new Error('missing ' + fp(f)); fs.linkSync(fp(f), path.join(flat, `f_${String(f).padStart(5, '0')}.${ext}`)); }
  ff(['-framerate', String(FPS), '-i', path.join(flat, `f_%05d.${ext}`), '-c:v', 'libx264', '-profile:v', 'high', '-preset', opt('preset', 'medium'), '-crf', opt('crf', '18'), ...(opt('maxrate') ? ['-maxrate', opt('maxrate'), '-bufsize', opt('bufsize', opt('maxrate'))] : []), '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', '-frames:v', String(N), mp4]);
  fs.rmSync(flat, { recursive: true, force: true }); console.log('encoded', mp4);
}
console.log('ffprobe (w,h,rate,frames):', execFileSync(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames', '-of', 'csv=p=0', mp4]).toString().trim());
const tile = (f, w, label, file) => ff(['-i', fp(f), '-vf', `scale=${w}:-1:flags=lanczos,drawbox=x=0:y=0:w=${w}:h=24:color=black@0.6:t=fill,drawtext=${drawFont}text='${label.replace(/:/g, '\\:')}':x=6:y=4:fontsize=16:fontcolor=white`, '-q:v', '3', file]);
const tmp = path.join(out, '_tmp'); fs.mkdirSync(tmp, { recursive: true });
{ const files = []; for (let i = 0; i < 16; i++) { const f = Math.round((i + 0.5) * N / 16), p = path.join(tmp, `s_${i}.jpg`); tile(f, 480, `f${f}  ${(f / FPS).toFixed(2)} s`, p); files.push(p); }
  ff([...files.flatMap(f => ['-i', f]), '-filter_complex', files.map((f, i) => `[${i}:v]`).join('') + `xstack=inputs=16:layout=${files.map((f, i) => `${(i % 4) * 480}_${Math.floor(i / 4) * 270}`).join('|')}[o]`, '-map', '[o]', '-q:v', '3', qf('sheet16.jpg')]); console.log('qa/sheet16.jpg'); }
// luminance + frame-difference scan on the MP4 (luma reported on the full 0-255 scale)
{ const r = spawnSync(ffmpeg, ['-v', 'error', '-i', mp4, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { maxBuffer: 1 << 28 });
  const TV = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_range', '-of', 'csv=p=0', mp4]).toString().trim() !== 'pc', toFull = (v) => TV ? (v - 16) * 255 / 219 : v;
  const y = [...r.stdout.toString().matchAll(/YAVG=([\d.]+)/g)].map(m => toFull(+m[1]));
  const d = spawnSync(ffmpeg, ['-v', 'error', '-i', mp4, '-vf', 'tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { maxBuffer: 1 << 28 });
  const dif = [...d.stdout.toString().matchAll(/YAVG=([\d.]+)/g)].map(m => +m[1] * (TV ? 255 / 219 : 1));
  const jumps = []; for (let i = 1; i < y.length; i++) if (Math.abs(y[i] - y[i - 1]) > 6) jumps.push(`f${i}: ${y[i - 1].toFixed(1)} -> ${y[i].toFixed(1)}`);
  const blank = y.map((v, i) => [v, i]).filter(([v]) => v < 4).map(([, i]) => i), med = [...dif].sort((a, b) => a - b)[Math.floor(dif.length / 2)], big = dif.map((v, i) => [v, i]).filter(([v]) => v > Math.max(6, med * 6)).map(([v, i]) => `f${i}->${i + 1}: ${v.toFixed(2)}`);
  const zero = dif.map((v, i) => [v, i]).filter(([v]) => v < 0.05).map(([, i]) => i);
  let mj = 0, mjAt = 0; for (let i = 1; i < y.length; i++) { const j = Math.abs(y[i] - y[i - 1]); if (j > mj) { mj = j; mjAt = i; } }
  const q = { frames: y.length, ymin: +Math.min(...y).toFixed(1), ymax: +Math.max(...y).toFixed(1), ymean: +(y.reduce((a, b) => a + b, 0) / y.length).toFixed(1), maxJump: +mj.toFixed(2), maxJumpAt: mjAt, blank: blank.length, zeroDiff: zero.length, diffMedian: +med.toFixed(2) };
  const qj = path.join(out, 'qc.json'); let old = {}; try { old = JSON.parse(fs.readFileSync(qj, 'utf8')); } catch {} fs.writeFileSync(qj, JSON.stringify({ ...old, ...q }, null, 1)); console.log('qc.json', JSON.stringify(q));
  const txt = `YAVG frames ${y.length}: min ${q.ymin}, max ${q.ymax}, mean ${q.ymean}\nblank frames (YAVG<4): ${blank.join(',') || 'none'}\nidentical-to-previous frames (diff<0.05): ${zero.join(',') || 'none'}\nluma jumps > 6: ${jumps.join('; ') || 'none'}\n` +
    `frame diff median ${med.toFixed(2)}; outliers (>6x median and >6): ${big.join('; ') || 'none'}\n` + y.map((v, i) => `${i} ${v.toFixed(2)} ${(dif[i] ?? 0).toFixed(2)}`).join('\n');
  fs.writeFileSync(qf('lumscan.txt'), txt); console.log(txt.split('\n').slice(0, 5).join('\n').slice(0, 900)); }
{ const r = spawnSync(ffmpeg, ['-i', mp4, '-vf', 'mpdecimate', '-loglevel', 'debug', '-f', 'null', '-'], { maxBuffer: 1 << 28 });
  const log = r.stderr.toString(), all = [...log.matchAll(/(keep|drop) pts:(\d+)/g)], drops = all.map((m, i) => [m[1], i]).filter(([k]) => k === 'drop').map(([, i]) => i);
  const txt = `mpdecimate: ${drops.length} near-duplicate frames of ${all.length}: ${drops.join(',') || 'none'}`; fs.writeFileSync(qf('mpdecimate.txt'), txt); console.log(txt.slice(0, 400));
  const qj = path.join(out, 'qc.json'); const o = JSON.parse(fs.readFileSync(qj, 'utf8')); o.mpdecimate = drops.length; fs.writeFileSync(qj, JSON.stringify(o, null, 1)); }
for (const sp of (opt('strips', '') || '').split(',').filter(Boolean)) { const [rg, st = '1'] = sp.split(':'), [a, b] = rg.split('-').map(Number), fr = [];
  for (let f = a; f <= b && fr.length < 12; f += +st) fr.push(f);
  const files = fr.map((f, i) => { const p = path.join(tmp, `x_${i}.jpg`); tile(f, 320, `f${f}`, p); return p; });
  ff([...files.flatMap(f => ['-i', f]), '-filter_complex', files.map((f, i) => `[${i}:v]`).join('') + `hstack=inputs=${files.length}[o]`, '-map', '[o]', '-q:v', '4', qf(`strip_${a}-${b}.jpg`)]); console.log(`qa/${QP}strip_${a}-${b}.jpg`); }
fs.rmSync(tmp, { recursive: true, force: true });
