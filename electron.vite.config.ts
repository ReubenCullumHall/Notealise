import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite resolves default entries automatically:
//   main    -> src/main/index.ts
//   preload -> src/preload/index.ts
//   renderer-> src/renderer/index.html (root: src/renderer)
// externalizeDepsPlugin keeps node deps (e.g. chokidar) out of the main/preload
// bundles so they load from node_modules at runtime.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      // Apple Notes only exists on macOS, and the release builds each platform
      // on its own runner (.github/workflows/release.yml, matrix.os), so this is
      // a real constant per build. With it false, rollup drops the guarded
      // block in ipc.ts — including the dynamic import inside it — so the
      // module never reaches the Windows bundle at all. A STATIC import would
      // be hoisted and survive; the dynamic one is the whole point.
      __MAC_BUILD__: JSON.stringify(process.platform === 'darwin')
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
