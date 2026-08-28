import { useCallback, useEffect, useState } from 'react'
import type { InstalledFont } from '../../../shared/fonts'
import { loadInstalledFont } from './fontLoader'

/** The one place `window.api`'s four font IPC calls are made — Collection.tsx
 *  (the browsable catalogue: preview, download, import your own) and
 *  SpaceFonts.tsx (the per-space picker: only ever shows what's installed)
 *  both need the SAME list, live, so a download in one shows up in the other
 *  without either having to poll or be told to refresh. Called once, in
 *  Settings.tsx's SettingsWindow, and threaded down as a prop — same shape as
 *  `presets`/`presetActions` beside it. */
export interface FontLibrary {
  installed: InstalledFont[]
  /** catalogue ids currently mid-download, for a spinner on that one card */
  downloading: Set<string>
  importing: boolean
  /** id -> the last error message a download for it produced, cleared on
   *  the next attempt. Not shown for `importCustom`, which reports its own
   *  failure inline (see Collection.tsx) rather than by id — there's no card
   *  to attach it to until the import has already succeeded. */
  errors: Record<string, string>
  download: (id: string) => Promise<void>
  importCustom: () => Promise<void>
  remove: (id: string) => Promise<void>
  /** Re-read the whole installed list from main — for when something OTHER
   *  than this hook's own actions changed it, e.g. a Transfer data import. */
  reload: () => Promise<void>
}

export function useInstalledFonts(): FontLibrary {
  const [installed, setInstalled] = useState<InstalledFont[]>([])
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let live = true
    window.api.listInstalledFonts().then((list) => {
      if (live) setInstalled(list)
    })
    return () => {
      live = false
    }
  }, [])

  const addInstalled = useCallback((font: InstalledFont) => {
    setInstalled((list) => [...list.filter((f) => f.id !== font.id), font])
    void loadInstalledFont(font)
  }, [])

  const download = useCallback(
    async (id: string) => {
      setDownloading((s) => new Set(s).add(id))
      setErrors((e) => {
        const { [id]: _drop, ...rest } = e
        return rest
      })
      const res = await window.api.downloadFont(id)
      setDownloading((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      if (res.ok) addInstalled(res.font)
      else setErrors((e) => ({ ...e, [id]: res.error }))
    },
    [addInstalled]
  )

  const importCustom = useCallback(async () => {
    setImporting(true)
    try {
      const res = await window.api.importCustomFont()
      if (res.ok) addInstalled(res.font)
    } finally {
      setImporting(false)
    }
  }, [addInstalled])

  const remove = useCallback(async (id: string) => {
    await window.api.removeCustomFont(id)
    setInstalled((list) => list.filter((f) => f.id !== id))
  }, [])

  const reload = useCallback(async () => {
    const list = await window.api.listInstalledFonts()
    setInstalled(list)
    for (const f of list) void loadInstalledFont(f)
  }, [])

  return { installed, downloading, importing, errors, download, importCustom, remove, reload }
}
