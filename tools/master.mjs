// Soundtrack, step 2: mastering in Node. Loudness to -14 LUFS (ffmpeg ebur128), lookahead true-peak limiter (4x oversampled
// detection, never more than 3 dB of gain reduction), 24-bit WAV out + AAC 192k soundtrack.m4a for the player; if the silent
// video exists it muxes it with the AAC and re-measures the encoded AAC.
//   node tools/master.mjs [--ceiling -3.0] [--target -14] [--video final/video_noaudio.mp4] [--out final/video.mp4]  (paths in WORK)
//   -> WORK/sound/master.wav, master.json, soundtrack.m4a
// The film was mastered with --ceiling -2.2 (npm run audio): -14 LUFS, -2.1 dBTP after AAC.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync, spawnSync } from 'node:child_process';
import { opt, WORK, ffmpeg } from './lib.mjs';
const SD = path.join(WORK, 'sound');
let CEIL = +opt('ceiling', -3.0); const TARGET = +opt('target', -14), VIDEO = path.resolve(WORK, opt('video', 'final/video_noaudio.mp4'));
const OUTV = path.resolve(WORK, opt('out', 'final/video.mp4'));
function readWav(p) { const b = fs.readFileSync(p); let o = 12, fmt = null, data = null;
  while (o < b.length) { const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4); if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }; if (id === 'data') data = [o + 8, sz]; o += 8 + sz + (sz & 1); }
  const n = data[1] / (fmt.bits / 8) / fmt.ch, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { if (fmt.tag === 3) { L[i] = b.readFloatLE(data[0] + i * 8); R[i] = b.readFloatLE(data[0] + i * 8 + 4); } else { L[i] = b.readIntLE(data[0] + i * 6, 3) / 8388608; R[i] = b.readIntLE(data[0] + i * 6 + 3, 3) / 8388608; } }
  return { L, R, sr: fmt.sr }; }
function writeWav24(p, L, R, sr) { const n = L.length, b = Buffer.alloc(44 + n * 6); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 6, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 6, 28); b.writeUInt16LE(6, 32); b.writeUInt16LE(24, 34); b.write('data', 36); b.writeUInt32LE(n * 6, 40);
  let seed = 12345; const tpdf = () => { seed = (seed * 1664525 + 1013904223) >>> 0; const a = seed / 4294967296; seed = (seed * 1664525 + 1013904223) >>> 0; return a - seed / 4294967296; };
  for (let i = 0; i < n; i++) for (const [c, v] of [[0, L[i]], [1, R[i]]]) { const q = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388607 + tpdf()))); b.writeIntLE(q, 44 + i * 6 + c * 3, 3); }
  fs.writeFileSync(p, b); }
function ebur(file) { const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = r.stderr; const sum = s.slice(s.lastIndexOf('Summary:')); const I = +(/I:\s+(-?[\d.]+) LUFS/.exec(sum) || [])[1]; const TP = +(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum) || [])[1]; const LRA = +(/LRA:\s+(-?[\d.]+) LU/.exec(sum) || [])[1]; return { I, TP, LRA }; }
// 4x oversampled peak (windowed sinc, 16 taps) for true-peak detection
const OS = 4, TAPS = 8, KER = (() => { const k = []; for (let p = 1; p < OS; p++) { const row = []; for (let j = -TAPS + 1; j <= TAPS; j++) { const x = j - p / OS, w = 0.5 + 0.5 * Math.cos(Math.PI * x / TAPS); row.push(x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x) * w); } k.push(row); } return k; })();
function truePeakEnv(L, R) { const n = L.length, pk = new Float32Array(n);
  for (let i = 0; i < n; i++) { let m = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    for (const X of [L, R]) for (const row of KER) { let s = 0; for (let j = 0; j < row.length; j++) { const idx = i + j - TAPS + 1; if (idx >= 0 && idx < n) s += X[idx] * row[j]; } m = Math.max(m, Math.abs(s)); }
    pk[i] = m; } return pk; }
function limit(L, R, sr, ceilDb) { const ceil = Math.pow(10, ceilDb / 20), look = Math.round(0.005 * sr), rel = Math.exp(-1 / (0.08 * sr)), n = L.length;
  const pk = truePeakEnv(L, R), need = new Float32Array(n); for (let i = 0; i < n; i++) need[i] = Math.min(1, ceil / Math.max(pk[i], 1e-9));
  // minimum over the lookahead window, then smooth: instant attack (already looking ahead), exponential release
  const g = new Float32Array(n); const dq = []; // sliding minimum
  for (let i = 0; i < n + look; i++) { if (i < n) { while (dq.length && need[dq[dq.length - 1]] >= need[i]) dq.pop(); dq.push(i); } const o = i - look; if (o < 0) continue; while (dq[0] < o) dq.shift(); g[o] = need[dq[0]] ?? 1; }
  // ramp into each reduction over the lookahead (linear), release exponentially
  const out = new Float32Array(n); let cur = 1;
  for (let i = 0; i < n; i++) { const target = g[i]; cur = target < cur ? target : 1 - (1 - cur) * rel; if (cur > target) cur = target; out[i] = cur; }
  for (let i = n - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] + 1 / look);   // linear attack across the lookahead (no steps)
  let maxGR = 0; const Lo = new Float32Array(n), Ro = new Float32Array(n);
  for (let i = 0; i < n; i++) { Lo[i] = L[i] * out[i]; Ro[i] = R[i] * out[i]; maxGR = Math.max(maxGR, -20 * Math.log10(out[i])); }
  return { L: Lo, R: Ro, maxGR }; }
const raw = readWav(path.join(SD, 'raw.wav')); const m0 = ebur(path.join(SD, 'raw.wav'));
console.log(`raw: ${m0.I} LUFS, TP ${m0.TP} dBTP, LRA ${m0.LRA}`);
let gainDb = TARGET - m0.I, res, m1, tmp = path.join(SD, '_tmp.wav');
for (let it = 0; it < 4; it++) {
  const k = Math.pow(10, gainDb / 20); const L = raw.L.map(v => v * k), R = raw.R.map(v => v * k);
  res = limit(L, R, raw.sr, CEIL); writeWav24(tmp, res.L, res.R, raw.sr); m1 = ebur(tmp);
  console.log(`iter ${it}: gain ${gainDb.toFixed(2)} dB, limiter max GR ${res.maxGR.toFixed(2)} dB -> ${m1.I} LUFS, TP ${m1.TP} dBTP`);
  if (Math.abs(m1.I - TARGET) < 0.1) break; gainDb += TARGET - m1.I;
}
fs.renameSync(tmp, path.join(SD, 'master.wav'));
execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', path.join(SD, 'master.wav'), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', path.join(SD, 'soundtrack.m4a')]);
console.log('master.wav + soundtrack.m4a (AAC 192k, for the player) in', SD);
fs.writeFileSync(path.join(SD, 'master.json'), JSON.stringify({ raw: m0, master: m1, gainDb, ceiling: CEIL, maxGR: res.maxGR }, null, 1));
if (res.maxGR > 3.0) console.log('WARNING: limiter took more than 3 dB');
if (fs.existsSync(VIDEO)) {
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', VIDEO, '-i', path.join(SD, 'master.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-shortest', OUTV]);
  const m2 = ebur(OUTV); console.log(`encoded AAC in ${OUTV}: ${m2.I} LUFS, TP ${m2.TP} dBTP`);
  fs.writeFileSync(path.join(SD, 'master.json'), JSON.stringify({ raw: m0, master: m1, aac: m2, gainDb, ceiling: CEIL, maxGR: res.maxGR }, null, 1));
  if (m2.TP > -2.0) console.log(`AAC true peak ${m2.TP} > -2.0: rerun with --ceiling ${(CEIL - (m2.TP + 2.0) - 0.2).toFixed(1)}`);
}
