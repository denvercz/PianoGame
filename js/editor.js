// Rainbow Keys — the song editor.
//   Sheet tab: type or paste notes as text; it is translated live.
//   Roll tab:  a 7-row grid (C at the bottom, B at the top) to add, move, stretch and fix notes.
// A picture or PDF of the sheet can sit beside either tab while you work.
(function () {
  'use strict';
  const RK = (window.RK = window.RK || {});
  const { LETTERS, LANE_COLORS, LANES, NAT, spell, noteName, midiOf, keySigAlter, keySigName, keySigLetters } = RK.notes;
  const { timeline, barBeats, barAt, barStarts, isBarLine, normalizeChart, chartLength, partCounts, playableCount, fmtTime, notesSignature } = RK.store;
  // part codes: 0 treble melody, 1 treble accomp., 2 bass clef bass, 3 bass clef accomp., 4 bass clef melody, 5 backing
  const PART_LABEL = { 0: 'Treble · melody', 1: 'Treble · accompaniment', 2: 'Bass clef · bass', 3: 'Bass clef · accompaniment', 4: 'Bass clef · melody', 5: 'Backing (never a tile)' };
  const LAYER_OF = { 0: 'melody', 4: 'melody', 1: 'accomp', 3: 'accomp', 2: 'bass', 5: 'backing' };
  const { parseSheet, chartToSheet, EXAMPLE } = RK.notation;
  const { $, $$, el, esc, modal, confirmBox, toast, download, pickFile } = RK.ui;

  const DURATIONS = [
    { d: 0.25, name: '16th', kind: '16th' },
    { d: 1 / 3, name: 'Triplet', kind: 'eighth', trip: true },
    { d: 0.5, name: 'Eighth', kind: 'eighth' },
    { d: 0.75, name: 'Dot 8th', kind: 'eighth', dot: true },
    { d: 1, name: 'Quarter', kind: 'quarter' },
    { d: 1.5, name: 'Dot ¼', kind: 'quarter', dot: true },
    { d: 2, name: 'Half', kind: 'half' },
    { d: 3, name: 'Dot ½', kind: 'half', dot: true },
    { d: 4, name: 'Whole', kind: 'whole' },
  ];
  function noteSvg(kind, dot, trip) {
    const filled = kind !== 'whole' && kind !== 'half';
    const flags = kind === 'eighth' ? 1 : kind === '16th' ? 2 : 0;
    let s = '<svg viewBox="0 0 13 15" width="20" height="23" shape-rendering="crispEdges" aria-hidden="true">';
    s += filled ? '<rect x="2" y="10" width="5" height="4" fill="currentColor"/><rect x="1" y="11" width="7" height="2" fill="currentColor"/>'
      : '<rect x="2" y="10" width="5" height="1" fill="currentColor"/><rect x="2" y="13" width="5" height="1" fill="currentColor"/><rect x="1" y="11" width="1" height="2" fill="currentColor"/><rect x="7" y="11" width="1" height="2" fill="currentColor"/>';
    if (kind !== 'whole') s += '<rect x="7" y="2" width="1" height="10" fill="currentColor"/>';
    for (let i = 0; i < flags; i++) s += `<rect x="8" y="${3 + i * 3}" width="2" height="1" fill="currentColor"/><rect x="10" y="${4 + i * 3}" width="1" height="2" fill="currentColor"/>`;
    if (dot) s += '<rect x="10" y="11" width="2" height="2" fill="currentColor"/>';
    if (trip) s += '<rect x="9" y="0" width="1" height="1" fill="currentColor"/><rect x="11" y="0" width="1" height="1" fill="currentColor"/><rect x="10" y="1" width="1" height="1" fill="currentColor"/>';
    return s + '</svg>';
  }
  const TEMPO_PRESETS = [['Lento', 52], ['Adagio', 66], ['Andante', 80], ['Moderato', 100], ['Allegro', 126], ['rit.', null], ['a tempo', null]];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const EPS = 1e-4;

  class Editor {
    constructor({ audio, store, getSettings, onExit, onTest, laneOfCode, saveSheet, deleteSheet }) {
      Object.assign(this, { audio, store, getSettings, onExit, onTest, laneOfCode, saveSheet, deleteSheet });
      this.cv = $('#ed-roll');
      this.c = this.cv.getContext('2d');
      this.ppb = 72; this.scroll = 0;
      this.durIdx = 4; this.octave = 4; this.accMode = 'key'; this.part = 0;
      this.held = new Set(); this.stepAdded = [];
      this.sel = new Set();
      this.drag = null; this.hover = null; this.listen = null;
      this.active = false;
      this.tab = 'sheet';
      this.refUrls = [];
      this.refZoom = 1;
      this.clip = null;
      this.buildChrome();
      this.bindCanvas();
      addEventListener('resize', () => this.active && this.resize());
      this.draw = this.draw.bind(this);
    }

    // ---------- open / close ----------
    async open(chart, { tab, text, refPages, info, isNew } = {}) {
      this.chart = normalizeChart(JSON.parse(JSON.stringify(chart)));
      this.isNew = !!isNew;
      this.undoStack = []; this.redoStack = [];
      this.cursor = 0; this.scroll = 0; this.sel.clear();
      this.dirty = !!isNew;
      this.active = true;
      // sheet text: keep what the user typed if it still matches the notes
      const sig = notesSignature(this.chart.notes);
      if (typeof text === 'string') { this.text = text; this.textSig = null; }
      else if (this.chart.sheetText && this.chart.sheetSig === sig) { this.text = this.chart.sheetText; this.textSig = sig; }
      else { this.text = this.chart.notes.length ? chartToSheet(this.chart) : this.starterText(); this.textSig = sig; }
      $('#ed-text').value = this.text;
      this.fillFields();
      this.refreshTimeline();
      await this.loadRef(refPages);
      this.setTab(tab || (this.chart.notes.length && !text ? 'roll' : 'sheet'), true);
      if (typeof text === 'string') this.reparse(true);
      else this.renderParseStatus(null);
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.draw);
      this.updateStatus();
      if (info) toast(info);
    }
    starterText() {
      const c = this.chart;
      return `title: ${c.title}\n${c.composer ? 'by: ' + c.composer + '\n' : ''}tempo: ${Math.round(c.tempos[0].bpm)}\ntime: ${c.timeSig[0]}/${c.timeSig[1]}\nkey: ${(keySigName(c.keySig).major || 'C').replace('♭', 'b').replace('♯', '#')}\n\n`;
    }
    close() {
      this.active = false;
      this.stopListen();
      this.audio.allOff();
      cancelAnimationFrame(this.raf);
      this.clearRefUrls();
    }
    async requestExit() {
      if (this.dirty) {
        const v = await modal({
          title: 'Save changes?', body: 'This song has changes that are not saved yet.',
          actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Discard', value: 'discard', danger: true }, { label: 'Save', value: 'save', kind: 'primary' }],
        });
        if (v === 'save') { if (!(await this.save())) return; }
        else if (v !== 'discard') return;
        else if (this.isNew) this.store.deleteRef(this.chart.id);
      }
      const id = this.isNew && this.dirty ? null : this.chart.id;
      this.close();
      this.onExit(id);
    }

    // ---------- chrome ----------
    buildChrome() {
      const ks = $('#ed-key');
      for (let s = -7; s <= 7; s++) {
        const k = keySigName(s);
        ks.append(el('option', { value: s, text: `${k.major} major / ${k.minor} minor (${k.short})` }));
      }
      const dc = $('#ed-durs');
      DURATIONS.forEach((d, i) => {
        const b = el('button', { class: 'dur', type: 'button', title: `${d.name} (↑ ↓)`, onclick: () => { this.setDuration(i); } },
          el('span', { class: 'dur-glyph', html: noteSvg(d.kind, d.dot, d.trip) }), el('span', { class: 'dur-name', text: d.name }));
        dc.append(b);
      });
      const mark = () => { this.dirty = true; this.updateStatus(); };
      $('#ed-title').addEventListener('input', (e) => { this.chart.title = e.target.value; this.syncHeader('title', e.target.value); mark(); });
      $('#ed-composer').addEventListener('input', (e) => { this.chart.composer = e.target.value; this.syncHeader('by', e.target.value); mark(); });
      ks.addEventListener('change', (e) => {
        this.chart.keySig = +e.target.value;
        this.syncHeader('key', (keySigName(this.chart.keySig).major || 'C').replace('♭', 'b').replace('♯', '#'));
        mark();
      });
      $('#ed-time').addEventListener('change', (e) => {
        this.chart.timeSig = e.target.value.split('/').map(Number);
        this.syncHeader('time', e.target.value);
        this.refreshTimeline(); mark();
      });
      $('#ed-bpm').addEventListener('change', (e) => {
        this.snapshot();
        this.chart.tempos[0].bpm = clamp(+e.target.value || 90, 20, 320);
        e.target.value = this.chart.tempos[0].bpm;
        this.syncHeader('tempo', `${Math.round(this.chart.tempos[0].bpm)}${this.chart.tempos[0].label ? ' ' + this.chart.tempos[0].label : ''}`);
        this.refreshTimeline(); mark();
      });
      $('#ed-diff').addEventListener('change', (e) => { this.chart.difficulty = +e.target.value; mark(); });

      const act = {
        back: () => this.requestExit(), save: () => this.save(), listen: () => this.toggleListen(),
        test: () => this.testPlay(), tempo: () => this.editTempo(), undo: () => this.undo(), redo: () => this.redo(),
        exportChart: () => this.exportChart(), exportSheet: () => this.exportSheet(), importInto: () => this.importInto(),
        clear: () => this.clearAll(), remove: () => this.removeSong(), help: () => $('#ed-help').classList.toggle('open'),
        addRef: () => this.addRef(), removeRef: () => this.removeRef(), toggleRef: () => this.toggleRef(),
        refIn: () => this.zoomRef(1.25), refOut: () => this.zoomRef(0.8),
        tabSheet: () => this.setTab('sheet'), tabRoll: () => this.setTab('roll'),
        guide: () => $('#sheet-guide').classList.toggle('open'),
        example: () => this.insertExample(),
        octDown: () => this.shiftOctave(-1), octUp: () => this.shiftOctave(1),
        selDelete: () => this.deleteSelection(),
        rebuild: () => this.rebuildText(),
      };
      $$('[data-ed]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault();
        $('#ed-menu').classList.remove('open');
        act[b.dataset.ed]?.();
        if (b.dataset.ed !== 'back') b.blur();
      }));
      $('#ed-more').addEventListener('click', (e) => { e.stopPropagation(); $('#ed-menu').classList.toggle('open'); });
      document.addEventListener('click', () => $('#ed-menu').classList.remove('open'));
      $$('#ed-acc button').forEach((b) => b.addEventListener('click', () => {
        if (this.sel.size) this.setSelAlter(b.dataset.v); else { this.accMode = b.dataset.v; this.updateStatus(); }
      }));
      $('#ed-part').addEventListener('change', (e) => {
        const v = +e.target.value;
        if (!(v >= 0)) return;
        if (this.sel.size) this.setSelPart(v); else { this.part = v; this.updateStatus(); }
        e.target.blur();
      });
      // the song's own Perfect window
      $('#ed-perfect').addEventListener('change', (e) => {
        const v = Math.round(+e.target.value);
        if (e.target.value === '' || !v) { delete this.chart.perfectMs; this.removeHeader('perfect'); }
        else { this.chart.perfectMs = clamp(v, 20, 150); e.target.value = this.chart.perfectMs; this.syncHeader('perfect', String(this.chart.perfectMs)); }
        this.dirty = true; this.updateStatus(); this.updatePerfectHint();
      });
      // live translation while typing
      const ta = $('#ed-text');
      ta.addEventListener('input', () => {
        this.text = ta.value;
        this.dirty = true;
        this.pendingParse = true;
        clearTimeout(this.parseTimer);
        this.parseTimer = setTimeout(() => this.reparse(), 280);
        $('#ed-dirty').textContent = 'Unsaved';
        $('#ed-dirty').className = 'ed-dirty on';
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') { e.preventDefault(); document.execCommand?.('insertText', false, '  '); }
      });
      $('#sheet-warn').addEventListener('click', (e) => {
        // only the "Line N" button jumps, so the message text can be selected and copied
        const btn = e.target.closest('.wl');
        const li = btn && btn.closest('li[data-line]');
        if (li) this.jumpToLine(+li.dataset.line);
      });
    }

    fillFields() {
      const c = this.chart;
      $('#ed-title').value = c.title;
      $('#ed-composer').value = c.composer;
      $('#ed-key').value = c.keySig;
      const ts = `${c.timeSig[0]}/${c.timeSig[1]}`, tsel = $('#ed-time');
      if (![...tsel.options].some((o) => o.value === ts)) tsel.append(el('option', { value: ts, text: ts }));
      tsel.value = ts;
      $('#ed-bpm').value = Math.round(c.tempos[0].bpm);
      $('#ed-diff').value = c.difficulty;
      $('#ed-perfect').value = c.perfectMs || '';
      this.updatePerfectHint();
      const rm = $('[data-ed="remove"]');
      rm.textContent = c.bundled ? 'Reset to original…' : 'Delete this song…';
      rm.hidden = (c.bundled && !c.edited) || this.isNew;
    }
    refreshTimeline() { this.tl = timeline(this.chart); }
    updatePerfectHint() {
      const g = this.getSettings().perfect;
      $('#ed-perfect').placeholder = String(g);
      $('#ed-perfect-hint').textContent = this.chart.perfectMs
        ? `This song: Perfect within ±${this.chart.perfectMs} ms. Default is 40–50 ms; clear the box to use your Settings (${g} ms).`
        : `Using your Settings: ±${g} ms. Default is 40–50 ms; type a number here to set this song's own.`;
    }
    removeHeader(name) {
      const lines = this.text.split('\n');
      const i = lines.findIndex((l) => new RegExp(`^\\s*${name}\\s*[:=]`, 'i').test(l));
      if (i >= 0) { lines.splice(i, 1); this.text = lines.join('\n'); $('#ed-text').value = this.text; }
    }

    setTab(tab, silent) {
      if (tab === 'sheet' && this.tab === 'roll') {
        const sig = notesSignature(this.chart.notes);
        if (sig !== this.textSig && !silent) {
          this.text = chartToSheet(this.chart);
          this.textSig = sig;
          $('#ed-text').value = this.text;
          this.renderParseStatus(null);
          toast('Sheet updated from your changes in the roll');
        }
      }
      if (tab === 'roll' && this.tab === 'sheet') {
        clearTimeout(this.parseTimer);
        if (this.pendingParse) this.reparse();
      }
      if (tab === this.tab && !silent) return;
      this.tab = tab;
      $('#screen-editor').dataset.tab = tab;
      $$('.ed-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.ed === (tab === 'sheet' ? 'tabSheet' : 'tabRoll')));
      if (tab === 'roll') requestAnimationFrame(() => { this.resize(); this.ensureVisible(true); });
      else setTimeout(() => $('#ed-text').focus({ preventScroll: true }), 30);
      this.updateStatus();
    }

    // keep a header line in the sheet text in step with the fields above it
    syncHeader(name, value) {
      if (this.tab !== 'sheet' && this.textSig !== notesSignature(this.chart.notes)) return;
      const lines = this.text.split('\n');
      const re = new RegExp(`^\\s*(${name === 'by' ? 'by|composer|artist|author' : name === 'tempo' ? 'tempo|bpm|speed' : name === 'time' ? 'time|meter' : name === 'title' ? 'title|name|song' : name})\\s*[:=]`, 'i');
      const i = lines.findIndex((l) => re.test(l));
      const line = `${name}: ${value}`;
      if (i >= 0) lines[i] = line;
      else {
        let at = 0;
        while (at < lines.length && /^\s*[A-Za-z][A-Za-z ]*\s*[:=]/.test(lines[at]) && !/^\s*(rh|lh|bg|v\d)/i.test(lines[at])) at++;
        lines.splice(at, 0, line);
      }
      this.text = lines.join('\n');
      $('#ed-text').value = this.text;
      if (name === 'key') this.reparse();
    }

    // ---------- sheet translation ----------
    reparse(first = false) {
      this.pendingParse = false;
      const r = parseSheet(this.text);
      const c = this.chart;
      const before = notesSignature(c.notes);
      if (!first && notesSignature(r.notes) !== before) this.snapshot();
      c.notes = r.notes;
      c.tempos = r.tempos;
      c.timeSig = r.timeSig;
      if (r.meters && r.meters.length) c.meters = r.meters; else delete c.meters;
      c.keySig = r.keySig;
      if (r.title) c.title = r.title;
      if (r.composer) c.composer = r.composer;
      if (r.description) c.description = r.description;
      if (r.perfectMs) c.perfectMs = r.perfectMs;
      this.textSig = notesSignature(c.notes);
      this.fillFields();
      this.refreshTimeline();
      this.sel.clear();
      this.renderParseStatus(r);
      this.updateStatus();
      return r;
    }
    renderParseStatus(r) {
      const box = $('#sheet-warn'), st = $('#sheet-status');
      const c = this.chart;
      const pc = partCounts(c);
      const len = chartLength(c);
      const mode = r ? (r.mode === 'numbers' ? 'numbered notation (1–7)' : 'letters') : null;
      st.innerHTML = `Treble <b>${pc.treble}</b> · Bass clef <b>${pc.bassclef}</b>${pc.backing ? ` · ${pc.backing} backing` : ''} · ${fmtTime(len.sec)}${mode ? ` · reading <b>${mode}</b>` : ''}${r && r.unit !== 1 ? ` · <span title="What a length after ':' means">:lengths in <b>${r.unitName}</b>${r.unitAuto ? ' (guessed)' : ''}</span>` : ''}${c.meters ? ` · ${c.meters.length} time change${c.meters.length > 1 ? 's' : ''}` : ''}`;
      box.innerHTML = '';
      this.lastWarnings = r ? r.warnings : [];
      if (r && r.warnings.length) {
        const copy = el('button', { class: 'pxbtn tiny copy-warn', type: 'button', text: 'COPY', title: 'Copy all messages as text' });
        copy.addEventListener('click', (e) => { e.stopPropagation(); this.copyWarnings(); });
        box.append(el('li', { class: 'warn-head' }, el('span', { text: `${r.warnings.length} message${r.warnings.length > 1 ? 's' : ''} · select text or ` }), copy));
        for (const w of r.warnings.slice(0, 40)) box.append(el('li', { 'data-line': w.line }, el('button', { class: 'wl', type: 'button', text: `Line ${w.line}`, title: 'Jump to this line' }), el('span', { class: 'wm', text: ` ${w.msg}` })));
        if (r.warnings.length > 40) box.append(el('li', { text: `…and ${r.warnings.length - 40} more (COPY gets them all)` }));
      }
      box.hidden = !box.children.length;
      this.renderTranslation();
    }
    copyWarnings() {
      const text = (this.lastWarnings || []).map((w) => `Line ${w.line}: ${w.msg}`).join('\n');
      const done = () => toast('Messages copied', 'ok');
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => this.copyFallback(text, done));
      else this.copyFallback(text, done);
    }
    copyFallback(text, done) {
      const ta = document.createElement('textarea');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch { toast('Select the messages and press Ctrl+C', 'bad'); }
      ta.remove();
    }
    // the "translation" strip: the first notes as lanes and keys
    renderTranslation() {
      const strip = $('#sheet-preview');
      strip.innerHTML = '';
      const s = this.getSettings();
      const want = RK.store.partSet(RK.store.pickPart(this.chart, this.getSettings().part));
      const tiles = this.chart.notes.filter((n) => want.has(n[4])).slice(0, 48);
      if (!tiles.length) { strip.append(el('span', { class: 'muted', text: 'Your notes will show here as keys to press.' })); return; }
      let lastB = null;
      for (const n of tiles) {
        if (lastB != null && Math.abs(n[0] - lastB) < EPS) { strip.lastChild.append(this.chip(n, s)); continue; }
        lastB = n[0];
        strip.append(el('span', { class: 'tp-step' }, this.chip(n, s)));
      }
      if (this.chart.notes.filter((n) => want.has(n[4])).length > 48) strip.append(el('span', { class: 'muted', text: '…' }));
    }
    chip(n, s) {
      const col = LANE_COLORS[n[3]];
      return el('span', { class: 'tp', style: { '--c': col[0], '--cd': col[1] }, title: noteName(n[1], n[3]) },
        el('b', { text: s.bindings[n[3]].label }), el('i', { text: noteName(n[1], n[3], false) }));
    }
    jumpToLine(line) {
      const ta = $('#ed-text');
      const lines = ta.value.split('\n');
      let pos = 0;
      for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
      ta.focus();
      ta.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.scrollTop = Math.max(0, (line - 4) * lh);
    }
    insertExample() {
      const ta = $('#ed-text');
      if (ta.value.trim() && !/^\s*(title|tempo|time|key|by)\s*:[^\n]*\n?(\s*(title|tempo|time|key|by)\s*:[^\n]*\n?)*\s*$/i.test(ta.value)) {
        confirmBox('Replace with the example?', 'This replaces the text in the sheet with a short example you can play with.', 'Replace').then((ok) => ok && this.setText(EXAMPLE));
      } else this.setText(EXAMPLE);
    }
    setText(t) { this.text = t; $('#ed-text').value = t; this.dirty = true; this.reparse(); }
    rebuildText() {
      this.text = chartToSheet(this.chart); this.textSig = notesSignature(this.chart.notes);
      $('#ed-text').value = this.text; this.renderParseStatus(null); toast('Sheet rewritten from the notes');
    }

    // ---------- status ----------
    updateStatus() {
      const c = this.chart, ba = barAt(c, this.cursor);
      const barN = ba.index + 1;
      const beatIn = this.cursor - ba.start;
      const fmt = (v) => (Math.abs(v - Math.round(v)) < EPS ? String(Math.round(v)) : String(+v.toFixed(2)));
      $('#ed-pos').innerHTML = `<b>Bar ${barN}</b> · beat ${fmt(beatIn + 1)}`;
      const len = chartLength(c), pc = partCounts(c);
      $('#ed-count').textContent = `Treble ${pc.treble} · Bass clef ${pc.bassclef} · ${fmtTime(len.sec)}`;
      $('#ed-dirty').textContent = this.dirty ? 'Unsaved' : 'Saved';
      $('#ed-dirty').className = `ed-dirty ${this.dirty ? 'on' : ''}`;
      $$('#ed-durs .dur').forEach((b, i) => b.classList.toggle('on', i === this.durIdx));
      const selN = this.sel.size;
      $('#ed-selinfo').textContent = selN ? `${selN} note${selN > 1 ? 's' : ''} selected` : 'New notes';
      $('#ed-octave').textContent = selN ? '±' : String(this.octave);
      $('#screen-editor').classList.toggle('has-sel', selN > 0);
      const selArr = [...this.sel];
      const selAlter = selN ? new Set(selArr.map((n) => spell(n[1], n[3]).alter)) : null;
      $$('#ed-acc button').forEach((b) => {
        const v = b.dataset.v;
        let on;
        if (selN) on = v !== 'key' && selAlter.size === 1 && String([...selAlter][0]) === (v === 'n' ? '0' : v === 's' ? '1' : '-1');
        else on = this.accMode === v;
        b.classList.toggle('on', !!on);
        b.hidden = selN > 0 && v === 'key';
      });
      const selPart = selN ? new Set(selArr.map((n) => n[4])) : null;
      $('#ed-part').value = selN ? (selPart.size === 1 ? String([...selPart][0]) : '') : String(this.part);
      const k = keySigName(c.keySig), letters = keySigLetters(c.keySig);
      $('#ed-tip').innerHTML = c.keySig === 0
        ? `<b>${esc(k.label)}</b> · no sharps or flats.`
        : `<b>${esc(k.label)}</b> · every ${letters.join(' ')} is ${c.keySig < 0 ? 'flat ♭' : 'sharp ♯'}. It still lands on its letter's lane.`;
      $('#ed-ref-btn').classList.toggle('on', !$('#ed-ref').hidden);
    }

    // ---------- undo ----------
    snapshot() {
      this.undoStack.push({ notes: this.chart.notes.map((n) => n.slice()), tempos: this.chart.tempos.map((t) => ({ ...t })), cursor: this.cursor });
      if (this.undoStack.length > 300) this.undoStack.shift();
      this.redoStack = [];
    }
    restore(from, to) {
      const s = from.pop(); if (!s) return false;
      to.push({ notes: this.chart.notes.map((n) => n.slice()), tempos: this.chart.tempos.map((t) => ({ ...t })), cursor: this.cursor });
      this.chart.notes = s.notes; this.chart.tempos = s.tempos; this.cursor = s.cursor;
      this.sel.clear();
      this.dirty = true; this.refreshTimeline(); this.ensureVisible(); this.updateStatus();
      if (this.tab === 'sheet') { this.text = chartToSheet(this.chart); this.textSig = notesSignature(this.chart.notes); $('#ed-text').value = this.text; this.renderParseStatus(null); }
      return true;
    }
    undo() { if (!this.restore(this.undoStack, this.redoStack)) toast('Nothing to undo'); }
    redo() { if (!this.restore(this.redoStack, this.undoStack)) toast('Nothing to redo'); }

    // ---------- notes ----------
    get dur() { return DURATIONS[this.durIdx].d; }
    get snapStep() { const d = this.dur; return Math.abs(d - 1 / 3) < EPS ? 1 / 3 : Math.min(0.25, d); }
    setDuration(i) {
      this.durIdx = clamp(i, 0, DURATIONS.length - 1);
      if (this.sel.size) {
        this.snapshot();
        for (const n of this.sel) n[2] = this.dur;
        this.dirty = true;
      }
      this.updateStatus();
      if (this.tab === 'roll') this.cv.focus({ preventScroll: true });
    }
    sortNotes() { this.chart.notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]); }
    newAlter(lane) {
      if (this.accMode === 'key') return keySigAlter(this.chart.keySig, lane);
      return this.accMode === 's' ? 1 : this.accMode === 'f' ? -1 : 0;
    }
    makeNote(beat, lane) {
      return [+beat.toFixed(4), midiOf(lane, this.newAlter(lane), this.octave), this.dur, lane, this.part];
    }
    addNote(note) {
      if (this.chart.notes.some((n) => n[1] === note[1] && Math.abs(n[0] - note[0]) < EPS && n[4] === note[4])) return null;
      this.chart.notes.push(note);
      this.sortNotes();
      this.dirty = true;
      return note;
    }
    shiftOctave(d) {
      if (this.sel.size) {
        this.snapshot();
        for (const n of this.sel) n[1] = clamp(n[1] + 12 * d, 12, 119);
        this.dirty = true; this.previewSel();
      } else this.octave = clamp(this.octave + d, 1, 7);
      this.updateStatus();
    }
    setSelAlter(v) {
      if (v === 'key') return;
      this.snapshot();
      const want = v === 's' ? 1 : v === 'f' ? -1 : 0;
      for (const n of this.sel) { const sp = spell(n[1], n[3]); n[1] = midiOf(n[3], want, sp.octave); }
      this.dirty = true; this.previewSel(); this.updateStatus();
    }
    setSelPart(v) {
      this.snapshot();
      for (const n of this.sel) n[4] = v;
      this.dirty = true; this.updateStatus();
    }
    deleteSelection() {
      if (!this.sel.size) return;
      this.snapshot();
      this.chart.notes = this.chart.notes.filter((n) => !this.sel.has(n));
      this.sel.clear(); this.dirty = true; this.updateStatus();
    }
    moveSelection(db, dl) {
      if (!this.sel.size) return;
      this.snapshot();
      const minB = Math.min(...[...this.sel].map((n) => n[0]));
      if (minB + db < 0) db = -minB;
      for (const n of this.sel) {
        n[0] = +(n[0] + db).toFixed(4);
        if (dl) {
          const sp = spell(n[1], n[3]);
          let lane = n[3] + dl, oct = sp.octave;
          while (lane > 6) { lane -= 7; oct++; }
          while (lane < 0) { lane += 7; oct--; }
          n[3] = lane; n[1] = clamp(midiOf(lane, keySigAlter(this.chart.keySig, lane), oct), 12, 119);
        }
      }
      this.sortNotes(); this.dirty = true;
      if (dl) this.previewSel();
      this.updateStatus();
    }
    previewSel() {
      const list = [...this.sel].slice(0, 6);
      for (const n of list) { const v = this.audio.play(n[1], { vel: 0.6 }); v?.stop(this.audio.now() + 0.35); }
    }

    // ---------- keyboard ----------
    keyDown(e) {
      if (!this.active) return false;
      const ae = document.activeElement, tag = ae?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') { ae.blur(); return true; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { this.save(); return true; }
        if (tag === 'TEXTAREA' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { this.toggleListen(); return true; }
        return false;
      }
      const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (ctrl) {
        if (k === 's') { this.save(); return true; }
        if (k === 'z') { e.shiftKey ? this.redo() : this.undo(); return true; }
        if (k === 'y') { this.redo(); return true; }
        if (this.tab !== 'roll') return false;
        if (k === 'a') { this.chart.notes.forEach((n) => this.sel.add(n)); this.updateStatus(); return true; }
        if (k === 'c' || k === 'x') {
          if (!this.sel.size) return true;
          const minB = Math.min(...[...this.sel].map((n) => n[0]));
          this.clip = [...this.sel].map((n) => [n[0] - minB, ...n.slice(1)]);
          if (k === 'x') this.deleteSelection();
          toast(`${this.clip.length} note${this.clip.length > 1 ? 's' : ''} copied`);
          return true;
        }
        if (k === 'v') {
          if (!this.clip) return true;
          this.snapshot(); this.sel.clear();
          let end = 0;
          for (const n of this.clip) { const nn = [+(n[0] + this.cursor).toFixed(4), ...n.slice(1)]; if (this.addNote(nn)) this.sel.add(nn); end = Math.max(end, n[0] + n[2]); }
          this.cursor += end; this.ensureVisible(); this.updateStatus();
          return true;
        }
        return false;
      }
      if (e.altKey) return false;
      if (this.tab !== 'roll') {
        if (e.key === 'Escape') { this.requestExit(); return true; }
        return false;
      }
      const lane = this.laneOfCode(e.code);
      if (lane != null) {
        if (e.repeat) return true;
        this.stopListen();
        if (!this.held.size && !this.stepAdded.length) { this.snapshot(); this.sel.clear(); }
        this.held.add(lane);
        const note = this.addNote(this.makeNote(this.cursor, lane));
        if (note) { this.stepAdded.push(note); this.sel.add(note); }
        this.audio.keyDown('ed' + lane, [midiOf(lane, this.newAlter(lane), this.octave)]);
        this.updateStatus();
        return true;
      }
      const bar = barAt(this.chart, this.cursor).len, hasSel = this.sel.size > 0;
      switch (e.key) {
        case ' ': this.snapshot(); this.cursor += this.dur; this.ensureVisible(); break;
        case 'Backspace': this.undo(); break;
        case 'Delete':
          if (hasSel) this.deleteSelection();
          else {
            const keep = this.chart.notes.filter((n) => Math.abs(n[0] - this.cursor) >= EPS);
            if (keep.length !== this.chart.notes.length) { this.snapshot(); this.chart.notes = keep; this.dirty = true; }
          }
          break;
        case 'ArrowLeft': if (hasSel) this.moveSelection(-(e.shiftKey ? bar : this.snapStep), 0); else { this.cursor = Math.max(0, this.cursor - (e.shiftKey ? bar : this.snapStep)); this.ensureVisible(); } break;
        case 'ArrowRight': if (hasSel) this.moveSelection(e.shiftKey ? bar : this.snapStep, 0); else { this.cursor += e.shiftKey ? bar : this.snapStep; this.ensureVisible(); } break;
        case 'ArrowUp': if (hasSel) this.moveSelection(0, 1); else this.setDuration(this.durIdx + 1); break;
        case 'ArrowDown': if (hasSel) this.moveSelection(0, -1); else this.setDuration(this.durIdx - 1); break;
        case 'PageUp': this.shiftOctave(1); break;
        case 'PageDown': this.shiftOctave(-1); break;
        case 'Home': this.cursor = 0; this.scroll = 0; break;
        case 'End': this.jumpToEnd(); break;
        case 'Enter': this.toggleListen(); break;
        case 'Escape':
          if (this.listen) this.stopListen();
          else if (hasSel) this.sel.clear();
          else this.requestExit();
          break;
        default: return false;
      }
      this.updateStatus();
      return true;
    }
    keyUp(e) {
      if (!this.active) return;
      const lane = this.laneOfCode(e.code);
      if (lane == null || !this.held.has(lane)) return;
      this.held.delete(lane);
      this.audio.keyUp('ed' + lane);
      if (this.held.size === 0) {
        if (this.stepAdded.length) { this.cursor += this.dur; this.ensureVisible(); }
        else this.undoStack.pop();
        this.stepAdded = [];
        this.updateStatus();
      }
    }
    jumpToEnd() {
      this.cursor = this.chart.notes.reduce((m, n) => Math.max(m, n[0] + n[2]), 0);
      this.ensureVisible(true);
    }
    ensureVisible(center = false) {
      if (!this.gridW) return;
      const vis = this.gridW / this.ppb;
      if (center || this.cursor < this.scroll + 0.5 || this.cursor > this.scroll + vis - 2) this.scroll = Math.max(0, this.cursor - vis * (center ? 0.5 : 0.3));
    }

    // ---------- tempo marks ----------
    async editTempo(atBeat = this.cursor) {
      const existing = this.chart.tempos.find((t) => Math.abs(t.b - atBeat) < EPS);
      const prevBpm = this.tl.bpmAt(Math.max(0, atBeat - EPS));
      const bpmIn = el('input', { type: 'number', min: 20, max: 320, value: Math.round(existing?.bpm ?? prevBpm), class: 'field-input' });
      const labelIn = el('input', { type: 'text', maxlength: 30, value: existing?.label ?? '', placeholder: 'e.g. Andante, rit.', class: 'field-input' });
      const presets = el('div', { class: 'chips' }, TEMPO_PRESETS.map(([name, bpm]) => el('button', {
        class: 'chip', text: name, type: 'button',
        onclick: () => { labelIn.value = name; bpmIn.value = bpm || (name === 'a tempo' ? Math.round(this.chart.tempos[0].bpm) : Math.round(prevBpm * 0.8)); },
      })));
      const body = el('div', { class: 'form' },
        el('p', { class: 'modal-body', text: `Speed from bar ${barAt(this.chart, atBeat).index + 1} onward.` }),
        el('label', { class: 'field' }, el('span', { text: 'Beats per minute' }), bpmIn),
        el('label', { class: 'field' }, el('span', { text: 'Marking (optional)' }), labelIn), presets);
      const actions = [{ label: 'Cancel', value: null }];
      if (existing && atBeat > EPS) actions.push({ label: 'Remove', value: 'remove', danger: true });
      actions.push({ label: existing ? 'Update' : 'Add', value: 'ok', kind: 'primary' });
      const v = await modal({ title: existing ? 'Edit speed change' : 'Add speed change', body, actions });
      if (!v) return;
      this.snapshot();
      if (v === 'remove') this.chart.tempos = this.chart.tempos.filter((t) => t !== existing);
      else {
        const bpm = clamp(+bpmIn.value || prevBpm, 20, 320), label = labelIn.value.trim().slice(0, 30);
        if (existing) Object.assign(existing, { bpm, label });
        else this.chart.tempos.push({ b: +atBeat.toFixed(4), bpm, label });
        this.chart.tempos.sort((a, b) => a.b - b.b);
        $('#ed-bpm').value = Math.round(this.chart.tempos[0].bpm);
      }
      this.dirty = true; this.refreshTimeline(); this.updateStatus();
      if (this.tab === 'sheet') this.rebuildText();
    }

    // ---------- file actions ----------
    async save() {
      if (this.tab === 'sheet' && this.pendingParse) this.reparse();
      clearTimeout(this.parseTimer);
      const c = this.chart;
      c.title = (c.title || '').trim() || 'Untitled';
      const sig = notesSignature(c.notes);
      if (sig === this.textSig) { c.sheetText = this.text; c.sheetSig = sig; } else { delete c.sheetText; delete c.sheetSig; }
      c.hasRef = !!(this.refPages && this.refPages.length);
      // your own sheets are saved as .txt in the Inputs folder when that's possible
      if (!c.bundled && this.saveSheet) {
        const text = sig === this.textSig ? this.text : chartToSheet(c);
        const res = await this.saveSheet(c, text, { isNew: this.isNew });
        if (res && res.ok) {
          const oldId = c.id;
          Object.assign(c, { id: res.id, file: res.file, inputs: true, sheetText: text, sheetSig: sig });
          if (oldId !== c.id && this.refPages?.length) { await this.store.saveRef(c.id, { pages: this.refPages }); this.store.deleteRef(oldId); }
          this.text = text; this.textSig = sig;
          if (this.tab === 'sheet') $('#ed-text').value = text;
          this.dirty = false; this.isNew = false;
          this.fillFields(); this.updateStatus();
          toast(`Saved to Inputs/${res.file}`, 'ok');
          return true;
        }
      }
      try {
        const saved = this.store.saveSong(c);
        if (saved) { c.bundled = saved.bundled; c.edited = saved.edited; }
        this.dirty = false; this.isNew = false;
        this.fillFields(); this.updateStatus();
        toast(c.inputs ? 'Saved in this browser (the Inputs file was not changed)' : 'Saved in this browser', 'ok');
        return true;
      } catch (err) { toast(`Couldn't save: ${err.message}`, 'bad'); return false; }
    }
    testPlay() {
      if (this.tab === 'sheet') { clearTimeout(this.parseTimer); this.reparse(); }
      if (!playableCount(this.chart)) { toast('Add some melody or bass notes to play first'); return; }
      this.stopListen();
      this.onTest(normalizeChart(JSON.parse(JSON.stringify(this.chart))));
    }
    exportChart() {
      const data = { ...this.chart }; delete data.bundled; delete data.edited; delete data.sheetText; delete data.sheetSig;
      download(`${slug(this.chart.title)}.json`, data);
    }
    exportSheet() {
      const t = this.tab === 'sheet' ? this.text : chartToSheet(this.chart);
      download(`${slug(this.chart.title)}.txt`, t, 'text/plain');
    }
    async importInto() {
      const f = await pickFile('.txt,.json');
      if (!f) return;
      try {
        const txt = await f.text();
        if (/\.json$/i.test(f.name)) {
          const raw = JSON.parse(txt);
          if (!Array.isArray(raw.notes)) throw new Error("that isn't a chart file");
          this.snapshot();
          const keep = { id: this.chart.id, bundled: this.chart.bundled, edited: this.chart.edited, created: this.chart.created };
          this.chart = normalizeChart({ ...raw, ...keep });
          this.fillFields(); this.refreshTimeline(); this.dirty = true;
          this.rebuildText();
        } else this.setText(txt);
        toast('Imported', 'ok');
      } catch (err) { toast(`Import failed: ${err.message}`, 'bad'); }
    }
    async clearAll() {
      if (!this.chart.notes.length) return;
      if (!(await confirmBox('Clear all notes?', 'Removes every note. You can undo this before you leave the editor.', 'Clear', true))) return;
      this.snapshot(); this.chart.notes = []; this.sel.clear(); this.cursor = 0; this.scroll = 0; this.dirty = true;
      if (this.tab === 'sheet') this.setText(this.starterText());
      this.updateStatus();
    }
    async removeSong() {
      const bundled = this.chart.bundled;
      const ok = await confirmBox(bundled ? 'Reset to original?' : 'Delete song?',
        bundled ? 'Throw away your changes and go back to the version that came with the game?' : `Delete "${this.chart.title}" for good?`,
        bundled ? 'Reset' : 'Delete', true);
      if (!ok) return;
      if (this.chart.inputs && this.deleteSheet && !(await this.deleteSheet(this.chart))) return;
      this.store.deleteSong(this.chart.id);
      this.dirty = false;
      this.close();
      toast(bundled ? 'Song reset' : 'Song deleted');
      this.onExit(bundled ? this.chart.id : null);
    }

    // ---------- sheet picture ----------
    clearRefUrls() { this.refUrls.forEach((u) => URL.revokeObjectURL(u)); this.refUrls = []; }
    async loadRef(pages) {
      this.clearRefUrls();
      if (pages) { this.refPages = pages; await this.store.saveRef(this.chart.id, { pages }); }
      else {
        const r = await this.store.loadRef(this.chart.id);
        this.refPages = r?.pages || null;
      }
      this.renderRef();
      $('#ed-ref').hidden = !this.refPages?.length;
    }
    renderRef() {
      const box = $('#ed-ref-pages');
      box.innerHTML = '';
      this.clearRefUrls();
      if (!this.refPages?.length) return;
      this.refPages.forEach((b, i) => {
        const url = URL.createObjectURL(b);
        this.refUrls.push(url);
        box.append(el('img', { src: url, alt: `Sheet page ${i + 1}`, style: { width: `${this.refZoom * 100}%` } }));
      });
      $('#ed-ref-zoom').textContent = `${Math.round(this.refZoom * 100)}%`;
    }
    zoomRef(f) {
      this.refZoom = clamp(this.refZoom * f, 0.5, 4);
      $$('#ed-ref-pages img').forEach((im) => (im.style.width = `${this.refZoom * 100}%`));
      $('#ed-ref-zoom').textContent = `${Math.round(this.refZoom * 100)}%`;
    }
    toggleRef() {
      if (!this.refPages?.length) return this.addRef();
      $('#ed-ref').hidden = !$('#ed-ref').hidden;
      this.updateStatus();
      if (this.tab === 'roll') requestAnimationFrame(() => this.resize());
    }
    async addRef() {
      const f = await pickFile('image/*,.pdf');
      if (!f) return;
      try {
        toast('Loading the sheet…');
        const r = await RK.importers.readFile(f);
        if (r.type !== 'reference') throw new Error('choose a picture or a PDF');
        await this.loadRef(r.pages);
        this.dirty = true;
        this.updateStatus();
        if (this.tab === 'roll') requestAnimationFrame(() => this.resize());
        toast(r.truncated ? 'Showing the first 16 pages' : 'Sheet added beside the editor', 'ok');
      } catch (err) { toast(`Couldn't open it: ${err.message}`, 'bad'); }
    }
    async removeRef() {
      if (!this.refPages?.length) return;
      if (!(await confirmBox('Remove the sheet picture?', 'Your notes stay. Only the picture beside the editor is removed.', 'Remove'))) return;
      await this.store.deleteRef(this.chart.id);
      this.refPages = null; this.renderRef(); $('#ed-ref').hidden = true; this.dirty = true; this.updateStatus();
      if (this.tab === 'roll') requestAnimationFrame(() => this.resize());
    }

    // ---------- listen ----------
    toggleListen() { this.listen ? this.stopListen() : this.startListen(); }
    startListen() {
      if (this.tab === 'sheet') { clearTimeout(this.parseTimer); this.reparse(); }
      const from = this.tab === 'sheet' ? 0 : this.cursor;
      const notes = this.chart.notes.filter((n) => n[0] >= from - EPS);
      if (!notes.length) { toast(this.tab === 'sheet' ? 'Type some notes first' : 'No notes after the cursor (Home goes to the start)'); return; }
      this.audio.allOff();
      const t0 = this.audio.now() + 0.08, s0 = this.tl.beatToSec(from);
      for (const [b, m, d, , auto] of notes) {
        const s = this.tl.beatToSec(b) - s0;
        this.audio.play(m, { when: t0 + s, dur: Math.max(0.1, this.tl.beatToSec(b + d) - this.tl.beatToSec(b)), vel: auto === 5 ? 0.55 : 0.75, backing: auto === 5 });
      }
      const endSec = Math.max(...notes.map(([b, , d]) => this.tl.beatToSec(b + d))) - s0;
      this.listen = { t0, s0, endSec, from };
      $$('[data-ed="listen"]').forEach((b) => { b.classList.add('on'); b.textContent = 'STOP'; });
    }
    stopListen() {
      if (!this.listen) return;
      this.listen = null;
      this.audio.allOff();
      $$('[data-ed="listen"]').forEach((b) => { b.classList.remove('on'); b.textContent = 'LISTEN'; });
    }

    // ---------- roll canvas ----------
    resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2), r = this.cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.W = r.width; this.H = r.height;
      this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
      this.c.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.c.imageSmoothingEnabled = false;
      this.keysW = 74; this.rulerH = 30;
      this.gridW = this.W - this.keysW;
      this.rowH = (this.H - this.rulerH) / LANES;
    }
    xOf(beat) { return this.keysW + (beat - this.scroll) * this.ppb; }
    beatAt(x) { return this.scroll + (x - this.keysW) / this.ppb; }
    yOf(lane) { return this.rulerH + (LANES - 1 - lane) * this.rowH; }
    laneAt(y) { return LANES - 1 - Math.floor((y - this.rulerH) / this.rowH); }
    noteRect(n) {
      const y = this.yOf(n[3]), h = this.rowH;
      const x0 = this.xOf(n[0]), x1 = this.xOf(n[0] + n[2]);
      // each row has four bands: melody, accompaniment, bass, and a thin backing strip at the bottom
      const w = Math.max(4, x1 - x0 - 1), L = LAYER_OF[n[4]];
      if (L === 'accomp') return { x: x0, y: y + h * 0.41, w, h: h * 0.2 };
      if (L === 'bass') return { x: x0, y: y + h * 0.63, w, h: h * 0.21 };
      if (L === 'backing') return { x: x0, y: y + h * 0.86, w, h: h * 0.11 };
      return { x: x0, y: y + 3, w, h: h * 0.38 - 3 };
    }
    noteAt(x, y) {
      // note under the pointer (melody, then bass, then backing)
      let found = null;
      for (const n of this.chart.notes) {
        const r = this.noteRect(n);
        const rank = (q) => ({ melody: 0, accomp: 1, bass: 2, backing: 3 })[LAYER_OF[q[4]]];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { if (!found || rank(n) < rank(found)) found = n; }
      }
      return found;
    }

    bindCanvas() {
      const cv = this.cv;
      cv.tabIndex = 0;
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      cv.addEventListener('pointermove', (e) => {
        const [x, y] = pos(e);
        if (this.drag) return this.dragMove(x, y, e);
        const n = x > this.keysW && y > this.rulerH ? this.noteAt(x, y) : null;
        this.hover = !n && x > this.keysW && y > this.rulerH ? { beat: Math.max(0, Math.floor(this.beatAt(x) / this.snapStep + EPS) * this.snapStep), lane: this.laneAt(y) } : null;
        let cur = 'default';
        if (n) { const r = this.noteRect(n); cur = x > r.x + r.w - 7 ? 'ew-resize' : 'grab'; }
        else if (y < this.rulerH && x > this.keysW) cur = 'col-resize';
        else if (this.hover) cur = 'crosshair';
        else if (x <= this.keysW) cur = 'pointer';
        cv.style.cursor = cur;
      });
      cv.addEventListener('pointerleave', () => (this.hover = null));
      cv.addEventListener('pointerdown', (e) => {
        cv.focus({ preventScroll: true });
        const [x, y] = pos(e);
        this.stopListen();
        if (y < this.rulerH && x > this.keysW) {
          const flag = this.flagHits?.find((f) => x >= f.x0 && x <= f.x1);
          if (flag) { this.cursor = flag.b; this.editTempo(flag.b); }
          else this.cursor = Math.max(0, Math.round(this.beatAt(x) / this.snapStep) * this.snapStep);
          this.updateStatus(); return;
        }
        const lane = this.laneAt(y);
        if (lane < 0 || lane >= LANES) return;
        if (x <= this.keysW) { const m = midiOf(lane, this.newAlter(lane), this.octave); const v = this.audio.play(m, { vel: 0.7 }); v?.stop(this.audio.now() + 0.5); return; }
        const n = this.noteAt(x, y);
        if (e.button === 2) {
          if (n) { this.snapshot(); this.chart.notes = this.chart.notes.filter((q) => q !== n && !(this.sel.has(n) && this.sel.has(q))); this.sel.clear(); this.dirty = true; this.updateStatus(); }
          return;
        }
        cv.setPointerCapture(e.pointerId);
        if (n) {
          if (e.shiftKey) { this.sel.has(n) ? this.sel.delete(n) : this.sel.add(n); this.updateStatus(); return; }
          if (!this.sel.has(n)) { this.sel.clear(); this.sel.add(n); }
          const r = this.noteRect(n);
          const mode = x > r.x + r.w - 7 ? 'resize' : 'move';
          this.drag = { mode, x0: x, y0: y, beat0: this.beatAt(x), lane0: lane, orig: [...this.sel].map((q) => [q, q.slice()]), moved: false, note: n };
          const v = this.audio.play(n[1], { vel: 0.6 }); v?.stop(this.audio.now() + 0.3);
          this.updateStatus();
          return;
        }
        this.drag = { mode: 'box', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, base: new Set(this.sel), lane, beat: Math.max(0, Math.floor(this.beatAt(x) / this.snapStep + EPS) * this.snapStep) };
      });
      const end = (e) => {
        const d = this.drag;
        if (!d) return;
        this.drag = null;
        try { cv.releasePointerCapture(e.pointerId); } catch { /* fine */ }
        if (d.mode === 'box' && Math.abs(d.x1 - d.x0) < 4 && Math.abs(d.y1 - d.y0) < 4) {
          // a click on empty space adds a note
          this.snapshot(); this.sel.clear();
          const nn = this.addNote(this.makeNote(d.beat, d.lane));
          if (nn) { this.sel.add(nn); const v = this.audio.play(nn[1], { vel: 0.7 }); v?.stop(this.audio.now() + 0.35); }
          this.cursor = d.beat + this.dur;
        } else if ((d.mode === 'move' || d.mode === 'resize') && d.moved) {
          this.sortNotes(); this.dirty = true;
        }
        this.updateStatus();
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('dblclick', (e) => {
        const [x, y] = pos(e);
        const n = this.noteAt(x, y);
        if (n) {
          this.snapshot();
          n[4] = (n[4] + 1) % 6; // cycle through every part
          this.dirty = true; this.updateStatus();
          toast(`Now: ${PART_LABEL[n[4]]}`);
        }
      });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          const [x] = pos(e), at = this.beatAt(x);
          this.ppb = clamp(this.ppb * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 16, 320);
          this.scroll = Math.max(0, at - (x - this.keysW) / this.ppb);
        } else {
          const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          this.scroll = Math.max(0, this.scroll + d / this.ppb);
        }
      }, { passive: false });
    }

    dragMove(x, y, e) {
      const d = this.drag;
      if (d.mode === 'box') {
        d.x1 = x; d.y1 = y;
        const bx0 = Math.min(d.x0, x), bx1 = Math.max(d.x0, x), by0 = Math.min(d.y0, y), by1 = Math.max(d.y0, y);
        this.sel = new Set(d.add ? d.base : []);
        for (const n of this.chart.notes) {
          const r = this.noteRect(n);
          if (r.x < bx1 && r.x + r.w > bx0 && r.y < by1 && r.y + r.h > by0) this.sel.add(n);
        }
        return;
      }
      const step = this.snapStep;
      if (!d.moved && Math.abs(x - d.x0) < 3 && Math.abs(y - d.y0) < 3) return;
      if (!d.moved) { d.moved = true; this.snapshotFrom(d.orig); }
      if (d.mode === 'resize') {
        const db = Math.round((this.beatAt(x) - d.beat0) / step) * step;
        for (const [n, o] of d.orig) n[2] = Math.max(step, +(o[2] + db).toFixed(4));
      } else {
        let db = Math.round((this.beatAt(x) - d.beat0) / step) * step;
        const minB = Math.min(...d.orig.map(([, o]) => o[0]));
        if (minB + db < 0) db = -minB;
        const dl = clamp(this.laneAt(y), 0, 6) - d.lane0;
        for (const [n, o] of d.orig) {
          n[0] = +(o[0] + db).toFixed(4);
          const sp = spell(o[1], o[3]);
          let lane = o[3] + dl, oct = sp.octave;
          while (lane > 6) { lane -= 7; oct++; }
          while (lane < 0) { lane += 7; oct--; }
          if (dl) { n[3] = lane; n[1] = clamp(midiOf(lane, keySigAlter(this.chart.keySig, lane), oct), 12, 119); }
          else { n[3] = o[3]; n[1] = o[1]; }
        }
        if (dl !== d.lastDl) { d.lastDl = dl; const v = this.audio.play(d.note[1], { vel: 0.5 }); v?.stop(this.audio.now() + 0.2); }
      }
      this.dirty = true;
    }
    snapshotFrom(orig) {
      const map = new Map(orig);
      this.undoStack.push({ notes: this.chart.notes.map((n) => (map.get(n) || n).slice()), tempos: this.chart.tempos.map((t) => ({ ...t })), cursor: this.cursor });
      this.redoStack = [];
    }

    draw() {
      if (!this.active) return;
      this.raf = requestAnimationFrame(this.draw);
      if (this.tab !== 'roll') {
        if (this.listen && this.audio.now() - this.listen.t0 > this.listen.endSec + 0.4) this.stopListen();
        return;
      }
      if (!this.W) { this.resize(); if (!this.W) return; }
      const c = this.c, { W, H, keysW, rulerH, rowH, ppb } = this;
      const ch = this.chart, s = this.getSettings();

      let playBeat = null;
      if (this.listen) {
        const t = this.audio.now() - this.listen.t0;
        if (t > this.listen.endSec + 0.4) this.stopListen();
        else {
          playBeat = this.tl.secToBeat(this.listen.s0 + Math.max(0, t));
          if (this.xOf(playBeat) > W - 120) this.scroll = playBeat - (W - keysW) / ppb * 0.25;
        }
      }
      c.fillStyle = '#0f1546'; c.fillRect(0, 0, W, H);
      for (let l = 0; l < LANES; l++) {
        const y = Math.round(this.yOf(l));
        c.fillStyle = l % 2 ? '#141b55' : '#11174c';
        c.fillRect(keysW, y, W - keysW, Math.ceil(rowH));
        c.fillStyle = LANE_COLORS[l][0];
        c.globalAlpha = 0.06; c.fillRect(keysW, y, W - keysW, Math.ceil(rowH)); c.globalAlpha = 1;
        c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(keysW, y + Math.ceil(rowH) - 1, W - keysW, 1);
      }
      const step = this.snapStep;
      const startB = Math.floor(this.scroll / step) * step, endB = this.scroll + (W - keysW) / ppb;
      for (let b = startB; b <= endB + EPS; b += step) {
        const x = Math.round(this.xOf(b));
        if (x < keysW) continue;
        const isBar = isBarLine(ch, b), isBeat = Math.abs(b - Math.round(b)) < EPS;
        c.fillStyle = isBar ? 'rgba(255,224,61,0.45)' : isBeat ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.04)';
        c.fillRect(x, rulerH, isBar ? 2 : 1, H - rulerH);
      }
      // ruler
      c.fillStyle = '#0a0f36'; c.fillRect(keysW, 0, W - keysW, rulerH);
      c.fillStyle = '#ffe03d'; c.fillRect(keysW, rulerH - 2, W - keysW, 2);
      c.font = '8px "Press Start 2P", monospace'; c.textBaseline = 'top'; c.textAlign = 'left';
      const starts = barStarts(ch, endB + 1);
      const meterAt = new Map((ch.meters || []).map((m) => [m.b.toFixed(4), m.ts]));
      for (let k = Math.max(0, barAt(ch, Math.max(0, this.scroll)).index); k < starts.length && starts[k] <= endB; k++) {
        const b = starts[k], x = this.xOf(b);
        if (x < keysW - 2) continue;
        c.fillStyle = '#c3c8ff';
        const ts = meterAt.get(b.toFixed(4));
        c.fillText(String(k + 1) + (ts ? `  ${ts[0]}/${ts[1]}` : ''), Math.round(x) + 4, rulerH - 12);
      }
      this.flagHits = [];
      c.font = '8px "Press Start 2P", monospace'; c.textBaseline = 'middle';
      for (const t of ch.tempos) {
        const x = this.xOf(t.b);
        if (x < keysW - 140 || x > W) continue;
        const label = `${Math.round(t.bpm)} bpm${t.label ? ' · ' + t.label : ''}`;
        const w = c.measureText(label).width + 12, fx = Math.max(keysW, Math.round(x));
        c.fillStyle = '#4fe06a'; c.fillRect(fx, 3, w, 14);
        c.fillStyle = '#0f1546'; c.fillText(label, fx + 6, 11);
        this.flagHits.push({ b: t.b, x0: fx, x1: fx + w });
      }

      // notes, grouped so octave doublings share one box and label
      const groups = new Map();
      for (const n of ch.notes) {
        const x0 = this.xOf(n[0]), x1 = this.xOf(n[0] + n[2]);
        if (x1 < keysW || x0 > W) continue;
        const k = `${n[0].toFixed(4)}|${n[3]}|${n[4]}|${n[2].toFixed(4)}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(n);
      }
      c.textBaseline = 'middle';
      for (const list of groups.values()) {
        const n = list[0], r = this.noteRect(n), col = LANE_COLORS[n[3]];
        const sel = list.some((q) => this.sel.has(q));
        const playing = playBeat != null && playBeat >= n[0] && playBeat < n[0] + n[2];
        const nx = Math.max(r.x + 1, keysW), nw = Math.max(3, r.x + r.w - nx);
        const layer = LAYER_OF[n[4]];
        if (layer === 'backing') {
          c.fillStyle = col[1]; c.globalAlpha = 0.6; c.fillRect(Math.round(nx), Math.round(r.y), Math.round(nw), Math.round(r.h)); c.globalAlpha = 1;
        } else if (layer === 'accomp') {
          c.fillStyle = playing ? '#ffffff' : col[2];
          c.fillRect(Math.round(nx), Math.round(r.y), Math.round(nw), Math.round(r.h));
          c.fillStyle = col[1]; c.fillRect(Math.round(nx), Math.round(r.y + r.h) - 2, Math.round(nw), 2);
        } else if (layer === 'bass') {
          c.fillStyle = playing ? '#ffffff' : col[1];
          c.fillRect(Math.round(nx), Math.round(r.y), Math.round(nw), Math.round(r.h));
          c.fillStyle = col[0]; c.fillRect(Math.round(nx), Math.round(r.y), Math.round(nw), 2); c.fillRect(Math.round(nx), Math.round(r.y), 2, Math.round(r.h));
        } else {
          c.fillStyle = playing ? '#ffffff' : col[0];
          c.fillRect(Math.round(nx), Math.round(r.y), Math.round(nw), Math.round(r.h));
          c.fillStyle = col[1]; c.fillRect(Math.round(nx), Math.round(r.y + r.h) - 3, Math.round(nw), 3);
          c.fillStyle = col[2]; c.fillRect(Math.round(nx), Math.round(r.y), Math.round(nw), 2);
        }
        if (sel) {
          c.fillStyle = '#ffffff';
          const X = Math.round(nx) - 2, Y = Math.round(r.y) - 2, Wd = Math.round(nw) + 4, Hd = Math.round(r.h) + 4;
          c.fillRect(X, Y, Wd, 2); c.fillRect(X, Y + Hd - 2, Wd, 2); c.fillRect(X, Y, 2, Hd); c.fillRect(X + Wd - 2, Y, 2, Hd);
        }
        // bass-clef notes get a white stripe on the left so you can see which hand plays them
        if (n[4] >= 2 && n[4] <= 4) { c.fillStyle = '#ffffff'; c.fillRect(Math.round(nx), Math.round(r.y), 2, Math.round(r.h)); }
        const label = list.map((q) => noteName(q[1], q[3], true, true)).join('+');
        c.font = '8px "Press Start 2P", monospace';
        if (nw > c.measureText(label).width + 8 && r.h > 10) {
          c.fillStyle = layer === 'bass' || layer === 'backing' ? '#ffffff' : '#1b1640';
          c.textAlign = 'left';
          c.fillText(label, Math.round(nx) + 5, Math.round(r.y + r.h / 2) + 1);
        }
      }
      // box select
      if (this.drag && this.drag.mode === 'box' && (Math.abs(this.drag.x1 - this.drag.x0) > 3 || Math.abs(this.drag.y1 - this.drag.y0) > 3)) {
        const d = this.drag;
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
        c.strokeStyle = '#ffffff'; c.setLineDash([4, 3]); c.lineWidth = 1;
        c.strokeRect(Math.min(d.x0, d.x1) + 0.5, Math.min(d.y0, d.y1) + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
        c.setLineDash([]);
      }
      // hover ghost
      if (this.hover && !this.listen && !this.drag && this.hover.lane >= 0 && this.hover.lane < LANES) {
        const { beat, lane } = this.hover;
        const g = this.noteRect([beat, 60, this.dur, lane, this.part]);
        c.strokeStyle = LANE_COLORS[lane][2]; c.setLineDash([4, 3]); c.lineWidth = 1.5;
        c.strokeRect(Math.round(g.x) + 0.5, Math.round(g.y) + 0.5, Math.round(g.w), Math.round(g.h));
        c.setLineDash([]);
      }
      // cursor
      const cx = Math.round(this.xOf(this.cursor));
      if (cx >= keysW - 1) {
        c.fillStyle = 'rgba(255,224,61,0.10)'; c.fillRect(cx, rulerH, this.dur * ppb, H - rulerH);
        c.fillStyle = '#ffe03d'; c.fillRect(cx - 1, rulerH, 2, H - rulerH);
        c.fillRect(cx - 5, rulerH - 8, 10, 3); c.fillRect(cx - 3, rulerH - 5, 6, 3);
      }
      if (playBeat != null) { c.fillStyle = '#36c8ff'; c.fillRect(Math.round(this.xOf(playBeat)) - 1, 0, 2, H); }

      // lane labels
      c.fillStyle = '#0a0f36'; c.fillRect(0, 0, keysW, H);
      for (let l = 0; l < LANES; l++) {
        const y = Math.round(this.yOf(l)), hh = Math.ceil(rowH) - 2;
        const held = this.held.has(l);
        c.fillStyle = held ? LANE_COLORS[l][2] : LANE_COLORS[l][0];
        c.fillRect(4, y + 1, keysW - 8, hh);
        c.fillStyle = LANE_COLORS[l][1]; c.fillRect(4, y + hh - 2, keysW - 8, 3);
        c.font = '16px "Press Start 2P", monospace'; c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillStyle = '#1b1640';
        c.fillText(LETTERS[l], 12, y + hh / 2 + 1);
        c.font = '8px "Press Start 2P", monospace'; c.textAlign = 'right';
        c.fillText(s.bindings[l].label, keysW - 12, y + hh / 2 + 1);
      }
      c.fillStyle = '#0a0f36'; c.fillRect(0, 0, keysW, rulerH);
      c.fillStyle = '#c3c8ff'; c.font = '8px "Press Start 2P", monospace'; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText('KEYS', 10, rulerH / 2);
    }
  }

  function slug(t) { return (String(t || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song').slice(0, 40); }

  RK.Editor = Editor;
  RK.editorNoteSvg = noteSvg;
})();
