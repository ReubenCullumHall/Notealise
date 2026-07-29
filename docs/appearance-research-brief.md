# Appearance research brief: dyslexia tints, fonts, and paper-look skins

This document describes the front-end of a desktop notes app so that visual-appearance features (dyslexia-friendly color tints, additional fonts, and "paper-look" skins for the writing surface) can be researched without access to the codebase itself. It ends with specific research questions.

## 1. What the app is

A local-first, Obsidian-style Markdown note-taking app, built as a desktop application with **Electron + React 19 + TypeScript + Vite** (via `electron-vite`). Every note is a plain `.md` file in a user-chosen folder on disk (the "vault") — there is no database; deleting the app leaves fully usable Markdown files behind. No accounts, no cloud sync. The app is a single window with no tabs: one note is open in the editor pane at a time.

Frontend-relevant dependencies: React 19, CodeMirror 6 (`@codemirror/*`, `@lezer/*`), `marked` (Markdown → HTML for the read-only view), `dompurify` (sanitizing that HTML), `katex` (math rendering), Tailwind CSS v3, PostCSS + autoprefixer. No state-management library (no Redux/Zustand/Context store) — plain React hooks own state, with one top-level component (`App.tsx`) holding nearly everything and passing it down via props. No UI component library (no MUI/Radix/shadcn) — everything is hand-built with Tailwind utility classes plus a modest amount of custom CSS.

## 2. Front-end structure

```
src/renderer/
  index.html            entry HTML — sets data-theme/data-density before React mounts, to avoid a flash of the wrong theme
  src/
    main.tsx             React root
    App.tsx              top-level component: nearly all app state, layout, autosave, IPC calls
    Sidebar.tsx           the whole sidebar: search, nav, pinned/tree/archive/bin views, footer
    TreeView.tsx          file-tree row rendering, drag-reorder, multi-select
    Search.tsx            search bar + results
    theme.css             design tokens: bundled @font-face rules, color ramps, density vars
    app.css               Tailwind directives + hand-written CSS (reading-view typography, editor chrome, settings UI, animations)
    editor/                CodeMirror 6 setup — the note editor (see §3)
    reader/ReadingView.tsx the separate read-only rendering path (see §3)
    settings/              the in-app settings modal (see §4)
    assets/fonts/          bundled local .woff2 font files (no CDN — offline-first)
```

**Layout** (`App.tsx`): a flex row — `Sidebar` on the left, a `main` pane on the right containing (top to bottom) an editable note-title input + word count + Edit/Read toggle, a formatting toolbar (Edit mode only), and then either the CodeMirror editor or the read-only `ReadingView`, toggled by CSS `display` (the editor stays mounted even in Read mode, to preserve cursor/scroll state). There are no tabs — only one note open at a time.

**Sidebar** (`Sidebar.tsx` + `TreeView.tsx`): resizable (200–480px), holds a search bar, new note/folder buttons, a pinned section, the main file tree, an archive view, a bin (trash) view, and a footer with a "Spaces" switcher — a row of emoji buttons, one per top-level vault folder. A "Space" is effectively a workspace/folder-scoped context that (importantly for this brief) already carries its own **per-Space appearance settings** — see §4.

## 3. The editor and reading view

The editor is **CodeMirror 6**, not a rich-text editor (not TipTap/ProseMirror/contenteditable) and not Monaco. Its signature feature is **"live preview"**: a CodeMirror `ViewPlugin` (`editor/livePreview.ts`) walks the real Markdown syntax tree (via `@lezer/markdown`, never regex) over the visible viewport and hides Markdown syntax markers (`**`, `#`, backticks, list bullets, `>`, link brackets) using CodeMirror decorations — *except* on the line the cursor is currently on, where the raw syntax reappears so it stays editable. This means formatting is ambient/always-on rather than a toggled preview mode. Hidden ranges are registered as CodeMirror "atomic ranges" so the cursor steps over them as a unit. The same decoration engine also renders inline math (KaTeX) and inline color/highlight tags as widgets when off-cursor.

There is a **separate Read mode** (`reader/ReadingView.tsx`) for a clean, non-editable rendered view: `marked` parses Markdown to an HTML string, `dompurify` sanitizes it, then KaTeX is manually run over `$...$`/`$$...$$` in text nodes. This is styled by a single CSS class, `.prose-note`, in `app.css` — headings in the serif display font, body text in the sans font, code in the mono font, plus table/blockquote/checkbox-list styling. **This `.prose-note` block, together with the CodeMirror `.cm-*` rules, is the part of the CSS a "paper-look" skin would most need to extend** (backgrounds, textures, margins, spacing), since it's the actual surface the note text renders onto in both modes.

Colors written directly into note content use inline HTML the app controls (e.g. `<mark class="hl-amber">`, `<span class="tc-rose">`) rather than invented Markdown syntax, so files still open sensibly in other Markdown editors. There is an existing 8-color highlight/text-color palette (`--hl-*`/`--tc-*` CSS variables) for this — but it is **user-selected inline text highlighting within a note's content**, not a page-wide tint. Don't conflate this with the dyslexia-tint feature being researched: that would be a tint over the whole editor/page surface, independent of and layered underneath any inline highlight colors a user has applied to specific text.

## 4. The theming/styling system (the part most relevant to this research)

**Tokens, not hardcoded values.** `tailwind.config.js` defines no literal hex colors and no literal font names. Every Tailwind color utility (`bg-paper`, `text-ink-700`, `bg-brand-500`, etc.) resolves through a small helper that reads a CSS custom property: `rgb(var(--x) / <alpha-value>)`. Every font utility (`font-sans`, `font-display`, `font-mono`) resolves to `var(--font-sans)`, `var(--font-serif)`, `var(--font-mono)` respectively. All of those custom properties are defined once, centrally, in `src/renderer/src/theme.css`.

**How theme switching actually works.** There is no Tailwind `dark:` variant usage anywhere in the app. Instead, `theme.css` defines the full set of color-ramp custom properties twice — once under `:root[data-theme='dark']`, once under `:root[data-theme='light']` — and a single function, `applySettings()` (in `settings/model.ts`), sets `document.documentElement.dataset.theme = "dark" | "light"` (plus a second independent attribute, `data-density`, for UI density/spacing, and inline custom properties for the current accent color). Setting that one attribute is what re-skins the whole app; nothing else needs to change. **This attribute-driven, CSS-custom-property pattern is the precedent any new appearance axis should follow** — e.g. a `data-tint="..."` or `data-page-look="..."` attribute, following the exact same shape as the existing `data-density` axis (which independently controls row-height/spacing tokens without touching color at all).

**Scope: per-Space, not global.** Theme, density, and accent color are settings on a "Space" (a top-level vault folder), not global app settings — switching the active Space in the sidebar live-reskins the app by re-running `applySettings()`. This matters because it means a font/tint/page-look choice would naturally also be scoped per-Space, consistent with what's already reserved for it (next paragraph).

**Fonts today.** Exactly three font families are bundled as local `.woff2` files under `assets/fonts/` (no CDN — the app is offline-first by requirement): **Inter** (sans-serif, default UI/body text), **Fraunces** (serif, used for headings, the note title, and other "display" text), and **JetBrains Mono** (code). These map to the three CSS variables `--font-sans`, `--font-serif`, `--font-mono`. There is currently no dyslexia-friendly typeface bundled, and no UI to add or choose additional fonts.

**Scaffolding that already exists for this exact feature.** This is the most important fact for research purposes: the app's data model and settings UI already reserve space for this feature, but nothing is wired up yet:
- Every `Space` object already has three string fields — `pageLook`, `font`, and `tint` — that are persisted, validated, and migrated, but currently unread by any rendering code (`''` means unset).
- The settings modal already has a page called **"Your collection"** with three empty-state shelves, already labeled and described almost exactly as this research brief: **"Page looks"** ("Backgrounds for the writing area — plain, lined, grid, paper"), **"Fonts"** ("Typefaces for the editor, including faces chosen for easier reading"), and **"Tints"** ("Colour overlays that reduce visual stress and help with dyslexia"). Each currently shows a disabled "Browse" button labeled "Coming soon."
- The per-Space settings page has a matching "Coming soon" section listing the same three items with disabled "Choose"/"Explore library" buttons.

So this feature has already been designed for at the data-model and settings-UI-shell level; what's missing is (a) the actual visual token sets for tints/page-looks, (b) one or more additional bundled fonts, and (c) wiring the "collection" shelves and per-Space pickers up to real, selectable options.

**Settings UI pattern.** All settings live in a single modal ("the genie window" — it animates open from the settings gear icon), with a left-hand section list (General, Spaces, Formatting, Your collection, Updates, Report a bug) and a scrollable content pane. Visual choices (like the existing Theme picker and Density picker) are presented as a small grid of cards, each showing a live-rendered miniature preview of that option plus a label, with the selected one checkmarked — this card-with-live-preview pattern is the existing UI vocabulary a font/tint/page-look picker should reuse.

## 5. What has no precedent yet

There is no paper-texture/lined/grid background pattern anywhere in the app today, and no code for it exists in the project's earlier browser-based prototype either (kept only as a read-only visual reference, never extended directly) — so the "paper-look" skins are genuinely new territory, not a matter of porting something that already exists elsewhere in the project.

## 6. Research questions

1. **Dyslexia tints.** What background/overlay colors and contrast levels are actually evidence-backed for reducing visual stress or aiding reading for dyslexic users, as opposed to popular-but-weakly-supported "colored overlay" folklore? Does a good implementation need only a background-color change, or does text/ink contrast also need to shift per tint (the way this app already shifts its ink-color ramp between dark and light themes)?
2. **Dyslexia-friendly fonts.** How do OpenDyslexic, Atkinson Hyperlegible, and Lexend compare on actual legibility evidence (not just marketing claims), and what are their licenses for bundling as local font files (matching how Inter/Fraunces/JetBrains Mono are already bundled locally rather than loaded from a CDN)?
3. **Font expansion generally.** Beyond dyslexia-specific typefaces, what other serif/sans/monospace options are worth offering as collectible fonts? Should font choice be one combined pick, or independent per role (UI chrome vs. note body vs. code), given the app already separates these into three CSS variables?
4. **Paper-look skins.** What CSS-only techniques (background gradients/patterns, `background-image` with repeating patterns, etc.) can render convincing lined-paper, grid-paper, dot-grid, or textured-paper looks behind the writing surface, while (a) remaining theme-aware under both the dark and light color ramps, (b) not visually interfering with the editor's live-preview text decorations or text selection, and (c) being swappable as discrete "looks" analogous to how the app's existing density variants swap a small set of layout tokens?
5. **Combining and managing the options.** Given the app already has an inert "collection" model (collect/browse an item once, then assign it to a Space) and three reserved-but-unused string fields (`pageLook`, `font`, `tint`) on each Space, how should page-look, font, and tint combine and get presented for browsing/selection without inventing a new storage format beyond those three fields?
