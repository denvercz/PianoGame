// Rainbow Keys — sound. Sampled grand piano or an 8-bit chiptune synth,
// with separate volume for your notes, the backing part and UI sounds.
(function () {
  'use strict';
  const RK = (window.RK = window.RK || {});

  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function nameToMidi(name) {
    const m = /^([A-G])(b|#)?(-?\d)$/.exec(name);
    if (!m) return null;
    return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
  }
  const RELEASE = { short: 0.05, natural: 0.15, pedal: null };

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.buffers = new Map();
      this.held = new Map();
      this.voices = new Set();
      this.vol = { master: 0.8, piano: 0.9, backing: 0.65, sfx: 0.55 };
      this.release = 'natural';
      this.instrument = 'piano';
      this.ready = false;
    }

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC({ latencyHint: 'interactive' }));
      this.master = c.createGain();
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 14; comp.ratio.value = 3.5;
      comp.attack.value = 0.003; comp.release.value = 0.25;
      this.playBus = c.createGain();
      this.backBus = c.createGain();
      this.sfxBus = c.createGain();
      this.musicBus = c.createGain();
      const reverb = c.createConvolver();
      reverb.buffer = this.impulse(2.2, 2.6);
      this.wet = c.createGain(); this.wet.gain.value = 0.18;
      this.playBus.connect(this.musicBus); this.backBus.connect(this.musicBus);
      this.musicBus.connect(this.master);
      this.musicBus.connect(reverb); reverb.connect(this.wet); this.wet.connect(this.master);
      this.sfxBus.connect(this.master);
      this.master.connect(comp); comp.connect(c.destination);
      // 25% pulse wave for the chiptune instrument
      const n = 32, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
      this.pulse = c.createPeriodicWave(re, im);
      this.applyVolumes();
    }

    impulse(sec, decay) {
      const c = this.ctx, len = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = Math.floor(c.sampleRate * 0.01); i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * 0.55;
      }
      return b;
    }

    configure(s) {
      this.vol = { master: s.master / 100, piano: s.piano / 100, backing: s.backing / 100, sfx: s.sfx / 100 };
      this.release = s.release;
      this.instrument = s.instrument;
      this.applyVolumes();
    }
    applyVolumes() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this.vol.master, t, 0.02);
      this.playBus.gain.setTargetAtTime(this.vol.piano, t, 0.02);
      this.backBus.gain.setTargetAtTime(this.vol.backing, t, 0.02);
      this.sfxBus.gain.setTargetAtTime(this.vol.sfx * 0.5, t, 0.02);
      this.wet.gain.setTargetAtTime(this.instrument === 'chip' ? 0.08 : 0.18, t, 0.05);
    }

    async resume() {
      this.init();
      if (this.ctx && this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { /* needs a gesture */ } }
    }

    // Samples come from assets/sounds/piano-samples.js (window.RK_PIANO_SAMPLES).
    async load(onProgress) {
      this.init();
      const data = window.RK_PIANO_SAMPLES;
      if (!this.ctx || !data) { onProgress?.(1); this.ready = true; return false; }
      const entries = Object.entries(data);
      let done = 0;
      for (let i = 0; i < entries.length; i += 8) {
        await Promise.all(entries.slice(i, i + 8).map(async ([name, url]) => {
          const midi = nameToMidi(name);
          try {
            const b64 = url.slice(url.indexOf(',') + 1);
            const bin = atob(b64), bytes = new Uint8Array(bin.length);
            for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
            const buf = await this.ctx.decodeAudioData(bytes.buffer);
            if (midi != null) this.buffers.set(midi, buf);
          } catch { /* skip */ }
          done++; onProgress?.(done / entries.length);
        }));
      }
      window.RK_PIANO_SAMPLES = null; // free the text copy
      this.ready = true;
      return this.buffers.size > 0;
    }

    now() { return this.ctx ? this.ctx.currentTime : 0; }

    // Start a note; returns a voice with stop(at).
    play(midi, { vel = 0.8, when = 0, dur = null, backing = false, bus = null } = {}) {
      if (!this.ctx) return null;
      const c = this.ctx, t = Math.max(when || 0, c.currentTime);
      const g = c.createGain();
      let src;
      if (this.instrument === 'chip' || !this.buffers.size) src = this.chipVoice(midi, t, g, vel, backing);
      else {
        let buf = this.buffers.get(midi), rate = 1;
        if (!buf) {
          let best = null;
          for (const k of this.buffers.keys()) if (best == null || Math.abs(k - midi) < Math.abs(best - midi)) best = k;
          buf = this.buffers.get(best); rate = Math.pow(2, (midi - best) / 12);
        }
        src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
        const peak = 0.12 + vel * vel * 0.88;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.004);
        src.connect(g);
        src.start(t);
      }
      g.connect(bus || (backing ? this.backBus : this.playBus));
      const voice = { midi, src, g, t, stopped: false, chip: this.instrument === 'chip' };
      voice.stop = (at, fade) => this.stopVoice(voice, at, fade);
      src.onended = () => { this.voices.delete(voice); try { g.disconnect(); } catch { /* gone */ } };
      this.voices.add(voice);
      if (this.voices.size > 72) this.stopVoice(this.voices.values().next().value, c.currentTime, 0.03, true);
      if (dur != null) voice.stop(t + dur);
      return voice;
    }

    chipVoice(midi, t, g, vel, backing) {
      const c = this.ctx, f = 440 * Math.pow(2, (midi - 69) / 12);
      const o = c.createOscillator();
      if (midi < 52) o.type = 'triangle'; else o.setPeriodicWave(this.pulse);
      o.frequency.setValueAtTime(f, t);
      const peak = (midi < 52 ? 0.5 : 0.22) * (0.5 + vel * 0.5) * (backing ? 0.8 : 1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.004);
      g.gain.setTargetAtTime(peak * 0.55, t + 0.02, 0.12);
      o.connect(g);
      o.start(t);
      o.stop(t + 30);
      return o;
    }

    stopVoice(v, at, fade, force = false) {
      if (!this.ctx || (v.stopped && !force)) return;
      const c = this.ctx;
      const t = force ? Math.max(at ?? c.currentTime, c.currentTime) : Math.max(at ?? c.currentTime, v.t + 0.03, c.currentTime);
      const tc = fade ?? (v.chip ? 0.03 : RELEASE[this.release] ?? 0.15);
      v.stopped = true;
      try {
        v.g.gain.cancelScheduledValues(t);
        v.g.gain.setTargetAtTime(0, t, tc);
        v.src.stop(t + tc * 6 + 0.05);
      } catch { /* already stopped */ }
    }

    // Live key down/up. Several pitches may share one key (chords, octaves).
    keyDown(id, midis, vel = 0.82) {
      this.keyUp(id, true);
      const list = (Array.isArray(midis) ? midis : [midis]).map((m) => this.play(m, { vel })).filter(Boolean);
      this.held.set(id, list);
    }
    keyUp(id, quick = false) {
      const list = this.held.get(id);
      if (!list) return;
      this.held.delete(id);
      if (this.release === 'pedal' && !quick) return;
      for (const v of list) v.stop(undefined, quick ? 0.03 : undefined);
    }
    allOff() {
      if (!this.ctx) return;
      for (const v of this.voices) this.stopVoice(v, this.ctx.currentTime, 0.04, true);
      this.held.clear();
    }

    // ---- UI sounds: little 8-bit blips ----
    blip(freq = 1200, dur = 0.06, type = 'square', vol = 0.2, when = 0, slide = 0) {
      if (!this.ctx) return;
      const c = this.ctx, t = Math.max(when, c.currentTime);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.02);
    }
    click(accent = false, when = 0) { this.blip(accent ? 1568 : 1046, 0.05, 'square', accent ? 0.2 : 0.13, when); }
    move() { this.blip(1318, 0.035, 'square', 0.08); }
    select() { const n = this.now(); this.blip(988, 0.06, 'square', 0.15, n); this.blip(1318, 0.09, 'square', 0.15, n + 0.06); }
    back() { const n = this.now(); this.blip(784, 0.06, 'square', 0.12, n); this.blip(523, 0.09, 'square', 0.12, n + 0.06); }
    coin() { const n = this.now(); this.blip(988, 0.07, 'square', 0.16, n); this.blip(1976, 0.25, 'square', 0.14, n + 0.07); }
    oops() { this.blip(220, 0.12, 'square', 0.12, 0, 0.6); }
  }

  RK.AudioEngine = AudioEngine;
})();
