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

The other twelve items from that pass are logged. These four are not.

### Shift+scroll — the two tuning numbers were chosen blind

`App.tsx`'s wheel handler accumulates `80` px of travel before it switches space, and resets the
accumulator after `220` ms of quiet. **Both numbers were picked against synthetic `WheelEvent`s,
not a hand.** A trackpad emits many small deltas with momentum after your fingers lift; a mouse
wheel emits a few large discrete ones. The same threshold cannot be right for both by luck.

**To close it:** flick once on a trackpad, and once on a mouse wheel. One flick should move exactly
one space. If it overshoots, `THRESHOLD` goes up; if it feels stiff, down. If the two devices want
different numbers, the handler has to tell them apart (a real wheel's `deltaY` is typically a large
multiple of a line height; a trackpad's is small and continuous) rather than splitting the
difference.

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
