// Rainbow Keys — reading uploaded files.
//   .txt              typed song sheet (see notation.js)
//   .mid .midi        MIDI files from any music app
//   .musicxml .xml    MusicXML (MuseScore, Finale, Sibelius, Dorico, Flat.io …)
//   .mxl              compressed MusicXML
//   .json             a Rainbow Keys chart
//   images, .pdf      kept as a picture beside the editor so you can type the notes in
(function () {
  'use strict';
  const RK = (window.RK = window.RK || {});
  const { LETTERS, laneOfMidi } = RK.notes;

  function kindOf(file) {
    const n = (file.name || '').toLowerCase();
    if (/\.(txt|text|abc|sheet)$/.test(n) || file.type === 'text/plain') return 'text';
    if (/\.midi?$/.test(n) || /midi/.test(file.type)) return 'midi';
    if (/\.mxl$/.test(n)) return 'mxl';
    if (/\.(musicxml|xml)$/.test(n)) return 'xml';
    if (/\.json$/.test(n)) return 'json';
    if (/\.pdf$/.test(n) || file.type === 'application/pdf') return 'pdf';
    if (/^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|bmp)$/.test(n)) return 'image';
    return null;
  }

  // ---------------- MIDI ----------------
  function parseMidi(buf) {
    const d = new DataView(buf);
    let p = 0;
    const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); return s; };
    if (str(4) !== 'MThd') throw new Error('not a MIDI file');
    const hlen = d.getUint32(4);
    const format = d.getUint16(8), ntrks = d.getUint16(10), div = d.getUint16(12);
    if (div & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
    p = 8 + hlen;
    const tempos = [], timeSigs = [], keySigs = [];
    const notes = [];
    const names = [];
    for (let t = 0; t < ntrks && p < d.byteLength - 8; t++) {
      if (str(4) !== 'MTrk') { p += 8 + d.getUint32(p + 4); t--; continue; }
      const len = d.getUint32(p + 4);
      let q = p + 8;
      const end = q + len;
      let tick = 0, status = 0;
      const open = new Map();
      const vlq = () => { let v = 0, b; do { b = d.getUint8(q++); v = (v << 7) | (b & 0x7f); } while (b & 0x80 && q < end); return v; };
      while (q < end) {
        tick += vlq();
        let s = d.getUint8(q);
        if (s & 0x80) { q++; status = s; } else s = status;
        if (s === 0xff) {
          const type = d.getUint8(q++); const l = vlq();
          if (type === 0x51 && l === 3) tempos.push({ tick, us: (d.getUint8(q) << 16) | (d.getUint8(q + 1) << 8) | d.getUint8(q + 2) });
          else if (type === 0x58 && l >= 2) timeSigs.push({ tick, n: d.getUint8(q), d: 1 << d.getUint8(q + 1) });
          else if (type === 0x59 && l >= 1) keySigs.push({ tick, sf: d.getInt8(q) });
          else if (type === 0x03 && !names[t]) { let s2 = ''; for (let i = 0; i < l; i++) s2 += String.fromCharCode(d.getUint8(q + i)); names[t] = s2.trim(); }
          q += l;
        } else if (s === 0xf0 || s === 0xf7) {
          q += vlq();
        } else {
          const type = s & 0xf0, ch = s & 0x0f;
          const a = d.getUint8(q), b = type === 0xc0 || type === 0xd0 ? 0 : d.getUint8(q + 1);
          q += type === 0xc0 || type === 0xd0 ? 1 : 2;
          const key = ch * 128 + a;
          if (type === 0x90 && b > 0) {
            if (!open.has(key)) open.set(key, []);
            open.get(key).push({ tick, vel: b });
          } else if (type === 0x80 || (type === 0x90 && b === 0)) {
            const st = open.get(key);
            if (st && st.length) {
              const on = st.shift();
              notes.push({ track: t, ch, midi: a, tick: on.tick, len: Math.max(1, tick - on.tick), vel: on.vel });
            }
          }
        }
      }
      for (const [key, st] of open) for (const on of st) notes.push({ track: t, ch: Math.floor(key / 128), midi: key % 128, tick: on.tick, len: div, vel: on.vel });
      p = end;
    }
    // split into parts: by track, and by channel when one track holds several
    const parts = new Map();
    for (const n of notes) {
      const id = `${n.track}:${n.ch}`;
      if (!parts.has(id)) parts.set(id, { id, track: n.track, ch: n.ch, notes: [] });
      parts.get(id).notes.push(n);
    }
    const perTrack = new Map();
    for (const pt of parts.values()) perTrack.set(pt.track, (perTrack.get(pt.track) || 0) + 1);
    const q24 = (x) => Math.round(x * 24) / 24;
    const toBeat = (tick) => tick / div;
    tempos.sort((a, b) => a.tick - b.tick);
    const tempoList = (tempos.length ? tempos : [{ tick: 0, us: 500000 }]).map((t) => ({ b: q24(toBeat(t.tick)), bpm: Math.round((60000000 / t.us) * 10) / 10, label: '' }));
    const dedup = [];
    for (const t of tempoList) { if (!dedup.length || Math.abs(dedup[dedup.length - 1].bpm - t.bpm) > 0.5) dedup.push(t); }
    if (dedup[0].b > 0) dedup.unshift({ b: 0, bpm: dedup[0].bpm, label: '' });
    const ts = timeSigs[0] ? [timeSigs[0].n, timeSigs[0].d] : [4, 4];
    const keySig = keySigs[0] ? Math.max(-7, Math.min(7, keySigs[0].sf)) : 0;
    return {
      source: 'midi', format, keySig, timeSig: ts, tempos: dedup.slice(0, 200),
      parts: [...parts.values()].map((pt) => ({
        id: pt.id,
        name: (names[pt.track] || `Track ${pt.track + 1}`) + (perTrack.get(pt.track) > 1 ? ` · ch ${pt.ch + 1}` : ''),
        drums: pt.ch === 9,
        notes: pt.notes.map((n) => ({ b: q24(toBeat(n.tick)), d: Math.max(1 / 24, q24(toBeat(n.len))), midi: n.midi, lane: laneOfMidi(n.midi, keySig < 0) })),
      })),
    };
  }

  // ---------------- MusicXML ----------------
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const UNIT = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 };
  function parseMusicXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('the MusicXML file could not be read');
    const root = doc.documentElement;
    if (root.nodeName === 'score-timewise') throw new Error('timewise MusicXML is not supported; export as "partwise" (the normal option)');
    if (root.nodeName !== 'score-partwise') throw new Error('this XML file is not MusicXML');
    const kid = (el, name) => { for (const c of el.children) if (c.nodeName === name) return c; return null; };
    const txt = (el, name) => { const c = el && kid(el, name); return c ? c.textContent.trim() : null; };
    const partNames = {};
    for (const sp of root.querySelectorAll('part-list > score-part')) partNames[sp.getAttribute('id')] = txt(sp, 'part-name') || sp.getAttribute('id');
    const title = root.querySelector('work > work-title')?.textContent.trim() || root.querySelector('movement-title')?.textContent.trim() || '';
    const composer = [...root.querySelectorAll('identification > creator')].find((c) => (c.getAttribute('type') || '') === 'composer')?.textContent.trim() || '';
    let keySig = null, timeSig = null;
    const tempos = [];
    const parts = [];
    for (const part of root.querySelectorAll(':scope > part')) {
      const pid = part.getAttribute('id');
      let divisions = 1, measureStart = 0;
      const byStaff = new Map();
      const ties = new Map(); // `${staff}|${midi}` -> note waiting for its tie
      for (const m of part.children) {
        if (m.nodeName !== 'measure') continue;
        let pos = 0, maxPos = 0, lastStart = 0;
        for (const el of m.children) {
          switch (el.nodeName) {
            case 'attributes': {
              const dv = txt(el, 'divisions'); if (dv) divisions = +dv || 1;
              const k = kid(el, 'key'); if (k && keySig == null) keySig = Math.max(-7, Math.min(7, +txt(k, 'fifths') || 0));
              const t = kid(el, 'time'); if (t && !timeSig) { const bt = +txt(t, 'beats'), bty = +txt(t, 'beat-type'); if (bt && bty) timeSig = [bt, bty]; }
              break;
            }
            case 'backup': pos -= (+txt(el, 'duration') || 0); break;
            case 'forward': pos += (+txt(el, 'duration') || 0); maxPos = Math.max(maxPos, pos); break;
            case 'direction': case 'sound': {
              const snd = el.nodeName === 'sound' ? el : el.querySelector('sound');
              const beat = (measureStart + pos / divisions);
              if (snd && snd.getAttribute('tempo')) tempos.push({ b: beat, bpm: +snd.getAttribute('tempo'), label: el.querySelector('words')?.textContent.trim().slice(0, 30) || '' });
              else {
                const met = el.querySelector('metronome');
                if (met) {
                  const unit = UNIT[txt(met, 'beat-unit')] || 1;
                  const dot = kid(met, 'beat-unit-dot') ? 1.5 : 1;
                  const pm = +txt(met, 'per-minute');
                  if (pm) tempos.push({ b: beat, bpm: pm * unit * dot, label: '' });
                }
              }
              break;
            }
            case 'note': {
              if (kid(el, 'grace') || kid(el, 'cue')) break;
              const dur = (+txt(el, 'duration') || 0) / divisions;
              const isChord = !!kid(el, 'chord');
              const start = isChord ? lastStart : pos;
              if (!isChord) { lastStart = pos; pos += +txt(el, 'duration') || 0; maxPos = Math.max(maxPos, pos); }
              const pitch = kid(el, 'pitch');
              if (!pitch || kid(el, 'rest')) break;
              const step = txt(pitch, 'step'), alter = Math.round(+txt(pitch, 'alter') || 0), oct = +txt(pitch, 'octave');
              const midi = 12 * (oct + 1) + STEP[step] + alter;
              const staff = +txt(el, 'staff') || 1;
              const b = measureStart + start / divisions;
              const tieTypes = [...el.children].filter((c) => c.nodeName === 'tie').map((c) => c.getAttribute('type'));
              const key = `${staff}|${midi}`;
              if (tieTypes.includes('stop') && ties.has(key)) {
                const prev = ties.get(key);
                prev.d = b + dur - prev.b;
                if (!tieTypes.includes('start')) ties.delete(key);
                break;
              }
              const n = { b, d: Math.max(1 / 24, dur), midi, lane: LETTERS.indexOf(step) };
              if (!byStaff.has(staff)) byStaff.set(staff, []);
              byStaff.get(staff).push(n);
              if (tieTypes.includes('start')) ties.set(key, n);
              break;
            }
          }
        }
        measureStart += Math.max(maxPos, pos) / divisions;
      }
      const multi = byStaff.size > 1;
      for (const [staff, notes] of [...byStaff.entries()].sort((a, b) => a[0] - b[0])) {
        const pname = partNames[pid] || pid;
        const label = multi ? `${pname} · ${staff === 1 ? 'upper staff (RH)' : staff === 2 ? 'lower staff (LH)' : 'staff ' + staff}` : pname;
        parts.push({ id: `${pid}:${staff}`, name: label, drums: /drum|percussion/i.test(pname), notes });
      }
    }
    tempos.sort((a, b) => a.b - b.b);
    const tl = tempos.length ? tempos : [{ b: 0, bpm: 90, label: '' }];
    if (tl[0].b > 0) tl.unshift({ b: 0, bpm: tl[0].bpm, label: '' });
    return { source: 'musicxml', title, composer, keySig: keySig ?? 0, timeSig: timeSig || [4, 4], tempos: tl.slice(0, 200), parts };
  }

  // ---------------- .mxl (zip) ----------------
  async function unzipText(buf, wanted) {
    const d = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (d.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('the .mxl file is damaged');
    const count = d.getUint16(eocd + 10, true);
    let p = d.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const entries = [];
    for (let k = 0; k < count; k++) {
      if (d.getUint32(p, true) !== 0x02014b50) break;
      const method = d.getUint16(p + 10, true), csize = d.getUint32(p + 20, true);
      const nlen = d.getUint16(p + 28, true), xlen = d.getUint16(p + 30, true), clen = d.getUint16(p + 32, true);
      const local = d.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
      entries.push({ name, method, csize, local });
      p += 46 + nlen + xlen + clen;
    }
    async function read(e) {
      const ln = d.getUint16(e.local + 26, true), lx = d.getUint16(e.local + 28, true);
      const data = new Uint8Array(buf, e.local + 30 + ln + lx, e.csize);
      if (e.method === 0) return dec.decode(data);
      if (e.method !== 8) throw new Error('unsupported compression in .mxl');
      if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot open .mxl files; export uncompressed MusicXML instead');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    }
    let target = null;
    const container = entries.find((e) => e.name === 'META-INF/container.xml');
    if (container) {
      const xml = await read(container);
      const m = /full-path="([^"]+)"/.exec(xml);
      if (m) target = entries.find((e) => e.name === m[1]);
    }
    target = target || entries.find((e) => /\.(xml|musicxml)$/i.test(e.name) && !e.name.startsWith('META-INF'));
    if (!target) throw new Error('no score found inside the .mxl file');
    return read(target);
  }

  // ---------------- turn parsed parts into a chart ----------------
  // roles: { partId: 'treble' | 'bassclef' | 'backing' | 'off' }
  // In a treble part the top note at each moment is the melody and the rest accompaniment;
  // in a bass-clef part the lowest note is the bass and the rest accompaniment.
  function partsToChart(parsed, roles) {
    const notes = [];
    for (const part of parsed.parts) {
      const role = roles[part.id] || 'off';
      if (role === 'off') continue;
      const byBeat = new Map();
      for (const n of part.notes) {
        const k = n.b.toFixed(4);
        if (!byBeat.has(k)) byBeat.set(k, []);
        byBeat.get(k).push(n);
      }
      for (const group of byBeat.values()) {
        const top = Math.max(...group.map((n) => n.midi)), low = Math.min(...group.map((n) => n.midi));
        for (const n of group) {
          let part = 5;
          if (role === 'treble') part = n.midi === top ? 0 : 1;
          else if (role === 'bassclef') part = n.midi === low ? 2 : 3;
          notes.push([+n.b.toFixed(4), n.midi, +n.d.toFixed(4), n.lane, part]);
        }
      }
    }
    // start at the first note, rounded down to a bar
    const bar = (parsed.timeSig[0] * 4) / parsed.timeSig[1];
    const first = notes.length ? Math.min(...notes.map((n) => n[0])) : 0;
    const shift = Math.floor(first / bar + 1e-6) * bar;
    for (const n of notes) n[0] = +(n[0] - shift).toFixed(4);
    // one tile per lane and moment: drop exact duplicates
    const seen = new Set();
    const out = notes.filter((n) => { const k = `${n[0]}|${n[1]}|${n[4]}`; if (seen.has(k)) return false; seen.add(k); return true; });
    return {
      keySig: parsed.keySig, timeSig: parsed.timeSig,
      tempos: parsed.tempos.map((t) => ({ ...t, b: Math.max(0, +(t.b - shift).toFixed(4)) })).filter((t, i, a) => i === 0 || t.b > 0),
      notes: out,
    };
  }

  function guessRoles(parsed) {
    const roles = {};
    const usable = parsed.parts.filter((p) => !p.drums && p.notes.length);
    const avg = (p) => p.notes.reduce((a, n) => a + n.midi, 0) / p.notes.length;
    const sorted = usable.slice().sort((a, b) => avg(b) - avg(a));
    const lead = sorted[0], bass = sorted.length > 1 ? sorted[sorted.length - 1] : null;
    for (const p of parsed.parts) {
      // MusicXML piano parts say which staff a note is on: staff 1 is the treble clef, staff 2 the bass clef
      const staff = /:(\d+)$/.exec(p.id)?.[1];
      const piano = parsed.source === 'musicxml' && parsed.parts.some((q) => q !== p && q.id.split(':')[0] === p.id.split(':')[0]);
      if (p.drums || !p.notes.length) roles[p.id] = 'off';
      else if (piano) roles[p.id] = staff === '1' ? 'treble' : 'bassclef';
      else roles[p.id] = p === lead ? 'treble' : p === bass ? 'bassclef' : 'backing';
    }
    return roles;
  }

  // ---------------- images & PDF (kept as reference pictures) ----------------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`couldn't load ${src}`));
      document.head.append(s);
    });
  }
  let pdfReady = null;
  function ensurePdf() {
    if (!pdfReady) {
      // the worker script is loaded on the page itself so this also works from file:// and plain servers
      pdfReady = loadScript('js/lib/pdf.min.js').then(() => loadScript('js/lib/pdf.worker.min.js')).then(() => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/lib/pdf.worker.min.js';
        return window.pdfjsLib;
      });
    }
    return pdfReady;
  }
  async function pdfToPages(buf, onProgress) {
    const lib = await ensurePdf();
    const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    const pages = [];
    const max = Math.min(doc.numPages, 16);
    for (let i = 1; i <= max; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1.8 });
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      pages.push(await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.88)));
      onProgress?.(i / max);
    }
    return { pages, total: doc.numPages };
  }

  // ---------------- entry point ----------------
  // Returns { type: 'text'|'parts'|'chart'|'reference', ... }
  async function readFile(file, onProgress) {
    const kind = kindOf(file);
    if (!kind) throw new Error(`"${file.name}" isn't a file type I can read`);
    if (file.size > 25 * 1024 * 1024) throw new Error('that file is over 25 MB');
    const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80);
    switch (kind) {
      case 'text': return { type: 'text', text: await file.text(), name: base };
      case 'json': {
        const raw = JSON.parse(await file.text());
        if (!raw || !Array.isArray(raw.notes)) throw new Error("that JSON file isn't a Rainbow Keys chart");
        return { type: 'chart', chart: raw, name: base };
      }
      case 'midi': return { type: 'parts', parsed: parseMidi(await file.arrayBuffer()), name: base };
      case 'xml': return { type: 'parts', parsed: parseMusicXml(await file.text()), name: base };
      case 'mxl': return { type: 'parts', parsed: parseMusicXml(await unzipText(await file.arrayBuffer())), name: base };
      case 'image': return { type: 'reference', pages: [file], name: base };
      case 'pdf': {
        const { pages, total } = await pdfToPages(await file.arrayBuffer(), onProgress);
        return { type: 'reference', pages, name: base, truncated: total > pages.length };
      }
    }
    return null;
  }

  const ACCEPT = '.txt,.text,.mid,.midi,.musicxml,.xml,.mxl,.json,.pdf,image/*';
  RK.importers = { readFile, kindOf, parseMidi, parseMusicXml, partsToChart, guessRoles, ACCEPT };
})();
