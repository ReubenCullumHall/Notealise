import { EditorView, Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/* ---------------------------------------------------------------------------
   1. Visual formatting: style the Markdown syntax tree so headings look like
      headings, bold is bold, etc. The text stays plain Markdown underneath.
   --------------------------------------------------------------------------- */
/* Colours come from the theme variables in index.css, so the editor follows
   the light/dark switch without being rebuilt. */
const c = (name, alpha) => (alpha == null ? `rgb(var(${name}))` : `rgb(var(${name}) / ${alpha})`);

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.8em", fontWeight: "700", fontFamily: "Fraunces, serif", lineHeight: "1.3" },
  { tag: t.heading2, fontSize: "1.45em", fontWeight: "700", fontFamily: "Fraunces, serif", lineHeight: "1.3" },
  { tag: t.heading3, fontSize: "1.2em", fontWeight: "600", fontFamily: "Fraunces, serif" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600" },
  { tag: t.strong, fontWeight: "700", color: c("--brand-600") },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: c("--ink-400") },
  { tag: t.monospace, fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: c("--ink-800") },
  { tag: t.quote, color: c("--ink-500"), fontStyle: "italic" },
  { tag: [t.link, t.url], color: c("--ink-900") },
  { tag: t.list, color: c("--ink-900") },
]);

/* ---------------------------------------------------------------------------
   2. Live preview: hide the syntax markers (#, **, `, >) on every line EXCEPT
      the one(s) the cursor/selection touches, and swap "-" for a real bullet.
   --------------------------------------------------------------------------- */
class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-bullet";
    s.textContent = "•";
    return s;
  }
  ignoreEvent() { return false; }
}
const bulletDeco = Decoration.replace({ widget: new BulletWidget() });
const hideDeco = Decoration.replace({});

// leaf marker nodes whose text we conceal on inactive lines
const HIDE = new Set(["HeaderMark", "EmphasisMark", "QuoteMark", "StrikethroughMark"]);

/* Underline and colour are inline HTML (Markdown has no syntax for them), so
   the syntax tree is no help — match them by hand and give them the same
   treatment as `#` or `**`: conceal the tags, show the effect. The value is
   pinned to a hex literal, so nothing in a note can inject arbitrary CSS. */
const INLINE_HTML =
  /<span style="(color|background-color):\s*(#[0-9a-fA-F]{3,8})\s*;?">([\s\S]*?)<\/span>|<u>([\s\S]*?)<\/u>/g;

const markCache = new Map();
const styleMark = (css) => {
  let d = markCache.get(css);
  if (!d) { d = Decoration.mark({ attributes: { style: css } }); markCache.set(css, d); }
  return d;
};

function inlineHtmlRanges(state, active) {
  // full-document scan: notes are small, and slicing by viewport would cut
  // tag pairs in half
  const text = state.doc.toString();
  const out = [];
  INLINE_HTML.lastIndex = 0;
  for (let m; (m = INLINE_HTML.exec(text)); ) {
    const isSpan = m[1] != null;
    const from = m.index, to = from + m[0].length;
    const innerFrom = from + (isSpan ? m[0].indexOf(">") + 1 : 3);
    const innerTo = to - (isSpan ? 7 : 4);
    if (innerTo <= innerFrom) continue;
    out.push({ from: innerFrom, to: innerTo, deco: styleMark(isSpan ? `${m[1]}:${m[2]}` : "text-decoration:underline") });
    if (!active.has(state.doc.lineAt(from).number)) out.push({ from, to: innerFrom, deco: hideDeco });
    if (!active.has(state.doc.lineAt(innerTo).number)) out.push({ from: innerTo, to, deco: hideDeco });
  }
  return out;
}

function activeLineSet(state) {
  const set = new Set();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let l = a; l <= b; l++) set.add(l);
  }
  return set;
}

function buildDecorations(view) {
  const active = activeLineSet(view.state);
  const doc = view.state.doc;
  const ranges = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        // reveal everything on the active line(s)
        if (active.has(doc.lineAt(node.from).number)) return;
        const name = node.name;

        if (name === "ListMark") {
          if (/^[-*+]$/.test(doc.sliceString(node.from, node.to)))
            ranges.push({ from: node.from, to: node.to, deco: bulletDeco });
          return;
        }
        if (name === "CodeMark") {
          // hide inline-code backticks only, not fenced-code fences
          const parent = node.node.parent;
          if (parent && parent.name === "InlineCode")
            ranges.push({ from: node.from, to: node.to, deco: hideDeco });
          return;
        }
        if (HIDE.has(name)) {
          let end = node.to;
          // also swallow the space after "# " and "> "
          if ((name === "HeaderMark" || name === "QuoteMark") && doc.sliceString(end, end + 1) === " ") end++;
          ranges.push({ from: node.from, to: end, deco: hideDeco });
        }
      },
    });
  }
  ranges.push(...inlineHtmlRanges(view.state, active));
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(ranges.map((r) => r.deco.range(r.from, r.to)), true);
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = buildDecorations(view); }
    update(u) {
      if (u.docChanged || u.selectionSet || u.viewportChanged)
        this.decorations = buildDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);

/* ---------------------------------------------------------------------------
   3. Editor chrome: fonts, spacing, caret colour, autocomplete popup styling.
   --------------------------------------------------------------------------- */
const editorTheme = EditorView.theme({
  "&": { height: "100%", color: c("--ink-800"), backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: "16px",
    lineHeight: "1.7",
    overflow: "auto",
    padding: "28px 0 40vh",
  },
  ".cm-content": { maxWidth: "44rem", margin: "0 auto", padding: "0 24px", caretColor: c("--ink-900") },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: c("--ink-900"), borderLeftWidth: "2px" },
  ".cm-bullet": { color: c("--brand-500"), paddingRight: "0.45em" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: c("--wash", 0.15),
  },
  ".cm-placeholder": { color: c("--ink-300") },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: `1px solid ${c("--wash", 0.14)}`,
    borderRadius: "12px",
    background: c("--surface", 0.97),
    boxShadow: "var(--shadow-float)",
    overflow: "hidden",
    padding: "5px",
    backdropFilter: "blur(6px)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "6px 10px",
    borderRadius: "8px",
    fontFamily: "Inter, system-ui, sans-serif",
    color: c("--ink-800"),
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: c("--wash", 0.12),
    color: c("--brand-600"),
  },
  ".cm-completionLabel": { fontWeight: "500" },
  ".cm-completionDetail": { color: c("--ink-500"), fontStyle: "normal", marginLeft: "0.5em", fontSize: "0.85em" },
});

export const markdownStyling = [syntaxHighlighting(mdHighlight), editorTheme];
