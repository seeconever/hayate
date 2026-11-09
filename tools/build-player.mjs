// Single-file offline player: dist/hayate.html (player/player.html + everything inlined).
// Inlines every ES module reachable from src/hayate.js (three.js included; import specifiers rewritten to bare keys that a runtime
// import map resolves to blob: URLs), the mascot files under src/clawd (answered to fetch() from memory; import.meta.url in the
// inlined modules points at a fake https://hayate.invalid/ base) and the AAC soundtrack (WORK/sound/soundtrack.m4a from
// tools/master.mjs). The result plays with sound from file://, with no network.
//   node tools/build-player.mjs [--no-audio]
import fs from 'node:fs';
import path from 'node:path';
import { REPO, WORK, flag } from './lib.mjs';

const posix = (p) => p.split(path.sep).join('/');
const VEND = path.join(REPO, 'vendor', 'three'), JSM = path.join(VEND, 'examples', 'jsm'), CORE = path.join(VEND, 'build', 'three.module.js');
const BASE = 'https://hayate.invalid/';
const keyOf = (abs) => abs === CORE ? 'three' : abs.startsWith(JSM + path.sep) ? 'three/addons/' + posix(path.relative(JSM, abs)) : '@hayate/' + posix(path.relative(REPO, abs));
function resolve(spec, from) {
  if (spec === 'three') return CORE;
  if (spec.startsWith('three/addons/')) return path.join(JSM, spec.slice('three/addons/'.length));
  if (spec.startsWith('./') || spec.startsWith('../')) return path.resolve(path.dirname(from), spec);
  return null;
}
const modules = {}, seen = new Set(), RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\2/g;
function visit(abs) {
  if (seen.has(abs)) return; seen.add(abs);
  let src = fs.readFileSync(abs, 'utf8');
  src = src.replace(RE, (m, pre, q, spec) => {
    const r = resolve(spec, abs); if (!r) return m;
    if (!fs.existsSync(r)) { if (!/^\s*\/\//.test(src.slice(src.lastIndexOf('\n', src.indexOf(m)) + 1, src.indexOf(m)))) console.log(`WARNING: ${spec} (from ${posix(path.relative(REPO, abs))}) not found`); return m; }
    visit(r); return `${pre}${q}${keyOf(r)}${q}`;
  });
  if (!abs.startsWith(VEND + path.sep)) src = src.replace(/\bimport\.meta\.url\b/g, JSON.stringify(BASE + posix(path.relative(REPO, abs))));
  modules[keyOf(abs)] = src;
}
visit(path.join(REPO, 'src', 'hayate.js'));

const assets = {}, MIME = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.m4a': 'audio/mp4' };
(function walk(d) {
  for (const f of fs.readdirSync(d)) { const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (!p.endsWith('.js')) assets[posix(path.relative(REPO, p))] = { type: MIME[path.extname(p)] || 'application/octet-stream', data: fs.readFileSync(p).toString('base64') }; }
})(path.join(REPO, 'src', 'clawd'));
const m4a = path.join(WORK, 'sound', 'soundtrack.m4a');
if (!flag('no-audio')) {
  if (fs.existsSync(m4a)) assets['soundtrack.m4a'] = { type: 'audio/mp4', data: fs.readFileSync(m4a).toString('base64') };
  else console.log(`WARNING: no soundtrack at ${m4a} (run npm run audio first) -> silent player`);
}
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const html = fs.readFileSync(path.join(REPO, 'player', 'player.html'), 'utf8')
  .replace('__TITLE__', 'HAYATE · 疾風').replace('__BASE__', BASE)
  .replace('/*__MODULES__*/', () => json(modules)).replace('/*__ASSETS__*/', () => json(assets));
fs.mkdirSync(path.join(REPO, 'dist'), { recursive: true });
const out = path.join(REPO, 'dist', 'hayate.html'); fs.writeFileSync(out, html);
console.log(`dist/hayate.html: ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB, ${Object.keys(modules).length} modules, ${Object.keys(assets).length} assets${assets['soundtrack.m4a'] ? ' (soundtrack included)' : ' (silent)'}`);
