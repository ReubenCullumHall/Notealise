#!/usr/bin/env python3
"""Chemistry in formulas, in a real window (Mac). One hidden launch, made-up notes.

    WORK=<scratch> ../app-check/build.sh
    WORK=<scratch> python3 check.py <free port>

Run it once against a build WITHOUT the add-on (LAB_OUT=<that build>): the chemistry
checks must fail there, or this script is proving nothing.
"""
import os
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'app-check'))
os.environ.setdefault('LAB_SIZE', '1280x1500')
import lab  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9487
RUN = lab.WORK / f"chem-run-{os.environ.get('LAB_OUT', 'out')}"
VAULT, UD = RUN / 'vault', RUN / 'ud'

NOTE = r"""# Formulas

Water is $\ce{H2O}$ and sulfate is $\ce{SO4^2-}$. Prices stay words: $5 and $6.

$$
\ce{2H2 + O2 -> 2H2O}
$$

$$
\ce{N2 + 3H2 <=> 2NH3}
$$

Energy is $\pu{123 kJ/mol}$ and ordinary maths is $x^2 + \frac{a}{b}$.

| Ion | Charge |
| --- | --- |
| $\ce{Fe^3+}$ | 3 |
| $\ce{CO3^2-}$ | 2 |

<details open><summary>Inside a toggle</summary>

$$
\ce{CuSO4 . 5H2O}
$$

</details>

Half typed $\ce{->[}$ stays on the page.

Not allowed $\ce{<img src=x onerror=window.__pwned=1>}$ and $\ce{\href{javascript:window.__pwned=1}{x}}$.

Last line.
"""

GOOD = [r'\ce{H2O}', r'\ce{SO4^2-}', r'\ce{2H2 + O2 -> 2H2O}', r'\ce{N2 + 3H2 <=> 2NH3}', r'\pu{123 kJ/mol}',
        r'\ce{Fe^3+}', r'\ce{CO3^2-}', r'\ce{CuSO4 . 5H2O}']

READ = r"""() => [...document.querySelectorAll('.cm-content .katex, .cm-content .katex-error')].map((el) => ({
  tex: el.querySelector('annotation')?.textContent ?? el.getAttribute('title') ?? el.textContent,
  text: el.textContent,
  // An unknown command is NOT a .katex-error: KaTeX draws its name in red, so look for it on screen.
  error: el.classList.contains('katex-error') || !!el.querySelector('.katex-error') ||
    /\\(ce|pu)/.test(el.querySelector('.katex-html')?.textContent ?? el.textContent),
  table: !!el.closest('.cm-table')
}))"""

results = []


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail and not ok else ''))


if RUN.exists():
    shutil.rmtree(RUN)
(VAULT / 'Chem').mkdir(parents=True)
(VAULT / 'Chem' / 'Formulas.md').write_text(NOTE)
(VAULT / '.mdnotes').mkdir()
(VAULT / '.mdnotes' / 'settings.json').write_text(
    '{"spaces":[{"folder":"Chem"}],"activeSpaceFolder":"Chem","playStartupAnimation":false}')
lab.profile(UD, VAULT)
proc, _ = lab.launch(UD, PORT, RUN / 'app.log')

try:
    with sync_playwright() as p:
        browser, page = lab.connect(p, PORT)
        page.emulate_media(color_scheme='light', reduced_motion='reduce')
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.wait_for_selector('.tree-title')
        page.locator('.tree-row', has=page.locator('.tree-title', has_text='Formulas')).first.click()
        page.wait_for_selector('.cm-content .katex')
        time.sleep(1.2)

        drawn = page.evaluate(READ)
        # Say which build this really is: a comparison run is worthless if it tests the wrong one.
        print('build:', page.evaluate("document.querySelector('script[type=module]')?.src"))
        for tex in GOOD:
            hit = next((d for d in drawn if tex in (d['tex'] or '')), None)
            check(f'draws {tex}', hit and not hit['error'], str(hit))
        check('chemistry in a table draws', sum(1 for d in drawn if d['table'] and not d['error'] and r'\ce' in d['tex']) == 2)
        body = page.locator('.cm-content').inner_text()
        check('a price stays as words', '$5 and $6' in body, body[:120])
        check('ordinary maths still draws', any('frac' in (d['tex'] or '') and not d['error'] for d in drawn))
        check('half-typed chemistry stays on the page', any('->[' in (d['tex'] or d['text'] or '') for d in drawn))
        danger = page.evaluate("""() => ({
          imgs: document.querySelectorAll('.cm-content .cm-math img, .cm-content .cm-math [onerror]').length,
          links: document.querySelectorAll('.cm-content .cm-math a[href]').length,
          ran: window.__pwned === 1
        })""")
        check('text inside chemistry cannot become a picture, a link or code',
              not danger['imgs'] and not danger['links'] and not danger['ran'], str(danger))
        page.screenshot(path=str(RUN / 'light.png'))
        page.emulate_media(color_scheme='dark', reduced_motion='reduce')
        time.sleep(0.7)
        page.screenshot(path=str(RUN / 'dark.png'))
        page.emulate_media(color_scheme='light', reduced_motion='reduce')
        time.sleep(0.5)

        # The maths box: type new chemistry with real keys, see it drawn, see it in the file.
        page.locator('.cm-math-display').first.click()
        page.wait_for_selector('.cm-math-input')
        page.locator('.cm-math-input').click()
        page.keyboard.press('Meta+a')
        page.keyboard.type(r'\ce{CaCO3 -> CaO + CO2}')
        time.sleep(0.4)
        live = page.evaluate(r"""() => { const e = document.querySelector('.cm-math-editing');
          return e ? { error: !!e.querySelector('.katex-error') || /\\ce/.test(e.querySelector('.katex-html')?.textContent ?? ''),
                       tex: e.querySelector('annotation')?.textContent } : null }""")
        check('the maths box shows chemistry as you type', live and not live['error'] and 'CaCO3' in (live['tex'] or ''), str(live))
        page.locator('.cm-math-done').click()
        saved = False
        for _ in range(40):
            saved = r'\ce{CaCO3 -> CaO + CO2}' in (VAULT / 'Chem' / 'Formulas.md').read_text()
            if saved:
                break
            time.sleep(0.1)
        check('it is saved in the note as plain text', saved)

        # Save as: its page is drawn separately, as MathML.
        row = page.locator('.tree-row', has=page.locator('.tree-title', has_text='Formulas')).first
        row.click(button='right')
        time.sleep(0.3)
        page.get_by_text('Save as…', exact=True).first.click()
        page.wait_for_selector('.saveas-sheet iframe')
        time.sleep(1.2)
        page.locator('.saveas-sheet').screenshot(path=str(RUN / 'save-as.png'))
        frame = page.locator('.saveas-sheet iframe').element_handle().content_frame()
        # What a reader SEES on the page, not what the file happens to hold.
        sheet = frame.evaluate(r"""() => ({
          visible: document.body.innerText,
          maths: document.querySelectorAll('math').length,
          bad: document.querySelectorAll('img[src="x"], [onerror], a[href^="javascript"]').length,
          errors: [...document.querySelectorAll('.katex-error')].map((e) => e.textContent)
        })""")
        (RUN / 'save-as.txt').write_text(sheet['visible'])
        # MathML reads back a letter per line; the one error box is the deliberately bad formula.
        shown = ''.join(sheet['visible'].split())
        for e in sheet['errors']:
            shown = shown.replace(''.join(e.split()), '')
        for name, mark in [('the edited reaction', 'CaCO'), ('an equilibrium', 'NH'), ('units', 'kJ'), ('an ion in a table', 'Fe')]:
            check(f'Save as shows {name}', mark in shown, shown[:200])
        check('Save as shows no chemistry source code', '\\ce' not in shown and '\\pu' not in shown,
              [l for l in shown.splitlines() if '\\ce' in l or '\\pu' in l][:2].__repr__()[:200])
        check('Save as shows no stray X from the spacing helpers', 'HX2' not in shown and 'SOX' not in shown, shown[:200])
        check('Save as shows only the deliberately bad formula as an error',
              len(sheet['errors']) == 1 and 'onerror' in sheet['errors'][0], str(sheet['errors'])[:200])
        check('Save as carries nothing unsafe', sheet['bad'] == 0, str(sheet['bad']))
        page.keyboard.press('Escape')
        time.sleep(0.4)
        check('no crash in the window', not errors, '; '.join(errors)[:200])
finally:
    lab.stop(proc)

print(f'{sum(results)} of {len(results)} passed')
print('pictures:', RUN)
sys.exit(0 if all(results) else 1)
