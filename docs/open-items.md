# Open items — built, not signed off

Things that are **in the working tree and working as far as they were tested**, but that are not
finished business. Nothing here is in `CHANGELOG.md`'s `[Unreleased]`, and nothing here should go
into it until the line below it is answered.

Reuben's rule, 2026-09-05: *"don't log anything broken, keep that in a separate file for me to fix
at a later date."* So this file is the holding area — a changelog line is a promise to a user, and
an untested thing is not one yet.

**Format:** `### <what> — <what has to happen before it can be logged>`. Delete the section once it
has been answered; move its line into `[Unreleased]` if it earns one.

---

## From the tester-feedback pass (2026-09-05)

The other twelve items from that pass are logged. These two are not.

**Closed 2026-09-06:** shift+scroll's two tuning numbers (`THRESHOLD` 80 px, `IDLE_MS` 220). They
were chosen against synthetic `WheelEvent`s and needed a real hand on a real device. Reuben checked
it live and passed it, so they stand — do not re-tune them without a reason and a device.

**Closed 2026-09-06:** the custom-highlight render gap. `d80f0c6` landed the colour-tags refactor,
so `<mark style="background-color: #hex">` is recognised. Proved by reading computed styles out of
a running build of that exact tree: custom highlight `rgb(255, 59, 48)`, custom text colour
`rgb(52, 199, 89)`, a named `hl-amber` control unchanged. **`main` is releasable again.**

### The colour bar's mid-drag suppression was never observed

The *release* path is verified — measured in the packaged app: 40 ms after a double-click the bar
is absent while the selection already exists, and at 340 ms it is there. The *drag* path is not.
`dragSelecting` is set on `pointerdown` inside `view.dom` and cleared on `pointerup`, and the code
reads correctly, but every attempt to drive a real drag-select through `sendInputEvent` produced no
selection at all — so nothing ever exercised it.

**To close it:** drag slowly across a sentence with the button held. Nothing should appear until
you let go. (This is the same class of problem CLAUDE.md already records about synthetic input and
CodeMirror — the instrument, not the code, was the thing that failed.)

### Windows is entirely untested

Every check in this pass was run on macOS. The item most likely to differ is **the intro's writing
box**: Windows reserves gutter space for a scrollbar where macOS overlays it, and the original
tester report almost certainly came from Windows. The fix removed the *cause* (the editor theme's
`40vh` bottom padding, which guaranteed overflow in a 166 px box — see `docs/feature-editor.md`),
which is platform-independent, so this is a confirmation rather than a suspicion.

Also worth a glance on Windows: the search bar's two new opacities (`ink-300/55`, `ink-300/15`)
against ClearType, and the sidebar hover mask, which uses `-webkit-mask-image`.

### Reading view would strip a custom colour — pre-existing, not caused here

`reader/ReadingView.tsx` is imported by nothing (its own header says so). Its DOMPurify config
allows `class` but not `style`:

```ts
DOMPurify.sanitize(raw, { ADD_TAGS: ['mark'], ADD_ATTR: ['class', 'type', 'checked', 'disabled'] })
```

So if that component is ever wired up, a **named** colour survives and a **custom** one is silently
dropped. Left alone deliberately: widening a sanitiser allowlist is a security decision, not a
styling one, and `docs/security.md` is the place that decision belongs.

**To close it:** decide it when the reading view is wired up, not before. DOMPurify does sanitise
`style` values rather than passing them through, so allowing it is defensible — but it should be a
considered call with the threat model open, not a line changed in passing.

---

## Carried in from before this pass

### `EntryMeta.collapsed` is read by nothing

Flagged in CLAUDE.md's gotchas, never removed (rule 9 — flag redundancy, let Reuben decide). It was
only ever read by the sidebar's old per-instance expansion XOR, and has never been written by
anything. Removing it is a `workspace.json` shape change, so it is not a five-minute job.
