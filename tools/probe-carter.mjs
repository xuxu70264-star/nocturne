/* probe-carter.mjs — drive the reference site over CDP and record what its
   carousel actually does between two projects: input, timeline, transforms. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9444;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu-sandbox',
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--window-size=1600,900',
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await rpc.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await rpc.send('Page.navigate', { url: 'https://carterogunsola.com/' }, sessionId);
  await sleep(9000);

  const evalJs = async (expression) => {
    const r = await rpc.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    return r.result?.value;
  };

  // where is the carousel, and what does a drum look like at rest
  const box = await evalJs(`(()=>{const st=document.querySelector('[data-wheels]');const r=st.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
  console.log('stage', box);

  const snap = async (tag) => {
    const info = await evalJs(`(()=>{
      const drum = document.querySelector('[data-wheels-line="title"] [data-drum]');
      const title = document.querySelector('.hv2__title');
      const stage = document.querySelector('[data-wheels]');
      const canvas = document.querySelector('[data-wheels] canvas') || document.querySelector('main canvas');
      const cs = drum ? getComputedStyle(drum) : null;
      const ccs = canvas ? getComputedStyle(canvas) : null;
      return {
        t: performance.now(),
        title: title ? title.textContent.slice(0, 24) : null,
        drumTransform: cs ? cs.transform : null,
        drumTransition: cs ? cs.transitionDuration + ' / ' + cs.transitionTimingFunction : null,
        stageTransform: stage ? getComputedStyle(stage).transform : null,
        canvasTransform: ccs ? ccs.transform : null,
        canvasFilter: ccs ? ccs.filter : null,
        canvasOpacity: ccs ? ccs.opacity : null
      };
    })()`);
    const shot = await rpc.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(out, `${tag}.png`), Buffer.from(shot.data, 'base64'));
    console.log(tag, JSON.stringify(info));
  };

  await snap('00-rest');

  // a discrete step: click to focus, then ArrowDown (the site's own affordance)
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.55;
  await rpc.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 }, sessionId);
  await rpc.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 }, sessionId);
  await sleep(400);

  const key = (type) => rpc.send('Input.dispatchKeyEvent', {
    type, key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40
  }, sessionId);

  await key('keyDown');
  await key('keyUp');

  let waited = 0;
  for (const [tag, wait] of [['01-30ms', 30], ['02-90ms', 60], ['03-170ms', 80], ['04-280ms', 110], ['05-420ms', 140], ['06-650ms', 230], ['07-1000ms', 350]]) {
    await sleep(wait);
    waited += wait;
    await snap(tag);
  }

  await rpc.send('Target.closeTarget', { targetId });
  rpc.ws.close();
} catch (err) {
  console.error('probe failed:', err.message);
} finally {
  chrome.kill();
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit();
}
