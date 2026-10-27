/* stage.js — the eyes.
   A painted backdrop, a slow disc of dust lit from nowhere in particular,
   and a feedback buffer that turns points into streaks of light.

   Every look is a preset (see presets.js); switching one interpolates the
   whole parameter set over ~600ms. Audio only nudges the result.        */

const BG_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform vec2 uRes;
uniform float uTime;
uniform float uBass;
uniform float uLevel;
uniform float uBeat;

uniform vec3 uTop;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uWarmK;
uniform float uCoolK;
uniform float uGrain;
uniform float uVig;

uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uTan;

uniform vec3 uShaftOrigin;
uniform vec3 uShaftAxis;
uniform float uShaftR;
uniform float uBeam;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // one sheet of grey stock: a whisper of the preset tint, a little darker
  // toward the floor. The CSS grain on body is the fallback under this canvas.
  vec3 paper = vec3(0.118) + uTop * 0.12;
  vec3 col = paper * mix(1.02, 0.90, smoothstep(0.0, 1.0, uv.y));

  // a low lift in the middle so the type has somewhere to sit
  col += uCool * 0.055 * exp(-length(p * vec2(0.85, 1.5)) * 2.3);

  // warm key light, upper left, behind the words
  float d1 = length((p - vec2(-0.14, 0.14)) * vec2(0.72, 1.05));
  col += uWarm * uWarmK * 0.55 * exp(-d1 * 2.8) * (0.72 + 0.75 * uBass);

  // cool fill, lower right
  float d2 = length((p - vec2(0.52, -0.36)) * vec2(0.95, 1.35));
  col += uCool * uCoolK * 0.55 * exp(-d2 * 1.9) * (0.65 + 0.85 * uLevel);

  /* the shaft's own haze: distance between this pixel's view ray and the
     beam axis, so the light has a body even where no dust happens to be */
  vec2 sc = (uv - 0.5) * 2.0;
  vec3 rd = normalize(uCamFwd + uCamRight * sc.x * uTan.x + uCamUp * sc.y * uTan.y);
  vec3 w0 = uCamPos - uShaftOrigin;
  float b = dot(rd, uShaftAxis);
  float dd = dot(rd, w0);
  float e = dot(uShaftAxis, w0);
  float denom = max(1.0 - b * b, 0.0015);
  float tRay = (b * e - dd) / denom;
  float tAxis = (e - b * dd) / denom;
  vec3 pRay = uCamPos + rd * max(tRay, 0.0);
  vec3 pAxis = uShaftOrigin + uShaftAxis * tAxis;
  float beamDist = length(pRay - pAxis);
  float profile = exp(-pow(beamDist / (uShaftR * 1.35), 2.0));
  float along = smoothstep(-3.0, 1.5, tAxis) * (1.0 - smoothstep(8.0, 14.0, tAxis));
  col += mix(uWarm, uCool, 0.25) * uBeam * 0.55 * profile * along * (0.8 + 0.4 * uBass);

  // the room brightens a touch on every beat
  float d3 = length(p * vec2(1.0, 1.3));
  col += mix(uWarm, uCool, 0.45) * 0.028 * exp(-d3 * 6.2) * (0.25 + 1.35 * uBeat);

  // a pool of shadow behind the type, so the words always win
  float pool = smoothstep(0.62, 0.02, length(p * vec2(1.15, 2.55)));
  col *= mix(0.80, 1.0, 1.0 - pool * 0.38);

  // vignette
  float vig = smoothstep(1.55, 0.30, length(p * vec2(0.82, 1.08)));
  col *= mix(clamp(1.0 - 0.22 * uVig, 0.0, 1.0), 1.0, vig);

  // film grain
  float g = hash21(gl_FragCoord.xy * 0.88 + fract(uTime) * 91.3);
  col += (g - 0.5) * uGrain;

  outColor = vec4(max(col, 0.0), 1.0);
}`;

const DUST_VS = `#version 300 es
in vec3 aSeed;
in vec4 aRand;

uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
uniform float uBass;
uniform float uLevel;
uniform float uPulse;
uniform float uDpr;
uniform float uSize;
uniform float uSizeMul;
uniform float uAlphaMul;
uniform float uRadius;
uniform float uHeight;
uniform float uTilt;
uniform float uSwirl;
uniform float uDrift;
uniform float uShaftR;

out float vAlpha;
out float vWarm;
out float vLit;

/* --- simplex noise (Ashima Arts, MIT) ---------------------------------- */
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

/* Divergence-free 2D flow. Neighbouring dust samples the same field, so
   it slides along shared streamlines and gathers into ribbons. */
vec2 curl2(vec2 p) {
  const float e = 0.14;
  float a = snoise(vec3(p.x, 0.0, p.y + e));
  float b = snoise(vec3(p.x, 0.0, p.y - e));
  float c = snoise(vec3(p.x + e, 0.0, p.y));
  float d = snoise(vec3(p.x - e, 0.0, p.y));
  return vec2(a - b, -(c - d)) / (2.0 * e);
}

void main() {
  float t = uTime;
  float r = aRand.x;

  /* three depth layers: 12% near, 48% body, 40% far — the far shell is
     the densest and the stillest, which is what gives the scene depth */
  float layer;
  float radius;
  if (r < 0.12) {
    layer = 0.0;
    radius = mix(0.10, 0.38, r / 0.12) * uRadius;
  } else if (r < 0.60) {
    layer = 1.0;
    radius = mix(0.38, 0.72, (r - 0.12) / 0.48) * uRadius;
  } else {
    layer = 2.0;
    radius = mix(0.72, 1.12, (r - 0.60) / 0.40) * uRadius;
  }

  vec3 base = normalize(aSeed) * radius;
  base.y *= uHeight;

  // a full turn at r=3 takes about two minutes: one particle crosses the
  // frame in roughly half a minute
  float ang = t * (0.055 + 0.020 / max(radius, 0.6)) * uSwirl + r * 6.2831;
  float ca = cos(ang), sa = sin(ang);
  base.xz = mat2(ca, -sa, sa, ca) * base.xz;

  // the field drifts on its own, so the ribbons keep moving even where
  // the dust is nearly stationary
  vec2 q = base.xz * 0.34 + vec2(t * 0.012, t * 0.006);
  vec2 flow = curl2(q);
  vec2 flow2 = curl2(q * 2.70 + vec2(5.2, 1.7));

  float layerDrag = layer < 0.5 ? 1.45 : (layer < 1.5 ? 1.0 : 0.55);
  float amp = (0.42 + 0.10 * uBass) * uDrift * layerDrag;

  vec3 p = base;
  p.x += (flow.x + 0.35 * flow2.x) * amp;
  p.z += (flow.y + 0.35 * flow2.y) * amp;
  p.y += snoise(vec3(base.xz * 0.5, t * 0.05 + aRand.z * 3.0)) * 0.14 * layerDrag;

  // tilt the disc so it reads as a plane seen from slightly above
  float ct = cos(uTilt), st = sin(uTilt);
  p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
  p.y -= 0.18;

  // one outward push per beat, released over 600ms
  p *= 1.0 + uPulse * 0.045 * (0.4 + r);

  // voids — roughly a third of the volume is deliberately left empty
  float dens = snoise(vec3(base.xz * 0.26, 9.7));
  float mask = smoothstep(-0.14, 0.44, dens);

  // the shaft: light at ~25° from vertical, only dust inside it is lit
  vec3 axis = normalize(vec3(0.42, -1.0, 0.18));
  vec3 rel = p - vec3(-0.6, 2.2, 0.3);
  float h = dot(rel, axis);
  float d = length(rel - axis * h);
  float breath = 1.0 + clamp(uBass - 0.28, -0.30, 0.30) * 0.27;
  float beam = 1.0 - smoothstep(uShaftR * 0.30, uShaftR * breath, d);
  beam *= smoothstep(-2.5, 1.0, h) * (1.0 - smoothstep(9.0, 13.0, h));
  float lit = mix(0.12, 1.0, beam);

  vec4 viewPos = uView * vec4(p, 1.0);
  gl_Position = uProj * viewPos;
  float dist = max(-viewPos.z, 0.2);

  // near: big and faint, far: small and still
  float layerSize = layer < 0.5 ? 1.9 : (layer < 1.5 ? 1.0 : 0.46);
  float layerAlpha = layer < 0.5 ? 0.28 : (layer < 1.5 ? 1.0 : 0.78);

  // nine in ten are tiny and dim, one in ten is big and faint
  float tail = pow(aRand.y, 5.0);
  float sz = uSize * uSizeMul * layerSize * (0.45 + 2.2 * tail);
  gl_PointSize = clamp(sz * uDpr / dist, 1.0, 72.0 * uDpr);

  float nearFade = smoothstep(0.45, 2.1, dist);
  float farFade = 1.0 - smoothstep(11.0, 16.0, dist);

  vWarm = clamp(1.28 - radius * 0.17, 0.0, 1.0) + (aRand.w - 0.5) * 0.12;
  vLit = beam;
  vAlpha = mask * lit * layerAlpha * nearFade * farFade
         * (0.55 + 0.45 * aRand.w)
         * (0.45 + 0.55 * uLevel + 0.25 * uPulse)
         * mix(1.0, 0.50, tail)
         * uAlphaMul;
}`;

const DUST_FS = `#version 300 es
precision highp float;
in float vAlpha;
in float vWarm;
in float vLit;
out vec4 outColor;

uniform vec3 uC1;   // cold
uniform vec3 uC2;   // warm
uniform vec3 uC3;   // unused, kept so presets stay compatible
uniform float uLevel;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;

  // a soft, slightly gaussian falloff: no hard core, nothing overexposed
  float a = pow(1.0 - r, 2.4);

  vec3 col = mix(uC1, uC2, clamp(vWarm, 0.0, 1.0));
  // dust inside the shaft catches a little more light than the rest
  col *= 0.78 + 0.42 * vLit;

  float alpha = a * vAlpha;
  outColor = vec4(col * alpha, alpha);
}`;

const TEX_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const TEX_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uDecay;
void main() {
  vec3 c = texture(uTex, vUv).rgb * uDecay;
  outColor = vec4(c, 1.0);
}`;

/* The shaft of light: one definition, used by both the dust and the room.
   Roughly 25 degrees off vertical, entering above the disc. */
const SHAFT_ORIGIN = [-0.6, 2.2, 0.3];
const SHAFT_DIR = [0.42, -1.0, 0.18];
const SHAFT_LEN = Math.hypot(SHAFT_DIR[0], SHAFT_DIR[1], SHAFT_DIR[2]);
const SHAFT_AXIS = SHAFT_DIR.map((v) => v / SHAFT_LEN);

/* --- tiny mat4 (column-major, gl-matrix compatible) -------------------- */

export const mat4 = {
  create: () => new Float32Array(16),

  perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
    return out;
  },

  lookAt(out, eye, center, up) {
    let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    let len = Math.hypot(z0, z1, z2) || 1;
    z0 /= len; z1 /= len; z2 /= len;

    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    len = Math.hypot(x0, x1, x2);
    if (!len) { x0 = 1; x1 = 0; x2 = 0; } else { x0 /= len; x1 /= len; x2 /= len; }

    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;

    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
    out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
    out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
    out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    out[15] = 1;
    return out;
  }
};

/* --- helpers ----------------------------------------------------------- */

/** Interpolate every number and number[] inside `b` into `target`. */
function lerpTree(target, a, b, t) {
  for (const key in b) {
    const av = a[key];
    const bv = b[key];
    if (typeof bv === 'number') {
      target[key] = av + (bv - av) * t;
    } else if (Array.isArray(bv)) {
      const out = target[key] || (target[key] = []);
      for (let i = 0; i < bv.length; i++) out[i] = av[i] + (bv[i] - av[i]) * t;
    } else {
      target[key] = target[key] || {};
      lerpTree(target[key], av, bv, t);
    }
  }
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* --- renderer ---------------------------------------------------------- */

export class Stage {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.gl = null;
    this.ok = false;
    this.dpr = 1;
    this.width = 1;
    this.height = 1;
    this.time = 0;
    this.orbitPhase = 0;
    this.pitchPhase = 0;
    this.pulse = 0;
    this._lastBeat = 0;

    this.scale = opts.scale || 1;
    this.dustOn = opts.dust !== false;
    this.capacity = Math.max(2000, Math.round(40000 * this.scale));

    this.cur = structuredClone(opts.params);
    this.pFrom = structuredClone(opts.params);
    this.pTo = structuredClone(opts.params);
    this.pT = 1;
    this.pDur = 0.6;

    this.cam = {
      dist: 6.6,
      parallax: [0, 0],
      targetParallax: [0, 0]
    };

    this._proj = mat4.create();
    this._view = mat4.create();
    this._eye = new Float32Array([0, 0, 0]);

    this._onResize = () => this.resize();
  }

  /** Swap the whole look. Numbers interpolate; nothing is rebuilt. */
  setPreset(params, duration = 0.6) {
    this.pFrom = structuredClone(this.cur);
    this.pTo = structuredClone(params);
    this.pT = 0;
    this.pDur = Math.max(0.1, duration);
  }

  get transitioning() {
    return this.pT < 1;
  }

  init() {
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    });
    if (!gl) return false;

    this.gl = gl;

    const bg = this._program(BG_VS, BG_FS);
    const dust = this._program(DUST_VS, DUST_FS);
    const tex = this._program(TEX_VS, TEX_FS);
    if (!bg || !dust || !tex) return false;

    this.bg = bg;
    this.dust = dust;
    this.tex = tex;

    this.trail = [null, null];
    this.trailFbo = [null, null];
    this.trailCur = 0;

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.quad = quad;

    this._buildDust();

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ok = false;
    });
    this.canvas.addEventListener('webglcontextrestored', () => this.init());

    window.addEventListener('resize', this._onResize);
    this.resize();
    this.ok = true;
    return true;
  }

  _program(vsSource, fsSource) {
    const gl = this.gl;
    const vs = this._shader(gl.VERTEX_SHADER, vsSource);
    const fs = this._shader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[nocturne] link:', gl.getProgramInfoLog(program));
      return null;
    }

    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms };
  }

  _shader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[nocturne] shader:', gl.getShaderInfoLog(shader), source.slice(0, 400));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /** The buffer always holds the maximum density; a preset draws a slice. */
  _buildDust() {
    const gl = this.gl;
    const count = this.capacity;
    const data = new Float32Array(count * 7);

    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);

      const o = i * 7;
      data[o] = s * Math.cos(theta);
      data[o + 1] = u;
      data[o + 2] = s * Math.sin(theta);
      data[o + 3] = Math.random();
      data[o + 4] = Math.random();
      data[o + 5] = Math.random();
      data[o + 6] = Math.pow(Math.random(), 1.6);
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.dustBuffer = buffer;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    const stride = 7 * 4;
    const seedLoc = gl.getAttribLocation(this.dust.program, 'aSeed');
    const randLoc = gl.getAttribLocation(this.dust.program, 'aRand');
    gl.enableVertexAttribArray(seedLoc);
    gl.vertexAttribPointer(seedLoc, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(randLoc);
    gl.vertexAttribPointer(randLoc, 4, gl.FLOAT, false, stride, 3 * 4);

    gl.bindVertexArray(null);
    this.dustVao = vao;
  }

  resize() {
    if (!this.gl) return;
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (w === this.width && h === this.height) return;

    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    gl.viewport(0, 0, w, h);
    this._buildTrail();
  }

  /* Feedback buffer: every frame is faded a little before the new dust is
     drawn on top, which turns points into short streaks of light. */
  _buildTrail() {
    const gl = this.gl;
    for (let i = 0; i < 2; i++) {
      if (this.trailFbo[i]) gl.deleteFramebuffer(this.trailFbo[i]);
      if (this.trail[i]) gl.deleteTexture(this.trail[i]);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      this.trail[i] = tex;
      this.trailFbo[i] = fbo;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _quad(program) {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Mouse parallax target, -1..1. */
  look(x, y) {
    this.cam.targetParallax[0] = x;
    this.cam.targetParallax[1] = y;
  }

  _clearTrail() {
    const gl = this.gl;
    if (!gl) return;
    for (let i = 0; i < 2; i++) {
      if (!this.trailFbo[i]) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFbo[i]);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** The heart is the centrepiece now; the old dust field can stand down.
      Turning it back on starts from a clean buffer, not a ghost of streaks. */
  setDust(on) {
    const next = !!on;
    if (next === this.dustOn) return;
    this.dustOn = next;
    if (!next) this._clearTrail();
  }

  _advance(dt) {
    if (this.pT < 1) {
      this.pT = Math.min(1, this.pT + dt / this.pDur);
      lerpTree(this.cur, this.pFrom, this.pTo, easeInOut(this.pT));
    }
  }

  render(dt, audio) {
    if (!this.ok) return;
    const gl = this.gl;
    this.time += dt;
    this._advance(dt);

    // one impulse per beat, released over 600ms — never a per-frame chase
    if (audio.beat > this._lastBeat + 0.3) this.pulse = 1;
    this._lastBeat = audio.beat;
    this.pulse = Math.max(0, this.pulse - dt / 0.6);

    const cur = this.cur;
    const motion = cur.motion;

    this.orbitPhase += dt * 0.019 * motion.orbit;
    this.pitchPhase += dt * 0.11 * (0.5 + motion.orbit * 0.5);

    const cam = this.cam;
    const targetDist = 6.5 - audio.bass * 0.55 * motion.dolly - audio.beat * 0.35 * motion.dolly;
    const ease = 1 - Math.exp(-dt * 1.6);
    cam.dist += (targetDist - cam.dist) * ease;

    const pEase = 1 - Math.exp(-dt * 2.2);
    cam.parallax[0] += (cam.targetParallax[0] - cam.parallax[0]) * pEase;
    cam.parallax[1] += (cam.targetParallax[1] - cam.parallax[1]) * pEase;

    const yaw = 0.35 + this.orbitPhase + cam.parallax[0] * 0.18 * motion.parallax;
    const pitch = 0.16 + Math.sin(this.pitchPhase) * 0.03 + cam.parallax[1] * 0.11 * motion.parallax;
    const d = cam.dist;

    const eye = this._eye;
    eye[0] = Math.sin(yaw) * Math.cos(pitch) * d;
    eye[1] = Math.sin(pitch) * d;
    eye[2] = Math.cos(yaw) * Math.cos(pitch) * d;

    mat4.perspective(this._proj, (44 * Math.PI) / 180, this.width / this.height, 0.1, 60);
    mat4.lookAt(this._view, eye, [0, 0, 0], [0, 1, 0]);

    const drawn = Math.max(500, Math.round(cur.dust.count * this.scale));
    const shaftR = 1.05 + cur.dust.radius * 0.26;

    const curTex = this.trailCur;
    const prevTex = 1 - curTex;

    // --- pass 1: fade yesterday's light into today's buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFbo[curTex]);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.tex.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trail[prevTex]);
    gl.uniform1i(this.tex.uniforms.uTex, 0);
    gl.uniform1f(this.tex.uniforms.uDecay, cur.dust.trail);
    this._quad(this.tex.program);

    // --- pass 2: the dust, additively, on top of the trail
    if (this.dustOn) {
      const dust = this.dust;
      const u = dust.uniforms;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(dust.program);
      gl.bindVertexArray(this.dustVao);

      gl.uniformMatrix4fv(u.uProj, false, this._proj);
      gl.uniformMatrix4fv(u.uView, false, this._view);
      gl.uniform1f(u.uTime, this.time);
      gl.uniform1f(u.uBass, audio.bass);
      gl.uniform1f(u.uLevel, audio.level);
      gl.uniform1f(u.uPulse, this.pulse);
      gl.uniform1f(u.uDpr, this.dpr);
      gl.uniform1f(u.uSize, cur.dust.size);
      gl.uniform1f(u.uRadius, cur.dust.radius);
      gl.uniform1f(u.uHeight, cur.dust.height);
      gl.uniform1f(u.uTilt, cur.dust.tilt);
      gl.uniform1f(u.uSwirl, cur.dust.swirl);
      gl.uniform1f(u.uDrift, cur.dust.drift);
      gl.uniform1f(u.uShaftR, shaftR);
      gl.uniform3f(u.uC1, cur.c1[0], cur.c1[1], cur.c1[2]);
      gl.uniform3f(u.uC2, cur.c2[0], cur.c2[1], cur.c2[2]);
      gl.uniform3f(u.uC3, cur.c3[0], cur.c3[1], cur.c3[2]);

      gl.uniform1f(u.uSizeMul, 1.0);
      gl.uniform1f(u.uAlphaMul, 1.0);
      gl.drawArrays(gl.POINTS, 0, drawn);
    }

    gl.bindVertexArray(null);

    // --- pass 3: the room, straight to the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.008, 0.010, 0.018, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const bg = this.bg;
    const bgu = bg.uniforms;
    gl.disable(gl.BLEND);
    gl.useProgram(bg.program);
    gl.uniform2f(bgu.uRes, this.width, this.height);
    gl.uniform1f(bgu.uTime, this.time);
    gl.uniform1f(bgu.uBass, audio.bass);
    gl.uniform1f(bgu.uLevel, audio.level);
    gl.uniform1f(bgu.uBeat, audio.beat);
    gl.uniform3f(bgu.uTop, cur.top[0], cur.top[1], cur.top[2]);
    gl.uniform3f(bgu.uWarm, cur.warm[0], cur.warm[1], cur.warm[2]);
    gl.uniform3f(bgu.uCool, cur.cool[0], cur.cool[1], cur.cool[2]);
    gl.uniform1f(bgu.uWarmK, cur.light.warmK);
    gl.uniform1f(bgu.uCoolK, cur.light.coolK);
    gl.uniform1f(bgu.uGrain, cur.light.grain);
    gl.uniform1f(bgu.uVig, cur.light.vig);

    // camera basis, so the backdrop can trace the same shaft the dust sits in
    const v = this._view;
    const aspect = this.width / this.height;
    const tanY = Math.tan((44 * Math.PI) / 180 / 2);
    gl.uniform3f(bgu.uCamPos, eye[0], eye[1], eye[2]);
    gl.uniform3f(bgu.uCamRight, v[0], v[4], v[8]);
    gl.uniform3f(bgu.uCamUp, v[1], v[5], v[9]);
    gl.uniform3f(bgu.uCamFwd, -v[2], -v[6], -v[10]);
    gl.uniform2f(bgu.uTan, tanY * aspect, tanY);
    gl.uniform3f(bgu.uShaftOrigin, SHAFT_ORIGIN[0], SHAFT_ORIGIN[1], SHAFT_ORIGIN[2]);
    gl.uniform3f(bgu.uShaftAxis, SHAFT_AXIS[0], SHAFT_AXIS[1], SHAFT_AXIS[2]);
    gl.uniform1f(bgu.uShaftR, shaftR);
    gl.uniform1f(bgu.uBeam, 0.36 * cur.light.warmK);
    this._quad(bg.program);

    // --- pass 4: composite the light back over it
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.tex.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trail[curTex]);
    gl.uniform1i(this.tex.uniforms.uTex, 0);
    gl.uniform1f(this.tex.uniforms.uDecay, 1.0);
    this._quad(this.tex.program);

    this.trailCur = prevTex;
  }
}
