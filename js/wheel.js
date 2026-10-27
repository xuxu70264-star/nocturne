/* wheel.js — lyrics as a wheel, sleeves as a stack.
   The lines ride a huge arc and the line being sung sits at the centre.
   On the right, three sleeves stand in a vertical stack like prints on a
   table: drag the stack up or down and it carries itself to the next song,
   coasting a little before it settles.                                   */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function hueFor(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const RADIUS = 1700;
const STEP = 0.050;      // radians between two lyric lines

export class Wheel {
  constructor(opts) {
    this.root = opts.root;
    this.itemsEl = opts.itemsEl;
    this.card = opts.card;
    this.stackEl = opts.stack || null;
    this.idxEl = opts.idx;
    this.nameEl = opts.name;
    this.subEl = opts.sub;
    this.onSeek = opts.onSeek;
    this.onPick = opts.onPick;
    this.drums = opts.drums || null;

    this.lines = [];
    this.items = [];
    this.queue = [];
    this.track = null;
    this.trackIndex = 0;
    this.total = 1;
    this._paintedId = null;
    this._rollDir = 1;

    this.openState = false;
    this.pos = 0;          // lyric wheel position (index units)
    this.target = 0;
    this.active = -1;
    this.appear = 0;
    this.hold = 0;         // seconds left before the wheel follows the song again
    this._drag = null;
    this._lastActive = -1;

    /* the sleeve stack */
    this.cards = new Map();
    this.stackPos = 0;
    this.stackTarget = 0;
    this.dragX = 0;
    this.dragTargetX = 0;
    this.stepPx = 118;
    this._sdrag = null;
    this._lastWheel = 0;
    this._activeCard = -1;

    this.canvas = opts.canvas || null;
    this.cctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.spec = new Float32Array(52);

    this._onWheel = (e) => {
      if (!this.openState) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.target = clamp(this.target + delta * 0.005, 0, Math.max(0, this.lines.length - 1));
      this.hold = 4;
    };

    this._onDown = (e) => {
      if (!this.openState) return;
      if (e.target.closest && e.target.closest('button, a')) return;   // let buttons be buttons
      this._drag = { x: e.clientX, start: this.target, moved: false };
      this.root.classList.add('is-dragging');
      try { this.root.setPointerCapture?.(e.pointerId); } catch {}
    };

    this._onMove = (e) => {
      if (!this.openState || !this._drag) return;
      const dx = e.clientX - this._drag.x;
      if (Math.abs(dx) > 4) this._drag.moved = true;
      this.target = clamp(this._drag.start - dx / 120, 0, Math.max(0, this.lines.length - 1));
      this.hold = 4;
    };

    this._onUp = () => {
      this._drag = null;
      this.root.classList.remove('is-dragging');
    };

    this._onKey = (e) => {
      if (!this.openState) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        this.onSeek?.(clamp(Math.round(this.pos) + 1, 0, this.lines.length - 1));
        this.hold = 3;
        e.preventDefault();
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        this.onSeek?.(clamp(Math.round(this.pos) - 1, 0, this.lines.length - 1));
        this.hold = 3;
        e.preventDefault();
      }
    };

    this.root.addEventListener('wheel', this._onWheel, { passive: false });
    this.root.addEventListener('pointerdown', this._onDown);
    this.root.addEventListener('pointermove', this._onMove);
    this.root.addEventListener('pointerup', this._onUp);
    this.root.addEventListener('pointercancel', this._onUp);
    this.root.addEventListener('keydown', this._onKey);

    if (this.stackEl) this._bindStack();
  }

  get isOpen() { return this.openState; }

  /* ------------------------------------------------------------ the stack */

  _bindStack() {
    const el = this.stackEl;
    el.tabIndex = 0;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', '歌曲堆叠 · 上下拖动切换');

    el.addEventListener('pointerdown', (e) => {
      if (!this.openState || this.queue.length < 2) return;
      if (e.target.closest && e.target.closest('button, a')) return;
      e.stopPropagation();

      const card = e.target.closest ? e.target.closest('.stack-card') : null;
      this._sdrag = {
        x: e.clientX,
        y: e.clientY,
        pos: this.stackPos,
        moved: false,
        card: card ? Number(card.dataset.i) : null,
        ly: e.clientY,
        t: performance.now(),
        v: 0
      };
      el.classList.add('is-dragging');
      try { el.setPointerCapture?.(e.pointerId); } catch {}
    });

    el.addEventListener('pointermove', (e) => {
      const s = this._sdrag;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.hypot(dx, dy) > 3) s.moved = true;
      this.dragTargetX = clamp(dx, -90, 90);

      const now = performance.now();
      const dt = Math.max(1, now - s.t);
      s.v = (e.clientY - s.ly) / dt;    // px / ms, downward positive
      s.ly = e.clientY;
      s.t = now;

      this.stackPos = s.pos - (dy + dx * 0.35) / this.stepPx;
      this.stackTarget = this.stackPos;
      this._ensureCards();
      this._layout();
    });

    const end = (e) => {
      const s = this._sdrag;
      if (!s) return;
      this._sdrag = null;
      this.dragTargetX = 0;
      el.classList.remove('is-dragging');

      if (!s.moved) {
        if (Number.isInteger(s.card) && s.card !== this.trackIndex) this._request(s.card);
        else { this.stackTarget = this._nearest(this.trackIndex); this._layout(); }
        return;
      }

      // throw a little: project the release velocity ~120ms ahead
      const v = clamp(s.v || 0, -3, 3);
      const kick = clamp(-(v * 60) / this.stepPx, -0.35, 0.35);
      this._request(Math.round(this.stackPos + kick));
    };

    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener('wheel', (e) => {
      if (!this.openState) return;
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      if (now - this._lastWheel < 240) return;
      this._lastWheel = now;
      this._request(clamp(Math.round(this.stackTarget) + (e.deltaY > 0 ? 1 : -1), 0, this.queue.length - 1));
    }, { passive: false });

    el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      e.stopPropagation();
      this._request(clamp(Math.round(this.stackTarget) + (e.key === 'ArrowDown' ? 1 : -1), 0, this.queue.length - 1));
    });
  }

  /** nearest unwrapped position that carries index i */
  _nearest(i) {
    const n = this.queue.length || 1;
    return i + n * Math.round((this.stackPos - i) / n);
  }

  /** ask the player for a song; the stack eases there while it loads */
  _request(i) {
    if (!this.queue.length) return;
    const idx = this._norm(Math.round(i));
    this.stackTarget = this._nearest(idx);
    this._layout();

    if (idx !== this.trackIndex) this.onPick?.(idx);
    else if (Math.abs(this.stackPos - this.stackTarget) < 0.001) this._layout();
  }

  _cardFor(i) {
    const track = this.queue[i];
    if (!track) return null;

    let el = this.cards.get(i);
    if (!el) {
      el = document.createElement('div');
      el.className = 'stack-card';
      el.dataset.i = String(i);
      el.innerHTML = '<img class="stack-card__art" alt="" draggable="false" hidden><span class="stack-card__glyph" aria-hidden="true"></span>';
      el.setAttribute('role', 'img');
      this.stackEl.insertBefore(el, this.canvas);
      this.cards.set(i, el);
    }

    el.dataset.i = String(i);
    const coverKey = track.coverUrl || '';
    if (el.dataset.trackId === track.id && el.dataset.cover === coverKey) return el;
    el.dataset.trackId = track.id;
    el.dataset.cover = coverKey;
    el.setAttribute('aria-label', `${track.title || '未命名'} · ${track.artist || ''}`);

    const img = el.querySelector('.stack-card__art');
    const glyph = el.querySelector('.stack-card__glyph');
    el.style.setProperty('--hue', String(hueFor(track.title + track.artist)));

    if (track.coverUrl) {
      el.classList.remove('is-typographic');
      img.hidden = false;
      img.src = track.coverUrl;
      glyph.textContent = '';
    } else {
      el.classList.add('is-typographic');
      img.hidden = true;
      img.removeAttribute('src');
      glyph.textContent = (track.title || '·').trim().charAt(0);
    }
    return el;
  }

  _norm(i) {
    const n = this.queue.length || 1;
    return ((i % n) + n) % n;
  }

  /** signed distance on a circle, so the stack can wrap */
  _wrapD(i, pos) {
    const n = this.queue.length;
    if (n < 2) return i - pos;
    return i - pos - n * Math.round((i - pos) / n);
  }

  _syncCards() {
    if (!this.stackEl || !this.queue.length) return;

    // the spectrum canvas lives inside the active sleeve; get it out of the
    // way before any card can be recycled
    if (this.canvas && this.canvas.parentElement !== this.stackEl) this.stackEl.appendChild(this.canvas);

    const n = this.queue.length;
    const lo = Math.floor(Math.min(this.stackPos, this.stackTarget)) - 1;
    const hi = Math.ceil(Math.max(this.stackPos, this.stackTarget)) + 1;

    const want = new Set();
    for (let k = lo; k <= hi; k++) want.add(this._norm(k));
    for (const i of want) this._cardFor(i);
    for (const [i, el] of [...this.cards]) {
      if (!want.has(i)) {
        el.remove();
        this.cards.delete(i);
      }
    }

    const sample = this.cards.get(this.trackIndex) || this.cards.get(lo);
    this.stepPx = clamp((sample?.offsetHeight || 220) * 0.72, 92, 200);

    this._attachSpectrum();
    this._layout();
  }

  _attachSpectrum() {
    if (!this.canvas) return;
    const i = this._norm(Math.round(this.stackTarget));
    const card = this.cards.get(i);
    if (card && this.canvas.parentElement !== card) card.appendChild(this.canvas);
  }

  /** while a drag travels further than one sleeve, pull the next one in */
  _ensureCards() {
    if (!this.queue.length) return;
    const lo = Math.floor(Math.min(this.stackPos, this.stackTarget)) - 1;
    const hi = Math.ceil(Math.max(this.stackPos, this.stackTarget)) + 1;
    for (let k = lo; k <= hi; k++) {
      if (!this.cards.has(this._norm(k))) {
        this._syncCards();
        return;
      }
    }
  }

  _layout() {
    const step = this.stepPx;
    for (const [i, el] of this.cards) {
      const d = this._wrapD(i, this.stackPos);
      const ad = Math.abs(d);

      if (ad > 2.4) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        continue;
      }

      const y = d * step;
      const scale = 1 - Math.min(0.28, ad * 0.135);
      const rot = clamp(d, -2, 2) * 6;
      const x = -Math.min(1, ad) * 22 + this.dragX * (ad < 0.5 ? 1 : 0.45);
      let opacity = ad < 0.5 ? 1 : clamp(1 - (ad - 0.5) * 0.47, 0.08, 1);
      // cards fade out before they reach the stack's clipped edge
      if (ad > 1.05) opacity *= clamp(1 - (ad - 1.05) / 0.45, 0, 1);

      el.style.transform =
        `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg) rotateY(-4deg) scale(${scale.toFixed(3)})`;
      el.style.opacity = opacity.toFixed(3);
      el.style.zIndex = String(100 - Math.round(ad * 10));
      el.style.pointerEvents = ad < 1.7 ? 'auto' : 'none';

      const active = i === this._norm(Math.round(this.stackTarget));
      el.classList.toggle('is-active', active);

      if (active && this._activeCard !== i) {
        this._activeCard = i;
        this._attachSpectrum();
      }
    }
  }

  /* ------------------------------------------------------------- lyrics */

  setLines(lines, index, track, meta = {}) {
    this.lines = lines || [];
    this.track = track || null;
    this.active = -1;
    this._lastActive = -1;

    if (meta.queue) this.queue = meta.queue;
    else if (!this.queue.length && track) this.queue = [track];

    const prevIndex = this.trackIndex;
    if (typeof meta.queueIndex === 'number') this.trackIndex = meta.queueIndex;
    else if (typeof meta.trackIndex === 'number') this.trackIndex = meta.trackIndex;
    if (typeof meta.total === 'number') this.total = meta.total;
    else this.total = this.queue.length || this.total;

    this._rollDir = this.trackIndex >= prevIndex ? 1 : -1;
    const changed = !!this._paintedId && !!track && this._paintedId !== track.id;

    this.itemsEl.innerHTML = '';
    this.items = [];

    // an instrumental has nothing to sing — say so instead of showing a void
    if (!this.lines.length) {
      const empty = document.createElement('div');
      empty.className = 'wheel-empty';
      empty.textContent = '纯音乐 · 无歌词';
      this.itemsEl.appendChild(empty);
      this._afterLines(changed);
      return;
    }

    this.lines.forEach((line, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'wheel-item wheel-item--lyric';
      item.dataset.i = String(i);
      item.textContent = line.text || '·';

      item.addEventListener('click', () => {
        if (this._drag && this._drag.moved) return;
        this.onSeek?.(i);
      });

      this.itemsEl.appendChild(item);
      this.items.push(item);
    });

    this._afterLines(changed);
  }

  _afterLines(changed) {
    this._paintedId = this.track ? this.track.id : null;

    if (!this._sdrag) {
      this.stackTarget = this._nearest(this.trackIndex);
      if (Math.abs(this.stackPos - this.stackTarget) > 1.6) this.stackPos = this.stackTarget;
    }

    this._syncCards();
    this._paintMeta(changed);

    if (!this.openState) return;
    this.card.classList.remove('is-on');
    requestAnimationFrame(() => this.card.classList.add('is-on'));
  }

  /** art can arrive after the sleeves are already up (demo tags load in the
      background) — rebuild their covers in place */
  paintArt(track = this.track) {
    if (!this.openState || !track || !this.track || track.id !== this.track.id) return;
    this._syncCards();
  }

  _activate(i) {
    if (i === this.active) return;
    this.active = i;
    this.items.forEach((el, k) => el.classList.toggle('is-active', k === i));
    this._paintMeta();
  }

  _metaText() {
    const track = this.track;
    if (!track) return null;
    const artist = (track.artist || '未知艺术家').toUpperCase();
    const line = this.lines[this.active];
    return {
      no: `N°${String(this.trackIndex + 1).padStart(2, '0')} / ${String(this.total).padStart(2, '0')}`,
      title: track.title,
      sub: this.lines.length
        ? `${artist} · 歌词 ${String(this.active + 1).padStart(2, '0')} / ${String(this.lines.length).padStart(2, '0')}${line ? ` · ${fmtTime(line.t)}` : ''}`
        : artist
    };
  }

  /** roll one line like a mechanical drum: two cells, one line of travel */
  _rollLine(el, text, dir) {
    if (!el || !el.children.length) return;
    const [a, b] = el.children;
    if (a.textContent === text && !el.dataset.busy) return;

    // a roll is already in flight (fast track switching): don't queue it,
    // just land on the newest text so the label can never lag behind
    if (el.dataset.busy) {
      el.style.transition = 'none';
      el.style.transform = 'translateY(0)';
      a.textContent = text;
      b.textContent = '';
      delete el.dataset.busy;
      return;
    }

    el.dataset.busy = '1';
    el.style.transition = 'none';

    if (dir >= 0) {
      b.textContent = text;
      el.style.transform = 'translateY(0)';
      void el.offsetHeight;
      el.style.transition = 'transform 200ms cubic-bezier(.2,.9,.2,1)';
      el.style.transform = 'translateY(-100%)';
      const done = () => {
        el.removeEventListener('transitionend', done);
        el.style.transition = 'none';
        el.style.transform = 'translateY(0)';
        a.textContent = text;
        delete el.dataset.busy;
      };
      el.addEventListener('transitionend', done);
    } else {
      a.textContent = text;
      b.textContent = el.dataset.prev || b.textContent;
      el.style.transform = 'translateY(-100%)';
      void el.offsetHeight;
      el.style.transition = 'transform 200ms cubic-bezier(.2,.9,.2,1)';
      el.style.transform = 'translateY(0)';
      const done = () => {
        el.removeEventListener('transitionend', done);
        delete el.dataset.busy;
      };
      el.addEventListener('transitionend', done);
    }
  }

  _paintMeta(roll = false) {
    const text = this._metaText();
    if (!text) return;

    if (!roll || !this.drums) {
      this.idxEl.textContent = text.no;
      this.nameEl.textContent = text.title;
      this.subEl.textContent = text.sub;
      return;
    }

    this._rollLine(this.drums.no, text.no, this._rollDir);
    this._rollLine(this.drums.title, text.title, this._rollDir);
    this._rollLine(this.drums.sub, text.sub, this._rollDir);
  }

  open(index = 0) {
    this.openState = true;
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    this.root.tabIndex = -1;
    this.root.focus({ preventScroll: true });
    this.appear = 0;
    this.active = -1;
    this.hold = 0;
    this.pos = index;
    this.target = index;
    this.stackPos = this.trackIndex;
    this.stackTarget = this.trackIndex;

    this._syncCards();
    this._paintMeta(false);
    this.update(0);

    this.card.classList.remove('is-on');
    requestAnimationFrame(() => this.card.classList.add('is-on'));
  }

  close() {
    this.openState = false;
    this._sdrag = null;
    this._drag = null;
    this.stackEl?.classList.remove('is-dragging');
    this.root.classList.remove('is-open', 'is-dragging');
    this.root.setAttribute('aria-hidden', 'true');
  }

  /** the card's audio contour — real spectrum when there is one, a slow
      idle wave when the song is paused or the analyser has not started */
  drawSpectrum(bins) {
    const cvs = this.canvas;
    const ctx = this.cctx;
    if (!cvs || !ctx) return;

    const w = cvs.clientWidth;
    const h = cvs.clientHeight;
    if (!w || !h) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (cvs.width !== W || cvs.height !== H) {
      cvs.width = W;
      cvs.height = H;
    }

    const N = this.spec.length;
    const t = performance.now() / 1000;

    for (let i = 0; i < N; i++) {
      let target;
      if (bins && bins.length) {
        const idx = Math.floor(Math.pow(i / (N - 1), 1.7) * (bins.length - 1));
        target = bins[idx] / 255;
      } else {
        target = 0.035 + 0.022 * Math.sin(t * 0.9 + i * 0.55);
      }
      this.spec[i] += (target - this.spec[i]) * (target > this.spec[i] ? 0.55 : 0.10);
    }

    ctx.clearRect(0, 0, W, H);
    const bw = W / (N - 1);
    const heightAt = (i) => H - Math.max(1.5 * dpr, Math.pow(this.spec[i], 0.82) * H * 0.94);

    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, 'rgba(236, 214, 186, 0.17)');
    grad.addColorStop(0.55, 'rgba(236, 214, 186, 0.05)');
    grad.addColorStop(1, 'rgba(236, 214, 186, 0)');

    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, heightAt(0));
    for (let i = 1; i < N; i++) {
      const x = i * bw;
      const px = (i - 1) * bw;
      ctx.quadraticCurveTo((px + x) / 2, (heightAt(i - 1) + heightAt(i)) / 2, x, heightAt(i));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, heightAt(0));
    for (let i = 1; i < N; i++) {
      const x = i * bw;
      const px = (i - 1) * bw;
      ctx.quadraticCurveTo((px + x) / 2, (heightAt(i - 1) + heightAt(i)) / 2, x, heightAt(i));
    }
    ctx.strokeStyle = 'rgba(255, 240, 220, 0.62)';
    ctx.lineWidth = Math.max(1, dpr * 0.8);
    ctx.stroke();
  }

  /** called every frame with the line that is currently being sung */
  follow(index) {
    if (!this.openState) return;
    if (this.hold > 0) return;
    if (index >= 0) this.target = index;
  }

  update(dt) {
    if (!this.openState) return;

    this.appear = Math.min(1, this.appear + dt / 0.5);
    if (this.hold > 0) this.hold = Math.max(0, this.hold - dt);

    /* the sleeve stack settles on its own after a drag */
    if (!this._sdrag) {
      const d = this.stackTarget - this.stackPos;
      if (Math.abs(d) > 0.0006) {
        this.stackPos += d * (dt <= 0 ? 1 : 1 - Math.exp(-dt * 13));
        this._layout();
      } else if (this.stackPos !== this.stackTarget) {
        this.stackPos = this.stackTarget;
        this._layout();
      }
    }

    const k = dt <= 0 ? 1 : 1 - Math.exp(-dt * 7);
    this.pos += (this.target - this.pos) * k;
    const slideK = dt <= 0 ? 1 : 1 - Math.exp(-dt * 13);
    if (Math.abs(this.dragTargetX - this.dragX) > 0.01) {
      this.dragX += (this.dragTargetX - this.dragX) * slideK;
      this._layout();
    }
    if (Math.abs(this.target - this.pos) < 0.0006) this.pos = this.target;

    const active = Math.round(this.pos);
    if (active !== this._lastActive) {
      this._lastActive = active;
      this._activate(active);
    }

    this.items.forEach((el, i) => {
      const d = i - this.pos;
      const a = d * STEP;

      const x = -(1 - Math.cos(a)) * RADIUS * 0.35;
      const y = Math.sin(a) * RADIUS;
      const rot = -a * 1.02;
      const scale = 1 - Math.min(0.24, Math.abs(d) * 0.05);
      const opacity = clamp(1.08 - Math.abs(d) * 0.22, 0.03, 1) * Math.min(1, this.appear * 1.3);

      el.style.transform =
        `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot.toFixed(4)}rad) scale(${scale.toFixed(3)})`;
      el.style.opacity = opacity.toFixed(3);
      el.style.zIndex = String(100 - Math.round(Math.abs(d) * 10));
      el.style.pointerEvents = Math.abs(d) > 5 ? 'none' : 'auto';
    });
  }
}
