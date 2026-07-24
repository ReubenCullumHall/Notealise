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
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
