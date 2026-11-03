import { describe, expect, it } from 'vitest'
import { cssWord, ownFontUrl } from './printNote'

const PAGE = 'file:///Applications/Notealise.app/Contents/Resources/app.asar/out/renderer/index.html'
const DEV = 'http://localhost:5173/'

describe('ownFontUrl', () => {
  it('takes a font file beside the app page, packaged or on the dev server', () => {
    expect(ownFontUrl('file:///Applications/Notealise.app/Contents/Resources/app.asar/out/renderer/assets/Inter-abc.woff2', PAGE)).toBe(true)
    expect(ownFontUrl('http://localhost:5173/src/assets/fonts/inter.woff2?v=1', DEV)).toBe(true)
  })
  it('refuses anything else — another folder, another host, a non-font, a climb out', () => {
    expect(ownFontUrl('file:///Users/someone/.ssh/id_rsa', PAGE)).toBe(false)
    expect(ownFontUrl('file:///Users/someone/secret.woff2', PAGE)).toBe(false)
    expect(ownFontUrl('https://evil.example/inter.woff2', DEV)).toBe(false)
    expect(ownFontUrl('http://localhost:5173/index.html', DEV)).toBe(false)
    expect(ownFontUrl('file:///Applications/Notealise.app/Contents/Resources/app.asar/out/renderer/../../../../../../Users/x/a.woff2', PAGE)).toBe(false)
    expect(ownFontUrl('file:///Applications/Notealise.app/Contents/Resources/app.asar/out/renderer/%2e%2e/a.woff2', PAGE)).toBe(true) // not a real climb: left as a literal name, and the file will not exist
    expect(ownFontUrl('', PAGE)).toBe(false)
    expect(ownFontUrl(String(null), '')).toBe(false)
  })
  it('does not mind a hash or query on the page address', () => {
    expect(ownFontUrl('http://localhost:5173/a.woff2', 'http://localhost:5173/?x=/y#/z')).toBe(true)
  })
})

describe('cssWord', () => {
  it('keeps font names and drops what could break out of a stylesheet', () => {
    expect(cssWord('JetBrains Mono')).toBe('JetBrains Mono')
    expect(cssWord("a';}body{x:y")).toBe('abodyxy')
    expect(cssWord('700')).toBe('700')
  })
})
