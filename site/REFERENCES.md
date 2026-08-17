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

## Current settled state (not a reference — the actual live values, for comparison)

- Font: "Note" in the system UI stack (weight 700), "alise" baked from PetitFormalScript glyph
  outlines (not shipped as a live font).
- Sizing: alise's ascenders (l/i/s) land at ~92% of Note's cap-height — `.wm-alise-svg`:
  `height: 0.6463em; width: 1.9194em`.
- Seam gap between "e" and "a": `margin-left: 0.06em` on `.wm-alise-svg`.
- Full load-in animation: ~5.3s from page load. See DESIGN.md for the complete timeline.
