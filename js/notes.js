// Rainbow Keys — music helpers shared by every module.
// Seven lanes, one per letter: C D E F G A B. Sharps and flats sit on their letter's lane
// (C♯ on C, B♭ on B) but still sound at their real pitch.
(function () {
  'use strict';
  const RK = (window.RK = window.RK || {});

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const NAT = [0, 2, 4, 5, 7, 9, 11];
  const LANES = 7;

  // Rainbow palette, one colour per lane: [main, dark, light]
  const LANE_COLORS = [
    ['#ff4f5e', '#a3162a', '#ffb3ba'], // C red
    ['#ff9b2f', '#a8510a', '#ffd3a1'], // D orange
    ['#ffe03d', '#9c7a00', '#fff3a8'], // E yellow
    ['#4fe06a', '#167a2e', '#b8f5c3'], // F green
    ['#36c8ff', '#0a6e9c', '#aee9ff'], // G sky
    ['#6f7bff', '#2a2fa8', '#c3c8ff'], // A blue
    ['#c56bff', '#6c25a6', '#e8c4ff'], // B violet
  ];

  const DEFAULT_BINDINGS = [
    { code: 'KeyX', label: 'X' }, { code: 'KeyC', label: 'C' }, { code: 'KeyV', label: 'V' },
    { code: 'KeyB', label: 'B' }, { code: 'KeyN', label: 'N' }, { code: 'KeyM', label: 'M' },
    { code: 'Comma', label: ',' },
  ];
  const BINDING_PRESETS = {
    'X C V B N M ,': DEFAULT_BINDINGS,
    'Z X C V B N M': ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'].map(codeToBinding),
    'S D F G H J K': ['KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'].map(codeToBinding),
    'A S D F J K L': ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'].map(codeToBinding),
    '1 2 3 4 5 6 7': ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].map(codeToBinding),
  };

  const CODE_LABELS = {
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Space: 'SPC', Enter: 'ENT', ShiftLeft: 'LSH',
    ShiftRight: 'RSH', ControlLeft: 'LCT', ControlRight: 'RCT', AltLeft: 'ALT', AltRight: 'ALT',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Tab: 'TAB', CapsLock: 'CAP',
    Backspace: 'BSP', IntlBackslash: '\\',
  };
  function codeLabel(code) {
    if (!code) return '?';
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'N' + code.slice(6).replace('Decimal', '.').slice(0, 2);
    return CODE_LABELS[code] || code.slice(0, 3).toUpperCase();
  }
  function codeToBinding(code) { return { code, label: codeLabel(code) }; }

  const mod = (a, n) => ((a % n) + n) % n;

  // Lane of a pitch when we only know the MIDI number (black keys need a spelling choice).
  function laneOfMidi(midi, preferFlats) {
    const pc = mod(midi, 12);
    const i = NAT.indexOf(pc);
    if (i >= 0) return i;
    const below = NAT.indexOf(pc - 1); // C♯ -> C
    const above = NAT.indexOf(pc + 1); // D♭ -> D
    return preferFlats ? above : below;
  }

  // Spell a pitch on a given lane: { letter, alter, octave }.
  function spell(midi, lane) {
    let alter = mod(midi - NAT[lane], 12);
    if (alter > 6) alter -= 12;
    const octave = Math.round((midi - alter - NAT[lane]) / 12) - 1;
    return { letter: LETTERS[lane], alter, octave };
  }
  const ACC = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
  const ACC_ASCII = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' };
  function noteName(midi, lane, withOctave = true, ascii = false) {
    const s = spell(midi, lane);
    const acc = (ascii ? ACC_ASCII : ACC)[s.alter] ?? '';
    return s.letter + acc + (withOctave ? s.octave : '');
  }
  function midiOf(lane, alter, octave) { return 12 * (octave + 1) + NAT[lane] + alter; }

  // Key signatures: -7..7, negative = flats.
  const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
  const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];  // B E A D G C F
  function keySigAlter(sig, lane) {
    if (sig > 0) return SHARP_ORDER.slice(0, sig).includes(lane) ? 1 : 0;
    if (sig < 0) return FLAT_ORDER.slice(0, -sig).includes(lane) ? -1 : 0;
    return 0;
  }
  const MAJOR_NAMES = { '-7': 'C♭', '-6': 'G♭', '-5': 'D♭', '-4': 'A♭', '-3': 'E♭', '-2': 'B♭', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F♯', 7: 'C♯' };
  const MINOR_NAMES = { '-7': 'A♭', '-6': 'E♭', '-5': 'B♭', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D', 0: 'A', 1: 'E', 2: 'B', 3: 'F♯', 4: 'C♯', 5: 'G♯', 6: 'D♯', 7: 'A♯' };
  function keySigName(sig) {
    const n = Math.abs(sig);
    return {
      major: MAJOR_NAMES[sig], minor: MINOR_NAMES[sig],
      acc: sig === 0 ? 'no sharps or flats' : `${n} ${sig < 0 ? 'flat' : 'sharp'}${n > 1 ? 's' : ''}`,
      short: sig === 0 ? '—' : `${n}${sig < 0 ? '♭' : '♯'}`,
      label: `${MAJOR_NAMES[sig]} major / ${MINOR_NAMES[sig]} minor`,
    };
  }
  function keySigLetters(sig) {
    return (sig < 0 ? FLAT_ORDER.slice(0, -sig) : SHARP_ORDER.slice(0, sig)).map((l) => LETTERS[l]);
  }
  // Parse "G", "Bb", "F#m", "Am", "2#", "3b", "-2", "0" -> key signature number, or null.
  function parseKey(text) {
    const t = String(text).trim().replace('♭', 'b').replace('♯', '#');
    let m = /^(-?\d)$/.exec(t);
    if (m) return Math.max(-7, Math.min(7, +m[1]));
    m = /^(\d)\s*(#|b|sharps?|flats?)$/i.exec(t);
    if (m) return (/^(#|sharp)/i.test(m[2]) ? 1 : -1) * Math.min(7, +m[1]);
    m = /^([A-Ga-g])(#|b)?\s*(m|min|minor|maj|major)?$/.exec(t);
    if (!m) return null;
    const minor = m[3] && /^m(in(or)?)?$/i.test(m[3]);
    const name = m[1].toUpperCase() + (m[2] === '#' ? '♯' : m[2] === 'b' ? '♭' : '');
    const table = minor ? MINOR_NAMES : MAJOR_NAMES;
    for (let s = -7; s <= 7; s++) if (table[s] === name) return s;
    return null;
  }

  // Default pitch for a lane when there is no note to borrow one from (C4..B4).
  const defaultMidi = (lane, octave = 4) => midiOf(lane, 0, octave);

  RK.notes = {
    LETTERS, NAT, LANES, LANE_COLORS, DEFAULT_BINDINGS, BINDING_PRESETS,
    codeLabel, codeToBinding, laneOfMidi, spell, noteName, midiOf,
    keySigAlter, keySigName, keySigLetters, parseKey, defaultMidi, mod,
  };
})();
