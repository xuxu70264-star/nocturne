/* cdp.mjs — drive headless Chrome over the DevTools protocol to screenshot and
   probe the page. No dependencies: Node's built-in fetch + WebSocket.

   node tools/cdp.mjs --url "http://127.0.0.1:4173/?still=1&t=27" \
                      --out shots/stage.png --w 1600 --h 900 --wait 2500 \
                      --eval "document.querySelector('#btn-playlist').click()"
*/

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  args.set(key, process.argv[i + 1]);
}

const URL_ = args.get('url') || 'http://127.0.0.1:4173/';
const OUT = args.get('out');
const W = Number(args.get('w') || 1600);
const H = Number(args.get('h') || 900);
const DSF = Number(args.get('dsf') || 1);
const WAIT = Number(args.get('wait') || 2600);
const EVAL = args.get('eval') || '';
const PORT = Number(args.get('port') || 9333);

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error('no chrome found');
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu-sandbox',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=' + W + ',' + H,
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch (err) { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('devtools did not start');
}

class Rpc {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.logs = [];
    this.ready = new Promise((resolve) => (this._resolve = resolve));
    this.ws.addEventListener('open', () => this._resolve());
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        this.logs.push(`[${msg.params.type}] ${text}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.logs.push(`[exception] ${d.text} ${d.exception?.description || ''}`);
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.logs.push(`[log] ${msg.params.entry.text}`);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

try {
  const wsUrl = await endpoint();
  const rpc = new Rpc(wsUrl);
  await rpc.ready;

  const { targetId } = await rpc.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await rpc.send('Target.attachToTarget', { targetId, flatten: true });

  await rpc.send('Page.enable', {}, sessionId);
  await rpc.send('Runtime.enable', {}, sessionId);
  await rpc.send('Log.enable', {}, sessionId);
  await rpc.send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: DSF,
    mobile: W < 600
  }, sessionId);

  await rpc.send('Page.navigate', { url: URL_ }, sessionId);
  await sleep(WAIT);

  if (EVAL) {
    const res = await rpc.send('Runtime.evaluate', {
      expression: EVAL,
      awaitPromise: true,
      returnByValue: true
    }, sessionId);
    if (res.exceptionDetails) {
      console.error('eval error:', res.exceptionDetails.text, res.exceptionDetails.exception?.description);
    } else if (res.result && res.result.value !== undefined) {
      console.log('eval =>', JSON.stringify(res.result.value));
    }
    await sleep(700);
  }

  const probe = await rpc.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      vw: innerWidth, vh: innerHeight,
      selftest: document.body.dataset.selftest || '',
      title: document.title,
      audio: (() => { const a = document.getElementById('audio'); return a ? { t: +a.currentTime.toFixed(2), dur: +(a.duration || 0).toFixed(1), paused: a.paused, ready: a.readyState } : null; })()
    })`,
    returnByValue: true
  }, sessionId);
  console.log('page =>', probe.result.value);

  if (OUT) {
    const shot = await rpc.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'kb');
  }

  if (rpc.logs.length) {
    console.log('--- console');
    for (const line of rpc.logs) console.log(line);
  } else {
    console.log('--- console clean');
  }

  await rpc.send('Target.closeTarget', { targetId });
  rpc.ws.close();
} catch (err) {
  console.error('shot failed:', err.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  process.exit();
}
