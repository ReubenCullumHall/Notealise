import { EditorSelection } from "@codemirror/state";

/*
  Toolbar formatting.

  Bold, italic and strikethrough are plain Markdown. Underline and colour have
  no Markdown syntax at all, so they write inline HTML — the same thing Obsidian
  does. That keeps the styling inside the .md file, so it survives being copied
  or opened in another Markdown app, at the cost of a more verbose raw file.
*/

export const MARKS = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~~", "~~"],
  underline: ["<u>", "</u>"],
};

/* Mid-tone hues, chosen to stay legible on both the black and the white theme.
   Highlights are the same hue at 25% alpha so the text under them keeps its own
   colour — a solid highlight would be unreadable in one theme or the other. */
export const HL_ALPHA = "40";
export const PALETTE = [
  { id: "red", label: "Red", text: "#d0574a" },
  { id: "orange", label: "Orange", text: "#c77a30" },
  { id: "yellow", label: "Yellow", text: "#b9932a" },
  { id: "green", label: "Green", text: "#4f9d63" },
  { id: "blue", label: "Blue", text: "#4a86c7" },
  { id: "purple", label: "Purple", text: "#8b6bc4" },
];
export const hlOf = (hex) => hex + HL_ALPHA;

/* Only ever emitted/matched with a hex value, so nothing from a note's text can
   reach the DOM as arbitrary CSS. */
export const SPAN_RE = /<span style="(?:color|background-color):\s*#[0-9a-fA-F]{3,8}\s*;?">$/;
const CLOSE = "</span>";

/* Is this `*` actually part of a `**`? Without this, italic-toggling the inside
   of **bold** would eat one of bold's own asterisks. */
const inBoldRun = (doc, open, from, to) =>
  open === "*" &&
  (doc.sliceString(Math.max(0, from - 2), from - 1) === "*" ||
   doc.sliceString(to + 1, to + 2) === "*");

/* Wrap the selection in `open`/`close`, or unwrap it if it's already wrapped —
   whether the markers sit just outside the selection or inside it. */
export function toggleWrap(view, open, close = open) {
  if (!view) return;
  view.dispatch(view.state.changeByRange((range) => {
    const doc = view.state.doc;
    const { from, to } = range;
    const inner = doc.sliceString(from, to);
    const outerBefore = doc.sliceString(Math.max(0, from - open.length), from);
    const outerAfter = doc.sliceString(to, Math.min(doc.length, to + close.length));

    if (!inBoldRun(doc, open, from, to) && outerBefore === open && outerAfter === close) {
      return {
        changes: [{ from: from - open.length, to: from }, { from: to, to: to + close.length }],
        range: EditorSelection.range(from - open.length, to - open.length),
      };
    }
    if (inner.length > open.length + close.length && inner.startsWith(open) && inner.endsWith(close)) {
      return {
        changes: { from, to, insert: inner.slice(open.length, inner.length - close.length) },
        range: EditorSelection.range(from, to - open.length - close.length),
      };
    }
    return {
      changes: { from, to, insert: open + inner + close },
      // with a selection, keep the text selected (not the new markers) so you can
      // stack bold onto italic; with none, drop the cursor between the markers
      range: inner.length
        ? EditorSelection.range(from + open.length, to + open.length)
        : EditorSelection.cursor(from + open.length),
    };
  }));
  view.focus();
}

/* The colour span immediately surrounding [from, to), if there is one. */
function spanAround(doc, from, to) {
  const back = doc.sliceString(Math.max(0, from - 80), from).match(SPAN_RE);
  if (!back) return null;
  if (doc.sliceString(to, to + CLOSE.length) !== CLOSE) return null;
  return { from: from - back[0].length, to: to + CLOSE.length };
}

const stripSpans = (s) => s.replace(/<\/?span[^>]*>/g, "");

/* Recolouring replaces the existing span rather than nesting a second one. */
export function applyColour(view, kind, hex) {
  if (!view) return;
  const open = `<span style="${kind === "bg" ? "background-color" : "color"}:${hex}">`;
  view.dispatch(view.state.changeByRange((range) => {
    if (range.empty) return { range };
    const doc = view.state.doc;
    const wrap = spanAround(doc, range.from, range.to);
    const inner = stripSpans(doc.sliceString(range.from, range.to));
    const from = wrap ? wrap.from : range.from;
    const to = wrap ? wrap.to : range.to;
    return {
      changes: { from, to, insert: open + inner + CLOSE },
      range: EditorSelection.range(from + open.length, from + open.length + inner.length),
    };
  }));
  view.focus();
}

export function clearColour(view) {
  if (!view) return;
  view.dispatch(view.state.changeByRange((range) => {
    if (range.empty) return { range };
    const doc = view.state.doc;
    const wrap = spanAround(doc, range.from, range.to);
    const inner = stripSpans(doc.sliceString(range.from, range.to));
    const from = wrap ? wrap.from : range.from;
    const to = wrap ? wrap.to : range.to;
    return {
      changes: { from, to, insert: inner },
      range: EditorSelection.range(from, from + inner.length),
    };
  }));
  view.focus();
}

/* The toolbar exists so these don't have to be memorised, but they should still
   agree with it. Mod = Ctrl on Windows, Cmd on macOS. */
export const formatKeymap = [
  { key: "Mod-b", run: (v) => { toggleWrap(v, ...MARKS.bold); return true; } },
  { key: "Mod-i", run: (v) => { toggleWrap(v, ...MARKS.italic); return true; } },
  { key: "Mod-u", run: (v) => { toggleWrap(v, ...MARKS.underline); return true; } },
  { key: "Mod-Shift-x", run: (v) => { toggleWrap(v, ...MARKS.strike); return true; } },
];
