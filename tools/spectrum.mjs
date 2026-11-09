// Sound check: average power in 6 bands per section of the mastered soundtrack + RMS (the freeze section must be silent).
//   node tools/spectrum.mjs [--wav sound/master.wav]   -> prints a table, writes WORK/sound/spectrum.json
import fs from 'node:fs'; import path from 'node:path'; import { opt, WORK } from './lib.mjs';
const f = path.resolve(WORK, opt('wav', 'sound/master.wav')), b = fs.readFileSync(f); let o = 12, fmt, data;
while (o < b.length) { const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4); if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }; if (id === 'data') data = [o + 8, sz]; o += 8 + sz + (sz & 1); }
const n = data[1] / (fmt.bits / 8) / 2, sr = fmt.sr, rd = (i) => fmt.tag === 3 ? b.readFloatLE(data[0] + i * 4) : b.readIntLE(data[0] + i * 3, 3) / 8388608;
const mono = new Float32Array(n); for (let i = 0; i < n; i++) mono[i] = 0.5 * (rd(2 * i) + rd(2 * i + 1));
function fft(re, im) { const N = re.length; for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= N; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k), xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
    re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi; } } }
const BANDS = [[20, 150], [150, 600], [600, 2500], [2500, 6000], [6000, 10000], [10000, 20000]], N = 4096, win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
const SECT = [['rain+piano 0-18', 0.5, 17.9], ['silence 18.35-19.95', 18.35, 19.95], ['pad 20-26', 20.2, 26], ['chimes 26-40.5', 26, 40.5], ['gold 41-44.5', 41.2, 44.5], ['end card 44.5-50', 44.5, 49.5]], out = {};
console.log('section'.padEnd(22) + BANDS.map(([a, c]) => `${a}-${c}`.padStart(11)).join('') + '   RMS dBFS');
for (const [name, t0, t1] of SECT) { const acc = new Float64Array(BANDS.length); let frames = 0, e = 0;
  for (let s = Math.round(t0 * sr); s + N < t1 * sr; s += N / 2) { const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) { re[i] = mono[s + i] * win[i]; e += mono[s + i] ** 2; } fft(re, im);
    for (let k = 1; k < N / 2; k++) { const fq = k * sr / N, p = re[k] ** 2 + im[k] ** 2; BANDS.forEach(([a, c], bi) => { if (fq >= a && fq < c) acc[bi] += p; }); } frames++; }
  const rms = 10 * Math.log10(e / (frames * N) + 1e-20), db = [...acc].map(v => 10 * Math.log10(v / frames + 1e-20));
  const top = Math.max(...db); out[name] = { rms: +rms.toFixed(1), bands: db.map(v => +(v - top).toFixed(1)) };
  console.log(name.padEnd(22) + db.map(v => (v - top).toFixed(1).padStart(11)).join('') + `   ${rms.toFixed(1)}`); }
fs.writeFileSync(path.join(WORK, 'sound', 'spectrum.json'), JSON.stringify(out, null, 1));
