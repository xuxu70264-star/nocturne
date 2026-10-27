/* make-demos.mjs — synthesises the six built-in demo tracks.
   No samples, no network: additive pads, a sub, a very quiet kick, a few
   bells, then a small Schroeder reverb. Each track is a different room.

   node tools/make-demos.mjs        → assets/demo-1 … demo-6 (.mp3)
*/

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, '..', 'assets');
const SR = 44100;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* --- sine table ------------------------------------------------------- */

const TABLE = new Float32Array(4096);
for (let i = 0; i < 4096; i++) TABLE[i] = Math.sin((i / 4096) * Math.PI * 2);

/* --- one track -------------------------------------------------------- */

function renderTrack(cfg) {
  const beat = 60 / cfg.bpm;
  const bar = beat * 4;
  const bars = cfg.bars;
  const tail = 6;
  const duration = bars * bar + tail;
  const N = Math.ceil(duration * SR);

  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const SEND = new Float32Array(N);

  const add = (i, v, pan = 0, send = 0) => {
    if (i < 0 || i >= N) return;
    L[i] += v * Math.sqrt(0.5 * (1 - pan));
    R[i] += v * Math.sqrt(0.5 * (1 + pan));
    if (send) SEND[i] += v * send;
  };

  const padNote = (startSec, durSec, midi, amp, pan) => {
    const f = mtof(midi);
    const start = Math.floor(startSec * SR);
    const len = Math.floor((durSec + 3.0) * SR);
    const attack = 1.6 * SR;
    const release = 2.8 * SR;
    const sustainEnd = Math.max(attack, len - release);

    const voices = [
      { det: 1.0, ph: Math.random() * 4096, a: 1.0 },
      { det: 1.0034, ph: Math.random() * 4096, a: 0.72 },
      { det: 0.9966, ph: Math.random() * 4096, a: 0.72 }
    ];
    const partials = [{ mult: 1, a: 1.0 }, { mult: 2, a: 0.15 }, { mult: 3, a: 0.06 }];
    const inc = (f / SR) * 4096;

    for (let n = 0; n < len; n++) {
      const i = start + n;
      if (i >= N) break;

      let env;
      if (n < attack) env = Math.sin((n / attack) * Math.PI * 0.5) ** 2;
      else if (n < sustainEnd) env = 1;
      else env = Math.max(0, 1 - (n - sustainEnd) / release) ** 1.6;

      const drift = 1 + 0.0035 * Math.sin((n / SR) * 0.35 + f * 0.1);
      let s = 0;
      for (const v of voices) {
        const p = v.ph + inc * v.det * drift * n;
        for (const h of partials) s += v.a * h.a * TABLE[((p * h.mult) & 4095) | 0];
      }
      s /= voices.length * 2.2;

      const trem = 0.86 + 0.14 * Math.sin((n / SR) * 0.55 + midi);
      add(i, s * env * amp * trem, pan, 0.45);
    }
  };

  const subNote = (startSec, durSec, midi, amp) => {
    const f = mtof(midi);
    const start = Math.floor(startSec * SR);
    const len = Math.floor(durSec * SR);
    const inc = (2 * Math.PI * f) / SR;
    for (let n = 0; n < len; n++) {
      const i = start + n;
      if (i >= N) break;
      const t = n / SR;
      const env = Math.min(1, t / 0.03) * Math.exp(-t * 1.1);
      add(i, Math.sin(inc * n) * env * amp, 0, 0.12);
    }
  };

  const kick = (startSec, amp = 0.5) => {
    const start = Math.floor(startSec * SR);
    const len = Math.floor(0.55 * SR);
    let phase = 0;
    for (let n = 0; n < len; n++) {
      const i = start + n;
      if (i >= N) break;
      const t = n / SR;
      const f = 42 + 96 * Math.exp(-t * 26);
      phase += (2 * Math.PI * f) / SR;
      const env = Math.exp(-t * 9) * (1 - Math.exp(-t * 90));
      add(i, Math.sin(phase) * env * amp, 0, 0.18);
    }
  };

  const hat = (startSec, amp = 0.05, pan = 0.2) => {
    const start = Math.floor(startSec * SR);
    const len = Math.floor(0.09 * SR);
    let prev = 0;
    for (let n = 0; n < len; n++) {
      const i = start + n;
      if (i >= N) break;
      const t = n / SR;
      const noise = Math.random() * 2 - 1;
      const hp = noise - prev * 0.96;
      prev = noise;
      add(i, hp * Math.exp(-t * 55) * amp, pan, 0.05);
    }
  };

  const bell = (startSec, midi, amp = 0.14, pan = 0) => {
    const f = mtof(midi);
    const start = Math.floor(startSec * SR);
    const len = Math.floor(4.5 * SR);
    for (let n = 0; n < len; n++) {
      const i = start + n;
      if (i >= N) break;
      const t = n / SR;
      const env = Math.min(1, t / 0.008) * Math.exp(-t * 1.35);
      const mod = Math.sin(2 * Math.PI * f * 2.01 * t) * 0.6 * Math.exp(-t * 2.2);
      add(i, Math.sin(2 * Math.PI * f * t + mod) * env * amp, pan, 0.55);
    }
  };

  /* --- score --- */

  const prog = cfg.progression;

  for (let b = 0; b < bars; b++) {
    const name = prog[Math.floor(b / (cfg.barPerChord || 1)) % prog.length];
    const chord = cfg.chords[name];
    const t0 = b * bar;

    chord.notes.forEach((midi, idx) => {
      const pan = (idx / (chord.notes.length - 1 || 1)) * 1.2 - 0.6;
      const amp = (cfg.padLevel || 0.17) / Math.sqrt(chord.notes.length);
      padNote(t0, bar * 1.02, midi, amp * (idx === 0 ? 1.15 : 1), pan * 0.8);
    });

    subNote(t0, beat * 1.6, chord.root, cfg.subLevel ?? 0.20);
    if (b % 2 === 0) subNote(t0 + beat * 2, beat * 1.4, chord.root, (cfg.subLevel ?? 0.20) * 0.7);

    if (b >= (cfg.kickFrom ?? 1) && cfg.kick !== false) {
      kick(t0, cfg.kickLevel ?? 0.26);
      if (b % 4 === 2) kick(t0 + beat * 2.5, (cfg.kickLevel ?? 0.26) * 0.6);
    }

    if (b >= (cfg.hatFrom ?? 4) && cfg.hat !== false) {
      for (let k = 0; k < 4; k++) {
        hat(t0 + k * beat + beat * 0.5, b % 8 === 0 ? 0.028 : 0.017, k % 2 ? -0.25 : 0.25);
      }
    }
  }

  for (const [barPos, midi] of cfg.bells || []) {
    bell(barPos * bar, midi, cfg.bellLevel ?? 0.13, (Math.random() - 0.5) * 0.8);
  }

  /* --- reverb --- */

  const decay = cfg.decay ?? 0.79;
  const mix = cfg.reverbMix ?? 0.55;
  const combs = [1557, 1617, 1491, 1422, 1277, 1356];
  const allpasses = [556, 441, 341];

  for (let ch = 0; ch < 2; ch++) {
    const out = ch === 0 ? L : R;
    const spread = ch === 0 ? 0 : 23;
    const acc = new Float32Array(N);

    for (let c = 0; c < combs.length; c++) {
      const size = combs[c] + spread + c * 7;
      const line = new Float32Array(size);
      let idx = 0;
      let filt = 0;
      for (let i = 0; i < N; i++) {
        const y = line[idx];
        filt = y * 0.72 + filt * 0.28;
        line[idx] = SEND[i] + filt * decay;
        idx = (idx + 1) % size;
        acc[i] += y / combs.length;
      }
    }

    for (let a = 0; a < allpasses.length; a++) {
      const size = allpasses[a] + spread;
      const line = new Float32Array(size);
      let idx = 0;
      for (let i = 0; i < N; i++) {
        const bufv = line[idx];
        const v = acc[i] + bufv * 0.5;
        line[idx] = v;
        acc[i] = bufv - v * 0.5;
        idx = (idx + 1) % size;
      }
    }

    for (let i = 0; i < N; i++) out[i] += acc[i] * mix;
  }

  /* --- master --- */

  let peak = 0;
  for (let i = 0; i < N; i++) {
    L[i] = Math.tanh(L[i] * 1.1);
    R[i] = Math.tanh(R[i] * 1.1);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const gain = peak > 0 ? 0.89 / peak : 1;
  const fadeIn = Math.floor(2.2 * SR);
  const fadeOut = Math.floor(5.0 * SR);

  for (let i = 0; i < N; i++) {
    let g = gain;
    if (i < fadeIn) g *= i / fadeIn;
    const t = N - 1 - i;
    if (t < fadeOut) g *= t / fadeOut;
    L[i] *= g;
    R[i] *= g;
  }

  return { L, R, N, duration };
}

function writeWav(file, { L, R, N }) {
  const bytes = 44 + N * 4;
  const buffer = Buffer.alloc(bytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(bytes - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(SR * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(N * 4, 40);

  let o = 44;
  for (let i = 0; i < N; i++) {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), o);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), o + 2);
    o += 4;
  }
  fs.writeFileSync(file, buffer);
}

/* --- the six rooms ---------------------------------------------------- */

const TRACKS = [
  {
    id: 'demo-1',
    bpm: 72,
    bars: 32,
    barPerChord: 1,
    progression: ['Am9', 'Am9', 'Fmaj7', 'Cmaj9', 'Am9', 'Am9', 'Fmaj7', 'G6'],
    chords: {
      Am9: { notes: [45, 57, 60, 64, 71], root: 33 },
      Fmaj7: { notes: [41, 53, 57, 60, 64], root: 29 },
      Cmaj9: { notes: [48, 55, 59, 64, 67], root: 36 },
      G6: { notes: [43, 55, 59, 64, 67], root: 31 }
    },
    bells: [
      [4, 81], [4.63, 84], [8.5, 79], [8.88, 88],
      [12, 84], [12.69, 81], [16.38, 88], [16.75, 84],
      [20, 79], [20.63, 84], [24.5, 88], [24.81, 91],
      [28, 84], [28.63, 81]
    ]
  },
  {
    id: 'demo-2',
    bpm: 60,
    bars: 12,
    progression: ['Dm9', 'Bbmaj7', 'Gm7', 'A7sus'],
    chords: {
      Dm9: { notes: [50, 57, 60, 64, 65], root: 38 },
      Bbmaj7: { notes: [46, 53, 58, 62, 65], root: 34 },
      Gm7: { notes: [43, 50, 58, 62, 65], root: 31 },
      A7sus: { notes: [45, 52, 57, 62, 64], root: 33 }
    },
    padLevel: 0.20,
    subLevel: 0.24,
    kickFrom: 2,
    hatFrom: 5,
    kickLevel: 0.20,
    decay: 0.86,
    reverbMix: 0.66,
    bells: [[3, 74], [5.5, 77], [9, 72], [11.25, 79]]
  },
  {
    id: 'demo-3',
    bpm: 84,
    bars: 14,
    progression: ['Em', 'Cmaj7', 'G', 'D'],
    chords: {
      Em: { notes: [52, 59, 64, 67, 71], root: 40 },
      Cmaj7: { notes: [48, 55, 59, 64, 67], root: 36 },
      G: { notes: [43, 55, 59, 62, 67], root: 31 },
      D: { notes: [50, 57, 62, 66, 69], root: 38 }
    },
    padLevel: 0.155,
    subLevel: 0.22,
    kickFrom: 1,
    hatFrom: 2,
    kickLevel: 0.30,
    decay: 0.74,
    reverbMix: 0.48,
    bells: [[2, 84], [3.5, 88], [6.75, 86], [9, 83], [12, 91]]
  },
  {
    id: 'demo-4',
    bpm: 52,
    bars: 10,
    progression: ['Fmaj9', 'Em7', 'Dm9', 'Cmaj7'],
    chords: {
      Fmaj9: { notes: [41, 53, 57, 60, 67], root: 29 },
      Em7: { notes: [40, 52, 55, 59, 62], root: 28 },
      Dm9: { notes: [38, 50, 53, 57, 64], root: 26 },
      Cmaj7: { notes: [36, 48, 52, 55, 59], root: 24 }
    },
    padLevel: 0.22,
    subLevel: 0.26,
    kick: false,
    hat: false,
    decay: 0.90,
    reverbMix: 0.72,
    bells: [[4, 76], [7.5, 72]]
  },
  {
    id: 'demo-5',
    bpm: 66,
    bars: 12,
    progression: ['Cmaj9', 'Am9', 'Fmaj7', 'G6'],
    chords: {
      Cmaj9: { notes: [48, 55, 59, 64, 67], root: 36 },
      Am9: { notes: [45, 57, 60, 64, 71], root: 33 },
      Fmaj7: { notes: [41, 53, 57, 60, 64], root: 29 },
      G6: { notes: [43, 55, 59, 64, 67], root: 31 }
    },
    padLevel: 0.18,
    subLevel: 0.18,
    kickFrom: 3,
    hatFrom: 6,
    kickLevel: 0.18,
    decay: 0.82,
    reverbMix: 0.60,
    bells: [[1, 79], [4.5, 76], [8, 84], [10.5, 81]]
  },
  {
    id: 'demo-6',
    bpm: 58,
    bars: 10,
    progression: ['Bbmaj7', 'Am7', 'Gm7', 'Fmaj7'],
    chords: {
      Bbmaj7: { notes: [46, 53, 57, 62, 65], root: 34 },
      Am7: { notes: [45, 52, 57, 60, 64], root: 33 },
      Gm7: { notes: [43, 50, 55, 58, 62], root: 31 },
      Fmaj7: { notes: [41, 48, 53, 57, 60], root: 29 }
    },
    padLevel: 0.20,
    subLevel: 0.22,
    kickFrom: 4,
    hat: false,
    kickLevel: 0.16,
    decay: 0.84,
    reverbMix: 0.64,
    bells: []
  }
];

/* --- run --------------------------------------------------------------- */

fs.mkdirSync(ASSETS, { recursive: true });
console.log('rendering', TRACKS.length, 'tracks…');

for (const cfg of TRACKS) {
  const t0 = Date.now();
  const wav = path.join(ASSETS, `${cfg.id}.wav`);
  const mp3 = path.join(ASSETS, `${cfg.id}.mp3`);
  const rendered = renderTrack(cfg);
  writeWav(wav, rendered);

  try {
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
      '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '4', '-ar', String(SR), mp3], { stdio: 'ignore' });
    fs.unlinkSync(wav);
    const kb = Math.round(fs.statSync(mp3).size / 1024);
    console.log(`  ${cfg.id}.mp3  ${rendered.duration.toFixed(1)}s  ${kb}kb  (${Date.now() - t0}ms)`);
  } catch (err) {
    console.log(`  ${cfg.id}.wav kept — ffmpeg unavailable: ${err.message}`);
  }
}
