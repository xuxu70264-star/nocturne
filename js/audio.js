/* audio.js — the ears.
   Wraps <audio> in a Web Audio graph and turns the spectrum into
   a few slow, smoothed numbers the visuals can dance to.        */

const FFT_SIZE = 2048;

export class AudioEngine {
  constructor(audioEl) {
    this.el = audioEl;
    this.ctx = null;
    this.analyser = null;
    this.gain = null;
    this.freq = null;
    this.srcNode = null;

    this.ready = false;
    this.mock = false;

    // smoothed spectrum state
    this.bass = 0;
    this.mid = 0;
    this.high = 0;
    this.level = 0;
    this.beat = 0;       // 1 on hit, decays to 0
    this._hist = [];
    this._lastBeat = -1;
    this._t = 0;

    this._volume = 0.82;
    this._muted = false;
  }

  get duration() {
    const d = this.el.duration;
    return Number.isFinite(d) ? d : 0;
  }

  get currentTime() {
    return this.el.currentTime || 0;
  }

  get paused() {
    return this.el.paused;
  }

  async unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this._muted ? 0 : this._volume;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0.72;
      this.analyser.minDecibels = -92;
      this.analyser.maxDecibels = -12;

      try {
        this.srcNode = this.ctx.createMediaElementSource(this.el);
        this.srcNode.connect(this.gain);
        this.gain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
      } catch (err) {
        // Element already bound (hot reload) — fall back to a plain chain.
        console.warn('[nocturne] audio graph:', err);
      }

      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.ready = true;
  }

  setVolume(v) {
    this._volume = Math.min(1, Math.max(0, v));
    if (this._muted) return;
    if (this.gain) this.gain.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.05);
  }

  setMuted(muted) {
    this._muted = muted;
    if (this.gain) this.gain.gain.setTargetAtTime(muted ? 0 : this._volume, this.ctx.currentTime, 0.03);
  }

  get muted() { return this._muted; }
  get volume() { return this._volume; }

  /* --- analysis --------------------------------------------------------- */

  update(dt) {
    this._t += dt;

    if (this.mock) {
      this._mockUpdate();
      return this.snapshot();
    }

    if (!this.analyser) return this.snapshot();

    this.analyser.getByteFrequencyData(this.freq);
    const bins = this.freq.length;
    const sr = this.ctx ? this.ctx.sampleRate : 48000;
    const hz = sr / (bins * 2); // per-bin width

    const band = (fromHz, toHz) => {
      const a = Math.max(1, Math.floor(fromHz / hz));
      const b = Math.min(bins - 1, Math.ceil(toHz / hz));
      if (b <= a) return 0;
      let sum = 0;
      for (let i = a; i <= b; i++) sum += this.freq[i];
      return sum / (b - a + 1) / 255;
    };

    const bass = band(24, 160);
    const mid = band(160, 2000);
    const high = band(2000, 12000);
    const level = (bass * 0.8 + mid * 0.9 + high * 0.5) / 2.2;

    const k = 1 - Math.exp(-dt * 9);
    this.bass += (bass - this.bass) * k;
    this.mid += (mid - this.mid) * (1 - Math.exp(-dt * 6));
    this.high += (high - this.high) * (1 - Math.exp(-dt * 12));
    this.level += (level - this.level) * (1 - Math.exp(-dt * 7));

    this._detectBeat(bass);
    this.beat = Math.max(0, this.beat - dt * 2.6);

    return this.snapshot();
  }

  _detectBeat(energy) {
    const hist = this._hist;
    hist.push(energy);
    if (hist.length > 43) hist.shift();
    if (hist.length < 12) return;

    let avg = 0;
    let variance = 0;
    for (const v of hist) avg += v;
    avg /= hist.length;
    for (const v of hist) variance += (v - avg) * (v - avg);
    variance /= hist.length;

    const threshold = avg * (1.28 + Math.min(0.9, variance * 9)) + 0.035;
    const now = this._t;
    const since = now - this._lastBeat;

    if (energy > threshold && energy > 0.09 && since > 0.22) {
      this._lastBeat = now;
      this.beat = 1;
    }
  }

  _mockUpdate() {
    const t = this._t;
    const pulse = Math.pow(Math.max(0, Math.sin(t * 2.2)), 8);
    // numbers in the same range a real mix produces, so the preview
    // frame looks like the played one
    this.bass = 0.38 + 0.12 * Math.sin(t * 0.7) + 0.10 * pulse;
    this.mid = 0.12 + 0.05 * Math.sin(t * 1.3 + 1.2);
    this.high = 0.06 + 0.04 * Math.sin(t * 2.7 + 2.4);
    this.level = 0.20 + 0.05 * Math.sin(t * 0.9) + 0.05 * pulse;
    this.beat = Math.max(0, this.beat - 0.016 * 2.6);
    if (pulse > 0.92) this.beat = 1;
  }

  snapshot() {
    return {
      bass: clamp01(this.bass),
      mid: clamp01(this.mid),
      high: clamp01(this.high),
      level: clamp01(this.level),
      beat: clamp01(this.beat)
    };
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
