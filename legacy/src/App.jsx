import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import LiveEditor from "./LiveEditor.jsx";
import { renderMarkdown } from "./markdown.js";
import { makeTree, MAX_FOLDER_DEPTH } from "./tree.js";
import {
  supportsFS, uid, noteTitle, loadLocalNotes, saveLocalNotes,
  idb, readFolder, verifyPermission, loadOrg, saveOrg, applyOrg, loadBinMeta, saveBinMeta,
} from "./storage.js";
import {
  THEMES, DENSITIES, ACCENTS, ACCENT_MODES, ACCENT_SCOPES, SECTIONS, ARCHIVE_SORTS, STARTUPS,
  loadSettings, saveSettings, applySettings, applyAccent,
} from "./settings.js";
import { MARKS, PALETTE, hlOf, toggleWrap, applyColour, clearColour } from "./format.js";
import {
  DATE_FORMATS, NUMBER_FORMATS, formatDate, formatDateTime, formatNumber, timezones, localZone,
} from "./intl.js";

/* ---------- icons ---------- */
const STAR = "M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 17.02l-5.2 2.74.99-5.79-4.21-4.1 5.82-.85z";
const Icon = ({ path, className = "h-4 w-4", stroke = 1.7, fill = "none" }) => (
  <svg viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={stroke}
       strokeLinecap="round" strokeLinejoin="round" className={className}>{path}</svg>
);
const I = {
  folder: <Icon path={<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />} />,
  folderPlus: <Icon path={<><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /><path d="M12 10.5v5M9.5 13h5" /></>} />,
  filePlus: <Icon path={<><path d="M13 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V9z" /><path d="M13 3v6h6" /><path d="M12 12v5M9.5 14.5h5" /></>} />,
  search: <Icon path={<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>} />,
  trash: <Icon path={<path d="M6 7h12M9.5 7V5.5A1.5 1.5 0 0111 4h2a1.5 1.5 0 011.5 1.5V7m-7 0l.7 11a1.5 1.5 0 001.5 1.4h3.6a1.5 1.5 0 001.5-1.4L17 7" />} />,
  doc: <Icon path={<><path d="M6 3h8l4 4v14a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M14 3v4h4" /></>} />,
  edit: <Icon path={<path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z" />} />,
  eye: <Icon path={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>} />,
  chevron: <Icon path={<path d="M9 6l6 6-6 6" />} />,
  star: <Icon path={<path d={STAR} />} />,
  starFilled: <Icon fill="currentColor" stroke={1.2} path={<path d={STAR} />} />,
  sliders: <Icon path={<><path d="M4 8h9M18 8h2M4 16h2M11 16h9" /><circle cx="15.5" cy="8" r="2" /><circle cx="8.5" cy="16" r="2" /></>} />,
  grip: <Icon fill="currentColor" stroke={0} path={<><circle cx="9" cy="6" r="1.3" /><circle cx="15" cy="6" r="1.3" /><circle cx="9" cy="12" r="1.3" /><circle cx="15" cy="12" r="1.3" /><circle cx="9" cy="18" r="1.3" /><circle cx="15" cy="18" r="1.3" /></>} />,
  x: <Icon path={<path d="M6 6l12 12M18 6L6 18" />} />,
  gear: <Icon path={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></>} />,
  sun: <Icon path={<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>} />,
  moon: <Icon path={<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />} />,
  check: <Icon path={<path d="M20 6L9 17l-5-5" />} />,
  archive: <Icon path={<><rect x="3" y="4" width="18" height="4.5" rx="1" /><path d="M4.5 8.5V19a1 1 0 001 1h13a1 1 0 001-1V8.5" /><path d="M10 12.5h4" /></>} />,
  restore: <Icon path={<><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.7L3 8" /><path d="M3 3.5V8h4.5" /></>} />,
  text: <Icon path={<path d="M4 6h16M4 11h16M4 16h9" />} />,
  sort: <Icon path={<><path d="M4 6h9M4 12h6M4 18h3" /><path d="M17 5v13M14 15l3 3 3-3" /></>} />,
};

/* The lid is its own <g> so CSS can hinge it open — the visual cue that
   something just went in. See .bin-lid in index.css. */
const BinIcon = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <g className="bin-lid">
      <path d="M4 7h16" />
      <path d="M9.5 7V5.6A1.6 1.6 0 0111 4h2a1.6 1.6 0 011.5 1.6V7" />
    </g>
    <path d="M6.2 9l.6 10.1a1.6 1.6 0 001.6 1.5h7.2a1.6 1.6 0 001.6-1.5L17.8 9" />
  </svg>
);

/* Indentation is expressed in the density variables, so a change to the
   compactness setting re-indents the tree without React re-measuring anything. */
const padFor = (depth) => `calc(var(--row-pad0) + ${depth} * var(--row-indent))`;
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const preview = (n) =>
  n.content.replace(/^#.+$/m, "").replace(/[#*`>_\-[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
const onDate = (ms) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
const archivedOn = (item) => onDate(item.archivedAt);
const binnedOn = (item) => onDate(item.deletedAt);

/* small toolbar button */
const TB = ({ onClick, active, title, children }) => (
  <button onClick={onClick} title={title}
    className={"inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-brand-200 " +
      (active ? "bg-brand-500/12 text-brand-600 ring-1 ring-brand-300/50"
              : "text-ink-600 hover:bg-surface/70 hover:text-brand-600")}>
    {children}
  </button>
);

/* tiny hover action button on a row */
const RowBtn = ({ onClick, title, tone = "ink", children, always = false }) => (
  <button onClick={onClick} title={title}
    className={`shrink-0 rounded-md p-1 transition group-hover:opacity-100 ${always ? "opacity-100" : "opacity-0"} ` +
      (tone === "brand" ? "text-brand-500 hover:text-brand-600" : "text-ink-300 hover:text-brand-600")}>
    {children}
  </button>
);

/* Sort picker for the archive header. Lives only in the archive, so it costs
   nothing anywhere else in the sidebar. */
function SortMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const current = ARCHIVE_SORTS.find((o) => o.id === value) || ARCHIVE_SORTS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <span ref={box} className="relative inline-flex">
      <button onClick={() => setOpen((o) => !o)} title={`Sorted by ${current.label.toLowerCase()}`}
        className={"flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
          (open ? "bg-brand-500/15 text-brand-600" : "text-ink-400 hover:bg-brand-500/10 hover:text-brand-600")}>
        {I.sort}<span>{current.short}</span>
      </button>
      {open && (
        <div className="fade-in absolute right-0 top-7 z-40 w-max rounded-xl border border-ink-300/25 bg-surface p-1 shadow-float">
          {ARCHIVE_SORTS.map((o) => (
            <button key={o.id} onClick={() => { onChange(o.id); setOpen(false); }}
              className={"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] normal-case tracking-normal transition duration-150 " +
                (o.id === value ? "bg-brand-500/12 text-brand-600" : "text-ink-600 hover:bg-brand-500/8 hover:text-brand-600")}>
              <span className={o.id === value ? "opacity-100" : "opacity-0"}>{I.check}</span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/* a filter chip that lives inside the search pill */
const SearchToggle = ({ on, onClick, title, children }) => (
  <button onClick={onClick} title={title} aria-pressed={on}
    className={"flex h-6 w-6 shrink-0 items-center justify-center rounded-full outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
      (on ? "bg-brand-500/20 text-brand-600" : "text-ink-300 hover:bg-brand-500/10 hover:text-ink-500")}>
    {children}
  </button>
);

/* The message tray: the strip of empty sidebar to the right of the bin button.
   Anything the app needs to say quietly goes here rather than pushing the note
   list around — one line of text plus a couple of link-sized actions, sized to
   sit level with the bin and settings buttons. `tip` carries the full sentence,
   since the line itself has to stay short. */
const Tray = ({ tip, actions, children }) => (
  <div title={tip}
    className="pointer-events-auto fade-in flex h-10 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-xl border border-ink-300/30 bg-surface/90 px-2.5 shadow-card backdrop-blur">
    <p className="truncate text-[11px] leading-none text-ink-600">{children}</p>
    <div className="flex gap-2 text-[10px] leading-none">{actions}</div>
  </div>
);

/* ---------- sidebar ---------- */
function Sidebar({
  vaultName, backend, notes, folders, activeId,
  onSelect, onNewNote, onNewFolder, onNewNoteIn, onNewFolderIn,
  onBin, onRestoreFromBin, onPurge, onEmptyBin, binNudge, onDismissNudge,
  onTogglePin, onTogglePinFolder, onArchive, onArchiveFolders,
  onToggleFolder, onRenameFolder, onMoveItems, onOpenFolder,
  archiveSort, onArchiveSort, freeArrange, accent, accentMode, accentScope, theme,
}) {
  const asideRef = useRef(null);
  /* A sidebar-scoped tint lives on the <aside>, so the cascade contains it.
     Everything else (no accent, text mode, whole-app tint) is handled at the
     root, and this clears itself out of the way. */
  useLayoutEffect(() => {
    applyAccent(asideRef.current, {
      accent, mode: accentMode, theme,
      active: accentMode === "tint" && accentScope === "sidebar",
    });
  }, [accent, accentMode, accentScope, theme]);
  const [q, setQ] = useState("");
  const [view, setView] = useState("notes");        // "notes" | "archive" | "bin"
  const [deep, setDeep] = useState(true);           // search note contents, not just titles
  const [withArchived, setWithArchived] = useState(true);
  const [organize, setOrganize] = useState(false);
  const [renaming, setRenaming] = useState(null);   // folder id being renamed
  const [drag, setDrag] = useState(null);           // { noteIds:[], folderIds:[] } being dragged
  const [hint, setHint] = useState(null);           // drop target hint
  const [sel, setSel] = useState({ notes: new Set(), folders: new Set() }); // ⌘/ctrl-click multi-select

  const tree = useMemo(() => makeTree(folders), [folders]);
  const validIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);

  /* A folder carries its whole subtree into the archive, so "is this archived?"
     is: the note's own flag, or any ancestor folder being archived. Everything
     below is built from `live`, never from `notes`, so an archived item can't
     leak back into the tree, into Pinned, or into an unfiltered search. */
  const scopeOf = useCallback((flag) => {
    const set = new Set();
    folders.forEach((f) => {
      if (!f[flag]) return;
      set.add(f.id);
      tree.descendants(f.id).forEach((d) => set.add(d));
    });
    return set;
  }, [folders, tree]);
  const archivedScope = useMemo(() => scopeOf("archived"), [scopeOf]);
  const binnedScope = useMemo(() => scopeOf("deleted"), [scopeOf]);

  /* Binned beats archived: something in the bin is gone from the sidebar
     entirely, including from the archive view. */
  const isBinned = useCallback(
    (n) => !!n.deleted || (n.folderId != null && binnedScope.has(n.folderId)),
    [binnedScope]
  );
  const isArchived = useCallback(
    (n) => !isBinned(n) && (!!n.archived || (n.folderId != null && archivedScope.has(n.folderId))),
    [archivedScope, isBinned]
  );
  const live = useMemo(
    () => notes.filter((n) => !isArchived(n) && !isBinned(n)),
    [notes, isArchived, isBinned]
  );
  const archived = useMemo(
    () => notes.filter(isArchived).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    [notes, isArchived]
  );
  const binned = useMemo(
    () => notes.filter(isBinned).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [notes, isBinned]
  );
  const binnedRoots = useMemo(
    () => folders.filter((f) => f.deleted && !(f.parentId != null && binnedScope.has(f.parentId))).sort(byOrder),
    [folders, binnedScope]
  );
  const looseBinned = useMemo(
    () => binned.filter((n) => n.folderId == null || !binnedScope.has(n.folderId)),
    [binned, binnedScope]
  );
  const binHasItems = binnedRoots.length > 0 || looseBinned.length > 0;
  /* The archive view's roots: archived folders not already inside another one,
     plus notes archived on their own rather than carried in by a folder. Only
     this top level is sorted — a folder keeps its own internal order so that
     restoring it puts everything back exactly as it was. */
  const cmp = useCallback((label) => (a, b) => {
    if (archiveSort === "oldest") return (a.archivedAt ?? 0) - (b.archivedAt ?? 0);
    if (archiveSort === "az") return label(a).localeCompare(label(b));
    if (archiveSort === "za") return label(b).localeCompare(label(a));
    return (b.archivedAt ?? 0) - (a.archivedAt ?? 0);   // recent
  }, [archiveSort]);
  const archivedRoots = useMemo(
    () => folders
      .filter((f) => f.archived && !f.deleted && !binnedScope.has(f.id)
        && !(f.parentId != null && archivedScope.has(f.parentId)))
      .sort(cmp((f) => f.name || "")),
    [folders, archivedScope, binnedScope, cmp]
  );
  const looseArchived = useMemo(
    () => archived.filter((n) => n.folderId == null || !archivedScope.has(n.folderId)).sort(cmp(noteTitle)),
    [archived, archivedScope, cmp]
  );

  const childFolders = (pid) => (tree.children.get(pid ?? null) || []).slice().sort(byOrder);
  const rootNotes = useMemo(
    () => live.filter((n) => !n.folderId || !validIds.has(n.folderId)).sort(byOrder),
    [live, validIds]
  );

  const s = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!s) return null;
    const pool = withArchived ? notes : live;
    return pool.filter((n) =>
      noteTitle(n).toLowerCase().includes(s) || (deep && n.content.toLowerCase().includes(s)));
  }, [s, notes, live, deep, withArchived]);
  const archivedHits = useMemo(
    () => (filtered ? filtered.filter(isArchived).length : 0),
    [filtered, isArchived]
  );

  /* pinned section (dedupe items already shown under a pinned ancestor folder) */
  const pinnedFolders = useMemo(() => folders.filter((f) => f.pinned), [folders]);
  const pinnedSet = useMemo(() => new Set(pinnedFolders.map((f) => f.id)), [pinnedFolders]);
  const topPinnedFolders = useMemo(
    () => pinnedFolders.filter((f) => !tree.hasAncestorIn(f.id, pinnedSet)).sort(byOrder),
    [pinnedFolders, pinnedSet, tree]
  );
  const pinnedSubtree = useMemo(() => {
    const set = new Set();
    topPinnedFolders.forEach((f) => { set.add(f.id); tree.descendants(f.id).forEach((d) => set.add(d)); });
    return set;
  }, [topPinnedFolders, tree]);
  const topPinnedNotes = useMemo(
    () => live.filter((n) => n.pinned && (!n.folderId || !pinnedSubtree.has(n.folderId))).sort(byOrder),
    [live, pinnedSubtree]
  );
  const hasPinned = topPinnedFolders.length > 0 || topPinnedNotes.length > 0;
  const inArchive = view === "archive";
  const inBin = view === "bin";

  /* The lid hinges open while a drag is aimed at the bin, and for a moment after
     you click it, so the icon always confirms where things went. */
  const [lidClick, setLidClick] = useState(false);
  const lidOpen = lidClick || (hint && hint.kind === "trash");
  const flipLid = () => { setLidClick(true); setTimeout(() => setLidClick(false), 420); };

  /* Emptying from the bin page drops you back into your notes, so you're not left
     staring at the now-empty bin having to tap the bin icon again to get out. Only
     navigates when something was actually purged — a cancelled confirm leaves you
     where you were. */
  const handleEmptyBin = async () => {
    flipLid();
    const purged = await onEmptyBin();
    if (purged) { setView("notes"); setQ(""); }
  };

  /* Pinning moves an item up into the Pinned section rather than mirroring it,
     so it is hidden wherever it normally lives. Items shown *inside* a pinned
     folder are not hoisted — they travel with their parent. */
  const hoistedFolders = useMemo(() => new Set(topPinnedFolders.map((f) => f.id)), [topPinnedFolders]);
  const hoistedNotes = useMemo(() => new Set(topPinnedNotes.map((n) => n.id)), [topPinnedNotes]);

  /* mode is "tree" | "pinned" | "archive". Only the live tree hides archived
     subtrees and hoists pinned items — inside a pinned or archived folder
     everything travels with its parent. */
  const foldersUnder = (pid, mode) =>
    childFolders(pid).filter((f) =>
      mode === "archive" || mode === "bin"
        ? true
        : !archivedScope.has(f.id) && !binnedScope.has(f.id)
          && (mode === "pinned" || !hoistedFolders.has(f.id)));
  const notesUnder = (fid, mode) =>
    (mode === "archive" || mode === "bin" ? notes : live)
      .filter((n) => (n.folderId ?? null) === (fid ?? null))
      .sort(byOrder)
      .filter((n) => mode !== "tree" || !hoistedNotes.has(n.id));

  /* The one place the free-arrange setting is read: folders and notes share an
     order sequence, so mixing them is just a matter of merging before sorting
     instead of concatenating after. */
  const mix = (fs, ns) => {
    const tagged = [...fs.map((f) => ({ k: "f", it: f })), ...ns.map((n) => ({ k: "n", it: n }))];
    return freeArrange ? tagged.sort((a, b) => (a.it.order ?? 0) - (b.it.order ?? 0)) : tagged;
  };
  const renderChild = (c, depth, mode) =>
    c.k === "f" ? folderRow(c.it, depth, mode) : noteRow(c.it, depth, mode);
  const visibleRootNotes = useMemo(
    () => rootNotes.filter((n) => !hoistedNotes.has(n.id)),
    [rootNotes, hoistedNotes]
  );

  /* ----- selection (⌘/ctrl-click adds to the set, like a file explorer) ----- */
  const selCount = sel.notes.size + sel.folders.size;
  const clearSel = () => setSel({ notes: new Set(), folders: new Set() });
  const toggleSel = (kind, id) =>
    setSel((p) => {
      const next = { notes: new Set(p.notes), folders: new Set(p.folders) };
      const bag = kind === "note" ? next.notes : next.folders;
      if (bag.has(id)) bag.delete(id); else bag.add(id);
      return next;
    });

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") clearSel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  /* ----- drag & drop (always on — no need to enter Organize) ----- */
  const startDrag = (e, kind, id) => {
    // dragging something outside the selection makes it the selection
    const inSel = kind === "note" ? sel.notes.has(id) : sel.folders.has(id);
    const picked = inSel ? sel : {
      notes: kind === "note" ? new Set([id]) : new Set(),
      folders: kind === "folder" ? new Set([id]) : new Set(),
    };
    if (!inSel) setSel(picked);
    setDrag({ noteIds: [...picked.notes], folderIds: [...picked.folders] });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);

    const total = picked.notes.size + picked.folders.size;
    if (total > 1) {
      const ghost = document.createElement("div");
      ghost.textContent = `${total} items`;
      ghost.style.cssText =
        "position:fixed;top:-1000px;left:-1000px;padding:7px 13px;border-radius:10px;" +
        "background:rgb(var(--surface));color:rgb(var(--ink-900));border:1px solid rgb(var(--brand-300));" +
        "font:500 13px Inter,system-ui,sans-serif;box-shadow:var(--shadow-card)";
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 14, 14);
      setTimeout(() => ghost.remove(), 0);
    }
  };
  const endDrag = () => { setDrag(null); setHint(null); };

  /* a folder being dragged can't receive its own drop, and neither can anything inside it */
  const insideDrag = (fid) => {
    if (fid == null) return false;
    return drag.folderIds.some((id) => id === fid || tree.descendants(id).has(fid));
  };
  const nestOk = (pid) => drag.folderIds.every((id) => tree.canNest(id, pid ?? null));
  const dropOk = (pid) => !insideDrag(pid) && nestOk(pid);

  const overNote = (e, n) => {
    // in free-arrange a folder can be placed relative to a note, so a
    // folder-only drag is a valid hover here too
    if (!drag || (!drag.noteIds.length && !freeArrange)) return;
    if (drag.noteIds.includes(n.id) || !dropOk(n.folderId ?? null)) { setHint(null); return; }
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setHint({ kind: "note", id: n.id, pos: e.clientY - r.top < r.height / 2 ? "before" : "after" });
  };
  const overFolder = (e, f) => {
    if (!drag) return;
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientY - r.top) / r.height;
    // by default only a folder drag can sit between folders and notes alone drop
    // inside; in free-arrange the edges reorder for anything
    const reorders = drag.folderIds.length > 0 || freeArrange;
    let mode = reorders ? (rel < 0.28 ? "before" : rel > 0.72 ? "after" : "into") : "into";
    if (mode === "into" && !dropOk(f.id)) mode = reorders ? (rel < 0.5 ? "before" : "after") : null;
    if (mode === null) { setHint(null); return; }
    if (mode === "into") { e.preventDefault(); setHint({ kind: "into", id: f.id }); return; }
    if (drag.folderIds.includes(f.id) || !dropOk(f.parentId ?? null)) { setHint(null); return; }
    e.preventDefault();
    setHint({ kind: "folder", id: f.id, pos: mode });
  };
  const overInto = (e, f) => {
    if (!drag || !dropOk(f.id)) return;
    e.preventDefault();
    setHint({ kind: "into", id: f.id });
  };
  const drop = (e) => { e.preventDefault(); if (drag && hint) applyDrop(); endDrag(); };

  /* Overshoot guards. Reordering a row up to the very top of the list is easy to
     overshoot past the first row — the cursor lands in the strip above it, the
     insertion hint is lost, and releasing there bounces the item back where it
     started. These widen the "insert before the first item" hitbox up into that
     strip: `overListTop` covers the top of the tree (first folder / first note),
     `overNotesHead` covers the "Notes" heading between the folders and the loose
     notes. Both set the same before-first hint the first row would, so the white
     insertion line shows exactly where a drop will land. */
  const overListTop = (e) => {
    if (!drag) return;
    const rootFolders = foldersUnder(null, "tree");
    let h = null;
    if (freeArrange) {
      const first = mix(rootFolders, visibleRootNotes)[0];
      if (first && first.k === "f") {
        if (dropOk(first.it.parentId ?? null) && !drag.folderIds.includes(first.it.id))
          h = { kind: "folder", id: first.it.id, pos: "before" };
      } else if (first && !drag.noteIds.includes(first.it.id)) {
        h = { kind: "note", id: first.it.id, pos: "before" };
      }
    } else if (drag.folderIds.length) {
      const f = rootFolders[0];
      if (f && dropOk(f.parentId ?? null) && !drag.folderIds.includes(f.id))
        h = { kind: "folder", id: f.id, pos: "before" };
    } else if (!rootFolders.length) {
      // a note drag with no folders above it: the top of the list is the first note
      const n = visibleRootNotes[0];
      if (n && !drag.noteIds.includes(n.id)) h = { kind: "note", id: n.id, pos: "before" };
    }
    if (!h) return;
    e.preventDefault();
    setHint(h);
  };
  const overNotesHead = (e) => {
    if (!drag || !drag.noteIds.length) return;
    const n = visibleRootNotes[0];
    if (!n || drag.noteIds.includes(n.id)) return;
    e.preventDefault();
    setHint({ kind: "note", id: n.id, pos: "before" });
  };

  const applyDrop = () => {
    const fset = new Set(drag.folderIds);
    // a note inside a folder that is itself moving travels with it
    const ancestorMoving = (n) => {
      let fid = n.folderId ?? null;
      while (fid != null) {
        if (fset.has(fid)) return true;
        fid = tree.byId.get(fid)?.parentId ?? null;
      }
      return false;
    };
    const noteIds = drag.noteIds.filter((id) => {
      const n = live.find((x) => x.id === id);
      return n && !ancestorMoving(n);
    });

    // the anchor is simply the row that was dropped on; the move resolves its
    // position in the combined sibling list
    let parent = null, anchor = null, after = false;
    if (hint.kind === "note") {
      const target = live.find((n) => n.id === hint.id);
      if (!target) return;
      parent = target.folderId ?? null;
      anchor = hint.id;
      after = hint.pos === "after";
    } else if (hint.kind === "into") {
      parent = hint.id;
    } else if (hint.kind === "folder") {
      const target = tree.byId.get(hint.id);
      if (!target) return;
      parent = target.parentId ?? null;
      anchor = hint.id;
      after = hint.pos === "after";
    }

    onMoveItems(noteIds, drag.folderIds, parent, anchor, after);
  };

  const addSubfolder = (fid) => { const id = onNewFolderIn(fid); if (id) setRenaming(id); };
  const handleNewFolder = () => { const id = onNewFolder(); if (id) setRenaming(id); };

  /* Shared by the folder row, its chevron and its name: returns true when the
     click was about selection, so the caller skips collapsing. */
  const folderClickTakenBySelection = (e, f) => {
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); toggleSel("folder", f.id); return true; }
    if (sel.folders.has(f.id)) { toggleSel("folder", f.id); return true; }
    return false;
  };

  /* ----- row renderers ----- */
  const noteRow = (n, depth, mode = "tree") => {
    const open = activeId === n.id;
    const picked = sel.notes.has(n.id);
    const dh = hint && hint.kind === "note" && hint.id === n.id
      ? (hint.pos === "before" ? "drop-before" : "drop-after") : "";
    const dragging = drag && drag.noteIds.includes(n.id) ? "dragging" : "";
    const shelved = isArchived(n);
    const stored = mode === "archive" || mode === "bin";   // read-only shelf views
    const canDrag = !stored;
    // Selection wins over "open" so a ⌘-click always shows visibly, including on
    // the note you're reading; is-open keeps an outline on it so it stays findable
    // (an outline, not a ring — .row-picked owns box-shadow and would win).
    const tone = picked ? `row-picked${open ? " is-open" : ""}`
               : open ? "bg-brand-500/12 ring-1 ring-brand-300/50"
               : "hover:bg-surface/70";
    return (
      <div key={mode[0] + ":" + n.id} role="button" tabIndex={0}
        className={`tree-row group flex cursor-pointer items-center pr-1.5 text-left ${tone} ${dh} ${dragging}`}
        style={{ paddingLeft: padFor(depth) }}
        draggable={canDrag}
        onDragStart={canDrag ? (e) => startDrag(e, "note", n.id) : undefined}
        onDragEnd={endDrag}
        onDragOver={(e) => overNote(e, n)}
        onDrop={drop}
        onClick={(e) => {
          // ⌘/ctrl toggles this row's membership whether or not the note is open:
          // selection is independent of which note is being read
          if (e.metaKey || e.ctrlKey) { e.preventDefault(); toggleSel("note", n.id); return; }
          // Clicking a row you've already selected lets go of it — no hunting for
          // empty sidebar space to get out of a selection.
          if (picked) { toggleSel("note", n.id); return; }
          // A plain click opens and clears any selection. Opening a note used to
          // *make* it the selection, which meant ⌘-clicking the open note silently
          // toggled it back off — and left the delete zone showing permanently.
          clearSel();
          onSelect(n.id);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") onSelect(n.id); }}>
        {/* the grip is the "act on this" handle: drag it, or click it to pick the
            row up into the selection without opening the note */}
        <span role="button" tabIndex={0}
          onClick={(e) => { e.stopPropagation(); toggleSel("note", n.id); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleSel("note", n.id); } }}
          className={`grip shrink-0 cursor-grab text-ink-300 outline-none active:cursor-grabbing ${picked ? "is-on" : ""}`}
          title={picked ? "Click to deselect · drag to move" : "Click to select · drag to move"}>{I.grip}</span>
        <span className={`shrink-0 ${open || picked ? "text-brand-600" : "text-ink-300"}`}>{I.doc}</span>
        <span className="min-w-0 flex-1">
          <span className="tree-title truncate font-medium text-ink-900">{noteTitle(n)}</span>
          {/* the preview line is hidden entirely at ultra density (see index.css) */}
          <span className="tree-sub truncate text-ink-500">
            {mode === "archive" && archivedOn(n) ? `Archived ${archivedOn(n)}`
              : mode === "bin" && binnedOn(n) ? `Deleted ${binnedOn(n)}`
              : preview(n) || "Empty note"}
          </span>
        </span>
        {/* a search hit can come from the archive, so say so on the row itself */}
        {shelved && !stored && (
          <span className="shrink-0 text-ink-400" title="In the archive">{I.archive}</span>
        )}
        {!stored && (
          <RowBtn onClick={(e) => { e.stopPropagation(); onTogglePin(n.id); }} title={n.pinned ? "Unpin" : "Pin to favourites"}
            tone={n.pinned ? "brand" : "ink"} always={n.pinned}>
            {n.pinned ? I.starFilled : I.star}
          </RowBtn>
        )}
        {/* Archiving isn't offered here — it lives on the note's own toolbar, or
            you drag onto Archive. Restore only appears inside a shelf view, and
            not on a note carried in by a folder: that goes back with its folder. */}
        {mode === "archive" && n.archived && (
          <RowBtn onClick={(e) => { e.stopPropagation(); onArchive([n.id], false); }} title="Restore to notes">
            {I.restore}
          </RowBtn>
        )}
        {mode === "bin" && n.deleted && (
          <RowBtn onClick={(e) => { e.stopPropagation(); onRestoreFromBin([n.id], []); }} title="Put back">
            {I.restore}
          </RowBtn>
        )}
        {(mode !== "bin" || n.deleted) && (
          <RowBtn onClick={(e) => {
            e.stopPropagation();
            if (mode === "bin") onPurge([n.id], [], "Permanently delete"); else onBin([n.id], []);
          }} title={mode === "bin" ? "Delete permanently" : "Move to bin"}>{I.trash}</RowBtn>
        )}
      </div>
    );
  };

  const folderRow = (f, depth, mode = "tree") => {
    const kidFolders = foldersUnder(f.id, mode);
    const kidNotes = notesUnder(f.id, mode);
    const count = kidFolders.length + kidNotes.length;
    const into = hint && hint.kind === "into" && hint.id === f.id ? "drop-into" : "";
    const dh = hint && hint.kind === "folder" && hint.id === f.id
      ? (hint.pos === "before" ? "drop-before" : "drop-after") : "";
    const dragging = drag && drag.folderIds.includes(f.id) ? "dragging" : "";
    const isRen = renaming === f.id;
    const picked = sel.folders.has(f.id);
    const shelved = mode === "archive" || mode === "bin";
    const canDrag = !isRen && !shelved;
    const canSub = (tree.depth.get(f.id) ?? 0) < MAX_FOLDER_DEPTH;
    return (
      <div key={mode[0] + ":" + f.id}>
        <div className={`tree-row group flex items-center pr-1.5 ${picked ? "row-picked" : ""} ${into} ${dh} ${dragging}`}
          style={{ paddingLeft: padFor(depth) }}
          draggable={canDrag}
          onDragStart={canDrag ? (e) => startDrag(e, "folder", f.id) : undefined}
          onDragEnd={endDrag}
          onDragOver={shelved ? undefined : (e) => overFolder(e, f)}
          onDrop={shelved ? undefined : drop}
          onClick={(e) => { if (!shelved) folderClickTakenBySelection(e, f); }}>
          {!shelved && (
            <span role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); toggleSel("folder", f.id); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleSel("folder", f.id); } }}
              className={`grip shrink-0 cursor-grab text-ink-300 outline-none active:cursor-grabbing ${picked ? "is-on" : ""}`}
              title={picked ? "Click to deselect · drag to move" : "Click to select · drag to move"}>{I.grip}</span>
          )}
          <button onClick={(e) => { e.stopPropagation(); if (!folderClickTakenBySelection(e, f)) onToggleFolder(f.id); }}
            title={f.collapsed ? "Expand" : "Collapse"}
            className="shrink-0 rounded p-0.5 text-ink-400 transition-colors hover:text-brand-600">
            <span className={`chev inline-flex ${f.collapsed ? "" : "open"}`}>{I.chevron}</span>
          </button>
          <span className={`shrink-0 ${picked ? "text-brand-600" : "text-brand-500/80"}`}>{I.folder}</span>
          {isRen ? (
            <input autoFocus defaultValue={f.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => { onRenameFolder(f.id, e.target.value); setRenaming(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { onRenameFolder(f.id, e.target.value); setRenaming(null); }
                if (e.key === "Escape") setRenaming(null);
              }}
              className="tree-title min-w-0 flex-1 rounded-md border border-brand-300 bg-surface px-1.5 py-0.5 font-semibold text-ink-900 outline-none ring-2 ring-brand-100" />
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); if (!folderClickTakenBySelection(e, f)) onToggleFolder(f.id); }}
              onDoubleClick={() => setRenaming(f.id)}
              className="tree-title min-w-0 flex-1 truncate text-left font-semibold text-ink-800">
              {f.name}
            </button>
          )}
          {!isRen && count > 0 && <span className="shrink-0 px-0.5 text-xs text-ink-300">{count}</span>}

          {shelved ? (
            /* only the folder that was actually put here can come back — its
               subfolders came along for the ride and go back with it */
            mode === "bin" ? (
              f.deleted && (
                <>
                  <RowBtn onClick={() => onRestoreFromBin([], [f.id])} title="Put folder and its contents back">
                    {I.restore}
                  </RowBtn>
                  <RowBtn onClick={() => onPurge([], [f.id], "Permanently delete")} title="Delete folder permanently">
                    {I.trash}
                  </RowBtn>
                </>
              )
            ) : f.archived && (
              <>
                <RowBtn onClick={() => onArchiveFolders([f.id], false)} title="Restore folder and its contents">
                  {I.restore}
                </RowBtn>
                <RowBtn onClick={() => onBin([], [f.id])} title="Move folder to bin">{I.trash}</RowBtn>
              </>
            )
          ) : (
            <>
              {!isRen && !organize && (
                <>
                  <RowBtn onClick={() => onNewNoteIn(f.id)} title="New note in folder">{I.filePlus}</RowBtn>
                  {canSub && <RowBtn onClick={() => addSubfolder(f.id)} title="New subfolder">{I.folderPlus}</RowBtn>}
                </>
              )}
              <RowBtn onClick={() => onTogglePinFolder(f.id)} title={f.pinned ? "Unpin folder" : "Pin folder"}
                tone={f.pinned ? "brand" : "ink"} always={f.pinned}>
                {f.pinned ? I.starFilled : I.star}
              </RowBtn>
              {!isRen && organize && (
                <>
                  <RowBtn onClick={() => setRenaming(f.id)} title="Rename folder">{I.edit}</RowBtn>
                  <RowBtn onClick={() => onBin([], [f.id])} title="Move folder to bin">{I.trash}</RowBtn>
                </>
              )}
            </>
          )}
        </div>

        {!f.collapsed && (
          <div className="mt-0.5">
            {mix(kidFolders, kidNotes).map((c) => renderChild(c, depth + 1, mode))}
            {count === 0 && (
              <p onDragOver={shelved ? undefined : (e) => overInto(e, f)} onDrop={shelved ? undefined : drop}
                className={`rounded-lg py-1.5 text-xs italic text-ink-300 ${into ? "bg-brand-50" : ""}`}
                style={{ paddingLeft: padFor(depth + 1) }}>
                {shelved ? "Empty" : "Empty — drop items here"}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside ref={asideRef} className="relative flex h-full w-72 shrink-0 flex-col border-r border-ink-300/25 bg-surface/45 backdrop-blur">
      {/* The drop target exists only while you're dragging, and overlays the
          vault name rather than pushing the tree down — a row appearing
          mid-drag would move the rows out from under your cursor. */}
      {drag && (
        <div
          onDragOver={(e) => { e.preventDefault(); setHint({ kind: "archive" }); }}
          onDragLeave={() => setHint((h) => (h && h.kind === "archive" ? null : h))}
          onDrop={(e) => {
            e.preventDefault();
            if (drag.noteIds.length) onArchive(drag.noteIds, true);
            // a folder takes its whole subtree with it, so only the top of each
            // dragged branch is flagged — the rest follows from archivedScope
            const tops = drag.folderIds.filter((id) => !tree.hasAncestorIn(id, new Set(drag.folderIds)));
            if (tops.length) onArchiveFolders(tops, true);
            clearSel();
            endDrag();
          }}
          className={"fade-in absolute inset-x-2 top-2 z-30 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-surface px-3 py-3 text-[12px] font-medium transition-all duration-200 " +
            (hint && hint.kind === "archive"
              ? "border-brand-400 text-brand-600 ring-4 ring-brand-500/15"
              : "border-ink-300/40 text-ink-400")}>
          {I.archive}
          <span>Drop here to archive</span>
        </div>
      )}

      {/* Archive lives up here, clear of the controls you actually use all day.
          The drop target is separate — it only exists mid-drag (below). */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2.5">
        <p className="min-w-0 flex-1 truncate font-display text-lg font-semibold text-ink-900" title={vaultName}>
          {vaultName}
        </p>
        <button onClick={() => { setView((v) => (v === "archive" ? "notes" : "archive")); setQ(""); }}
          title={inArchive ? "Back to your notes" : "Archived notes"} aria-pressed={inArchive}
          className={"flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium tabular-nums outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
            (inArchive ? "bg-brand-500/15 text-brand-600" : "text-ink-400 hover:bg-brand-500/10 hover:text-brand-600")}>
          {I.archive}
          {archived.length > 0 && <span>{archived.length}</span>}
        </button>
      </div>

      {/* Spotlight-style: one pill, filters on the right so they're always in
          reach without opening anything */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1.5 rounded-full border border-ink-300/30 bg-surface/70 py-1.5 pl-3 pr-1.5 focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100">
          <span className="shrink-0 text-ink-300">{I.search}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={deep ? "Search notes" : "Search titles"}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 placeholder:text-ink-300 outline-none" />
          {q && (
            <button onClick={() => setQ("")} title="Clear"
              className="shrink-0 rounded-full p-1 text-ink-400 transition-colors hover:text-brand-600">{I.x}</button>
          )}
          <span className="h-4 w-px shrink-0 bg-ink-300/25" />
          <SearchToggle on={deep} onClick={() => setDeep((d) => !d)}
            title={deep ? "Searching titles and note contents" : "Searching titles only"}>
            {I.text}
          </SearchToggle>
          <SearchToggle on={withArchived} onClick={() => setWithArchived((a) => !a)}
            title={withArchived ? "Including archived notes" : "Archived notes hidden"}>
            {I.archive}
          </SearchToggle>
        </div>
      </div>

      {/* ---- navigation bar (hidden in the archive and the bin: nothing here
              applies to a shelf view — the search pill above stays either way) ---- */}
      <div className={`flex items-center gap-1 px-3 pb-1.5 ${inArchive || inBin ? "hidden" : ""}`}>
        <TB onClick={onNewNote} title="New note (Ctrl+N)">{I.filePlus}<span>Note</span></TB>
        <TB onClick={handleNewFolder} title="New folder">{I.folderPlus}<span>Folder</span></TB>
        <div className="flex-1" />
        <TB onClick={() => { setOrganize((o) => !o); setRenaming(null); }} active={organize}
          title="Rearrange, rename & delete folders">
          {organize ? I.x : I.sliders}<span>{organize ? "Done" : "Organize"}</span>
        </TB>
      </div>

      {organize && !s && !inBin && (
        <p className="mx-3 mb-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] leading-snug text-brand-600">
          Rename or delete folders · nest up to {MAX_FOLDER_DEPTH + 1} layers · click <b>Done</b> when finished.
        </p>
      )}

      {selCount > 1 && (
        <div className="fade-in mx-3 mb-1.5 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] text-brand-600">
          <span className="flex-1">{selCount} selected · drag to move them together</span>
          <button onClick={clearSel} className="rounded px-1.5 py-0.5 text-ink-500 transition-colors hover:text-brand-600">
            Clear
          </button>
        </div>
      )}

      {/* ---- tree ---- */}
      {/* extra bottom padding while the delete zone is up, so the last rows can
          scroll clear of it — padding at the end of a scroller doesn't move
          anything already on screen */}
      <div className="relative min-h-0 flex-1">
        {/* Overshoot catcher (bug: reordering to the very top bounces back). Sits
            above the list, out of flow so it never nudges a row, and only while
            dragging in the plain notes view. It extends the top row's drop hitbox
            up into the gap by the nav bar. Skipped when a Pinned section owns the
            top — "first root item" wouldn't be what's visually up there. */}
        {drag && !s && !inBin && !inArchive && !hasPinned && (
          <div onDragOver={overListTop} onDrop={drop}
            className="absolute inset-x-0 top-0 z-20 h-5 -translate-y-2" />
        )}
      <div className={`h-full overflow-y-auto px-2 pt-1.5 ${
        (inBin && binHasItems) || (!inBin && (drag || selCount > 0)) ? "pb-16" : "pb-3"}`}
        onClick={(e) => { if (e.target === e.currentTarget) clearSel(); }}>
        {/* a search always searches everywhere, so it outranks the archive view */}
        {s ? (
          filtered.length ? (
            <>
              <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                {filtered.length} result{filtered.length > 1 ? "s" : ""}
                {archivedHits > 0 && <span className="normal-case tracking-normal"> · {archivedHits} archived</span>}
              </p>
              {filtered.map((n) => noteRow(n, 0, "search"))}
            </>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-ink-300">
              No matches{!deep && " in note titles"}{!withArchived && archived.length > 0 && " outside the archive"}.
            </p>
          )
        ) : inBin ? (
          binHasItems ? (
            <div className="fade-in">
              {/* no Empty action up here any more — it's the lit button pinned
                  at the bottom of the sidebar */}
              <div className="flex items-center gap-1 px-3 pb-1 pt-1">
                <p className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  Bin · {binned.length} note{binned.length === 1 ? "" : "s"}
                </p>
              </div>
              {binnedRoots.map((f) => folderRow(f, 0, "bin"))}
              {looseBinned.map((n) => noteRow(n, 0, "bin"))}
            </div>
          ) : (
            <div className="fade-in px-4 py-10 text-center">
              <p className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-surface/70 text-ink-400">
                <BinIcon />
              </p>
              <p className="text-sm text-ink-500">The bin is empty.</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-300">
                Deleted notes and folders wait here until you empty it — nothing leaves your
                disk before that.
              </p>
            </div>
          )
        ) : inArchive ? (
          archivedRoots.length || looseArchived.length ? (
            <div className="fade-in">
              <div className="flex items-center gap-1 px-3 pb-1 pt-1">
                <p className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  Archived · {archived.length} note{archived.length === 1 ? "" : "s"}
                </p>
                <SortMenu value={archiveSort} onChange={onArchiveSort} />
              </div>
              {archivedRoots.map((f) => folderRow(f, 0, "archive"))}
              {looseArchived.map((n) => noteRow(n, 0, "archive"))}
            </div>
          ) : (
            <div className="fade-in px-4 py-10 text-center">
              <p className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-surface/70 text-ink-400">
                {I.archive}
              </p>
              <p className="text-sm text-ink-500">Nothing archived yet.</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-300">
                Drag notes or folders into the sidebar — a drop zone appears at the top — or use
                <b> Archive</b> in a note&rsquo;s toolbar. A folder brings everything inside it
                along, and nothing leaves your disk.
              </p>
            </div>
          )
        ) : (
          <>
            {hasPinned && (
              <div className="mb-2">
                <p className="flex items-center gap-1.5 px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  <span className="text-brand-500">{I.starFilled}</span> Pinned
                </p>
                {topPinnedFolders.map((f) => folderRow(f, 0, "pinned"))}
                {topPinnedNotes.map((n) => noteRow(n, 0, "pinned"))}
                <div className="mx-3 mt-2 border-b border-ink-300/20" />
              </div>
            )}

            {/* with free arrange on there are no two groups to label */}
            {freeArrange ? (
              mix(foldersUnder(null, "tree"), visibleRootNotes).map((c) => renderChild(c, 0, "tree"))
            ) : (
              <>
                {foldersUnder(null, "tree").map((f) => folderRow(f, 0))}
                {folders.length > 0 && visibleRootNotes.length > 0 && (
                  <p onDragOver={overNotesHead} onDrop={drop}
                    className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Notes</p>
                )}
                {visibleRootNotes.map((n) => noteRow(n, 0))}
              </>
            )}

            {live.length === 0 && folders.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-ink-300">
                {archived.length ? "All your notes are archived." : "No notes yet."}
              </p>
            )}

          </>
        )}
      </div>
      </div>

      {/* pb reserves the strip the fixed settings + bin buttons sit in */}
      <div className="relative border-t border-ink-300/25 p-3 pb-[60px]">
        {/* Standing in the same slot as the drop zone below, but a real button
            rather than a target — hence a solid, lit rim instead of the dashed
            outline that means "you can drop something here". */}
        {inBin && binHasItems && (
          <button onClick={handleEmptyBin}
            className="fade-in absolute inset-x-2 bottom-full z-30 mb-2 flex items-center justify-center gap-2 rounded-xl border border-brand-400/70 bg-surface px-3 py-3 text-[12px] font-semibold text-brand-600 outline-none ring-2 ring-brand-500/15 transition duration-200 hover:bg-brand-500/10 hover:ring-4 hover:ring-brand-500/25 focus-visible:ring-4 focus-visible:ring-brand-500/35">
            <span className={lidOpen ? "lid-open" : ""}><BinIcon /></span>
            <span>Empty recycle bin</span>
          </button>
        )}

        {/* Mirrors the archive drop zone at the top: appears only when there's
            something to delete, and overlays rather than resizing the tree.
            While dragging it's a drop target; on a selection it's a button.
            Never inside the bin — things there are already binned. */}
        {!inBin && (drag || selCount > 0) && (
          <div
            role={drag ? undefined : "button"}
            tabIndex={drag ? undefined : 0}
            onDragOver={drag ? (e) => { e.preventDefault(); setHint({ kind: "trash" }); } : undefined}
            onDragLeave={drag ? () => setHint((h) => (h && h.kind === "trash" ? null : h)) : undefined}
            onDrop={drag ? (e) => {
              e.preventDefault();
              onBin(drag.noteIds, drag.folderIds);
              flipLid();
              clearSel();
              endDrag();
            } : undefined}
            onClick={drag ? undefined : () => { onBin([...sel.notes], [...sel.folders]); flipLid(); clearSel(); }}
            onKeyDown={drag ? undefined : (e) => {
              if (e.key === "Enter") { onBin([...sel.notes], [...sel.folders]); flipLid(); clearSel(); }
            }}
            className={"fade-in absolute inset-x-2 bottom-full z-30 mb-2 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-surface px-3 py-3 text-[12px] font-medium outline-none transition-all duration-200 " +
              (drag ? "" : "cursor-pointer ") +
              (hint && hint.kind === "trash"
                ? "border-brand-400 text-brand-600 ring-4 ring-brand-500/15"
                : "border-ink-300/40 text-ink-400 hover:border-brand-300 hover:text-brand-600")}>
            <span className={lidOpen ? "lid-open" : ""}><BinIcon /></span>
            <span>{drag ? "Drop here to bin" : `Move ${selCount} to bin`}</span>
          </div>
        )}
        <button onClick={onOpenFolder} disabled={!supportsFS}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-ink-300/35 bg-surface/70 px-3 py-1.5 text-[13px] font-medium text-ink-700 outline-none transition duration-200 hover:border-brand-300 hover:text-brand-600 disabled:opacity-40 focus-visible:ring-4 focus-visible:ring-brand-100">
          {I.folder}
          {backend === "folder" ? "Switch folder" : "Open a folder"}
        </button>
        <p className="mt-1.5 text-center text-[11px] leading-tight text-ink-300">
          {backend === "folder"
            ? "Editing real .md files on disk"
            : supportsFS ? "Saved in this browser · open a folder for real files" : "This browser can’t open folders — try Chrome or Edge"}
        </p>
      </div>

      {/* The bottom strip: bin button, then the tray filling the empty run of
          sidebar beside it. Laid out as one flex row so the tray follows the bin
          button however wide its count makes it. The row itself is inert —
          only the controls inside it take clicks. */}
      <div className="pointer-events-none fixed bottom-3 left-[58px] z-50 flex w-[218px] items-end gap-2">
        {/* Immediately right of the settings gear. Also a drop target, so the
            lid opens whichever way something reaches the bin. */}
        <button
          onClick={() => { setView((v) => (v === "bin" ? "notes" : "bin")); setQ(""); flipLid(); }}
          onDragOver={(e) => { if (drag) { e.preventDefault(); setHint({ kind: "trash" }); } }}
          onDragLeave={() => setHint((h) => (h && h.kind === "trash" ? null : h))}
          onDrop={(e) => {
            e.preventDefault();
            if (drag) { onBin(drag.noteIds, drag.folderIds); flipLid(); clearSel(); }
            endDrag();
          }}
          title={inBin ? "Back to your notes" : "Bin — deleted notes wait here"}
          aria-pressed={inBin}
          className={"pointer-events-auto flex h-10 min-w-10 shrink-0 items-center justify-center gap-1 rounded-xl border border-ink-300/30 px-2 text-[11px] font-medium tabular-nums shadow-card outline-none backdrop-blur transition duration-200 spring hover:-translate-y-0.5 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 " +
            (inBin || (hint && hint.kind === "trash") ? "bg-brand-500/15 text-brand-600" : "bg-surface/90 text-ink-500")}>
          <span className={lidOpen ? "lid-open" : ""}><BinIcon /></span>
          {binned.length > 0 && <span>{binned.length}</span>}
        </button>

        {binNudge && (
          <Tray tip={`Your bin is holding ${binned.length} note${binned.length === 1 ? "" : "s"}. Empty it if you don’t want them back.`}
            actions={
              <>
                <button onClick={() => { onEmptyBin(); onDismissNudge(); }}
                  className="font-medium text-brand-600 underline-offset-2 transition-colors hover:underline">
                  Empty bin
                </button>
                <button onClick={onDismissNudge} className="text-ink-400 transition-colors hover:text-brand-600">
                  Not now
                </button>
              </>
            }>
            Holding {binned.length} note{binned.length === 1 ? "" : "s"}
          </Tray>
        )}
      </div>
    </aside>
  );
}

/* ---------- settings ---------- */

/* The theme swatches are the one place literal colours are correct: they are a
   picture *of* each theme, so they must not follow the theme currently applied. */
const SECTION_ICON = { general: I.sliders, appearance: I.sun, arranging: I.grip, formatting: I.text };

const SWATCH = {
  dark: { bg: "#000000", panel: "#161616", line: "#4a4a4a", edge: "#2b2b2b" },
  light: { bg: "#f7f7f6", panel: "#ffffff", line: "#d2d2d0", edge: "#e2e2e0" },
};

function ThemeCard({ theme, active, onClick }) {
  const s = SWATCH[theme.id];
  return (
    <button onClick={onClick} aria-pressed={active}
      className={"group flex-1 rounded-2xl p-2 text-left outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
        (active ? "bg-brand-500/12 ring-1 ring-brand-300/60" : "ring-1 ring-ink-300/20 hover:bg-brand-500/8")}>
      {/* a miniature of the app in that theme */}
      <span className="flex h-20 w-full overflow-hidden rounded-xl" aria-hidden="true"
        style={{ background: s.bg, boxShadow: `inset 0 0 0 1px ${s.edge}` }}>
        <span className="h-full w-1/3" style={{ background: s.panel, boxShadow: `inset -1px 0 0 ${s.edge}` }}>
          <span className="mt-2 ml-2 flex flex-col gap-1.5">
            {[10, 7, 8].map((w, i) => (
              <span key={i} style={{ background: s.line, height: 3, width: `${w * 6}%`, borderRadius: 2 }} />
            ))}
          </span>
        </span>
        <span className="flex flex-1 flex-col gap-1.5 p-2.5">
          {[9, 6].map((w, i) => (
            <span key={i} style={{ background: s.line, height: i ? 3 : 5, width: `${w * 10}%`, borderRadius: 2 }} />
          ))}
        </span>
      </span>
      <span className="mt-2 flex items-center gap-1.5 px-1 pb-0.5">
        <span className={active ? "text-brand-600" : "text-ink-500"}>{theme.id === "dark" ? I.moon : I.sun}</span>
        <span className={`flex-1 text-[13px] font-medium ${active ? "text-brand-600" : "text-ink-600"}`}>{theme.label}</span>
        <span className={`text-brand-600 transition-opacity ${active ? "opacity-100" : "opacity-0"}`}>{I.check}</span>
      </span>
    </button>
  );
}

/* Title and description on the left, control on the right. */
const SettingRow = ({ title, desc, children }) => (
  <div className="flex items-start gap-4 py-3.5">
    <span className="min-w-0 flex-1">
      <span className="block text-[13px] font-semibold text-ink-900">{title}</span>
      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">{desc}</span>
    </span>
    <span className="shrink-0 pt-0.5">{children}</span>
  </div>
);

/* A dropdown that shows each option's live example underneath its label, so you
   pick the shape you want rather than decoding a name. `filter` turns on a
   search box, which the timezone list needs — there are several hundred. */
function Select({ value, options, onChange, filter = false, align = "right" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef(null);
  const current = options.find((o) => o.id === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const shown = q
    ? options.filter((o) => (o.label + " " + (o.example || "")).toLowerCase().includes(q.toLowerCase()))
    : options;

  return (
    <span ref={box} className="relative inline-flex">
      <button onClick={() => { setOpen((o) => !o); setQ(""); }} aria-expanded={open}
        className={"flex items-center gap-1.5 rounded-lg border border-ink-300/30 px-2.5 py-1.5 text-[12.5px] font-medium outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
          (open ? "bg-brand-500/12 text-brand-600" : "bg-surface/70 text-ink-700 hover:text-brand-600")}>
        <span className="max-w-[150px] truncate">{current ? current.label : value}</span>
        <span className={`inline-flex text-ink-400 transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
          {I.chevron}
        </span>
      </button>

      {open && (
        <div className={`fade-in absolute top-9 z-40 w-max min-w-[190px] rounded-xl border border-ink-300/25 bg-surface p-1 shadow-float ${align === "right" ? "right-0" : "left-0"}`}>
          {filter && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              className="mb-1 w-full rounded-lg bg-brand-500/8 px-2.5 py-1.5 text-[12px] text-ink-900 placeholder:text-ink-400 outline-none" />
          )}
          <div className="max-h-64 overflow-y-auto">
            {shown.length === 0 && <p className="px-2.5 py-2 text-[12px] text-ink-400">No matches.</p>}
            {shown.map((o) => (
              <button key={o.id} onClick={() => { onChange(o.id); setOpen(false); }}
                className={"flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition duration-150 " +
                  (o.id === value ? "bg-brand-500/12" : "hover:bg-brand-500/8")}>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[12.5px] ${o.id === value ? "font-medium text-brand-600" : "text-ink-700"}`}>
                    {o.label}
                  </span>
                  {o.example && <span className="block truncate text-[11px] text-ink-400">{o.example}</span>}
                </span>
                <span className={`shrink-0 text-brand-600 ${o.id === value ? "opacity-100" : "opacity-0"}`}>{I.check}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

function General({ settings, onChange }) {
  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Startup</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">What you see when the app opens.</p>
      <div className="mt-3 flex flex-col gap-1">
        {STARTUPS.map((s) => {
          const active = settings.startup === s.id;
          return (
            <button key={s.id} onClick={() => onChange("startup", s.id)} aria-pressed={active}
              className={"flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
                (active ? "bg-brand-500/12 ring-1 ring-brand-300/60" : "ring-1 ring-transparent hover:bg-brand-500/8")}>
              <span className="min-w-0 flex-1">
                <span className={`block text-[13px] font-medium ${active ? "text-brand-600" : "text-ink-700"}`}>{s.label}</span>
                <span className="block text-[11.5px] text-ink-400">{s.hint}</span>
              </span>
              <span className={`shrink-0 text-brand-600 transition-opacity ${active ? "opacity-100" : "opacity-0"}`}>
                {I.check}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Formatting({ settings, onChange }) {
  const tz = settings.timezone;
  const now = Date.now();
  const dateOpts = useMemo(
    () => DATE_FORMATS.map((f) => ({ ...f, example: formatDate(now, f.id, tz) })),
    [tz, now]
  );
  const zoneOpts = useMemo(
    () => timezones().map((z) => (
      z === "system"
        ? { id: "system", label: "System default", example: localZone() }
        : { id: z, label: z.replace(/_/g, " ") }
    )),
    []
  );

  return (
    <>
      <SettingRow title="Date format" desc="Used for edit times and for the archive and bin.">
        <Select value={settings.dateFormat} options={dateOpts}
          onChange={(v) => onChange("dateFormat", v)} />
      </SettingRow>
      <div className="border-t border-ink-300/15" />

      <SettingRow title="Time zone"
        desc="Which clock times are shown in. Hover a note's edit time to see it.">
        <Select value={tz} options={zoneOpts} filter onChange={(v) => onChange("timezone", v)} />
      </SettingRow>
      <div className="border-t border-ink-300/15" />

      <SettingRow title="Number format"
        desc="Choose how numbers are formatted. Default uses your language setting.">
        <Select value={settings.numberFormat} options={NUMBER_FORMATS}
          onChange={(v) => onChange("numberFormat", v)} />
      </SettingRow>

      <p className="mt-4 px-1 text-[11.5px] leading-relaxed text-ink-400">
        A note&rsquo;s header shows when it was last edited — {formatDate(now, settings.dateFormat, tz)} right
        now. Hover it for the exact time, and when the note was created.
      </p>
    </>
  );
}

/* Same miniature-of-the-app idea as the theme cards, showing where a tint lands */
function ScopeCard({ scope, theme, hue, active, onClick }) {
  const s = SWATCH[theme];
  const L = theme === "light";
  const tinted = hue == null;
  const sideBg = tinted ? s.panel : `hsl(${hue} 30% ${L ? 94 : 13}%)`;
  const sideLine = tinted ? s.line : `hsl(${hue} 48% ${L ? 58 : 52}%)`;
  const wide = scope.id === "app";
  const mainBg = wide && !tinted ? `hsl(${hue} 26% ${L ? 97 : 6}%)` : s.bg;
  const mainLine = wide && !tinted ? sideLine : s.line;

  return (
    <button onClick={onClick} aria-pressed={active} title={scope.hint}
      className={"flex-1 rounded-2xl p-2 text-left outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
        (active ? "bg-brand-500/12 ring-1 ring-brand-300/60" : "ring-1 ring-ink-300/20 hover:bg-brand-500/8")}>
      <span className="flex h-16 w-full overflow-hidden rounded-xl" aria-hidden="true"
        style={{ background: mainBg, boxShadow: `inset 0 0 0 1px ${s.edge}` }}>
        <span className="h-full w-1/3" style={{ background: sideBg, boxShadow: `inset -1px 0 0 ${s.edge}` }}>
          <span className="mt-2 ml-2 flex flex-col gap-1.5">
            {[10, 7, 8].map((w, i) => (
              <span key={i} style={{ background: sideLine, height: 3, width: `${w * 6}%`, borderRadius: 2 }} />
            ))}
          </span>
        </span>
        <span className="flex flex-1 flex-col gap-1.5 p-2.5">
          {[9, 6].map((w, i) => (
            <span key={i} style={{ background: mainLine, height: i ? 3 : 5, width: `${w * 10}%`, borderRadius: 2 }} />
          ))}
        </span>
      </span>
      <span className="mt-2 flex items-center gap-1.5 px-1 pb-0.5">
        <span className={`flex-1 text-[13px] font-medium ${active ? "text-brand-600" : "text-ink-600"}`}>{scope.label}</span>
        <span className={`text-brand-600 transition-opacity ${active ? "opacity-100" : "opacity-0"}`}>{I.check}</span>
      </span>
    </button>
  );
}

function Appearance({ settings, onChange }) {
  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Theme</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">Applies to the whole app, editor included.</p>
      <div className="mt-3 flex gap-3">
        {THEMES.map((t) => (
          <ThemeCard key={t.id} theme={t} active={settings.theme === t.id}
            onClick={() => onChange("theme", t.id)} />
        ))}
      </div>

      <h3 className="mt-7 font-display text-[15px] font-semibold text-ink-900">Accent</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">
        Pick a colour, then choose how far it reaches. Works with either theme.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {ACCENTS.map((a) => {
          const active = settings.accent === a.id;
          return (
            <button key={a.id} onClick={() => onChange("accent", a.id)} title={a.label} aria-pressed={active}
              className={"flex h-8 w-8 items-center justify-center rounded-full outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
                (active ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-surface" : "hover:scale-110")}>
              {/* Default is the theme's own text colour — white on dark, near
                  black on light. Fixed values, because reading the live variable
                  would make the "no accent" swatch show the current accent. */}
              <span className="h-6 w-6 rounded-full ring-1 ring-inset ring-ink-300/30"
                style={{
                  background: a.hue == null
                    ? (settings.theme === "light" ? "#1a1a1a" : "#e8e8e8")
                    : `hsl(${a.hue} 50% 55%)`,
                }} />
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex gap-1.5">
        {ACCENT_MODES.map((m) => {
          const active = settings.accentMode === m.id;
          return (
            <button key={m.id} onClick={() => onChange("accentMode", m.id)} aria-pressed={active} title={m.hint}
              className={"flex-1 rounded-xl px-3 py-2 text-left outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
                (active ? "bg-brand-500/12 ring-1 ring-brand-300/60" : "ring-1 ring-ink-300/20 hover:bg-brand-500/8")}>
              <span className={`block text-[12.5px] font-medium ${active ? "text-brand-600" : "text-ink-700"}`}>{m.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-ink-400">{m.hint}</span>
            </button>
          );
        })}
      </div>

      {settings.accentMode === "tint" && (
        <div className="fade-in mt-3 flex gap-3">
          {ACCENT_SCOPES.map((sc) => (
            <ScopeCard key={sc.id} scope={sc} theme={settings.theme}
              hue={(ACCENTS.find((a) => a.id === settings.accent) || {}).hue}
              active={settings.accentScope === sc.id}
              onClick={() => onChange("accentScope", sc.id)} />
          ))}
        </div>
      )}

      <h3 className="mt-7 font-display text-[15px] font-semibold text-ink-900">Density</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">How tightly notes and folders pack in the sidebar.</p>
      <div className="mt-2.5 flex flex-col gap-1">
        {DENSITIES.map((d) => {
          const active = settings.density === d.id;
          return (
            <button key={d.id} onClick={() => onChange("density", d.id)} aria-pressed={active}
              className={"flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
                (active ? "bg-brand-500/12 ring-1 ring-brand-300/60" : "ring-1 ring-transparent hover:bg-brand-500/8")}>
              {/* the bars are a to-scale sample of the row spacing you're picking */}
              <span className="flex w-7 shrink-0 flex-col items-stretch" style={{ gap: d.rows.gap }} aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={active ? "bg-brand-600" : "bg-ink-400"}
                    style={{ height: d.rows.h, borderRadius: 2 }} />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[13px] font-medium ${active ? "text-brand-600" : "text-ink-700"}`}>{d.label}</span>
                <span className="block text-[11.5px] text-ink-400">{d.hint}</span>
              </span>
              <span className={`shrink-0 text-brand-600 transition-opacity ${active ? "opacity-100" : "opacity-0"}`}>
                {I.check}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* knob is bg-surface so it contrasts with the track in both themes: dark knob on
   a grey track in dark mode, white knob on grey in light */
const Switch = ({ on }) => (
  <span className={"relative h-5 w-9 shrink-0 rounded-full transition duration-200 " +
    (on ? "bg-brand-500" : "bg-ink-300/40")}>
    <span className={"absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-card transition-all duration-200 " +
      (on ? "left-[18px]" : "left-0.5")} />
  </span>
);

function ToggleRow({ on, onClick, label, hint }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={"flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
        (on ? "bg-brand-500/12 ring-1 ring-brand-300/60" : "ring-1 ring-ink-300/20 hover:bg-brand-500/8")}>
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] font-medium ${on ? "text-brand-600" : "text-ink-700"}`}>{label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">{hint}</span>
      </span>
      <Switch on={on} />
    </button>
  );
}

function Arranging({ settings, onChange }) {
  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Order</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">How the sidebar lays out each level.</p>
      <div className="mt-3">
        <ToggleRow
          on={settings.freeArrange}
          onClick={() => onChange("freeArrange", !settings.freeArrange)}
          label="Mix notes and folders freely"
          hint="Off, folders sit at the top of each level with notes underneath. On, they share one order — drag a note above a folder, or a folder between two notes, and it stays there."
        />
      </div>
      <p className="mt-4 px-1 text-[11.5px] leading-relaxed text-ink-400">
        Your arrangement is stored the same way either way, so switching this on and back off
        never scrambles anything.
      </p>
    </>
  );
}

/* The launcher sits in the bottom-left corner of the *window*, so it stays put
   no matter what the rest of the app is doing, and the settings window genies
   out of it. */
function SettingsPanel({ settings, onChange }) {
  /* The launcher sits beside the bin button, which lives inside the sidebar and
     therefore picks up a sidebar-scoped accent. Carrying the same variables here
     keeps the two neighbours from disagreeing. */
  const shell = useRef(null);
  useLayoutEffect(() => {
    applyAccent(shell.current, {
      accent: settings.accent, mode: settings.accentMode, theme: settings.theme,
      active: settings.accentMode === "tint" && settings.accentScope === "sidebar",
    });
  });

  const [mounted, setMounted] = useState(false);   // in the DOM (incl. while closing)
  const [armed, setArmed] = useState(false);       // laid out, safe to animate
  const [closing, setClosing] = useState(false);
  const [section, setSection] = useState(SECTIONS[0].id);
  const btn = useRef(null);
  const win = useRef(null);

  /* Closing before the animation is armed (Escape hammered within a frame or
     two of opening) would wait forever for an animationend that never comes, so
     that case unmounts outright. */
  const armedRef = useRef(false);
  const close = useCallback(() => {
    if (armedRef.current) setClosing(true);
    else { setMounted(false); setClosing(false); }
  }, []);
  const show = () => { setClosing(false); setMounted(true); };

  /* Safety net. Unmounting normally happens on animationend, but this modal
     covers the whole window, so if that event is ever missed — a backgrounded
     tab, a stylesheet that didn't load, an animation that didn't restart — the
     app is left completely unclickable. Nothing that severe should hang on a
     single event arriving, so a timer clears it regardless. */
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => { setMounted(false); setClosing(false); }, 600);
    return () => clearTimeout(t);
  }, [closing]);

  /* Aim the genie at the settings button. Measured before paint so the very
     first animation frame already collapses toward the right point — and from
     layout values (offsetWidth/centred position), never getBoundingClientRect,
     which would report the already-scaled box mid-animation. */
  useLayoutEffect(() => {
    if (!mounted) { armedRef.current = false; setArmed(false); return; }
    if (!win.current || !btn.current) return;
    const g = btn.current.getBoundingClientRect();
    const w = win.current.offsetWidth, h = win.current.offsetHeight;
    const left = (window.innerWidth - w) / 2, top = (window.innerHeight - h) / 2;
    win.current.style.transformOrigin =
      `${g.left + g.width / 2 - left}px ${g.top + g.height / 2 - top}px`;

    /* Hold the animation back one full frame. Mounting the panel costs a layout
       and paint of the whole settings UI; if the animation started on that same
       frame it would drop it, and a dropped first frame is what a stutter is.
       Two rAFs, because the first still runs inside the frame being painted. */
    let inner;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => { armedRef.current = true; setArmed(true); });
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    // capture, so Escape closes this before the sidebar clears its selection
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mounted, close]);

  const open = mounted && !closing;

  return (
    <div ref={shell}>
      {mounted && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div onClick={close} aria-hidden="true"
            className={`genie-backdrop absolute inset-0 bg-paper/50 backdrop-blur-[5px] ${closing ? "closing" : ""}`} />

          <div ref={win} role="dialog" aria-modal="true" aria-label="Settings"
            onAnimationEnd={(e) => {
              if (closing && e.target === win.current) { setMounted(false); setClosing(false); }
            }}
            className={`genie relative flex h-[min(600px,88vh)] w-[min(720px,92vw)] flex-col overflow-hidden border border-ink-300/25 bg-surface shadow-float ${armed ? "run" : ""} ${closing ? "closing" : ""}`}>

            <div className="flex shrink-0 items-center gap-2 border-b border-ink-300/20 px-4 py-3">
              <span className="text-brand-500">{I.gear}</span>
              <p className="flex-1 font-display text-[15px] font-semibold text-ink-900">Settings</p>
              <button onClick={close} title="Close (Esc)"
                className="rounded-lg p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300">
                {I.x}
              </button>
            </div>

            <div className="flex min-h-0 flex-1">
              <nav className="w-44 shrink-0 border-r border-ink-300/20 p-2">
                {SECTIONS.map((s) => (
                  <button key={s.id} onClick={() => setSection(s.id)} aria-current={section === s.id}
                    className={"flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 " +
                      (section === s.id ? "bg-brand-500/12 text-brand-600" : "text-ink-500 hover:bg-brand-500/8 hover:text-brand-600")}>
                    {SECTION_ICON[s.id] || I.gear}
                    <span>{s.label}</span>
                  </button>
                ))}
              </nav>

              <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
                {section === "general" && <General settings={settings} onChange={onChange} />}
                {section === "appearance" && <Appearance settings={settings} onChange={onChange} />}
                {section === "arranging" && <Arranging settings={settings} onChange={onChange} />}
                {section === "formatting" && <Formatting settings={settings} onChange={onChange} />}
              </div>
            </div>
          </div>
        </div>
      )}

      <button ref={btn} onClick={() => (open ? close() : show())}
        title="Settings" aria-expanded={open}
        className={"fixed bottom-3 left-3 z-50 flex h-10 w-10 items-center justify-center rounded-xl border border-ink-300/30 shadow-card outline-none backdrop-blur transition duration-200 spring hover:-translate-y-0.5 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 " +
          (open ? "bg-brand-500/15 text-brand-600" : "bg-surface/90 text-ink-500")}>
        <span className={`inline-flex transition-transform duration-500 ${open ? "rotate-180 scale-90" : ""}`}>{I.gear}</span>
      </button>
    </div>
  );
}

/* ---------- formatting toolbar ---------- */

/* Buttons act on mousedown with the default prevented: a click would otherwise
   blur the editor and collapse the very selection we're about to format. */
const FmtBtn = ({ onAct, title, disabled, active, className = "", children }) => (
  <button title={title} disabled={disabled} aria-label={title}
    onMouseDown={(e) => { e.preventDefault(); if (!disabled) onAct(); }}
    className={"flex h-7 w-7 items-center justify-center rounded-md text-[14px] leading-none outline-none transition duration-150 disabled:opacity-30 " +
      (active ? "bg-brand-500/15 text-brand-600 " : "text-ink-500 hover:bg-brand-500/10 hover:text-brand-600 ") +
      className}>
    {children}
  </button>
);

/* Takes the ref, not the view: on the render right after switching to Edit the
   editor hasn't mounted yet, so a value read now would be a stale null. */
function ColourMenu({ viewRef, disabled }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const pick = (fn) => { fn(); setOpen(false); };

  const Swatch = ({ style, title, onAct, children }) => (
    <button title={title} aria-label={title}
      onMouseDown={(e) => { e.preventDefault(); pick(onAct); }}
      className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] text-ink-500 ring-1 ring-ink-300/25 transition duration-150 hover:scale-110 hover:ring-brand-300"
      style={style}>
      {children}
    </button>
  );

  return (
    <span ref={box} className="relative inline-flex">
      <FmtBtn title="Text colour & highlight" disabled={disabled} active={open}
        onAct={() => setOpen((o) => !o)}>
        <span className="flex flex-col items-center gap-[2px]">
          <span className="font-semibold leading-none">A</span>
          <span className="h-[3px] w-[13px] rounded-sm"
            style={{ background: "linear-gradient(90deg,#d0574a,#b9932a,#4f9d63,#4a86c7)" }} />
        </span>
      </FmtBtn>

      {open && (
        <div className="fade-in absolute left-0 top-9 z-40 w-max rounded-xl border border-ink-300/25 bg-surface p-2.5 shadow-float">
          <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">Text</p>
          <div className="flex gap-1.5">
            {PALETTE.map((c) => (
              <Swatch key={c.id} title={c.label} style={{ background: c.text }}
                onAct={() => applyColour(viewRef.current, "text", c.text)} />
            ))}
          </div>
          <p className="pb-1.5 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">Highlight</p>
          <div className="flex gap-1.5">
            {PALETTE.map((c) => (
              <Swatch key={c.id} title={`${c.label} highlight`} style={{ background: hlOf(c.text) }}
                onAct={() => applyColour(viewRef.current, "bg", hlOf(c.text))} />
            ))}
          </div>
          <button onMouseDown={(e) => { e.preventDefault(); pick(() => clearColour(viewRef.current)); }}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] text-ink-500 transition duration-150 hover:bg-brand-500/10 hover:text-brand-600">
            {I.x}<span>Remove colour</span>
          </button>
        </div>
      )}
    </span>
  );
}

function FormatBar({ viewRef, editing, note, onArchive }) {
  const v = () => viewRef.current;
  const wrap = (m) => toggleWrap(v(), ...m);
  const off = !editing;
  const hint = off ? "Switch to Edit to format" : null;
  const shelved = !!note.archived;

  /* The controls sit centred over the text column. The reading-view hint is
     positioned absolutely so it can't pull them off-centre. */
  return (
    <div className="relative flex shrink-0 items-center justify-center gap-0.5 border-b border-ink-300/20 px-4 py-1.5">
      <FmtBtn title={hint || "Bold — Ctrl+B"} disabled={off} className="font-bold" onAct={() => wrap(MARKS.bold)}>B</FmtBtn>
      <FmtBtn title={hint || "Italic — Ctrl+I"} disabled={off} className="font-display italic" onAct={() => wrap(MARKS.italic)}>I</FmtBtn>
      <FmtBtn title={hint || "Underline — Ctrl+U"} disabled={off} className="underline underline-offset-2" onAct={() => wrap(MARKS.underline)}>U</FmtBtn>
      <FmtBtn title={hint || "Strikethrough — Ctrl+Shift+X"} disabled={off} className="line-through" onAct={() => wrap(MARKS.strike)}>S</FmtBtn>
      <span className="mx-1.5 h-4 w-px bg-ink-300/25" />
      <ColourMenu viewRef={viewRef} disabled={off} />

      {/* The only place a note can be archived from — the sidebar rows stay
          clean, and the drag-to-Archive target covers bulk moves. */}
      <button onClick={() => onArchive([note.id], !shelved)}
        title={shelved ? "Put this note back in your notes" : "Move this note to the archive"}
        className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-ink-400 outline-none transition duration-200 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300">
        {shelved ? I.restore : I.archive}
        <span>{shelved ? "Restore" : "Archive"}</span>
      </button>
    </div>
  );
}

/* ---------- editor pane ---------- */
function Editor({ note, editing, setEditing, onChange, onRename, onToggleTask, onWikiNavigate, onArchive, resolvedSet, getWikiTargets, status, fmt }) {
  const viewRef = useRef(null);
  const onReadClick = (e) => {
    const link = e.target.closest("a.wikilink");
    if (link) { e.preventDefault(); onWikiNavigate(link.getAttribute("data-target")); return; }
    const cb = e.target.closest('input[type=checkbox]');
    if (cb) {
      e.preventDefault();
      const boxes = Array.from(e.currentTarget.querySelectorAll('input[type=checkbox]'));
      const idx = boxes.indexOf(cb);
      if (idx >= 0) onToggleTask(idx);
      return;
    }
    setEditing(true);
  };

  const html = useMemo(
    () => (note ? renderMarkdown(note.content, resolvedSet) : ""),
    [note && note.content, resolvedSet]
  );
  const stamps = useMemo(() => {
    if (!note) return { words: "0", edited: null, tooltip: undefined };
    const m = note.content.trim().match(/\S+/g);
    const { dateFormat: f, timezone: tz } = fmt;
    const lines = [];
    if (note.updatedAt) lines.push(`Last edited ${formatDateTime(note.updatedAt, f, tz)}`);
    if (note.createdAt) lines.push(`Created ${formatDateTime(note.createdAt, f, tz)}`);
    if (tz !== "system") lines.push(tz);
    return {
      words: formatNumber(m ? m.length : 0, fmt.numberFormat),
      edited: note.updatedAt ? formatDate(note.updatedAt, f, tz) : null,
      tooltip: lines.length ? lines.join("\n") : undefined,
    };
  }, [note && note.content, note && note.updatedAt, note && note.createdAt, fmt]);

  if (!note) {
    return (
      <section className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface/70 text-brand-300 shadow-card">
            <Icon path={<><path d="M6 3h8l4 4v14a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M14 3v4h4M9 13h6M9 17h4" /></>} className="h-8 w-8" />
          </div>
          <p className="font-display text-xl text-ink-700">Pick a note, or start a new one</p>
          <p className="mt-1 text-sm text-ink-500">Your Markdown formats as you type.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-ink-300/25 bg-surface/40 px-5 py-3 backdrop-blur">
        <input value={note.name.replace(/\.md$/i, "")} onChange={(e) => onRename(e.target.value)}
          className="min-w-0 flex-1 truncate bg-transparent font-display text-lg font-semibold text-ink-900 outline-none placeholder:text-ink-300"
          placeholder="Untitled" />
        {/* hover gives the precise times, in the timezone you've chosen */}
        <span className="hidden shrink-0 text-xs text-ink-300 sm:block" title={stamps.tooltip}>
          {stamps.words} words
          {stamps.edited && <> · Edited {stamps.edited}</>}
          {" · "}{status}
        </span>
        <button onClick={() => setEditing(!editing)} title={editing ? "Reading view" : "Live editor"}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface/70 px-3.5 py-1.5 text-sm font-medium text-ink-700 shadow-card outline-none transition duration-200 spring hover:-translate-y-0.5 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100">
          {editing ? I.eye : I.edit}
          <span>{editing ? "Read" : "Edit"}</span>
        </button>
      </div>

      <FormatBar viewRef={viewRef} editing={editing} note={note} onArchive={onArchive} />

      {editing ? (
        <div className="min-h-0 flex-1">
          <LiveEditor key={note.id} value={note.content} onChange={onChange}
            onExit={() => setEditing(false)} getWikiTargets={getWikiTargets} viewRef={viewRef} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 cursor-text overflow-y-auto" onClick={onReadClick}>
          <div className="mx-auto w-full max-w-2xl px-8 py-8">
            {note.content.trim()
              ? <div className="prose-note fade-in" dangerouslySetInnerHTML={{ __html: html }} />
              : <p className="text-ink-300">This note is empty — click anywhere to start writing.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- app ---------- */
/* Load with ?fixture=1 to try things out without persisting: both save effects
   below sit this out, so seeded state can never overwrite real notes. */
const FIXTURE = new URLSearchParams(location.search).has("fixture");

export default function App() {
  const [backend, setBackend] = useState("local");
  const [dirHandle, setDirHandle] = useState(null);
  const [vaultName, setVaultName] = useState("Local notes");
  const [notes, setNotes] = useState(() => applyOrg(loadLocalNotes(), loadOrg().meta));
  const [folders, setFolders] = useState(() => loadOrg().folders.map((f) => ({ parentId: null, pinned: false, archived: false, deleted: false, ...f })));
  const [activeId, setActiveId] = useState(null);
  const [editing, setEditing] = useState(true);
  const [status, setStatus] = useState("Saved");
  const [settings, setSettings] = useState(loadSettings);
  const [deletions, setDeletions] = useState(() => loadBinMeta().deletions);
  const [binNudge, setBinNudge] = useState(false);

  const active = notes.find((n) => n.id === activeId) || null;
  const saveTimers = useRef({});

  /* Startup: reopen the last note, or land on the blank screen. The id is kept
     in the settings blob so it survives a reload without touching note data. */
  useEffect(() => {
    if (settings.startup !== "last") return;
    // no history yet (first run) — fall back to the top note rather than a blank screen
    const last = notes.find((n) => n.id === settings.lastNoteId && !n.deleted);
    const target = last || [...notes].filter((n) => !n.deleted && !n.archived).sort(byOrder)[0];
    if (target) setActiveId(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeId) setSettings((p) => (p.lastNoteId === activeId ? p : { ...p, lastNoteId: activeId }));
  }, [activeId]);

  const wikiTargets = useMemo(() => {
    const seen = new Set(), out = [];
    notes.forEach((n) => { const t = noteTitle(n); if (!seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); } });
    return out;
  }, [notes]);
  const resolvedSet = useMemo(() => {
    const set = new Set();
    notes.forEach((n) => { set.add(noteTitle(n).toLowerCase()); set.add(n.name.replace(/\.md$/i, "").toLowerCase()); });
    return set;
  }, [notes]);

  const targetsRef = useRef(wikiTargets);
  targetsRef.current = wikiTargets;
  const getWikiTargets = useCallback(() => targetsRef.current, []);

  useEffect(() => {
    if (!supportsFS) return;
    (async () => {
      try {
        const saved = await idb.get("dirHandle");
        if (saved && (await verifyPermission(saved))) await loadFolder(saved);
      } catch { /* stay on local vault */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (FIXTURE) return;
    if (backend === "local") saveLocalNotes(notes.map(({ id, name, content }) => ({ id, name, content })));
  }, [notes, backend]);

  useEffect(() => { if (!FIXTURE) saveOrg(folders, notes); }, [folders, notes]);

  useEffect(() => { applySettings(settings); saveSettings(settings); }, [settings]);

  /* Colours come from CSS variables, so a theme switch would otherwise snap
     instantly while the body faded — this cross-fades the whole app, then takes
     the transition back off so it can't slow ordinary hovers down. */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("theming");
    const t = setTimeout(() => root.classList.remove("theming"), 300);
    return () => clearTimeout(t);
  }, [settings.theme, settings.accent]);
  const changeSetting = (key, value) => setSettings((p) => ({ ...p, [key]: value }));

  const loadFolder = async (handle) => {
    const loaded = await readFolder(handle);
    const org = loadOrg();
    setDirHandle(handle);
    setVaultName(handle.name);
    setBackend("folder");
    setFolders(org.folders.map((f) => ({ parentId: null, pinned: false, archived: false, ...f })));
    setNotes(applyOrg(loaded, org.meta));
    setActiveId(loaded[0] ? loaded[0].id : null);
    await idb.set("dirHandle", handle);
  };

  const openFolder = async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      if (await verifyPermission(handle)) await loadFolder(handle);
    } catch { /* cancelled */ }
  };

  const persistToDisk = useCallback((note) => {
    clearTimeout(saveTimers.current[note.id]);
    setStatus("Saving…");
    saveTimers.current[note.id] = setTimeout(async () => {
      try {
        let handle = note.handle;
        if (!handle) handle = await dirHandle.getFileHandle(note.name, { create: true });
        const w = await handle.createWritable();
        await w.write(note.content);
        await w.close();
        if (!note.handle) setNotes((p) => p.map((n) => (n.id === note.id ? { ...n, handle } : n)));
        setStatus("Saved");
      } catch { setStatus("Save failed"); }
    }, 500);
  }, [dirHandle]);

  const updateContent = (content) => {
    if (!active) return;
    const next = { ...active, content, updatedAt: Date.now() };
    setNotes((p) => p.map((n) => (n.id === active.id ? next : n)));
    if (backend === "folder") persistToDisk(next);
    else setStatus("Saved");
  };

  const selectNote = (id) => { setActiveId(id); setEditing(true); };

  const toggleTask = (index) => {
    if (!active) return;
    let i = -1;
    const out = active.content.replace(/^(\s*[-*]\s+\[)([ xX])(\])/gm, (m, a, mark, b) => {
      i++;
      return i === index ? a + (mark === " " ? "x" : " ") + b : m;
    });
    updateContent(out);
  };

  const renameNote = async (rawName) => {
    if (!active) return;
    const clean = rawName.replace(/[\\/:*?"<>|]/g, "").trim() || "Untitled";
    const name = clean.endsWith(".md") ? clean : clean + ".md";
    if (name === active.name) return;
    if (backend === "folder") {
      try {
        const nh = await dirHandle.getFileHandle(name, { create: true });
        const w = await nh.createWritable(); await w.write(active.content); await w.close();
        if (active.handle) await dirHandle.removeEntry(active.name).catch(() => {});
        setNotes((p) => p.map((n) => (n.id === active.id ? { ...n, name, id: name, handle: nh } : n)));
        setActiveId(name);
      } catch { setStatus("Rename failed"); }
    } else {
      setNotes((p) => p.map((n) => (n.id === active.id ? { ...n, name } : n)));
    }
  };

  const topOrder = () => -Date.now();  // newest items float to the top of their list

  const newNoteIn = (folderId = null) => {
    const fid = folderId ?? null;
    const base = "Untitled";
    let name = base + ".md", i = 1;
    while (notes.some((n) => n.name === name)) name = `${base} ${i++}.md`;
    const note = { id: backend === "folder" ? name : uid(), name, content: "# " + base + "\n\n", folderId: fid, pinned: false, order: topOrder(), createdAt: Date.now(), updatedAt: Date.now() };
    if (fid != null) setFolders((prev) => prev.map((f) => (f.id === fid ? { ...f, collapsed: false } : f)));
    setNotes((p) => [note, ...p]);
    setActiveId(note.id);
    setEditing(true);
    if (backend === "folder") persistToDisk(note);
  };
  const newNote = () => newNoteIn(null);

  const openOrCreateByTitle = async (target) => {
    const t = (target || "").trim();
    if (!t) return;
    const tl = t.toLowerCase();
    const existing = notes.find((n) => noteTitle(n).toLowerCase() === tl || n.name.replace(/\.md$/i, "").toLowerCase() === tl);
    if (existing) { selectNote(existing.id); return; }
    const clean = t.replace(/[\\/:*?"<>|]/g, "").trim() || "Untitled";
    let name = clean + ".md", i = 1;
    while (notes.some((n) => n.name === name)) name = `${clean} ${i++}.md`;
    const note = { id: backend === "folder" ? name : uid(), name, content: "# " + clean + "\n\n", folderId: null, pinned: false, order: topOrder(), createdAt: Date.now(), updatedAt: Date.now() };
    setNotes((p) => [note, ...p]);
    setActiveId(note.id);
    setEditing(true);
    if (backend === "folder") persistToDisk(note);
  };

  /* ----- bin -----
     Deleting moves things to the bin, which is a flag rather than a separate
     store: nothing is copied, renamed or removed from disk until the bin is
     emptied, so restoring is exact and can't half-fail. A folder carries its
     subtree in with it, the same way archiving does. */
  const binItems = (noteIds = [], folderIds = []) => {
    if (!noteIds.length && !folderIds.length) return;
    const at = Date.now();
    const nSet = new Set(noteIds), fSet = new Set(folderIds);
    setNotes((prev) => prev.map((n) => (nSet.has(n.id) ? { ...n, deleted: true, deletedAt: at } : n)));
    setFolders((prev) => prev.map((f) => (fSet.has(f.id) ? { ...f, deleted: true, deletedAt: at, pinned: false } : f)));
    if (nSet.has(activeId)) setActiveId(null);

    // one delete action = one count, whether it was a single note or a big sweep
    const next = deletions + 1;
    setDeletions(next);
    saveBinMeta({ deletions: next });
    if (next % 3 === 0) setBinNudge(true);
  };

  const restoreFromBin = (noteIds = [], folderIds = []) => {
    const nSet = new Set(noteIds), fSet = new Set(folderIds);
    setNotes((prev) => prev.map((n) => (nSet.has(n.id) ? { ...n, deleted: false, deletedAt: null } : n)));
    setFolders((prev) => prev.map((f) => (fSet.has(f.id) ? { ...f, deleted: false, deletedAt: null } : f)));
  };

  /* The only place anything is actually destroyed. */
  const purge = async (noteIds, folderIds, ask) => {
    const t = makeTree(folders);
    const doomedFolders = new Set();
    (folderIds || []).forEach((id) => {
      doomedFolders.add(id);
      t.descendants(id).forEach((d) => doomedFolders.add(d));
    });
    const picked = new Set(noteIds || []);
    const doomedNotes = notes.filter((n) => picked.has(n.id) || doomedFolders.has(n.folderId ?? null));
    if (!doomedNotes.length && !doomedFolders.size) return false;

    const bits = [];
    if (doomedNotes.length) bits.push(`${doomedNotes.length} note${doomedNotes.length > 1 ? "s" : ""}`);
    if (doomedFolders.size) bits.push(`${doomedFolders.size} folder${doomedFolders.size > 1 ? "s" : ""}`);
    const where = backend === "folder" && doomedNotes.length ? " The .md files will be deleted from disk." : "";
    if (!confirm(`${ask} ${bits.join(" and ")}?${where} This can’t be undone.`)) return false;

    if (backend === "folder") {
      for (const n of doomedNotes) {
        if (n.handle) { try { await dirHandle.removeEntry(n.name); } catch { /* already gone */ } }
      }
    }
    const doomedNoteIds = new Set(doomedNotes.map((n) => n.id));
    setNotes((prev) => prev.filter((x) => !doomedNoteIds.has(x.id)));
    if (doomedFolders.size) setFolders((prev) => prev.filter((x) => !doomedFolders.has(x.id)));
    if (doomedNoteIds.has(activeId)) setActiveId(null);
    setBinNudge(false);
    return true;
  };

  const emptyBin = () =>
    purge(notes.filter((n) => n.deleted).map((n) => n.id),
          folders.filter((f) => f.deleted).map((f) => f.id),
          "Permanently delete");

  /* ----- folders ----- */
  const newFolderIn = (parentId = null) => {
    const pid = parentId ?? null;
    if (pid != null && (makeTree(folders).depth.get(pid) ?? 0) >= MAX_FOLDER_DEPTH) return null;
    const id = uid();
    const sibs = folders.filter((f) => (f.parentId ?? null) === pid);
    const minOrder = sibs.reduce((m, f) => Math.min(m, f.order ?? 0), 0);
    setFolders((prev) =>
      prev.map((f) => (f.id === pid ? { ...f, collapsed: false } : f))
        .concat({ id, name: "New folder", collapsed: false, order: minOrder - 1, parentId: pid, pinned: false })
    );
    return id;
  };
  const newFolder = () => newFolderIn(null);

  const renameFolder = (id, name) => {
    const nm = (name || "").trim() || "Untitled folder";
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: nm } : f)));
  };
  const toggleFolder = (id) =>
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)));
  const togglePinFolder = (id) =>
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, pinned: !f.pinned } : f)));


  const togglePin = (id) =>
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)));

  /* Archiving is purely a flag in the org sidecar: the .md file is never moved,
     renamed or deleted, so this is safe on a real on-disk vault too. Restoring
     puts the note back exactly where it was, pin included. */
  const archiveNotes = (ids, archived) => {
    const idSet = new Set(ids);
    setNotes((prev) => prev.map((n) => (
      idSet.has(n.id)
        ? { ...n, archived, archivedAt: archived ? (n.archivedAt ?? Date.now()) : null }
        : n
    )));
  };

  /* Only the dropped folder is flagged; its subfolders and notes are hidden by
     inheritance, so restoring it puts the whole branch back intact. */
  const archiveFolders = (ids, archived) => {
    const idSet = new Set(ids);
    setFolders((prev) => prev.map((f) => (
      idSet.has(f.id)
        ? { ...f, archived, archivedAt: archived ? (f.archivedAt ?? Date.now()) : null, pinned: archived ? false : f.pinned }
        : f
    )));
  };

  /* One move for both kinds, because notes and folders share a single order
     sequence per parent. That's what lets "free arrange" interleave them, and it
     costs the default view nothing — it just renders folders first and ignores
     the cross-kind positions. A drag carries a whole selection, so ids come in
     lists and keep their existing relative order.
     `anchorId` is the row that was dropped on (either kind); `after` places
     below it rather than above. */
  const moveItems = (noteIds, folderIds, parentId, anchorId, after) => {
    const pid = parentId ?? null;
    const t = makeTree(folders);
    const wanted = new Set(folderIds);
    // a selected folder inside another selected folder travels with its parent,
    // and anything that can't legally nest at the target is left where it is
    const fIds = folderIds.filter((id) => !t.hasAncestorIn(id, wanted) && t.canNest(id, pid));
    if (!fIds.length && !noteIds.length) return;
    const movingF = new Set(fIds), movingN = new Set(noteIds);
    const key = (kind, id) => kind + ":" + id;

    const row = (kind) => (x) => ({ kind, id: x.id, order: x.order ?? 0 });
    const atParent = (arr, kind, moving) =>
      arr.filter((x) => ((kind === "f" ? x.parentId : x.folderId) ?? null) === pid && !moving.has(x.id)).map(row(kind));

    const sibs = [...atParent(folders, "f", movingF), ...atParent(notes, "n", movingN)]
      .sort((a, b) => a.order - b.order);
    const movers = [
      ...folders.filter((f) => movingF.has(f.id)).map(row("f")),
      ...notes.filter((n) => movingN.has(n.id)).map(row("n")),
    ].sort((a, b) => a.order - b.order);

    let at = sibs.length;
    if (anchorId) {
      const i = sibs.findIndex((x) => x.id === anchorId);
      if (i >= 0) at = after ? i + 1 : i;
    }
    const ordered = [...sibs.slice(0, at), ...movers, ...sibs.slice(at)];
    const orderOf = new Map(ordered.map((x, i) => [key(x.kind, x.id), i]));

    setFolders((prev) => prev.map((f) => {
      const o = orderOf.get(key("f", f.id));
      if (movingF.has(f.id)) return { ...f, parentId: pid, order: o };
      return o !== undefined ? { ...f, order: o } : f;
    }));
    setNotes((prev) => prev.map((n) => {
      const o = orderOf.get(key("n", n.id));
      if (movingN.has(n.id)) return { ...n, folderId: pid, order: o };
      return o !== undefined ? { ...n, order: o } : n;
    }));
  };

  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); newNote(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  return (
    <div className="flex h-full w-full">
      <Sidebar vaultName={vaultName} backend={backend} notes={notes} folders={folders} activeId={activeId}
        onSelect={selectNote} onNewNote={newNote} onNewFolder={newFolder}
        onNewNoteIn={newNoteIn} onNewFolderIn={newFolderIn}
        onBin={binItems} onRestoreFromBin={restoreFromBin} onPurge={purge} onEmptyBin={emptyBin}
        binNudge={binNudge} onDismissNudge={() => setBinNudge(false)}
        onTogglePin={togglePin} onTogglePinFolder={togglePinFolder} onArchive={archiveNotes} onArchiveFolders={archiveFolders}
        onToggleFolder={toggleFolder} onRenameFolder={renameFolder}
        onMoveItems={moveItems} onOpenFolder={openFolder}
        archiveSort={settings.archiveSort} onArchiveSort={(v) => changeSetting("archiveSort", v)}
        freeArrange={settings.freeArrange}
        accent={settings.accent} accentMode={settings.accentMode}
        accentScope={settings.accentScope} theme={settings.theme} />
      <Editor note={active} editing={editing} setEditing={setEditing} onChange={updateContent}
        onRename={renameNote} onToggleTask={toggleTask} onWikiNavigate={openOrCreateByTitle}
        onArchive={archiveNotes} resolvedSet={resolvedSet} getWikiTargets={getWikiTargets} status={status}
        fmt={settings} />
      <SettingsPanel settings={settings} onChange={changeSetting} />
    </div>
  );
}
