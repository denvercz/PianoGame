// Rainbow Keys — app shell: screens, menu, songs, uploads, settings, game and results.
(function () {
  'use strict';
  const RK = window.RK;
  const { LETTERS, LANE_COLORS, LANES, BINDING_PRESETS, codeLabel, keySigName } = RK.notes;
  const { Store, loadSettings, saveSettings, DEFAULT_SETTINGS, TIMING_PRESETS, chartLength, fmtTime, normalizeChart, newId } = RK.store;
  const { $, $$, el, esc, modal, confirmBox, closeModal, isModalOpen, toast, download, pickFile, Starfield, DomPiano } = RK.ui;
  const { chartToSheet } = RK.notation;

  const audio = new RK.AudioEngine();
  const store = new Store();
  let settings = loadSettings();
  const getSettings = () => settings;
  let screen = 'splash';
  let stars;

  // ---------- settings & key bindings ----------
  let codeToLane = new Map();
  function rebuildBindings() {
    codeToLane = new Map();
    settings.bindings.forEach((b, lane) => codeToLane.set(b.code, lane));
  }
  const laneOfCode = (code) => (codeToLane.has(code) ? codeToLane.get(code) : null);
  function applySettings() {
    audio.configure(settings);
    rebuildBindings();
    saveSettings(settings);
  }
  function setSetting(k, v) { settings[k] = v; applySettings(); }

  // ---------- logo ----------
  function paintLogo(node, text) {
    node.innerHTML = '';
    let i = 0;
    for (const word of text.split(' ')) {
      const w = el('span', { class: 'word' });
      for (const ch of word) {
        const s = el('span', { class: 'ch', text: ch });
        s.style.color = LANE_COLORS[i % 7][0];
        s.style.animationDelay = `${(i % 7) * 0.12}s`;
        w.append(s); i++;
      }
      node.append(w);
    }
  }
  $$('.logo').forEach((n) => paintLogo(n, n.closest('#screen-exit') ? 'SEE YOU!' : 'RAINBOW KEYS'));

  // ---------- router ----------
  const enter = {}, leave = {};
  function go(name, opts = {}) {
    if (screen === name && !opts.force) return;
    leave[screen]?.(name);
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
    screen = name;
    stars?.setRunning(name !== 'game' && name !== 'editor');
    enter[name]?.(opts);
  }

  // ---------- free play on the menu / settings pianos ----------
  const freeHeld = new Map();
  let freePiano = null;
  function freeDown(code) {
    const lane = laneOfCode(code);
    if (lane == null || freeHeld.has(code)) return false;
    freeHeld.set(code, lane);
    audio.keyDown('free' + lane, [RK.notes.defaultMidi(lane)]);
    freePiano?.press(lane);
    return true;
  }
  function freeUp(code) {
    if (!freeHeld.has(code)) return;
    const lane = freeHeld.get(code);
    freeHeld.delete(code);
    audio.keyUp('free' + lane);
    freePiano?.release(lane);
  }
  const freeAllUp = () => [...freeHeld.keys()].forEach(freeUp);
  const pianoOpts = {
    getBindings: () => settings.bindings,
    onPress: (l) => audio.keyDown('free' + l, [RK.notes.defaultMidi(l)]),
    onRelease: (l) => audio.keyUp('free' + l),
  };
  const menuPiano = new DomPiano($('#menu-piano'), pianoOpts);
  const settingsPiano = new DomPiano($('#settings-piano'), pianoOpts);

  // ---------- menu ----------
  const menuBtns = $$('#menu-list .menu-btn');
  let menuIdx = 0;
  function focusMenu(i, sound = true) {
    menuIdx = (i + menuBtns.length) % menuBtns.length;
    menuBtns.forEach((b, j) => b.classList.toggle('focused', j === menuIdx));
    if (sound && settings.menuSounds) audio.move();
  }
  // follow the mouse only when it really moves (not when a screen appears under a still pointer)
  let lastMouse = '';
  menuBtns.forEach((b, i) => b.addEventListener('mousemove', (e) => {
    const k = `${e.screenX},${e.screenY}`;
    if (k === lastMouse) return;
    lastMouse = k;
    if (menuIdx !== i) focusMenu(i);
  }));
  $$('[data-action]').forEach((b) => b.addEventListener('click', () => action(b.dataset.action)));
  function action(a) {
    if (settings.menuSounds) (a === 'menu' ? audio.back() : audio.select());
    switch (a) {
      case 'start': go('songs'); break;
      case 'settings': go('settings'); break;
      case 'exit': exitGame(); break;
      case 'menu': go('menu'); break;
      case 'help': go('help', { part: 'play' }); break;
      case 'credits': go('help', { part: 'credits' }); break;
    }
  }
  enter.menu = () => { focusMenu(menuIdx, false); freePiano = menuPiano; menuPiano.refresh(); };
  leave.menu = () => freeAllUp();
  async function exitGame() {
    if (!(await confirmBox('Exit Rainbow Keys?', 'Your songs, scores and settings are already saved in this browser.', 'Exit'))) return;
    audio.allOff();
    go('exit');
    setTimeout(() => { try { window.close(); } catch { /* only allowed for tabs opened by a script */ } }, 600);
  }

  // ---------- song cards ----------
  function cardArt(song) {
    const W = 60, H = 52, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#0d1442'; c.fillRect(0, 0, W, H);
    let seed = 0; for (const ch of song.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let i = 0; i < 26; i++) { c.fillStyle = rnd() < 0.3 ? LANE_COLORS[(rnd() * 7) | 0][2] : '#ffffff'; c.globalAlpha = 0.4 + rnd() * 0.6; c.fillRect((rnd() * W) | 0, (rnd() * H) | 0, 1, 1); }
    c.globalAlpha = 1;
    const lw = 6, x0 = (W - lw * 7) / 2;
    for (let l = 0; l < 7; l++) { c.fillStyle = LANE_COLORS[l][0]; c.globalAlpha = 0.13; c.fillRect(x0 + l * lw, 0, lw, H - 8); }
    c.globalAlpha = 1;
    for (let l = 0; l < 7; l++) { c.fillStyle = LANE_COLORS[l][0]; c.fillRect(x0 + l * lw, H - 9, lw, 1); c.fillStyle = '#f6f3ff'; c.fillRect(x0 + l * lw, H - 7, lw - 1, 7); c.fillStyle = LANE_COLORS[l][0]; c.fillRect(x0 + l * lw, H - 7, lw - 1, 2); }
    const mel = song.notes.filter((n) => n[4] === 0 || n[4] === 4);
    const tiles = (mel.length ? mel : song.notes.filter((n) => n[4] < 5)).slice(0, 40);
    if (tiles.length) {
      const span = Math.max(4, tiles[tiles.length - 1][0] - tiles[0][0]);
      for (const n of tiles) {
        const y = H - 12 - Math.round(((n[0] - tiles[0][0]) / span) * (H - 16));
        c.fillStyle = LANE_COLORS[n[3]][1]; c.fillRect(x0 + n[3] * lw + 1, y + 2, lw - 2, 1);
        c.fillStyle = LANE_COLORS[n[3]][0]; c.fillRect(x0 + n[3] * lw + 1, y, lw - 2, 2);
      }
    } else {
      c.fillStyle = '#ff7ad9';
      [[0, 0, 4, 1], [3, 1, 1, 2], [1, 3, 2, 1], [1, 4, 1, 1], [1, 6, 1, 1]].forEach(([x, y, w, h]) => c.fillRect(W / 2 - 4 + x * 2, 12 + y * 2, w * 2, h * 2));
    }
    return cv.toDataURL();
  }
  const artCache = new Map();
  function artFor(song) {
    const k = song.id + ':' + song.notes.length + ':' + (song.notes[0]?.[0] ?? '');
    if (!artCache.has(k)) artCache.set(k, cardArt(song));
    return artCache.get(k);
  }

  // ---------- song list: a smooth, scrollable carousel ----------
  // `car.pos` is a continuous position (0 = first card). It eases toward `car.target` every frame,
  // so wheel, trackpad, drag, arrow keys and the < > buttons all glide instead of jumping.
  let songIdx = 0;
  const songs = () => store.songs;
  const cardCount = () => songs().length + 1;
  const car = { pos: 0, target: 0, raf: 0, last: 0, drag: null, wheelT: 0, notchAt: 0, cards: [], spacing: 260, suppressClick: false };
  const clampPos = (v) => Math.max(0, Math.min(cardCount() - 1, v));

  function renderCarousel() {
    const track = $('#car-track');
    track.innerHTML = '';
    car.cards = [];
    songs().forEach((song, i) => {
      const card = el('button', { class: 'song-card', 'data-i': i, 'aria-label': song.title },
        el('img', { class: 'art', src: artFor(song), alt: '', draggable: 'false' }),
        el('span', { class: 'num', text: String(i + 1).padStart(2, '0') }));
      if (!RK.store.playableCount(song)) card.append(el('span', { class: 'badge', text: 'EMPTY' }));
      else if (song.inputs) card.append(el('span', { class: 'badge txt', text: 'TXT' }));
      else if (!song.bundled) card.append(el('span', { class: 'badge', text: 'YOURS' }));
      else if (song.edited) card.append(el('span', { class: 'badge', text: 'EDITED' }));
      const pips = el('div', { class: 'pips', 'aria-label': `Level ${song.difficulty} of 5` });
      for (let p = 1; p <= 5; p++) pips.append(el('i', { class: p <= song.difficulty ? 'on' : '' }));
      card.append(el('div', { class: 'meta' }, el('h3', { class: 't', text: song.title }), el('div', { class: 's', text: song.inputs ? `Inputs/${song.file}` : song.composer }), pips));
      card.append(el('i', { class: 'dim' }));
      card.addEventListener('click', () => { if (car.suppressClick) return; i === songIdx ? startSelected() : goToCard(i); });
      track.append(card);
      car.cards.push(card);
    });
    const nc = el('button', { class: 'song-card new-card', 'aria-label': 'Upload or write a sheet' },
      el('div', { class: 'plus', text: '+' }), el('div', { class: 'meta' }, el('h3', { class: 't', text: 'YOUR SHEET' }), el('div', { class: 's', text: 'Upload or write one' })), el('i', { class: 'dim' }));
    nc.addEventListener('click', () => { if (car.suppressClick) return; songIdx === songs().length ? openUpload() : goToCard(songs().length); });
    track.append(nc);
    car.cards.push(nc);
    const dots = $('#car-dots'); dots.innerHTML = '';
    for (let i = 0; i < cardCount(); i++) {
      const d = el('i'); d.addEventListener('click', () => goToCard(i)); dots.append(d);
    }
    car.spacing = Math.min(290, Math.max(200, innerWidth * 0.2));
    layoutCards(car.pos);
    syncIndex(true);
  }

  function layoutCards(pos) {
    const sp = car.spacing;
    for (let i = 0; i < car.cards.length; i++) {
      const c = car.cards[i], o = i - pos, a = Math.abs(o);
      if (a > 3.2) { if (c.style.visibility !== 'hidden') c.style.visibility = 'hidden'; continue; }
      c.style.visibility = '';
      const rot = Math.max(-2, Math.min(2, o)) * -14;
      const sc = 1.04 - Math.min(a, 1) * 0.18 - Math.max(0, a - 1) * 0.04;
      c.style.transform = `translate3d(-50%, -50%, 0) translate3d(${(o * sp).toFixed(1)}px, 0, ${(-a * 120).toFixed(1)}px) rotateY(${rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
      c.style.opacity = Math.max(0, 1 - Math.max(0, a - 1.6) * 0.8).toFixed(3);
      c.style.zIndex = String(1000 - Math.round(a * 10));
      const dim = c.lastElementChild; if (dim && dim.classList.contains('dim')) dim.style.opacity = Math.min(0.5, a * 0.45).toFixed(3);
      c.classList.toggle('sel', a < 0.5);
      c.tabIndex = a < 0.5 ? 0 : -1;
    }
  }
  function tick(ts) {
    const dt = Math.max(0, Math.min(0.05, (ts - car.last) / 1000));
    car.last = ts;
    if (!car.drag) car.pos += (car.target - car.pos) * (1 - Math.exp(-dt * 13));
    layoutCards(car.pos);
    if (car.drag || Math.abs(car.target - car.pos) > 0.0008) car.raf = requestAnimationFrame(tick);
    else { car.pos = car.target; layoutCards(car.pos); car.raf = 0; }
  }
  function kick() { if (!car.raf) { car.last = performance.now(); car.raf = requestAnimationFrame(tick); } }
  // keep the detail panel in step with whichever card is in the middle
  function syncIndex(force) {
    const idx = Math.round(clampPos(car.drag ? car.pos : car.target));
    if (idx !== songIdx || force) {
      const moved = idx !== songIdx;
      songIdx = idx;
      $$('#car-dots i').forEach((d, i) => d.classList.toggle('on', i === songIdx));
      renderDetail();
      if (moved && !force && settings.menuSounds) audio.move();
    }
  }
  function goToCard(i, { wrap = false } = {}) {
    const n = cardCount();
    car.target = wrap ? ((i % n) + n) % n : clampPos(i);
    syncIndex();
    kick();
  }
  const selectSong = (i) => goToCard(i, { wrap: true });

  // wheel and trackpad: trackpads scroll smoothly, a mouse-wheel notch moves one card
  $('#carousel').addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const px = d * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1);
    const notch = e.deltaMode !== 0 || (Math.abs(px) >= 60 && Number.isInteger(px));
    if (notch) {
      if (performance.now() - car.notchAt < 110) return;
      car.notchAt = performance.now();
      goToCard(Math.round(car.target) + Math.sign(px));
      return;
    }
    car.target = clampPos(car.target + px / car.spacing);
    syncIndex(); kick();
    clearTimeout(car.wheelT);
    car.wheelT = setTimeout(() => goToCard(Math.round(car.target)), 140);
  }, { passive: false });

  // drag / swipe with a little fling
  const carEl = $('#carousel');
  carEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.car-nav')) return;
    car.drag = { x: e.clientX, pos: car.pos, moved: false, id: e.pointerId, samples: [[performance.now(), e.clientX]] };
  });
  carEl.addEventListener('pointermove', (e) => {
    const d = car.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 6) return;
    if (!d.moved) { d.moved = true; try { carEl.setPointerCapture(e.pointerId); } catch { /* fine */ } carEl.classList.add('dragging'); }
    car.pos = car.target = clampPos(d.pos - dx / car.spacing);
    d.samples.push([performance.now(), e.clientX]);
    if (d.samples.length > 6) d.samples.shift();
    syncIndex(); kick();
  });
  const endDrag = (e) => {
    const d = car.drag;
    if (!d || e.pointerId !== d.id) return;
    car.drag = null;
    carEl.classList.remove('dragging');
    if (!d.moved) return;
    const [t0, x0] = d.samples[0], [t1, x1] = d.samples[d.samples.length - 1];
    const v = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0; // px per ms
    const fling = Math.max(-3, Math.min(3, (-v * 220) / car.spacing));
    car.suppressClick = true;
    setTimeout(() => (car.suppressClick = false), 0);
    goToCard(Math.round(car.pos + fling));
  };
  carEl.addEventListener('pointerup', endDrag);
  carEl.addEventListener('pointercancel', endDrag);

  // the part the player asked for; layer picks only count while advanced parts are shown
  const LAYER_ORDER = ['melody', 'accomp', 'bass'];
  function wantedPart() {
    const p = settings.part || 'treble';
    if (p.startsWith('L:') && !settings.advancedParts) return 'treble';
    return p;
  }
  const layersOf = (p) => (p.startsWith('L:') ? p.slice(2).split('+') : []);
  function partButtons(song) {
    const pc = song ? RK.store.partCounts(song) : null;
    const want = wantedPart();
    const eff = song ? RK.store.pickPart(song, want) : want;
    $('#layer-row').hidden = !settings.advancedParts;
    $$('#part-seg button').forEach((b) => {
      const v = b.dataset.v, n = pc ? pc[v] : 1;
      b.disabled = !n;
      b.classList.toggle('on', v === eff);
      b.title = pc ? (n ? `${n} notes to play` : 'This song has no notes in this part') : b.title;
    });
    const on = layersOf(eff);
    $$('#layer-seg button').forEach((b) => {
      const v = b.dataset.v, n = pc ? pc[v] : 1;
      b.disabled = !n;
      b.classList.toggle('on', on.includes(v));
      if (pc) b.title = n ? `${n} notes to play (tap to add or remove)` : 'This song has no notes in this layer';
    });
  }

  function renderDetail() {
    const song = songs()[songIdx];
    const startBtn = $('#sd-start'), editBtn = $('#sd-edit');
    const box = $('#song-detail');
    box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap');
    if (!song) {
      $('#sd-title').textContent = 'YOUR SHEET';
      $('#sd-sub').textContent = 'Bring your own music';
      $('#sd-desc').textContent = 'Upload a typed sheet (.txt), a MIDI or MusicXML file, or a photo/PDF of your sheet music. Typed sheets are kept in the Inputs folder.';
      $('#sd-chips').innerHTML = '';
      $('#sd-best').textContent = '';
      startBtn.textContent = 'UPLOAD +';
      editBtn.textContent = 'BLANK SHEET';
      partButtons(null);
      return;
    }
    editBtn.textContent = 'EDIT';
    $('#sd-title').textContent = song.title;
    $('#sd-sub').textContent = [song.composer, song.subtitle].filter(Boolean).join(' · ');
    $('#sd-desc').textContent = song.description || '';
    partButtons(song);
    const part = RK.store.pickPart(song, wantedPart());
    const k = keySigName(song.keySig), len = chartLength(song), t0 = song.tempos[0], pc = RK.store.partCounts(song);
    const chips = [
      ['Key', `${k.major}/${k.minor}m`.replace(/♯/g, '#').replace(/♭/g, 'b')], ['Speed', `${Math.round(t0.bpm)} bpm`], ['Time', song.timeSig.join('/')],
      ['Treble', pc.treble], ['Bass clef', pc.bassclef],
      ...(settings.advancedParts ? [['Melody', pc.melody], ['Accomp.', pc.accomp], ['Bass', pc.bass]] : []),
      ['Length', RK.store.playableCount(song) ? fmtTime(len.sec) : '—'],
    ];
    if (song.perfectMs) chips.push(['Perfect', `±${song.perfectMs} ms`]);
    $('#sd-chips').innerHTML = '';
    chips.forEach(([a, b]) => $('#sd-chips').append(el('span', { class: 'chip' }, `${a} `, el('b', { text: String(b) }))));
    if (song.warnings) $('#sd-chips').append(el('span', { class: 'chip warn', text: `${song.warnings} line${song.warnings > 1 ? 's' : ''} not understood` }));
    const best = store.best(song.id, part);
    $('#sd-best').innerHTML = best
      ? `BEST (${RK.store.PART_NAMES[part]}) <b>${esc(best.grade)}</b> · ${best.score.toLocaleString()} · ${best.accuracy.toFixed(1)}%${best.rate < 1 ? ` at ${Math.round(best.rate * 100)}%` : ''} · played ${best.plays}×`
      : RK.store.playableCount(song) ? `Not played yet (${RK.store.PART_NAMES[part]})` : '';
    startBtn.textContent = RK.store.playableCount(song) ? 'START >' : 'ADD NOTES';
  }
  function syncPlayControls() {
    $$('#mode-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.mode));
    $$('#view-seg button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'piano') === settings.pianoView));
    const r = $('#rate'); r.value = settings.rate; paintRange(r); $('#rate-out').textContent = `${settings.rate}%`;
  }
  $$('#part-seg button').forEach((b) => b.addEventListener('click', () => { setSetting('part', b.dataset.v); renderDetail(); b.blur(); }));
  // advanced layers: any mix of melody / accompaniment / bass
  $$('#layer-seg button').forEach((b) => b.addEventListener('click', () => {
    const song = songs()[songIdx];
    const cur = new Set(layersOf(song ? RK.store.pickPart(song, wantedPart()) : wantedPart()));
    if (cur.has(b.dataset.v)) cur.delete(b.dataset.v); else cur.add(b.dataset.v);
    const list = LAYER_ORDER.filter((l) => cur.has(l));
    setSetting('part', list.length ? `L:${list.join('+')}` : 'treble');
    renderDetail(); b.blur();
  }));
  $$('#mode-seg button').forEach((b) => b.addEventListener('click', () => { setSetting('mode', b.dataset.v); syncPlayControls(); b.blur(); }));
  $$('#view-seg button').forEach((b) => b.addEventListener('click', () => { setSetting('pianoView', b.dataset.v === 'piano'); syncPlayControls(); b.blur(); }));
  $('#rate').addEventListener('input', (e) => { setSetting('rate', +e.target.value); syncPlayControls(); });
  $('#rate').addEventListener('change', (e) => e.target.blur());
  $('#car-prev').addEventListener('click', () => selectSong(songIdx - 1));
  $('#car-next').addEventListener('click', () => selectSong(songIdx + 1));
  $('#sd-start').addEventListener('click', () => startSelected());
  $('#sd-edit').addEventListener('click', () => { const s = songs()[songIdx]; s ? openEditor(s, s.inputs ? { tab: 'sheet' } : {}) : newBlank(); });
  $('#upload-btn').addEventListener('click', () => openUpload());
  $('#inputs-btn').addEventListener('click', () => inputsDialog());

  enter.songs = (opts = {}) => {
    if (opts.selectId) { const i = songs().findIndex((s) => s.id === opts.selectId); if (i >= 0) songIdx = i; }
    songIdx = Math.min(songIdx, songs().length);
    car.pos = car.target = songIdx;
    renderCarousel(); syncPlayControls(); updateInputsButton();
    refreshInputs(); // pick up sheets added to the Inputs folder since last time
  };
  addEventListener('resize', () => { if (screen === 'songs') { car.spacing = Math.min(290, Math.max(200, innerWidth * 0.2)); layoutCards(car.pos); } });
  function startSelected() {
    const song = songs()[songIdx];
    if (!song) return openUpload();
    if (!RK.store.playableCount(song)) return openEditor(song, song.inputs ? { tab: 'sheet' } : {});
    startGame(song, { mode: settings.mode, rate: settings.rate / 100, part: RK.store.pickPart(song, wantedPart()), from: 'songs' });
  }

  // ---------- Inputs folder ----------
  const inputs = new RK.Inputs(store);
  let inputsSig = '';
  async function refreshInputs() {
    const files = await inputs.list();
    const sig = files.map((f) => f.name + ':' + f.text.length + ':' + (f.modified || 0)).join('|');
    if (sig === inputsSig && store.inputSongs) return false;
    inputsSig = sig;
    const keepId = songs()[songIdx]?.id;
    store.setInputs(files);
    updateInputsButton();
    if (screen === 'songs') {
      const i = keepId ? songs().findIndex((s) => s.id === keepId) : -1;
      songIdx = i >= 0 ? i : Math.min(songIdx, songs().length);
      car.pos = car.target = songIdx;
      renderCarousel();
    }
    return true;
  }
  function updateInputsButton() {
    const b = $('#inputs-btn');
    const n = (store.inputSongs || []).length;
    b.textContent = inputs.connected ? `INPUTS (${n})` : inputs.source === 'server' ? `INPUTS (${n})` : 'INPUTS';
    b.classList.toggle('on', inputs.connected);
  }
  async function inputsDialog() {
    const n = (store.inputSongs || []).length;
    const status = inputs.connected
      ? `Connected to the "${inputs.folderName}" folder. ${n} sheet${n === 1 ? '' : 's'} found. Uploaded and edited sheets are saved there as .txt files.`
      : inputs.source === 'server'
        ? `Reading ${n} sheet${n === 1 ? '' : 's'} from the Inputs folder on the server. To save new sheets into it, connect the folder once.`
        : 'Not connected. Connect the Inputs folder (inside the game\'s public folder) to read and save your sheets.';
    const body = el('div', {},
      el('p', { class: 'modal-body', text: status }),
      el('p', { class: 'modal-body', html: 'Any <code>.txt</code> sheet you put in <code>public/Inputs</code> shows up in the song list. Saving into the folder works in <b>Chrome</b> and <b>Edge</b>; other browsers keep your sheets in the browser instead.' }));
    const actions = [{ label: 'CLOSE', value: null }];
    if (inputs.connected) actions.push({ label: 'DISCONNECT', value: 'off' });
    if (inputs.supported) actions.push({ label: inputs.connected ? 'CHOOSE AGAIN' : 'CONNECT FOLDER', value: 'connect', kind: 'primary' });
    const v = await modal({ title: 'INPUTS FOLDER', body, actions });
    if (v === 'connect') { if (await connectInputs()) toast(`Connected to ${inputs.folderName}`, 'ok'); }
    if (v === 'off') { await inputs.disconnect(); inputsSig = ''; await refreshInputs(); updateInputsButton(); toast('Inputs folder disconnected'); }
  }
  async function connectInputs() {
    try {
      await inputs.connect();
      if (!/inputs/i.test(inputs.folderName)) toast(`Connected to "${inputs.folderName}". Tip: choose the Inputs folder inside public.`);
      inputsSig = '';
      await refreshInputs();
      updateInputsButton();
      return true;
    } catch (err) {
      if (err && err.name !== 'AbortError') toast(`Couldn't open the folder: ${err.message}`, 'bad');
      return false;
    }
  }
  // Make sure we can write to the Inputs folder; asks the user when needed. Returns true if writable.
  let keepInBrowser = false; // "KEEP IN BROWSER" was chosen: don't ask again this visit
  async function ensureWritable() {
    if (!inputs.supported) return false;
    if (!inputs.connected) {
      if (keepInBrowser) return false;
      const v = await modal({
        title: 'SAVE TO INPUTS?',
        body: el('div', {}, el('p', { class: 'modal-body', html: 'Your sheet can be saved as a <code>.txt</code> file in the game\'s <code>Inputs</code> folder. Pick that folder (inside <code>public</code>) once and the game remembers it.' })),
        actions: [{ label: 'KEEP IN BROWSER', value: false }, { label: 'CHOOSE INPUTS FOLDER', value: true, kind: 'primary' }],
      });
      if (!v) { keepInBrowser = true; return false; }
      if (!(await connectInputs())) return false;
    }
    let p = await inputs.permission(true);
    if (p !== 'granted') {
      const v = await modal({
        title: 'ALLOW SAVING?', body: `The browser needs your OK to save into "${inputs.folderName}".`,
        actions: [{ label: 'NOT NOW', value: false }, { label: 'ALLOW', value: true, kind: 'primary' }],
      });
      if (v) p = await inputs.permission(true);
    }
    return p === 'granted';
  }
  // Editor hook: save a chart's sheet text into Inputs.
  async function saveSheet(chart, text, { isNew }) {
    if (!(await ensureWritable())) return { ok: false };
    try {
      const file = chart.file || (await inputs.uniqueName(RK.inputsUtil.fileNameFor(chart.title)));
      await inputs.write(file, text);
      const id = RK.inputsUtil.idForFile(file);
      store.forgetLocal(chart.id);
      store.forgetLocal(id);
      inputsSig = '';
      await refreshInputs();
      return { ok: true, file, id };
    } catch (err) {
      toast(`Couldn't write the file: ${err.message}`, 'bad');
      return { ok: false };
    }
  }
  async function deleteSheet(chart) {
    if (!(await ensureWritable())) { toast(`Delete Inputs/${chart.file} yourself, or connect the folder first`, 'bad'); return false; }
    const ok = await inputs.remove(chart.file);
    if (!ok) { toast(`Couldn't delete Inputs/${chart.file}`, 'bad'); return false; }
    inputsSig = '';
    await refreshInputs();
    return true;
  }

  // ---------- uploads ----------
  function blankChart(extra = {}) {
    return normalizeChart({
      format: 3, id: newId(), title: 'My song', composer: '', description: 'A song you added.', keySig: 0, timeSig: [4, 4],
      tempos: [{ b: 0, bpm: 90, label: '' }], difficulty: 2, theme: 'night', created: Date.now(), notes: [], ...extra,
    });
  }
  function newBlank() { openEditor(blankChart(), { isNew: true, tab: 'sheet', text: null }); }

  async function openUpload() {
    const drop = el('div', { class: 'upload-drop', tabindex: 0, role: 'button' },
      el('div', { class: 'big-icon', text: '+' }),
      el('div', {}, el('b', { text: 'Choose a file' }), ' or drop it here'));
    const formats = el('dl', { class: 'formats' },
      el('dt', { text: 'TYPED' }), el('dd', { html: 'A <code>.txt</code> sheet with letters (<code>C D E</code>), do-re-mi, or numbers (<code>1 2 3</code>). Translated straight away and saved into the <code>Inputs</code> folder.' }),
      el('dt', { text: 'MUSIC APPS' }), el('dd', { html: '<code>.mid</code> MIDI, <code>.musicxml</code> / <code>.xml</code> / <code>.mxl</code> from MuseScore, Finale, Sibelius, Flat and others.' }),
      el('dt', { text: 'PHOTO / PDF' }), el('dd', { text: 'Shown beside the editor so you can type the notes while you look at it. Pictures are not read automatically.' }),
      el('dt', { text: 'CHART' }), el('dd', { html: 'A <code>.json</code> chart exported from Rainbow Keys.' }));
    const body = el('div', {}, drop, formats);
    let chosen = null;
    const done = modal({
      title: 'UPLOAD YOUR SHEET', body, wide: true,
      actions: [{ label: 'CANCEL', value: null }, { label: 'TYPE A SHEET', value: 'type' }, { label: 'CHOOSE FILE', value: 'pick', kind: 'primary' }],
      onOpen: (card, close) => {
        drop.addEventListener('click', () => close('pick'));
        drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close('pick'); } });
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); chosen = e.dataTransfer.files[0]; close('file'); });
      },
    });
    const v = await done;
    if (v === 'type') return newBlank();
    if (v === 'pick') chosen = await pickFile(RK.importers.ACCEPT);
    if (chosen) handleFile(chosen);
  }

  async function handleFile(file) {
    let r;
    try {
      toast(`Reading ${file.name}…`);
      r = await RK.importers.readFile(file, (p) => toast(`Reading PDF… ${Math.round(p * 100)}%`));
    } catch (err) { toast(`Couldn't read that: ${err.message}`, 'bad'); return; }
    if (!r) return;
    const title = r.name || 'My song';
    if (r.type === 'text') {
      const text = /^\s*(title|name)\s*[:=]/im.test(r.text) ? r.text : `title: ${title}\n${r.text}`;
      // typed sheets go straight into the Inputs folder
      if (await ensureWritable()) {
        try {
          const name = await inputs.uniqueName(RK.inputsUtil.fileNameFor(file.name.replace(/\.[^.]+$/, '')));
          await inputs.write(name, text);
          inputsSig = '';
          await refreshInputs();
          const song = store.get(RK.inputsUtil.idForFile(name));
          toast(`Saved to Inputs/${name}`, 'ok');
          if (song) { openEditor(song, { tab: 'sheet', info: `Translated and saved to Inputs/${name}` }); return; }
        } catch (err) { toast(`Couldn't save into Inputs: ${err.message}`, 'bad'); }
      }
      openEditor(blankChart({ title }), { isNew: true, tab: 'sheet', text, info: 'Translated! It will be kept in this browser when you save.' });
    } else if (r.type === 'chart') {
      const chart = normalizeChart({ ...r.chart, id: newId(), created: Date.now() });
      openEditor(chart, { isNew: true, tab: 'roll' });
    } else if (r.type === 'reference') {
      const chart = blankChart({ title });
      openEditor(chart, { isNew: true, tab: 'sheet', refPages: r.pages, text: `title: ${title}\ntempo: 90\ntime: 4/4\nkey: C\n\n// Look at your sheet on the left and type the notes here.\n// RH: is the treble clef (right hand), LH: is the bass clef (left hand).\nRH: \nLH: \n`, info: r.truncated ? 'Showing the first 16 pages of the PDF' : 'Type the notes you see; they are translated as you go' });
    } else if (r.type === 'parts') {
      const parsed = r.parsed;
      if (!parsed.parts.length || !parsed.parts.some((p) => p.notes.length)) { toast('No notes were found in that file', 'bad'); return; }
      const roles = RK.importers.guessRoles(parsed);
      const list = el('div', { class: 'parts' });
      for (const p of parsed.parts) {
        if (!p.notes.length) continue;
        const lo = Math.min(...p.notes.map((n) => n.midi)), hi = Math.max(...p.notes.map((n) => n.midi));
        const seg = el('div', { class: 'seg' });
        for (const [v, label] of [['treble', 'TREBLE CLEF (RH)'], ['bassclef', 'BASS CLEF (LH)'], ['backing', 'BACKING'], ['off', 'OFF']]) {
          const b = el('button', { type: 'button', text: label, class: roles[p.id] === v ? 'on' : '' });
          b.addEventListener('click', () => { roles[p.id] = v; [...seg.children].forEach((x) => x.classList.toggle('on', x === b)); });
          seg.append(b);
        }
        list.append(el('div', { class: 'part-row' },
          el('div', {}, el('div', { class: 'pn', text: p.name }), el('div', { class: 'pm', text: `${p.notes.length} notes · ${RK.notes.noteName(lo, RK.notes.laneOfMidi(lo))}–${RK.notes.noteName(hi, RK.notes.laneOfMidi(hi))}${p.drums ? ' · drums' : ''}` })),
          seg));
      }
      const body = el('div', {},
        el('p', { class: 'modal-body', text: 'Which hand plays each part? TREBLE CLEF = right hand (top staff), BASS CLEF = left hand (bottom staff). You choose which hand to play on the song screen; everything else is played for you.' }),
        list);
      const ok = await modal({ title: (parsed.title || title).toUpperCase(), body, wide: true, actions: [{ label: 'CANCEL', value: false }, { label: 'TRANSLATE', value: true, kind: 'primary' }] });
      if (!ok) return;
      if (!Object.values(roles).some((v) => v === 'treble' || v === 'bassclef')) { toast('Choose a TREBLE CLEF or BASS CLEF part', 'bad'); return; }
      const res = RK.importers.partsToChart(parsed, roles);
      const chart = blankChart({ title: parsed.title || title, composer: parsed.composer || '', keySig: res.keySig, timeSig: res.timeSig, tempos: res.tempos, notes: res.notes });
      const pc = RK.store.partCounts(chart);
      chart.difficulty = Math.max(1, Math.min(5, Math.round((pc.treble || pc.bassclef) / Math.max(1, chartLength(chart).sec) * 1.4)));
      openEditor(chart, { isNew: true, tab: 'roll', info: `Translated: ${pc.treble} treble clef · ${pc.bassclef} bass clef · ${pc.backing} backing notes` });
    }
  }
  // drag a file anywhere onto the song list
  let dragDepth = 0;
  addEventListener('dragenter', (e) => { if (screen !== 'songs' || isModalOpen() || !e.dataTransfer?.types?.includes('Files')) return; dragDepth++; $('#dropzone').classList.add('show'); });
  addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropzone').classList.remove('show'); });
  addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('#dropzone').classList.remove('show');
    if (screen === 'songs' && !isModalOpen() && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  // ---------- editor ----------
  let editorChart = null;
  const editor = new RK.Editor({
    audio, store, getSettings, laneOfCode, saveSheet, deleteSheet,
    onExit: (id) => go('songs', { selectId: id }),
    onTest: (chart) => { editorChart = chart; startGame(chart, { mode: 'normal', rate: settings.rate / 100, part: RK.store.pickPart(chart, wantedPart()), from: 'editor' }); },
  });
  function openEditor(song, opts = {}) {
    go('editor');
    editor.open(song, opts);
  }
  enter.editor = (opts) => { if (opts.resume) { editor.active = true; cancelAnimationFrame(editor.raf); editor.raf = requestAnimationFrame(editor.draw); editor.resize(); } };
  leave.editor = () => cancelAnimationFrame(editor.raf);

  // ---------- game & HUD ----------
  const hudEls = { score: $('#hud-score'), acc: $('#hud-acc'), prog: $('#hud-prog'), wait: $('#wait-hint') };
  const cache = {};
  let lastCount = null;
  const WORDS = { perfect: 'PERFECT!', great: 'GREAT', good: 'GOOD', miss: 'MISS', nice: 'NICE!' };
  const hud = {
    reset(g) {
      $('#hud-title').textContent = g.chart.title;
      const mode = { normal: 'PLAY', practice: 'PRACTICE', demo: 'WATCH' }[g.mode];
      $('#hud-sub').textContent = `${RK.store.PART_NAMES[g.part]} · ${mode}${g.rate !== 1 ? ` · ${Math.round(g.rate * 100)}%` : ''}`;
      hudEls.score.textContent = g.mode === 'normal' ? '0' : '';
      hudEls.acc.textContent = g.mode === 'normal' ? '100.00%' : g.mode === 'practice' ? '0 WRONG' : 'SIT BACK';
      Object.keys(cache).forEach((k) => delete cache[k]);
      $('#judge').className = 'judge';
      $('#j-combo').innerHTML = '';
      lastCount = null;
    },
    update({ score, acc, progress, waiting }) {
      if (score != null && cache.score !== score) { cache.score = score; hudEls.score.textContent = score.toLocaleString(); }
      if (game.mode === 'normal') { const a = acc.toFixed(2); if (cache.acc !== a) { cache.acc = a; hudEls.acc.textContent = `${a}%`; } }
      else if (game.mode === 'practice' && cache.wrong !== game.stats.wrong) { cache.wrong = game.stats.wrong; hudEls.acc.textContent = `${game.stats.wrong} WRONG`; }
      const p = Math.round(progress * 200) / 2;
      if (cache.p !== p) { cache.p = p; hudEls.prog.style.width = `${p}%`; }
      if (cache.wait !== waiting) { cache.wait = waiting; hudEls.wait.classList.toggle('show', !!waiting); }
    },
    judge(kind, combo, deltaMs) {
      const j = $('#judge'), w = $('#j-word');
      j.className = `judge ${kind}`;
      w.innerHTML = '';
      const word = WORDS[kind];
      if (kind === 'perfect') [...word].forEach((ch, i) => w.append(el('span', { class: 'ch', text: ch, style: { color: LANE_COLORS[i % 7][0] } })));
      else w.textContent = word;
      $('#j-detail').textContent = settings.timingDetail && (kind === 'great' || kind === 'good') ? `${deltaMs < 0 ? 'EARLY' : 'LATE'} ${Math.abs(Math.round(deltaMs))}MS` : '';
      $('#j-combo').innerHTML = combo >= 2 ? `<b>${combo}</b>COMBO` : '';
      void j.offsetWidth;
      j.classList.add('pop');
    },
    countdown(n) {
      if (n === lastCount) return;
      const cd = $('#countdown');
      if (n != null) { cd.textContent = n; audio.click(n === 1); }
      else if (lastCount === 1) cd.textContent = 'GO!';
      if (n != null || lastCount === 1) { cd.classList.remove('tick'); void cd.offsetWidth; cd.classList.add('tick'); }
      lastCount = n;
    },
  };
  const game = new RK.Game({ canvas: $('#game-canvas'), audio, getSettings, hud, onFinish: showResults });
  let session = null;
  function startGame(chart, { mode, rate, part = 'treble', from }) {
    session = { chart, mode, rate, part, from };
    freeAllUp();
    go('game', { force: true });
    $('#pause-overlay').classList.remove('open');
    requestAnimationFrame(() => game.start(chart, { mode, rate, part }));
  }
  enter.game = () => game.resize();
  leave.game = () => { game.stop(); $('#pause-overlay').classList.remove('open'); hudEls.wait.classList.remove('show'); };
  const pauseBtns = $$('[data-pause]');
  let pauseIdx = 0;
  function openPause() {
    if (!game.pause()) return;
    $('#pause-overlay').classList.add('open');
    $('#pause-view').textContent = `VIEW: ${settings.pianoView ? 'PIANO' : 'LIGHTS'}`;
    pauseIdx = 0; pauseBtns.forEach((b, i) => b.classList.toggle('focused', i === 0));
  }
  function pauseAction(a) {
    if (a === 'view') {
      setSetting('pianoView', !settings.pianoView);
      game.layout();
      game.render(0);
      $('#pause-view').textContent = `VIEW: ${settings.pianoView ? 'PIANO' : 'LIGHTS'}`;
      return;
    }
    $('#pause-overlay').classList.remove('open');
    if (a === 'resume') { game.resume(); lastCount = null; }
    else if (a === 'restart') startGame(session.chart, session);
    else if (a === 'quit') quitGame();
  }
  function quitGame() {
    game.stop();
    if (session?.from === 'editor') go('editor', { resume: true });
    else go('songs', { selectId: session?.chart.id });
  }
  pauseBtns.forEach((b) => b.addEventListener('click', () => pauseAction(b.dataset.pause)));
  $('#hud-pause').addEventListener('click', openPause);
  addEventListener('blur', () => { if (screen === 'game') openPause(); freeAllUp(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && screen === 'game') openPause(); });

  // ---------- results ----------
  function showResults(r) {
    go('results');
    const song = session.chart;
    $('#res-title').textContent = song.title;
    $('#res-editor').hidden = session.from !== 'editor';
    $('#res-mode').textContent = `${{ normal: 'RESULTS', practice: 'PRACTICE DONE', demo: 'THAT WAS IT' }[r.mode]} · ${RK.store.PART_NAMES[r.part]}${r.rate !== 1 ? ` · ${Math.round(r.rate * 100)}% SPEED` : ''}`;
    const g = $('#res-grade');
    g.classList.toggle('word', r.mode !== 'normal');
    g.textContent = r.mode === 'normal' ? r.grade : r.mode === 'practice' ? 'BRAVO' : 'ENCORE';
    g.style.color = r.mode === 'normal' ? { S: '#ffe03d', A: '#4fe06a', B: '#36c8ff', C: '#c56bff', D: '#ff4f5e' }[r.grade] : '#ff7ad9';
    g.style.animation = 'none'; void g.offsetWidth; g.style.animation = '';
    const badges = $('#res-badges'); badges.innerHTML = '';
    let newBest = false;
    if (r.mode === 'normal' && session.from !== 'editor') newBest = store.submitScore(song.id, { part: r.part, score: r.score, accuracy: r.accuracy, grade: r.grade, maxCombo: r.maxCombo, fullCombo: r.fullCombo, rate: r.rate });
    if (r.mode === 'normal') {
      if (r.allPerfect) badges.append(el('span', { class: 'badge', text: 'ALL PERFECT' }));
      else if (r.fullCombo) badges.append(el('span', { class: 'badge', text: 'FULL COMBO' }));
      if (newBest) { badges.append(el('span', { class: 'badge', text: 'NEW BEST' })); if (settings.menuSounds) setTimeout(() => audio.coin(), 500); }
    }
    $('#res-score-label').textContent = r.mode === 'normal' ? 'SCORE' : 'NOTES';
    const target = r.mode === 'normal' ? r.score : r.total;
    const sEl = $('#res-score'), t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1000);
      sEl.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString();
      if (k < 1 && screen === 'results') requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    const stats = $('#res-stats'); stats.innerHTML = '';
    const stat = (label, value, color) => { const b = el('b', { text: value }); if (color) b.style.color = color; stats.append(el('div', { class: 'stat' }, el('span', { text: label }), b)); };
    const JC = RK.JUDGE_COLORS;
    if (r.mode === 'normal') {
      stat('PERFECT', r.perfect, JC.perfect); stat('GREAT', r.great, JC.great); stat('GOOD', r.good, JC.good); stat('MISS', r.miss, JC.miss);
      stat('ACCURACY', `${r.accuracy.toFixed(1)}%`); stat('MAX COMBO', r.maxCombo); stat('TILES', r.total); stat('SPEED', `${Math.round(r.rate * 100)}%`);
    } else if (r.mode === 'practice') {
      stat('TILES', r.total); stat('WRONG KEYS', r.wrong, r.wrong ? JC.miss : JC.nice); stat('SPEED', `${Math.round(r.rate * 100)}%`); stat('NEXT', r.wrong <= r.total * 0.05 ? 'PLAY' : 'AGAIN');
    } else { stat('TILES', r.total); stat('SPEED', `${Math.round(r.rate * 100)}%`); }
    const tm = $('#res-timing'); tm.innerHTML = '';
    if (r.mode === 'normal' && r.deltasMs.length >= 6) {
      const cv = el('canvas'); tm.append(cv);
      requestAnimationFrame(() => drawHistogram(cv, r.deltasMs, r.windows));
      const m = r.meanOffsetMs;
      tm.append(el('div', { text: Math.abs(m) < 12
        ? `Your timing is centred (average ${m >= 0 ? '+' : ''}${m.toFixed(0)} ms). Nice and steady!`
        : `On average you hit ${Math.abs(m).toFixed(0)} ms ${m > 0 ? 'late' : 'early'}. If that feels like lag, set Timing offset to ${m > 0 ? '+' : '−'}${Math.round(Math.abs(m) / 5) * 5} ms in Settings.` }));
    } else if (r.mode === 'practice') {
      tm.textContent = r.wrong <= r.total * 0.05 ? 'Clean run! Try PLAY mode next, maybe at a slower speed first.' : 'Keep practising until the wrong keys drop, then try PLAY mode.';
    }
  }
  function drawHistogram(cv, deltas, win) {
    const r = cv.getBoundingClientRect();
    const W = Math.max(60, Math.round(r.width / 3)), H = 22;
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#0a0f36'; c.fillRect(0, 0, W, H);
    const lim = win.good * 1000, bins = Math.min(31, W >> 1), bw = (2 * lim) / bins;
    const counts = new Array(bins).fill(0);
    deltas.forEach((d) => { const i = Math.floor((d + lim) / bw); if (i >= 0 && i < bins) counts[i]++; });
    const max = Math.max(...counts, 1), colW = W / bins;
    counts.forEach((n, i) => {
      const mid = Math.abs(-lim + (i + 0.5) * bw);
      c.fillStyle = mid <= win.perfect * 1000 ? '#ffe03d' : mid <= win.great * 1000 ? '#36c8ff' : '#c56bff';
      const h = Math.round((n / max) * (H - 3));
      c.fillRect(Math.round(i * colW), H - 1 - h, Math.max(1, Math.round(colW) - 1), h);
    });
    c.fillStyle = '#ffffff'; c.fillRect(Math.round(W / 2), 0, 1, H);
  }
  $('#res-retry').addEventListener('click', () => startGame(session.chart, session));
  $('#res-back').addEventListener('click', () => go('songs', { selectId: session.chart.id }));
  $('#res-editor').addEventListener('click', () => go('editor', { resume: true }));

  // ---------- settings screen ----------
  function paintRange(r) { r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`); }
  function fmtSetting(k, v) {
    if (k === 'offset') return `${v > 0 ? '+' : ''}${v}MS`;
    if (k === 'perfect' || k === 'great' || k === 'good') return `${v}MS`;
    if (k === 'speed') return String(v);
    return `${v}%`;
  }
  function syncSettingsUI() {
    $$('[data-setting]').forEach((ctl) => {
      const k = ctl.dataset.setting, v = settings[k];
      if (ctl.type === 'range') { ctl.value = v; paintRange(ctl); ctl.nextElementSibling.textContent = fmtSetting(k, v); }
      else if (ctl.type === 'checkbox') ctl.checked = !!v;
      else if (ctl.classList.contains('seg')) $$('button', ctl).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
    });
    const base = $('#vd-base');
    base.innerHTML = '';
    base.classList.toggle('lights', !settings.pianoView);
    for (let l = 0; l < 7; l++) base.append(el('i', { style: { '--c': LANE_COLORS[l][0] } }));
    renderBinds();
    settingsPiano.refresh(); menuPiano.refresh();
    $('#help-windows').innerHTML = `<b class="c3">PERFECT</b> within ${settings.perfect} ms · <b class="c5">GREAT</b> within ${settings.great} ms · <b class="c7">GOOD</b> within ${settings.good} ms. A tile that passes the line is a <b class="c1">MISS</b>.`;
  }
  $$('[data-setting]').forEach((ctl) => {
    const k = ctl.dataset.setting;
    if (ctl.type === 'range') ctl.addEventListener('input', () => {
      let v = +ctl.value;
      settings[k] = v;
      if (k === 'perfect' || k === 'great' || k === 'good') {
        settings.timingPreset = 'custom';
        if (k === 'perfect') { settings.great = Math.max(settings.great, v + 10); settings.good = Math.max(settings.good, settings.great + 10); }
        if (k === 'great') { settings.perfect = Math.min(settings.perfect, v - 10); settings.good = Math.max(settings.good, v + 10); }
        if (k === 'good') { settings.great = Math.min(settings.great, v - 10); settings.perfect = Math.min(settings.perfect, settings.great - 10); }
        settings.perfect = Math.max(20, settings.perfect);
      }
      applySettings(); syncSettingsUI();
    });
    else if (ctl.type === 'checkbox') ctl.addEventListener('change', () => { setSetting(k, ctl.checked); if (k === 'menuSounds' && ctl.checked) audio.select(); });
    else if (ctl.classList.contains('seg')) $$('button', ctl).forEach((b) => b.addEventListener('click', () => {
      let v = b.dataset.v;
      if (v === 'true' || v === 'false') v = v === 'true';
      settings[k] = v;
      if (k === 'timingPreset' && TIMING_PRESETS[v]) Object.assign(settings, TIMING_PRESETS[v]);
      applySettings(); syncSettingsUI();
      if (k === 'instrument') { const n = audio.now(); [60, 64, 67, 72].forEach((m, i) => { const vv = audio.play(m, { vel: 0.6, when: n + i * 0.09 }); vv?.stop(n + 0.6 + i * 0.09); }); }
    }));
  });

  // key bindings
  let listening = null;
  function renderBinds() {
    const box = $('#binds');
    box.innerHTML = '';
    settings.bindings.forEach((b, lane) => {
      const card = el('button', { class: `bind${listening === lane ? ' listening' : ''}`, type: 'button', style: { '--c': LANE_COLORS[lane][0] }, title: `Change the key for ${LETTERS[lane]}` },
        el('span', { class: 'bn', text: LETTERS[lane] }),
        el('span', { class: 'bk', text: listening === lane ? '?' : b.label }),
        el('span', { class: 'bx', text: listening === lane ? 'press a key' : 'click to change' }));
      card.addEventListener('click', () => { listening = listening === lane ? null : lane; renderBinds(); });
      box.append(card);
    });
    const pr = $('#bind-presets');
    if (!pr.children.length) {
      for (const [name, list] of Object.entries(BINDING_PRESETS)) {
        pr.append(el('button', { class: 'chip pxchip', type: 'button', text: name, onclick: () => { settings.bindings = list.map((x) => ({ ...x })); listening = null; applySettings(); syncSettingsUI(); toast(`Keys set to ${name}`, 'ok'); } }));
      }
    }
  }
  function captureBinding(e) {
    if (listening == null) return false;
    e.preventDefault();
    if (e.key === 'Escape') { listening = null; renderBinds(); return true; }
    if (/^F\d+$/.test(e.code) || e.code === 'Tab') { toast('Pick a letter, number or symbol key'); return true; }
    const lane = listening;
    const label = e.key && e.key.length === 1 && e.key !== ' ' ? e.key.toUpperCase() : codeLabel(e.code);
    const other = settings.bindings.findIndex((b, i) => i !== lane && b.code === e.code);
    if (other >= 0) {
      settings.bindings[other] = { ...settings.bindings[lane] };
      toast(`Swapped: ${LETTERS[other]} is now ${settings.bindings[other].label}`);
    }
    settings.bindings[lane] = { code: e.code, label: label.slice(0, 3) };
    listening = lane < 6 ? lane + 1 : null; // move on to the next note, like a setup wizard
    applySettings(); syncSettingsUI();
    return true;
  }
  $('#calibrate').addEventListener('click', calibrate);
  $('#reset-settings').addEventListener('click', async () => {
    if (!(await confirmBox('Reset settings?', 'Put every setting, including your keys, back to the start?', 'Reset', true))) return;
    settings = { ...DEFAULT_SETTINGS, bindings: DEFAULT_SETTINGS.bindings.map((b) => ({ ...b })) };
    applySettings(); syncSettingsUI(); toast('Settings reset');
  });
  $('#backup').addEventListener('click', () => { download(`rainbow-keys-backup-${new Date().toISOString().slice(0, 10)}.json`, store.backup()); toast('Backup downloaded', 'ok'); });
  $('#restore').addEventListener('click', async () => {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const n = store.restore(JSON.parse(await f.text()));
      settings = loadSettings(); applySettings(); syncSettingsUI();
      toast(`Restored ${n} song${n === 1 ? '' : 's'}`, 'ok');
    } catch (err) { toast(`Couldn't restore: ${err.message}`, 'bad'); }
  });
  enter.settings = () => { syncSettingsUI(); freePiano = settingsPiano; };
  leave.settings = () => { freeAllUp(); listening = null; freePiano = menuPiano; };

  async function calibrate() {
    const LEAD = 4, TAPS = 8, interval = 0.6;
    const beats = el('div', { class: 'calib-beats' });
    for (let i = 0; i < LEAD + TAPS; i++) beats.append(el('i', { class: i < LEAD ? 'lead' : '' }));
    const out = el('div', { class: 'calib-out', text: 'GET READY…' });
    const body = el('div', { class: 'calib' }, el('p', { class: 'modal-body', text: 'Listen to 4 beeps, then tap SPACE exactly on each of the next 8.' }), beats, out);
    const taps = [], timers = [];
    let done = false, result = null;
    await audio.resume();
    const lat = audio.ctx?.outputLatency || audio.ctx?.baseLatency || 0;
    const startAt = audio.now() + 0.6, t0 = performance.now() / 1000 + 0.6 + lat;
    for (let i = 0; i < LEAD + TAPS; i++) {
      audio.click(i % 4 === 0, startAt + i * interval);
      timers.push(setTimeout(() => beats.children[i]?.classList.add('on'), (0.6 + lat + i * interval) * 1000));
      timers.push(setTimeout(() => beats.children[i]?.classList.remove('on'), (0.6 + lat + i * interval + 0.15) * 1000));
    }
    const finish = () => {
      if (done) return; done = true;
      if (taps.length < 5) { out.textContent = 'NOT ENOUGH TAPS. TRY AGAIN.'; return; }
      const s = [...taps].sort((a, b) => a - b), med = s[s.length >> 1];
      result = Math.max(-150, Math.min(150, Math.round(med / 5) * 5));
      out.textContent = `YOU TAP ${Math.abs(result)}MS ${result >= 0 ? 'LATE' : 'EARLY'} → OFFSET ${result > 0 ? '+' : ''}${result}`;
    };
    timers.push(setTimeout(finish, (0.6 + lat + (LEAD + TAPS) * interval + 0.4) * 1000));
    const v = await modal({
      title: 'CALIBRATE TIMING', body,
      actions: [{ label: 'CANCEL', value: null }, { label: 'USE IT', value: () => result ?? undefined, kind: 'primary', focus: false }],
      onKey: (e) => {
        if (e.code !== 'Space') return false;
        if (e.repeat || done) return true;
        const t = performance.now() / 1000 - t0, i = Math.round(t / interval);
        if (i >= LEAD && i < LEAD + TAPS) {
          taps.push((t - i * interval) * 1000);
          beats.children[i]?.classList.add('hit');
          out.textContent = `${taps.length} / ${TAPS}`;
          if (taps.length >= TAPS) finish();
        }
        return true;
      },
    });
    timers.forEach(clearTimeout);
    if (typeof v === 'number') { setSetting('offset', v); syncSettingsUI(); toast(`Timing offset set to ${v > 0 ? '+' : ''}${v} ms`, 'ok'); }
  }

  // ---------- help ----------
  enter.help = ({ part }) => {
    $('#help-title').textContent = part === 'credits' ? 'CREDITS' : 'HOW TO PLAY';
    $('#help-play').hidden = part === 'credits';
    $('#help-credits').hidden = part !== 'credits';
    syncSettingsUI();
  };

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (isModalOpen()) return;
    const k = e.key;
    switch (screen) {
      case 'splash':
        if (splashReady) { e.preventDefault(); enterApp(); }
        return;
      case 'menu':
        if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); focusMenu(menuIdx + (k === 'ArrowDown' ? 1 : -1)); return; }
        if (k === 'Enter') { e.preventDefault(); menuBtns[menuIdx].click(); return; }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && freeDown(e.code)) e.preventDefault();
        return;
      case 'songs':
        if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); selectSong(songIdx + (k === 'ArrowRight' ? 1 : -1)); return; }
        if (k === 'Enter') {
          const a = document.activeElement;
          if (a && a.tagName === 'BUTTON' && !a.classList.contains('song-card')) return;
          e.preventDefault(); startSelected(); return;
        }
        if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); action('menu'); }
        return;
      case 'settings':
        if (captureBinding(e)) return;
        if (k === 'Escape') { e.preventDefault(); action('menu'); return; }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && document.activeElement?.type !== 'range' && freeDown(e.code)) e.preventDefault();
        return;
      case 'help':
        if (k === 'Escape') { e.preventDefault(); action('menu'); }
        return;
      case 'exit':
        if (k === 'Enter' || k === 'Escape') go('menu');
        return;
      case 'editor':
        if (editor.keyDown(e)) e.preventDefault();
        return;
      case 'game': {
        if (game.state === 'paused') {
          if (k === 'Escape') { e.preventDefault(); pauseAction('resume'); }
          else if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); pauseIdx = (pauseIdx + (k === 'ArrowDown' ? 1 : pauseBtns.length - 1)) % pauseBtns.length; pauseBtns.forEach((b, i) => b.classList.toggle('focused', i === pauseIdx)); }
          else if (k === 'Enter') { e.preventDefault(); pauseBtns[pauseIdx].click(); }
          else if (e.code === 'KeyR') pauseAction('restart');
          else if (e.code === 'KeyV') pauseAction('view');
          else if (e.code === 'KeyQ') pauseAction('quit');
          return;
        }
        if (k === 'Escape') { e.preventDefault(); openPause(); return; }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const lane = laneOfCode(e.code);
        if (lane != null) { e.preventDefault(); if (!e.repeat) game.press(lane); }
        else if (k === ' ' || k === 'Tab' || k === "'" || k === '/') e.preventDefault();
        return;
      }
      case 'results':
        if (e.code === 'KeyR') { e.preventDefault(); startGame(session.chart, session); }
        else if (k === 'Enter' || k === 'Escape') { e.preventDefault(); session.from === 'editor' ? go('editor', { resume: true }) : go('songs', { selectId: session.chart.id }); }
        return;
    }
  });
  document.addEventListener('keyup', (e) => {
    if (screen === 'game') { const lane = laneOfCode(e.code); if (lane != null) game.release(lane); }
    else if (screen === 'editor') editor.keyUp(e);
    else freeUp(e.code);
  });
  // never let the stage scroll
  document.addEventListener('scroll', (e) => {
    const t = e.target;
    if (t === document) scrollTo(0, 0);
    else if (t.id === 'app' || t.classList?.contains('screen') || t.classList?.contains('carousel')) t.scrollTop = t.scrollLeft = 0;
  }, true);

  // ---------- boot ----------
  let splashReady = false;
  async function enterApp() {
    if (!splashReady || screen !== 'splash') return;
    await audio.resume();
    if (settings.menuSounds) {
      const n = audio.now();
      [60, 64, 67, 72, 76].forEach((m, i) => { const v = audio.play(m, { vel: 0.5, when: n + i * 0.08 }); v?.stop(n + 1.2 + i * 0.08); });
    }
    go('menu');
  }
  $('#screen-splash').addEventListener('pointerdown', enterApp);
  function loadScript(src) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src; s.onload = () => resolve(true); s.onerror = () => resolve(false);
      document.head.append(s);
    });
  }
  async function boot() {
    stars = new Starfield($('#stars'));
    store.loadSongs();
    inputs.init().then(() => refreshInputs()).catch(() => null);
    audio.init();
    applySettings();
    const fill = $('#load-fill');
    let fake = 0;
    const creep = setInterval(() => { fake = Math.min(40, fake + 3); fill.style.width = `${fake}%`; }, 80);
    const fonts = document.fonts ? Promise.all([document.fonts.load('16px "Press Start 2P"'), document.fonts.load('16px "DotGothic16"')]).catch(() => null) : Promise.resolve();
    const ok = await loadScript('assets/sounds/piano-samples.js');
    clearInterval(creep);
    await Promise.all([audio.load((p) => (fill.style.width = `${40 + Math.round(p * 60)}%`)), fonts]);
    fill.style.width = '100%';
    if (!ok) toast('Piano samples missing: using the 8-bit sound instead');
    splashReady = true;
    const hint = $('#splash-hint');
    hint.textContent = 'PRESS ANY KEY';
    hint.classList.add('ready');
    if (!store.storageOk) toast('This browser is blocking storage: songs and scores won\'t be kept', 'bad');
  }
  boot();

  window.rk = { game, editor, store, audio, go, car, inputs, refreshInputs, get settings() { return settings; } };
})();
