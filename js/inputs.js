// Rainbow Keys — the Inputs folder: plain .txt song sheets that live next to the game.
//
// Reading works two ways:
//   - served over http (e.g. `python -m http.server` in the public folder): the server's folder
//     listing of /Inputs/ is read, so new .txt files show up automatically
//   - a folder connected with the browser's folder picker (Chrome / Edge): read directly
// Writing (saving uploads and edits as .txt) needs the connected folder, because a plain web
// server can't accept files. The connection is remembered; the browser may ask again each visit.
(function () {
  'use strict';
  const RK = (window.RK = window.RK || {});
  const HANDLE_KEY = '__inputs_dir__';
  const isSheet = (name) => /\.txt$/i.test(name) && !/^[._]/.test(name) && !/^readme/i.test(name);

  class Inputs {
    constructor(store) {
      this.store = store;
      this.dir = null;
      this.supported = typeof window.showDirectoryPicker === 'function';
      this.source = 'none';   // where the last list came from: folder | server | none
    }

    async init() {
      if (!this.supported) return;
      try {
        const h = await this.store.loadRef(HANDLE_KEY);
        if (h && h.kind === 'directory') this.dir = h;
      } catch { /* not stored */ }
    }

    get connected() { return !!this.dir; }
    get folderName() { return this.dir?.name || 'Inputs'; }

    async permission(ask = false) {
      if (!this.dir) return 'none';
      try {
        let p = await this.dir.queryPermission({ mode: 'readwrite' });
        if (p !== 'granted' && ask) p = await this.dir.requestPermission({ mode: 'readwrite' });
        return p;
      } catch { return 'prompt'; }
    }

    // Must be called from a click (browsers only open pickers on a user action).
    async connect() {
      const h = await window.showDirectoryPicker({ id: 'rk-inputs', mode: 'readwrite' });
      this.dir = h;
      await this.store.saveRef(HANDLE_KEY, h);
      return h;
    }
    async disconnect() {
      this.dir = null;
      await this.store.deleteRef(HANDLE_KEY);
    }

    // -> [{ name, text, modified }]
    async list() {
      if (this.dir && (await this.permission()) === 'granted') {
        const out = [];
        try {
          for await (const [name, h] of this.dir.entries()) {
            if (h.kind !== 'file' || !isSheet(name)) continue;
            const f = await h.getFile();
            if (f.size > 2 * 1024 * 1024) continue;
            out.push({ name, text: await f.text(), modified: f.lastModified });
          }
          this.source = 'folder';
          return out.sort((a, b) => a.name.localeCompare(b.name));
        } catch { /* fall back to the server */ }
      }
      if (/^https?:$/.test(location.protocol)) {
        try {
          const res = await fetch('Inputs/', { cache: 'no-store' });
          if (res.ok) {
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const names = [...new Set([...doc.querySelectorAll('a[href]')]
              .map((a) => a.getAttribute('href'))
              .filter((h) => h && !h.includes('/') && !h.startsWith('?') && !h.startsWith('#'))
              .map((h) => { try { return decodeURIComponent(h); } catch { return h; } })
              .filter(isSheet))];
            const out = [];
            await Promise.all(names.map(async (name) => {
              try {
                const r = await fetch(`Inputs/${encodeURIComponent(name)}`, { cache: 'no-store' });
                if (r.ok) out.push({ name, text: await r.text(), modified: Date.parse(r.headers.get('Last-Modified') || '') || 0 });
              } catch { /* skip */ }
            }));
            this.source = 'server';
            return out.sort((a, b) => a.name.localeCompare(b.name));
          }
        } catch { /* no listing */ }
      }
      this.source = 'none';
      return [];
    }

    async exists(name) {
      if (!this.dir) return false;
      try { await this.dir.getFileHandle(name); return true; } catch { return false; }
    }
    async uniqueName(base) {
      const stem = base.replace(/\.txt$/i, '');
      let name = `${stem}.txt`, k = 2;
      while (await this.exists(name)) name = `${stem}-${k++}.txt`;
      return name;
    }
    // Needs permission already granted. Returns true when written.
    async write(name, text) {
      if (!this.dir || (await this.permission()) !== 'granted') return false;
      const fh = await this.dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
      return true;
    }
    async remove(name) {
      if (!this.dir || (await this.permission()) !== 'granted') return false;
      try { await this.dir.removeEntry(name); return true; } catch { return false; }
    }
  }

  // file name from a song title: "Für Elise (my version)" -> "fur-elise-my-version.txt"
  function fileNameFor(title) {
    const stem = String(title || 'my-song').normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'my-song';
    return `${stem}.txt`;
  }
  const idForFile = (name) => 'in-' + name.replace(/\.txt$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 44);

  RK.Inputs = Inputs;
  RK.inputsUtil = { fileNameFor, idForFile, isSheet };
})();
