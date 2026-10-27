import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLRC, parsePlainLyrics, distribute, indexAt, lineProgress, formatTime } from '../js/lyrics.js';

test('parses timestamps, metadata and blank lines', () => {
  const lrc = parseLRC(`[ti:夜航]
[ar:NOCTURNE]
[offset:0]

[00:01.00]first
[00:02.50]second
[00:03.25]third`);

  assert.equal(lrc.lines.length, 3);
  assert.equal(lrc.meta.ti, '夜航');
  assert.equal(lrc.meta.ar, 'NOCTURNE');
  assert.equal(lrc.lines[0].t, 1);
  assert.equal(lrc.lines[1].t, 2.5);
  assert.equal(lrc.lines[2].t, 3.25);
  assert.equal(lrc.lines[2].text, 'third');
});

test('expands a line with several timestamps', () => {
  const lrc = parseLRC('[00:05.00][00:20.00]chorus');
  assert.equal(lrc.lines.length, 2);
  assert.deepEqual(lrc.lines.map((l) => l.t), [5, 20]);
  assert.equal(lrc.lines[1].text, 'chorus');
});

test('accepts a milli or centi fraction', () => {
  assert.equal(parseLRC('[00:01.5]a').lines[0].t, 1.5);
  assert.equal(parseLRC('[00:01.25]a').lines[0].t, 1.25);
  assert.equal(parseLRC('[00:01.250]a').lines[0].t, 1.25);
  assert.equal(parseLRC('[00:01]a').lines[0].t, 1);
});

test('applies the offset tag in seconds', () => {
  const lrc = parseLRC('[offset:500]\n[00:02.00]late');
  assert.equal(lrc.lines[0].t, 2.5);
});

test('sorts out-of-order timestamps and drops duplicate empty stamps', () => {
  const lrc = parseLRC('[00:09.00]nine\n[00:01.00]one\n[00:09.00]\n[00:05.00]five');
  assert.deepEqual(lrc.lines.map((l) => l.text), ['one', 'five', 'nine']);
});

test('returns null for text without any timestamp', () => {
  assert.equal(parseLRC('just some words\nand more'), null);
  assert.equal(parseLRC(''), null);
  assert.equal(parseLRC(null), null);
});

test('indexAt finds the line playing at a moment', () => {
  const lines = [{ t: 1 }, { t: 5 }, { t: 9 }];
  assert.equal(indexAt(lines, 0.5), -1);
  assert.equal(indexAt(lines, 1), 0);
  assert.equal(indexAt(lines, 4.99), 0);
  assert.equal(indexAt(lines, 5), 1);
  assert.equal(indexAt(lines, 100), 2);
  assert.equal(indexAt([], 3), -1);
});

test('lineProgress stays inside 0..1 and ends at the next line', () => {
  const lines = [{ t: 0, text: 'aaaa' }, { t: 2, text: 'bbbb' }, { t: 4, text: 'cccc' }];
  assert.equal(lineProgress(lines, 0, 0), 0);
  assert.equal(lineProgress(lines, 0, 1), 0.5);
  assert.equal(lineProgress(lines, 0, 5), 1);
  assert.equal(lineProgress(lines, -1, 1), 0);
});

test('formatTime is mm:ss', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(9.9), '0:09');
  assert.equal(formatTime(61), '1:01');
  assert.equal(formatTime(3725), '62:05');
  assert.equal(formatTime(NaN), '0:00');
});

test('plain lyrics: keeps lines, drops tags and blanks', () => {
  const lines = parsePlainLyrics('[ti:测试]\n[ar:某人]\n\n第一句\n  \n第二句\n');
  assert.deepEqual(lines, ['第一句', '第二句']);
  assert.equal(parsePlainLyrics(''), null);
  assert.equal(parsePlainLyrics(null), null);
});

test('distribute spreads lines inside the track, in order', () => {
  const times = distribute(['a', 'b', 'c', 'd'], 100).map((l) => l.t);
  assert.equal(times.length, 4);
  assert.ok(times[0] > 0 && times[0] < 10, 'leaves an intro');
  assert.ok(times[3] < 100, 'ends before the track does');
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
});

test('distribute survives an unknown duration', () => {
  const lines = distribute(['a', 'b'], 0);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].t > lines[0].t);
});
