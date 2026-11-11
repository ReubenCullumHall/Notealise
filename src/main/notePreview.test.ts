// The sidebar line the window works out after its own save (shared/plainText.ts
// `notePreview`) must be the line main gives for the same note on its next walk of the
// vault — or a row would change again, for no reason, at the next launch.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { notePreview, PREVIEW_BYTES } from '../shared/plainText'
import { listTree, setVaultRoot } from './vault'

const TEXTS: [string, string][] = [
  ['an ordinary note', '# Typical\n\n## Section 1\n\nThe quick brown fox jumps over the lazy dog while **bold words** sit beside a [[Cell structure]] link.'],
  ['a very short one', 'short'],
  ['an empty one', ''],
  ['only blank lines', '\n\n   \n'],
  ['a long run of plain words', 'word '.repeat(400)],
  ['Korean — three bytes a character', '세포는 생명의 기본 단위이다. '.repeat(40)],
  ['a cut that lands inside a character', 'é'.repeat(250)],
  ['emoji — four bytes each', '📓 notes '.repeat(80)],
  ['a head that is mostly colour tags', '<mark class="hl-amber">a</mark> '.repeat(30) + 'the words after the colour'],
  ['a table first', '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n' + 'after the table '.repeat(40)],
  ['a voice note first', '<audio controls src="memo.m4a" data-name="Untitled 1"></audio>\n\nWords under the voice note.'],
  ['one byte under the cut', 'x'.repeat(PREVIEW_BYTES - 1)],
  ['exactly on the cut', 'x'.repeat(PREVIEW_BYTES)],
  ['one byte over the cut', 'x'.repeat(PREVIEW_BYTES + 1)]
]

let root = ''
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'note-preview-')))
  setVaultRoot(root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('the sidebar line the window works out', () => {
  it('is the one main reads off the disk, for every kind of note', async () => {
    TEXTS.forEach(([, text], i) => writeFileSync(path.join(root, `note ${String(i).padStart(2, '0')}.md`), text, 'utf8'))
    const tree = await listTree()
    expect(tree.length).toBe(TEXTS.length)
    tree.forEach((node, i) => {
      const [label, text] = TEXTS[i]
      expect(node.preview, label).toBe(notePreview(text))
    })
  })
})
