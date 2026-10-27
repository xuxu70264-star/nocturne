/* lyrics.js — .lrc in, timed lines out.
   Deliberately small and pure so it can be unit tested.  */

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[([a-zA-Z\u4e00-\u9fa5]+):(.*)\]$/;

/**
 * Parse an LRC file.
 * @param {string} raw
 * @returns {{lines: {t:number, text:string}[], offset:number, meta: Record<string,string>} | null}
 */
export function parseLRC(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = [];
  const meta = {};
  let offset = 0;

  for (const row of text.split('\n')) {
    const line = row.trim();
    if (!line) continue;

    // pure metadata line, e.g. [ar:坂本龍一]
    const metaMatch = META_TAG.exec(line);
    if (metaMatch && !TIME_TAG.test(line)) {
      const key = metaMatch[1].toLowerCase();
      const value = metaMatch[2].trim();
      if (key === 'offset') {
        const n = Number(value);
        if (Number.isFinite(n)) offset = n / 1000;
      } else {
        meta[key] = value;
      }
      TIME_TAG.lastIndex = 0;
      continue;
    }

    TIME_TAG.lastIndex = 0;
    const stamps = [];
    let match;
    let consumedTo = 0;
    while ((match = TIME_TAG.exec(line)) !== null) {
      // tags must be a prefix run, not scattered inside the text
      if (match.index !== consumedTo) break;
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const fracRaw = match[3] || '0';
      const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
      stamps.push(min * 60 + sec + frac);
      consumedTo = TIME_TAG.lastIndex;
    }
    TIME_TAG.lastIndex = 0;

    if (!stamps.length) continue;

    const body = line.slice(consumedTo).trim();
    for (const t of stamps) {
      lines.push({ t: Math.max(0, t), text: body });
    }
  }

  if (!lines.length) return null;

  if (offset) {
    for (const l of lines) l.t = Math.max(0, l.t + offset);
  }

  lines.sort((a, b) => a.t - b.t);

  // drop duplicate timestamps that came from repeated tags
  const cleaned = [];
  for (const l of lines) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && Math.abs(prev.t - l.t) < 0.02) {
      if (!prev.text && l.text) cleaned[cleaned.length - 1] = l;
      continue;
    }
    cleaned.push(l);
  }

  return { lines: cleaned, offset, meta };
}

/** Index of the line that is playing at time t (seconds). -1 before the first line. */
export function indexAt(lines, t) {
  if (!lines || !lines.length) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t + 0.001) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** 0..1 progress through the current line; carries the karaoke fill. */
export function lineProgress(lines, index, t) {
  if (!lines || index < 0) return 0;
  const cur = lines[index];
  const next = lines[index + 1];
  const end = next ? next.t : cur.t + Math.max(2.4, cur.text.length * 0.22);
  const span = Math.max(0.35, end - cur.t);
  return Math.min(1, Math.max(0, (t - cur.t) / span));
}

/**
 * Lyrics with no timestamps at all (a .txt, or an .lrc that was never
 * synced). Returns the lines, or null if there is nothing usable.
 */
export function parsePlainLyrics(raw) {
  if (typeof raw !== 'string') return null;
  const lines = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row && !/^\[[a-zA-Z\u4e00-\u9fa5]+:.*\]$/.test(row))
    .map((row) => row.replace(/^\[[^\]]*\]/, '').trim())
    .filter(Boolean);
  return lines.length ? lines : null;
}

/**
 * Spread lines evenly across a track. Not a real sync, but it is honest:
 * the lyric moves, and the first line waits out the intro.
 */
export function distribute(lines, duration) {
  const d = Number.isFinite(duration) && duration > 2 ? duration : lines.length * 4;
  const lead = Math.min(6, d * 0.05);
  const span = Math.max(1, d - lead - 2);
  const step = span / lines.length;
  return lines.map((text, i) => ({ t: +(lead + i * step).toFixed(2), text }));
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
