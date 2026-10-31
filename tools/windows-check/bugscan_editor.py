"""Bug-scan fixes (editor half) on Windows, final build: real mouse + keyboard through CDP; results read from the files on disk."""
import sys, os, json, time, glob, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h import *
from playwright.sync_api import sync_playwright

J = os.path.join
root = J(SP, "vault-bs2"); shutil.rmtree(root, ignore_errors=True)
w(J(root, "Work", "Seed.md"), "# Seed\n\nseed note\n")
w(J(root, "Work", "List.md"), "- milk\n- eggs\n")
w(J(root, "Work", "List2.md"), "- solo\n")
w(J(root, "Work", "Table.md"), "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nParagraph below the table.\n")
w(J(root, "Work", "Toggle.md"), "# Toggle\n\n<details><summary>Shut</summary>\n\nhiddenword is in here\n\n</details>\n\nafter\n")
w(J(root, "Work", "Toggle2.md"), "# Toggle2\n\n<details><summary>Shut</summary>\n\nzebraword hides here\n\n</details>\n\nafter\n")
w(J(root, "Work", "C# basics.md"), "# C# basics\n\nhello\n")
w(J(root, "Work", "Linker.md"), "See [[C# basics]] here.\n")
w(J(root, "Work", "Prices.md"), "Prices $10-$20 today and $$ in code:\n\n```\n$$ not maths $$\n```\n")
w(J(root, "Work", "Mark.md"), '<mark class="hl-amber">mark me</mark> and mark plain\n')
w(J(root, "Work", "Divider.md"), "A sentence here\n")
os.makedirs(J(root, ".mdnotes"), exist_ok=True)
json.dump({"spaces": [{"folder": "Work"}], "activeSpaceFolder": "Work"}, open(J(root, ".mdnotes", "settings.json"), "w"))

R = Results()
app = App("bs2", root, port=9521, extra=["--mute-audio"]); app.start()
rd = lambda name: open(J(root, "Work", name), encoding="utf-8").read().replace("\r\n", "\n")
def row(pg, name):
    pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text=name)).first.click(); time.sleep(1.0)
with sync_playwright() as p:
    pg = app.connect(p); time.sleep(1.5)
    try:
        pg.wait_for_selector('.tree-title')
        # (a) New note, click its name, type a name, Enter, type straight away (like a person: first key 150 ms after Enter)
        good = 0
        for i in range(1, 7):
            pg.locator('button[data-tip^="New note"]').first.click(); time.sleep(0.6)
            pg.locator('input[placeholder="Untitled"]').first.click(); pg.keyboard.press('Control+a'); pg.keyboard.type(f"Named{i}")
            pg.keyboard.press('Enter'); time.sleep(0.15); pg.keyboard.type(f"words{i} typed at once", delay=40); time.sleep(1.8)
            f = J(root, "Work", f"Named{i}.md")
            good += os.path.exists(f) and open(f, encoding="utf-8").read().strip() == f"words{i} typed at once"
        untitled = glob.glob(J(root, "Work", "Untitled*.md")) + glob.glob(J(root, "Untitled*.md"))
        R.add("a new note: name it, Enter, type straight away (6 times)", good == 6 and not untitled, f"{good}/6 in the named note, Untitled files {len(untitled)} (Mac 6/6)")

        # (b) Tab / Shift+Tab
        row(pg, "List"); pg.locator('.cm-line', has_text="eggs").first.click(); pg.keyboard.press('End')
        pg.keyboard.press('Tab'); time.sleep(1.6); t1 = rd("List.md")
        pg.keyboard.press('Shift+Tab'); time.sleep(1.6); t2 = rd("List.md")
        foc = pg.evaluate("document.activeElement.className")
        R.add("b Tab moves a list line in, Shift+Tab back out, focus stays in the note", t1 == "- milk\n  - eggs\n" and t2 == "- milk\n- eggs\n" and 'cm-content' in foc, f"{t1!r} -> {t2!r}")

        # (c) Enter on an empty bullet: several items, and a one-item list
        pg.locator('.cm-line', has_text="eggs").first.click(); pg.keyboard.press('End'); pg.keyboard.press('Enter'); pg.keyboard.press('Enter'); pg.keyboard.type("A plain sentence"); time.sleep(1.6)
        t = rd("List.md")
        R.add("c Enter on an empty bullet ends the list with a blank line (several items)", t == "- milk\n- eggs\n\nA plain sentence\n", repr(t))
        row(pg, "List2"); pg.locator('.cm-line', has_text="solo").first.click(); pg.keyboard.press('End'); pg.keyboard.press('Enter'); pg.keyboard.press('Enter'); pg.keyboard.type("After one"); time.sleep(1.6)
        t = rd("List2.md")
        R.add("c ...and after a one-item list", t == "- solo\n\nAfter one\n", repr(t))

        # (d) table
        row(pg, "Table"); cells = pg.locator('td'); n = cells.count()
        cells.nth(0).click(); time.sleep(0.4); pg.keyboard.press('Enter'); time.sleep(0.4)
        R.add("d table: Enter opens the cell below", 'cm-table-editor' in pg.evaluate("document.activeElement.className"), f"{n} cells")
        cells.nth(n - 1).click(); time.sleep(0.4); pg.keyboard.press('Enter'); time.sleep(0.4); pg.keyboard.type("X"); time.sleep(1.8)
        R.add("d table: Enter on the last row goes under the table", "XParagraph below the table." in rd("Table.md"), repr(rd("Table.md")[-45:]))
        cells.nth(0).click(); time.sleep(0.3); pg.keyboard.type("q"); pg.keyboard.press('Shift+Enter'); pg.keyboard.type("z"); time.sleep(0.3)
        pg.locator('.cm-line', has_text='Paragraph below').first.click(); time.sleep(1.8)
        R.add("d table: Shift+Enter starts a new line inside the cell (<br>)", "q<br>z" in rd("Table.md"), repr(rd("Table.md")[:60]))

        # (e) Find and Search notes open a shut toggle
        row(pg, "Toggle"); pg.locator('.cm-content').first.click(); time.sleep(0.3)
        pg.keyboard.press('Control+f'); time.sleep(0.6); pg.keyboard.type("hiddenword"); pg.keyboard.press('Enter'); time.sleep(1.8)
        R.add("e Ctrl+F finds a word inside a shut toggle and opens it", "<details open>" in rd("Toggle.md"), repr(rd("Toggle.md")[:34]))
        pg.keyboard.press('Escape')
        pg.locator('button[data-tip="Searching titles only"]').first.click(); time.sleep(0.4)   # titles -> note contents
        pg.locator('input[placeholder^="Search"]').first.click(); pg.keyboard.type("zebraword"); time.sleep(1.5)
        hit = pg.locator('aside .tree-row', has_text="Toggle2").first
        found = hit.count() > 0
        if found: hit.click(); time.sleep(1.8)
        R.add("e a Search notes result opens the shut toggle too", found and "<details open>" in rd("Toggle2.md"), f"result found {found}; {rd('Toggle2.md')[:34]!r}")
        pg.locator('input[placeholder^="Search"]').first.fill(""); time.sleep(0.4)

        # (h) # in a note's name
        row(pg, "Linker"); time.sleep(0.5)
        chips = pg.locator('[class*=wikilink]'); R.add("h [[C# basics]] is drawn as a link", chips.count() > 0, f"{chips.count()} link parts")
        chips.first.click(); time.sleep(1.2)
        tabs = pg.evaluate("[...document.querySelectorAll('[role=tab]')].map(e=>e.innerText.trim())")
        R.add("h ...and clicking it opens the note", any('C#' in x for x in tabs), str(tabs))

        # (i) prices and $$ in code
        row(pg, "Prices"); time.sleep(0.8)
        R.add("i $10-$20 stays text and $$ inside a code block stays code", pg.locator('.katex').count() == 0, f"katex nodes {pg.locator('.katex').count()}")

        # (j) Find & Replace
        row(pg, "Mark"); pg.locator('.cm-content').first.click(); pg.keyboard.press('Control+f'); time.sleep(0.6)
        pg.locator('.cm-search input[name=search]').fill("mark"); pg.locator('.cm-search input[name=replace]').fill("grade"); time.sleep(0.3)
        pg.locator('.cm-search button[name=replaceAll]').click(); time.sleep(1.8)
        t = rd("Mark.md"); R.add("j Find & Replace mark -> grade leaves the colour tag alone", t == '<mark class="hl-amber">grade me</mark> and grade plain\n', repr(t))
        pg.keyboard.press('Escape')

        # divider under a sentence
        row(pg, "Divider"); pg.locator('.cm-line', has_text="A sentence").first.click(); pg.keyboard.press('End'); pg.keyboard.type("/divider"); time.sleep(0.8); pg.keyboard.press('Enter'); time.sleep(1.8)
        t = rd("Divider.md"); R.add("/divider under a sentence draws a line, not a heading", t.startswith("A sentence here") and "---" in t and not t.startswith("#") and "# A sentence" not in t, repr(t))
        R.add("no console errors", not app.errors, str(app.errors[:3]))
    finally:
        app.stop()
