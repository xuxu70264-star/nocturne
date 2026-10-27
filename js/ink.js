/* ink.js — the same-ink loading bloom.
   Click a playlist and a dot of the page's own stock opens under the pointer.
   Its radius is the load's progress, not a decorative timer: it slows near
   the edge and only closes over the screen when the queue is actually ready. */

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class InkVeil {
  constructor() {
    this.active = false;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.phase = 'idle';
    this.progress = 0;
    this.target = 0;
    this.x = 0;
    this.y = 0;
    this.maxR = 1;
    this._raf = 0;
    this._last = 0;
    this._done = null;
    this._onCancel = null;
    this._minUntil = 0;

    const el = document.createElement('div');
    el.className = 'ink-veil';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="ink-veil__grain" aria-hidden="true"></div>';

    const status = document.createElement('div');
    status.className = 'ink-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    document.body.append(el, status);
    this.el = el;
    this.statusEl = status;

    this._frame = this._frame.bind(this);
    this._onKey = (e) => {
      if (e.key === 'Escape' && this.active) {
        e.preventDefault();
        this.cancel();
      }
    };
    this._onResize = () => this._measure();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('keydown', this._onKey);
  }

  _measure() {
    const { innerWidth: w, innerHeight: h } = window;
    this.maxR = Math.hypot(Math.max(this.x, w - this.x), Math.max(this.y, h - this.y)) + 28;
  }

  _paint() {
    if (!this.active) return;
    const r = this.reduced
      ? this.maxR
      : this.maxR * (this.phase === 'complete' ? 1 : 0.94) * easeInOutCubic(clamp(this.progress, 0, 1));
    this.el.style.clipPath = `circle(${Math.max(0, r).toFixed(2)}px at ${this.x.toFixed(1)}px ${this.y.toFixed(1)}px)`;
  }

  begin(origin, onCancel) {
    if (this.active) this.cancel();
    const { innerWidth: w, innerHeight: h } = window;
    const x = Number(origin?.x);
    const y = Number(origin?.y);
    this.x = Number.isFinite(x) ? clamp(x, 0, w) : w / 2;
    this.y = Number.isFinite(y) ? clamp(y, 0, h) : h / 2;
    this.origin = { x: this.x, y: this.y };
    this._measure();

    this.active = true;
    this.phase = 'load';
    this.progress = this.reduced ? 1 : 0;
    this.target = this.reduced ? 1 : 0.02;
    this._onCancel = onCancel || null;
    this._minUntil = performance.now() + 420;
    this._last = performance.now();

    this.el.style.opacity = '1';
    this.el.style.pointerEvents = 'auto';
    this.el.style.transition = this.reduced ? 'opacity 180ms ease' : 'opacity 0s';
    this.el.classList.add('is-on');
    document.body.classList.add('is-inking');
    this._paint();

    this.statusEl.textContent = '正在载入歌单';
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(this._frame);
    return true;
  }

  setProgress(value) {
    if (!this.active || this.phase !== 'load') return;
    this.target = Math.max(this.target, clamp(value, 0, 0.97));
  }

  setStatus(text) {
    this.statusEl.textContent = text || '';
  }

  slow() {
    if (!this.active || this.phase !== 'load') return;
    this.setProgress(0.9);
    this.statusEl.textContent = '网络有点慢，正在继续载入';
  }

  _frame(now) {
    if (!this.active) return;
    const dt = Math.min(0.08, Math.max(0, (now - this._last) / 1000));
    this._last = now;

    if (this.phase === 'load' && this.target < 0.9) {
      // no progress events while the server is thinking: keep creeping,
      // but never close the last few percent before the data is ready
      this.target = Math.min(0.9, this.target + dt * 0.22);
    }

    const k = dt <= 0 ? 1 : 1 - Math.exp(-dt * 9);
    this.progress += (this.target - this.progress) * k;
    if (this.phase === 'complete' && Math.abs(this.progress - 1) < 0.0008) this.progress = 1;
    this._paint();

    if (this._done && this.phase === 'complete' && this.progress >= 0.999) {
      const done = this._done;
      this._done = null;
      done();
    }

    if (this.active) this._raf = requestAnimationFrame(this._frame);
  }

  async complete() {
    if (!this.active) return;
    const wait = Math.max(0, this._minUntil - performance.now());
    if (wait) await sleep(wait);
    if (!this.active) return;
    this.phase = 'complete';
    this.target = 1;
    this._paint();

    await new Promise((resolve) => {
      this._done = resolve;
      setTimeout(resolve, 460);
    });
    await sleep(120);
    this.el.style.pointerEvents = 'none';
  }

  async reveal() {
    if (!this.active) return;
    this.el.style.transition = 'opacity 560ms cubic-bezier(.215,.61,.355,1)';
    this.el.style.opacity = '0';
    await sleep(570);
    this._finish();
  }

  async fail() {
    if (!this.active) return;
    this.phase = 'fail';
    this.target = 0;
    this.el.style.pointerEvents = 'none';
    await sleep(280);
    this._finish();
  }

  cancel() {
    if (!this.active) return;
    this._onCancel?.();
    this._onCancel = null;
    this.fail();
  }

  _finish() {
    this.active = false;
    this.phase = 'idle';
    this.progress = 0;
    this.target = 0;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this.el.classList.remove('is-on');
    this.el.style.opacity = '0';
    this.el.style.pointerEvents = 'none';
    this.el.style.clipPath = 'circle(0px at 50% 50%)';
    document.body.classList.remove('is-inking');
    this._done = null;
    this._onCancel = null;
    this.statusEl.textContent = '';
  }
}
