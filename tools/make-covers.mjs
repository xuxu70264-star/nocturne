/* make-covers.mjs — paints the six demo covers.
   No dependencies, no canvas: a tiny PNG encoder plus procedural "rooms"
   that match the palette the stage already uses. Each cover is 960×540
   (16:9, the exact aspect of the media panel) and deterministic — the same
   seed always gives the same picture.

   node tools/make-covers.mjs   → assets/covers/night.png … idle.png
*/

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'assets', 'covers');

const W = 960;
const H = 540;

/* ------------------------------------------------------------------ math */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const hex = (s) => {
  const n = parseInt(s.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/* deterministic hash → [0,1) */
function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

function fbm(x, y, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, y * f, seed + i * 101);
    f *= 2;
    amp *= 0.5;
  }
  return sum;
}

/* ------------------------------------------------------------------ png */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tag = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])), 0);
  return Buffer.concat([len, tag, data, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** adaptive per-row filtering: gradients compress far better this way */
function encodePNG(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];

  let o = 0;
  for (let y = 0; y < height; y++) {
    rgb.copy ? rgb.copy(cur, 0, y * stride, (y + 1) * stride) : cur.set(rgb.subarray(y * stride, (y + 1) * stride));
    let best = 0;
    let bestScore = Infinity;

    for (let f = 0; f < 5; f++) {
      let score = 0;
      const out = cand[f];
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? cur[i - 3] : 0;
        const b = prev[i];
        const c = i >= 3 ? prev[i - 3] : 0;
        let v;
        if (f === 0) v = cur[i];
        else if (f === 1) v = cur[i] - a;
        else if (f === 2) v = cur[i] - b;
        else if (f === 3) v = cur[i] - ((a + b) >> 1);
        else v = cur[i] - paeth(a, b, c);
        out[i] = v & 0xff;
        score += out[i] < 128 ? out[i] : 256 - out[i];
        if (score > bestScore) break;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }

    raw[o++] = best;
    raw.set(cand[best], o);
    o += stride;
    prev.set(cur);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 2;      // truecolour
  ihdr[10] = 0;     // deflate
  ihdr[11] = 0;     // adaptive filtering
  ihdr[12] = 0;     // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* --------------------------------------------------------------- canvas */

class Canvas {
  constructor(seed) {
    this.seed = seed;
    this.px = new Float32Array(W * H * 3);
  }

  add(x, y, r, g, b, a = 1) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (!Number.isFinite(a) || a === 0 || !Number.isFinite(r + g + b)) return;
    const i = (y * W + x) * 3;
    this.px[i] += r * a;
    this.px[i + 1] += g * a;
    this.px[i + 2] += b * a;
  }

  /** soft round light: gaussian falloff, additive */
  glow(cx, cy, radius, color, strength, power = 2) {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(W - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(H - 1, Math.ceil(cy + radius));
    const inv = 1 / radius;
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) * inv;
      for (let x = x0; x <= x1; x++) {
        const dx = (x - cx) * inv;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 1) continue;
        const f = Math.pow(1 - d, power);
        this.add(x, y, color[0], color[1], color[2], f * strength);
      }
    }
  }

  /** flat vertical/radial base */
  base(stops) {
    const p = this.px;
    for (let y = 0; y < H; y++) {
      const t = y / (H - 1);
      let i = 0;
      while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
      const [p0, c0] = stops[i];
      const [p1, c1] = stops[i + 1];
      const k = p1 === p0 ? 0 : clamp01((t - p0) / (p1 - p0));
      const r = mix(c0[0], c1[0], k);
      const g = mix(c0[1], c1[1], k);
      const b = mix(c0[2], c1[2], k);
      for (let x = 0; x < W; x++) {
        const j = (y * W + x) * 3;
        p[j] = r;
        p[j + 1] = g;
        p[j + 2] = b;
      }
    }
  }

  /** directionless haze so the gradients never read as banded */
  haze(amount, scale, seedOffset = 0) {
    const p = this.px;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const n = fbm(x / scale, y / scale, this.seed + seedOffset, 4) - 0.5;
        const j = (y * W + x) * 3;
        p[j] += n * amount;
        p[j + 1] += n * amount;
        p[j + 2] += n * amount;
      }
    }
  }

  stars(count, yMax, color, maxR = 1.5, seedOffset = 0) {
    for (let i = 0; i < count; i++) {
      const x = hash2(i, 7, this.seed + seedOffset) * W;
      const y = hash2(i, 13, this.seed + seedOffset) * H * yMax;
      const r = 0.45 + hash2(i, 21, this.seed + seedOffset) * maxR;
      const a = 0.18 + hash2(i, 29, this.seed + seedOffset) * 0.75;
      this.glow(x, y, r * 3.2, color, a * 0.5, 2.5);
    }
  }

  vignette(strength = 0.55, power = 2.2) {
    const p = this.px;
    for (let y = 0; y < H; y++) {
      const dy = (y / (H - 1) - 0.5) * 2;
      for (let x = 0; x < W; x++) {
        const dx = (x / (W - 1) - 0.5) * 2;
        const d = Math.min(1, Math.sqrt(dx * dx * 0.9 + dy * dy * 0.9));
        const f = 1 - Math.pow(d, power) * strength;
        const j = (y * W + x) * 3;
        p[j] *= f;
        p[j + 1] *= f;
        p[j + 2] *= f;
      }
    }
  }

  /** fine grain: deterministic, slightly larger clumps than 1px so PNG likes it */
  grain(amount = 0.012) {
    const p = this.px;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const n = (hash2(x >> 1, y >> 1, this.seed + 11) - 0.5) * 0.7
          + (hash2(x, y, this.seed + 23) - 0.5) * 0.3;
        const j = (y * W + x) * 3;
        p[j] += n * amount;
        p[j + 1] += n * amount;
        p[j + 2] += n * amount;
      }
    }
  }

  /** gentle filmic roll-off: keeps highlights from clipping flat */
  tone() {
    const p = this.px;
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      p[i] = v <= 0 ? 0 : v / (1 + v * 0.55);
    }
  }

  toPNG() {
    const rgb = Buffer.alloc(W * H * 3);
    for (let i = 0, j = 0; i < this.px.length; i += 3, j += 3) {
      rgb[j] = Math.round(clamp01(this.px[i]) * 255);
      rgb[j + 1] = Math.round(clamp01(this.px[i + 1]) * 255);
      rgb[j + 2] = Math.round(clamp01(this.px[i + 2]) * 255);
    }
    return encodePNG(W, H, rgb);
  }
}

/* ---------------------------------------------------------------- rooms */

const ROOMS = [
  {
    name: 'night',
    seed: 1091,
    paint(c) {
      // 夜航 —open water, a moon, and a road made of broken light
      c.base([
        [0, hex('#04060e')],
        [0.40, hex('#091021')],
        [0.575, hex('#16233c')],
        [0.60, hex('#20304f')],
        [0.612, hex('#0b1526')],
        [1, hex('#040810')]
      ]);
      c.haze(0.028, 210);

      // a bank of cloud, dark against the light, above the horizon
      for (let y = 0; y < H * 0.56; y++) {
        const t = y / (H * 0.56);
        for (let x = 0; x < W; x++) {
          const n = fbm(x / 210, y / 120, c.seed + 13, 4);
          const band = Math.exp(-Math.pow((t - 0.74) / 0.20, 2));
          const a = Math.max(0, n - 0.44) * 1.6 * band;
          c.add(x, y, 0.002, 0.004, 0.008, a * 0.55);
        }
      }

      // stars thin out near the horizon
      c.stars(230, 0.55, hex('#cfdcff'), 1.4, 3);

      const mx = W * 0.705;
      const my = H * 0.385;
      c.glow(mx, my, 210, hex('#8fa6cc'), 0.26, 2.8);
      c.glow(mx, my, 34, hex('#dfe9fa'), 0.55, 2.2);
      c.glow(mx, my, 12, [1, 1, 1], 0.7, 1.6);

      // moon path: short horizontal glints, receding and fanning out
      for (let y = Math.floor(H * 0.615); y < H; y++) {
        const t = (y - H * 0.615) / (H * 0.385);
        const spread = 14 + Math.pow(t, 1.35) * 150;
        const row = 6 + Math.round(t * 9);
        for (let k = 0; k < row; k++) {
          const jx = (hash2(k, y, c.seed + 3) - 0.5);
          const x = mx + jx * spread * 2.1;
          const len = (3 + t * 16) * (0.5 + hash2(k, y, c.seed + 5));
          const a = (1 - t * 0.55) * 0.30 * (0.25 + hash2(k, y, c.seed + 7) * 0.75);
          for (let s = -len; s <= len; s += 0.8) {
            const f = 1 - Math.abs(s) / (len + 0.9);
            c.add(Math.round(x + s), y, 0.68, 0.78, 0.95, a * f * 0.55);
          }
        }
      }

      // horizon haze, warmer where it meets the light
      c.glow(W * 0.5, H * 0.607, W * 0.62, hex('#33466b'), 0.14, 2.9);
      c.glow(mx, H * 0.607, W * 0.24, hex('#55688c'), 0.12, 2.4);
    }
  },
  {
    name: 'deep',
    seed: 2207,
    paint(c) {
      // 深海 —shafts of daylight dying somewhere above you
      c.base([
        [0, hex('#0e3b3c')],
        [0.16, hex('#0a2b2e')],
        [0.55, hex('#04161b')],
        [1, hex('#010609')]
      ]);
      c.haze(0.05, 150, 17);

      // the surface itself: a bright ceiling, seen through the water
      for (let y = 0; y < H * 0.40; y++) {
        const t = y / (H * 0.40);
        const fall = Math.pow(1 - t, 2.2);
        for (let x = 0; x < W; x++) {
          const wob = Math.sin(x * 0.013 + Math.sin(y * 0.02) * 2.4) * 0.5 + 0.5;
          const net = 0.45 + 0.55 * wob * (0.6 + 0.4 * Math.sin(x * 0.047 + y * 0.03));
          c.add(x, y, 0.34, 0.86, 0.78, fall * net * 0.16);
        }
      }
      c.glow(W * 0.5, -H * 0.16, W * 0.62, hex('#6fd8c6'), 0.14, 2.2);

      for (let i = 0; i < 7; i++) {
        const x0 = W * (0.08 + i * 0.14) + (hash2(i, 3, c.seed) - 0.5) * 60;
        const width = 34 + hash2(i, 5, c.seed) * 62;
        const tilt = (hash2(i, 9, c.seed) - 0.5) * 0.26;
        const strength = 0.18 + hash2(i, 11, c.seed) * 0.16;
        for (let y = 0; y < H; y++) {
          const t = y / H;
          const cx = x0 + Math.sin(t * 3.1 + i) * 18 + y * tilt;
          const w = width * (0.45 + t * 2.1);
          const fade = Math.max(0, 1 - t * 0.95);
          for (let x = Math.floor(cx - w); x <= cx + w; x++) {
            if (x < 0 || x >= W) continue;
            const d = Math.abs(x - cx) / w;
            if (d >= 1) continue;
            const f = Math.pow(1 - d, 2.6) * fade * strength;
            c.add(x, y, 0.32, 0.82, 0.74, f);
          }
        }
      }

      // drifting marine snow, denser in the light
      for (let i = 0; i < 520; i++) {
        const x = hash2(i, 31, c.seed) * W;
        const y = hash2(i, 37, c.seed) * H;
        const a = 0.05 + hash2(i, 41, c.seed) * 0.26;
        c.glow(x, y, 0.8 + hash2(i, 43, c.seed) * 1.7, hex('#c8f0e6'), a * 0.7, 2);
      }

      // the floor is a suggestion, not a line
      c.glow(W * 0.48, H * 1.04, W * 0.55, hex('#0b3b3a'), 0.26, 2.2);
    }
  },
  {
    name: 'tide',
    seed: 3313,
    paint(c) {
      // 潮汐 —low tide light, thin bands of water stacking up
      c.base([
        [0, hex('#0d1a1f')],
        [0.34, hex('#173035')],
        [0.58, hex('#27494b')],
        [0.60, hex('#2c5150')],
        [0.78, hex('#102528')],
        [1, hex('#061013')]
      ]);
      c.haze(0.035, 170, 29);

      const lx = W * 0.33;
      const ly = H * 0.585;
      c.glow(lx, ly, 420, hex('#cdd9c8'), 0.26, 2.4);
      c.glow(lx, ly, 70, hex('#e6ead8'), 0.34, 2.0);

      // wave lines: each band is a soft sinusoid, thicker as it nears you
      for (let b = 0; b < 26; b++) {
        const base = H * 0.60 + Math.pow(b / 25, 1.5) * H * 0.40;
        const amp = 1.2 + b * 0.28;
        const phase = hash2(b, 3, c.seed) * Math.PI * 2;
        const thick = 0.7 + b * 0.035;
        const alpha = 0.05 + (1 - b / 26) * 0.05;
        for (let x = 0; x < W; x++) {
          const y = base + Math.sin(x * 0.011 + phase + b * 0.4) * amp + Math.sin(x * 0.043 + phase) * 0.7;
          const lit = 0.35 + 0.65 * Math.exp(-Math.pow((x - lx) / (W * 0.45), 2));
          for (let k = -thick; k <= thick; k += 0.5) {
            const a = alpha * lit * (1 - Math.abs(k) / (thick + 0.6));
            c.add(Math.round(x), Math.round(y + k), 0.78, 0.85, 0.78, a);
          }
        }
      }

      // horizon mist
      c.glow(W * 0.5, H * 0.605, W * 0.6, hex('#9db3a8'), 0.10, 3);
    }
  },
  {
    name: 'embers',
    seed: 4421,
    paint(c) {
      // 余烬 —long exposure of sparks leaving a dying fire
      c.base([
        [0, hex('#060404')],
        [0.40, hex('#0b0605')],
        [0.72, hex('#160a05')],
        [1, hex('#1c0c06')]
      ]);
      c.haze(0.035, 160, 41);

      // the fire itself, low and out of frame
      c.glow(W * 0.47, H * 1.08, W * 0.52, hex('#ff5a18'), 0.38, 2.1);
      c.glow(W * 0.47, H * 1.02, W * 0.22, hex('#ffb166'), 0.22, 1.8);

      // sparks: curved, thinning streaks —some near, many far
      for (let i = 0; i < 230; i++) {
        const depth = hash2(i, 201, c.seed);
        const x0 = W * (0.08 + hash2(i, 211, c.seed) * 0.84);
        const y0 = H * (0.58 + hash2(i, 213, c.seed) * 0.52);
        const len = (12 + Math.pow(hash2(i, 217, c.seed), 1.7) * 130) * (0.55 + depth * 0.85);
        const drift = (hash2(i, 219, c.seed) - 0.5) * 1.1;
        const amp = 3 + hash2(i, 223, c.seed) * 16;
        const phase = hash2(i, 227, c.seed) * Math.PI * 2;
        const hot = hash2(i, 229, c.seed);
        const col = hot > 0.88 ? [1, 0.90, 0.66]
          : hot > 0.6 ? [1, 0.66, 0.30]
            : hot > 0.3 ? [1, 0.40, 0.13]
              : [0.72, 0.19, 0.06];
        const baseA = (0.10 + hash2(i, 233, c.seed) * 0.32) * (0.35 + depth * 0.65);
        const r0 = 1.1 + depth * 2.2;

        for (let s = 0; s < len; s++) {
          const f = 1 - s / len;
          const x = x0 + Math.sin(s * 0.022 + phase) * amp * (s / len) + drift * s
            + (hash2(i, Math.floor(s), c.seed + 5) - 0.5) * 0.7;
          const y = y0 - s;
          if (y < 0 || x < 0 || x >= W) break;
          // no hard line: the streak is only ever a run of soft glows
          c.glow(x, y, r0, col, baseA * Math.pow(f, 1.7) * 0.62, 2.0);
        }
        if (hot > 0.55) {
          c.glow(x0, y0, r0 * 2.2, col, baseA * 1.6, 1.6);
        }
      }

      // a handful of bright heads, the ones closest to the lens
      for (let i = 0; i < 46; i++) {
        const x = W * (0.10 + hash2(i, 241, c.seed) * 0.80);
        const y = H * (0.30 + hash2(i, 243, c.seed) * 0.62);
        const a = 0.22 + hash2(i, 247, c.seed) * 0.62;
        c.glow(x, y, 1.4 + hash2(i, 251, c.seed) * 2.6, hex('#ffd39a'), a, 1.7);
        c.glow(x, y, 9 + hash2(i, 253, c.seed) * 16, hex('#ff6a24'), a * 0.14, 2.6);
      }

      // smoke drifting up, catching a little of the light
      for (let y = 0; y < H * 0.62; y++) {
        const t = y / (H * 0.62);
        for (let x = 0; x < W; x++) {
          const n = fbm(x / 240, y / 170 + 3.3, c.seed + 71, 4) - 0.48;
          const a = Math.max(0, n) * 0.26 * (1 - t * 0.3);
          c.add(x, y, 0.30, 0.12, 0.055, a * 0.22);
        }
      }
    }
  },
  {
    name: 'silver',
    seed: 5501,
    paint(c) {
      // 银盐 —a dark room, one window, and the grain in the air
      c.base([
        [0, hex('#111113')],
        [0.45, hex('#0b0b0d')],
        [1, hex('#050506')]
      ]);
      c.haze(0.02, 180, 83);

      const wx = W * 0.255;
      const wy = H * 0.375;
      const hw = W * 0.185;
      const hh = H * 0.275;

      // the window: a soft-edged rectangle of daylight
      const p = c.px;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dx = Math.abs(x - wx) - hw;
          const dy = Math.abs(y - wy) - hh;
          const sd = Math.max(dx, dy);
          const inside = 1 - smooth(clamp01((sd + 1.4) / 2.8));

          if (inside > 0.002) {
            const vy = clamp01((y - (wy - hh)) / (2 * hh));
            const grad = 1.10 - vy * 0.42;
            const drift = 0.94 + 0.06 * Math.sin(x * 0.05 + y * 0.03);
            c.add(x, y, 0.99, 0.95, 0.87, inside * grad * drift);
          }

          // overflow onto the wall, falling off with distance from the frame
          const bleed = Math.exp(-Math.max(0, sd) / 52) * 0.20;
          c.add(x, y, 0.96, 0.88, 0.74, bleed);

          const mull = Math.max(
            Math.exp(-Math.pow((x - wx) / 3.2, 2)),
            Math.exp(-Math.pow((y - wy) / 3.2, 2))
          );
          const frame = Math.exp(-Math.pow((sd + 2.4) / 2.1, 2));
          // stay inside the pane: the bars must not draw shadows on the wall
          const pane = clamp01((2.5 - sd) / 2.5);
          const carve = Math.max(mull * 0.86, frame * 0.5) * pane;
          if (carve > 0.002) {
            const j = (y * W + x) * 3;
            const k = 1 - carve;
            p[j] *= k;
            p[j + 1] *= k;
            p[j + 2] *= k;
          }
        }
      }

      // bloom around the frame —the wall catching the overflow
      c.glow(wx, wy, hw * 3.2, hex('#ffe9c8'), 0.20, 2.6);
      c.glow(wx, wy, hw * 1.6, hex('#fff2da'), 0.10, 2.2);

      // light falling on the floor: a soft parallelogram below the sill
      for (let y = Math.floor(wy + hh); y < H; y++) {
        const t = (y - (wy + hh)) / (H - (wy + hh));
        if (t > 1) break;
        const shift = t * W * 0.18;
        const spread = hw * (1 + t * 0.75);
        const fade = Math.pow(1 - t, 1.35);
        for (let x = 0; x < W; x++) {
          const d = Math.abs(x - (wx + shift)) / spread;
          if (d > 1.8) continue;
          const a = Math.exp(-d * d * 2.4) * fade * 0.20;
          c.add(x, y, 0.98, 0.91, 0.78, a);
        }
      }

      // dust in the beam
      for (let i = 0; i < 340; i++) {
        const x = W * (0.02 + hash2(i, 121, c.seed) * 0.66);
        const y = H * (0.02 + hash2(i, 123, c.seed) * 0.9);
        const a = 0.05 + hash2(i, 127, c.seed) * 0.3;
        c.glow(x, y, 0.7 + hash2(i, 129, c.seed) * 1.7, hex('#fff4da'), a * 0.5, 2);
      }

      // a couple of out-of-focus highlights on the emulsion
      for (let i = 0; i < 9; i++) {
        const x = hash2(i, 91, c.seed) * W;
        const y = hash2(i, 97, c.seed) * H;
        const r = 26 + hash2(i, 101, c.seed) * 70;
        c.glow(x, y, r, hex('#f4f1e8'), 0.025 + hash2(i, 107, c.seed) * 0.045, 2.6);
      }
    }
  },
  {
    name: 'idle',
    seed: 6607,
    paint(c) {
      // 空转 —one record turning on a dark table, nothing playing
      c.base([
        [0, hex('#07070a')],
        [0.44, hex('#0c0c10')],
        [0.52, hex('#0e0e13')],
        [1, hex('#040406')]
      ]);
      c.haze(0.022, 220, 109);

      const cx = W * 0.43;
      const cy = H * 0.515;
      const R = H * 0.475;

      // the light pools on the table before it touches the record
      c.glow(cx - 30, cy - 40, R * 1.7, hex('#463a2a'), 0.16, 2.7);

      const p = c.px;
      for (let y = Math.floor(cy - R - 2); y <= cy + R + 2; y++) {
        if (y < 0 || y >= H) continue;
        for (let x = Math.floor(cx - R - 2); x <= cx + R + 2; x++) {
          if (x < 0 || x >= W) continue;
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > R + 1.6) continue;

          const ang = Math.atan2(dy, dx);
          const edge = clamp01((R - d) / 1.6);

          // grooves, phase-shifted so the rings never look perfectly even
          const groove = 0.5 + 0.5 * Math.cos(d * 1.52 + Math.sin(ang * 2) * 0.35);
          const specAng = Math.pow(Math.max(0, Math.cos(ang + 2.42)), 4.5);
          const specRad = Math.exp(-Math.pow((d / R - 0.58) / 0.42, 2));
          const sheen = specAng * specRad;

          let r = 0.010 + groove * 0.020;
          let g = 0.011 + groove * 0.021;
          let b = 0.014 + groove * 0.026;
          r += sheen * 0.46;
          g += sheen * 0.37;
          b += sheen * 0.26;

          // rim light on the far edge
          const rim = Math.exp(-Math.pow((d - R + 3) / 4.5, 2)) * Math.max(0, Math.cos(ang - 0.55));
          r += rim * 0.13;
          g += rim * 0.115;
          b += rim * 0.10;

          // the label
          if (d < 76) {
            const lt = clamp01(d / 76);
            const lab = [
              mix(0.235, 0.105, lt),
              mix(0.180, 0.078, lt),
              mix(0.125, 0.052, lt)
            ];
            const ring = Math.exp(-Math.pow((d - 62) / 2.2, 2)) * 0.10;
            r = lab[0] + ring;
            g = lab[1] + ring * 0.9;
            b = lab[2] + ring * 0.7;
            // paper texture on the label
            const grain = (hash2(x, y, c.seed + 5) - 0.5) * 0.035;
            r += grain;
            g += grain;
            b += grain;
            if (d < 7) {
              const hole = clamp01(7 - d);
              r = mix(r, 0.005, hole);
              g = mix(g, 0.005, hole);
              b = mix(b, 0.006, hole);
            }
          }

          const j = (y * W + x) * 3;
          p[j] = mix(p[j], r, edge);
          p[j + 1] = mix(p[j + 1], g, edge);
          p[j + 2] = mix(p[j + 2], b, edge);
        }
      }

      // dust hanging in the lamp light
      for (let i = 0; i < 190; i++) {
        const x = hash2(i, 111, c.seed) * W;
        const y = hash2(i, 113, c.seed) * H;
        c.glow(x, y, 0.7 + hash2(i, 117, c.seed) * 1.5, hex('#e8d7b4'), 0.04 + hash2(i, 119, c.seed) * 0.14, 2);
      }
    }
  }
];

/* ------------------------------------------------------------------ run */

fs.mkdirSync(OUT, { recursive: true });
console.log('painting', ROOMS.length, 'covers…');

for (const room of ROOMS) {
  const t0 = Date.now();
  const canvas = new Canvas(room.seed);
  room.paint(canvas);
  canvas.vignette(room.name === 'silver' ? 0.72 : 0.62, 2.1);
  canvas.grain(room.name === 'silver' ? 0.016 : 0.011);
  canvas.tone();

  const png = canvas.toPNG();
  const file = path.join(OUT, `${room.name}.png`);
  fs.writeFileSync(file, png);
  console.log(`  ${room.name}.png  ${(png.length / 1024).toFixed(0)}kb  (${Date.now() - t0}ms)`);
}
