/* app.js — the conductor.
   Owns the queue, the clock, the lyrics, and every button.     */

import { AudioEngine } from './audio.js';
import { Stage } from './stage.js';
import { Heart } from './heart.js';
import { PaperDots } from './paper-dots.js';
import { parseLRC, parsePlainLyrics, distribute, indexAt, lineProgress, formatTime } from './lyrics.js';
import { PRESETS, presetById } from './presets.js';
import { Shelf } from './shelf.js';
import { Wheel } from './wheel.js';
import { Gallery } from './gallery.js';
import { InkVeil } from './ink.js';
import { readTags, readId3 } from './meta.js';
import { initLogin } from './login.js';
import { initNetease } from './netease.js';
import { initCursor } from './cursor.js';
import { initPWA } from './pwa.js';

const PRESET_KEY = 'nocturne.preset';

const $ = (id) => document.getElementById(id);

const AUDIO_RE = /\.(mp3|flac|wav|m4a|aac|ogg|opus|webm)$/i;
const LRC_RE = /\.(lrc|txt)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;

const params = new URLSearchParams(location.search);
const STILL = params.has('still');


const state = {
  queue: [],
  index: 0,
  entered: false,
  playing: false,
  showLyrics: true,
  lyrics: null,
  lyricIndex: -1,
  activeIndex: -1,
  idleTimer: 0,
  mockTime: Number(params.get('t')) || 0,
  virtualTime: 0,
  librarySource: 'local',
  libraryLabel: '本地队列'
};

const el = {
  audio: $('audio'),
  stage: $('gl'),
  stageRoot: $('stage'),
  heart: $('heart'),
  clock: $('clock'),
  btnLyrics: $('btn-lyrics'),
  btnDailyMobile: $('btn-daily-mobile'),
  nav: $('nav'),
  btnPlaylist: $('btn-playlist'),
  btnFull: $('btn-full'),
  listCount: $('list-count'),
  libraryDivider: $('library-divider'),
  lyrics: $('lyrics'),
  lyricPrev: $('lyric-prev'),
  lyricCur: $('lyric-cur'),
  lyricNext: $('lyric-next'),
  quiet: $('quiet'),
  quietTitle: $('quiet-title'),
  quietArtist: $('quiet-artist'),
  quietNote: $('quiet-note'),
  progress: $('progress'),
  fill: $('progress-fill'),
  buffer: $('progress-buffer'),
  trackIndex: $('track-index'),
  trackTitle: $('track-title'),
  trackArtist: $('track-artist'),
  btnPrev: $('btn-prev'),
  btnPlay: $('btn-play'),
  btnNext: $('btn-next'),
  tCur: $('t-cur'),
  tDur: $('t-dur'),
  btnMute: $('btn-mute'),
  vol: $('vol'),
  drawer: $('drawer'),
  drawerClose: $('drawer-close'),
  playlist: $('playlist'),
  btnAdd: $('btn-add'),
  scrim: $('scrim'),
  curtain: $('curtain'),
  enter: $('enter'),
  drop: $('drop'),
  toast: $('toast'),
  fileInput: $('file-input'),
  presets: $('presets'),
  veil: document.querySelector('.stage__veil'),
  shelf: $('shelf'),
  shelfRail: $('shelf-rail'),
  shelfIndex: $('shelf-index'),
  shelfTitle: $('shelf-title'),
  shelfArtist: $('shelf-artist'),
  shelfClose: $('shelf-close'),
  btnShelf: $('btn-shelf'),
  wheel: $('wheel'),
  wheelStage: $('wheel-stage'),
  wheelItems: $('wheel-items'),
  wheelCard: $('wheel-card'),
  wheelStack: $('wheel-stack'),
  wheelIdx: $('wheel-idx'),
  wheelName: $('wheel-name'),
  wheelSub: $('wheel-sub'),
  wheelClose: $('wheel-close'),
  btnWheel: $('btn-wheel'),
  gallery: $('gallery'),
  galleryStage: $('gallery-stage'),
  galleryRing: $('gallery-ring'),
  galleryIdx: $('gallery-idx'),
  galleryName: $('gallery-name'),
  gallerySub: $('gallery-sub'),
  galleryClose: $('gallery-close'),
  galleryPrev: $('gallery-prev'),
  galleryNext: $('gallery-next'),
  btnGallery: $('btn-gallery')
};

const engine = new AudioEngine(el.audio);

const startPreset = resolveStartPreset();
const stage = new Stage(el.stage, {
  params: startPreset.stage,
  scale: pickDensityScale()
});

/* the halftone heart takes the stage: the dust field steps aside so the
   homepage has one dot system, not two */
const heart = new Heart(el.heart, { enabled: params.get('heart') !== '0' });
const heartLive = heart.enabled && heart.ok;
if (heartLive) stage.setDust(false);
document.body.classList.toggle('is-dust', !heartLive);

/* the paper's halftone screen, printed by the pointer */
const paperDots = new PaperDots($('paper-dots'));
if (params.get('dots') === '0') {
  paperDots.enabled = false;
  $('paper-dots').hidden = true;
}

const wheel = new Wheel({
  root: el.wheel,
  itemsEl: el.wheelItems,
  card: el.wheelCard,
  stack: el.wheelStack,
  idx: document.querySelector('#drum-no span'),
  name: document.querySelector('#drum-title span'),
  sub: document.querySelector('#drum-sub span'),
  drums: {
    no: $('drum-no'),
    title: $('drum-title'),
    sub: $('drum-sub')
  },
  canvas: $('wheel-spectrum'),
  onPick: (i) => selectTrack(i, { autoplay: !el.audio.paused || state.playing }),
  onSeek: (i) => {
    const line = state.lyrics?.lines?.[i];
    if (line) seekTo(line.t);
    wheel.hold = 0;
  }
});

const gallery = new Gallery({
  root: el.gallery,
  stage: el.galleryStage,
  ring: el.galleryRing,
  idx: el.galleryIdx,
  name: el.galleryName,
  sub: el.gallerySub,
  onPick: (i) => {
    toast('正在载入歌曲…');
    selectTrack(i, { autoplay: true });
    closeGallery();
  }
});

const shelf = new Shelf({
  root: el.shelf,
  rail: el.shelfRail,
  indexEl: el.shelfIndex,
  titleEl: el.shelfTitle,
  artistEl: el.shelfArtist,
  onPick: (i, origin) => {
    const item = shelf.tracks[i];
    if (item && item.playlistId) {
      loadNeteasePlaylist(item.playlistId, item.title, origin);
      return;
    }
    selectTrack(i, { autoplay: true });
    closeShelf();
  }
});

const ink = new InkVeil();

/* ------------------------------------------------------------------ boot */

function resolveStartPreset() {
  let id = '';
  try { id = localStorage.getItem(PRESET_KEY) || ''; } catch (err) { /* private mode */ }
  const fromUrl = params.get('preset');
  return presetById(fromUrl) || presetById(id) || PRESETS[0];
}

/** Density is a device question, not a taste question. */
function pickDensityScale() {
  const q = (params.get('quality') || '').toLowerCase();
  if (q === 'low') return 0.32;
  if (q === 'high') return 1;

  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const cores = navigator.hardwareConcurrency || 4;
  if (small) return 0.45;
  if (cores <= 4) return 0.68;
  return 1;
}

function boot() {
  stage.init();
  bindEvents();
  initLogin();
  initNetease({ onPick: playNetease });
  initCursor();
  initPWA();
  updateClock();
  setInterval(updateClock, 20000);

  el.vol.value = String(engine.volume);
  el.vol.style.setProperty('--v', `${engine.volume * 100}%`);

  loadDemo();
  renderPlaylist();
  buildPresetUI();
  state.preset = startPreset.id;
  applyPresetStyle(startPreset);
  document.body.classList.add('is-ready');
  requestAnimationFrame(loop);
  scheduleIdle();
}

/* Three test rooms; the rest of the demo set stays on disk. */
const DEMO_TRACKS = [
  { id: 'demo-1', title: '夜航', note: '72 BPM · A minor 9', file: 'demo-1', lrc: 'assets/demo.lrc' },
  { id: 'demo-2', title: '深海', note: '60 BPM · D minor 9', file: 'demo-2' },
  { id: 'demo-3', title: '潮汐', note: '66 BPM · C major 9', file: 'demo-5' }
];

function loadDemo() {
  state.queue = DEMO_TRACKS.map((d) => ({
    id: d.id,
    title: d.title,
    artist: 'NOCTURNE',
    album: d.note,
    src: `assets/${d.file}.mp3`,
    lrcUrl: d.lrc || '',
    duration: 0,
    origin: 'demo'
  }));

  state.index = 0;
  setLibraryLabel('本地队列', 'local');
  selectTrack(0, { autoplay: false, silent: true });
  hydrateDemoArt();

  // fill in the list durations in the background
  for (const track of state.queue.slice(1)) probeDuration(track);
}

/* The demos carry their artwork in their own ID3 tag. Read the tag off the
   front of each file only — the audio stays where it is, and a missing picture
   simply leaves the card typographic. */
const artAttempted = new Set();

async function loadDemoArt(track) {
  if (!track || track.origin !== 'demo' || track.coverUrl || artAttempted.has(track.src)) return;
  artAttempted.add(track.src);

  try {
    const res = await fetch(track.src, { headers: { Range: 'bytes=0-1048575' } });
    if (!res.ok) return;
    let head = new Uint8Array(await res.arrayBuffer());

    // a tag bigger than the range: ask for the whole thing once
    if (head.length >= 10 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
      if (head.length < 10 + size) {
        const full = await fetch(track.src);
        if (!full.ok) return;
        head = new Uint8Array(await full.arrayBuffer());
      }
    }

    const tags = readId3(head);
    if (!tags?.picture) return;

    track.coverUrl = URL.createObjectURL(new Blob([tags.picture.data], { type: tags.picture.mime }));
    if (wheel.isOpen && currentTrack() === track) wheel.paintArt(track);
  } catch (err) {
    /* no art is a normal state, not a failure */
  }
}

function hydrateDemoArt() {
  for (const track of state.queue) loadDemoArt(track);
}

/* ------------------------------------------------------------- transport */

function currentTrack() {
  return state.queue[state.index] || null;
}

function playNetease(song, data) {
  const track = {
    id: `netease-${song.id}`,
    title: song.name,
    artist: song.artist || '网易云音乐',
    album: song.album || '',
    src: `/api/netease/audio?url=${encodeURIComponent(data.url)}`,
    coverUrl: String(song.cover || '').replace(/^http:\/\//i, 'https://'),
    duration: Number(song.duration) || 0,
    origin: 'netease',
    lrcText: data.lyric || ''
  };
  track.trial = !!data.trial;

  let index = state.queue.findIndex((item) => item.id === track.id);
  if (index < 0) {
    state.queue.push(track);
    index = state.queue.length - 1;
  } else {
    state.queue[index] = track;
  }

  refreshLibraryCount();
  selectTrack(index, { autoplay: true });
  closeDrawer();
  toast(data.trial ? '正在播放试听片段' : '正在播放网易云');
}

function neteaseQueueTrack(song) {
  const duration = Number(song.duration) || 0;
  return {
    id: `netease-${song.id}`,
    title: song.name,
    artist: song.artist || '网易云音乐',
    album: song.album || '',
    coverUrl: String(song.cover || '').replace(/^http:\/\//i, 'https://'),
    duration: duration > 1000 ? Math.round(duration / 1000) : Math.round(duration),
    origin: 'netease'
  };
}

async function loadNeteaseList(songs, label, source, opts = {}) {
  if (!songs || !songs.length) {
    toast('没有拿到歌曲');
    return;
  }
  state.queue = songs.map(neteaseQueueTrack);
  state.index = 0;
  setLibraryLabel(`${label} · ${state.queue.length} 首`, source);
  renderPlaylist();
  await selectTrack(0, { autoplay: false });
  if (opts.openDrawer !== false) openDrawer();
}

async function loadNeteasePlaylist(id, name, origin) {
  const controller = new AbortController();
  const label = name || '歌单';
  ink.begin(origin, () => controller.abort());
  ink.setStatus(`正在载入「${label}」`);
  let slowTimer = 0;
  try {
    ink.setProgress(0.15);
    const res = await fetch(`/api/netease/playlist?id=${encodeURIComponent(id)}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    ink.setProgress(0.55);
    slowTimer = setTimeout(() => ink.slow(), 7000);
    const data = await res.json();
    ink.setProgress(0.86);
    if (!res.ok) throw new Error(data.error || '歌单读取失败');
    if (!data.songs?.length) throw new Error('这个歌单没有可播放的歌曲');

    closeShelf();
    document.body.classList.add('is-ink-revealing');
    await loadNeteaseList(data.songs, label || data.playlist?.name || '歌单', 'playlist', { openDrawer: false });
    ink.setProgress(0.97);
    await ink.complete();
    document.body.classList.remove('is-ink-revealing');
    await ink.reveal();
    ink.setStatus(`已载入 ${state.queue.length} 首`);
  } catch (err) {
    if (controller.signal.aborted) return;
    document.body.classList.remove('is-ink-revealing');
    await ink.fail();
    toast(err.message || '歌单读取失败');
  } finally {
    clearTimeout(slowTimer);
  }
}

async function ensureNeteaseLogin() {
  try {
    const res = await fetch('/api/netease/me', { cache: 'no-store' });
    const data = await res.json();
    if (data.loggedIn) return true;
  } catch {
    /* fall through to the login prompt */
  }
  toast('网易云登录已过期，请重新登录');
  el.loginBtn?.click();
  return false;
}

async function openDaily() {
  if (!(await ensureNeteaseLogin())) return;
  try {
    const res = await fetch('/api/netease/daily', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '每日推荐读取失败');
    await loadNeteaseList(data.songs || [], '每日推荐', 'daily');
  } catch (err) {
    toast(err.message || '每日推荐读取失败');
    if (/登录/.test(err.message || '')) el.loginBtn?.click();
  }
}

async function resolveNeteaseTrack(track) {
  if (!track || track.origin !== 'netease' || track.src) return true;
  try {
    const res = await fetch(`/api/netease/song?id=${encodeURIComponent(track.id.replace(/^netease-/, ''))}`, {
      cache: 'no-store'
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || '这首歌暂时没有播放地址');
      return false;
    }
    track.src = `/api/netease/audio?url=${encodeURIComponent(data.url)}`;
    track.lrcText = data.lyric || '';
    track.trial = !!data.trial;
    return true;
  } catch {
    toast('获取播放地址失败');
    return false;
  }
}

async function selectTrack(index, opts = {}) {
  if (!state.queue.length) return;
  const i = Math.max(0, Math.min(state.queue.length - 1, index));
  const track = state.queue[i];
  if (!track) return;
  if (!(await resolveNeteaseTrack(track))) return;

  state.index = i;
  state.lyricIndex = -1;
  state.lyrics = null;
  if (state.entered) heart.kick(0.5);
  el.lyricPrev.textContent = '';
  el.lyricCur.textContent = '';
  el.lyricNext.textContent = '';

  const audio = el.audio;
  audio.pause();
  audio.src = track.src;
  audio.load();

  audio.loop = state.queue.length === 1;
  paintTrack(track);
  paintLyricsShell(track);
  syncPlaylistActive();

  if (track.lrcText === undefined) {
    await loadLyrics(track);
  } else {
    applyLyrics(track);
  }

  if (opts.autoplay) {
    await play();
  }
}

async function loadLyrics(track) {
  track.lrcText = '';
  let text = '';
  try {
    if (track.lrcUrl) {
      const res = await fetch(track.lrcUrl, { cache: 'no-cache' });
      if (res.ok) text = await res.text();
    } else if (track.lrcFile) {
      text = await track.lrcFile.text();
    }
  } catch (err) {
    console.warn('[nocturne] lrc:', err);
  }
  track.lrcText = text;
  if (currentTrack() === track) applyLyrics(track);
}

function applyLyrics(track) {
  let parsed = track.lrcText ? parseLRC(track.lrcText) : null;
  let estimated = false;

  // no timestamps? spread the lines across the track instead of showing nothing
  if (!parsed && track.lrcText) {
    const plain = parsePlainLyrics(track.lrcText);
    if (plain) {
      parsed = { lines: distribute(plain, effectiveDuration()), meta: {}, estimated: true };
      estimated = true;
    }
  }

  track.lrcParsed = parsed;
  track.lyricsEstimated = estimated;

  // a tagless rip is named "obj_wo3Dl..." — if the lyric file knows the
  // title, believe it over the filename
  const meta = parsed?.meta || {};
  if (track.titleFromFile && meta.ti) {
    track.title = meta.ti;
    if (meta.ar) track.artist = meta.ar.split('/')[0].trim();
    track.titleFromFile = false;
    paintTrack(track);
    renderPlaylist();
  }
  if (currentTrack() !== track) return;
  state.lyrics = parsed;
  state.lyricIndex = -1;
  paintLyricsShell(track);

  if (wheel.isOpen) {
    wheel.setLines(parsed?.lines || [], 0, track, trackMeta());
  }
}

async function play() {
  if (!state.queue.length) return;
  try {
    await engine.unlock();
  } catch (err) {
    console.warn('[nocturne] unlock:', err);
  }
  const audio = el.audio;
  try {
    await audio.play();
  } catch (err) {
    console.warn('[nocturne] play:', err);
    toast('浏览器拦住了播放，再点一次');
  }
}

function pause() {
  el.audio.pause();
}

function toggle() {
  if (!state.entered) {
    enter();
    return;
  }
  if (el.audio.paused) play();
  else pause();
}

function next(direction = 1) {
  if (state.queue.length < 2) {
    seekTo(0);
    return;
  }
  const i = (state.index + direction + state.queue.length) % state.queue.length;
  selectTrack(i, { autoplay: !el.audio.paused || state.playing });
}

function seekTo(seconds) {
  const audio = el.audio;
  const dur = effectiveDuration();
  const t = Math.max(0, Math.min(dur || 0, seconds));
  if (!Number.isFinite(t)) return;
  if (STILL) {
    state.mockTime = t;
    state.virtualTime = 0;
    return;
  }
  if (Number.isFinite(audio.duration)) audio.currentTime = t;
}

function effectiveDuration() {
  if (STILL) return currentTrack()?.duration || 208;
  return engine.duration || currentTrack()?.duration || 0;
}

function currentTime() {
  if (STILL) return state.mockTime + state.virtualTime;
  return engine.currentTime;
}

/* ------------------------------------------------------------------- ui */

function paintTrack(track) {
  const n = String(state.index + 1).padStart(2, '0');
  el.trackIndex.textContent = n;
  el.trackTitle.textContent = track.title;
  el.trackArtist.textContent = (track.artist || '未知艺术家').toUpperCase();
  el.quietTitle.textContent = track.title;
  el.quietArtist.textContent = (track.artist || '未知艺术家').toUpperCase();
  document.title = `${track.title} · ${track.artist || ''} — Nocturne`;

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist || '',
        album: 'Nocturne'
      });
    } catch (err) { /* ignore */ }
  }
}

function paintLyricsShell(track) {
  const has = !!(state.lyrics && state.lyrics.lines.length);
  const visible = has && state.showLyrics;
  el.lyrics.hidden = !visible;
  el.quiet.hidden = visible;
  if (visible) {
    el.quietNote.textContent = '';
  } else {
    el.quietNote.textContent = state.lyrics ? '歌词已隐藏' : '无歌词 · 纯音乐';
  }
  if (track) {
    el.quietTitle.textContent = track.title;
    el.quietArtist.textContent = (track.artist || '未知艺术家').toUpperCase();
  }
}

function paintLyricFrame(time) {
  const lines = state.lyrics?.lines;
  if (!lines || !lines.length || !state.showLyrics) return;

  const idx = indexAt(lines, time);
  const shown = idx < 0 ? 0 : idx;
  if (shown !== state.lyricIndex) {
    state.lyricIndex = shown;
    const cur = lines[shown];
    el.lyricPrev.textContent = shown > 0 ? lines[shown - 1].text : '';
    el.lyricCur.textContent = cur ? cur.text : '';
    el.lyricNext.textContent = lines[shown + 1] ? lines[shown + 1].text : '';

    if (cur) {
      el.lyricCur.animate(
        [
          { opacity: 0, transform: 'translateY(16px)', filter: 'blur(8px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0px)' }
        ],
        { duration: 880, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }
  }

  const p = idx < 0 ? 0 : lineProgress(lines, idx, time);
  if (p > 0.001 && p < 0.999) {
    el.lyricCur.classList.add('is-filling');
    el.lyricCur.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
  } else {
    el.lyricCur.classList.remove('is-filling');
    el.lyricCur.style.setProperty('--p', '0%');
  }
}

function paintProgress(time, dur) {
  const p = dur > 0 ? Math.min(1, Math.max(0, time / dur)) : 0;
  el.fill.style.width = `${(p * 100).toFixed(3)}%`;
  el.tCur.textContent = formatTime(time);
  el.tDur.textContent = formatTime(dur);
  el.progress.setAttribute('aria-valuenow', String(Math.round(p * 100)));
}

function updateClock() {
  const d = new Date();
  el.clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('is-on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove('is-on'), 2600);
}

/* -------------------------------------------------------------- presets */

function buildPresetUI() {
  if (!el.presets) return;
  el.presets.innerHTML = '';

  PRESETS.forEach((preset, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'presets__slot';
    btn.dataset.id = preset.id;
    btn.textContent = String(i + 1).padStart(2, '0');
    btn.title = `${preset.name} · ${preset.note}   (${i + 1})`;
    btn.setAttribute('aria-label', `视觉预设 ${preset.name}`);
    btn.setAttribute('aria-pressed', String(preset.id === startPreset.id));
    btn.addEventListener('click', () => usePreset(preset.id));
    el.presets.appendChild(btn);
  });
}

function paintPresetUI(id) {
  if (!el.presets) return;
  for (const btn of el.presets.children) {
    btn.setAttribute('aria-pressed', String(btn.dataset.id === id));
  }
}

/** The parts of a preset that live in CSS rather than in WebGL. */
function applyPresetStyle(preset) {
  const css = preset.css;
  const root = document.documentElement.style;
  root.setProperty('--paper', css.paper);
  root.setProperty('--paper-dim', css.paperDim);
  root.setProperty('--accent', css.accent);
  paperDots.setColor(css.accent);
  root.setProperty('--lyric-scale', String(css.lyricScale));
  root.setProperty('--lyric-track', String(css.lyricTrack));
  root.setProperty('--lyric-glow', String(css.lyricGlow));
  if (el.veil) el.veil.style.opacity = String(css.veil * 0.42);
  paintPresetUI(preset.id);
}

function usePreset(id, opts = {}) {
  const preset = presetById(id);
  if (!preset) return;
  if (state.preset === preset.id && !opts.force) return;

  state.preset = preset.id;
  stage.setPreset(preset.stage, opts.duration ?? 0.6);
  applyPresetStyle(preset);

  try { localStorage.setItem(PRESET_KEY, preset.id); } catch (err) { /* ignore */ }
  if (!opts.silent) toast(`预设 · ${preset.name}`);
}

/* ------------------------------------------------------------- playlist */

function setLibraryLabel(label, source = null) {
  state.libraryLabel = label || '本地队列';
  if (source) state.librarySource = source;
  if (el.libraryDivider) el.libraryDivider.textContent = state.libraryLabel;
}

function refreshLibraryCount() {
  if (state.librarySource !== 'playlist' && state.librarySource !== 'daily') return;
  const base = state.libraryLabel.split(' · ')[0];
  setLibraryLabel(`${base} · ${state.queue.length} 首`);
}

function syncPlaylistActive() {
  const rows = el.playlist.children;
  if (rows.length !== state.queue.length) {
    renderPlaylist();
    return;
  }
  for (let i = 0; i < rows.length; i++) {
    rows[i].classList.toggle('is-active', i === state.index);
  }
}

function renderPlaylist() {
  el.listCount.textContent = String(state.queue.length);
  el.playlist.innerHTML = '';

  state.queue.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'track' + (i === state.index ? ' is-active' : '');
    li.dataset.index = String(i);
    li.innerHTML = `
      <div class="track__no"><span>${String(i + 1).padStart(2, '0')}</span></div>
      <div class="track__main">
        <div class="track__title"></div>
        <div class="track__artist"></div>
      </div>
      <div class="track__dur">${track.duration ? formatTime(track.duration) : '--:--'}</div>`;
    li.querySelector('.track__title').textContent = track.title;
    li.querySelector('.track__artist').textContent = (track.artist || '未知艺术家').toUpperCase();
    const del = document.createElement('button');
    del.className = 'track__del';
    del.type = 'button';
    del.setAttribute('aria-label', `从队列移除 ${track.title}`);
    del.textContent = '×';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      removeTrack(i);
    });
    li.appendChild(del);
    li.addEventListener('click', () => {
      selectTrack(i, { autoplay: true });
      closeDrawer();
    });
    el.playlist.appendChild(li);
  });
}

function removeTrack(index) {
  const track = state.queue[index];
  if (!track) return;
  if (state.queue.length <= 1) {
    toast('队列里至少留一首歌');
    return;
  }

  const wasCurrent = index === state.index;
  state.queue.splice(index, 1);
  if (index < state.index) state.index -= 1;

  if (wasCurrent) {
    state.index = Math.min(index, state.queue.length - 1);
    selectTrack(state.index, { autoplay: !el.audio.paused || state.playing });
  } else {
    renderPlaylist();
  }
  refreshLibraryCount();
  toast(`已移除「${track.title}」`);
}

function refreshDurations() {
  const rows = el.playlist.querySelectorAll('.track');
  rows.forEach((row) => {
    const track = state.queue[Number(row.dataset.index)];
    if (!track) return;
    const cell = row.querySelector('.track__dur');
    if (cell && track.duration) cell.textContent = formatTime(track.duration);
  });
}

function openDrawer() {
  if (wheel.isOpen) closeWheel();
  if (shelf.isOpen) closeShelf();
  if (gallery.isOpen) closeGallery();
  el.drawer.classList.add('is-open');
  el.drawer.setAttribute('aria-hidden', 'false');
  el.btnPlaylist.setAttribute('aria-expanded', 'true');
  el.scrim.hidden = false;
  requestAnimationFrame(() => el.scrim.classList.add('is-on'));
  syncNav();
  window.dispatchEvent(new CustomEvent('nocturne:drawer-open'));
  const active = el.playlist.querySelector('.is-active');
  if (active) active.scrollIntoView({ block: 'center' });
}

function closeDrawer() {
  el.drawer.classList.remove('is-open');
  el.drawer.setAttribute('aria-hidden', 'true');
  el.btnPlaylist.setAttribute('aria-expanded', 'false');
  el.scrim.classList.remove('is-on');
  setTimeout(() => { el.scrim.hidden = true; }, 500);
  syncNav();
}

/* --------------------------------------------------------------- shelf */

async function openShelf() {
  if (el.drawer.classList.contains('is-open')) closeDrawer();
  if (wheel.isOpen) closeWheel();
  if (gallery.isOpen) closeGallery();
  if (!(await ensureNeteaseLogin())) return;

  shelf.setLoading('正在读取你的歌单…');
  shelf.open(0);
  document.body.classList.add('is-shelf');
  wake();
  syncPaperLayer();
  syncNav();

  try {
    const res = await fetch('/api/netease/playlists', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '歌单读取失败');
    const playlists = (data.playlists || []).map((item) => ({
      title: item.name,
      artist: `${item.trackCount || 0} 首${item.creator ? ` · ${item.creator}` : ''}`,
      coverUrl: item.cover
        ? `${item.cover}${item.cover.includes('?') ? '&' : '?'}param=420y420`
        : '',
      playlistId: item.id
    }));
    if (!playlists.length) throw new Error('账号里还没有歌单');
    shelf.setQueue(playlists, 0, -1);
    shelf.open(0);
  } catch (err) {
    closeShelf();
    toast(err.message || '歌单读取失败');
    if (/登录/.test(err.message || '')) el.loginBtn?.click();
  }
}

function closeShelf() {
  if (!shelf.isOpen) return;
  shelf.close();
  document.body.classList.remove('is-shelf');
  syncPaperLayer();
  syncNav();
}

/* ---------------------------------------------------------------- wheel */

function openWheel() {
  const track = currentTrack();
  if (!track) return;
  if (el.drawer.classList.contains('is-open')) closeDrawer();
  if (shelf.isOpen) closeShelf();
  if (gallery.isOpen) closeGallery();

  const lines = state.lyrics?.lines || [];
  const index = Math.max(0, state.lyricIndex);
  wheel.setLines(lines, index, track, trackMeta());
  wheel.open(index);
  document.body.classList.add('is-wheel');
  wake();
  syncPaperLayer();
  syncNav();
}

/* -------------------------------------------------------------- gallery */

function openGallery() {
  if (!state.queue.length) return;
  if (el.drawer.classList.contains('is-open')) closeDrawer();
  if (shelf.isOpen) closeShelf();
  if (wheel.isOpen) closeWheel();
  gallery.setQueue(state.queue, state.index, state.index);
  gallery.open(state.index);
  document.body.classList.add('is-gallery');
  wake();
  syncPaperLayer();
  syncNav();
}

function closeGallery() {
  if (!gallery.isOpen) return;
  gallery.close();
  document.body.classList.remove('is-gallery');
  syncPaperLayer();
  syncNav();
}

/** neighbours, so the card can say what is above and below it */
function trackMeta() {
  return {
    queue: state.queue,
    queueIndex: state.index,
    trackIndex: state.index,
    total: state.queue.length
  };
}

function closeWheel() {
  if (!wheel.isOpen) return;
  wheel.close();
  document.body.classList.remove('is-wheel');
  syncPaperLayer();
  syncNav();
}

/* the wake is a layer of the topmost view's paper: move the canvas into
   that view so it stays under cards, lyrics and chrome, never above them */
function syncPaperLayer() {
  if (!state.entered) {
    paperDots.hole = null;
    paperDots.attachTo(el.curtain);
    return;
  }
  const target = wheel.isOpen ? el.wheel
    : gallery.isOpen ? el.gallery
    : shelf.isOpen ? el.shelf
    : el.stageRoot;
  if (target === el.stageRoot) {
    paperDots.attachTo(target, el.heart);
    paperDots.hole = () => heart.silhouette();
  } else {
    paperDots.hole = null;
    paperDots.attachTo(target);
  }
}

/** the top pill mirrors whatever is open; daily keeps its source label */
function syncNav() {
  if (!el.nav) return;
  const open = el.drawer.classList.contains('is-open')
    ? (state.librarySource === 'daily' ? 'daily' : 'library')
    : wheel.isOpen ? 'wheel'
    : gallery.isOpen ? 'gallery'
    : shelf.isOpen ? 'shelf'
    : null;

  for (const b of el.nav.querySelectorAll('.nav__item')) {
    const name = b.dataset.nav;
    const on = name === open ||
      (!open && name === 'daily' && state.librarySource === 'daily');
    b.classList.toggle('is-on', on);
  }
}

/* ------------------------------------------------------------ file drops */

async function intakeFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const audioFiles = [];
  const lrcByName = new Map();
  const imageByName = new Map();

  for (const file of files) {
    if (LRC_RE.test(file.name)) {
      lrcByName.set(stripExt(file.name).toLowerCase(), file);
    } else if (IMAGE_RE.test(file.name) || (file.type && file.type.startsWith('image/'))) {
      imageByName.set(stripExt(file.name).toLowerCase(), file);
    } else if (AUDIO_RE.test(file.name) || (file.type && file.type.startsWith('audio/'))) {
      audioFiles.push(file);
    }
  }

  if (!audioFiles.length) {
    if (imageByName.size) {
      const track = currentTrack();
      const pick = imageByName.get('cover') || imageByName.get('folder') || imageByName.values().next().value;
      if (track && pick) {
        setCover(track, pick);
        toast('封面已更新');
      } else {
        toast('先放一首歌，再拖图片');
      }
      if (!lrcByName.size) return;
    }
    if (lrcByName.size) {
      const track = currentTrack();
      if (track) {
        const hit = lrcByName.get(stripExt(track.title).toLowerCase()) || lrcByName.values().next().value;
        track.lrcFile = hit;
        track.lrcText = undefined;
        track.lrcUrl = '';
        await loadLyrics(track);
        toast('歌词已载入');
      } else {
        toast('请先加一首歌，再放歌词');
      }
    } else {
      toast('没有可识别的音频文件');
    }
    return;
  }

  const added = [];
  for (const file of audioFiles) {
    const tags = await readTags(file);
    const track = {
      id: `local-${Date.now()}-${added.length}`,
      title: tags.title,
      artist: tags.artist,
      album: tags.album || '',
      trackNo: tags.track || 0,
      titleFromFile: tags.fromFile !== false,
      coverUrl: tags.picture
        ? URL.createObjectURL(new Blob([tags.picture.data], { type: tags.picture.mime }))
        : '',
      src: URL.createObjectURL(file),
      lrcUrl: '',
      lrcFile: lrcByName.get(stripExt(file.name).toLowerCase()) || null,
      duration: 0,
      origin: 'local'
    };
    if (track.lrcFile) track.lrcText = undefined;

    const pic = imageByName.get(stripExt(file.name).toLowerCase())
      || imageByName.get('cover')
      || imageByName.get('folder');
    if (pic) track.coverUrl = URL.createObjectURL(pic);

    added.push(track);
    probeDuration(track);
  }

  // a ripped album carries track numbers; honour them, otherwise keep
  // whatever order the folder was dropped in
  if (added.some((t) => t.trackNo)) {
    added.sort((a, b) => (a.trackNo || 999) - (b.trackNo || 999));
  }

  const replaceDemo = state.queue.every((t) => t.origin === 'demo');
  if (replaceDemo) {
    for (const t of state.queue) {
      URL.revokeObjectURL(t.src);
      if (t.coverUrl) URL.revokeObjectURL(t.coverUrl);
    }
    state.queue = added;
    state.index = 0;
  } else {
    state.queue.push(...added);
  }

  renderPlaylist();
  toast(added.length > 1 ? `${added.length} 首已加入队列` : `已加入 · ${added[0].title}`);

  if (replaceDemo) {
    await selectTrack(0, { autoplay: true });
  }
}

/** Put a picture on a track (and on anything already showing it). */
function setCover(track, file) {
  if (track.coverUrl && track.coverUrl.startsWith('blob:')) URL.revokeObjectURL(track.coverUrl);
  track.coverUrl = URL.createObjectURL(file);
  if (wheel.isOpen) {
    wheel.setLines(state.lyrics?.lines || [], Math.max(0, state.lyricIndex), track, trackMeta());
  }
}

function probeDuration(track) {
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(probe.duration)) {
      track.duration = probe.duration;
      if (currentTrack() === track) paintProgress(currentTime(), effectiveDuration());
      refreshDurations();
    }
    probe.src = '';
  }, { once: true });
  probe.addEventListener('error', () => { probe.src = ''; }, { once: true });
  probe.src = track.src;
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

/** Walk a dropped directory, collecting files. */
async function readEntry(entry, out) {
  if (!entry) return;
  if (entry.isFile) {
    const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
    if (file) out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
      for (const child of batch) await readEntry(child, out);
    } while (batch.length);
  }
}

/* ---------------------------------------------------------------- events */

/* the original pause bars: they shift and lean toward the pointer */
function initPlayKey() {
  const btn = el.btnPlay;
  if (!btn.querySelector('.pkey--pause')) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let raf = 0;
  window.addEventListener('pointermove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy) || 1;
      const amt = Math.min(1, len / 90);
      btn.style.setProperty('--ex', `${((dx / len) * amt * 3.2).toFixed(2)}px`);
      btn.style.setProperty('--ey', `${((dy / len) * amt * 2.2).toFixed(2)}px`);
      btn.style.setProperty('--lean', `${(Math.max(-1, Math.min(1, dx / 70)) * 9).toFixed(2)}deg`);
    });
  }, { passive: true });

  const rest = () => {
    btn.style.setProperty('--ex', '0px');
    btn.style.setProperty('--ey', '0px');
    btn.style.setProperty('--lean', '0deg');
  };
  document.documentElement.addEventListener('pointerleave', rest, { passive: true });
  window.addEventListener('blur', rest);
}

function bindEvents() {
  el.btnPlay.addEventListener('click', toggle);
  el.btnPrev.addEventListener('click', () => next(-1));
  el.btnNext.addEventListener('click', () => next(1));
  initPlayKey();

  el.audio.addEventListener('play', () => {
    state.playing = true;
    document.body.classList.add('is-playing');
    document.body.classList.remove('is-loading');
    el.btnPlay.setAttribute('aria-label', '暂停');
    scheduleIdle();
  });
  el.audio.addEventListener('pause', () => {
    state.playing = false;
    document.body.classList.remove('is-playing');
    document.body.classList.remove('is-idle');
    document.body.classList.remove('is-loading');
    el.btnPlay.setAttribute('aria-label', '播放');
  });
  el.audio.addEventListener('waiting', () => document.body.classList.add('is-loading'));
  el.audio.addEventListener('canplay', () => document.body.classList.remove('is-loading'));
  el.audio.addEventListener('playing', () => document.body.classList.remove('is-loading'));
  el.audio.addEventListener('loadedmetadata', () => {
    const track = currentTrack();
    if (track && Number.isFinite(el.audio.duration)) {
      track.duration = el.audio.duration;
      // an estimated timeline is only as good as the duration it was built on
      if (track.lyricsEstimated) applyLyrics(track);
      refreshDurations();
    }
  });
  el.audio.addEventListener('ended', () => {
    if (state.queue.length > 1) next(1);
  });
  el.audio.addEventListener('progress', () => {
    const b = el.audio.buffered;
    const d = effectiveDuration();
    if (b.length && d > 0) {
      el.buffer.style.width = `${Math.min(100, (b.end(b.length - 1) / d) * 100)}%`;
    }
  });

  // progress scrubbing
  let scrubbing = false;
  const ratioFromEvent = (e) => {
    const rect = el.progress.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };
  const beginScrub = (e) => {
    scrubbing = true;
    el.progress.classList.add('is-scrubbing');
    el.progress.setPointerCapture?.(e.pointerId);
    updateScrub(e);
  };
  const updateScrub = (e) => {
    const r = ratioFromEvent(e);
    const dur = effectiveDuration();
    el.fill.style.width = `${r * 100}%`;
    el.tCur.textContent = formatTime(r * dur);
  };
  const endScrub = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    el.progress.classList.remove('is-scrubbing');
    seekTo(ratioFromEvent(e) * effectiveDuration());
  };
  el.progress.addEventListener('pointerdown', beginScrub);
  el.progress.addEventListener('pointermove', (e) => { if (scrubbing) updateScrub(e); });
  el.progress.addEventListener('pointerup', endScrub);
  el.progress.addEventListener('pointercancel', endScrub);
  el.progress.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { seekTo(currentTime() + 5); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { seekTo(currentTime() - 5); e.preventDefault(); }
  });

  // volume
  el.vol.addEventListener('input', () => {
    const v = Number(el.vol.value);
    engine.setVolume(v);
    engine.setMuted(false);
    el.btnMute.classList.toggle('is-muted', false);
    el.vol.style.setProperty('--v', `${v * 100}%`);
  });
  el.btnMute.addEventListener('click', () => {
    const muted = !engine.muted;
    engine.setMuted(muted);
    el.btnMute.classList.toggle('is-muted', muted);
  });

  // lyrics toggle
  el.btnLyrics.addEventListener('click', () => {
    state.showLyrics = !state.showLyrics;
    el.btnLyrics.setAttribute('aria-pressed', String(state.showLyrics));
    state.lyricIndex = -1;
    paintLyricsShell(currentTrack());
    syncNav();
  });

  // the top pill: five views, same functions as the old hidden buttons
  el.nav?.addEventListener('click', (e) => {
    const b = e.target.closest('.nav__item');
    if (!b) return;
    switch (b.dataset.nav) {
      case 'library': el.btnPlaylist.click(); break;
      case 'wheel': openWheel(); break;
      case 'shelf': openShelf(); break;
      case 'gallery': openGallery(); break;
      case 'daily': openDaily(); break;
    }
  });

  // drawer
  el.btnDailyMobile?.addEventListener('click', openDaily);
  el.btnPlaylist.addEventListener('click', () => {
    if (el.drawer.classList.contains('is-open')) closeDrawer();
    else openDrawer();
  });
  el.drawerClose.addEventListener('click', closeDrawer);
  el.scrim.addEventListener('click', closeDrawer);
  el.btnAdd.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', async () => {
    await intakeFiles(el.fileInput.files);
    el.fileInput.value = '';
  });

  // gallery
  el.galleryClose.addEventListener('click', closeGallery);
  el.galleryPrev.addEventListener('click', () => gallery.step(-1));
  el.galleryNext.addEventListener('click', () => gallery.step(1));
  el.gallery.addEventListener('click', (e) => {
    if (gallery._clickGuard) return;
    if (e.target === el.gallery || e.target === el.galleryStage || e.target === el.galleryRing) closeGallery();
  });

  // wheel
  el.wheelClose.addEventListener('click', closeWheel);
  // the wheel is left only by the back pill or Esc — a stray click must not eject you

  // shelf
  el.shelfClose.addEventListener('click', closeShelf);
  el.stage.addEventListener('contextmenu', (e) => {
    if (!state.entered) return;
    e.preventDefault();
    openShelf();
  });
  el.shelf.addEventListener('click', (e) => {
    if (e.target === el.shelf || e.target.id === 'shelf-stage') closeShelf();
  });

  // fullscreen
  el.btnFull.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (err) { /* ignore */ }
  });

  // curtain
  el.enter.addEventListener('click', (e) => { e.stopPropagation(); enter(); });
  el.curtain.addEventListener('click', enter);

  // pointer parallax + idle
  window.addEventListener('pointermove', (e) => {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    stage.look(nx, ny);
    wake();
  }, { passive: true });

  // drag & drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth += 1;
    document.body.classList.add('is-file-dragging');
    el.drop.classList.add('is-on');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      document.body.classList.remove('is-file-dragging');
      el.drop.classList.remove('is-on');
    }
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.drop.classList.remove('is-on');
    document.body.classList.remove('is-file-dragging');

    const items = e.dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const out = [];
      const entries = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length) {
        for (const entry of entries) await readEntry(entry, out);
        await intakeFiles(out);
        return;
      }
    }
    await intakeFiles(e.dataTransfer.files);
  });

  // keyboard
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;

    // the gallery owns the keyboard while it is up
    if (gallery.isOpen) {
      if (e.key === 'Escape') { e.preventDefault(); closeGallery(); }
      else if (e.key === 'Enter') { e.preventDefault(); gallery.pickFocused(); }
      else if (e.key === 'ArrowLeft') { gallery.step(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { gallery.step(1); e.preventDefault(); }
      return;
    }

    // the lyric wheel owns the keyboard while it is up
    if (wheel.isOpen) {
      if (e.key === 'Escape') { e.preventDefault(); closeWheel(); }
      return;
    }

    // the shelf owns the keyboard while it is up
    if (shelf.isOpen) {
      if (e.key === 'Escape') { e.preventDefault(); closeShelf(); }
      else if (e.key === 'Enter') { e.preventDefault(); shelf.pickFocused(); }
      return;
    }

    switch (e.key) {
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        toggle();
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekTo(currentTime() + 5);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekTo(currentTime() - 5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setVolume(engine.volume + 0.05);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setVolume(engine.volume - 0.05);
        break;
      case 'l':
      case 'L':
        if (el.drawer.classList.contains('is-open')) closeDrawer();
        else openDrawer();
        break;
      case 's':
      case 'S':
        openShelf();
        break;
      case 'w':
      case 'W':
        openWheel();
        break;
      case 'g':
      case 'G':
        openGallery();
        break;
      case 'f':
      case 'F':
        el.btnFull.click();
        break;
      case 'm':
      case 'M':
        el.btnMute.click();
        break;
      case 'h':
      case 'H': {
        if (!heart.ok) { toast('当前设备没有 WebGL2'); break; }
        const on = heart.toggle();
        stage.setDust(!on);
        document.body.classList.toggle('is-dust', !on);
        toast(on ? '波点之心 · 开' : '波点之心 · 关');
        break;
      }
      case 'Escape':
        if (el.drawer.classList.contains('is-open')) closeDrawer();
        break;
      case '1':
      case '2':
      case '3':
      case '4': {
        const preset = PRESETS[Number(e.key) - 1];
        if (preset) usePreset(preset.id);
        break;
      }
      default:
        break;
    }
    wake();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) wake();
  });
}

function setVolume(v) {
  const clamped = Math.min(1, Math.max(0, v));
  el.vol.value = String(clamped);
  el.vol.style.setProperty('--v', `${clamped * 100}%`);
  engine.setVolume(clamped);
}

function hasFiles(e) {
  const t = e.dataTransfer;
  if (!t) return false;
  if (t.types && Array.from(t.types).includes('Files')) return true;
  return false;
}

function enter() {
  if (state.entered) return;
  state.entered = true;
  el.curtain.classList.add('is-gone');
  /* the curtain used to hide the HUD forever: without this the nav/dock
     stayed at opacity 0 even after 进入 (STILL mode removed it separately) */
  document.body.classList.remove('is-intro');
  heart.kick(0.7);
  engine.unlock().catch(() => {});
  if (state.queue.length) {
    el.audio.play().catch(() => {});
  }
  setTimeout(() => toast('空格 播放 · ←→ 快进 · L 曲目 · H 心/尘埃 · 拖入音频'), 1200);
  // keep the wake on the curtain until it has faded, then hand it to the stage
  setTimeout(syncPaperLayer, 1000);
  scheduleIdle();
}

function wake() {
  document.body.classList.remove('is-idle');
  scheduleIdle();
}

function scheduleIdle() {
  clearTimeout(state.idleTimer);
  if (el.audio.paused) {
    document.body.classList.remove('is-idle');
    return;
  }
  state.idleTimer = setTimeout(() => {
    if (!el.audio.paused) document.body.classList.add('is-idle');
  }, 3200);
}

/* ------------------------------------------------------------- main loop */

let last = performance.now();

function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;

  if (STILL) {
    engine.mock = true;
    state.virtualTime += dt * 0.0;
  }
  const audio = engine.update(dt);
  const overlayOpen = gallery.isOpen || shelf.isOpen || wheel.isOpen;
  if (!overlayOpen) {
    stage.render(dt, audio);
    heart.setPresence(state.showLyrics ? 0.92 : 1);
    heart.render(dt, audio);
  }
  paperDots.render(now, dt);
  shelf.update(dt);
  gallery.update(dt);
  if (wheel.isOpen) {
    wheel.follow(state.lyricIndex);
    wheel.drawSpectrum(engine.freq);
  }
  wheel.update(dt);

  const time = currentTime();
  const dur = effectiveDuration();
  paintProgress(time, dur);
  paintLyricFrame(time);

  requestAnimationFrame(loop);
}

/* ----------------------------------------------------------------- start */

boot();
syncNav();

if (STILL) {
  // deterministic-ish frame for screenshots
  el.curtain.classList.add('is-gone');
  document.body.classList.remove('is-intro');
  state.entered = true;
  syncPaperLayer();
  syncNav();

  setTimeout(() => {
    document.body.dataset.selftest = [
      'gl=' + stage.ok,
      'q=' + state.queue.length,
      'lines=' + (state.lyrics ? state.lyrics.lines.length : 0),
      'dur=' + Math.round(effectiveDuration()),
      'idx=' + state.lyricIndex,
      'vw=' + window.innerWidth,
      'cols=' + getComputedStyle(document.querySelector('.dock__row')).gridTemplateColumns,
      'aside=' + getComputedStyle(document.querySelector('.aside')).display,
      'heart=' + (heart.ok ? (heart.enabled ? 'on' : 'off') : 'na')
    ].join(' ');
    if (params.has('panel')) openDrawer();
    if (params.has('shelf')) openShelf();
    if (params.has('wheel')) openWheel();
    if (params.has('gallery')) openGallery();
  }, 1500);
}

if (typeof window !== 'undefined') {
  window.__nocturne = { state, engine, stage, heart, paperDots, shelf, wheel, gallery, usePreset, PRESETS };
}

export { state, engine, stage };
