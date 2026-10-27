import test from 'node:test';
import assert from 'node:assert/strict';

import { readId3, guessFromName } from '../js/meta.js';

/* --- tiny ID3v2.3 writer, just enough to test the reader ---------------- */

function u32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function syncsafe(n) {
  return [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
}

function frame(id, payload) {
  return [
    ...Array.from(id, (c) => c.charCodeAt(0)),
    ...u32(payload.length),
    0, 0,
    ...payload
  ];
}

function textFrame(id, text) {
  return frame(id, [3, ...new TextEncoder().encode(text)]); // 3 = UTF-8
}

function tag(frames) {
  const body = frames.flat();
  return new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, ...syncsafe(body.length), ...body]);
}

const JPEG = new Uint8Array(200).fill(0x2a);

test('reads title, artist, album, track and cover', () => {
  const bytes = tag([
    textFrame('TIT2', '夜航'),
    textFrame('TPE1', 'NOCTURNE'),
    textFrame('TALB', 'Demo'),
    textFrame('TRCK', '03/12'),
    frame('APIC', [0, ...Array.from('image/jpeg', (c) => c.charCodeAt(0)), 0, 3, 0, ...JPEG])
  ]);

  const tags = readId3(bytes);
  assert.equal(tags.title, '夜航');
  assert.equal(tags.artist, 'NOCTURNE');
  assert.equal(tags.album, 'Demo');
  assert.equal(tags.track, 3);
  assert.equal(tags.picture.mime, 'image/jpeg');
  assert.equal(tags.picture.data.length, 200);
});

test('reads UTF-16 text with a BOM', () => {
  const text = '坂本龍一';
  const body = [0xff, 0xfe];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    body.push(code & 0xff, (code >> 8) & 0xff);
  }
  const tags = readId3(tag([frame('TPE1', [1, ...body])]));
  assert.equal(tags.artist, '坂本龍一');
});

test('ignores junk and returns null when there is no tag', () => {
  assert.equal(readId3(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), null);
  assert.equal(readId3(new Uint8Array(0)), null);
  // "ID3" but no usable frames
  assert.equal(readId3(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0])), null);
});

test('does not choke on a truncated frame', () => {
  const bytes = tag([textFrame('TIT2', 'ok')]);
  const cut = bytes.slice(0, bytes.length - 1);
  const tags = readId3(cut);
  assert.ok(tags === null || typeof tags.title === 'string');
});

test('guessFromName strips track numbers and splits artist', () => {
  assert.deepEqual(guessFromName('03 - 坂本龍一 - Aqua.mp3'), { artist: '坂本龍一', title: 'Aqua' });
  assert.deepEqual(guessFromName('01 Artist - Title (Remix).flac'), { artist: 'Artist', title: 'Title (Remix)' });
  assert.deepEqual(guessFromName('夜航.mp3'), { artist: '', title: '夜航' });
  assert.deepEqual(guessFromName('09 - 夜航.mp3'), { artist: '', title: '夜航' });
});
