// Runs JS in the film page (index.html?render=1) and prints the return value as JSON. The body is an async function body;
// window.__dbg exposes the scene, the characters and setupFrame(f).
//   node tools/probe.mjs --js tools/collide.js        node tools/probe.mjs --expr "return window.__info()"
import fs from 'node:fs';
import { openPage, opt } from './lib.mjs';
const { page, close } = await openPage({ port: 9109, query: opt('query', '') });
const body = opt('js') ? fs.readFileSync(opt('js'), 'utf8') : opt('expr', 'return window.__info()');
console.log(JSON.stringify(await page.evaluate(new Function(`return (async () => { ${body} })()`)), null, 1));
await close();

