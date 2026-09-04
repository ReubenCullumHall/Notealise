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
        mono: 'var(--font-mono)',
        // The note's own title (NotePane.tsx) — deliberately separate from
        // `display` (used everywhere else: Settings headers, onboarding,
        // the sidebar's vault name) so the Notes font picker can restyle a
        // note's title without also restyling the app's own chrome around it.
        note: 'var(--note-font-serif)'
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
      },
      /* Corner radius is three ROLES, not a scale — see theme.css's
         "corner radius" block for what each one means and why.

         `control` / `surface` / `pill` are the names to use in new code. The v3
         scale names below are kept as ALIASES onto the same three tokens: there
         were 157 `rounded-*` call sites across 43 files when this landed, and a
         mechanical sweep could not tell which of them meant "button" and which
         meant "popover" — the class name records the old size, not the role. So
         the VALUES collapse here and the call sites keep working. `rounded-lg`,
         `rounded-xl` and `rounded-2xl` all resolve to --r-surface deliberately.

         This is the one place the config knowingly departs from legacy's ported
         scale (see the file header): legacy is reference-only and not built, and
         the v3 pin is about `outline-none` / ring width / shadow names, none of
         which this touches. */
      borderRadius: {
        none: '0px',
        control: 'var(--r-control)',
        surface: 'var(--r-surface)',
        pill: 'var(--r-pill)',
        sm: 'var(--r-control)',
        DEFAULT: 'var(--r-control)',
        md: 'var(--r-control)',
        lg: 'var(--r-surface)',
        xl: 'var(--r-surface)',
        '2xl': 'var(--r-surface)',
        '3xl': 'var(--r-surface)',
        full: 'var(--r-pill)'
      }
    }
  },
  plugins: []
}
