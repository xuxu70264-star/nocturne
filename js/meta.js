/* meta.js — read what the file already knows.
   ID3v2.3 / 2.4 tags out of the first megabyte of an MP3: title, artist,
   album, track number and cover art. Everything else falls back to the
   filename, which is what most rips actually rely on anyway.          */

const DECODERS = {
  latin1: new TextDecoder('iso-8859-1'),
  utf8: new TextDecoder('utf-8'),
  utf16le: new TextDecoder('utf-16le'),
  utf16be: new TextDecoder('utf-16be')
};

function syncsafe(u8, at) {
  return ((u8[at] & 0x7f) << 21) | ((u8[at + 1] & 0x7f) << 14) | ((u8[at + 2] & 0x7f) << 7) | (u8[at + 3] & 0x7f);
}

function uint32(u8, at) {
  return (u8[at] << 24) | (u8[at + 1] << 16) | (u8[at + 2] << 8) | u8[at + 3];
}

/** Undo the 0xFF 0x00 escaping used by the unsynchronisation flag. */
function deunsync(u8) {
  const out = new Uint8Array(u8.length);
  let j = 0;
  for (let i = 0; i < u8.length; i++) {
    out[j++] = u8[i];
    if (u8[i] === 0xff && u8[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function decodeText(u8, from, to) {
  if (to <= from) return '';
  const enc = u8[from];
  const body = u8.subarray(from + 1, to);

  let text;
  if (enc === 1) {
    // UTF-16 with BOM
    if (body[0] === 0xff && body[1] === 0xfe) text = DECODERS.utf16le.decode(body.subarray(2));
    else if (body[0] === 0xfe && body[1] === 0xff) text = DECODERS.utf16be.decode(body.subarray(2));
    else text = DECODERS.utf16le.decode(body);
  } else if (enc === 2) {
    text = DECODERS.utf16be.decode(body);
  } else if (enc === 3) {
    text = DECODERS.utf8.decode(body);
  } else {
    text = DECODERS.latin1.decode(body);
  }
  return text.replace(/\u0000+$/, '').replace(/^\u0000+/, '').trim();
}

function readNullTerminated(u8, from, utf16) {
  let i = from;
  if (utf16) {
    while (i + 1 < u8.length && !(u8[i] === 0 && u8[i + 1] === 0)) i += 2;
    return { end: i, next: Math.min(u8.length, i + 2) };
  }
  while (i < u8.length && u8[i] !== 0) i++;
  return { end: i, next: Math.min(u8.length, i + 1) };
}

/**
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {{title?:string, artist?:string, album?:string, track?:number,
 *            year?:string, picture?:{mime:string, data:Uint8Array}} | null}
 */
export function readId3(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (u8.length < 10 || u8[0] !== 0x49 || u8[1] !== 0x44 || u8[2] !== 0x33) return null;

  const major = u8[3];
  if (major < 3) return null; // 2.2 uses 3-char frame ids; not worth the code
  const flags = u8[5];
  const tagSize = syncsafe(u8, 6);
  const end = Math.min(u8.length, 10 + tagSize);

  let body = u8.subarray(10, end);
  if (flags & 0x80) body = deunsync(body);

  const out = {};
  let at = 0;

  while (at + 10 <= body.length) {
    const id = String.fromCharCode(body[at], body[at + 1], body[at + 2], body[at + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;

    const frameSize = major === 4 ? syncsafe(body, at + 4) : uint32(body, at + 4);
    if (frameSize <= 0 || at + 10 + frameSize > body.length) break;

    const dataAt = at + 10;
    const dataEnd = dataAt + frameSize;

    if (id === 'TIT2' || id === 'TPE1' || id === 'TALB' || id === 'TRCK' || id === 'TYER' || id === 'TDRC') {
      const text = decodeText(body, dataAt, dataEnd);
      if (id === 'TIT2' && !out.title) out.title = text;
      if (id === 'TPE1' && !out.artist) out.artist = text;
      if (id === 'TALB' && !out.album) out.album = text;
      if (id === 'TRCK' && !out.track) {
        const n = parseInt(text.split('/')[0], 10);
        if (Number.isFinite(n)) out.track = n;
      }
      if ((id === 'TYER' || id === 'TDRC') && !out.year) out.year = text.slice(0, 4);
    }

    if (id === 'APIC' && !out.picture) {
      const enc = body[dataAt];
      const mimeEnd = readNullTerminated(body, dataAt + 1, false);
      const mime = DECODERS.latin1.decode(body.subarray(dataAt + 1, mimeEnd.end)) || 'image/jpeg';
      const typeAt = mimeEnd.next;
      const descEnd = readNullTerminated(body, typeAt + 1, enc === 1 || enc === 2);
      const image = body.subarray(descEnd.next, dataEnd);
      if (image.length > 100) out.picture = { mime, data: image };
    }

    at = dataEnd;
  }

  return Object.keys(out).length ? out : null;
}

/** "03 - Artist - Title.mp3" → { artist, title, track } */
export function guessFromName(fileName) {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/^\s*\d{1,3}[\s._\-–—]+/, '')
    .trim();

  const parts = base.split(/\s+[-–—]\s+|\s*-\s*/).filter(Boolean);
  if (parts.length >= 2) {
    return { title: parts.slice(1).join(' - ').trim(), artist: parts[0].trim() };
  }
  return { title: base || '未命名', artist: '' };
}

/** Read the head of a file and merge ID3 tags over the filename guess. */
export async function readTags(file, limit = 1024 * 1024) {
  const fallback = guessFromName(file.name);
  if (!/\.mp3$/i.test(file.name)) return { ...fallback, picture: null, fromFile: true };

  try {
    const head = await file.slice(0, Math.min(limit, file.size)).arrayBuffer();
    const tags = readId3(head);
    if (!tags) return { ...fallback, picture: null, fromFile: true };
    return {
      title: tags.title || fallback.title,
      artist: tags.artist || fallback.artist,
      album: tags.album || '',
      track: tags.track || 0,
      year: tags.year || '',
      picture: tags.picture || null,
      fromFile: !tags.title
    };
  } catch (err) {
    return { ...fallback, picture: null };
  }
}
