// HAYATE 疾風 · shared tool helpers: a static server on the repo root, headless GPU Chromium (Playwright) that refuses a software
// renderer, the film page loader, and the WORK dir for heavy outputs (frames, WAV, MP4), which stay outside the repo.
//   WORK    = env HAYATE_WORK, else <os temp dir>/hayate-work
//   CHROME  = path to a Chrome / Chromium binary (optional; default = Playwright's Chromium)
//   FFMPEG / FFPROBE = ffmpeg / ffprobe binaries (default: from PATH);  FONT = a .ttf for ffmpeg drawtext labels (optional)
//   --port N   first port to try (each tool has its own default in 9100-9109; the next free one is used)
//   --allow-sw run on a software renderer anyway (slow, and it will not match the GPU frames)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = REPO, FILMDIR = REPO;
export const WORK = path.resolve(process.env.HAYATE_WORK || path.join(os.tmpdir(), 'hayate-work'));
export const PAGE = 'index.html';
export const args = process.argv.slice(2);
export const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
export const flag = (k) => args.includes('--' + k);
export const workPath = (...p) => { const f = path.resolve(WORK, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
export const ffmpeg = process.env.FFMPEG || 'ffmpeg', ffprobe = process.env.FFPROBE || 'ffprobe';
// drawtext font: FONT env, else Consolas on Windows, else ffmpeg's default (fontconfig)
const FONT = process.env.FONT || (process.platform === 'win32' ? 'C:/Windows/Fonts/consola.ttf' : '');
export const drawFont = FONT ? `fontfile='${FONT.replace(/\\/g, '/').replace(/:/g, '\\:')}':` : '';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.pdf': 'application/pdf' };

// static server on the repo root (127.0.0.1 only), first free port from `port`
export async function serve(port = 9100) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const p = path.resolve(REPO, rel || 'index.html');
    if (!p.startsWith(REPO) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(p).pipe(res);
  });
  for (let p = port; p <= Math.max(port, 9109); p++) {
    const ok = await new Promise(r => { server.once('error', () => r(false)); server.listen(p, '127.0.0.1', () => r(true)); });
    if (ok) return { server, port: p, url: `http://127.0.0.1:${p}/`, close: () => new Promise(r => server.close(r)) };
  }
  throw new Error(`no free port in ${port}-${Math.max(port, 9109)}`);
}

export async function browser() {
  const { chromium } = await import('playwright');
  const angle = process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=default';
  return chromium.launch({ headless: !flag('headed'), executablePath: process.env.CHROME || undefined, args: ['--enable-gpu', '--ignore-gpu-blocklist', angle] });
}

// open the film page headless: index.html?render=1<query>. Returns { page, info, close }
export async function openPage({ port = 9100, query = '', viewport = { width: 1920, height: 1080 }, file = PAGE } = {}) {
  const srv = await serve(+opt('port', port));
  const br = await browser();
  const page = await br.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', e => { console.log('[pageerror]', e.message); process.exit(3); });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || /^\[(film|kit)\]/.test(m.text())) console.log('[page]', m.type(), m.text().slice(0, 600)); });
  const t0 = Date.now();
  await page.goto(`${srv.url}${file}?render=1${query}`, { timeout: 300000 });
  await page.waitForFunction(() => window.__info && window.ready, null, { timeout: 300000 });
  await page.evaluate(() => window.ready);
  const info = await page.evaluate(() => window.__info());
  console.log(`renderer: ${info.renderer}   (load ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (/swiftshader|llvmpipe|basic render|software/i.test(info.renderer) && !flag('allow-sw')) { console.error('ABORT: software renderer (use --allow-sw to force)'); await br.close(); await srv.close(); process.exit(2); }
  const close = async () => { await br.close(); await srv.close(); };
  return { page, info, close };
}
export const openFilm = openPage;
