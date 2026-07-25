// PostCSS for the renderer bundle. electron-vite picks this up automatically —
// nothing is added to electron.vite.config.ts. Tailwind runs at build time, so
// the app stays fully offline (the legacy prototype loaded it from a CDN).
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
}
