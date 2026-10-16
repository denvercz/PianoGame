// Rainbow Keys — the sheet translator.
// Turns a typed song sheet (letters, do-re-mi or numbered notation) into a chart,
// and turns a chart back into a sheet you can read and edit.
(function () {
  'use strict';
  const RK = (window.RK = window.RK || {});
  const { LETTERS, NAT, keySigAlter, parseKey, spell, keySigName } = RK.notes;

  const SOLFEGE = { do: 0, re: 1, mi: 2, fa: 3, sol: 4, so: 4, la: 5, ti: 6, si: 6 };
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const EPS = 1e-6;

  const HEADER_KEYS = {
    title: 'title', name: 'title', song: 'title',
    by: 'composer', composer: 'composer', artist: 'composer', author: 'composer',
    tempo: 'tempo', bpm: 'tempo', speed: 'tempo',
    time: 'time', meter: 'time', 'time signature': 'time',
    key: 'key', 'key signature': 'key',
    notation: 'notation', mode: 'notation',
    octave: 'octave',
    perfect: 'perfect', 'perfect ms': 'perfect',
    unit: 'unit', units: 'unit', length: 'unit', lengths: 'unit',
    section: 'section', part: 'section',
    description: 'description', about: 'description',
  };
  // Line prefixes say which hand plays a line and what it does:
  //   RH:  treble clef melody (0)        RHA: treble clef accompaniment (1)
  //   LH:  bass clef bass line (2)       LHA: bass clef accompaniment (3)     LHM: bass clef melody (4)
  //   BG:  backing, never a tile (5)     (melody: / accomp: / bass: / treble: / V2: also work)
  const VOICE_RE = /^\s*((?:rh|lh)(?:a|m)?\d*|right(?:\s*hand)?|left(?:\s*hand)?|melody|accomp(?:animent)?|bass|treble|(?:bg|backing|auto)\d*|v\d{1,2}|voice\s*\d{1,2})\s*(\((?:auto|backing|bg)\))?\s*:\s*(.*)$/i;

  function voiceInfo(name, flag) {
    const n = name.toLowerCase().replace(/\s+/g, '');
    let key = n, part = 0;
    if (n === 'right' || n === 'righthand' || n === 'melody' || n === 'treble') key = 'rh';
    if (n === 'left' || n === 'lefthand' || n === 'bass') key = 'lh';
    if (n === 'accomp' || n === 'accompaniment') key = 'rha';
    if (n.startsWith('voice')) key = 'v' + n.slice(5);
    if (/^rha\d*$/.test(key)) part = 1;
    else if (/^lha\d*$/.test(key)) part = 3;
    else if (/^lhm\d*$/.test(key)) part = 4;
    else if (/^lh\d*$/.test(key)) part = 2;
    if (flag || /^(bg|backing|auto)\d*$/.test(n)) part = 5;
    return { key, part };
  }

  function parseDurationNumber(s) {
    const m = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(s);
    if (!m) return null;
    const v = m[2] ? +m[1] / +m[2] : +m[1];
    return v > 0 && v <= 4096 ? v : null;
  }

  // "unit:" says what ":1" means. beat (a quarter note, the default) or a note value like whole / half / 1/8.
  function parseUnit(v) {
    const t = String(v).trim().toLowerCase();
    const words = { beat: 1, beats: 1, quarter: 1, crotchet: 1, '1/4': 1, whole: 4, 'whole note': 4, semibreve: 4, '1/1': 4, '1': 4, note: 4, notes: 4, half: 2, minim: 2, '1/2': 2, eighth: 0.5, quaver: 0.5, '1/8': 0.5, sixteenth: 0.25, '1/16': 0.25, bar: 'bar', bars: 'bar', measure: 'bar' };
    if (t in words) return words[t];
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
    if (m && +m[2]) return (4 * +m[1]) / +m[2];
    return null;
  }
  const fmtBeats = (v) => (Math.abs(v - Math.round(v)) < 1e-4 ? String(Math.round(v)) : String(+v.toFixed(2)));
  const UNIT_NAMES = { 1: 'beats (quarter notes)', 4: 'whole notes', 2: 'half notes', 0.5: 'eighth notes', 0.25: 'sixteenth notes', bar: 'bars' };

  // ---------------- parser ----------------
  function parseSheet(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const meta = { title: '', composer: '', description: '', keySig: 0, timeSig: [4, 4], tempo: null, tempoLabel: '', notation: null, octave: 4, tonic: null, perfectMs: null, unit: null };
    const warnings = [];
    const warn = (line, col, msg) => { if (warnings.length < 60) warnings.push({ line, col, msg }); };

    // pass 1: headers, voices, and which notation the body uses
    const body = []; // { line, text, voice }
    let jpKey = null;
    let letterHits = 0, digitHits = 0;
    // a blank line ends a paragraph: like one line (system) of printed music, all hands start the next one together
    let para = 0, paraHasNotes = false;
    lines.forEach((raw, i) => {
      if (!raw.trim()) { if (paraHasNotes) { para++; paraHasNotes = false; } return; }
      // comments: a line starting with // or %, or " // " after the notes ("//" glued to a note is a 16th)
      let line = raw.replace(/(^|\s)\/\/(\s.*)?$/, '');
      if (/^\s*(\/\/|%|#\s|#$)/.test(line)) return;
      if (!line.trim()) return;
      const jp = /^\s*1\s*=\s*([A-Ga-g][#b♯♭]?)\s*(.*)$/.exec(line);
      if (jp) {
        meta.notation = 'numbers';
        meta.tonic = jp[1];
        jpKey = parseKey(jp[1]);
        line = jp[2];
        if (!line.trim()) return;
      }
      const vm = VOICE_RE.exec(line);
      if (!vm) {
        const hm = /^\s*([A-Za-z][A-Za-z ]{0,15}?)\s*[:=]\s*(.*)$/.exec(line);
        if (hm && HEADER_KEYS[hm[1].toLowerCase()]) {
          if (paraHasNotes) { para++; paraHasNotes = false; }
          body.push({ line: i + 1, header: HEADER_KEYS[hm[1].toLowerCase()], value: hm[2].trim() });
          return;
        }
        if (/^\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/.test(line)) { body.push({ line: i + 1, header: 'time', value: line.trim() }); return; }
      }
      const voice = vm ? voiceInfo(vm[1], vm[2]) : null;
      const content = vm ? vm[3] : line;
      body.push({ line: i + 1, text: content, voice, offset: vm ? line.length - vm[3].length : 0, para });
      paraHasNotes = true;
      const scan = content.replace(/\{[^}]*\}/g, ' ');
      letterHits += (scan.match(/(^|[\s|\[+])([A-Ga-g]|do|re|mi|fa|sol?|la|ti|si)(?=[#b♯♭n♮0-9'\-\/.:+\]\s|]|$)/gi) || []).length;
      digitHits += (scan.match(/(^|[\s|\[+])[#b♯♭]?[0-7](?=[',\-\/.:+\]\s|]|$)/g) || []).length;
    });
    // headers placed before any notes apply to the whole song
    let seenNotes = false;
    for (const b of body) {
      if (!b.header) { seenNotes = true; continue; }
      if (seenNotes && (b.header === 'tempo' || b.header === 'time' || b.header === 'section')) { b.late = true; continue; }
      applyHeader(b, true);
    }
    function applyHeader(b, early) {
      const v = b.value;
      switch (b.header) {
        case 'title': meta.title = v.slice(0, 80); break;
        case 'composer': meta.composer = v.slice(0, 80); break;
        case 'description': meta.description = v.slice(0, 400); break;
        case 'time': {
          const m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(v);
          if (m && [1, 2, 4, 8, 16].includes(+m[2])) meta.timeSig = [+m[1], +m[2]];
          else warn(b.line, 1, `Time should look like 4/4 or 3/4, not "${v}"`);
          break;
        }
        case 'key': {
          const k = parseKey(v.replace(/\s*(major|minor)$/i, (x) => (/minor/i.test(x) ? 'm' : '')));
          if (k == null) warn(b.line, 1, `Unknown key "${v}". Try C, G, F, Bb, Am or 2#`);
          else meta.keySig = k;
          if (k != null && meta.notation === 'numbers' && !meta.tonic) meta.tonic = v.replace(/\s*(m|min|minor|maj|major)$/i, '');
          break;
        }
        case 'notation':
          if (/num|jian|digit|1234/i.test(v)) meta.notation = 'numbers';
          else if (/let|abc|name/i.test(v)) meta.notation = 'letters';
          else if (/sol|do/i.test(v)) meta.notation = 'letters';
          break;
        case 'perfect': {
          const m = /(\d{2,3})/.exec(v);
          if (m && +m[1] >= 20 && +m[1] <= 150) meta.perfectMs = +m[1];
          else warn(b.line, 1, 'perfect: should be a number of milliseconds from 20 to 150, e.g. perfect: 45');
          break;
        }
        case 'unit': {
          const u = parseUnit(v);
          if (u == null) warn(b.line, 1, `unit: should be beat, whole, half, eighth, bar or a note value like 1/8 (not "${v}")`);
          else meta.unit = u;
          break;
        }
        case 'section': break;
        case 'octave': {
          const o = parseInt(v, 10);
          if (o >= 0 && o <= 8) meta.octave = o; else warn(b.line, 1, 'Octave should be a number from 1 to 7');
          break;
        }
        case 'tempo': {
          const m = /(\d{2,3}(?:\.\d+)?)/.exec(v);
          if (!m) { warn(b.line, 1, `Tempo should be a number like 90`); break; }
          if (early) { meta.tempo = Math.max(20, Math.min(320, +m[1])); meta.tempoLabel = v.replace(m[1], '').replace(/bpm/i, '').trim().slice(0, 30); }
          break;
        }
      }
    }
    if (jpKey != null) meta.keySig = jpKey; // "1=D" wins over a key: line
    const mode = meta.notation || (digitHits > letterHits ? 'numbers' : 'letters');

    // tonic for numbered notation
    let tonicLane = 0, tonicAlter = 0;
    if (mode === 'numbers' && meta.tonic) {
      const m = /^([A-Ga-g])([#b♯♭]?)/.exec(meta.tonic);
      if (m) {
        tonicLane = LETTERS.indexOf(m[1].toUpperCase());
        tonicAlter = /[#♯]/.test(m[2]) ? 1 : /[b♭]/.test(m[2]) ? -1 : 0;
      }
    }

    function readAtom(s, i) {
      const rest = s.slice(i);
      let m;
      // rest
      if ((m = /^(rest|r|_)(?![a-z])/i.exec(rest)) || (mode === 'numbers' && (m = /^0(?![0-9])/.exec(rest)))) {
        return { rest: true, end: i + m[0].length };
      }
      if (mode === 'numbers') {
        m = /^([#b♯♭]?)([1-7])((?:'|’|,)*)/.exec(rest);
        if (!m) return null;
        const deg = +m[2] - 1;
        const acc = /[#♯]/.test(m[1]) ? 1 : /[b♭]/.test(m[1]) ? -1 : 0;
        const marks = m[3] || '';
        const oct = (marks.match(/['’]/g) || []).length - (marks.match(/,/g) || []).length;
        const lane = (tonicLane + deg) % 7;
        const midi = 12 * (meta.octave + 1) + NAT[tonicLane] + tonicAlter + MAJOR[deg] + acc + 12 * oct;
        return { pitch: [midi, lane], end: i + m[0].length };
      }
      let lane, j;
      if ((m = /^(do|re|mi|fa|sol|so|la|ti|si)(?![a-z])/i.exec(rest))) {
        lane = SOLFEGE[m[1].toLowerCase()]; j = m[0].length;
      } else if (/^[A-Ga-g]/.test(rest)) {
        lane = LETTERS.indexOf(rest[0].toUpperCase()); j = 1;
      } else return null;
      // accidental
      let alter = null;
      const am = /^(##|bb|𝄪|𝄫|#|♯|b|♭|n|♮)/.exec(rest.slice(j));
      if (am) {
        const a = am[1];
        alter = a === '##' || a === '𝄪' ? 2 : a === 'bb' || a === '𝄫' ? -2 : a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0;
        j += a.length;
      }
      if (alter == null) alter = keySigAlter(meta.keySig, lane);
      let octave = meta.octave;
      const om = /^\d/.exec(rest.slice(j));
      if (om) { octave = +om[0]; j += 1; }
      while (rest[j] === "'" || rest[j] === '’') { octave++; j++; }
      if (octave < 0 || octave > 8) return null;
      return { pitch: [12 * (octave + 1) + NAT[lane] + alter, lane], end: i + j };
    }

    // pass 2: notes. Run with a length unit; returns the notes plus how well the bars add up.
    function pass2(unit) {
      const out = { warnings: [], tempos: [], meters: [], fit: 0, misfit: 0 };
      const w2 = (line, col, msg) => { if (out.warnings.length < 60) out.warnings.push({ line, col, msg }); };
      const voices = new Map();
      let sectionStart = 0;
      let meter = { b: 0, n: meta.timeSig[0], d: meta.timeSig[1] };
      const meterList = [meter];
      const barLenAt = (beat) => {
        let m = meterList[0];
        for (const x of meterList) if (x.b <= beat + EPS) m = x;
        return (m.n * 4) / m.d;
      };
      const meterAt = (beat) => { let m = meterList[0]; for (const x of meterList) if (x.b <= beat + EPS) m = x; return m; };
      const getVoice = (v) => {
        const key = v ? v.key : 'rh';
        if (!voices.has(key)) voices.set(key, { key, name: (v ? v.key : 'rh').toUpperCase(), cursor: sectionStart, last: null, part: v ? v.part : 0, events: [], bars: [] });
        const vs = voices.get(key);
        if (v && v.part === 5) vs.part = 5;
        return vs;
      };
      let lastVoice = null;
      let noteCount = 0;
      const tempos = out.tempos;

      // a new paragraph (or a header after the notes) starts a new section:
      // every hand lines up at the furthest point reached, and new hands start there too
      let paraVoices = new Set(), paraFirst = null, paraLast = null, curPara = null;
      function sync() {
        const list = [...voices.values()];
        if (!list.length) return sectionStart;
        const target = Math.max(sectionStart, ...list.map((v) => v.cursor));
        const here = [...paraVoices];
        if (here.length > 1) {
          const lens = here.map((v) => v.cursor - sectionStart);
          if (Math.max(...lens) - Math.min(...lens) > 0.01) {
            const where = paraFirst === paraLast ? `Line ${paraFirst}` : `Lines ${paraFirst}–${paraLast}`;
            w2(paraFirst, 1, `${where}: the hands don't add up to the same length (${here.map((v, k) => `${v.name} ${fmtBeats(lens[k])} beats`).join(', ')}). The next lines start together after the longest.`);
          }
        }
        for (const v of list) { v.cursor = target; v.last = null; }
        sectionStart = target;
        paraVoices = new Set(); paraFirst = null; paraLast = null;
        return target;
      }

      for (const blk of body) {
        if (blk.header) {
          if (!blk.late) continue;
          const at = sync();
          curPara = null;
          if (blk.header === 'tempo') {
            const m = /(\d{2,3}(?:\.\d+)?)/.exec(blk.value);
            if (m) tempos.push({ b: at, bpm: Math.max(20, Math.min(320, +m[1])), label: blk.value.replace(m[1], '').replace(/bpm/i, '').trim().slice(0, 30) });
            else w2(blk.line, 1, 'Tempo should be a number like 90');
          } else if (blk.header === 'time') {
            const m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(blk.value);
            if (m && [1, 2, 4, 8, 16].includes(+m[2])) {
              if (at < EPS) { meta.timeSig = [+m[1], +m[2]]; meterList[0] = { b: 0, n: +m[1], d: +m[2] }; }
              else {
                while (meterList.length > 1 && meterList[meterList.length - 1].b >= at - EPS) meterList.pop();
                meterList.push({ b: at, n: +m[1], d: +m[2] });
              }
            } else w2(blk.line, 1, `Time should look like 4/4 or 3/4, not "${blk.value}"`);
          }
          continue;
        }
        if (curPara != null && blk.para !== curPara) sync();
        curPara = blk.para;
        const vs = getVoice(blk.voice);
        paraVoices.add(vs);
        if (paraFirst == null) paraFirst = blk.line;
        paraLast = blk.line;
        lastVoice = vs;
        const before = noteCount;
        const snap = { cursor: vs.cursor, n: vs.events.length, last: vs.last, tempos: tempos.length, bars: vs.bars.length };
        const bad = [];
        const good = parseLine(blk.text, blk.line, blk.offset, vs, bad);
        const looksLikeWords = bad.length >= 2 && bad.length > good;
        if (looksLikeWords) {
          noteCount = before;
          vs.cursor = snap.cursor; vs.events.length = snap.n; vs.last = snap.last; tempos.length = snap.tempos; vs.bars.length = snap.bars;
        }
        if (looksLikeWords || (noteCount === before && bad.length)) {
          w2(blk.line, 1, `Line ${blk.line} skipped: no notes found (lyrics or notes I can't read?)`);
        } else {
          for (const x of bad.slice(0, 6)) w2(blk.line, x.col, x.msg);
        }
      }

      function parseLine(s, lineNo, colOffset, vs, bad) {
        let i = 0, good = 0;
        const n = s.length;
        const isWordEnd = (j) => j >= n || /[\s|\[\]+,;{}]/.test(s[j]);
        let lastBar = null; // cursor at the previous "|" on this line
        while (i < n) {
          const ch = s[i];
          if (ch === '|') {
            // a full bar between two bar lines should match the time signature
            if (lastBar != null && vs.cursor - lastBar > EPS) vs.bars.push({ from: lastBar, len: vs.cursor - lastBar, line: lineNo });
            lastBar = vs.cursor; i++; continue;
          }
          if (/[\s,;]/.test(ch)) { i++; continue; }
          if (ch === '{') {
            const j = s.indexOf('}', i);
            const inner = s.slice(i + 1, j < 0 ? n : j);
            const m = /(?:tempo|bpm)?\s*=?\s*(\d{2,3}(?:\.\d+)?)\s*(.*)/i.exec(inner);
            if (m) tempos.push({ b: vs.cursor, bpm: Math.max(20, Math.min(320, +m[1])), label: m[2].replace(/bpm/i, '').trim().slice(0, 30) });
            else bad.push({ col: colOffset + i + 1, msg: `Unknown instruction {${inner}}` });
            i = j < 0 ? n : j + 1;
            continue;
          }
          if (ch === '-' && (i === 0 || /[\s|]/.test(s[i - 1]))) {
            // standalone dash: hold the previous note one more beat
            let k = 0;
            while (s[i] === '-') { k++; i++; }
            if (vs.last) { vs.last.dur += k; }
            else bad.push({ col: colOffset + i, msg: 'A "-" needs a note before it' });
            vs.cursor += k;
            continue;
          }
          const start = i;
          let atoms = [];
          let isChord = false;
          if (ch === '[') {
            isChord = true;
            const j = s.indexOf(']', i);
            const inner = s.slice(i + 1, j < 0 ? n : j);
            i = j < 0 ? n : j + 1;
            let k = 0;
            while (k < inner.length) {
              if (/[\s+,]/.test(inner[k])) { k++; continue; }
              const a = readAtom(inner, k);
              if (!a) { bad.push({ col: colOffset + start + k + 2, msg: `Didn't understand "${inner[k]}" inside [ ]` }); k++; continue; }
              atoms.push(a); k = a.end;
            }
          } else {
            const a = readAtom(s, i);
            if (!a) {
              let j = i; while (j < n && !/[\s|]/.test(s[j])) j++;
              bad.push({ col: colOffset + i + 1, msg: `Didn't understand "${s.slice(i, j)}"` });
              i = j; continue;
            }
            atoms.push(a); i = a.end;
            while (s[i] === '+') {
              const b2 = readAtom(s, i + 1);
              if (!b2) break;
              isChord = true; atoms.push(b2); i = b2.end;
            }
          }
          // duration suffixes
          let dur = 1, explicit = null, tie = false;
          while (i < n) {
            const c = s[i];
            if (c === '-') { if (explicit != null) tie = true; else dur += 1; i++; }
            else if (c === '/') { dur /= 2; i++; }
            else if (c === '.') { dur *= 1.5; i++; }
            else if (c === ':') {
              const m = /^:(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)/.exec(s.slice(i));
              const v = m && parseDurationNumber(m[1]);
              if (v == null) { bad.push({ col: colOffset + i + 1, msg: 'After ":" put a length, like :2 or :1/3' }); i++; break; }
              explicit = v * (unit === 'bar' ? barLenAt(vs.cursor) : unit); i += m[0].length;
            } else break;
          }
          // "F5:1/2-r:1/8": a dash glued to the next note or rest just separates them
          const glued = s[i - 1] === '-' && i < n && (s[i] === '[' || readAtom(s, i));
          if (!isWordEnd(i) && s[i] !== '[' && s[i] !== '{' && !glued) {
            let j = i; while (j < n && !/[\s|]/.test(s[j])) j++;
            bad.push({ col: colOffset + start + 1, msg: `Didn't understand "${s.slice(start, j)}"` });
            i = j;
            continue;
          }
          good++;
          if (explicit != null) dur = explicit;
          const pitches = atoms.filter((a) => !a.rest).map((a) => a.pitch);
          const ev = { beat: vs.cursor, dur, pitches };
          if (pitches.length) { vs.events.push(ev); noteCount += pitches.length; }
          vs.last = pitches.length ? ev : null;
          vs.cursor += dur;
          void tie;
        }
        return good;
      }

      sync(); // check the last paragraph too
      // bars that don't add up to the time signature
      const misfits = [];
      for (const v of voices.values()) {
        for (const bar of v.bars) {
          const want = barLenAt(bar.from);
          const k = bar.len / want;
          if (Math.abs(k - Math.round(k)) < 0.005 && k > 0.5) out.fit++;
          else { out.misfit++; misfits.push({ v, bar, want }); }
        }
      }
      misfits.sort((x, y) => x.bar.line - y.bar.line);
      const shown = new Set();
      for (const { v, bar, want } of misfits) {
        const k = `${bar.line}|${v.key}`;
        if (shown.has(k)) continue;
        shown.add(k);
        if (shown.size > 8) break;
        const m = meterAt(bar.from);
        w2(bar.line, 1, `A bar in ${v.name} adds up to ${fmtBeats(bar.len)} beat${Math.abs(bar.len - 1) < EPS ? '' : 's'}, but a ${m.n}/${m.d} bar is ${fmtBeats(want)} beats`);
      }
      if (misfits.length > shown.size && shown.size > 8) w2(misfits[misfits.length - 1].bar.line, 1, `…${misfits.length - 8} more bars don't add up`);

      // gather notes
      const notes = [];
      for (const vs of voices.values()) {
        for (const ev of vs.events) {
          const seen = new Set();
          for (const [midi, lane] of ev.pitches) {
            if (seen.has(midi)) continue;
            seen.add(midi);
            notes.push([+ev.beat.toFixed(4), Math.max(12, Math.min(119, midi)), +ev.dur.toFixed(4), lane, vs.part]);
          }
        }
      }
      notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      out.notes = notes;
      out.meters = meterList.slice(1).map((m) => ({ b: +m.b.toFixed(4), ts: [m.n, m.d] }));
      out.timeSig = [meterList[0].n, meterList[0].d];
      out.voices = [...voices.values()].filter((v) => v.events.length).map((v) => ({ key: v.key, part: v.part, count: v.events.length }));
      out.usesFractions = usesFractions;
      return out;
    }

    // which unit? the one written in the sheet, or the one that makes the bars add up
    const usesFractions = /:\d+\/\d+/.test(body.filter((x) => !x.header).map((x) => x.text).join(' '));
    let unit = meta.unit ?? 1, unitAuto = false;
    const baseTs = meta.timeSig.slice();
    let res = pass2(unit);
    if (meta.unit == null && usesFractions && res.misfit > 0) {
      for (const alt of [4, 'bar']) {
        meta.timeSig = baseTs.slice();
        const r2 = pass2(alt);
        if (r2.fit > res.fit && r2.misfit < res.misfit) { res = r2; unit = alt; unitAuto = true; }
      }
      if (!unitAuto) { meta.timeSig = baseTs.slice(); res = pass2(1); }
    }
    warnings.push(...res.warnings);
    if (warnings.length > 60) warnings.length = 60;
    warnings.sort((a, b) => a.line - b.line);

    const bpm = meta.tempo || 90;
    const tempoList = [{ b: 0, bpm, label: meta.tempoLabel || '' }, ...res.tempos.filter((t) => t.b > EPS)];
    return {
      mode, notes: res.notes, warnings,
      title: meta.title, composer: meta.composer, description: meta.description, perfectMs: meta.perfectMs,
      keySig: meta.keySig, timeSig: res.timeSig, meters: res.meters, tempos: tempoList,
      unit, unitAuto, unitName: UNIT_NAMES[unit] || `${fmtBeats(unit)} beats`,
      voices: res.voices,
    };
  }

  // ---------------- exporter ----------------
  function durSuffix(d) {
    const near = (a, b) => Math.abs(a - b) < 1e-4;
    if (near(d, 1)) return '';
    for (let k = 2; k <= 8; k++) if (near(d, k)) return '-'.repeat(k - 1);
    const table = [[0.5, '/'], [0.25, '//'], [0.125, '///'], [1.5, '.'], [0.75, '/.'], [0.375, '//.'], [3, '--']];
    for (const [v, s] of table) if (near(d, v)) return s;
    if (Math.abs(d - Math.round(d)) < 1e-4) return `:${Math.round(d)}`;
    for (let q = 2; q <= 24; q++) {
      const p = d * q;
      if (Math.abs(p - Math.round(p)) < 1e-3) return `:${Math.round(p)}/${q}`;
    }
    return `:${+d.toFixed(3)}`;
  }
  function pitchText(midi, lane, keySig, defOct) {
    const sp = spell(midi, lane);
    const ks = keySigAlter(keySig, lane);
    let acc = '';
    if (sp.alter !== ks) acc = sp.alter === 0 ? 'n' : sp.alter === 1 ? '#' : sp.alter === -1 ? 'b' : sp.alter === 2 ? '##' : 'bb';
    return sp.letter + acc + (sp.octave === defOct ? '' : String(sp.octave));
  }
  function keyText(sig) {
    return (keySigName(sig).major || 'C').replace('♭', 'b').replace('♯', '#');
  }

  function chartToSheet(chart, { barsPerLine = 4 } = {}) {
    const { barStarts } = RK.store;
    const head = [];
    head.push(`title: ${chart.title || 'Untitled'}`);
    if (chart.composer) head.push(`by: ${chart.composer}`);
    const t0 = chart.tempos[0];
    head.push(`tempo: ${Math.round(t0.bpm)}${t0.label ? ' ' + t0.label : ''}`);
    head.push(`time: ${chart.timeSig[0]}/${chart.timeSig[1]}`);
    head.push(`key: ${keyText(chart.keySig)}`);
    if (chart.perfectMs) head.push(`perfect: ${chart.perfectMs}`);

    // group simultaneous notes with equal length into chords
    const groups = new Map();
    for (const n of chart.notes) {
      const k = `${n[0].toFixed(4)}|${n[2].toFixed(4)}|${n[4]}`;
      if (!groups.has(k)) groups.set(k, { b: n[0], d: n[2], part: n[4], ps: [] });
      groups.get(k).ps.push([n[1], n[3]]);
    }
    const list = [...groups.values()].map((g) => ({ ...g, ps: g.ps.sort((a, b) => a[0] - b[0]), top: Math.max(...g.ps.map((p) => p[0])) }))
      .sort((a, b) => a.b - b.b || b.top - a.top);
    const voices = [];
    for (const g of list) {
      let v = voices.find((x) => x.part === g.part && x.end <= g.b + 1e-4);
      if (!v) { v = { part: g.part, end: 0, items: [], sum: 0 }; voices.push(v); }
      v.items.push(g); v.end = g.b + g.d; v.sum += g.top;
    }
    // RH lines = melody, LH lines = bass, BG lines = backing (busiest line of each first)
    const byCount = (a, b) => b.items.length - a.items.length;
    const named = (part, base) => voices.filter((v) => v.part === part).sort(byCount).map((v, i) => Object.assign(v, { name: i ? `${base}${i + 1}` : base }));
    const ordered = [...named(0, 'RH'), ...named(1, 'RHA'), ...named(4, 'LHM'), ...named(2, 'LH'), ...named(3, 'LHA'), ...named(5, 'BG')];
    const showNames = ordered.length > 1 || ordered.some((v) => v.part !== 0);

    const end = chart.notes.reduce((m, n) => Math.max(m, n[0] + n[2]), 0);
    const allBars = barStarts(chart, end + 64);
    let totalBars = allBars.findIndex((b) => b >= end - 1e-6);
    if (totalBars < 1) totalBars = Math.max(1, totalBars < 0 ? allBars.length : 1);
    const barSet = allBars.map((b) => b);
    const nextBarAfter = (a) => { for (const b of barSet) if (b > a + 1e-6) return b; return a + 4; };
    const onBarLine = (b) => barSet.some((x) => Math.abs(x - b) < 1e-4);
    const meterStarts = new Map((chart.meters || []).map((m) => [m.b.toFixed(4), m.ts]));
    const tempoMarks = chart.tempos.slice(1);

    // per voice: tokens with start beat
    const tokenized = ordered.map((v) => {
      const toks = [];
      let cur = 0;
      const pushRest = (from, to) => {
        // split rests at bar lines so they line up visually
        let a = from;
        while (to - a > 0.01) {
          const b = Math.min(to, nextBarAfter(a));
          toks.push({ b: a, d: b - a, text: 'r' + durSuffix(b - a) });
          a = b;
        }
      };
      for (const g of v.items) {
        if (g.b > cur + 0.01) pushRest(cur, g.b);
        const names = g.ps.map(([m, l]) => pitchText(m, l, chart.keySig, 4));
        const body = names.length > 1 ? `[${names.join(' ')}]` : names[0];
        toks.push({ b: g.b, text: body + durSuffix(g.d) });
        cur = g.b + g.d;
      }
      return { v, toks };
    });
    // tempo changes go into the first voice
    if (tokenized.length && tempoMarks.length) {
      const t = tokenized[0].toks;
      for (const tm of tempoMarks) {
        let idx = t.findIndex((x) => x.b >= tm.b - 1e-4);
        if (idx < 0) idx = t.length;
        t.splice(idx, 0, { b: tm.b, text: `{tempo ${Math.round(tm.bpm)}${tm.label ? ' ' + tm.label : ''}}`, mark: true });
      }
    }

    const out = [head.join('\n'), ''];
    const bpl = Math.max(1, barsPerLine);
    // blocks of bars; a time signature change always starts a new block with a "time:" line
    // a block of bars is one paragraph; the parser lines all hands up at each paragraph,
    // so a block never starts in the middle of a held note, and a time change starts a new one
    const crosses = (at) => list.some((g) => g.b < at - 1e-4 && g.b + g.d > at + 1e-4);
    const blocks = [];
    for (let i = 0; i < totalBars;) {
      let j = i + 1;
      while (j < totalBars && !meterStarts.has(allBars[j].toFixed(4)) && (j - i < bpl || (crosses(allBars[j]) && j - i < bpl * 4))) j++;
      const last = j >= totalBars;
      blocks.push({ from: allBars[i], to: last ? end : allBars[j], ts: i > 0 ? meterStarts.get(allBars[i].toFixed(4)) : null });
      i = j;
    }
    for (const { from, to, ts } of blocks) {
      const block = [];
      if (ts) out.push(`time: ${ts[0]}/${ts[1]}`, '');
      for (const { v, toks } of tokenized) {
        const mine = toks.filter((x) => x.b >= from - 1e-4 && x.b < to - 1e-4);
        if (!mine.length) continue;
        // a line that is only rest is left out: the hands line up again at the next paragraph
        if (mine.every((x) => x.d != null)) continue;
        // fold leading rests into one
        let lead = 0;
        while (mine.length && mine[0].d != null) lead += mine.shift().d;
        let line = lead ? 'r' + durSuffix(lead) + ' ' : '';
        let reach = from + lead;
        mine.forEach((x, i) => {
          const onBar = onBarLine(x.b);
          if (i > 0) line += onBar && !x.mark ? ' | ' : ' ';
          line += x.text;
        });
        for (const x of mine) if (x.d != null) reach = Math.max(reach, x.b + x.d);
        for (const g of v.items) if (g.b >= from - 1e-4 && g.b < to - 1e-4) reach = Math.max(reach, g.b + g.d);
        // fill the line to the end of the paragraph so every hand adds up to the same length
        if (to - reach > 0.01) line += (onBarLine(reach) ? ' | ' : ' ') + 'r' + durSuffix(to - reach);
        block.push((showNames ? `${v.name}: ` : '') + line);
      }
      if (block.length) out.push(block.join('\n'), '');
    }
    return out.join('\n').trim() + '\n';
  }

  const EXAMPLE = `title: Ode to Joy
by: Beethoven
tempo: 100
time: 4/4
key: C

// Letters are the 7 lanes. Put a number after a letter for its octave (C5).
// -  hold one more beat     /  half as long     .  dotted     r  rest
E E F G | G F E D | C C D E | E. D/ D- |
E E F G | G F E D | C C D E | D. C/ C- |
`;

  RK.notation = { parseSheet, chartToSheet, durSuffix, EXAMPLE };
})();
