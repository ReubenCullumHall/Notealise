import { Icon } from '../icons'

// Settings → Source folder. Where the notes actually are, and how to point the
// app somewhere else.
//
// Both of these used to live permanently at the bottom of the sidebar — a
// "Switch folder" button and a line reading "Editing real .md files on disk".
// The reassurance is true and worth saying, but you only need to read it once;
// changing vault is a rare, considered act. Neither earns a slot you look at all
// day, and both belong beside the path they are about.

interface Props {
  /** the absolute path of the open vault */
  vault: string | null
  onPickVault: () => void
}

export function SourceFolder({ vault, onPickVault }: Props): React.JSX.Element {
  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Source folder</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        Every note is an ordinary <code className="font-mono text-ink-700">.md</code> file in this
        folder. The app edits those files in place — nothing is copied into a database, and nothing
        is stored anywhere else. Delete the app tomorrow and your notes are exactly where you left
        them, readable by anything.
      </p>

      <div className="mt-3 rounded-xl px-3 py-3 ring-1 ring-ink-300/20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
          Currently open
        </p>
        <p className="mt-1 break-all font-mono text-[12px] leading-relaxed text-ink-700">
          {vault ?? 'No folder chosen yet'}
        </p>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-ink-500">
        The app&rsquo;s own settings for this folder — themes, spaces, what&rsquo;s pinned, what&rsquo;s
        in the bin — live in a hidden{' '}
        <code className="font-mono text-ink-700">.mdnotes</code> folder inside it, so a vault carries
        its own setup with it if you move or sync it.
      </p>

      <h3 className="mt-7 font-display text-[15px] font-semibold text-ink-900">Use another folder</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        Switching points the app at a different folder. Nothing is moved, copied or deleted — the
        folder you leave stays exactly as it is, and switching back finds it unchanged, tabs and all.
      </p>
      <button
        onClick={onPickVault}
        className="btn-edge mt-3 flex items-center justify-center gap-2 rounded-lg border border-ink-300/35 bg-surface/70 px-3 py-2 text-[13px] font-medium text-ink-700 outline-none transition duration-200 hover:border-brand-300 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100"
      >
        <Icon name="folder" className="h-4 w-4" />
        Choose a different folder…
      </button>
    </>
  )
}
