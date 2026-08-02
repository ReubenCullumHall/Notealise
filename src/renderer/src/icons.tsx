// Inline-SVG icon set (ported from the legacy `I` set). Icons draw with
// `currentColor` so they inherit token colours from whatever row/button hosts
// them (rule 5 — no hardcoded colour here). No dependency.

export type IconName =
  | 'doc'
  | 'folder'
  | 'chevron'
  | 'grip'
  | 'plus'
  | 'gear'
  | 'star'
  | 'starFilled'
  | 'trash'
  | 'archive'
  | 'restore'
  | 'search'
  | 'check'
  | 'x'
  | 'dots'
  | 'edit'
  | 'eye'
  | 'filePlus'
  | 'folderPlus'
  | 'sliders'
  | 'text'
  | 'sort'
  | 'sun'
  | 'panelLeft'
  | 'splitView'
  | 'flag'
  | 'spaces'
  | 'library'
  // format-bar actions (assignable to the custom slots)
  | 'listBullet'
  | 'listNumber'
  | 'listCheck'
  | 'quote'
  | 'code'
  | 'codeBlock'
  | 'link'
  | 'noteLink'
  | 'book'
  | 'rule'
  | 'table'

// Each entry is the inner SVG for a 24×24 viewBox. Stroke icons inherit the
// wrapper's stroke; filled marks set their own fill and clear the stroke.
const PATHS: Record<IconName, React.JSX.Element> = {
  doc: (
    <>
      <path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M13 3v5h5" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  edit: <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.35" />
      <circle cx="9" cy="12" r="1.35" />
      <circle cx="9" cy="18" r="1.35" />
      <circle cx="15" cy="6" r="1.35" />
      <circle cx="15" cy="12" r="1.35" />
      <circle cx="15" cy="18" r="1.35" />
    </g>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77 6.8 19.5l.99-5.79-4.21-4.1 5.82-.85z" />,
  starFilled: (
    <path
      fill="currentColor"
      stroke="none"
      d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77 6.8 19.5l.99-5.79-4.21-4.1 5.82-.85z"
    />
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  archive: (
    <>
      <path d="M3 5h18v4H3z" />
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
      <path d="M10 13h4" />
    </>
  ),
  restore: (
    <>
      <path d="M4 10a8 8 0 1 1-1 4" />
      <path d="M4 5v5h5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  check: <path d="M5 12l4 4L19 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  filePlus: (
    <>
      <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
      <path d="M13 3v6h6" />
      <path d="M12 12v5M9.5 14.5h5" />
    </>
  ),
  folderPlus: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M12 10.5v5M9.5 13h5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 8h9M18 8h2M4 16h2M11 16h9" />
      <circle cx="15.5" cy="8" r="2" />
      <circle cx="8.5" cy="16" r="2" />
    </>
  ),
  text: <path d="M4 6h16M4 11h16M4 16h9" />,
  sort: (
    <>
      <path d="M4 6h9M4 12h6M4 18h3" />
      <path d="M17 5v13M14 15l3 3 3-3" />
    </>
  ),
  dots: (
    <g fill="currentColor" stroke="none">
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </g>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  panelLeft: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </>
  ),
  // Deliberately panelLeft's twin, with the divider down the middle: the two
  // controls do the same kind of thing to the two halves of the window, so they
  // should read as a pair rather than as unrelated icons.
  splitView: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3v18" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h13l-3 4 3 4H5" />
    </>
  ),
  listBullet: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <g fill="currentColor" stroke="none">
        <circle cx="4.5" cy="6" r="1.4" />
        <circle cx="4.5" cy="12" r="1.4" />
        <circle cx="4.5" cy="18" r="1.4" />
      </g>
    </>
  ),
  // The numerals are drawn as strokes rather than <text>, so they scale with the
  // icon and never pick up the app font's metrics.
  listNumber: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M3.6 4.6l1.3-.6V8" />
      <path d="M3.3 10.6a1.4 1.4 0 1 1 2.2 1.7L3.3 14.6h2.4" />
      <path d="M3.4 16.4h2.3l-1.4 1.6a1.3 1.3 0 1 1-1 2" />
    </>
  ),
  listCheck: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M3 6.2l1.4 1.4L7 5" />
      <path d="M3 12.2l1.4 1.4L7 11" />
      <path d="M3 18.2l1.4 1.4L7 17" />
    </>
  ),
  quote: (
    <>
      <path d="M4 5v14" strokeWidth={2.4} />
      <path d="M9 8h11M9 12h11M9 16h7" />
    </>
  ),
  code: <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />,
  codeBlock: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7l-1.3 1.3" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.3-1.3" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z" />
      <path d="M19 18v3H6.5A2.5 2.5 0 0 1 4 18.5" />
    </>
  ),
  // A note-to-note link: the double brackets it writes, drawn as brackets rather
  // than as another chain — the chain is `link`, which points out to the web, and
  // the two must not read as the same command.
  noteLink: (
    <>
      <path d="M9 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H9" />
      <path d="M15 5h2.5A1.5 1.5 0 0 1 19 6.5v11a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M10.5 15l3-6" />
    </>
  ),
  // A set of equal presets — deliberately NOT a vertical rail, which is the
  // shape of the removed spaces feature (see CLAUDE.md).
  spaces: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </>
  ),
  library: (
    <>
      <path d="M4 4h4v16H4zM10 4h4v16h-4z" />
      <path d="M16.5 5.2l3.3.9-3.6 13.4-3.3-.9" />
    </>
  ),
  rule: <path d="M3 12h18" />,
  table: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M12 10v9" />
    </>
  )
}

/** The bin is its own component, not a PATHS entry: the lid is a separate <g> so
 *  CSS can hinge it open (see .bin-lid in app.css) — the visual cue that
 *  something just went in. Ported from legacy/src/App.jsx:51-60. */
export function BinIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <g className="bin-lid">
        <path d="M4 7h16" />
        <path d="M9.5 7V5.6A1.6 1.6 0 0 1 11 4h2a1.6 1.6 0 0 1 1.5 1.6V7" />
      </g>
      <path d="M6.2 9l.6 10.1a1.6 1.6 0 0 0 1.6 1.5h7.2a1.6 1.6 0 0 0 1.6-1.5L17.8 9" />
    </svg>
  )
}

/** Same hinge trick as `BinIcon` (see .archive-lid in app.css), so the archive
 *  chest's lid pops open on the same cue: a note just landed in it. */
export function ArchiveIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <g className="archive-lid">
        <path d="M3 5h18v4H3z" />
      </g>
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
      <path d="M10 13h4" />
    </svg>
  )
}

interface Props {
  name: IconName
  className?: string
  /** overrides the CSS-driven size when set (px) */
  size?: number
}

export function Icon({ name, className, size }: Props): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
