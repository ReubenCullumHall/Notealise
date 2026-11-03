import { Select, SettingRow } from './primitives'
import type { AppSettings } from './model'
import { VERSION_EVERY, type VersionEveryId } from '../../../shared/noteVersions'

// Settings → Data → Earlier versions: how often a copy of a note is kept. The
// keeping is main/noteVersions.ts; looking back is the "Earlier versions…" box
// (history/EarlierVersions.tsx). Whole-vault, not per space — it is about keeping
// notes safe, not how a set of them looks. Plan: docs/plans/note-versions.md.

interface Props {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}

export function NoteVersions({ settings, onChange }: Props): React.JSX.Element {
  return (
    <>
      <h3 className="accent-heading font-display text-[15px] font-semibold">Earlier versions</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        A copy of each note is kept as you work, so you can see how it was and take back anything
        you deleted. To look back, right-click a note or its tab and choose Earlier versions&hellip;
      </p>

      <SettingRow title="Keep a copy" desc="When a copy of a note is kept.">
        <Select
          value={settings.versionEvery}
          options={VERSION_EVERY}
          onChange={(v) => onChange({ versionEvery: v as VersionEveryId })}
        />
      </SettingRow>
      <p className="-mt-1.5 px-1 pb-1 text-[11.5px] leading-relaxed text-ink-400">
        Whichever you choose, a copy is also kept straight away before you delete a sentence or
        more, and the first time a note changes. Copies are kept for 30 days — every one for a
        week, then one a day — in a hidden folder inside your notes folder.
      </p>
    </>
  )
}
