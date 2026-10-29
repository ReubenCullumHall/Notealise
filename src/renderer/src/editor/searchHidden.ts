import { EditorState, type Extension } from '@codemirror/state'
import { SearchQuery, setSearchQuery } from '@codemirror/search'

// Find & Replace must not find words inside the note's hidden HTML — the colour
// tags (`<mark class="hl-amber">`), toggles (`<details>`, `<summary>`), voice
// notes and videos (bug scan 2026-10-27). Replace all "mark" → "grade" turned a
// highlight into raw `<grade …>` text, Next selected an invisible match inside
// a tag, and the count included them.
//
// The built-in search panel builds its own SearchQuery with no way to pass a
// filter, so every query it sets is swapped here for the same query plus a
// `test` that refuses a match touching a tag.

const TAG = /<\/?[a-zA-Z][^>\n]*>/g

/** Does [from, to) touch an HTML tag on its line? */
export function insideTag(state: EditorState, from: number, to: number): boolean {
  const line = state.doc.lineAt(from)
  if (line.text.indexOf('<') === -1) return false
  TAG.lastIndex = 0
  for (let m = TAG.exec(line.text); m; m = TAG.exec(line.text)) {
    const a = line.from + m.index
    const b = a + m[0].length
    if (from < b && to > a) return true
  }
  return false
}

const skipTags = (_match: string, state: EditorState, from: number, to: number): boolean =>
  !insideTag(state, from, to)

export const searchSkipsHiddenTags: Extension = EditorState.transactionFilter.of((tr) => {
  for (const e of tr.effects) {
    if (!e.is(setSearchQuery) || e.value.test) continue
    const q = e.value
    const wrapped = new SearchQuery({
      search: q.search,
      caseSensitive: q.caseSensitive,
      literal: q.literal,
      regexp: q.regexp,
      replace: q.replace,
      wholeWord: q.wholeWord,
      test: skipTags
    })
    return [tr, { effects: setSearchQuery.of(wrapped) }]
  }
  return tr
})
