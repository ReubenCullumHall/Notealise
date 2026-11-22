import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import katex from 'katex'
import 'katex/contrib/mhchem'

// Chemistry in formulas (`\ce{…}`, `\pu{…}`). The add-on is loaded once, in the
// window's entry file, and teaches the one shared KaTeX its commands. Lose that
// line and every chemistry formula turns into red error text with nothing else
// failing, which is why the first test reads the file.

const root = path.resolve(__dirname, '../..')
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8')

// The options every formula in the app is drawn with. MathML is Save as / Print.
const draw = (tex: string, output: 'html' | 'mathml'): string =>
  katex.renderToString(tex, { throwOnError: false, maxSize: 100, output })

describe('chemistry in formulas', () => {
  it('is loaded by the window, for every place a formula is drawn', () => {
    expect(read('src/renderer/src/main.tsx')).toMatch(/^import 'katex\/contrib\/mhchem'$/m)
  })

  it('credits the add-on under its own licence', () => {
    const list = read('src/renderer/src/settings/ossLicenses.generated.ts')
    expect(list).toMatch(/"name": "mhchem for KaTeX[^"]*",\s*"version": "[^"]+",\s*"license": "Apache-2\.0"/)
  })

  it.each([
    '\\ce{H2O}',
    '\\ce{2H2 + O2 -> 2H2O}',
    '\\ce{CO3^2-}',
    '\\ce{Fe^3+}',
    '\\ce{N2 + 3H2 <=> 2NH3}',
    '\\ce{CuSO4 . 5H2O}',
    '\\ce{CH3-CH2-OH}',
    '\\ce{Hg^2+ ->[I-] HgI2}',
    '\\ce{^{227}_{90}Th+}',
    '\\pu{123 kJ/mol}'
  ])('draws %s', (tex) => {
    // Strict on purpose: with throwOnError off, an unknown command is drawn in red and raises nothing.
    for (const output of ['html', 'mathml'] as const) {
      expect(() => katex.renderToString(tex, { throwOnError: true, maxSize: 100, output })).not.toThrow()
    }
  })

  // Save as / Print calls KaTeX with no try/catch round it, so half-typed
  // chemistry must come back as a drawn error and never throw.
  it.each(['\\ce{', '\\ce{}', '\\ce{^}', '\\ce{->[}', '\\ce{(}', '\\ce{{}', '\\ce{}}', '\\ce{$}', '\\ce{\\}', '\\pu{}', '\\pu{^}'])(
    'does not throw on half-typed %s',
    (tex) => {
      for (const output of ['html', 'mathml'] as const) expect(() => draw(tex, output)).not.toThrow()
    }
  )
})
