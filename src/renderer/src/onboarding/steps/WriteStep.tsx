import { useEffect, useRef } from 'react'
import { CodeEditor } from '../../editor/CodeEditor'
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
  onReady
}: Props): React.JSX.Element {
  // onReady's `commit` closes over `text`, so it has to be rebuilt whenever
  // `text` changes — a ref alone would go stale the moment they stopped typing.
  useEffect(() => {
    const typed = text.trim().length > 0
    onReady({
      ready: typed,
      commit: typed
        ? async () => {
            // Second and later commits write over the note this step already
            // made. Creating a fresh one each time left the earlier file
            // sitting in the vault as an orphan the user never asked for —
            // reachable by going Back into Write, editing, and continuing.
            // The FILENAME deliberately stays as first saved even if the first
            // line has since changed: that's how the real app behaves too, a
            // note is renamed by renaming it, not by editing its heading.
            const path = savedPath ?? (await window.api.createNote(spaceFolder, titleFromFirstLine(text)))
            await window.api.writeNote(path, text)
            onSaved(path)
          }
        : undefined
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, spaceFolder, savedPath])

  const hasHeading = /^#{1,6}\s+/m.test(text)
  const editorRef = useRef(null)

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink-900">Try writing something</h1>
        <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-relaxed text-ink-500">
          Type a <span className="font-mono">#</span> and a space before a line to make it a heading. Watch
          what happens to the <span className="font-mono">#</span>.
        </p>
      </div>

      <div className="h-[190px] w-full max-w-[480px] overflow-y-auto rounded-2xl bg-surface/70 px-4 py-3 text-left shadow-card">
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

      <p className={'text-[12px] text-brand-600 transition-opacity duration-200 ' + (hasHeading ? 'opacity-100' : 'opacity-0')}>
        That&rsquo;s Markdown. The app hides the symbols while you&rsquo;re not on that line, so it stays
        readable.
      </p>
    </div>
  )
}
