import { useEffect, useRef } from 'react'
import { CodeEditor } from '../../editor/CodeEditor'
import { ToggleRow } from '../../settings/primitives'
import { EMPTY_ENV, type LinkHandlers } from '../../editor/linkEnv'
import type { OnboardingStepProps } from '../Onboarding'

// No note links exist yet at this point in onboarding, and nothing here opens
// or creates one — the demo box is for the feel of live preview, not linking.
// `notify` is a no-op for the same reason the rest are: onboarding owns the
// whole screen, so App's notice strip isn't mounted to report into, and there
// is nothing in this box that can fail anyway (no attachments, no file writes).
const NO_LINK_HANDLERS: LinkHandlers = {
  open: () => {},
  create: () => {},
  jump: () => {},
  reveal: () => {},
  inspect: () => {},
  dragStart: () => {},
  dragEnd: () => {},
  notify: () => {},
  // No attachments can exist in the demo box, so nothing can ask to be deleted.
  confirmMediaDelete: () => {}
}

interface Props extends OnboardingStepProps {
  spaceFolder: string
  text: string
  onTextChange: (text: string) => void
  /** the path this step already saved to, if Continue has run once — stepping
   *  Back into Write and continuing again must UPDATE that note, not leave it
   *  behind and create a second one (see `commit` below) */
  savedPath: string | null
  onSaved: (path: string) => void
  /** whether finishing seeds the curated welcome notes. On by default, and it
   *  rides on THIS step rather than a page of its own: onboarding stays thin,
   *  and the question "should the app put some notes in for you" belongs
   *  beside the first note you write yourself, not on a screen that asks
   *  nothing else. */
  seedWelcome: boolean
  onSeedWelcome: (on: boolean) => void
}

/** First line, Markdown-stripped, as a filename stem — same idea as
 *  `createNote`'s own title handling, done here because main only sanitises
 *  what it's handed and this decides what to hand it. */
function titleFromFirstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? ''
  const stripped = line.trim().replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '')
  return stripped || 'Untitled'
}

export function WriteStep({
  spaceFolder,
  text,
  onTextChange,
  savedPath,
  onSaved,
  seedWelcome,
  onSeedWelcome,
  onReady
}: Props): React.JSX.Element {
  // Second and later saves write over the note this step already made.
  // Creating a fresh one each time left the earlier file sitting in the vault
  // as an orphan the user never asked for — reachable by going Back into
  // Write, editing, and continuing. The FILENAME deliberately stays as first
  // saved even if the first line has since changed: that's how the real app
  // behaves too, a note is renamed by renaming it, not by editing its heading.
  //
  // Two callers since 2026-09-24 (Continue, and "Show me the file"), so the
  // note is created at most once however they interleave: `created` holds the
  // one createNote in flight, and `known` the path as soon as it exists —
  // before the parent's `savedPath` prop has caught up.
  const known = useRef<string | null>(savedPath)
  const created = useRef<Promise<string> | null>(null)
  const save = async (): Promise<string> => {
    let path = known.current ?? savedPath
    if (!path) {
      created.current ??= window.api.createNote(spaceFolder, titleFromFirstLine(text))
      path = await created.current
    }
    known.current = path
    await window.api.writeNote(path, text)
    onSaved(path)
    return path
  }

  // onReady's `commit` closes over `text`, so it has to be rebuilt whenever
  // `text` changes — a ref alone would go stale the moment they stopped typing.
  const typed = text.trim().length > 0
  useEffect(() => {
    onReady({ ready: typed, commit: typed ? async () => void (await save()) : undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, spaceFolder, savedPath])

  // What the cut "That note is already a file" step existed for, kept as one
  // small link: saving is what makes the file, so it saves first, then opens
  // the real folder window — the proof is the OS showing it, not a mockup.
  const showFile = async (): Promise<void> => {
    window.api.revealInFolder(await save())
  }

  const hasHeading = /^#{1,6}\s+/m.test(text)
  const editorRef = useRef(null)

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink-900">Try writing something</h1>
        <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-relaxed text-ink-500">
          Type a <span className="font-mono">#</span> and a space before a line to make it a heading.
        </p>
      </div>

      {/* `flex flex-col` + `overflow-hidden`, NOT `overflow-y-auto`.
          Measured 2026-09-05 on the real step: the box was 190px tall with a
          scrollHeight of 422 and a 10px scrollbar showing — on an EMPTY editor,
          which is exactly what a tester reported. The cause is the chain
          `.cm-host { flex: 1; min-height: 0 }` → `.cm-mount { height: 100% }` →
          `.cm-editor { height: 100% }` (editor/highlight.ts): every one of
          those needs a FLEX parent with a definite height to resolve against,
          and this box was neither, so the editor sized itself to something far
          taller than the box and the box grew a bar to reach it.

          Making the box a flex column gives `.cm-host` its `flex: 1` to fill
          and its `min-height: 0` to shrink against, so the editor lands at
          exactly its box height minus `py-3`. Scrolling then belongs to
          CodeMirror's own `.cm-scroller`, which is the app's normal behaviour
          everywhere else: no bar until the text is longer than the box, and
          then only once the pointer comes near it (editor/scrollbarReveal.ts).
          `overflow-hidden` on the wrapper guarantees it can never grow a second
          one of its own.

          `.onb-write-box` then undoes the editor theme's `40vh` bottom padding
          — see app.css. That padding is the real reason a scrollbar was there
          on an EMPTY box: it is scroll-past-the-end room for a full-window
          note, and 40vh of a 900px window is 360px of guaranteed overflow
          inside a 166px box.

          160px, not 190 (2026-09-25): at the default 1100×720 window, Windows'
          menu bar leaves the page 466px and this step measured 484, so it
          always scrolled there. 30px off this box, the tallest thing on the
          page, brings it to 454 — still about five lines of writing room. */}
      <div className="onb-write-box flex h-[160px] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-surface/70 px-4 py-3 text-left shadow-card">
        <CodeEditor
          path="onboarding-demo"
          doc={text}
          version={1}
          onDocChange={onTextChange}
          env={EMPTY_ENV}
          linkHandlers={NO_LINK_HANDLERS}
          editorRef={editorRef}
        />
      </div>

      {/* Only once there is something to be a file. */}
      <button
        type="button"
        onClick={() => void showFile()}
        tabIndex={typed ? 0 : -1}
        aria-hidden={!typed}
        className={
          '-mt-3 rounded border-none bg-transparent p-0 text-[12.5px] text-ink-500 underline-offset-2 transition-opacity duration-200 hover:text-ink-700 hover:underline ' +
          (typed ? 'opacity-100' : 'pointer-events-none opacity-0')
        }
      >
        Show me the file
      </button>

      <p className={'text-[12px] text-brand-600 transition-opacity duration-200 ' + (hasHeading ? 'opacity-100' : 'opacity-0')}>
        That&rsquo;s Markdown. The app hides the symbols while you&rsquo;re not on that line, so it stays
        readable. Now hit Enter and see how it formats.
      </p>

      {/* On by default. Off leaves the vault holding exactly the note above and
          nothing else — which the hint says out loud, because "no welcome
          notes" and "empty app" are the same screen and only one of them is
          what you chose. */}
      <div className="w-full max-w-[480px]">
        <ToggleRow
          on={seedWelcome}
          onClick={() => onSeedWelcome(!seedWelcome)}
          label="Start me off with a few welcome notes"
          hint={
            seedWelcome
              ? 'A short set showing how the app is organised and what you can change. Delete them any time.'
              : 'Off — you\u2019ll land in the app with just the note you wrote above.'
          }
        />
      </div>
    </div>
  )
}
