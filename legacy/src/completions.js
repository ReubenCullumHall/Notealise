import { autocompletion } from "@codemirror/autocomplete";

/* Slash commands — same set as the old textarea editor */
const SLASH_COMMANDS = [
  { label: "Heading 1", hint: "Big section title", type: "block", prefix: "# ", terms: ["h1", "heading", "title"] },
  { label: "Heading 2", hint: "Medium heading", type: "block", prefix: "## ", terms: ["h2", "heading", "subtitle"] },
  { label: "Heading 3", hint: "Small heading", type: "block", prefix: "### ", terms: ["h3", "heading"] },
  { label: "Bulleted list", hint: "A simple bullet", type: "block", prefix: "- ", terms: ["bullet", "list", "ul"] },
  { label: "Numbered list", hint: "Ordered 1. 2. 3.", type: "block", prefix: "1. ", terms: ["number", "ordered", "ol"] },
  { label: "To-do", hint: "Checkbox item", type: "block", prefix: "- [ ] ", terms: ["todo", "task", "checkbox"] },
  { label: "Quote", hint: "Set off a quote", type: "block", prefix: "> ", terms: ["quote", "blockquote"] },
  { label: "Code block", hint: "Fenced code", type: "wrap", snippet: "```\n\n```\n", caretOffset: 4, terms: ["code", "fence"] },
  { label: "Divider", hint: "Horizontal line", type: "insert", snippet: "\n---\n", caretOffset: 5, terms: ["divider", "rule", "hr"] },
];

const STRIP_PREFIX = /^(#{1,6}\s+|>\s+|-\s\[[ xX]\]\s+|[-*]\s+|\d+\.\s+)/;

function slashApply(cmd) {
  return (view, _c, from, to) => {
    const line = view.state.doc.lineAt(from);
    if (cmd.type === "block") {
      const before = view.state.doc.sliceString(line.from, from).replace(STRIP_PREFIX, "");
      const insert = cmd.prefix + before;
      view.dispatch({
        changes: { from: line.from, to, insert },
        selection: { anchor: line.from + insert.length },
      });
    } else {
      const anchor = from + (cmd.caretOffset ?? cmd.snippet.length);
      view.dispatch({ changes: { from, to, insert: cmd.snippet }, selection: { anchor } });
    }
  };
}

// "/command" at the start of a line or after whitespace
function slashSource(context) {
  const m = context.matchBefore(/(?:^|\s)\/[\w-]*/);
  if (!m) return null;
  const slashIdx = m.text.indexOf("/");
  const from = m.from + slashIdx;
  const typed = m.text.slice(slashIdx + 1).toLowerCase();
  if (!context.explicit && from === m.from && slashIdx > 0) return null;
  const options = SLASH_COMMANDS
    .filter((c) => !typed || c.label.toLowerCase().includes(typed) || c.terms.some((x) => x.includes(typed)))
    .map((c) => ({ label: c.label, detail: c.hint, type: "keyword", apply: slashApply(c) }));
  return options.length ? { from, options, filter: false } : null;
}

// "[[note" anywhere — offers existing notes plus a "create new" option
function wikiSource(getTargets) {
  return (context) => {
    const m = context.matchBefore(/\[\[[^\]\n]*/);
    if (!m) return null;
    const from = m.from + 2;
    const typed = m.text.slice(2);
    const q = typed.toLowerCase();
    const targets = getTargets() || [];

    const insertLink = (title) => (view, _c, f, tt) => {
      const insert = title + "]]";
      view.dispatch({ changes: { from: f, to: tt, insert }, selection: { anchor: f + insert.length } });
    };

    const options = targets
      .filter((title) => !q || title.toLowerCase().includes(q))
      .slice(0, 20)
      .map((title) => ({ label: title, detail: "note", type: "variable", apply: insertLink(title) }));

    const trimmed = typed.trim();
    if (trimmed && !targets.some((title) => title.toLowerCase() === q)) {
      options.push({ label: "Create “" + trimmed + "”", type: "text", apply: insertLink(trimmed) });
    }
    return options.length ? { from, options, filter: false } : null;
  };
}

export function completionExtension(getWikiTargets) {
  return autocompletion({
    override: [slashSource, wikiSource(getWikiTargets)],
    activateOnTyping: true,
    icons: false,
    closeOnBlur: true,
    defaultKeymap: true,
  });
}
