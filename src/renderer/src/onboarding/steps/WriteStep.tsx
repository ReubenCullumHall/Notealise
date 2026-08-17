import { useEffect, useRef } from 'react'
import { CodeEditor } from '../../editor/CodeEditor'
import { EMPTY_ENV, type LinkHandlers } from '../../editor/linkEnv'
import type { OnboardingStepProps } from '../Onboarding'

// No note links exist yet at this point in onboarding, and nothing here opens
// or creates one — the demo box is for the feel of live preview, not linking.
const NO_LINK_HANDLERS: LinkHandlers = {
  open: () => {},
  create: () => {},
  jump: () => {},
  reveal: () => {},
  inspect: () => {},
  dragStart: () => {},
  dragEnd: () => {}
}

interface Props extends OnboardingStepProps {
  spaceFolder: string
  text: string
  onTextChange: (text: string) => void
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

export function WriteStep({ spaceFolder, text, onTextChange, onSaved, onReady }: Props): React.JSX.Element {
  // onReady's `commit` closes over `text`, so it has to be rebuilt whenever
  // `text` changes — a ref alone would go stale the moment they stopped typing.
  useEffect(() => {
    const typed = text.trim().length > 0
    onReady({
      ready: typed,
      commit: typed
        ? async () => {
            const path = await window.api.createNote(spaceFolder, titleFromFirstLine(text))
            await window.api.writeNote(path, text)
            onSaved(path)
          }
        : undefined
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, spaceFolder])

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
