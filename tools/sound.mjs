// Soundtrack, step 1: exports the film's event list (window.__events()) and synthesizes it in Chromium (audio.html, OfflineAudioContext).
//   node tools/sound.mjs  -> WORK/sound/events.json, WORK/sound/raw.wav (48 kHz stereo float32). Then tools/master.mjs.
import fs from 'node:fs';
import { openFilm, workPath } from './lib.mjs';
const { page, close } = await openFilm({ port: 9104, viewport: { width: 960, height: 540 } });
const data = await page.evaluate(() => window.__events());
fs.writeFileSync(workPath('sound', 'events.json'), JSON.stringify(data, null, 1));
const counts = {}; data.events.forEach(e => counts[e.type] = (counts[e.type] || 0) + 1); console.log('events:', data.events.length, JSON.stringify(counts));
await page.goto(page.url().replace(/index\.html.*$/, 'audio.html'));
await page.waitForFunction(() => window.renderSound, null, { timeout: 30000 });
const t0 = Date.now(); const r = await page.evaluate((d) => window.renderSound(d), data); console.log('synth', Date.now() - t0, 'ms', JSON.stringify(r.stats), 'silence', r.silence);
const L = new Float32Array(Buffer.from(r.L, 'base64').buffer.slice(0)), R = new Float32Array(Buffer.from(r.R, 'base64').buffer.slice(0));
const n = L.length, buf = Buffer.alloc(44 + n * 8);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 8, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(48000 * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34); buf.write('data', 36); buf.writeUInt32LE(n * 8, 40);
for (let i = 0; i < n; i++) { buf.writeFloatLE(L[i], 44 + i * 8); buf.writeFloatLE(R[i], 48 + i * 8); }
fs.writeFileSync(workPath('sound', 'raw.wav'), buf);
let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
console.log(`raw.wav ${n} samples/ch (${(n / 48000).toFixed(2)} s), sample peak ${(20 * Math.log10(pk)).toFixed(2)} dBFS`);
await close();
