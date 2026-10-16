// Rainbow Keys — the play screen, drawn on a small canvas and scaled up for chunky pixels.
// Seven rainbow lanes lead into seven keys (or just pads of light). Tiles slide toward you;
// press the lane's key as a tile reaches the line.
(function () {
  'use strict';
  const RK = (window.RK = window.RK || {});
  const { LETTERS, LANE_COLORS, LANES, spell, noteName, defaultMidi } = RK.notes;
  const { timeline, barStarts, isTile } = RK.store;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const FONT = '8px "Press Start 2P", monospace';
  const FONT16 = '16px "Press Start 2P", monospace';
  const POINTS = { perfect: 300, great: 200, good: 100, miss: 0, nice: 300 };
  const JUDGE_COLORS = { perfect: '#ffe03d', great: '#36c8ff', good: '#c56bff', miss: '#ff4f5e', nice: '#4fe06a' };

  class Game {
    constructor({ canvas, audio, getSettings, hud, onFinish }) {
      this.cv = canvas;
      this.c = canvas.getContext('2d', { alpha: false });
      this.audio = audio; this.getSettings = getSettings; this.hud = hud; this.onFinish = onFinish;
      this.state = 'idle';
      this.down = new Array(LANES).fill(false);
      this.pressFx = new Array(LANES).fill(0);
      this.wrongFx = new Array(LANES).fill(0);
      this.autoUntil = new Array(LANES).fill(0);
      this.particles = [];
      this.stars = [];
      this.pointerLane = new Map();
      this.loop = this.loop.bind(this);
      addEventListener('resize', () => this.resize());
      this.bindPointer();
    }

    // ---------- setup ----------
    start(chart, { mode = 'normal', rate = 1, part = 'treble' } = {}) {
      const s = this.getSettings();
      this.chart = chart;
      this.mode = mode;
      this.part = part;
      this.rate = clamp(rate, 0.25, 1.5);
      this.tl = timeline(chart);
      // a song can set its own Perfect window (editor → PERFECT ms); Great and Good stay wider than it
      const perfect = chart.perfectMs || s.perfect;
      const great = Math.max(s.great, perfect + 10), good = Math.max(s.good, great + 10);
      this.win = { perfect: perfect / 1000, great: great / 1000, good: good / 1000 };
      this.backingOn = s.backingOn;

      // tiles: one per lane and moment (octave doublings share a tile)
      const tiles = new Map();
      this.backing = [];
      for (const [b, m, d, lane, p] of chart.notes) {
        const t = this.tl.beatToSec(b), end = this.tl.beatToSec(b + d);
        // your part becomes tiles; every other note is played for you
        if (!isTile(p, part)) { this.backing.push({ t, end, midi: m }); continue; }
        const key = `${lane}@${t.toFixed(3)}`;
        let tile = tiles.get(key);
        if (!tile) { tile = { t, end, beats: d, lane, pitches: [], alters: new Set(), judged: null, delta: 0, scheduled: false }; tiles.set(key, tile); }
        tile.pitches.push(m);
        tile.end = Math.max(tile.end, end);
        tile.beats = Math.max(tile.beats, d);
        const a = spell(m, lane).alter;
        if (a) tile.alters.add(a);
      }
      this.tiles = [...tiles.values()].sort((a, b) => a.t - b.t || a.lane - b.lane);
      for (const t of this.tiles) t.mark = t.alters.size === 1 ? ([...t.alters][0] > 0 ? '#' : 'b') : t.alters.size > 1 ? '*' : '';
      this.backing.sort((a, b) => a.t - b.t);
      this.byLane = Array.from({ length: LANES }, () => []);
      this.tiles.forEach((t) => this.byLane[t.lane].push(t));
      this.lanePtr = new Array(LANES).fill(0);
      this.missPtr = 0;
      this.backPtr = 0;
      this.demoPtr = 0;
      this.maxDur = this.tiles.reduce((m, n) => Math.max(m, n.end - n.t), 0.3);
      this.lastPitch = LETTERS.map((_, l) => this.byLane[l][0]?.pitches[0] ?? defaultMidi(l));

      this.chords = [];
      for (const n of this.tiles) {
        const last = this.chords[this.chords.length - 1];
        if (last && Math.abs(last.t - n.t) < 0.012) last.tiles.push(n);
        else this.chords.push({ t: n.t, tiles: [n] });
      }
      this.chordPtr = 0;

      const endBeat = chart.notes.reduce((m, n) => Math.max(m, n[0] + n[2]), 0);
      // beat lines every quarter note, bar lines from the time signature (and its changes)
      const bars = barStarts(chart, endBeat + 8);
      const lines = new Map();
      for (let b = 0; b <= Math.ceil(endBeat) + 4; b++) lines.set(b.toFixed(4), false);
      for (const b of bars) if (b <= endBeat + 8) lines.set(b.toFixed(4), true);
      this.beats = [...lines.entries()].map(([k, isBar]) => ({ b: +k, t: this.tl.beatToSec(+k), bar: isBar })).sort((a, b) => a.b - b.b);
      const lastTile = this.tiles.length ? Math.max(...this.tiles.map((n) => n.end)) : 0;
      const lastBack = this.backing.length ? Math.max(...this.backing.map((n) => n.end)) : 0;
      this.lastT = Math.max(lastTile, this.backingOn ? lastBack : 0);

      this.stats = { perfect: 0, great: 0, good: 0, miss: 0, nice: 0, wrong: 0, points: 0, combo: 0, maxCombo: 0, judged: 0, deltas: [] };
      this.particles = [];
      this.down.fill(false); this.pressFx.fill(0); this.wrongFx.fill(0); this.autoUntil.fill(0);
      this.waitT = null;
      this.audio.allOff();

      this.resize();
      const lead = 3;
      this.anchorSong = -lead * this.rate;
      this.anchorClock = this.clock();
      this.countUntil = this.clock() + lead;
      this.state = 'playing';
      this.hud.reset?.(this);
      cancelAnimationFrame(this.raf);
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }

    stop() {
      this.state = 'idle';
      cancelAnimationFrame(this.raf);
      this.audio.allOff();
    }

    clock() { return performance.now() / 1000; }
    songTime() {
      if (this.state === 'paused' || this.state === 'done') return this.pausedAt;
      const raw = this.anchorSong + Math.max(0, this.clock() - this.anchorClock) * this.rate;
      return this.waitT != null ? Math.min(raw, this.waitT) : raw;
    }
    get lookahead() { return 3.2 - (clamp(this.getSettings().speed, 1, 10) - 1) * 0.26; }

    pause() {
      if (this.state !== 'playing') return false;
      this.pausedAt = this.songTime();
      this.state = 'paused';
      this.releaseAll();
      this.audio.allOff();
      this.tiles.forEach((n) => { if (!n.judged) n.scheduled = false; });
      return true;
    }
    resume() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      const at = this.waitT ?? this.pausedAt;
      this.anchorSong = at - 1.5 * this.rate;
      this.anchorClock = this.clock();
      this.countUntil = this.clock() + 1.5;
      // re-schedule backing from where we stopped
      this.backPtr = this.backing.findIndex((n) => n.t >= at - 1e-6);
      if (this.backPtr < 0) this.backPtr = this.backing.length;
      this.lastFrame = performance.now();
    }
    releaseAll() {
      for (let i = 0; i < LANES; i++) if (this.down[i]) this.release(i);
      this.pointerLane.clear();
    }

    // ---------- layout ----------
    resize() {
      const host = this.cv.parentElement;
      const W = host.clientWidth || innerWidth, H = host.clientHeight || innerHeight;
      const P = Math.max(2, Math.round(Math.min(W / 480, H / 290)));
      this.P = P;
      this.w = Math.ceil(W / P); this.h = Math.ceil(H / P);
      this.cv.width = this.w; this.cv.height = this.h;
      this.cv.style.width = `${this.w * P}px`; this.cv.style.height = `${this.h * P}px`;
      this.c.imageSmoothingEnabled = false;
      this.stars = Array.from({ length: Math.round((this.w * this.h) / 700) }, () => this.newStar(true));
      this.layout();
    }

    layout() {
      const { w, h } = this, s = this.getSettings();
      const pianoView = s.pianoView;
      const laneW = Math.floor(Math.min(64, (w * 0.84) / LANES));
      const hw = laneW * LANES;
      const x0 = Math.floor((w - hw) / 2);
      const pianoH = pianoView ? clamp(Math.round(h * 0.2), 40, 70) : 0;
      const hitY = pianoView ? h - pianoH - 8 : h - 34;
      const topY = 26;
      const P = 2.6;
      const L = { laneW, hw, x0, pianoH, hitY, topY, P, cx: x0 + hw / 2, pianoView };
      L.horizonY = (topY * (1 + P) - hitY) / P;
      L.thick = 15 / ((hitY - L.horizonY) * P);
      this.L = L;
    }

    proj(x, z) {
      const L = this.L;
      const k = 1 / (1 + L.P * Math.max(z, -0.25));
      return [L.cx + (x - L.cx) * k, L.horizonY + (L.hitY - L.horizonY) * k, k];
    }
    quad(x0, x1, z0, z1) {
      const c = this.c;
      const a = this.proj(x0, z0), b = this.proj(x1, z0), d = this.proj(x1, z1), e = this.proj(x0, z1);
      c.beginPath();
      c.moveTo(Math.round(a[0]), Math.round(a[1])); c.lineTo(Math.round(b[0]), Math.round(b[1]));
      c.lineTo(Math.round(d[0]), Math.round(d[1])); c.lineTo(Math.round(e[0]), Math.round(e[1]));
      c.closePath();
      return a[2];
    }
    laneX(lane) { const L = this.L; return [L.x0 + lane * L.laneW, L.x0 + (lane + 1) * L.laneW]; }

    // ---------- input ----------
    press(lane) {
      if (lane == null || lane < 0 || lane >= LANES || this.down[lane]) return;
      if (this.state !== 'playing') return;
      this.down[lane] = true;
      this.pressFx[lane] = 1;
      if (this.mode === 'demo') { this.audio.keyDown('lane' + lane, [this.lastPitch[lane]], 0.6); return; }
      const s = this.getSettings();
      const now = this.songTime() - (s.offset / 1000) * this.rate;
      if (this.mode === 'practice') return this.practicePress(lane, now);

      const arr = this.byLane[lane], win = this.win.good * this.rate;
      let best = null, bestAbs = Infinity;
      for (let i = this.lanePtr[lane]; i < arr.length; i++) {
        const n = arr[i];
        if (n.judged) continue;
        const d = now - n.t;
        if (d < -win) break;
        if (Math.abs(d) <= win && Math.abs(d) < bestAbs) { best = n; bestAbs = Math.abs(d); }
      }
      if (best) {
        const real = (now - best.t) / this.rate, a = Math.abs(real);
        this.sound(lane, best.pitches, 0.85);
        this.judge(best, a <= this.win.perfect ? 'perfect' : a <= this.win.great ? 'great' : 'good', real);
      } else {
        this.wrongFx[lane] = 1;
        this.sound(lane, [this.nearestPitch(lane, now)], 0.45);
      }
    }
    practicePress(lane, now) {
      const ch = this.chords[this.chordPtr];
      if (ch && ch.t - now <= 0.5 * this.rate) {
        const n = ch.tiles.find((x) => x.lane === lane && !x.judged);
        if (n) { this.sound(lane, n.pitches, 0.85); this.judge(n, 'nice', 0); this.advanceChord(); return; }
      }
      this.stats.wrong++;
      this.wrongFx[lane] = 1;
      this.sound(lane, [this.nearestPitch(lane, now)], 0.4);
    }
    sound(lane, pitches, vel) {
      this.lastPitch[lane] = pitches[0];
      this.audio.keyDown('lane' + lane, pitches, vel);
    }
    nearestPitch(lane, now) {
      const arr = this.byLane[lane];
      for (let i = this.lanePtr[lane]; i < arr.length; i++) if (arr[i].t >= now - 0.2) return arr[i].pitches[0];
      return this.lastPitch[lane];
    }
    advanceChord() {
      while (this.chordPtr < this.chords.length && this.chords[this.chordPtr].tiles.every((n) => n.judged)) {
        const ch = this.chords[this.chordPtr];
        if (this.waitT != null && Math.abs(this.waitT - ch.t) < 1e-6) {
          this.anchorSong = this.waitT; this.anchorClock = this.clock(); this.waitT = null;
        }
        this.chordPtr++;
      }
    }
    release(lane) {
      if (!this.down[lane]) return;
      this.down[lane] = false;
      this.audio.keyUp('lane' + lane);
    }

    bindPointer() {
      const cv = this.cv;
      const hit = (e) => {
        const r = cv.getBoundingClientRect(), L = this.L;
        if (!L) return null;
        const x = (e.clientX - r.left) / this.P, y = (e.clientY - r.top) / this.P;
        if (y < L.hitY - 30) return null;
        const lane = Math.floor((x - L.x0) / L.laneW);
        return lane >= 0 && lane < LANES ? lane : null;
      };
      cv.addEventListener('pointerdown', (e) => {
        const lane = hit(e);
        if (lane == null) return;
        cv.setPointerCapture?.(e.pointerId);
        this.pointerLane.set(e.pointerId, lane);
        this.press(lane);
      });
      const up = (e) => {
        const lane = this.pointerLane.get(e.pointerId);
        if (lane == null) return;
        this.pointerLane.delete(e.pointerId);
        this.release(lane);
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
    }

    // ---------- judging ----------
    judge(n, kind, delta) {
      n.judged = kind; n.delta = delta;
      const st = this.stats;
      st[kind]++; st.judged++;
      if (kind === 'miss') st.combo = 0;
      else {
        st.combo++;
        st.maxCombo = Math.max(st.maxCombo, st.combo);
        st.points += POINTS[kind];
        if (kind !== 'nice') st.deltas.push(delta);
        this.burst(n.lane, kind);
      }
      this.hud.judge?.(kind, st.combo, delta * 1000);
    }
    liveScore() {
      const st = this.stats, N = this.tiles.length || 1;
      return Math.round(1e6 * ((0.9 * st.points) / (N * 300) + (0.1 * st.maxCombo) / N));
    }
    accuracy() { const st = this.stats; return st.judged ? (st.points / (st.judged * 300)) * 100 : 100; }

    burst(lane, kind) {
      const [x0, x1] = this.laneX(lane);
      const x = (x0 + x1) / 2, y = this.L.hitY;
      const reduced = this.getSettings().effects === 'reduced';
      const n = reduced ? 4 : kind === 'perfect' || kind === 'nice' ? 18 : 10;
      const cols = [LANE_COLORS[lane][0], LANE_COLORS[lane][2], '#ffffff'];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 40 + Math.random() * 110;
        this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.35 + Math.random() * 0.35, col: cols[i % 3], size: Math.random() < 0.3 ? 2 : 1 });
      }
      this.particles.push({ ring: true, x, y, life: 0, max: 0.28, col: LANE_COLORS[lane][2], w: x1 - x0 });
      if (!reduced && (kind === 'perfect' || kind === 'nice')) this.particles.push({ star: true, x, y: y - 10, life: 0, max: 0.4, col: '#fff7a8' });
    }

    // ---------- loop ----------
    loop(ts) {
      this.raf = requestAnimationFrame(this.loop);
      const dt = Math.min(0.05, (ts - this.lastFrame) / 1000);
      this.lastFrame = ts;
      if (this.state === 'playing') this.update();
      this.render(dt);
    }

    update() {
      const now = this.songTime(), rate = this.rate;
      const left = this.countUntil - this.clock();
      this.hud.countdown?.(left > 0 ? Math.ceil(left) : null);

      if (this.mode === 'normal') {
        const win = this.win.good * rate;
        while (this.missPtr < this.tiles.length && this.tiles[this.missPtr].t < now - win) {
          const n = this.tiles[this.missPtr++];
          if (!n.judged) this.judge(n, 'miss', 0);
        }
      } else if (this.mode === 'practice') {
        this.advanceChord();
        const ch = this.chords[this.chordPtr];
        if (ch && this.waitT == null) {
          const raw = this.anchorSong + Math.max(0, this.clock() - this.anchorClock) * rate;
          if (raw >= ch.t) this.waitT = ch.t;
        }
      } else if (this.mode === 'demo') {
        const aNow = this.audio.now();
        for (let i = this.demoPtr; i < this.tiles.length; i++) {
          const n = this.tiles[i];
          if (n.t > now + 0.2 * rate) break;
          if (!n.scheduled) {
            n.scheduled = true;
            const when = aNow + Math.max(0, (n.t - now) / rate);
            for (const p of n.pitches) this.audio.play(p, { when, dur: Math.max(0.12, (n.end - n.t) / rate), vel: 0.72 });
          }
          if (!n.judged && n.t <= now) {
            this.judge(n, 'perfect', 0);
            this.autoUntil[n.lane] = this.clock() + clamp((n.end - n.t) / rate, 0.1, 0.5);
          }
        }
        while (this.demoPtr < this.tiles.length && this.tiles[this.demoPtr].judged) this.demoPtr++;
      }

      // backing part
      if (this.backingOn && this.clock() >= this.countUntil - 0.3) {
        const aNow = this.audio.now();
        const horizon = now + 0.15 * rate;
        while (this.backPtr < this.backing.length) {
          const n = this.backing[this.backPtr];
          if (n.t > horizon) break;
          if (this.waitT != null && n.t >= this.waitT - 1e-6) break;
          if (n.t >= now - 0.05 * rate) {
            this.audio.play(n.midi, { when: aNow + Math.max(0, (n.t - now) / rate), dur: Math.max(0.08, (n.end - n.t) / rate), vel: 0.6, backing: true });
          }
          this.backPtr++;
        }
      }

      for (let l = 0; l < LANES; l++) {
        const arr = this.byLane[l];
        while (this.lanePtr[l] < arr.length && arr[this.lanePtr[l]].judged) this.lanePtr[l]++;
      }
      this.hud.update?.({
        score: this.mode === 'normal' ? this.liveScore() : null,
        acc: this.accuracy(), combo: this.stats.combo,
        progress: this.lastT > 0 ? clamp(now / this.lastT, 0, 1) : 0,
        waiting: this.mode === 'practice' && this.waitT != null && this.clock() > this.countUntil,
      });
      const allDone = this.stats.judged >= this.tiles.length;
      if (this.tiles.length === 0 && this.backing.length === 0) this.finish();
      else if (allDone && now > this.lastT + 1) this.finish();
    }

    finish() {
      if (this.state === 'done') return;
      this.pausedAt = this.songTime();
      this.state = 'done';
      this.releaseAll();
      const st = this.stats, N = this.tiles.length;
      const acc = this.accuracy(), score = this.liveScore();
      const grade = acc >= 95 ? 'S' : acc >= 90 ? 'A' : acc >= 80 ? 'B' : acc >= 70 ? 'C' : 'D';
      const ds = st.deltas;
      const mean = ds.length ? (ds.reduce((a, b) => a + b, 0) / ds.length) * 1000 : 0;
      setTimeout(() => this.onFinish?.({
        mode: this.mode, rate: this.rate, part: this.part, total: N, score, accuracy: acc, grade,
        perfect: st.perfect, great: st.great, good: st.good, miss: st.miss, nice: st.nice, wrong: st.wrong,
        maxCombo: st.maxCombo, fullCombo: st.miss === 0 && N > 0, allPerfect: st.perfect === N && N > 0,
        meanOffsetMs: mean, deltasMs: ds.map((d) => d * 1000), windows: { ...this.win },
      }), 700);
    }

    // ---------- drawing ----------
    newStar(init) {
      return { x: Math.random(), y: init ? Math.random() : 0, z: Math.random(), c: Math.random() < 0.3 ? LANE_COLORS[(Math.random() * 7) | 0][2] : '#ffffff' };
    }

    render(dt) {
      if (!this.L) return;
      const c = this.c, { w, h } = this, L = this.L, s = this.getSettings();
      const now = this.state === 'idle' ? 0 : this.songTime();
      const clk = this.clock();
      if (L.pianoView !== s.pianoView) this.layout();

      c.fillStyle = '#0d1442'; c.fillRect(0, 0, w, h);
      // stars drifting down past the lane (a slow warp)
      const moving = this.state === 'playing' && s.effects !== 'reduced';
      for (const st of this.stars) {
        if (moving) st.y += dt * (0.02 + st.z * 0.06);
        if (st.y > 1) Object.assign(st, this.newStar(false));
        const x = Math.round(st.x * w), y = Math.round(st.y * h);
        c.fillStyle = st.c;
        c.globalAlpha = 0.35 + st.z * 0.6;
        c.fillRect(x, y, 1, st.z > 0.85 ? 2 : 1);
      }
      c.globalAlpha = 1;

      this.drawHighway(now, s, clk);
      if (this.tiles) this.drawTiles(now, s);
      this.drawHitLine(clk, s);
      this.drawParticles(dt);
      if (L.pianoView) this.drawPiano(now, s, clk);
      else this.drawPadLabels(s);
      for (let l = 0; l < LANES; l++) {
        if (this.down[l] || this.autoUntil[l] > clk) this.pressFx[l] = 1;
        else this.pressFx[l] = Math.max(0, this.pressFx[l] - dt * 7);
        this.wrongFx[l] = Math.max(0, this.wrongFx[l] - dt * 5);
      }
    }

    approach(lane, now) {
      // 0..1: how close the next tile in this lane is to the line
      const arr = this.byLane?.[lane];
      if (!arr) return 0;
      for (let i = this.lanePtr[lane]; i < arr.length; i++) {
        const n = arr[i];
        if (n.judged) continue;
        if (this.mode === 'practice' && this.waitT != null && Math.abs(n.t - this.waitT) < 1e-6) return 1;
        const ahead = (n.t - now) / this.rate;
        if (ahead < -0.1) continue;
        return clamp(1 - ahead / 0.9, 0, 1);
      }
      return 0;
    }

    drawHighway(now, s, clk) {
      const c = this.c, L = this.L;
      const left = L.x0 - 6, right = L.x0 + L.hw + 6;
      this.quad(left, right, 0, 1);
      c.fillStyle = '#151c5a'; c.fill();
      // lane strips: tinted, and lit as tiles approach (the "rows of light")
      for (let l = 0; l < LANES; l++) {
        const [x0, x1] = this.laneX(l);
        const glow = this.approach(l, now);
        const lit = Math.max(glow * (s.pianoView ? 0.45 : 0.9), this.pressFx[l] * 0.8);
        this.quad(x0, x1, 0, 1);
        c.fillStyle = LANE_COLORS[l][0];
        c.globalAlpha = 0.07 + (s.pianoView ? 0 : 0.03);
        c.fill();
        if (lit > 0.02) {
          // a beam of light that reaches further the closer the tile is
          const reach = 0.12 + lit * 0.4;
          const steps = 6;
          for (let k = 0; k < steps; k++) {
            const z0 = (reach * k) / steps, z1 = (reach * (k + 1)) / steps;
            this.quad(x0 + 1, x1 - 1, z0, z1);
            c.globalAlpha = lit * 0.5 * Math.pow(1 - k / steps, 1.6);
            c.fill();
          }
        }
        c.globalAlpha = 1;
      }
      // lane dividers
      c.fillStyle = 'rgba(190,200,255,0.18)';
      for (let i = 0; i <= LANES; i++) {
        const x = L.x0 + i * L.laneW;
        const a = this.proj(x, 0), b = this.proj(x, 1);
        this.line(a[0], a[1], b[0], b[1], i === 0 || i === LANES ? '#8f9bff' : 'rgba(190,200,255,0.22)');
      }
      // rainbow rails on the outside edges
      for (const [x, col] of [[left, LANE_COLORS[0][0]], [right, LANE_COLORS[6][0]]]) {
        const a = this.proj(x, 0), b = this.proj(x, 1);
        this.line(a[0], a[1], b[0], b[1], col);
      }
      // beat and bar lines coming toward you
      if (this.beats) {
        const look = this.lookahead;
        for (const bt of this.beats) {
          const z = (bt.t - now) / look;
          if (z < 0) continue;
          if (z > 1) break;
          const a = this.proj(L.x0, z), b = this.proj(L.x0 + L.hw, z);
          c.fillStyle = bt.bar ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.09)';
          c.fillRect(Math.round(a[0]), Math.round(a[1]), Math.round(b[0] - a[0]), 1);
        }
      }
      // fade into the distance
      for (let k = 0; k < 6; k++) {
        const z = 0.82 + k * 0.03;
        this.quad(left - 2, right + 2, z, 1);
        c.fillStyle = 'rgba(13,20,66,0.22)'; c.fill();
      }
    }

    line(x0, y0, x1, y1, col) {
      // pixel line (Bresenham) so edges stay crisp
      const c = this.c;
      c.fillStyle = col;
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy, guard = 0;
      while (guard++ < 2000) {
        c.fillRect(x0, y0, 1, 1);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }

    tileLabel(t, s) {
      const key = s.bindings[t.lane].label;
      switch (s.tileLabel) {
        case 'note': return LETTERS[t.lane];
        case 'both': return LETTERS[t.lane] + key;
        case 'none': return '';
        default: return key;
      }
    }

    drawTiles(now, s) {
      const c = this.c, L = this.L, look = this.lookahead, tiles = this.tiles;
      let lo = 0, hi = tiles.length;
      const target = now - this.maxDur - 0.5;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tiles[mid].t < target) lo = mid + 1; else hi = mid; }
      c.font = FONT; c.textAlign = 'center'; c.textBaseline = 'top';
      const drawList = [];
      for (let i = lo; i < tiles.length; i++) {
        const n = tiles[i];
        const z0 = (n.t - now) / look;
        if (z0 > 1.02) break;
        drawList.push([n, z0]);
      }
      // far tiles first so near ones sit on top
      drawList.sort((a, b) => b[1] - a[1]);
      c.save();
      c.beginPath(); c.rect(0, 0, this.w, L.hitY + 5); c.clip();
      for (const [n, z0] of drawList) {
        const zEnd = (n.end - now) / look;
        const [lx0, lx1] = this.laneX(n.lane);
        const x0 = lx0 + 3, x1 = lx1 - 3;
        const col = LANE_COLORS[n.lane];
        const hit = n.judged && n.judged !== 'miss';
        const long = n.beats > 1.01 && n.end - n.t > 0.45;
        if (long && zEnd > 0) {
          const tw = (x1 - x0) * 0.28, mx = (x0 + x1) / 2;
          const zs = hit ? 0 : Math.max(z0, -0.02);
          if (zEnd > zs) {
            this.quad(mx - tw / 2, mx + tw / 2, zs, Math.min(zEnd, 1.05));
            c.fillStyle = n.judged === 'miss' ? '#3b3f6e' : col[hit ? 2 : 0];
            c.globalAlpha = hit ? 0.75 : 0.45;
            c.fill();
            c.globalAlpha = 1;
          }
        }
        if (hit || z0 < -0.16) continue;
        const missed = n.judged === 'miss';
        const z1 = z0 + L.thick;
        // block: dark front edge, main face, light top rim
        const k = this.proj(x0, z0)[2];
        const edge = Math.max(1, Math.round(3 * k));
        const a = this.proj(x0, z0), b = this.proj(x1, z0);
        c.fillStyle = missed ? '#2a2d55' : col[1];
        c.fillRect(Math.round(a[0]), Math.round(a[1]), Math.round(b[0] - a[0]), edge);
        this.quad(x0, x1, z0, z1);
        c.fillStyle = missed ? '#4a4e7e' : col[0];
        c.fill();
        const t0 = this.proj(x0, z1), t1 = this.proj(x1, z1);
        c.fillStyle = missed ? '#5b5f8f' : col[2];
        c.fillRect(Math.round(t0[0]), Math.round(t0[1]), Math.max(1, Math.round(t1[0] - t0[0])), 1);
        if (!missed && k > 0.62) {
          const label = this.tileLabel(n, s);
          const cx = Math.round((a[0] + b[0]) / 2);
          const ty = Math.round((a[1] + t0[1]) / 2 - 4);
          if (label) {
            c.fillStyle = col[1];
            c.fillText(label, cx + 1, ty + 1);
            c.fillStyle = '#ffffff';
            c.fillText(label, cx, ty);
          }
          if (n.mark && k > 0.8) {
            c.fillStyle = '#1b1640';
            c.fillText(n.mark, Math.round(b[0]) - 6, Math.round(t0[1]) + 1);
          }
        }
      }
      c.restore();
    }

    drawHitLine(clk, s) {
      const c = this.c, L = this.L;
      const y = L.hitY;
      // rainbow line made of the seven lane colours
      for (let l = 0; l < LANES; l++) {
        const [x0, x1] = this.laneX(l);
        c.fillStyle = LANE_COLORS[l][0];
        c.fillRect(x0, y, x1 - x0, 2);
        c.fillStyle = LANE_COLORS[l][2];
        c.fillRect(x0, y, x1 - x0, 1);
      }
      // receptors: hollow pixel boxes that fill when pressed
      for (let l = 0; l < LANES; l++) {
        const [x0, x1] = this.laneX(l);
        const col = LANE_COLORS[l];
        const bx = x0 + 3, bw = x1 - x0 - 6, by = y - 5, bh = 10;
        const fx = this.pressFx[l];
        if (!s.pianoView && this.tiles) {
          const g = this.approach(l, this.state === 'idle' ? 0 : this.songTime());
          if (g > 0.05) { c.fillStyle = col[0]; c.globalAlpha = g * 0.45; c.fillRect(bx + 1, by + 1, bw - 2, bh - 2); c.globalAlpha = 1; }
        }
        if (fx > 0.05) { c.fillStyle = col[0]; c.globalAlpha = 0.35 + fx * 0.55; c.fillRect(bx + 1, by + 1, bw - 2, bh - 2); c.globalAlpha = 1; }
        if (this.wrongFx[l] > 0.05) { c.fillStyle = '#ff4f5e'; c.globalAlpha = this.wrongFx[l] * 0.7; c.fillRect(bx + 1, by + 1, bw - 2, bh - 2); c.globalAlpha = 1; }
        c.fillStyle = fx > 0.5 ? '#ffffff' : col[2];
        c.fillRect(bx + 1, by, bw - 2, 1); c.fillRect(bx + 1, by + bh - 1, bw - 2, 1);
        c.fillRect(bx, by + 1, 1, bh - 2); c.fillRect(bx + bw - 1, by + 1, 1, bh - 2);
      }
    }

    drawParticles(dt) {
      const c = this.c, keep = [];
      for (const p of this.particles) {
        p.life += dt;
        if (p.life > p.max) continue;
        keep.push(p);
        const k = 1 - p.life / p.max;
        c.fillStyle = p.col;
        if (p.ring) {
          const r = Math.round(p.w * (0.3 + (1 - k) * 0.6)), rh = Math.max(2, Math.round(r * 0.35));
          const x = Math.round(p.x), y = Math.round(p.y);
          c.globalAlpha = k;
          c.fillRect(x - r, y - rh, 2 * r, 1); c.fillRect(x - r, y + rh, 2 * r, 1);
          c.fillRect(x - r, y - rh, 1, 2 * rh); c.fillRect(x + r - 1, y - rh, 1, 2 * rh);
        } else if (p.star) {
          const r = Math.round(2 + (1 - k) * 6), x = Math.round(p.x), y = Math.round(p.y - (1 - k) * 8);
          c.globalAlpha = k;
          c.fillRect(x - r, y, 2 * r + 1, 1); c.fillRect(x, y - r, 1, 2 * r + 1);
          c.fillRect(x - 1, y - 1, 3, 3);
        } else {
          p.vy += 260 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          c.globalAlpha = Math.min(1, k * 1.5);
          c.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
        }
      }
      c.globalAlpha = 1;
      this.particles = keep;
    }

    drawPiano(now, s, clk) {
      const c = this.c, L = this.L, h = this.h;
      const top = L.hitY + 8, keyH = h - top - 3;
      c.fillStyle = '#1b1640';
      c.fillRect(L.x0 - 4, top - 3, L.hw + 8, h - top + 3);
      c.font = FONT; c.textAlign = 'center'; c.textBaseline = 'top';
      for (let l = 0; l < LANES; l++) {
        const [x0, x1] = this.laneX(l);
        const col = LANE_COLORS[l];
        const down = this.pressFx[l] > 0.5 && (this.down[l] || this.autoUntil[l] > clk);
        const y = top + (down ? 2 : 0), kh = keyH - (down ? 2 : 0), kx = x0 + 1, kw = x1 - x0 - 2;
        // key body
        c.fillStyle = down ? col[2] : '#f6f3ff';
        c.fillRect(kx, y, kw, kh);
        // guide light: the stripe glows as a tile approaches
        const g = s.pianoView ? this.approach(l, now) : 0;
        c.fillStyle = col[0];
        c.fillRect(kx, y, kw, 4 + Math.round(g * 6));
        if (g > 0.6 && Math.floor(clk * 8) % 2 === 0) { c.fillStyle = '#ffffff'; c.fillRect(kx + 2, y + 1, kw - 4, 1); }
        if (this.wrongFx[l] > 0.05) { c.fillStyle = '#ff4f5e'; c.globalAlpha = this.wrongFx[l] * 0.5; c.fillRect(kx, y, kw, kh); c.globalAlpha = 1; }
        // shading
        c.fillStyle = '#c9c3e8'; c.fillRect(kx, y + kh - 3, kw, 3);
        c.fillStyle = '#1b1640'; c.fillRect(x1 - 1, y, 1, kh);
        // letter and key
        const cx = Math.round((x0 + x1) / 2);
        c.font = keyH > 46 ? FONT16 : FONT;
        c.fillStyle = col[1];
        c.fillText(LETTERS[l], cx, y + (keyH > 46 ? 14 : 12));
        c.font = FONT;
        const lab = s.bindings[l].label;
        const pw = Math.max(14, lab.length * 8 + 6), py = y + kh - 16;
        c.fillStyle = down ? col[0] : '#e4defc';
        c.fillRect(cx - pw / 2, py, pw, 11);
        c.fillStyle = '#1b1640';
        c.fillText(lab, cx + 1, py + 2);
      }
    }

    drawPadLabels(s) {
      const c = this.c, L = this.L;
      c.font = FONT; c.textAlign = 'center'; c.textBaseline = 'top';
      for (let l = 0; l < LANES; l++) {
        const [x0, x1] = this.laneX(l);
        const cx = Math.round((x0 + x1) / 2), y = L.hitY + 10;
        const lab = s.bindings[l].label;
        c.fillStyle = this.pressFx[l] > 0.5 ? '#ffffff' : LANE_COLORS[l][2];
        c.fillText(lab, cx, y);
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.fillText(LETTERS[l], cx, y + 11);
      }
    }
  }

  RK.Game = Game;
  RK.JUDGE_COLORS = JUDGE_COLORS;
})();
