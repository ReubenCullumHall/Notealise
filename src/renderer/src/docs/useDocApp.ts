import { useEffect, useState } from 'react'

/** The app that would edit this document ("Excel"), for its tab's button. Null while
 *  asking, for a kind edited in the tab itself, and when nothing here opens it. */
export function useDocApp(path: string | null): string | null {
  const [app, setApp] = useState<string | null>(null)
  useEffect(() => {
    setApp(null)
    if (!path) return
    let live = true
    window.api.docAppName(path).then(
      (name) => live && setApp(name),
      () => live && setApp(null)
    )
    return () => {
      live = false
    }
  }, [path])
  return app
}
