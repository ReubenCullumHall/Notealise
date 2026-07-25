/* Ported verbatim from the legacy prototype's runtime config
   (legacy/index.html) so the two apps generate identical utilities. The legacy
   app ran Tailwind v3 from the Play CDN; this is the same v3, built.

   Every colour is an "R G B" channel triple in a CSS variable (see
   src/renderer/src/theme.css), so swapping [data-theme] on <html> re-skins the
   whole app without touching a single className. The <alpha-value> placeholder
   is what keeps the opacity modifiers (bg-surface/45) working.

   Fonts point at the --font-* variables rather than naming families directly:
   theme.css binds those to the *bundled* woff2 (no Google CDN, unlike legacy). */
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: 'var(--font-serif)',
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)'
      },
      colors: {
        /* monochrome accent: low numbers are the quietest fills and borders,
           500 is the neutral mid used for selection washes, 600/700 are the
           strongest contrast (hover/active only) */
        brand: {
          50: rgb('--brand-50'), 100: rgb('--brand-100'), 200: rgb('--brand-200'),
          300: rgb('--brand-300'), 400: rgb('--brand-400'), 500: rgb('--brand-500'),
          600: rgb('--brand-600'), 700: rgb('--brand-700')
        },
        /* text ramp: 900 is the strongest (never pure black/white), 300 the most muted */
        ink: {
          900: rgb('--ink-900'), 800: rgb('--ink-800'), 700: rgb('--ink-700'),
          600: rgb('--ink-600'), 500: rgb('--ink-500'), 400: rgb('--ink-400'),
          300: rgb('--ink-300')
        },
        paper: rgb('--paper'),
        surface: rgb('--surface'),
        /* Not in legacy: the active space's colour, injected as R G B channels on
           the .app wrapper (see spaces/). Falls back to the brand ramp when no
           space is active, so `bg-accent/12` works either way. */
        accent: {
          DEFAULT: 'rgb(var(--space-accent, var(--brand-500)) / <alpha-value>)',
          soft: 'rgb(var(--space-accent, var(--brand-300)) / <alpha-value>)',
          strong: 'rgb(var(--space-accent, var(--brand-600)) / <alpha-value>)'
        }
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        float: 'var(--shadow-float)'
      }
    }
  },
  plugins: []
}
