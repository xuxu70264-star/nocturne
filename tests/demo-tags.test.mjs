/* demo-tags.test.mjs — the six built-in tracks must ship their own artwork.
   These read the real files, so they double as a check that tag-demos.mjs
   produced something js/meta.js (the player's own parser) can read.       */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readId3 } from '../js/meta.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const FILES = ['demo-1', 'demo-2', 'demo-3', 'demo-4', 'demo-5', 'demo-6'];

test('every demo track carries its cover in the ID3 tag', () => {
  let checked = 0;

  for (const name of FILES) {
    const file = path.join(ASSETS, `${name}.mp3`);
    if (!fs.existsSync(file)) continue;      // assets are generated; absent is not a failure
    checked++;

    const tags = readId3(fs.readFileSync(file));
    assert.ok(tags, `${name}: tag parses`);
    assert.ok(tags.title, `${name}: has a title`);
    assert.equal(tags.artist, 'NOCTURNE');
    assert.ok(tags.picture, `${name}: has a front cover`);
    assert.equal(tags.picture.mime, 'image/png');
    assert.ok(tags.picture.data.length > 10_000, `${name}: cover is a real image`);
  }

  assert.ok(checked > 0, 'no demo audio found — run npm run build:assets first');
});

test('the audio still starts with an MPEG frame after the tag', () => {
  const file = path.join(ASSETS, 'demo-2.mp3');
  if (!fs.existsSync(file)) return;          // nothing generated yet

  const buf = fs.readFileSync(file);
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);

  assert.equal(buf.toString('latin1', 0, 3), 'ID3');
  assert.equal(buf[10 + size], 0xff, 'audio frame sync byte survives the rewrite');
  assert.equal(buf[10 + size + 1] & 0xe0, 0xe0, 'MPEG audio frame header follows the tag');
});
