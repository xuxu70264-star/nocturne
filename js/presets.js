/* presets.js — four rooms, one stage.
   Every number here is interpolated over 600ms when you switch, so the
   room changes but the song never stops. Add a fifth preset and it shows
   up in the UI on its own.                                             */

export const PRESETS = [
  {
    id: 'nocturne',
    name: '夜航',
    note: '暖金 · 尘埃',
    stage: {
      dust: { count: 30000, size: 20, radius: 4.6, height: 0.55, tilt: 0.30, swirl: 1.0, drift: 1.0, trail: 0.66 },
      motion: { orbit: 1.0, parallax: 1.0, dolly: 1.0 },
      light: { warmK: 0.165, coolK: 0.200, grain: 0.020, vig: 1.0 },
      c1: [0.46, 0.63, 0.90],
      c2: [1.00, 0.78, 0.53],
      c3: [1.00, 0.94, 0.86],
      warm: [0.42, 0.26, 0.13],
      cool: [0.09, 0.16, 0.30],
      top: [0.031, 0.040, 0.062]
    },
    css: {
      paper: '#f3ece2',
      paperDim: 'rgba(243, 236, 226, 0.42)',
      accent: '#e8c9a2',
      lyricScale: 1,
      lyricTrack: 1,
      lyricGlow: 0.18,
      veil: 0.82
    }
  },

  {
    id: 'abyss',
    name: '深海',
    note: '青蓝 · 长拖影',
    stage: {
      dust: { count: 34000, size: 14, radius: 5.4, height: 0.42, tilt: 0.16, swirl: 0.55, drift: 1.35, trail: 0.82 },
      motion: { orbit: 0.55, parallax: 0.8, dolly: 0.7 },
      light: { warmK: 0.06, coolK: 0.30, grain: 0.014, vig: 1.1 },
      c1: [0.30, 0.72, 0.86],
      c2: [0.26, 0.42, 0.98],
      c3: [0.80, 0.98, 1.00],
      warm: [0.10, 0.28, 0.42],
      cool: [0.06, 0.22, 0.48],
      top: [0.014, 0.036, 0.058]
    },
    css: {
      paper: '#e8f4ff',
      paperDim: 'rgba(200, 232, 255, 0.42)',
      accent: '#8fd4ea',
      lyricScale: 0.94,
      lyricTrack: 1.12,
      lyricGlow: 0.10,
      veil: 0.90
    }
  },

  {
    id: 'ember',
    name: '余烬',
    note: '赤金 · 大颗粒',
    stage: {
      dust: { count: 18000, size: 30, radius: 4.0, height: 0.62, tilt: 0.38, swirl: 1.35, drift: 0.8, trail: 0.55 },
      motion: { orbit: 1.35, parallax: 1.15, dolly: 1.3 },
      light: { warmK: 0.24, coolK: 0.09, grain: 0.024, vig: 1.12 },
      c1: [1.00, 0.52, 0.26],
      c2: [1.00, 0.28, 0.18],
      c3: [1.00, 0.88, 0.62],
      warm: [0.62, 0.22, 0.10],
      cool: [0.16, 0.08, 0.16],
      top: [0.052, 0.020, 0.014]
    },
    css: {
      paper: '#f8e7d6',
      paperDim: 'rgba(248, 231, 214, 0.42)',
      accent: '#ff9a5c',
      lyricScale: 1.04,
      lyricTrack: 0.94,
      lyricGlow: 0.30,
      veil: 0.74
    }
  },

  {
    id: 'halide',
    name: '银盐',
    note: '黑白 · 重颗粒',
    stage: {
      dust: { count: 22000, size: 20, radius: 3.9, height: 0.50, tilt: 0.26, swirl: 0.75, drift: 0.9, trail: 0.50 },
      motion: { orbit: 0.8, parallax: 1.0, dolly: 0.9 },
      light: { warmK: 0.08, coolK: 0.22, grain: 0.042, vig: 0.95 },
      c1: [0.86, 0.88, 0.90],
      c2: [0.62, 0.65, 0.70],
      c3: [1.00, 1.00, 1.00],
      warm: [0.16, 0.16, 0.17],
      cool: [0.10, 0.11, 0.13],
      top: [0.050, 0.050, 0.054]
    },
    css: {
      paper: '#ffffff',
      paperDim: 'rgba(255, 255, 255, 0.40)',
      accent: '#d8d8d8',
      lyricScale: 1.0,
      lyricTrack: 1.2,
      lyricGlow: 0.0,
      veil: 0.80
    }
  }
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}
