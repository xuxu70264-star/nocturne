import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

const ROOT = import.meta.dirname;
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.lrc': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg'
};

const NETEASE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* NetEase login state. The cookie is cached in a local, owner-only file so a
   normal server restart no longer forces a fresh QR/cookie login. */
const netease = {
  cookie: '',
  profile: null
};

const SESSION_FILE = path.join(ROOT, '.netease-session.json');
const SESSION_VERSION = 1;

function saveSession() {
  if (!netease.cookie || !netease.profile) return;
  try {
    const payload = {
      version: SESSION_VERSION,
      savedAt: new Date().toISOString(),
      cookie: netease.cookie,
      profile: netease.profile
    };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
    try { fs.chmodSync(SESSION_FILE, 0o600); } catch (err) { /* Windows may ignore mode */ }
  } catch (err) {
    console.warn('[session] save failed:', err.message);
  }
}

function forgetSession() {
  try { fs.rmSync(SESSION_FILE, { force: true }); } catch (err) { /* ignore */ }
}

async function restoreSession() {
  let cookie = normalizeCookie(process.env.NOCTURNE_NETEASE_COOKIE || '');
  if (!cookie) {
    try {
      const saved = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (saved && saved.version === SESSION_VERSION) cookie = normalizeCookie(saved.cookie);
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[session] read failed:', err.message);
    }
  }
  if (!cookie) return;

  netease.cookie = cookie;
  const profile = await fetchProfile(cookie);
  if (profile) {
    netease.profile = profile;
    saveSession();
    console.log(`[netease] session restored: ${profile.nickname || profile.userId}`);
  } else {
    // Keep the cookie: a network hiccup should not delete a valid login.
    console.warn('[netease] saved cookie could not be verified yet');
  }
}

/* One QR key lives for five minutes. */
const qrSessions = new Map();
const QR_TTL = 5 * 60 * 1000;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(payload);
}

function setCookiesOf(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie() || [];
  }
  const raw = response.headers.get('set-cookie');
  return raw ? raw.split(/,(?=[^;,]+=)/) : [];
}

function cookieMap(header) {
  const map = new Map();
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) map.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    });
  return map;
}

function mergeCookies(header, setCookies) {
  const map = cookieMap(header);
  for (const item of setCookies || []) {
    const pair = String(item).split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return [...map].map(([key, value]) => `${key}=${value}`).join('; ');
}

async function neteaseFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': NETEASE_UA,
        Referer: 'https://music.163.com/',
        Origin: 'https://music.163.com',
        Accept: 'application/json, text/plain, */*',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

/* --- the app-client API (eapi) used for search / stream / lyric ---------- */

const EAPI_KEY = Buffer.from('e82ckenh8dichen8');
const EAPI_UA = 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)';
const EAPI_COOKIE_KEYS = [
  'MUSIC_U', 'MUSIC_A', '__csrf', 'NMTID', 'WNMCID', 'WEVNSM',
  '_ntes_nuid', '_ntes_nnid', 'MUSIC_R_U', 'deviceId', 'sDeviceId'
];

function eapiEncrypt(uri, data) {
  const text = JSON.stringify(data || {});
  const digest = crypto
    .createHash('md5')
    .update(`nobody${uri}use${text}md5forencrypt`)
    .digest('hex');
  const payload = `${uri}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const cipher = crypto.createCipheriv('aes-128-ecb', EAPI_KEY, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
    .toString('hex')
    .toUpperCase();
}

function eapiCookieHeader() {
  const map = cookieMap(netease.cookie);
  const fields = {
    os: 'ios',
    osver: '16.2',
    appver: '9.0.90',
    versioncode: '140',
    channel: 'distribution'
  };
  for (const key of EAPI_COOKIE_KEYS) {
    if (map.has(key) && map.get(key)) fields[key] = map.get(key);
  }
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('; ');
}

async function eapi(uri, data = {}) {
  if (!netease.cookie) throw new Error('not logged in');
  const csrf = cookieMap(netease.cookie).get('__csrf') || '';
  const params = eapiEncrypt(uri, { ...data, csrf_token: csrf });
  const res = await neteaseFetch(`https://interface.music.163.com/eapi/${uri.slice(5)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': EAPI_UA,
      Cookie: eapiCookieHeader()
    },
    body: new URLSearchParams({ params }).toString()
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.code && body.code !== 200)) {
    throw new Error(body.message || body.msg || `netease eapi ${uri} failed`);
  }
  return body;
}

function mapNeteaseSong(song) {
  const artists = (song.ar || song.artists || [])
    .map((artist) => artist && artist.name)
    .filter(Boolean);
  const album = song.al || song.album || {};
  return {
    id: String(song.id || ''),
    name: song.name || '',
    artist: artists.join(' / '),
    album: album.name || '',
    cover: album.picUrl || album.coverUrl || '',
    duration: Number(song.dt || song.duration || 0),
    fee: song.fee
  };
}

async function neteaseSearch(keywords, limit = 20, offset = 0) {
  const query = String(keywords || '').trim();
  if (!query) return [];
  const paths = [
    ['/api/cloudsearch/pc', { s: query, type: 1, limit, offset, total: true }],
    ['/api/search/pc', { s: query, type: 1, limit, offset }],
    ['/api/search/get', { s: query, type: 1, limit, offset }]
  ];
  for (const [uri, data] of paths) {
    try {
      const body = await eapi(uri, data);
      const songs = (body.result && body.result.songs) || body.songs || [];
      if (songs.length) return songs.map(mapNeteaseSong);
    } catch {
      /* try the next endpoint */
    }
  }
  return [];
}

async function neteaseSongUrl(id) {
  const levels = ['exhigh', 'standard'];
  for (const level of levels) {
    try {
      const body = await eapi('/api/song/enhance/player/url/v1', {
        ids: `[${id}]`,
        level,
        encodeType: 'flac'
      });
      const data = body.data && body.data[0];
      if (data && data.url) {
        return {
          url: data.url,
          level,
          br: data.br,
          trial: !!data.freeTrialInfo
        };
      }
    } catch {
      /* try legacy / lower quality */
    }
    try {
      const body = await eapi('/api/song/enhance/player/url', {
        ids: `[${id}]`,
        br: 320000
      });
      const data = body.data && body.data[0];
      if (data && data.url) {
        return { url: data.url, level: 'standard', br: data.br, trial: false };
      }
    } catch {
      /* keep trying */
    }
  }
  return null;
}

function cleanNeteaseLyric(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) =>
      /^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(line) ||
      /^\s*\[(?:ti|ar|al|by|offset|re|ve|length):/i.test(line)
    )
    .join('\n')
    .trim();
}

async function neteaseLyric(id) {
  for (const [uri, data] of [
    ['/api/song/lyric/v1', { id, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0 }],
    ['/api/song/lyric', { id, lv: -1, tv: -1 }]
  ]) {
    try {
      const body = await eapi(uri, data);
      const raw = (body.lrc && body.lrc.lyric) || (body.yrc && body.yrc.lyric) || '';
      const cleaned = cleanNeteaseLyric(raw);
      if (cleaned) return cleaned;
    } catch {
      /* no lyric is fine */
    }
  }
  return '';
}

async function neteasePlaylists() {
  const uid = netease.profile && netease.profile.userId;
  if (!uid) throw new Error('not logged in');
  const body = await eapi('/api/user/playlist', {
    uid,
    limit: 100,
    offset: 0,
    includeVideo: true
  });
  const list = body.playlist || (body.data && body.data.playlist) || [];
  return list
    .map((item) => ({
      id: String(item.id || ''),
      name: item.name || '未命名歌单',
      cover: item.coverImgUrl || item.picUrl || '',
      trackCount: Number(item.trackCount || 0),
      creator: (item.creator && item.creator.nickname) || '',
      specialType: Number(item.specialType || 0)
    }))
    .filter((item) => item.id && item.name)
    .sort((a, b) => (b.specialType === 5) - (a.specialType === 5));
}

async function neteasePlaylist(id) {
  const body = await eapi('/api/v6/playlist/detail', { id, n: 1000, s: 0 });
  const playlist = body.playlist || (body.data && body.data.playlist) || {};
  let songs = (playlist.tracks || []).map(mapNeteaseSong).filter((s) => s.id && s.name);
  if (!songs.length && Array.isArray(playlist.trackIds) && playlist.trackIds.length) {
    const ids = playlist.trackIds.slice(0, 1000).map((item) => ({ id: item.id }));
    const detail = await eapi('/api/v3/song/detail', { c: JSON.stringify(ids) });
    songs = (detail.songs || []).map(mapNeteaseSong).filter((s) => s.id && s.name);
  }
  return {
    playlist: {
      id: String(playlist.id || id),
      name: playlist.name || '歌单',
      cover: playlist.coverImgUrl || '',
      trackCount: Number(playlist.trackCount || songs.length)
    },
    songs
  };
}

async function neteaseDaily() {
  const paths = [
    '/api/v3/discovery/recommend/songs',
    '/api/recommend/songs',
    '/api/discovery/recommend/songs'
  ];
  for (const uri of paths) {
    try {
      const body = await eapi(uri, {});
      const data = body.data || {};
      const candidates = [
        data.dailySongs,
        data.recommend,
        body.recommend,
        body.dailySongs,
        body.songs,
        Array.isArray(data) ? data : null
      ];
      for (const list of candidates) {
        if (Array.isArray(list) && list.length) {
          return list.map(mapNeteaseSong).filter((s) => s.id && s.name);
        }
      }
    } catch {
      /* try the next endpoint */
    }
  }
  return [];
}


function isNeteaseAudioHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return (
    host === 'music.126.net' ||
    host.endsWith('.music.126.net') ||
    host === '126.net' ||
    host.endsWith('.126.net') ||
    host.endsWith('.netease.com')
  );
}

async function proxyNeteaseAudio(req, res, url) {
  const raw = url.searchParams.get('url') || '';
  let target;
  try {
    target = new URL(raw);
  } catch {
    res.writeHead(400);
    res.end('Bad audio url');
    return;
  }
  if (!/^https?:$/.test(target.protocol) || !isNeteaseAudioHost(target.hostname)) {
    res.writeHead(403);
    res.end('Forbidden audio host');
    return;
  }

  const headers = {
    'User-Agent': NETEASE_UA,
    Referer: 'https://music.163.com/'
  };
  if (req.headers.range) headers.Range = req.headers.range;
  // No 9s API timeout here: an audio stream is allowed to stay open.
  const upstream = await fetch(target, { headers, redirect: 'follow' });
  if (!upstream.ok && upstream.status !== 206) {
    res.writeHead(upstream.status === 416 ? 416 : 502);
    res.end();
    return;
  }

  const responseHeaders = {
    'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  };
  for (const key of ['content-length', 'content-range']) {
    const value = upstream.headers.get(key);
    if (value) responseHeaders[key.replace(/(^|-)\w/g, (s) => s.toUpperCase())] = value;
  }
  res.writeHead(upstream.status, responseHeaders);
  if (req.method === 'HEAD' || !upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body).pipe(res);
}

function profileFromBody(body) {
  const source = body && (body.profile || body);
  if (!source) return null;
  const nickname = source.nickname || source.nickName || source.userName || '';
  const avatarUrl = source.avatarUrl || source.avatar || source.avatarImg || '';
  const userId = source.userId || source.user_id || source.uid || '';
  if (!nickname && !avatarUrl && !userId) return null;
  return {
    userId: String(userId || ''),
    nickname: String(nickname || '网易云用户'),
    avatarUrl: String(avatarUrl || '')
  };
}

async function fetchProfile(cookie) {
  try {
    const res = await neteaseFetch('https://music.163.com/api/nuser/account/get', {
      headers: { Cookie: cookie }
    });
    if (!res.ok) return null;
    const body = await res.json();
    return profileFromBody(body);
  } catch {
    return null;
  }
}

function normalizeCookie(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (!value.includes('=')) value = `MUSIC_U=${value}`;
  return value.replace(/\s+/g, ' ');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 16 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function cleanQrSessions() {
  const now = Date.now();
  for (const [key, value] of qrSessions) {
    if (now - value.at > QR_TTL) qrSessions.delete(key);
  }
}

async function createQr() {
  cleanQrSessions();
  const res = await neteaseFetch('https://music.163.com/api/login/qrcode/unikey?type=1');
  const body = await res.json().catch(() => ({}));
  if (!body.unikey) throw new Error(body.message || '网易云没有返回二维码 key');
  const key = String(body.unikey);
  const cookies = mergeCookies('', setCookiesOf(res));
  qrSessions.set(key, { at: Date.now(), cookies });
  return {
    key,
    url: `https://music.163.com/login?codekey=${encodeURIComponent(key)}`
  };
}

async function checkQr(key) {
  cleanQrSessions();
  const session = qrSessions.get(key);
  if (!session) return { code: 800, message: '二维码已失效' };

  const res = await neteaseFetch(
    `https://music.163.com/api/login/qrcode/client/login?key=${encodeURIComponent(key)}&type=1`,
    { headers: { Cookie: session.cookies } }
  );
  const body = await res.json().catch(() => ({}));
  const code = Number(body.code || 0);

  if (code === 803) {
    const setCookies = setCookiesOf(res);
    netease.cookie = mergeCookies('', setCookies);
    netease.profile = profileFromBody(body) || (await fetchProfile(netease.cookie));
    saveSession();
    qrSessions.delete(key);
    return {
      code: 803,
      message: body.message || '登录成功',
      profile: netease.profile
    };
  }

  if (code === 800) qrSessions.delete(key);
  if (![800, 801, 802, 803].includes(code)) {
    console.warn('[qr]', code, body.message || '');
  }
  return { code, message: body.message || '' };
}

async function handleApi(req, res, pathname, url) {
  if (pathname === '/api/netease/playlists' && req.method === 'GET') {
    if (!netease.cookie) return json(res, 401, { error: '先登录网易云' });
    const playlists = await neteasePlaylists();
    return json(res, 200, { playlists });
  }

  if (pathname === '/api/netease/playlist' && req.method === 'GET') {
    if (!netease.cookie) return json(res, 401, { error: '先登录网易云' });
    const id = String(url.searchParams.get('id') || '').trim();
    if (!id) return json(res, 400, { error: 'missing id' });
    const data = await neteasePlaylist(id);
    return json(res, 200, data);
  }

  if (pathname === '/api/netease/daily' && req.method === 'GET') {
    if (!netease.cookie) return json(res, 401, { error: '先登录网易云' });
    const songs = await neteaseDaily();
    return json(res, 200, { songs });
  }

  if (pathname === '/api/netease/search' && req.method === 'GET') {
    if (!netease.cookie) return json(res, 401, { error: '先登录网易云' });
    const q = url.searchParams.get('q') || '';
    const limit = Math.max(1, Math.min(30, Number(url.searchParams.get('limit')) || 20));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const songs = await neteaseSearch(q, limit, offset);
    return json(res, 200, { songs, hasMore: songs.length >= limit });
  }

  if (pathname === '/api/netease/song' && req.method === 'GET') {
    if (!netease.cookie) return json(res, 401, { error: '先登录网易云' });
    const id = String(url.searchParams.get('id') || '').trim();
    if (!id) return json(res, 400, { error: 'missing id' });
    const [stream, lyric] = await Promise.all([neteaseSongUrl(id), neteaseLyric(id)]);
    if (!stream) {
      return json(res, 404, { error: '这首歌没有可播放地址，可能是版权、会员或地区限制' });
    }
    return json(res, 200, {
      id,
      url: stream.url,
      quality: stream.level === 'exhigh' ? '极高' : '标准',
      trial: stream.trial,
      lyric
    });
  }

  if (pathname === '/api/netease/audio' && (req.method === 'GET' || req.method === 'HEAD')) {
    return proxyNeteaseAudio(req, res, url);
  }

  if (pathname === '/api/netease/login/qr' && req.method === 'POST') {
    const qr = await createQr();
    return json(res, 200, qr);
  }

  if (pathname === '/api/netease/login/qr/check' && req.method === 'GET') {
    const key = url.searchParams.get('key') || '';
    if (!key) return json(res, 400, { error: 'missing key' });
    return json(res, 200, await checkQr(key));
  }

  if (pathname === '/api/netease/login/cookie' && req.method === 'POST') {
    const body = await readJson(req);
    const cookie = normalizeCookie(body.cookie || body.music_u || '');
    if (!/(?:^|;\s*)(MUSIC_U|MUSIC_A)=/.test(cookie)) {
      return json(res, 400, { error: 'Cookie 里没有 MUSIC_U' });
    }
    const profile = await fetchProfile(cookie);
    if (!profile) return json(res, 401, { error: 'Cookie 无效或已过期' });
    netease.cookie = cookie;
    netease.profile = profile;
    saveSession();
    return json(res, 200, { ok: true, profile });
  }

  if (pathname === '/api/netease/me' && req.method === 'GET') {
    if (!netease.profile && netease.cookie) {
      const profile = await fetchProfile(netease.cookie);
      if (profile) {
        netease.profile = profile;
        saveSession();
      }
    }
    return json(res, 200, {
      loggedIn: !!netease.profile,
      profile: netease.profile
    });
  }

  if (pathname === '/api/netease/logout' && req.method === 'POST') {
    netease.cookie = '';
    netease.profile = null;
    forgetSession();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'unknown api' });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, pathname, url);
    } catch (err) {
      console.warn('[api]', pathname, err && err.message);
      if (!res.headersSent) json(res, 500, { error: 'netease request failed' });
    }
    return;
  }

  // never expose dotfiles: .netease-session.json holds the account cookie
  if (pathname.split('/').some((part) => part.startsWith('.'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return;
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;

    // Range support keeps <audio> seeking instant on long local tracks.
    const match = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

await restoreSession().catch((err) => {
  console.warn('[session] restore failed:', err.message);
});

server.listen(PORT, HOST, () => {
  console.log(`Nocturne: http://${HOST}:${PORT}/`);
});
