#!/usr/bin/env python3
"""Rebuild the What's new cards in site/updates.html from CHANGELOG.md.

Takes the newest three dated sections (`## [x.y.z] - YYYY-MM-DD`) and writes one
card per release between the `whats-new:start` / `whats-new:end` markers. The
lines are the changelog's own words (Reuben, 2026-09-26: What's new uses the
changelog lines word for word) — only the Markdown marks become HTML, and
straight quotes become curly ones. `[Unreleased]` is never read, and a
`[needs Windows]` tag in a dated section stops the script rather than going live.

Run from anywhere after /ship moves a release into its dated section:
    python3 tools/whats-new.py
"""
import html
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHANGELOG = ROOT / "CHANGELOG.md"
PAGE = ROOT / "site" / "updates.html"
HOW_MANY = 3
START, END = "<!-- whats-new:start -->", "<!-- whats-new:end -->"

# Lines kept off the site: Reuben, 2026-09-28 — the page must not give away future
# updates or how he works. A line is left out whole (never reworded) when it
# contains one of these phrases. Add a phrase here for any new line that does.
HIDE = [
    "competitor-comparison blocks",   # how the site is pitched
    "while the archive is reworked",  # a future update
    "is a research question",         # where tints are heading
    "which testers didn't find",      # how testing is done
]

HEAD = re.compile(r"^## \[(\d+\.\d+\.\d+)\] - (\d{4})-(\d{2})-(\d{2})\s*$")


def releases():
    out, cur = [], None
    for line in CHANGELOG.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            m = HEAD.match(line)
            cur = None
            if m:
                cur = {"version": m.group(1), "date": date(*map(int, m.group(2, 3, 4))), "items": []}
                out.append(cur)
            continue
        if cur is None:
            continue
        if line.startswith("- "):
            cur["items"].append(line[2:].strip())
        elif line.startswith("  ") and line.strip() and cur["items"]:
            cur["items"][-1] += " " + line.strip()
    return out


def curly(text):
    text = re.sub(r"(\w)'(\w)", "\\1\u2019\\2", text)      # don't -> don’t
    text = re.sub(r"(\w)'(?=\s|$|[.,;:)])", "\\1\u2019", text)  # plural possessive
    text = re.sub(r'"([^"]*)"', "\u201c\\1\u201d", text)     # "x" -> “x”
    return text


def inline(text):
    """Markdown marks the changelog uses -> HTML. Code spans are cut out first so
    nothing inside them is touched (1.0.2 has a literal `</span>` in one)."""
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for p in parts:
        if p.startswith("`") and p.endswith("`") and len(p) > 1:
            out.append("<code>" + html.escape(p[1:-1], quote=False) + "</code>")
            continue
        s = html.escape(curly(p), quote=False)
        s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", s)
        out.append(s)
    return "".join(out)


def card(rel, latest):
    n = len(rel["items"])
    count = f"{n} change" + ("" if n == 1 else "s")
    d = rel["date"]
    when = f"{d.day} {d.strftime('%B')} {d.year}"
    tag = '<span class="rel-tag">Latest</span>' if latest else ""
    items = "\n".join(
        f'          <li><span class="rel-n">{i:02d}</span><p>{inline(t)}</p></li>'
        for i, t in enumerate(rel["items"], 1)
    )
    return f"""      <article class="rel" data-version="{rel['version']}">
        <header class="rel-head">
          <p class="rel-meta">{tag}<time datetime="{d.isoformat()}">{when}</time><span class="rel-dot" aria-hidden="true">&middot;</span><span class="rel-count">{count}</span></p>
          <h2 class="rel-title">Version <span class="hl">{rel['version']}</span></h2>
          <span class="rel-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/></svg></span>
        </header>
        <ol class="rel-list">
{items}
        </ol>
        <button class="rel-open" type="button" aria-haspopup="dialog">See all {count}</button>
      </article>"""


def main():
    rels = releases()[:HOW_MANY]
    if len(rels) < HOW_MANY:
        sys.exit(f"Only {len(rels)} dated sections in CHANGELOG.md")
    for r in rels:
        bad = [t for t in r["items"] if "needs Windows" in t]
        if bad:
            sys.exit(f"{r['version']} still has a [needs Windows] line — not publishing it:\n  {bad[0][:90]}")
        hidden = [t for t in r["items"] if any(h in t for h in HIDE)]
        for t in hidden:
            print(f"  left off {r['version']}: {t[:80]}…")
        r["items"] = [t for t in r["items"] if t not in hidden]
    page = PAGE.read_text(encoding="utf-8")
    a, b = page.find(START), page.find(END)
    if a < 0 or b < a:
        sys.exit("Markers not found in site/updates.html")
    cards = "\n".join(card(r, i == 0) for i, r in enumerate(rels))
    page = page[: a + len(START)] + "\n" + cards + "\n      " + page[b:]
    PAGE.write_text(page, encoding="utf-8")
    print("What's new:", ", ".join(f"{r['version']} ({len(r['items'])})" for r in rels))


if __name__ == "__main__":
    main()
