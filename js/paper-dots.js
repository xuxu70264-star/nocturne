/* paper-dots.js — the paper's halftone screen, revealed by the hand.
   A low-resolution wake buffer collects where the pointer has been; a 45°
   dot screen is masked by that buffer, so the dots swell along the stroke
   and fade back into the stock. Clicks leave an expanding ring of dots.

   One full-screen overlay canvas, screen-blended, pointer-events: none. */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class PaperDots {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.enabled = true;
    this.color = 'rgba(243, 236, 226, 0.96)';

    this.W = 1;
    this.H = 1;
    this.dpr = 1;
    this.scale = 1 / 3;      // wake buffer resolution
    this.last = null;
    this.energy = 0;
    this.activeAt = 0;
    this.dirty = false;
    this.rings = [];
    /* optional () => {x,y,w,h} in CSS px; dots are cut out of this shape */
    this.hole = null;

    this.trail = document.createElement('canvas');
    this.tctx = this.trail.getContext('2d');
    this.work = document.createElement('canvas');
    this.wctx = this.work.getContext('2d');

    this._move = (e) => this._onMove(e);
    this._down = (e) => this._onDown(e);
    this._up = () => { this.last = null; };

    window.addEventListener('pointermove', this._move, { passive: true });
    window.addEventListener('pointerdown', this._down, { passive: true });
    window.addEventListener('pointerup', this._up, { passive: true });
    window.addEventListener('pointercancel', this._up, { passive: true });
    window.addEventListener('resize', () => this.resize());

    this.resize();
  }

  _buildPattern() {
    // a 45° screen: two dots per square cell (checkerboard lattice)
    const pitch = 13 * this.dpr;
    const tile = pitch * 2;
    const n = document.createElement('canvas');
    n.width = tile;
    n.height = tile;
    const g = n.getContext('2d');
    g.fillStyle = this.color;

    for (let y = 0; y < tile; y += pitch) {
      for (let x = 0; x < tile; x += pitch) {
        for (const [ox, oy] of [[0, 0], [pitch / 2, pitch / 2]]) {
          g.beginPath();
          g.arc(x + ox, y + oy, Math.max(0.9, 1.15 * this.dpr), 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    this.pattern = this.wctx.createPattern(n, 'repeat');
    this.patternCtx = g;
  }

  /** move the sheet into whichever view is on top (behind its content) */
  attachTo(parent, before = null) {
    if (!parent || this.canvas.parentElement === parent) return;
    parent.insertBefore(this.canvas, before || parent.firstChild);
    this._clearAll();
  }

  setColor(color) {
    if (!color) return;
    this.color = color;
    this._buildPattern();
    this._clearAll();
  }

  resize() {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    const w = Math.round(this.W * this.dpr);
    const h = Math.round(this.H * this.dpr);
    this.canvas.width = w;
    this.canvas.height = h;

    this.work.width = w;
    this.work.height = h;

    this.trail.width = Math.max(2, Math.round(this.W * this.scale));
    this.trail.height = Math.max(2, Math.round(this.H * this.scale));

    this._buildPattern();
    this._clearAll();
  }

  _clearAll() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.tctx.clearRect(0, 0, this.trail.width, this.trail.height);
    this.wctx.clearRect(0, 0, this.work.width, this.work.height);
    this.last = null;
    this.energy = 0;
    this.dirty = false;
  }

  _stamp(x, y, strength = 1) {
    const s = this.scale;
    const r = (16 + 12 * strength) * s;
    const g = this.tctx.createRadialGradient(x * s, y * s, 0, x * s, y * s, r);
    const a = clamp(0.55 * strength, 0.1, 0.8);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.45, `rgba(255,255,255,${a * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    this.tctx.fillStyle = g;
    this.tctx.beginPath();
    this.tctx.arc(x * s, y * s, r, 0, Math.PI * 2);
    this.tctx.fill();
    this.dirty = true;
  }

  _onMove(e) {
    if (!this.enabled || this.reduced) return;
    const now = performance.now();
    const x = e.clientX;
    const y = e.clientY;

    if (!this.last) {
      this.last = { x, y, t: now };
      this._stamp(x, y, 0.7);
      this.activeAt = now;
      return;
    }

    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1.5) return;

    const speed = clamp(dist / Math.max(1, now - this.last.t), 0.02, 2.2);
    const strength = clamp(0.35 + speed * 0.55, 0.3, 1);
    const steps = Math.max(1, Math.ceil(dist / 7));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this._stamp(this.last.x + dx * t, this.last.y + dy * t, strength);
    }

    this.energy = Math.min(1, this.energy + dist / 260);
    this.activeAt = now;
    this.last = { x, y, t: now };
  }

  _onDown(e) {
    if (!this.enabled || this.reduced) return;
    this.rings.push({ x: e.clientX, y: e.clientY, r: 0, life: 1 });
    this._stamp(e.clientX, e.clientY, 1.2);
    this.activeAt = performance.now();
  }

  /** 2D heart for the exclusion hole (CSS px → path coords) */
  _heartPath(x, y, w, h) {
    const p = new Path2D();
    const N = 72;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const sx = 16 * Math.pow(Math.sin(t), 3);
      const sy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      const px = x + (sx / 16) * (w / 2);
      const py = y - ((sy + 6) / 11) * (h / 2);
      if (i) p.lineTo(px, py);
      else p.moveTo(px, py);
    }
    p.closePath();
    return p;
  }

  render(now, dt = 1 / 60) {
    if (!this.enabled) return;

    // once the hand has been still for a while, wipe the sheet once and stop
    if (now - this.activeAt > 900 && this.rings.length === 0) {
      if (this.dirty) this._clearAll();
      return;
    }

    // fade the wake — quick, it should read as a brush, not a stain
    this.tctx.globalCompositeOperation = 'destination-out';
    this.tctx.fillStyle = `rgba(0,0,0,${clamp(dt * 2.4, 0.01, 0.08)})`;
    this.tctx.fillRect(0, 0, this.trail.width, this.trail.height);
    this.tctx.globalCompositeOperation = 'source-over';

    // click rings expand and print their own circle of dots
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.r += dt * 420;
      ring.life -= dt * 1.7;
      if (ring.life <= 0 || ring.r > Math.max(this.W, this.H)) {
        this.rings.splice(i, 1);
        continue;
      }
      this.tctx.strokeStyle = this.color;
      this.tctx.globalAlpha = 0.30 * ring.life;
      this.tctx.lineWidth = Math.max(1.5, 7 * ring.life) * this.scale;
      this.tctx.beginPath();
      this.tctx.arc(ring.x * this.scale, ring.y * this.scale, ring.r * this.scale, 0, Math.PI * 2);
      this.tctx.stroke();
      this.tctx.globalAlpha = 1;
      this.dirty = true;
    }

    const w = this.work.width;
    const h = this.work.height;
    const wx = this.wctx;

    wx.setTransform(1, 0, 0, 1, 0, 0);
    wx.clearRect(0, 0, w, h);
    wx.fillStyle = this.pattern;
    wx.fillRect(0, 0, w, h);

    // the wake is the mask: dots resolve only where the hand has been
    wx.globalCompositeOperation = 'destination-in';
    wx.imageSmoothingEnabled = true;
    wx.drawImage(this.trail, 0, 0, w, h);
    wx.globalCompositeOperation = 'source-over';

    // keep the heart clean: cut the dots out of its silhouette
    if (this.hole) {
      const b = this.hole();
      if (b && b.w > 1) {
        wx.globalCompositeOperation = 'destination-out';
        wx.fillStyle = '#fff';
        wx.fill(this._heartPath(b.x * this.dpr, b.y * this.dpr, b.w * this.dpr, b.h * this.dpr));
        wx.globalCompositeOperation = 'source-over';
      }
    }

    const cx = this.ctx;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, w, h);
    cx.globalAlpha = 0.72;
    cx.drawImage(this.work, 0, 0);
    cx.globalAlpha = 1;

  }
}
