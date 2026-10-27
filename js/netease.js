/* NetEase search lives in the library drawer. The actual audio and cookies
   stay behind server.js; this module only turns a result into a queue item. */

const $ = (id) => document.getElementById(id);

function seconds(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? Math.round(n / 1000) : 0;
}

function clock(total) {
  if (!total) return '--:--';
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function secure(url) {
  return String(url || '').replace(/^http:\/\//i, 'https://');
}

export function initNetease({ onPick } = {}) {
  const form = $('nsearch-form');
  const input = $('nsearch-input');
  const results = $('nsearch-results');
  const hint = $('nsearch-hint-text');
  const login = $('nsearch-login');
  const stateEl = $('nsearch-state');
  if (!form || !input || !results) return;

  let loggedIn = false;
  let busy = false;

  function setHint(text, showLogin = false) {
    if (hint) hint.textContent = text;
    if (login) login.hidden = !showLogin;
  }

  async function refresh() {
    try {
      const res = await fetch('/api/netease/me', { cache: 'no-store' });
      const data = await res.json();
      loggedIn = !!data.loggedIn;
    } catch {
      loggedIn = false;
    }
    input.disabled = !loggedIn;
    input.placeholder = loggedIn ? '搜索歌曲 / 歌手' : '登录后可搜索';
    if (stateEl) stateEl.textContent = loggedIn ? '已连接' : '未登录';
    if (!loggedIn) setHint('登录后可搜索网易云', true);
    else setHint('搜索网易云曲库', false);
  }

  function render(songs) {
    results.innerHTML = '';
    if (!songs.length) {
      const empty = document.createElement('li');
      empty.className = 'nsearch__empty';
      empty.textContent = '没有找到结果';
      results.appendChild(empty);
      return;
    }

    for (const song of songs) {
      const li = document.createElement('li');
      li.className = 'nsearch__result';
      li.dataset.id = song.id;
      li.dataset.title = song.name;
      li.dataset.artist = song.artist;
      li.dataset.album = song.album;
      li.dataset.cover = song.cover;
      li.dataset.duration = String(seconds(song.duration));

      const art = document.createElement('span');
      art.className = 'nsearch__art';
      if (song.cover) art.style.backgroundImage = `url("${secure(song.cover)}")`;

      const main = document.createElement('span');
      main.className = 'nsearch__main';
      const title = document.createElement('span');
      title.className = 'nsearch__title';
      title.textContent = song.name;
      const artist = document.createElement('span');
      artist.className = 'nsearch__artist';
      artist.textContent = song.artist || '未知艺术家';
      main.append(title, artist);

      const dur = document.createElement('span');
      dur.className = 'nsearch__dur';
      dur.textContent = clock(seconds(song.duration));

      li.append(art, main, dur);
      results.appendChild(li);
    }
  }

  async function search(query) {
    const q = String(query || '').trim();
    if (!loggedIn) {
      setHint('先登录网易云', true);
      return;
    }
    if (!q || busy) return;
    busy = true;
    results.innerHTML = '<li class="nsearch__empty">搜索中…</li>';
    setHint('搜索中…', false);
    try {
      const res = await fetch(`/api/netease/search?q=${encodeURIComponent(q)}&limit=16`, {
        cache: 'no-store'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '搜索失败');
      render(data.songs || []);
      setHint(`找到 ${data.songs?.length || 0} 首`, false);
    } catch (err) {
      results.innerHTML = '';
      setHint(err.message || '搜索失败', false);
    } finally {
      busy = false;
    }
  }

  async function pick(row) {
    if (!row || busy) return;
    const song = {
      id: row.dataset.id,
      name: row.dataset.title,
      artist: row.dataset.artist,
      album: row.dataset.album,
      cover: row.dataset.cover,
      duration: Number(row.dataset.duration) || 0
    };
    busy = true;
    row.classList.add('is-loading');
    setHint('正在获取播放地址…', false);
    try {
      const res = await fetch(`/api/netease/song?id=${encodeURIComponent(song.id)}`, {
        cache: 'no-store'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '获取播放地址失败');
      if (typeof onPick === 'function') onPick(song, data);
      setHint(data.trial ? '试听片段' : '已加入队列', false);
    } catch (err) {
      setHint(err.message || '获取播放地址失败', false);
    } finally {
      busy = false;
      row.classList.remove('is-loading');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search(input.value);
  });

  if (login) {
    login.addEventListener('click', () => {
      const button = $('login-btn');
      if (button) button.click();
    });
  }

  results.addEventListener('click', (event) => {
    const row = event.target.closest('.nsearch__result');
    if (row) pick(row);
  });

  window.addEventListener('nocturne:drawer-open', refresh);
  window.addEventListener('nocturne:login', refresh);
  refresh();
}
