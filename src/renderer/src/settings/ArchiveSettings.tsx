import { inArchive, withSpacePatch, type AppSettings, type Space } from '../../../shared/settings'
import { ArchiveIcon } from '../icons'
import { SettingRow } from './primitives'
import { SpaceForm } from './SpaceForm'
import type { SpaceActions } from './Spaces'
import type { FontLibrary } from './useInstalledFonts'

// Settings → Archive (Reuben, 2026-10-08): the archive "should register as a
// space, but have its own area in the customisation tab under 'archive' … make
// sure it's separate from main space customisation".
//
// So: the SAME form every space has (`SpaceForm`, one component — the settings
// rule), bound to `settings.archive` instead of a space. Separate in every way
// that matters: it is not a tab on the Spaces page, Look → Every space never
// writes to it, presets are not mirrored from it, and it can't be renamed or
// deleted here. The plan is to cut and add archive-only settings later; they go
// in this file, not in SpaceForm, unless a space should have them too.

interface Props {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
  actions: SpaceActions
  fontLibrary: FontLibrary
}

export function ArchiveSettings({ settings, onChange, actions, fontLibrary }: Props): React.JSX.Element {
  const archive = settings.archive
  const here = inArchive(settings)
  const patch = (p: Partial<Space>): void => onChange(withSpacePatch(settings, archive.folder, p))

  return (
    <>
      <section className="settings-group">
        <h3>Archive</h3>
        <p className="hint">
          Long-term storage for notes you have finished with. It is a folder in your vault, so Finder and
          other apps see it like any other, and it has a look of its own. Put back returns a note to
          the folder it came from.
        </p>

        <SettingRow
          title="Folder"
          desc="The archive always lives in this folder at the top of your vault, so it can't be renamed."
        >
          <span className="flex items-center gap-1.5 rounded-lg bg-ink-300/10 px-2.5 py-1 text-[12px] font-medium text-ink-600 ring-1 ring-ink-300/25">
            <span className="text-accent-500">
              <ArchiveIcon className="h-3.5 w-3.5" />
            </span>
            {archive.folder}
          </span>
        </SettingRow>
        <div className="border-t border-ink-300/15" />

        <SettingRow
          title={here ? 'You are in the archive' : 'See it as you change it'}
          desc={
            here
              ? 'Changes below show behind this window as you make them.'
              : 'Open the archive and the changes below show behind this window as you make them.'
          }
        >
          {!here && (
            <button className="mini" onClick={() => void actions.onOpenArchive()}>
              Open the archive
            </button>
          )}
        </SettingRow>
      </section>

      {/* The same form as Spaces and Look → Every space. Only where the change
          lands differs: here, the archive alone. */}
      <div>
        <p className="mb-5 px-1 text-[11.5px] leading-relaxed text-ink-400">
          These belong to the archive alone. They are the same settings a space has, and{' '}
          <span className="font-medium text-ink-500">Look → Every space</span> never changes them.
        </p>
        <SpaceForm
          space={archive}
          onChange={patch}
          onColorExisting={() => actions.onColorExistingFolders([archive.folder])}
          fontLibrary={fontLibrary}
          collection={{ pageLooks: settings.pageLookLibrary, tints: settings.tintLibrary }}
        />
      </div>
    </>
  )
}
