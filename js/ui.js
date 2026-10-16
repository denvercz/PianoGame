// Rainbow Keys — small UI helpers: DOM, dialogs, toasts, the starfield and the menu piano.
(function () {
  'use strict';
  const RK = (window.RK = window.RK || {});
  const { LETTERS, LANE_COLORS } = RK.notes;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv; } }
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const ch of children.flat()) if (ch != null && ch !== false) e.append(ch.nodeType ? ch : document.createTextNode(String(ch)));
    return e;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- modal ----------
  let modalClose = null;
  const isModalOpen = () => !!modalClose;
  function modal({ title, body, actions = [{ label: 'OK', value: true, kind: 'primary' }], onKey, wide = false, onOpen }) {
    return new Promise((resolve) => {
      const root = $('#modal');
      const card = el('div', { class: `modal-card${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
      card.append(el('h3', { class: 'modal-title', text: title }));
      if (typeof body === 'string') card.append(el('p', { class: 'modal-body', text: body }));
      else if (body) card.append(body);
      const row = el('div', { class: 'modal-actions' });
      let done = false;
      const close = (v) => {
        if (done) return; done = true;
        root.classList.remove('open');
        document.removeEventListener('keydown', keyer, true);
        modalClose = null;
        setTimeout(() => { if (!modalClose) root.innerHTML = ''; }, 160);
        resolve(v);
      };
      let focusBtn = null;
      actions.forEach((a) => {
        const b = el('button', { class: `pxbtn small${a.kind === 'primary' ? (a.danger ? ' danger' : ' primary') : a.danger ? ' danger' : ''}`, text: a.label.toUpperCase(), type: 'button',
          onclick: () => { const v = typeof a.value === 'function' ? a.value() : a.value; if (v !== undefined) close(v); } });
        row.append(b);
        if (a.kind === 'primary' && a.focus !== false) focusBtn = b;
      });
      if (actions.length) card.append(row);
      const keyer = (e) => {
        if (onKey && onKey(e, close)) { e.preventDefault(); e.stopPropagation(); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); return; }
        if (e.key === 'Enter' && e.target instanceof HTMLButtonElement && card.contains(e.target)) { e.preventDefault(); e.stopPropagation(); e.target.click(); return; }
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') {
          const primary = actions.find((a) => a.kind === 'primary');
          if (primary) { e.preventDefault(); e.stopPropagation(); const v = typeof primary.value === 'function' ? primary.value() : primary.value; if (v !== undefined) close(v); return; }
        }
        e.stopPropagation(); // keep keys away from the game behind
      };
      root.innerHTML = '';
      root.append(card);
      root.onmousedown = (e) => { if (e.target === root) close(null); };
      requestAnimationFrame(() => root.classList.add('open'));
      document.addEventListener('keydown', keyer, true);
      modalClose = close;
      setTimeout(() => (focusBtn || card.querySelector('input,select,textarea,button'))?.focus(), 40);
      onOpen?.(card, close);
    });
  }
  function confirmBox(title, text, okLabel = 'OK', danger = false) {
    return modal({ title, body: text, actions: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, kind: 'primary', danger }] });
  }
  function closeModal() { modalClose?.(null); }

  // ---------- toast ----------
  let toastTimer;
  // error toasts stay longer, can be selected, and have a COPY button
  function copyText(text) {
    const ok = () => true;
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(ok, () => fallback());
    return Promise.resolve(fallback());
    function fallback() {
      const ta = document.createElement('textarea');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      ta.value = text; document.body.append(ta); ta.select();
      let done = false;
      try { done = document.execCommand('copy'); } catch { done = false; }
      ta.remove();
      return done;
    }
  }
  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    const hide = () => (t.className = 'toast');
    if (kind === 'bad') {
      const b = el('button', { class: 'toast-copy', type: 'button', text: 'COPY', title: 'Copy this message' });
      b.addEventListener('click', () => copyText(msg).then((ok) => { b.textContent = ok ? 'COPIED' : 'SELECT + CTRL C'; }));
      t.append(' ', b);
      t.onmouseenter = () => clearTimeout(toastTimer);
      t.onmouseleave = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hide, 2500); };
      toastTimer = setTimeout(hide, 8000);
    } else {
      t.onmouseenter = t.onmouseleave = null;
      toastTimer = setTimeout(hide, 2600);
    }
  }

  // ---------- download helper ----------
  function download(name, data, type = 'application/json') {
    const blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 1)], { type });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  function pickFile(accept) {
    return new Promise((resolve) => {
      const inp = el('input', { type: 'file', accept, style: { display: 'none' } });
      inp.addEventListener('change', () => { resolve(inp.files[0] || null); inp.remove(); });
      document.body.append(inp);
      inp.click();
    });
  }

  // ---------- pixel starfield background ----------
  class Starfield {
    constructor(canvas) {
      this.cv = canvas; this.c = canvas.getContext('2d');
      this.running = true;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.resize();
      addEventListener('resize', () => this.resize());
      this.tick = this.tick.bind(this);
      requestAnimationFrame(this.tick);
    }
    resize() {
      this.P = Math.max(2, Math.round(Math.min(innerWidth, 2400) / 480));
      this.w = Math.ceil(innerWidth / this.P); this.h = Math.ceil(innerHeight / this.P);
      this.cv.width = this.w; this.cv.height = this.h;
      this.stars = Array.from({ length: Math.round((this.w * this.h) / 900) }, () => this.star(true));
    }
    star(init) {
      const big = Math.random() < 0.18;
      return { x: Math.random() * this.w, y: init ? Math.random() * this.h : -4, v: 2 + Math.random() * 8, big, ph: Math.random() * 6, col: Math.random() < 0.25 ? LANE_COLORS[(Math.random() * 7) | 0][2] : '#ffffff' };
    }
    setRunning(on) {
      if (on && !this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(this.tick); }
      this.running = on;
    }
    tick(ts) {
      if (!this.running) return;
      requestAnimationFrame(this.tick);
      const dt = Math.min(0.05, (ts - (this.last || ts)) / 1000); this.last = ts;
      const c = this.c;
      c.fillStyle = '#0d1442'; c.fillRect(0, 0, this.w, this.h);
      // soft horizontal bands for depth
      c.fillStyle = 'rgba(80,60,180,0.12)'; c.fillRect(0, Math.floor(this.h * 0.62), this.w, Math.ceil(this.h * 0.38));
      c.fillStyle = 'rgba(80,60,180,0.12)'; c.fillRect(0, Math.floor(this.h * 0.82), this.w, Math.ceil(this.h * 0.18));
      const frame = Math.floor(ts / 160);
      for (const s of this.stars) {
        if (!this.reduced) s.x -= s.v * dt * (s.big ? 1.6 : 1);
        if (s.x < -4) { Object.assign(s, this.star(false)); s.x = this.w + 2; s.y = Math.random() * this.h; }
        const x = Math.round(s.x), y = Math.round(s.y);
        const tw = (frame + Math.round(s.ph * 4)) % 8;
        c.fillStyle = s.col;
        if (s.big) {
          // little 4-point pixel star that pulses
          const r = tw < 2 ? 2 : tw < 4 ? 1 : tw < 6 ? 2 : 1;
          c.fillRect(x, y, 1, 1);
          c.fillRect(x - r, y, r, 1); c.fillRect(x + 1, y, r, 1);
          c.fillRect(x, y - r, 1, r); c.fillRect(x, y + 1, 1, r);
        } else {
          c.globalAlpha = tw < 4 ? 0.9 : 0.45;
          c.fillRect(x, y, 1, 1);
          c.globalAlpha = 1;
        }
      }
    }
  }

  // ---------- menu / settings piano: 7 white keys in rainbow colours ----------
  class DomPiano {
    constructor(container, { getBindings, onPress, onRelease, names = true } = {}) {
      this.root = container; this.getBindings = getBindings; this.onPress = onPress; this.onRelease = onRelease; this.names = names;
      this.keys = [];
      this.build();
    }
    build() {
      this.root.innerHTML = '';
      this.root.classList.add('pxpiano');
      const binds = this.getBindings();
      this.keys = LETTERS.map((L, lane) => {
        const k = el('div', { class: 'pk', 'data-lane': lane, style: { '--c': LANE_COLORS[lane][0], '--cd': LANE_COLORS[lane][1], '--cl': LANE_COLORS[lane][2] } },
          el('span', { class: 'pk-note', text: L }),
          el('span', { class: 'pk-key', text: binds[lane].label }));
        k.addEventListener('pointerdown', (e) => { e.preventDefault(); this.press(lane); this.onPress?.(lane); });
        const up = () => { if (k.classList.contains('down')) { this.release(lane); this.onRelease?.(lane); } };
        k.addEventListener('pointerup', up); k.addEventListener('pointerleave', up);
        this.root.append(k);
        return k;
      });
    }
    refresh() { const b = this.getBindings(); this.keys.forEach((k, i) => (k.querySelector('.pk-key').textContent = b[i].label)); }
    press(lane) { this.keys[lane]?.classList.add('down'); }
    release(lane) { this.keys[lane]?.classList.remove('down'); }
  }

  RK.ui = { $, $$, el, esc, modal, confirmBox, closeModal, isModalOpen, toast, copyText, download, pickFile, Starfield, DomPiano };
})();
