// Rainbow Keys — songs, scores, settings and sheet images, all stored in this browser.
(function () {
  'use strict';
  const RK = (window.RK = window.RK || {});
  const { LANES, laneOfMidi } = RK.notes;

  // ---------- safe storage ----------
  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  // ---------- chart model ----------
  // note = [beat, midi, duration, lane, auto]   (beats are quarter notes)
  function normalizeChart(raw) {
    const c = { ...raw };
    c.title = String(c.title || 'Untitled').slice(0, 80);
    c.composer = String(c.composer || '').slice(0, 80);
    c.subtitle = String(c.subtitle || '').slice(0, 120);
    c.description = String(c.description || '').slice(0, 400);
    c.keySig = Number.isFinite(+c.keySig) ? Math.max(-7, Math.min(7, Math.round(+c.keySig))) : 0;
    c.timeSig = Array.isArray(c.timeSig) && c.timeSig.length === 2 ? c.timeSig.map((x) => Math.max(1, Math.min(32, Math.round(+x) || 4))) : [4, 4];
    c.tempos = (Array.isArray(c.tempos) && c.tempos.length ? c.tempos : [{ b: 0, bpm: 90, label: '' }])
      .map((t) => ({ b: Math.max(0, +t.b || 0), bpm: Math.max(20, Math.min(320, +t.bpm || 90)), label: String(t.label || '').slice(0, 30) }))
      .sort((a, b) => a.b - b.b);
    if (c.tempos[0].b > 0) c.tempos.unshift({ b: 0, bpm: c.tempos[0].bpm, label: '' });
    // time signature changes after the start: [{ b, ts: [n, d] }]
    c.meters = (Array.isArray(c.meters) ? c.meters : [])
      .filter((m) => m && +m.b > 1e-6 && Array.isArray(m.ts) && m.ts.length === 2)
      .map((m) => ({ b: +(+m.b).toFixed(4), ts: m.ts.map((x) => Math.max(1, Math.min(32, Math.round(+x) || 4))) }))
      .sort((a, b) => a.b - b.b)
      .filter((m, i, a) => !i || m.b - a[i - 1].b > 1e-4);
    if (!c.meters.length) delete c.meters;
    c.difficulty = Math.max(1, Math.min(5, Math.round(+c.difficulty || 2)));
    c.theme = c.theme || 'night';
    const flats = c.keySig < 0;
    const legacy = !(c.format >= 3);
    c.format = 3;
    c.perfectMs = c.perfectMs ? Math.max(20, Math.min(150, Math.round(+c.perfectMs) || 0)) || null : null;
    if (!c.perfectMs) delete c.perfectMs;
    c.notes = (Array.isArray(c.notes) ? c.notes : [])
      .filter((n) => Array.isArray(n) && n.length >= 3 && Number.isFinite(+n[0]) && Number.isFinite(+n[1]))
      .map((n) => {
        const midi = Math.max(12, Math.min(119, Math.round(+n[1])));
        let lane = n.length > 3 && n[3] != null ? Math.round(+n[3]) : laneOfMidi(midi, flats);
        if (!(lane >= 0 && lane < LANES)) lane = laneOfMidi(midi, flats);
        let part = Math.round(+n[4]) || 0;
        if (part < 0 || part > 5) part = 0;
        if (legacy && part === 1) part = 5; // before v1-3, 1 meant "backing"
        return [Math.max(0, +n[0]), midi, Math.max(1 / 64, +n[2] || 1), lane, part];
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (typeof c.sheetText !== 'string') delete c.sheetText;
    return c;
  }

  function notesSignature(notes) {
    let h = 2166136261;
    for (const n of notes) {
      const s = `${n[0].toFixed(3)},${n[1]},${n[2].toFixed(3)},${n[3]},${n[4]};`;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    }
    return (h >>> 0).toString(36) + ':' + notes.length;
  }

  function timeline(chart) {
    const segs = [];
    let sec = 0;
    chart.tempos.forEach((t, i) => {
      if (i > 0) { const p = chart.tempos[i - 1]; sec += ((t.b - p.b) * 60) / p.bpm; }
      segs.push({ b: t.b, bpm: t.bpm, s: sec, label: t.label });
    });
    const atBeat = (b) => { let g = segs[0]; for (const x of segs) { if (x.b <= b) g = x; else break; } return g; };
    const atSec = (s) => { let g = segs[0]; for (const x of segs) { if (x.s <= s) g = x; else break; } return g; };
    return {
      segs,
      beatToSec: (b) => { const g = atBeat(b); return g.s + ((b - g.b) * 60) / g.bpm; },
      secToBeat: (s) => { const g = atSec(s); return g.b + ((s - g.s) * g.bpm) / 60; },
      bpmAt: (b) => atBeat(b).bpm,
    };
  }
  const barBeats = (chart) => (chart.timeSig[0] * 4) / chart.timeSig[1];
  // bars, taking time signature changes into account
  function meterList(chart) {
    const out = [{ b: 0, n: chart.timeSig[0], d: chart.timeSig[1] }];
    for (const m of chart.meters || []) if (m.b > 1e-6) out.push({ b: m.b, n: m.ts[0], d: m.ts[1] });
    return out.map((m) => ({ ...m, len: (m.n * 4) / m.d }));
  }
  const barCache = new WeakMap();
  // start beats of every bar up to endBeat
  function barStarts(chart, endBeat) {
    const key = `${chart.timeSig}|${JSON.stringify(chart.meters || [])}`;
    const hit = barCache.get(chart);
    if (hit && hit.key === key && hit.end >= endBeat) return hit.list;
    const ms = meterList(chart), list = [];
    const end = Math.max(endBeat, 16) * 1.5 + 16;
    for (let i = 0; i < ms.length; i++) {
      const stop = i + 1 < ms.length ? ms[i + 1].b : end;
      for (let b = ms[i].b; b < stop - 1e-6 && list.length < 200000; b += ms[i].len) list.push(+b.toFixed(6));
    }
    barCache.set(chart, { key, end, list });
    return list;
  }
  // which bar a beat is in: { index (0-based), start, len, n, d }
  function barAt(chart, beat) {
    const list = barStarts(chart, beat + 1);
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (list[mid] <= beat + 1e-6) lo = mid; else hi = mid - 1; }
    const ms = meterList(chart);
    let m = ms[0];
    for (const x of ms) if (x.b <= list[lo] + 1e-6) m = x;
    const next = list[lo + 1] != null ? list[lo + 1] : list[lo] + m.len;
    return { index: lo, start: list[lo], len: next - list[lo], n: m.n, d: m.d };
  }
  const isBarLine = (chart, beat) => { const a = barAt(chart, beat); return Math.abs(a.start - beat) < 1e-4; };
  function chartLength(chart) {
    if (!chart.notes.length) return { beats: 0, sec: 0 };
    let end = 0;
    for (const n of chart.notes) end = Math.max(end, n[0] + n[2]);
    return { beats: end, sec: timeline(chart).beatToSec(end) };
  }
  // Part codes (v1-3): which hand plays a note, and what it does in the music.
  //   0 treble clef melody   1 treble clef accompaniment
  //   2 bass clef bass       3 bass clef accompaniment   4 bass clef melody
  //   5 backing (never a tile; always played for you)
  const P = { RH_MEL: 0, RH_ACC: 1, LH_BASS: 2, LH_ACC: 3, LH_MEL: 4, BACKING: 5 };
  const HAND = { treble: [0, 1], bassclef: [2, 3, 4], both: [0, 1, 2, 3, 4] };
  const LAYER = { melody: [0, 4], accomp: [1, 3], bass: [2] };
  const LAYER_NAMES = { melody: 'MELODY', accomp: 'ACCOMPANIMENT', bass: 'BASS' };
  // A selection is 'treble' | 'bassclef' | 'both' or, in advanced mode, 'L:' + layers, e.g. 'L:melody+bass'
  const setCache = new Map();
  function partSet(sel) {
    if (setCache.has(sel)) return setCache.get(sel);
    let codes;
    if (typeof sel === 'string' && sel.startsWith('L:')) codes = sel.slice(2).split('+').flatMap((l) => LAYER[l] || []);
    else codes = HAND[sel] || HAND.treble;
    const set = new Set(codes);
    setCache.set(sel, set);
    return set;
  }
  const isTile = (code, sel) => partSet(sel).has(code);
  const countFor = (chart, sel) => { const s = partSet(sel); let k = 0; for (const n of chart.notes) if (s.has(n[4])) k++; return k; };
  function partCounts(chart) {
    const by = [0, 0, 0, 0, 0, 0];
    for (const n of chart.notes) by[n[4]]++;
    return {
      treble: by[0] + by[1], bassclef: by[2] + by[3] + by[4], both: by[0] + by[1] + by[2] + by[3] + by[4],
      melody: by[0] + by[4], accomp: by[1] + by[3], bass: by[2], backing: by[5], by,
    };
  }
  // the selection to play: the one asked for, or the first that this song actually has notes in
  function pickPart(chart, wanted) {
    if (wanted && countFor(chart, wanted)) return wanted;
    for (const s of ['treble', 'bassclef', 'both']) if (countFor(chart, s)) return s;
    return 'treble';
  }
  function partLabel(sel, short = false) {
    if (typeof sel === 'string' && sel.startsWith('L:')) {
      const SHORT = { melody: 'MELODY', accomp: 'ACCOMP', bass: 'BASS' };
      return sel.slice(2).split('+').filter((l) => LAYER_NAMES[l]).map((l) => (short ? SHORT[l] : LAYER_NAMES[l])).join(' + ') || 'MELODY';
    }
    return short ? { treble: 'TREBLE (RH)', bassclef: 'BASS CLEF (LH)', both: 'BOTH HANDS' }[sel] || 'TREBLE (RH)'
      : { treble: 'TREBLE CLEF · RIGHT HAND', bassclef: 'BASS CLEF · LEFT HAND', both: 'BOTH HANDS' }[sel] || 'TREBLE CLEF · RIGHT HAND';
  }
  const tileCount = (chart, sel = 'treble') => countFor(chart, sel);
  const playableCount = (chart) => partCounts(chart).both;
  const PART_NAMES = new Proxy({}, { get: (_, k) => partLabel(String(k), true) });
  function fmtTime(sec) {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const newId = () => `my-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  // ---------- sheet images (IndexedDB) ----------
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve) => {
        try {
          const req = indexedDB.open('rainbow-keys', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('refs');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    }
    return dbp;
  }
  async function idb(mode, fn) {
    const d = await db();
    if (!d) return null;
    return new Promise((resolve) => {
      try {
        const tx = d.transaction('refs', mode);
        const req = fn(tx.objectStore('refs'));
        tx.oncomplete = () => resolve(req ? req.result : true);
        tx.onerror = tx.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  // ---------- store ----------
  class Store {
    constructor() {
      this.songs = [];
      this.scores = lsGet('rk.scores', {});
      this.storageOk = lsSet('rk.probe', 1);
    }
    // order: songs that came with the game, then sheets in the Inputs folder, then songs kept in this browser
    loadSongs() {
      const bundled = (window.RK_BUNDLED_SONGS || []).map((c) => ({ ...c, bundled: true }));
      const mine = lsGet('rk.songs', {});
      const ids = new Set(bundled.map((c) => c.id));
      const list = bundled.map((c) => (mine[c.id] ? { ...mine[c.id], bundled: true, edited: true } : c));
      for (const c of this.inputSongs || []) {
        ids.add(c.id);
        list.push(mine[c.id] ? { ...mine[c.id], inputs: true, file: c.file, edited: true } : c);
      }
      Object.values(mine).filter((c) => !ids.has(c.id)).sort((a, b) => (a.created || 0) - (b.created || 0))
        .forEach((c) => list.push({ ...c, bundled: false, edited: true }));
      this.songs = list.map(normalizeChart);
      return this.songs;
    }
    // files: [{ name, text }] from the Inputs folder
    setInputs(files) {
      this.inputCache = this.inputCache || new Map();
      this.inputSongs = files.map(({ name, text }) => {
        const key = name + '\u0000' + text;
        if (this.inputCache.has(key)) return this.inputCache.get(key);
        const r = RK.notation.parseSheet(text);
        const chart = normalizeChart({
          id: RK.inputsUtil.idForFile(name), title: r.title || name.replace(/\.txt$/i, '').replace(/[-_]+/g, ' '),
          composer: r.composer, description: r.description || `From Inputs/${name}`, subtitle: `Inputs/${name}`,
          keySig: r.keySig, timeSig: r.timeSig, meters: r.meters, tempos: r.tempos, notes: r.notes, difficulty: 2, theme: 'night', format: 3, perfectMs: r.perfectMs,
        });
        Object.assign(chart, { inputs: true, file: name, sheetText: text, sheetSig: notesSignature(chart.notes), warnings: r.warnings.length });
        this.inputCache.set(key, chart);
        return chart;
      });
      return this.loadSongs();
    }
    // drop a browser copy that shadows an Inputs file (after the file itself was saved)
    forgetLocal(id) {
      const mine = lsGet('rk.songs', {});
      if (mine[id]) { delete mine[id]; lsSet('rk.songs', mine); }
    }
    get(id) { return this.songs.find((s) => s.id === id); }
    original(id) {
      const b = (window.RK_BUNDLED_SONGS || []).find((c) => c.id === id);
      return b ? normalizeChart({ ...b, bundled: true }) : null;
    }
    saveSong(chart) {
      const mine = lsGet('rk.songs', {});
      const body = { ...chart };
      delete body.bundled; delete body.edited; delete body.warnings;
      body.created = body.created || Date.now();
      mine[chart.id] = body;
      if (!lsSet('rk.songs', mine)) throw new Error('browser storage is full or blocked');
      this.loadSongs();
      return this.get(chart.id);
    }
    deleteSong(id) {
      const mine = lsGet('rk.songs', {});
      delete mine[id];
      lsSet('rk.songs', mine);
      const s = this.scores;
      if (!this.original(id)) { for (const k of Object.keys(s)) if (k === id || k.startsWith(id + '|')) delete s[k]; lsSet('rk.scores', s); }
      this.deleteRef(id);
      this.loadSongs();
    }
    scoreKey(id, part) { return `${id}|${part}`; }
    best(id, part) { return this.scores[this.scoreKey(id, part)] || null; }
    submitScore(id, result) {
      id = this.scoreKey(id, result.part || 'melody');
      const best = this.scores[id];
      const isBest = !best || result.score > best.score;
      const plays = (best?.plays || 0) + 1;
      this.scores[id] = { ...(isBest ? { ...result, date: Date.now() } : best), plays };
      lsSet('rk.scores', this.scores);
      return isBest;
    }
    // sheet images
    saveRef(id, ref) { return idb('readwrite', (s) => s.put(ref, id)); }
    loadRef(id) { return idb('readonly', (s) => s.get(id)); }
    deleteRef(id) { return idb('readwrite', (s) => s.delete(id)); }

    backup() {
      return {
        app: 'rainbow-keys', version: 1, date: new Date().toISOString(),
        songs: lsGet('rk.songs', {}), scores: this.scores, settings: lsGet('rk.settings', {}),
      };
    }
    restore(data) {
      if (!data || data.app !== 'rainbow-keys' || typeof data.songs !== 'object') throw new Error('not a Rainbow Keys backup');
      const mine = lsGet('rk.songs', {});
      let n = 0;
      for (const [id, c] of Object.entries(data.songs)) {
        if (!/^[a-z0-9-]{1,48}$/i.test(id) || !c || !Array.isArray(c.notes)) continue;
        mine[id] = { ...normalizeChart(c), id }; n++;
      }
      lsSet('rk.songs', mine);
      if (data.scores && typeof data.scores === 'object') { this.scores = { ...this.scores, ...data.scores }; lsSet('rk.scores', this.scores); }
      if (data.settings && typeof data.settings === 'object') lsSet('rk.settings', { ...lsGet('rk.settings', {}), ...data.settings });
      this.loadSongs();
      return n;
    }
  }

  // ---------- settings ----------
  const TIMING_PRESETS = {
    strict: { perfect: 35, great: 70, good: 110 },
    normal: { perfect: 50, great: 100, good: 150 },
    relaxed: { perfect: 80, great: 140, good: 210 },
  };
  const DEFAULT_SETTINGS = {
    master: 80, piano: 90, backing: 65, sfx: 55,
    instrument: 'piano',     // piano | chip
    release: 'natural',      // short | natural | pedal
    menuSounds: true,
    backingOn: true,
    speed: 5,
    timingPreset: 'normal',
    perfect: 50, great: 100, good: 150,
    offset: 0,
    timingDetail: true,
    pianoView: true,         // false = lanes of light only
    tileLabel: 'key',        // key | note | both | none
    effects: 'full',
    flats: false,
    bindings: RK.notes.DEFAULT_BINDINGS.map((b) => ({ ...b })),
    rate: 100,
    mode: 'normal',
    part: 'treble',          // treble | bassclef | both | 'L:melody+accomp+bass'
    advancedParts: false,    // show MELODY / ACCOMPANIMENT / BASS on the song screen
  };
  function loadSettings() {
    const s = { ...DEFAULT_SETTINGS, ...lsGet('rk.settings', {}) };
    if (!(s.part in HAND) && !String(s.part).startsWith('L:')) s.part = s.part === 'bass' ? 'bassclef' : 'treble'; // from v1-2
    if (!Array.isArray(s.bindings) || s.bindings.length !== LANES || s.bindings.some((b) => !b || !b.code)) {
      s.bindings = DEFAULT_SETTINGS.bindings.map((b) => ({ ...b }));
    }
    return s;
  }
  const saveSettings = (s) => lsSet('rk.settings', s);

  RK.store = {
    Store, normalizeChart, notesSignature, timeline, barBeats, barStarts, barAt, isBarLine, meterList, chartLength, tileCount, playableCount, partCounts, pickPart, isTile,
    P, LAYER_NAMES, PART_NAMES, partLabel, partSet, countFor, fmtTime, newId,
    TIMING_PRESETS, DEFAULT_SETTINGS, loadSettings, saveSettings, lsGet, lsSet,
  };
})();
