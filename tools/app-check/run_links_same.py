"""Every link chip in the note and every chip in the links strip, for a set of awkward notes — to diff between two builds.
usage: WORK=.. python3 run_links_same.py <port> <out.json>"""
import json, sys, time, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab
PORT = int(sys.argv[1]); OUT = sys.argv[2]
WORK = lab.WORK / 'work'; vault = WORK / 'vault-links'
lab.seed_vault(vault, folders=2, notes=4)
B = vault / 'Biology'; M = vault / 'Maths'
(B / 'Topic 1' / 'Waves.md').write_text('# Waves\n\nBiology waves. See [[Optics]] and [[Maths/Waves]] and [[C# basics]] and [[Topic 2]].\n')
(M / 'Waves.md').write_text('# Waves\n\n## Speed\n\nMaths waves. ^k3x9\n\nBack to [[Biology/Topic 1/Waves]] and [[Waves#Speed]] and [[#Speed]].\n')
(B / 'Optics.md').write_text('# Optics\n\n[[Waves]] here, [[waves]] lower, [[Waves#Speed]], [[Waves#^k3x9]], [[Nothing here]], [[Q3: Review]], [[Ideas/Big idea]].\n')
(B / 'C# basics.md').write_text('# C sharp\n\n[[Optics]] and [[Episode #3]] and [[Reuben\'s holiday]] and [[50% done]].\n')
(B / 'Episode #3.md').write_text('# Ep\n\n[[C# basics]] [[C]] [[Café]]\n')
(B / "Reuben's holiday.md").write_text('# Hol\n\n[[Optics]] [[Prices $5-$10]] [[Notes [draft]]]\n')
(B / '50% done.md').write_text('# Half\n\n[[Optics|the optics note]] [[Biology]] [[Maths]]\n')
(B / 'Q3- Review.md').write_text('# Q3\n\n[[Optics]]\n')
(B / 'Café.md').write_text('# Cafe\n\n[[Optics]]\n')
(B / 'Ideas').mkdir(); (B / 'Ideas' / 'Big idea.md').write_text('# Big\n\n[[Optics]] [[Waves]]\n')
NOTES = ['Optics', 'C# basics', 'Episode #3', "Reuben's holiday", '50% done', 'Q3- Review', 'Café', 'Big idea', 'Cell structure', 'Typical']
ud = WORK / 'ud-links'; lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'links.log')
out = {}
GRAB = """() => ({ strip: [...document.querySelectorAll('.links-scroll > *')].map(c => (c.innerText || '').replace(/\\s+/g, ' ').trim() + '|' + ((c.querySelector('button, [class]') || c).className || '').replace(/\\s+/g, ' ').slice(0, 400)),
  inNote: [...document.querySelectorAll('.cm-content .cm-wikilink, .cm-content [class*=wikilink]')].map(c => c.textContent + '|' + c.className) })"""
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(3)
        for folder in ('Topic 1', 'Ideas'):
            page.locator('.tree-title', has_text=folder).first.click(); time.sleep(0.4)
        for t in NOTES:
            page.locator('.tree-title', has_text=t).first.click(); page.wait_for_selector('.cm-content'); time.sleep(1.3)
            out[t] = page.evaluate(GRAB)
        # the two Waves notes, by their rows
        rows = page.locator('.tree-title', has_text='Waves')
        for i in range(rows.count()):
            rows.nth(i).click(); time.sleep(1.3); out[f'Waves #{i}'] = page.evaluate(GRAB)
        b.close()
finally:
    lab.stop(proc)
json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False, sort_keys=True)
print('notes read:', len(out), '| strip chips:', sum(len(v['strip']) for v in out.values()), '| in-note links:', sum(len(v['inNote']) for v in out.values()))
