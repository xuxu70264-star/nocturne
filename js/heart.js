/* heart.js — Taubin's implicit heart, solved into a point cloud and lit like a
   printed halftone. The shape is baked once on load: for every cell of an
   (x, z) grid we ask "how thick is the heart here?" and bisect the surface,
   which gives a pair of points (±y). Normals come straight from ∇F, which is
   what lets the front catch light and the back disappear.

   Everything after that is per-frame: rotate each radial ring with a little
   elastic lag, project through a perspective camera, draw one point sprite.

   On top of the reference idea, this one listens: the bass breathes the
   whole heart, a beat throws a ring of displacement outward from the centre,
   and highs make the dots shimmer. Grab it and it coasts on its own momentum.
*/

const A = 2.25;          // 9/4
const B = 0.1125;        // 9/80
const LIGHT = (() => {
  const l = [-0.35, 0.5, 0.74];
  const n = Math.hypot(l[0], l[1], l[2]);
  return [l[0] / n, l[1] / n, l[2] / n];
})();

const BANDS = 24;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function surf(x, t, z) {
  const Q = x * x + A * t + z * z - 1;
  return Q * Q * Q - z * z * z * (x * x + B * t);
}

const VERT = `#version 300 es
precision highp float;

in vec3 aPos;
in vec3 aNormal;
in float aBand;
in float aSeed;

uniform float uBandK[${BANDS}];
uniform float uPitch;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uFit;
uniform float uFocal;
uniform float uScale;
uniform float uWaveR;
uniform float uWaveAmp;
uniform float uBass;
uniform float uHigh;
uniform float uTime;
uniform float uOpacity;
uniform float uDpr;
uniform vec3 uLight;

out float vAlpha;

void main() {
  int bi = int(aBand);
  float k = uBandK[bi];
  float ck = cos(k);
  float sk = sin(k);

  // yaw for this ring
  float xr = aPos.x * ck + aPos.z * sk;
  float zr = -aPos.x * sk + aPos.z * ck;
  float yr = aPos.y;

  // pitch (whole cloud)
  float cp = cos(uPitch);
  float sp = sin(uPitch);
  float y2 = yr * cp - zr * sp;
  float z2 = yr * sp + zr * cp;

  // the normal turns with the point
  float nxr = aNormal.x * ck + aNormal.z * sk;
  float nzr = -aNormal.x * sk + aNormal.z * ck;
  float ny2 = aNormal.y * cp - nzr * sp;
  float nz2 = aNormal.y * sp + nzr * cp;

  // back faces are simply not printed
  if (nz2 < 0.02) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    return;
  }

  float depth = z2 * uFit;
  float persp = min(1.7, uFocal / (uFocal - depth));

  vec2 screen = uCenter + vec2(xr, -y2) * uFit * persp;
  vec2 dir = screen - uCenter;

  // the heartbeat: scale from the centre
  screen = uCenter + dir * uScale;

  // the pulse ring: a beat travels outward through the dots
  float sr = length(dir) / (uFit * 1.05);
  float wave = exp(-pow((sr - uWaveR) / 0.16, 2.0)) * uWaveAmp;
  screen += normalize(dir + vec2(1e-4)) * wave * uFit * 0.075;

  float zd = clamp(0.5 + z2 * 0.5, 0.0, 1.0);
  float lam = 0.32 + 0.6 * max(0.0, nxr * uLight.x + ny2 * uLight.y + nz2 * uLight.z);
  float tier = lam < 0.26 ? 0.42 : (lam > 0.62 ? 1.0 : 0.68);

  // size only ever tracks depth (the halftone rule); the bass and the wave
  // are allowed to nudge it, the light is not
  float rad = min(2.9, persp) * (0.50 + zd * 1.30);
  rad *= 1.0 + 0.50 * uBass + 0.85 * wave;
  rad *= 1.0 + 0.08 * sin(uTime * 1.7 + aSeed * 6.2831) * uHigh;

  float alpha = min(0.95, tier * (0.62 + 0.40 * zd)) * uOpacity;
  alpha *= 0.82 + 0.36 * uBass;
  alpha += 0.34 * wave;
  alpha = min(alpha, 0.92);

  vec2 ndc = vec2(screen.x / uRes.x * 2.0 - 1.0, 1.0 - screen.y / uRes.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = max(1.0, rad * 2.0 * uDpr);
  vAlpha = alpha;
}
`;

const FRAG = `#version 300 es
precision mediump float;

in float vAlpha;
uniform vec3 uColor;
out vec4 outColor;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.30, d) * vAlpha;
  if (a < 0.004) discard;
  outColor = vec4(uColor, a);
}
`;

export class Heart {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.ok = false;
    this.enabled = opts.enabled !== false;
    this.presence = 0.78;
    this._presence = 0.78;

    this.time = 0;
    this.yaw = 0.55;
    this.spin = this.reduced ? 0 : 0.10;
    this.pitch = 0.14;
    this.yawBase = 0.55;

    this.bass = 0;
    this.level = 0;
    this.beatEnv = 0;
    this.beatSlow = 0;
    this.waveR = 2;
    this.waveAmp = 0;
    this._lastWave = -10;

    this.color = [0.91, 0.79, 0.63];
    this._colorTick = 0;

    this.bandK = new Float64Array(BANDS);
    this.bandRate = new Float64Array(BANDS);
    for (let b = 0; b < BANDS; b++) {
      this.bandRate[b] = 1 / (0.72 - 0.38 * (b / BANDS));
    }

    this._drag = null;
    this._pointer = (e) => {
      if (e.type === 'pointerdown') {
        if (!this.enabled) return;
        this._drag = { x: e.clientX };
        this.canvas.classList.add('is-drag');
        try { this.canvas.setPointerCapture?.(e.pointerId); } catch {}
      } else if (e.type === 'pointermove' && this._drag) {
        const dx = e.clientX - this._drag.x;
        this._drag.x = e.clientX;
        this.spin = clamp(this.spin + dx * 0.05, -18, 18);
      } else if (this._drag) {
        this._drag = null;
        this.canvas.classList.remove('is-drag');
      }
    };

    this._build();
    this._initGL();

    if (this.ok) {
      this.canvas.addEventListener('pointerdown', this._pointer);
      this.canvas.addEventListener('pointermove', this._pointer);
      this.canvas.addEventListener('pointerup', this._pointer);
      this.canvas.addEventListener('pointercancel', this._pointer);
      this._onResize = () => this._resize();
      window.addEventListener('resize', this._onResize);
      this._resize();
    } else {
      this.canvas.hidden = true;
    }

    if (this.ok && !this.enabled) this.canvas.hidden = true;
  }

  /* ---------------------------------------------------------- geometry */

  _build() {
    const mobile = Math.min(window.innerWidth, window.innerHeight) < 1024;
    const NX = mobile ? 84 : 126;
    const NZ = mobile ? 100 : 150;
    const X0 = -1.35;
    const X1 = 1.35;
    const Z0 = -1.15;
    const Z1 = 1.45;

    const px = [];
    const py = [];
    const pz = [];
    const nxA = [];
    const nyA = [];
    const nzA = [];

    for (let i = 0; i < NX; i++) {
      const x = X0 + ((X1 - X0) * i) / (NX - 1);
      for (let j = 0; j < NZ; j++) {
        const z = Z0 + ((Z1 - Z0) * j) / (NZ - 1);
        if (surf(x, 0, z) >= 0) continue;

        let a = 0;
        let b = 0;
        let found = false;
        for (let s = 1; s <= 150; s++) {
          const t2 = s / 150;
          if (surf(x, t2, z) >= 0) {
            a = (s - 1) / 150;
            b = t2;
            found = true;
            break;
          }
        }
        if (!found) continue;

        for (let k = 0; k < 22; k++) {
          const m = (a + b) / 2;
          if (surf(x, m, z) < 0) a = m;
          else b = m;
        }
        const t = (a + b) / 2;
        const y = Math.sqrt(t);
        const Q = x * x + A * t + z * z - 1;
        const Q2 = Q * Q;
        const gx = 2 * x * (3 * Q2 - z * z * z);
        const gz = 6 * z * Q2 - 3 * z * z * (x * x + B * t);
        const gy = y * (13.5 * Q2 - 0.225 * z * z * z);

        for (const sign of [1, -1]) {
          px.push(x);
          py.push(z);
          pz.push(sign * y);
          nxA.push(gx);
          nyA.push(gz);
          nzA.push(sign * gy);
        }
      }
    }

    const n = px.length;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < n; k++) {
      cx += px[k];
      cy += py[k];
      cz += pz[k];
    }
    cx /= n;
    cy /= n;
    cz /= n;

    let ext = 1e-6;
    let maxR = 1e-6;
    for (let k = 0; k < n; k++) {
      px[k] -= cx;
      py[k] -= cy;
      pz[k] -= cz;
      ext = Math.max(ext, Math.abs(px[k]), Math.abs(py[k]), Math.abs(pz[k]));
      maxR = Math.max(maxR, Math.hypot(px[k], pz[k]));
    }

    const data = new Float32Array(n * 8);
    for (let k = 0; k < n; k++) {
      const nl = Math.hypot(nxA[k], nyA[k], nzA[k]) || 1;
      const band = Math.min(BANDS - 1, (((Math.hypot(px[k], pz[k]) / maxR) * BANDS) | 0));
      const o = k * 8;
      data[o] = px[k] / ext;
      data[o + 1] = py[k] / ext;
      data[o + 2] = pz[k] / ext;
      data[o + 3] = nxA[k] / nl;
      data[o + 4] = nyA[k] / nl;
      data[o + 5] = nzA[k] / nl;
      data[o + 6] = band;
      data[o + 7] = Math.random();
    }

    this.data = data;
    this.count = n;
  }

  /* ---------------------------------------------------------------- gl */

  _compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[nocturne] heart shader:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  _initGL() {
    if (!this.canvas || !this.data) return;
    try {
      const gl = this.canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
        depth: false,
        powerPreference: 'low-power'
      });
      if (!gl) return;

      const vs = this._compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = this._compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;

      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('[nocturne] heart link:', gl.getProgramInfoLog(prog));
        return;
      }

      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.STATIC_DRAW);

      const stride = 8 * 4;
      const attr = (name, size, offset) => {
        const loc = gl.getAttribLocation(prog, name);
        if (loc < 0) return;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      };
      attr('aPos', 3, 0);
      attr('aNormal', 3, 12);
      attr('aBand', 1, 24);
      attr('aSeed', 1, 28);

      this.gl = gl;
      this.program = prog;
      this.vao = vao;
      this.u = {
        bandK: gl.getUniformLocation(prog, 'uBandK'),
        pitch: gl.getUniformLocation(prog, 'uPitch'),
        res: gl.getUniformLocation(prog, 'uRes'),
        center: gl.getUniformLocation(prog, 'uCenter'),
        fit: gl.getUniformLocation(prog, 'uFit'),
        focal: gl.getUniformLocation(prog, 'uFocal'),
        scale: gl.getUniformLocation(prog, 'uScale'),
        waveR: gl.getUniformLocation(prog, 'uWaveR'),
        waveAmp: gl.getUniformLocation(prog, 'uWaveAmp'),
        bass: gl.getUniformLocation(prog, 'uBass'),
        high: gl.getUniformLocation(prog, 'uHigh'),
        time: gl.getUniformLocation(prog, 'uTime'),
        opacity: gl.getUniformLocation(prog, 'uOpacity'),
        dpr: gl.getUniformLocation(prog, 'uDpr'),
        light: gl.getUniformLocation(prog, 'uLight'),
        color: gl.getUniformLocation(prog, 'uColor')
      };

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.ok = true;
    } catch (err) {
      console.warn('[nocturne] heart:', err);
      this.ok = false;
    }
  }

  _resize() {
    if (!this.ok) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;
    const w = Math.round(W * dpr);
    const h = Math.round(H * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    // a heart that frames the lyrics without swallowing them
    const portrait = W / H < 0.75;
    this.fit = portrait ? Math.min(W * 0.48, H * 0.29) : Math.min(W * 0.285, H * 0.375);
    this.cx = W / 2;
    this.cy = H * 0.445;
  }

  /* ------------------------------------------------------------- public */

  setEnabled(on) {
    this.enabled = !!on && this.ok;
    this.canvas.hidden = !this.enabled;
    if (!this.enabled) this.canvas.classList.remove('is-drag');
  }

  /** screen-space heart, a little larger than the dots, for masking the wake */
  silhouette() {
    if (!this.ok || !this.enabled) return null;
    const portrait = this.W / this.H < 0.75;
    return {
      x: this.cx,
      y: this.cy + this.fit * (portrait ? 0.06 : 0.10),
      w: this.fit * (portrait ? 1.95 : 1.84),
      h: this.fit * (portrait ? 2.55 : 1.95)
    };
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setPresence(p) {
    this.presence = clamp(p, 0, 1);
  }

  /** a beat thrown by the player itself (track change, enter) */
  kick(strength = 1) {
    this.spin = clamp(this.spin + 0.45 * strength, -18, 18);
    this.waveR = 0;
    this.waveAmp = Math.max(this.waveAmp, 0.55 * strength);
    this._lastWave = this.time;
  }

  /** hex or rgb(...) → [r,g,b] 0..1 */
  _parseColor(raw) {
    if (!raw) return null;
    const tuple = raw.match(/rgba?\(([^)]+)\)/i);
    if (tuple) {
      const [r, g, b] = tuple[1].split(/[\s,/]+/).map(Number);
      return [r, g, b].every(Number.isFinite) ? [r / 255, g / 255, b / 255] : null;
    }
    let hex = raw.replace('#', '');
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255
    ];
  }

  _readColor() {
    const cs = getComputedStyle(document.documentElement);
    const accent = this._parseColor(cs.getPropertyValue('--accent').trim());
    const paper = this._parseColor(cs.getPropertyValue('--paper').trim());
    if (!accent && !paper) return;

    // printed dots sit between the preset accent and the paper's cream:
    // bright enough to read on grey stock, still tinted by the room
    const a = accent || paper;
    const p = paper || accent;
    this.color = [
      a[0] * 0.55 + p[0] * 0.45,
      a[1] * 0.55 + p[1] * 0.45,
      a[2] * 0.55 + p[2] * 0.45
    ];
  }

  /* ------------------------------------------------------------- frame */

  render(dt, audio = {}) {
    if (!this.ok || !this.enabled) return;

    dt = Math.min(0.05, Math.max(0, dt));
    this.time += dt;

    // colour follows the preset
    if ((this._colorTick = (this._colorTick + 1) % 45) === 0) this._readColor();

    const bass = audio.bass || 0;
    const high = audio.high || 0;
    const level = audio.level || 0;

    this.bass += (bass - this.bass) * Math.min(1, dt * 8);
    this.level += (level - this.level) * Math.min(1, dt * 5);

    const beat = audio.beat || 0;
    this.beatEnv = Math.max(this.beatEnv * Math.exp(-dt * 5.0), beat);
    this.beatSlow = Math.max(this.beatSlow * Math.exp(-dt * 2.2), beat);

    // one wave per beat, if the last one has had room to travel
    if (beat > 0.82 && this.time - this._lastWave > 0.38) {
      this._lastWave = this.time;
      this.waveR = 0;
      this.waveAmp = 0.45 + 0.55 * this.level;
    }
    this.waveR += dt * 1.15;
    if (this.waveR > 1.9) this.waveAmp = 0;

    if (!this.reduced) {
      this.spin *= Math.exp(-dt / 2.0);
      this.yaw += this.spin * dt;
      // after a throw has bled off, drift back to the three-quarter view
      const targetYaw = this.yawBase + 0.10 * Math.sin(this.time * 0.16);
      if (Math.abs(this.spin) < 0.16) {
        this.yaw += (targetYaw - this.yaw) * Math.min(1, dt * 0.9);
      }
      const target = 0.14 + 0.04 * Math.sin(this.time * 0.35);
      this.pitch += (target - this.pitch) * Math.min(1, dt * 4);
    } else {
      this.yaw += this.spin * dt;
    }

    for (let b = 0; b < BANDS; b++) {
      const target = this.yaw;
      if (this.reduced) this.bandK[b] = target;
      else this.bandK[b] += (target - this.bandK[b]) * Math.min(1, dt * this.bandRate[b]);
    }

    const scale = 1 + 0.040 * this.bass + 0.065 * this.beatEnv + 0.030 * this.beatSlow
      + (this.reduced ? 0 : 0.006 * Math.sin(this.time * 0.9));

    this._presence += (this.presence - this._presence) * Math.min(1, dt * 2.4);

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform1fv(this.u.bandK, this.bandK);
    gl.uniform1f(this.u.pitch, this.pitch);
    gl.uniform2f(this.u.res, this.W, this.H);
    gl.uniform2f(this.u.center, this.cx, this.cy);
    gl.uniform1f(this.u.fit, this.fit);
    gl.uniform1f(this.u.focal, 1500);
    gl.uniform1f(this.u.scale, scale);
    gl.uniform1f(this.u.waveR, this.waveR);
    gl.uniform1f(this.u.waveAmp, this.waveAmp);
    gl.uniform1f(this.u.bass, this.bass);
    gl.uniform1f(this.u.high, high);
    gl.uniform1f(this.u.time, this.time);
    gl.uniform1f(this.u.opacity, this._presence);
    gl.uniform1f(this.u.dpr, this.dpr);
    gl.uniform3fv(this.u.light, LIGHT);
    gl.uniform3fv(this.u.color, this.color);

    gl.drawArrays(gl.POINTS, 0, this.count);
  }
}
