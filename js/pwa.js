/* pwa.js — installable app shell. The service worker caches only the UI;
   /api/ stays network-only so NetEase login and audio are never stale. */

export function initPWA() {
  if (!('serviceWorker' in navigator)) return;
  const params = new URLSearchParams(location.search);
  if (params.get('sw') === '0') {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((reg) => reg.unregister()))
      .catch(() => {});
    return;
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      })
      .catch((err) => console.warn('[pwa]', err.message));
  });
}
