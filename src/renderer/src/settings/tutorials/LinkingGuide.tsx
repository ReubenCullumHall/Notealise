import { Icon } from '../../icons'

// Settings → Tutorials → Linking your notes.
//
// Pure explanation; the switches live on the Linking content page. `[[Note]]` is
// guessable, `[[Note|what it says]]` is not, and neither is the rule about which
// space the picker offers you. None of it is discoverable from the editor, and a
// feature nobody can find the shape of may as well not be there.

/** One form of link: what you type, what you see, what it does. */
function Form({
  type,
  reads,
  title,
  children
}: {
  type: string
  reads: React.ReactNode
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="rounded-xl px-3 py-3 ring-1 ring-ink-300/20">
      <p className="text-[13px] font-medium text-ink-800">{title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-wash/[0.07] px-2 py-1 font-mono text-[12px] text-ink-700">
          {type}
        </code>
        <span aria-hidden="true" className="text-ink-300">
          →
        </span>
        <span className="text-[12.5px] text-ink-600">{reads}</span>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">{children}</p>
    </div>
  )
}

/** How the rendered link looks in the note, so the page shows the real thing. */
function Chip({ children, dir = false }: { children: React.ReactNode; dir?: boolean }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-[5px] bg-wash/[0.08] px-1.5 py-0.5 text-ink-800">
      <Icon name={dir ? 'folder' : 'doc'} className="h-3 w-3 opacity-60" />
      {children}
    </span>
  )
}

export function LinkingGuide(): React.JSX.Element {
  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Linking notes</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        Type <code className="font-mono text-ink-700">[[</code> anywhere in a note to connect it to
        another one, and pick from the list. The <span className="font-medium">Link to a note</span>{' '}
        command does the same thing — it&rsquo;s on <code className="font-mono text-ink-700">/link</code>{' '}
        and can go on a format-bar button.
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
        Links are plain text in your file, exactly as written below. Open the note anywhere else and
        it still reads sensibly — nothing about this app is needed to make sense of it later.
      </p>

      <h3 className="mt-7 font-display text-[15px] font-semibold text-ink-900">The five forms</h3>
      <div className="mt-3 flex flex-col gap-2">
        <Form type="[[Waves]]" title="By name" reads={<Chip>Waves</Chip>}>
          The everyday one. If two notes share a name, the nearest wins — the one in the same folder,
          then the one closest to it — and the link is underlined with dots to say the choice
          wasn&rsquo;t obvious.
        </Form>

        <Form type="[[Term 3/Waves]]" title="By path" reads={<Chip>Waves</Chip>}>
          When the name alone isn&rsquo;t enough, or you want to be exact. The folder is hidden when
          the link is rendered, so it costs nothing to read.
        </Form>

        <Form
          type="[[Waves|the waves chapter]]"
          title="With your own words (an alias)"
          reads={<Chip>the waves chapter</Chip>}
        >
          Everything after the <code className="font-mono">|</code> is what the sentence says; the
          part before it is which note it goes to. This is the one to reach for when a link sits
          inside a sentence — <span className="italic">&ldquo;see the waves chapter&rdquo;</span>{' '}
          reads properly, <span className="italic">&ldquo;see Waves&rdquo;</span> doesn&rsquo;t.
        </Form>

        <Form
          type="[[Waves#Interference]]"
          title="Straight to a heading"
          reads={
            <Chip>
              Waves <span className="px-0.5 text-ink-300">›</span>{' '}
              <span className="text-ink-500">Interference</span>
            </Chip>
          }
        >
          Opens the note scrolled to that heading. <code className="font-mono">[[#Interference]]</code>{' '}
          on its own jumps within the note you&rsquo;re already in.
        </Form>

        <Form type="[[Term 3]]" title="A folder" reads={<Chip dir>Term 3</Chip>}>
          A folder has nothing to open, so clicking it <span className="font-medium">shows</span> it:
          the sidebar opens that folder and closes the others. Folders carry a folder icon so you can
          tell at a glance which kind of thing a link points at.
        </Form>
      </div>

      <h3 className="mt-7 font-display text-[15px] font-semibold text-ink-900">
        Links and your spaces
      </h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        The <code className="font-mono text-ink-700">[[</code> list shows the space you&rsquo;re
        writing in. To link something in another space, start by typing that space&rsquo;s name and
        the list follows you there:
      </p>
      <div className="mt-2 rounded-xl px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-600 ring-1 ring-ink-300/20">
        <div>
          [[Wav<span className="ml-3 font-sans text-ink-400">— notes in this space</span>
        </div>
        <div className="mt-1">
          [[Physics<span className="ml-3 font-sans text-ink-400">— everything in Physics</span>
        </div>
        <div className="mt-1">
          [[Physics/Wav<span className="ml-3 font-sans text-ink-400">— narrowed inside Physics</span>
        </div>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
        A link that already crosses spaces keeps working wherever you are — this only decides what
        the picker offers. Those links are drawn with a dotted leading edge, and hovering one names
        the space it lands in.
      </p>

      <h3 className="mt-7 font-display text-[15px] font-semibold text-ink-900">Opening a link</h3>
      <div className="mt-2 flex flex-col gap-1 text-[12px] text-ink-600">
        {[
          ['Click', 'Opens in a new tab — the note you were reading stays open'],
          ['Ctrl / Cmd + click', 'Opens it here instead, replacing this note'],
          ['Alt + click', 'Opens it beside this one, in a new column'],
          ['Drag it', 'Drop it into any column'],
          ['A note that isn’t written yet', 'Shown dashed. Clicking makes it, next to this note']
        ].map(([k, v]) => (
          <div key={k} className="flex gap-3 rounded-lg px-2 py-1.5 ring-1 ring-ink-300/15">
            <span className="w-[10.5rem] shrink-0 font-medium text-ink-700">{k}</span>
            <span className="min-w-0 flex-1 text-ink-500">{v}</span>
          </div>
        ))}
      </div>

      <h3 className="mt-7 font-display text-[15px] font-semibold text-ink-900">The links strip</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        Every note carries a strip of its connections at the top: what it links to, then what links
        back to it. Hover one to see which of the two it is, which space it&rsquo;s in, and the line
        the link sits in.
      </p>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
        Whether it shows at all, whether it stays put as you scroll, and whether the folder trail
        shows above it are all in{' '}
        <span className="font-medium text-ink-500">Settings → Linking content</span> — and each space
        can answer them differently.
      </p>

      <p className="mt-6 text-[11.5px] leading-relaxed text-ink-400">
        Renaming a note updates the links that pointed at it. Moving one between folders doesn&rsquo;t
        need to — links find a note by its name, so they keep working wherever it ends up.
      </p>
    </>
  )
}
