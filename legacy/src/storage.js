export const supportsFS = "showDirectoryPicker" in window;
export const LS_KEY = "vault.notes.v1";

export const uid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  Date.now().toString(36) + Math.random().toString(36).slice(2);

/* a note's display title: its first "# heading", else its filename */
export const noteTitle = (n) => {
  const h = n.content.match(/^#\s+(.+)$/m);
  return (h && h[1].trim()) || n.name.replace(/\.md$/i, "");
};

/* ---- localStorage vault (fallback that works everywhere) ---- */
const WELCOME = `# Welcome to your notes

This is a **live preview** editor: your Markdown formats as you type, and the raw
syntax only appears on the line your cursor is on. Click a line to see how it works.

## Try a few things
- Click into this bullet to reveal its \`-\` marker
- Type **/** on an empty line for headings, lists, quotes and more
- Link between notes with [[wiki-links]] — type [[ to search

> Everything you write is saved automatically.

Happy writing.`;

export function loadLocalNotes() {
  const raw = localStorage.getItem(LS_KEY);
  if (raw == null) {
    const at = Date.now();
    return [{ id: uid(), name: "Welcome.md", content: WELCOME, createdAt: at, updatedAt: at }];
  }
  try { return JSON.parse(raw) || []; }
  catch { return []; }
}
export function saveLocalNotes(notes) {
  localStorage.setItem(LS_KEY, JSON.stringify(notes));
}

/* ---- IndexedDB: remember the opened folder handle across reloads ---- */
export const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("vault-meta", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(v, k);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  },
  async get(k) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction("kv", "readonly");
      const rq = tx.objectStore("kv").get(k);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  },
};

/* ---- read every .md file in a directory handle ---- */
export async function readFolder(dirHandle) {
  const notes = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file" && name.toLowerCase().endsWith(".md")) {
      const file = await handle.getFile();
      notes.push({ id: name, name, content: await file.text(), handle, modified: file.lastModified });
    }
  }
  notes.sort((a, b) => b.modified - a.modified);
  return notes;
}

export async function verifyPermission(handle) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}

/* ---- organization sidecar: folders + per-note placement ----
   Kept separate from note content so it works for BOTH the localStorage
   vault and real .md files on disk (files stay flat; folders are a virtual
   overlay). Shape: { folders: [{id,name,collapsed,order}],
                      meta: { [noteId]: {folderId, pinned, order} } } */
export const ORG_KEY = "vault.org.v1";

export function loadOrg() {
  try {
    const o = JSON.parse(localStorage.getItem(ORG_KEY));
    return { folders: (o && o.folders) || [], meta: (o && o.meta) || {} };
  } catch {
    return { folders: [], meta: {} };
  }
}

export function saveOrg(folders, notes) {
  const meta = {};
  notes.forEach((n) => {
    meta[n.id] = {
      folderId: n.folderId ?? null,
      pinned: !!n.pinned,
      order: n.order ?? 0,
      // archiving and binning only hide a note — the .md file is left exactly
      // where it is until the bin is actually emptied
      archived: !!n.archived,
      archivedAt: n.archivedAt ?? null,
      deleted: !!n.deleted,
      deletedAt: n.deletedAt ?? null,
      createdAt: n.createdAt ?? null,
      updatedAt: n.updatedAt ?? null,
    };
  });
  localStorage.setItem(ORG_KEY, JSON.stringify({ folders, meta }));
}

/* merge saved placement onto freshly-loaded notes (index as order fallback) */
export function applyOrg(notes, meta) {
  const m = meta || {};
  return notes.map((n, i) => {
    const s = m[n.id] || {};
    return {
      ...n,
      folderId: s.folderId ?? null,
      pinned: !!s.pinned,
      order: s.order ?? i,
      archived: !!s.archived,
      archivedAt: s.archivedAt ?? null,
      deleted: !!s.deleted,
      deletedAt: s.deletedAt ?? null,
      createdAt: s.createdAt ?? n.createdAt ?? null,
      // a folder vault knows the file's real mtime, so use it when we have
      // nothing stored — better than showing an edit time of "never"
      updatedAt: s.updatedAt ?? n.updatedAt ?? n.modified ?? null,
    };
  });
}

/* The bin's own little store. Only a counter lives here — the binned notes
   themselves stay put and are just flagged, so restoring can't lose anything.
   Nothing is removed from disk until the bin is emptied. */
export const BIN_KEY = "vault.bin.v1";

export function loadBinMeta() {
  try {
    const b = JSON.parse(localStorage.getItem(BIN_KEY)) || {};
    return { deletions: Number(b.deletions) || 0 };
  } catch {
    return { deletions: 0 };
  }
}

export function saveBinMeta(meta) {
  try { localStorage.setItem(BIN_KEY, JSON.stringify(meta)); } catch { /* private mode */ }
}
