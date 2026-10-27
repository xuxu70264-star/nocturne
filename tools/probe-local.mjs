/* probe-local.mjs — record the sleeve stack while it is being dragged.
   Drives our own page over CDP: pointerdown on #wheel-stack, a few moves,
   a screenshot after each, then release. No dependencies.

   node tools/probe-local.mjs   → shots/probe/00-rest.png … 04-settled.png
*/

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error('no chrome found');
  process.exit(1);
}

const PORT = Number(process.env.PROBE_PORT || 9444);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu-sandbox',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--window-size=1600,900',
  'about:blank'
], { stdio: 'ignore' });

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(150);
  }
  throw new Error('no devtools');
}

class Rpc {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res) => (this._res = res));
    this.ws.addEventListener('open', () => this._res());
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
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

const out = path.resolve('shots', 'probe');
fs.mkdirSync(out, { recursive: true });

try {
  const rpc = new Rpc(await endpoint());
  await rpc.ready;

  const { targetId } = await rpc.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await rpc.send('Target.attachToTarget', { targetId, flatten: true });
  await rpc.send('Page.enable', {}, sessionId);
  await rpc.send('Runtime.enable', {}, sessionId);
  await rpc.send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  }, sessionId);

  await rpc.send('Page.navigate', { url: 'http://127.0.0.1:4173/?still=1&t=40&wheel=1' }, sessionId);
  await sleep(4200);

  const evalJs = async (expression) => {
    const r = await rpc.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };

  const snap = async (tag) => {
    const info = await evalJs(`(()=>{
      const w = window.__nocturne.wheel;
      const st = document.getElementById('wheel-stack');
      return {
        stackPos: +w.stackPos.toFixed(2),
        stackTarget: +w.stackTarget.toFixed(2),
        index: w.trackIndex,
        title: document.getElementById('drum-title').textContent,
        cards: [...document.querySelectorAll('.stack-card')].map(e => ({
          i: e.dataset.i,
          y: (e.style.transform.match(/translate3d\\([^,]+,\\s*([-\\d.]+)px/) || [])[1] || null,
          op: e.style.opacity
        })),
        stack: st ? { h: st.clientHeight, step: +w.stepPx.toFixed(0) } : null
      };
    })()`);
    const shot = await rpc.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(out, `${tag}.png`), Buffer.from(shot.data, 'base64'));
    console.log(tag, JSON.stringify(info));
  };

  await snap('00-rest');

  // press, then walk the pointer upward without letting go
  await evalJs(`(()=>{
    const st = document.getElementById('wheel-stack');
    const o = { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    window.__probeOpt = o;
    st.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ clientX: 1300, clientY: 430 }, o)));
    return true;
  })()`);

  const steps = [410, 390, 370, 350, 330];
  let n = 1;
  for (const y of steps) {
    await evalJs(`(()=>{
      const st = document.getElementById('wheel-stack');
      st.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: 1300, clientY: ${y} }, window.__probeOpt)));
      return true;
    })()`);
    await sleep(60);
    await snap(String(n).padStart(2, '0') + '-drag');
    n++;
  }

  await evalJs(`(()=>{
    const st = document.getElementById('wheel-stack');
    st.dispatchEvent(new PointerEvent('pointerup', Object.assign({ clientX: 1300, clientY: 330 }, window.__probeOpt)));
    return true;
  })()`);
  await sleep(1200);
  await snap('04-settled');

  await rpc.send('Target.closeTarget', { targetId });
  rpc.ws.close();
} catch (err) {
  console.error('probe failed:', err.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit();
}
