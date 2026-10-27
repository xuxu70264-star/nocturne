/* shelf.js — the queue, as objects in space instead of rows in a list.
   DOM + CSS 3D: cheap, crisp text, and it can grow to a few hundred
   cards before it needs culling.

   Navigation is mouse-first: moving the pointer pushes the rack, the way
   you would nudge a physical shelf. Wheel, drag and arrow keys still work. */

const DEPTH = 120;
const ANGLE = 34;
const PX_PER_CARD = 168;   // how far the pointer travels to advance one card

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function hueFor(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export class Shelf {
  constructor(opts) {
    this.root = opts.root;
    this.rail = opts.rail;
    this.indexEl = opts.indexEl;
    this.titleEl = opts.titleEl;
    this.artistEl = opts.artistEl;
    this.onPick = opts.onPick;

    this.tracks = [];
    this.cards = [];
    this.playing = -1;

    this.pos = 0;
    this.target = 0;
    this.appear = 0;
    this.openState = false;
    this._lastPos = -999;
    this._lastX = null;
    this._clickGuard = false;

    this._onWheel = (e) => {
      if (!this.openState) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.target = clamp(this.target + delta * 0.0022, 0, this._max());
    };

    this._onKey = (e) => {
      if (!this.openState) return;
      if (e.key === 'ArrowRight') { this.target = clamp(this.target + 1, 0, this._max()); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { this.target = clamp(this.target - 1, 0, this._max()); e.preventDefault(); }
    };

    // only an actual drag pushes the rack; hovering must not move the cards
    this._onPointerMove = (e) => {
      if (!this.openState || !this._drag) return;
      const dx = e.clientX - this._drag.x;
      if (Math.abs(dx) > 4) {
        this._drag.moved = true;
        this._clickGuard = true;
        if (!this._drag.captured) {
          this._drag.captured = true;
          try { this.root.setPointerCapture?.(e.pointerId); } catch {}
        }
      }
      this.target = clamp(this._drag.start - dx / PX_PER_CARD, 0, this._max());
    };

    this._onPointerDown = (e) => {
      if (!this.openState) return;
      this._clickGuard = false;
      this._drag = { x: e.clientX, start: this.target, moved: false, captured: false, pointerId: e.pointerId };
      this.root.classList.add('is-grabbing');
    };

    this._onPointerUp = () => {
      if (this._drag && this._drag.captured) {
        try { this.root.releasePointerCapture?.(this._drag.pointerId); } catch {}
      }
      this._drag = null;
      this._lastX = null;
      this.root.classList.remove('is-grabbing');
    };

    this._onLeave = () => { this._lastX = null; };

    this._onClickCapture = (e) => {
      if (!this._clickGuard) return;
      this._clickGuard = false;
      e.preventDefault();
      e.stopPropagation();
    };

    this._onRootClick = (e) => {
      if (this._clickGuard) return;
      if (!e.target.closest || !e.target.closest('.shelf__stage')) return;
      if (e.target.closest('.shelf-card, button, a')) return;
      let pick = this._focus;
      let best = Infinity;
      for (const card of this.cards) {
        const r = card.getBoundingClientRect();
        if (e.clientX < r.left - 12 || e.clientX > r.right + 12) continue;
        if (e.clientY < r.top - 12 || e.clientY > r.bottom + 12) continue;
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        if (d < best) { best = d; pick = Number(card.dataset.index); }
      }
      if (pick >= 0) {
        e.stopImmediatePropagation();
        this.onPick?.(pick, { x: e.clientX, y: e.clientY });
      }
    };

    this.root.addEventListener('wheel', this._onWheel, { passive: false });
    this.root.addEventListener('keydown', this._onKey);
    this.root.addEventListener('click', this._onClickCapture, true);
    this.root.addEventListener('click', this._onRootClick);
    this.root.addEventListener('pointerdown', this._onPointerDown);
    this.root.addEventListener('pointermove', this._onPointerMove);
    this.root.addEventListener('pointerup', this._onPointerUp);
    this.root.addEventListener('pointercancel', this._onPointerUp);
    this.root.addEventListener('pointerleave', this._onLeave);
  }

  get isOpen() { return this.openState; }

  _max() { return Math.max(0, this.tracks.length - 1); }

  pickFocused() {
    const i = Math.round(this.pos);
    if (!this.tracks[i]) return;
    const r = this.cards[i]?.getBoundingClientRect?.();
    this.onPick?.(i, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
  }

  setLoading(text = '正在读取你的歌单…') {
    this.tracks = [];
    this.cards = [];
    this.playing = -1;
    this._loading = true;
    this._focus = -1;
    this.pos = 0;
    this.target = 0;
    this.rail.innerHTML = '';

    const note = document.createElement('div');
    note.className = 'shelf-loading';
    note.innerHTML = '<span class="shelf-loading__dot" aria-hidden="true"></span><span class="shelf-loading__text"></span>';
    note.querySelector('.shelf-loading__text').textContent = text;
    this.rail.appendChild(note);

    this.root.classList.add('is-loading');
    if (this.indexEl) this.indexEl.textContent = '— / —';
    if (this.titleEl) this.titleEl.textContent = '正在读取歌单…';
    if (this.artistEl) this.artistEl.textContent = '';
  }

  setQueue(tracks, index = 0, playing = -1) {
    this.tracks = tracks;
    this.playing = playing;
    this._loading = false;
    this.root.classList.remove('is-loading');
    this.rail.innerHTML = '';
    this.cards = [];

    tracks.forEach((track, i) => {
      const card = document.createElement('article');
      card.className = 'shelf-card';
      card.dataset.index = String(i);

      const art = document.createElement('div');
      art.className = 'shelf-card__art';

      if (track.coverUrl) {
        const img = document.createElement('img');
        img.src = track.coverUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.draggable = false;
        art.appendChild(img);
      } else {
        art.classList.add('is-typographic');
        art.style.setProperty('--hue', String(hueFor(track.title + track.artist)));
        const glyph = document.createElement('span');
        glyph.className = 'shelf-card__glyph';
        glyph.textContent = (track.title || '·').trim().charAt(0);
        art.appendChild(glyph);
      }

      const no = document.createElement('span');
      no.className = 'shelf-card__no';
      no.textContent = String(i + 1).padStart(2, '0');
      art.appendChild(no);

      if (i === playing) {
        const mark = document.createElement('span');
        mark.className = 'shelf-card__mark';
        mark.textContent = '▷';
        art.appendChild(mark);
      }

      const body = document.createElement('div');
      body.className = 'shelf-card__body';

      const title = document.createElement('div');
      title.className = 'shelf-card__title';
      title.textContent = track.title;

      const artist = document.createElement('div');
      artist.className = 'shelf-card__artist';
      artist.textContent = (track.artist || '未知艺术家').toUpperCase();

      body.append(title, artist);
      card.append(art, body);

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._clickGuard) return;
        const i2 = Number(card.dataset.index);
        this.target = i2;
        this.onPick?.(i2, { x: e.clientX, y: e.clientY });
      });

      this.rail.appendChild(card);
      this.cards.push(card);
    });

    this.pos = index;
    this.target = index;
    this._lastPos = -999;
    this._focus = -1;
    this.update(0);
  }

  open(index = 0) {
    this.openState = true;
    this.appear = 0;
    this.pos = index;
    this.target = index;
    this._lastX = null;
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    this.root.tabIndex = -1;
    this.root.focus({ preventScroll: true });
    this._lastPos = -999;
    this.update(0);
  }

  close() {
    this.openState = false;
    this._drag = null;
    this.root.classList.remove('is-open', 'is-grabbing');
    this.root.setAttribute('aria-hidden', 'true');
  }

  update(dt) {
    if (!this.openState && this.appear <= 0) return;

    const n = this.tracks.length;
    if (!n) return;

    this.appear = Math.min(1, this.appear + dt / 0.55);
    const grow = easeOut(this.appear);

    const k = dt <= 0 ? 1 : 1 - Math.exp(-dt * 9);
    this.pos += (this.target - this.pos) * k;
    if (Math.abs(this.target - this.pos) < 0.0005) this.pos = this.target;

    const focus = Math.round(this.pos);
    if (focus !== this._focus) {
      this._focus = focus;
      this._paintFooter(focus);
      this.cards.forEach((c, i) => c.classList.toggle('is-focus', i === focus));
    }

    if (Math.abs(this.pos - this._lastPos) < 0.0004 && this.appear >= 1) return;
    this._lastPos = this.pos;

    const width = this.rail.clientWidth || 900;
    const step = Math.max(104, Math.min(196, width * 0.185));

    this.cards.forEach((card, i) => {
      const d = i - this.pos;
      const ad = Math.abs(d);

      const x = d * step;
      const z = -ad * DEPTH * 0.9 - (1 - grow) * 420;
      const ry = clamp(-d * ANGLE, -62, 62);
      const scale = 1 - Math.min(0.18, ad * 0.06);
      const opacity = clamp(1.05 - ad * 0.26, 0.05, 1) * grow;

      card.style.transform =
        `translate3d(${x.toFixed(2)}px, 0, ${z.toFixed(2)}px) rotateY(${ry.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      card.style.opacity = opacity.toFixed(3);
      card.style.zIndex = String(200 - Math.round(ad * 10));
      card.style.pointerEvents = 'auto';

      // the specular highlight belongs to the room, not the card: it
      // slides across the surface as the card turns away from us
      card.style.setProperty('--sheen-x', `${(-d * 26).toFixed(1)}%`);

      // blurring the backdrop is expensive, so only the near cards get it
      card.classList.toggle('is-near', ad < 1.65);
    });
  }

  _paintFooter(i) {
    const track = this.tracks[i];
    if (!track) return;
    if (this.indexEl) this.indexEl.textContent = `${String(i + 1).padStart(2, '0')} / ${String(this.tracks.length).padStart(2, '0')}`;
    if (this.titleEl) this.titleEl.textContent = track.title;
    if (this.artistEl) this.artistEl.textContent = (track.artist || '未知艺术家').toUpperCase();
  }
}
