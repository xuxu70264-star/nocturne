/* gallery.js — the selected playlist as a diagonal stack of sleeves.
   A nine-card pool is recycled as the stack moves, so a 400-track playlist
   still keeps only nine buttons and at most nine thumbnails in the DOM. */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const BEFORE = 1;
const AFTER = 7;
const POOL = BEFORE + AFTER + 1;

function hueFor(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

function thumb(url) {
  const value = String(url || '').replace(/^http:\/\//i, 'https://');
  if (!value) return '';
  if (value.startsWith('blob:') || value.startsWith('data:')) return value;
  if (/music\.126\.net|126\.net/.test(value) && !/[?&]param=/.test(value)) {
    return `${value}?param=420y420`;
  }
  return value;
}

export class Gallery {
  constructor(opts) {
    this.root = opts.root;
    this.stage = opts.stage;
    this.ring = opts.ring;
    this.idxEl = opts.idx;
    this.nameEl = opts.name;
    this.subEl = opts.sub;
    this.onPick = opts.onPick;

    this.tracks = [];
    this.cards = [];
    this.openState = false;
    this.playing = -1;

    this.pos = 0;
    this.target = 0;
    this.appear = 0;
    this._focus = -1;
    this._drag = null;
    this._clickGuard = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.hover = -1;

    this._buildPool();

    this._onWheel = (event) => {
      if (!this.openState) return;
      event.preventDefault();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      this.target = clamp(this.target + delta * 0.0022, 0, this._max());
    };

    this._onDown = (event) => {
      if (!this.openState) return;
      if (event.target.closest && event.target.closest('.gallery__nav, .gallery__close')) return;
      this._clickGuard = false;
      this._drag = {
        x: event.clientX,
        y: event.clientY,
        start: this.target,
        moved: false,
        captured: false,
        pointerId: event.pointerId
      };
      this.root.classList.add('is-dragging');
    };

    this._onMove = (event) => {
      if (!this.openState) return;
      this.mouseX = (event.clientX / window.innerWidth - 0.5) * 2;
      this.mouseY = (event.clientY / window.innerHeight - 0.5) * 2;
      if (!this._drag) return;
      const dx = event.clientX - this._drag.x;
      const dy = event.clientY - this._drag.y;
      if (Math.hypot(dx, dy) > 5) {
        this._drag.moved = true;
        this._clickGuard = true;
        if (!this._drag.captured) {
          this._drag.captured = true;
          try { this.root.setPointerCapture(event.pointerId); } catch {}
        }
      }
      this.target = clamp(this._drag.start - (dx + dy * 0.7) / 180, 0, this._max());
    };

    this._onClickCapture = (e) => {
      if (!this._clickGuard) return;
      this._clickGuard = false;
      e.preventDefault();
      e.stopPropagation();
    };

    this._onUp = () => {
      if (this._drag && this._drag.captured) {
        try { this.root.releasePointerCapture?.(this._drag.pointerId); } catch {}
      }
      this._drag = null;
      this.root.classList.remove('is-dragging');
      setTimeout(() => { this._clickGuard = false; }, 30);
    };

    this.root.addEventListener('click', this._onClickCapture, true);
    this.root.addEventListener('wheel', this._onWheel, { passive: false });
    this.root.addEventListener('pointerdown', this._onDown);
    this.root.addEventListener('pointermove', this._onMove);
    this.root.addEventListener('pointerup', this._onUp);
    this.root.addEventListener('pointercancel', this._onUp);
    this._onOver = (e) => {
      const card = e.target.closest ? e.target.closest('.g-card') : null;
      if (card && card.dataset.track !== '') this.hover = Number(card.dataset.track);
    };
    this._onOut = (e) => {
      const to = e.relatedTarget;
      if (!to || !this.root.contains(to)) this.hover = -1;
    };
    this.root.addEventListener('pointerover', this._onOver);
    this.root.addEventListener('pointerout', this._onOut);
    this.root.addEventListener('pointerleave', () => {
      this.mouseX = 0;
      this.mouseY = 0;
      this.hover = -1;
    });
  }

  get isOpen() { return this.openState; }

  _max() { return Math.max(0, this.tracks.length - 1); }

  _buildPool() {
    for (let i = 0; i < POOL; i++) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'g-card';
      card.dataset.track = '';
      card.dataset.slot = String(i);

      const art = document.createElement('span');
      art.className = 'g-card__art';

      card.append(art);
      card.addEventListener('click', (event) => {
        event.stopPropagation();
        if (this._clickGuard) return;
        const trackIndex = Number(card.dataset.track);
        if (Number.isInteger(trackIndex) && trackIndex >= 0) this.onPick?.(trackIndex);
      });

      this.ring.appendChild(card);
      this.cards.push(card);
    }
  }

  setQueue(tracks, index = 0, playing = -1) {
    this.tracks = Array.isArray(tracks) ? tracks : [];
    this.playing = playing;
    this.cards.forEach((card) => {
      card.dataset.track = '';
      card.querySelector('.g-card__art').innerHTML = '';

      card.style.display = 'none';
      card.classList.remove('is-focus', 'is-playing');
    });
    this.pos = clamp(index, 0, this._max());
    this.target = this.pos;
    this._focus = -1;
    this.hover = -1;
    this.update(0);
  }

  open(index = 0) {
    this.openState = true;
    this.pos = clamp(index, 0, this._max());
    this.target = this.pos;
    this.appear = 0;
    this.hover = -1;
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    this.root.tabIndex = -1;
    this.root.focus({ preventScroll: true });
    this._focus = -1;
    this.update(0);
  }

  close() {
    this.openState = false;
    this._drag = null;
    this.hover = -1;
    this.root.classList.remove('is-open', 'is-dragging');
    this.root.setAttribute('aria-hidden', 'true');
  }

  step(direction = 1) {
    this.target = clamp(Math.round(this.target) + direction, 0, this._max());
  }

  pickFocused() {
    const i = Math.round(this.pos);
    if (this.tracks[i]) this.onPick?.(i);
  }

  _paintFooter(index) {
    const track = this.tracks[index];
    if (!track) return;
    if (this.idxEl) this.idxEl.textContent = `${String(index + 1).padStart(2, '0')} / ${String(this.tracks.length).padStart(2, '0')}`;
    if (this.nameEl) this.nameEl.textContent = track.title || '';
    if (this.subEl) this.subEl.textContent = (track.artist || '').toUpperCase();
  }

  _assign(card, trackIndex) {
    if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= this.tracks.length) {
      card.dataset.track = '';
      card.style.display = 'none';
      return false;
    }
    const key = String(trackIndex);
    if (card.dataset.track !== key) {
      card.dataset.track = key;
      card._hoverMix = 0;
      const track = this.tracks[trackIndex];
      const art = card.querySelector('.g-card__art');
      art.innerHTML = '';
      art.classList.toggle('is-typographic', !track.coverUrl);

      if (track.coverUrl) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = thumb(track.coverUrl);
        art.appendChild(img);
      } else {
        art.style.setProperty('--hue', String(hueFor(`${track.title || ''}${track.artist || ''}`)));
        const glyph = document.createElement('span');
        glyph.className = 'g-card__glyph';
        glyph.textContent = (track.title || '·').trim().charAt(0);
        art.appendChild(glyph);
      }

      card.classList.toggle('is-playing', trackIndex === this.playing);
    }
    card.style.display = '';
    return true;
  }

  update(dt) {
    if (!this.openState) return;
    const n = this.tracks.length;
    if (!n) return;

    this.appear = Math.min(1, this.appear + (dt > 0 ? dt / 0.5 : 1));
    const k = dt > 0 ? 1 - Math.exp(-dt * 10) : 1;
    this.pos += (this.target - this.pos) * k;
    if (Math.abs(this.target - this.pos) < 0.0005) this.pos = this.target;

    const focus = Math.round(this.pos);
    if (focus !== this._focus) {
      this._focus = focus;
      this._paintFooter(focus);
    }

    const width = this.stage.clientWidth || window.innerWidth || 1200;
    const height = this.stage.clientHeight || window.innerHeight || 800;
    const size = Math.max(150, Math.min(width * 0.30, height * 0.55, 380));
    this.ring.style.setProperty('--gw', `${size.toFixed(1)}px`);

    const gapX = size * 0.23;
    const gapY = size * -0.17;

    this.ring.style.transform =
      `translate3d(${(this.mouseX * 18).toFixed(1)}px, ${(this.mouseY * 12).toFixed(1)}px, 0)`;

    for (let slot = 0; slot < POOL; slot++) {
      const card = this.cards[slot];
      const d = slot - BEFORE; // -1 … 7, before easing
      const trackIndex = focus + d;
      if (!this._assign(card, trackIndex)) continue;

      const liveD = trackIndex - this.pos;
      const behind = Math.max(0, liveD);
      const targetHover = trackIndex === this.hover ? 1 : 0;
      const hk = dt > 0 ? 1 - Math.exp(-dt * 14) : 1;
      card._hoverMix = (card._hoverMix || 0) + (targetHover - (card._hoverMix || 0)) * hk;
      const hover = card._hoverMix;
      const x = liveD * gapX + hover * 84;
      const y = liveD * gapY - hover * 24;
      const z = -behind * 70 + hover * 150;
      const scale = 1 - behind * 0.012 + hover * 0.028;
      const rotateY = -9 - Math.min(5, behind * 0.9) + hover * 4;
      const rotateX = 2.2 - hover * 1.6;
      const opacity = this.appear * (1 - Math.min(0.42, behind * 0.055));

      card.style.transform =
        `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(1)}px) ` +
        `rotateY(${rotateY.toFixed(2)}deg) rotateX(${rotateX.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      card.style.opacity = opacity.toFixed(3);
      card.style.zIndex = String(300 - Math.round(behind * 10) + Math.round(hover * 40));
      card.classList.toggle('is-focus', trackIndex === focus);
    }
  }
}
