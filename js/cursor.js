/* cursor.js — a small paper dot with a slow ring.
   The native cursor is hidden only when this module is active on a fine
   pointer; text fields keep their native caret. ?cursor=0 keeps the OS cursor. */

export function initCursor() {
  if (typeof window === 'undefined') return;
  if (new URLSearchParams(location.search).get('cursor') === '0') return;
  if (!window.matchMedia('(pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // still allow the custom shape, but no lag / hover scale animation
  }

  const root = document.documentElement;
  const el = document.createElement('div');
  el.className = 'cursor';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<span class="cursor__ring"></span><span class="cursor__dot"></span>';
  document.body.appendChild(el);

  const ring = el.querySelector('.cursor__ring');
  const dot = el.querySelector('.cursor__dot');
  const interactive = 'a,button,[role="button"],input,textarea,select,.g-card,.shelf-card,.track,.nav__item,.preset-slot';
  const textField = 'input,textarea,[contenteditable="true"]';

  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let rx = x;
  let ry = y;
  let visible = false;
  let down = false;
  let raf = 0;
  let last = 0;

  root.classList.add('has-cursor');

  function place(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    const k = 1 - Math.exp(-dt * 18);
    rx += (x - rx) * k;
    ry += (y - ry) * k;
    dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
    raf = requestAnimationFrame(place);
  }

  function show() {
    if (visible) return;
    visible = true;
    el.classList.add('is-visible');
  }

  function hide() {
    visible = false;
    el.classList.remove('is-visible', 'is-hover', 'is-down', 'is-text');
    root.classList.remove('is-text');
  }

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    x = e.clientX;
    y = e.clientY;
    show();
    const target = e.target?.closest ? e.target : null;
    const isText = !!target?.closest?.(textField);
    const isInteractive = !!target?.closest?.(interactive);
    el.classList.toggle('is-hover', isInteractive && !isText);
    el.classList.toggle('is-text', isText);
    root.classList.toggle('is-text', isText);
  }, { passive: true });

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || !visible) return;
    down = true;
    el.classList.add('is-down');
  }, { passive: true });

  window.addEventListener('pointerup', () => {
    down = false;
    el.classList.remove('is-down');
  }, { passive: true });

  window.addEventListener('pointercancel', () => {
    down = false;
    el.classList.remove('is-down');
  }, { passive: true });

  document.addEventListener('pointerleave', hide);
  document.addEventListener('pointerenter', show);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', () => {
    if (!visible) return;
    x = Math.min(x, window.innerWidth);
    y = Math.min(y, window.innerHeight);
  });

  raf = requestAnimationFrame(place);
  window.addEventListener('pagehide', () => cancelAnimationFrame(raf), { once: true });
}
