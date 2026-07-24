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
  dots: (
    <g fill="currentColor" stroke="none">
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </g>
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
