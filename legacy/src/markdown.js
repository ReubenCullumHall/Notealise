import { marked } from "marked";
import DOMPurify from "dompurify";

const escapeHtml = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Render Markdown to safe HTML, turning [[wiki-links]] into clickable anchors. */
export function renderMarkdown(content, resolvedSet) {
  const linked = (content || "").replace(
    /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g,
    (_m, target, alias) => {
      const tgt = target.trim();
      const label = (alias || target).trim();
      const known = resolvedSet.has(tgt.toLowerCase());
      return `<a class="wikilink${known ? "" : " wikilink-new"}" data-target="${escapeHtml(tgt)}">${escapeHtml(label)}</a>`;
    }
  );
  const raw = marked.parse(linked, { breaks: true, gfm: true });
  /* `style` is needed for the colour/highlight spans the toolbar writes. We only
     ever emit a hex colour, and DOMPurify still parses and scrubs the CSS, so a
     hostile .md opened from disk can't smuggle anything through it. */
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["style"] }).replace(/\sdisabled(="")?/g, "");
}
