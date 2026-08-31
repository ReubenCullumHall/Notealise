# Visual references — Notealise

A running library of reference material for Notealise's visual identity: example wordmarks,
links, screenshots, competitor sites — anything Reuben points at as "closer to this." Created
2026-08-09, after the wordmark animation project ran long on guessing at subjective visual
targets ("same size," "a creative cursive font") with nothing concrete to check against. See
`DESIGN.md`'s font-selection section and its "sixth pass" checkpoint for the retrospective.

**How this gets used:** before starting new visual/design work on Notealise's branding, check
here first. When Reuben pastes or describes a reference, log it below with a short note on what
specifically is the target — a whole reference is rare; usually it's one dimension of it (the
pacing, the weight, the proportion) and the rest doesn't apply.

## Logged references

- **21st.dev/@ncdai/components/apple-hello-effect** — the original animation reference for the
  hero load-in (typewriter + hand-drawn cursive). Pasted several times early in the wordmark
  project as a genuine design/motion reference, not an injection attempt (see DESIGN.md). The
  *shape* of the reference — a bold word transitioning into hand-drawn cursive — is what carried
  over; the reference's own SVG art is hand-authored per-word (not a font), so it could not be
  copied directly. Apple's real "hello" lettering (github.com/JaceThings/SF-Hello) was also
  tried as a source for actual letterforms and confirmed a dead end for reuse — connected-cursive
  joins are pair-specific pen movement, not modular pieces.

- **Site-wide type/layout direction, 2026-08-28** — Reuben pointed at `revise.io` plus four
  screenshots of personal/portfolio sites he likes the look of, for the brand design language
  pass (fonts + layout for the whole site, not just the wordmark). His stated direction:
  **"Modern & precise"** feel, **sans body + serif headings**, the **cursive echoed by an
  italic** (not reused as script), and he called the reference **layouts** out specifically
  ("laid out well").
  - **Screenshot A — "Beyond the Code"** (warm gradient bg, chunky bordered cards with hard
    offset shadows, purple icon tiles): big very-bold grotesque heading with a swash underline;
    clean grotesque body; **monospace for every list item, label and metadata line**
    ("Vagabond", "Spirit Character", "Jiraiya - Naruto", "GTA VI: Gameplay", "- Carl Jung"); a
    bold-italic grotesque pull-quote ("Empathy over indifference"); a serif-italic block quote.
    The colour/card/shadow treatment is **against** DESIGN.md (gradients, vibe chrome) — the
    *type roles* are the takeaway.
  - **Screenshot B — "Components"** (dark, grid bg): huge low-contrast bold grotesque title;
    bold-sans card titles; grotesque body; **monospace for tags, "INSTALLATION", and the
    `npx …` command** (purple keyword).
  - **Screenshot C — "Aarav Kashyap Singh"** (dark, atmospheric, sakura): huge **classical book
    serif** for the name and for "The work leaves a trace."; clean sans body; **monospace for
    all eyebrows/labels/timestamps** ("@BYAARAV", "FROM THE BUILD LOG", "MAY 20, 2026", "READ
    FULL POST", "RECENTLY PLAYED"). This is the clearest "serif display + sans body + mono
    labels" example.
  - **Screenshot D — "Kunal Rathore" (kunalrathore.in)** — light, near-white, ledger-like:
    **top bar is brand left (in monospace, "kunalrathore.in") · nav links centred · utilities
    right (⌘K search, theme toggle)** — essentially the bar just built for Notealise. Huge
    **very-bold tight grotesque** name; **monospace for almost all secondary text** (tagline,
    location/clock, social row, the "2026 | 65.8% | Day : 240 / 365" progress line);
    **red monospace section eyebrows** ("FREELANCE & PROFESSIONAL WORK", "SELECTED PROJECTS");
    bold-sans section headings ("Experience", "My Work"); **hairline rules between every block**.
  - **Common thread across all four:** monospace carries the small structural text (labels,
    eyebrows, metadata, nav brand); big type is either a classical serif or a heavy tight
    grotesque; body is a neutral neo-grotesque; layouts are hairline-ruled and grid-structured.
    Reuben's "1–2 fonts max" wish is in tension with this — the references are 3-voice systems
    (display + body + mono). Open question being put to him. `revise.io` itself: clean editorial
    document-editor aesthetic (serif-tinged, modern sans), CSS not inspected.
  - Translation notes for Notealise: light-theme-only and monochrome (no gradients, no
    hard-shadow cards, no red) per DESIGN.md — so borrow the *type roles and the hairline/grid
    layout*, not the colour or the card chrome.

## Current settled state (not a reference — the actual live values, for comparison)

**The wordmark (unchanged):**
- "Note" in the system UI stack (weight 700) — now pinned with an explicit `font-family` that
  **excludes Inter**, so the site's shipped Inter can't leak in and shift the animation's clip
  stops. "alise" baked from PetitFormalScript glyph outlines (not a live font).
- Sizing: alise's ascenders (l/i/s) land at ~92% of Note's cap-height — `.wm-alise-svg`:
  `height: 0.6463em; width: 1.9194em`.
- Seam gap between "e" and "a": `margin-left: 0.06em` on `.wm-alise-svg`.
- Full load-in animation: ~5.3s from page load. See DESIGN.md for the complete timeline.

**Site type system (new 2026-08-28 — see DESIGN.md "The type system"):**
- Display: **Fraunces** variable, self-hosted `site/fonts/fraunces-var.woff2` (+ italic). Every
  heading. `font-optical-sizing: auto`, weight 500.
- Body / UI: **Inter** (`site/fonts/inter-{400,500,600}.woff2`).
- Labels: **JetBrains Mono** (`site/fonts/jetbrains-mono-{400,500}.woff2`), 12px / `0.14em` /
  uppercase / `--muted` — the one eyebrow treatment site-wide.
- All three are the app's own bundled families; the site keeps separate copies. ~236 KB total.
