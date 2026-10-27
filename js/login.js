/* NetEase Cloud Music — QR login.
   The QR key and the polled cookie never touch the page: server.js keeps them
   in memory and only hands the page a nickname / avatar when 803 lands. */

const $ = (id) => document.getElementById(id);

const els = {
  button: $('login-btn'),
  avatar: $('login-avatar'),
  label: $('login-label'),
  modal: $('login-modal'),
  title: $('login-title'),
  qr: $('login-qr'),
  status: $('login-status'),
  statusText: $('login-status')?.querySelector('span'),
  hint: $('login-hint'),
  profile: $('login-profile'),
  profileAvatar: $('login-profile-avatar'),
  profileName: $('login-profile-name'),
  refresh: $('login-refresh'),
  logout: $('login-logout'),
  cookieBtn: $('login-cookie-btn'),
  cookiePanel: $('login-cookie-panel'),
  cookieInput: $('login-cookie-input'),
  cookieSubmit: $('login-cookie-submit'),
  cookieBack: $('login-cookie-back'),
  fine: document.querySelector('.login-card__fine')
};

const state = {
  profile: null,
  key: '',
  timer: 0,
  token: 0,
  open: false
};

function secure(url) {
  return String(url || '').replace(/^http:\/\//i, 'https://');
}

function setStatus(text, mode = '') {
  if (els.statusText) els.statusText.textContent = text;
  els.modal.classList.toggle('is-scanned', mode === 'scanned');
  els.modal.classList.toggle('is-error', mode === 'error');
  els.modal.classList.toggle('is-expired', mode === 'expired');
}

function setActions({ refresh = false, cookie = false, logout = false } = {}) {
  els.refresh.hidden = !refresh;
  els.cookieBtn.hidden = !cookie;
  els.logout.hidden = !logout;
}

function updateButton(profile) {
  state.profile = profile || null;
  const signed = !!state.profile;
  els.button.classList.toggle('is-in', signed);
  els.avatar.hidden = !signed;
  els.label.textContent = signed ? (state.profile.nickname || '网易云') : '登录';
  els.button.setAttribute(
    'aria-label',
    signed ? `网易云音乐：${state.profile.nickname || '已登录'}` : '登录网易云音乐'
  );
  if (signed) {
    els.avatar.style.backgroundImage = state.profile.avatarUrl
      ? `url("${secure(state.profile.avatarUrl)}")`
      : '';
  } else {
    els.avatar.style.backgroundImage = '';
  }
  window.dispatchEvent(new CustomEvent('nocturne:login', { detail: state.profile }));
}

function stopPoll() {
  clearTimeout(state.timer);
  state.timer = 0;
  state.key = '';
  state.token += 1;
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function renderQr(url) {
  if (typeof window.qrcode !== 'function') {
    throw new Error('二维码组件没有加载');
  }
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  let svg = '';
  try {
    svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch {
    svg = qr.createSvgTag(4, 0);
  }
  els.qr.innerHTML = svg;
}

async function startQr() {
  stopPoll();
  const token = ++state.token;

  els.modal.classList.remove('is-expired', 'is-scanned', 'is-error');
  els.title.textContent = '扫码登录';
  els.profile.hidden = true;
  els.cookiePanel.hidden = true;
  els.qr.hidden = false;
  els.hint.hidden = false;
  els.status.hidden = false;
  els.qr.innerHTML = '<span class="login-card__spinner" aria-hidden="true"></span>';
  setStatus('正在生成二维码…');
  setActions({ cookie: true });

  try {
    const data = await api('/api/netease/login/qr', { method: 'POST' });
    if (!state.open || token !== state.token) return;
    state.key = data.key;
    renderQr(data.url);
    setStatus('等待扫码');
    setActions({ refresh: true, cookie: true });
    poll();
  } catch (err) {
    if (!state.open || token !== state.token) return;
    els.qr.innerHTML = '';
    setStatus(err.message || '二维码生成失败', 'error');
    setActions({ refresh: true, cookie: true });
  }
}

function poll() {
  if (!state.open || !state.key) return;
  const token = state.token;
  const key = state.key;

  state.timer = setTimeout(async () => {
    if (!state.open || token !== state.token || key !== state.key) return;
    try {
      const data = await api(`/api/netease/login/qr/check?key=${encodeURIComponent(key)}`);
      if (!state.open || token !== state.token) return;

      if (data.code === 802) {
        setStatus('已扫码，请在手机上确认', 'scanned');
        poll();
        return;
      }
      if (data.code === 803) {
        stopPoll();
        updateButton(data.profile || null);
        showAccount(data.profile || { nickname: '网易云用户', avatarUrl: '' });
        return;
      }
      if (data.code === 800) {
        stopPoll();
        setStatus('二维码已失效', 'expired');
        setActions({ refresh: true, cookie: true });
        return;
      }
      if (data.code !== 801) {
        stopPoll();
        const denied = /切换其他登录方式|升级新版本/.test(data.message || '');
        if (denied) {
          setStatus('网易云已限制网页扫码；改用 Cookie 登录一次，之后会自动记住', 'error');
          setActions({ cookie: true });
          setTimeout(() => {
            if (state.open) showCookiePanel();
          }, 900);
        } else {
          setStatus(data.message || '扫码失败，请重试', 'error');
          setActions({ refresh: true, cookie: true });
        }
        return;
      }
      setStatus(data.message || '等待扫码');
      poll();
    } catch (err) {
      if (!state.open || token !== state.token) return;
      stopPoll();
      setStatus(err.message || '连接失败，请重试', 'error');
      setActions({ refresh: true });
    }
  }, 1800);
}

function showCookiePanel() {
  stopPoll();
  els.title.textContent = 'Cookie 登录';
  els.qr.hidden = true;
  els.hint.hidden = true;
  els.profile.hidden = true;
  els.cookiePanel.hidden = false;
  els.status.hidden = false;
  setStatus('粘贴 MUSIC_U');
  setActions({});
  setTimeout(() => els.cookieInput && els.cookieInput.focus(), 80);
}

async function submitCookie() {
  const value = (els.cookieInput && els.cookieInput.value.trim()) || '';
  if (!value) {
    setStatus('先粘贴 MUSIC_U', 'error');
    return;
  }
  els.cookieSubmit.disabled = true;
  setStatus('正在验证 Cookie…');
  try {
    const data = await api('/api/netease/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: value })
    });
    updateButton(data.profile || null);
    showAccount(data.profile || { nickname: '网易云用户', avatarUrl: '' });
  } catch (err) {
    setStatus(err.message || 'Cookie 无效或已过期', 'error');
    els.cookieSubmit.disabled = false;
  }
}

function showAccount(profile) {
  updateButton(profile);
  els.title.textContent = '已登录';
  els.qr.hidden = true;
  els.hint.hidden = true;
  els.cookiePanel.hidden = true;
  els.profile.hidden = false;
  els.profileAvatar.style.backgroundImage = profile.avatarUrl
    ? `url("${secure(profile.avatarUrl)}")`
    : '';
  els.profileName.textContent = profile.nickname || '网易云用户';
  setStatus('已连接网易云音乐');
  setActions({ logout: true });
  if (els.fine) els.fine.textContent = '登录状态保存在本机 .netease-session.json，重启服务后自动恢复';
}

function open() {
  if (state.open) return;
  state.open = true;
  els.modal.classList.add('is-open');
  els.modal.setAttribute('aria-hidden', 'false');
  els.button.setAttribute('aria-expanded', 'true');
  document.body.classList.add('is-login-open');
  if (state.profile) showAccount(state.profile);
  else startQr();
  const close = els.modal.querySelector('.login-card__close');
  setTimeout(() => close && close.focus(), 120);
}

function close() {
  if (!state.open) return;
  state.open = false;
  stopPoll();
  els.modal.classList.remove('is-open', 'is-scanned', 'is-error', 'is-expired');
  els.modal.setAttribute('aria-hidden', 'true');
  els.button.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('is-login-open');
  els.button.focus();
}

async function logout() {
  try {
    await api('/api/netease/logout', { method: 'POST' });
  } catch {
    /* the local service may already be gone; clearing the UI is still right */
  }
  updateButton(null);
  state.profile = null;
  if (state.open) startQr();
}

export function initLogin() {
  if (!els.button || !els.modal) return;

  els.button.addEventListener('click', open);
  els.modal.querySelectorAll('[data-login-close]').forEach((node) => {
    node.addEventListener('click', close);
  });
  els.refresh.addEventListener('click', startQr);
  els.logout.addEventListener('click', logout);
  els.cookieBtn.addEventListener('click', showCookiePanel);
  els.cookieBack.addEventListener('click', startQr);
  els.cookieSubmit.addEventListener('click', submitCookie);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) close();
  });

  api('/api/netease/me')
    .then((data) => {
      if (data && data.loggedIn && data.profile) updateButton(data.profile);
    })
    .catch(() => {
      /* the page still works on local files when the server has no NetEase routes */
    });
}
