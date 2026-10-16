// Takes the screenshots in docs/img by driving headless Chrome over the DevTools protocol
// (no extra dependencies; Node >= 22 has WebSocket built in). Expects the demo server from
// setup.sh on :3100. Usage: node shots.mjs <baseUrl> <outDir> <profileDir>
// Chrome binary: $CHROME, default the macOS install path.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, outDir, profileDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chromePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  `--user-data-dir=${profileDir}`, '--remote-debugging-port=9333', 'about:blank',
], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 50; i++) {
  try {
    targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
    if (targets.some((t) => t.type === 'page')) break;
  } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); })
    .then((m) => { if (m.error) throw new Error(`${method}: ${JSON.stringify(m.error)}`); return m.result; });

const WIDTH = 1280;
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`JS failed: ${expression}\n${JSON.stringify(r.exceptionDetails)}`);
  return r.result.value;
}
async function waitFor(expression, ms = 8000) {
  for (let t = 0; t < ms; t += 100) { if (await js(expression)) return; await sleep(100); }
  throw new Error(`timeout waiting for ${expression}`);
}
async function go(path, readyExpr) {
  await send('Page.navigate', { url: base + path });
  await waitFor(`document.readyState === 'complete'`);
  await js(HELPERS);
  if (readyExpr) await waitFor(readyExpr);
  await sleep(400);
}
// DOM helpers inside the page, injected after every navigation.
const HELPERS = `
  window.$btn = (text, root = document) => [...root.querySelectorAll('button, a')].find((b) => b.textContent.trim().includes(text));
  window.$type = (sel, value) => { const el = document.querySelector(sel); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  window.$select = (sel, value) => { const el = document.querySelector(sel); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
  true`;

/** Screenshot of the page; `clip` in document coordinates, default = full page up to maxHeight. */
async function shot(name, { clip, maxHeight = 1400 } = {}) {
  await sleep(300);
  let c = clip;
  if (!c) {
    const h = await js(`Math.min(${maxHeight}, document.documentElement.scrollHeight)`);
    c = { x: 0, y: 0, width: WIDTH, height: h };
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...c, scale: 1 } });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
  console.log('saved', name, `${c.width}x${Math.round(c.height)}`);
}
/** Document rect of an element (expression returning the element), padded. */
async function rectOf(expr, pad = 12) {
  return js(`(() => { const el = ${expr}; const r = el.getBoundingClientRect();
    return { x: 0, y: Math.max(0, r.top + scrollY - ${pad}), width: ${WIDTH}, height: r.height + ${2 * pad} }; })()`);
}

try {
  // 1. Scan with results
  await go('/scan', `document.querySelector('input[name=range]')`);
  await js(`$type('input[name=range]', '10.99.0.0/24')`);
  await sleep(200);
  await js(`$btn('Scan starten').click()`);
  await waitFor(`document.body.textContent.includes('254 von 254') && document.body.textContent.includes('Abgeschlossen')`, 15000);
  await shot('scan', { maxHeight: 700 });

  // 2. Inventory
  await go('/inventar', `document.querySelectorAll('tbody tr').length >= 6`);
  await shot('inventar', { maxHeight: 420 });

  // 3. Firmware check of all devices
  await js(`$btn('Alle auf Updates prüfen').click()`);
  await waitFor(`!!$btn('Prüfung starten')`);
  await js(`$btn('Prüfung starten').click()`);
  await waitFor(`document.body.textContent.includes('von 6 geprüft') && !!$btn('Schliessen')`, 15000);
  await shot('firmware-pruefung', { maxHeight: 560 });

  // 4. Device detail (Boiler)
  await go('/inventar/A8032AB12345', `document.body.textContent.includes('Letzte Aktionen')`);
  const actions = await rectOf(`[...document.querySelectorAll('section.card')].find((s) => s.textContent.includes('Letzte Aktionen'))`, 0);
  await shot('geraet', { clip: { x: 0, y: 0, width: WIDTH, height: actions.y + actions.height + 16 } });

  // 5. Config comparison: newest vs. older snapshot
  const options = await js(`[...document.querySelectorAll('select[name=compare] option')].map((o) => o.value).filter(Boolean)`);
  await js(`$select('select[name=compare]', '${options[options.length - 1]}')`);
  await waitFor(`!!document.querySelector('table.diff')`);
  await shot('config-vergleich', { clip: await rectOf(`[...document.querySelectorAll('section.card')].find((s) => s.textContent.includes('Konfiguration'))`) });

  // 6. Reset dialog (not confirmed)
  await go('/inventar/E868E7A1B2C3', `!!$btn('Werkseinstellungen')`);
  await js(`$btn('Werkseinstellungen').click()`);
  await waitFor(`!!document.querySelector('input[name=confirm]')`);
  await js(`$type('input[name=confirm]', 'Licht Keller')`);
  await js(`window.scrollTo(0, 0)`);
  await shot('reset-dialog', { clip: { x: 0, y: 0, width: WIDTH, height: 800 } });

  // 7. Template editor
  await go('/templates/1', `document.querySelector('input[name=name]')?.value === 'Haus-Standard'`);
  const eco = await rectOf(`[...document.querySelectorAll('fieldset')].find((f) => f.textContent.includes('Eco-Modus und LED'))`, 0);
  await shot('template-editor', { clip: { x: 0, y: 0, width: WIDTH, height: eco.y + eco.height + 16 } });

  // 8. Apply template: preview, apply, expand one result
  await go('/templates/1/anwenden', `document.body.textContent.includes('Änderung')`);
  await js(`$btn('nur mit Änderungen').click()`);
  await sleep(300);
  await js(`$type('input[name=password]', 'gen2-secret')`);
  await sleep(200);
  await js(`$btn('Geräte anwenden').click()`);
  await waitFor(`!!$btn('Ja, anwenden')`);
  await js(`$btn('Ja, anwenden').click()`);
  await waitFor(`document.body.textContent.includes('erfolgreich')`, 20000);
  await sleep(800);
  await js(`[...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Rollladen')).querySelector('button.preview').click()`);
  await shot('template-anwenden', { maxHeight: 1300 });

  // 9. Log
  await go('/protokoll', `document.querySelectorAll('tbody tr').length > 5`);
  await shot('protokoll', { maxHeight: 820 });
} finally {
  ws.close();
  chrome.kill();
}
