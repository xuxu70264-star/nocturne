/* tag-demos.mjs — give every demo track its artwork for real.
   Writes an ID3v2.3 tag (title / artist / album / subtitle / track / year /
   genre / front-cover PNG) in front of each demo MP3, replacing whatever tag
   was already there. Nothing else in the file is touched, and the result is
   verified by reading it back with js/meta.js — the same parser the player
   uses.

   node tools/tag-demos.mjs            tag all six
   node tools/tag-demos.mjs --check    verify only, write nothing
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readId3 } from '../js/meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const COVERS = path.join(ASSETS, 'covers');
const CHECK_ONLY = process.argv.includes('--check');

const ALBUM = 'Nocturne · Demo';
const YEAR = '2026';

/* queue order in js/app.js, and which audio file each one uses */
const TRACKS = [
  { file: 'demo-1', cover: 'night', title: '夜航', note: '72 BPM · A minor 9', no: 1 },
  { file: 'demo-2', cover: 'deep', title: '深海', note: '60 BPM · D minor 9', no: 2 },
  { file: 'demo-5', cover: 'tide', title: '潮汐', note: '66 BPM · C major 9', no: 3 },
  { file: 'demo-3', cover: 'embers', title: '余烬', note: '84 BPM · E minor', no: 4 },
  { file: 'demo-4', cover: 'silver', title: '银盐', note: '52 BPM · F major 9', no: 5 },
  { file: 'demo-6', cover: 'idle', title: '空转', note: '58 BPM · B♭ major 7', no: 6 }
];

/* --------------------------------------------------------------- writing */

const syncsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

/** v2.3 text frame: UTF-16LE with BOM, null-terminated */
function textFrame(id, text) {
  const body = Buffer.alloc(1 + 2 + text.length * 2 + 2);
  body[0] = 1;
  body[1] = 0xff;
  body[2] = 0xfe;
  for (let i = 0; i < text.length; i++) body.writeUInt16LE(text.charCodeAt(i), 3 + i * 2);
  return frame(id, body);
}

function frame(id, body) {
  const head = Buffer.alloc(10);
  head.write(id, 0, 'latin1');
  head.writeUInt32BE(body.length, 4);
  head.writeUInt16BE(0, 8);
  return Buffer.concat([head, body]);
}

function apicFrame(png) {
  return frame('APIC', Buffer.concat([
    Buffer.from([0]),                       // description charset: latin1
    Buffer.from('image/png', 'latin1'),
    Buffer.from([0]),
    Buffer.from([3]),                       // picture type: front cover
    Buffer.from([0]),                       // empty description
    png
  ]));
}

function buildTag(track) {
  const png = fs.readFileSync(path.join(COVERS, `${track.cover}.png`));
  const frames = Buffer.concat([
    textFrame('TIT2', track.title),
    textFrame('TPE1', 'NOCTURNE'),
    textFrame('TALB', ALBUM),
    textFrame('TIT3', track.note),
    textFrame('TRCK', `${track.no}/6`),
    textFrame('TYER', YEAR),
    textFrame('TCON', 'Ambient'),
    apicFrame(png)
  ]);
  return {
    tag: Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0]), syncsafe(frames.length), frames]),
    png
  };
}

/** drop a leading ID3v2 tag; everything after it is audio */
function stripId3(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return buf;
  const major = buf[3];
  const flags = buf[5];
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  let offset = 10 + size;
  if (major === 4 && flags & 0x10) offset += 10;   // v2.4 footer
  return offset < buf.length ? buf.subarray(offset) : Buffer.alloc(0);
}

/* ------------------------------------------------------------ verification */

let failures = 0;

function verify(track, file, expectedPng) {
  const buf = fs.readFileSync(file);
  const tags = readId3(new Uint8Array(buf));
  const problems = [];

  if (!tags) {
    problems.push('no tag parsed');
  } else {
    if (tags.title !== track.title) problems.push(`title ${JSON.stringify(tags.title)}`);
    if (tags.artist !== 'NOCTURNE') problems.push(`artist ${JSON.stringify(tags.artist)}`);
    if (tags.album !== ALBUM) problems.push(`album ${JSON.stringify(tags.album)}`);
    if (tags.track !== track.no) problems.push(`track ${tags.track}`);
    if (!tags.picture) problems.push('no picture');
    else if (!Buffer.from(tags.picture.data).equals(expectedPng)) problems.push('picture bytes differ');
    if (tags.picture && tags.picture.mime !== 'image/png') problems.push(`mime ${tags.picture.mime}`);
  }

  // the audio must still start with a familiar MPEG frame
  const audio = stripId3(buf);
  if (!audio.length) problems.push('audio body empty');
  else if (audio[0] !== 0xff) problems.push(`audio starts ${audio[0].toString(16)}`);

  if (problems.length) {
    failures++;
    console.log(`  ✗ ${path.basename(file)} — ${problems.join(', ')}`);
  } else {
    console.log(`  ✓ ${path.basename(file)}  ${Math.round(buf.length / 1024)}kb  "${tags.title}" · ${tags.picture.data.length / 1024 | 0}kb art`);
  }
}

/* -------------------------------------------------------------------- run */

console.log(CHECK_ONLY ? 'checking demo tags…' : 'tagging demo tracks…');

for (const track of TRACKS) {
  const file = path.join(ASSETS, `${track.file}.mp3`);
  if (!fs.existsSync(file)) {
    failures++;
    console.log(`  ✗ missing ${file}`);
    continue;
  }

  const { tag, png } = buildTag(track);

  if (!CHECK_ONLY) {
    const original = fs.readFileSync(file);
    const audio = stripId3(original);
    if (!audio.length || audio[0] !== 0xff) {
      failures++;
      console.log(`  ✗ ${track.file}.mp3 — refuses to guess: no MPEG header after the old tag`);
      continue;
    }
    fs.writeFileSync(file, Buffer.concat([tag, audio]));
  }

  verify(track, file, png);
}

if (failures) {
  console.error(`${failures} problem(s)`);
  process.exit(1);
}
console.log('all good');
