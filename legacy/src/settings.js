/*
  Appearance settings — theme and density.

  Both are plain data attributes on <html>; all the actual styling lives in the
  CSS variables in index.css. That keeps this file tiny and means the settings
  survive a switch to the on-disk vault (they're about the app, not the notes).
  index.html reads the same localStorage key before first paint to avoid a
  flash of the wrong theme.
*/
import { DATE_FORMATS, NUMBER_FORMATS } from "./intl.js";

export const SETTINGS_KEY = "vault.settings.v1";

export const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

/* `rows` drives the little preview bars in the settings panel — it mirrors what
   --row-py / --row-title do in CSS so the preview can't drift from reality. */
export const DENSITIES = [
  { id: "large", label: "Large", hint: "Roomy — easy on the eyes", rows: { h: 9, gap: 7 } },
  { id: "cozy", label: "Cozy", hint: "The default", rows: { h: 7, gap: 5 } },
  { id: "compact", label: "Compact", hint: "Tighter rows, still readable", rows: { h: 5, gap: 3 } },
  { id: "ultra", label: "Ultra compact", hint: "One line, no previews", rows: { h: 3, gap: 1 } },
];

/* The settings window's left-hand nav. Adding a section is a matter of adding
   an entry here and a case in the window's body. */
export const STARTUPS = [
  { id: "empty", label: "Start empty", hint: "Open on the blank screen and pick a note." },
  { id: "last", label: "Reopen last note", hint: "Go straight back to whatever you were writing." },
];

export const SECTIONS = [
  { id: "general", label: "General", blurb: "How the app opens." },
  { id: "appearance", label: "Appearance", blurb: "Theme, accent and how tightly the sidebar packs." },
  { id: "arranging", label: "Arranging", blurb: "How notes and folders order themselves." },
  { id: "formatting", label: "Formatting", blurb: "Dates, times and numbers." },
];

/* ---------------------------------------------------------------------------
   Accent
   The whole palette already lives in CSS variables, so an accent is simply a
   regenerated set of ramps written onto <html> as inline custom properties.
   Nothing else in the app has to know it exists.
   --------------------------------------------------------------------------- */
export const ACCENTS = [
  { id: "default", label: "Default", hue: null },
  { id: "red", label: "Red", hue: 6 },
  { id: "orange", label: "Orange", hue: 26 },
  { id: "amber", label: "Amber", hue: 45 },
  { id: "lime", label: "Lime", hue: 96 },
  { id: "green", label: "Green", hue: 150 },
  { id: "teal", label: "Teal", hue: 182 },
  { id: "blue", label: "Blue", hue: 214 },
  { id: "indigo", label: "Indigo", hue: 250 },
  { id: "violet", label: "Violet", hue: 278 },
  { id: "pink", label: "Pink", hue: 328 },
];

/* [saturation, lightness] per token. The brand ramp carries the accent at full
   strength (selection, rings, active states); the ink ramp is only lightly
   tinted, because body text still has to be comfortable to read for hours. */
const RAMP = {
  dark: {
    "--paper": [26, 3.5], "--surface": [20, 9], "--code-bg": [22, 6],
    "--brand-50": [30, 8], "--brand-100": [28, 12], "--brand-200": [26, 17],
    "--brand-300": [24, 30], "--brand-400": [30, 39], "--brand-500": [46, 56],
    "--brand-600": [72, 73], "--brand-700": [80, 81],
    "--ink-900": [13, 86], "--ink-800": [12, 80], "--ink-700": [11, 73],
    "--ink-600": [10, 65], "--ink-500": [9, 56], "--ink-400": [9, 47], "--ink-300": [8, 39],
  },
  light: {
    "--paper": [34, 97.5], "--surface": [30, 99.6], "--code-bg": [28, 95],
    "--brand-50": [42, 95], "--brand-100": [40, 91], "--brand-200": [36, 85],
    "--brand-300": [30, 70], "--brand-400": [38, 54], "--brand-500": [46, 42],
    "--brand-600": [60, 25], "--brand-700": [66, 17],
    "--ink-900": [16, 12], "--ink-800": [15, 18], "--ink-700": [13, 28],
    "--ink-600": [12, 38], "--ink-500": [11, 47], "--ink-400": [10, 57], "--ink-300": [10, 66],
  },
};

/* Text mode recolours only the ink ramp, and properly — this *is* the text
   colour, so it carries real saturation rather than a hint of one. Surfaces and
   controls are left alone entirely. */
const TEXT_RAMP = {
  dark: {
    "--ink-900": [56, 82], "--ink-800": [52, 76], "--ink-700": [48, 70],
    "--ink-600": [44, 62], "--ink-500": [40, 54], "--ink-400": [36, 46], "--ink-300": [32, 39],
  },
  light: {
    "--ink-900": [62, 26], "--ink-800": [58, 31], "--ink-700": [52, 38],
    "--ink-600": [46, 45], "--ink-500": [40, 52], "--ink-400": [34, 60], "--ink-300": [30, 68],
  },
};

export const ACCENT_MODES = [
  { id: "text", label: "Text only", hint: "Just the writing takes the colour." },
  { id: "tint", label: "Tinted", hint: "Surfaces and controls take it too." },
];

/* Only meaningful in tint mode. Sidebar scope writes the variables onto the
   <aside> instead of <html>, so the CSS cascade does the containment. */
export const ACCENT_SCOPES = [
  { id: "sidebar", label: "Sidebar", hint: "Only the sidebar is tinted." },
  { id: "app", label: "Whole app", hint: "Every surface, editor included." },
];

const ALL_KEYS = [...new Set([...Object.keys(RAMP.dark), ...Object.keys(TEXT_RAMP.dark)])];

/* HSL -> the bare "R G B" channels the variables expect */
function channels(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)).join(" ");
}

/* `el` is whatever should carry the accent — <html> for everything, or the
   sidebar element to keep a tint contained. `active: false` (or the Default
   accent) clears the lot, which on a child element means falling back to
   whatever it inherits. Every call clears first, so switching mode can't leave
   variables behind from the previous one. */
export function applyAccent(el, { accent, mode, theme, active }) {
  if (!el) return;
  ALL_KEYS.forEach((k) => el.style.removeProperty(k));
  const hue = (ACCENTS.find((a) => a.id === accent) || {}).hue;
  if (!active || hue == null) return;
  const t = theme === "light" ? "light" : "dark";
  const ramp = mode === "text" ? TEXT_RAMP[t] : RAMP[t];
  Object.entries(ramp).forEach(([k, [s, l]]) => el.style.setProperty(k, channels(hue, s, l)));
}

/* Archive ordering is a *view*, never a rewrite of each item's stored order —
   sorting the archive A–Z must not change the order things come back in when
   they are restored. */
export const ARCHIVE_SORTS = [
  { id: "recent", label: "Recently archived", short: "Recent" },
  { id: "oldest", label: "Oldest first", short: "Oldest" },
  { id: "az", label: "Title A–Z", short: "A–Z" },
  { id: "za", label: "Title Z–A", short: "Z–A" },
];

/* freeArrange off = folders group at the top of each level, notes below (the
   familiar default). On = one shared order, so they can be interleaved freely.
   Only the *rendering* differs: order is stored in a single sequence either way,
   so toggling this never scrambles anything. */
export const DEFAULTS = {
  theme: "dark", density: "cozy",
  accent: "default", accentMode: "text", accentScope: "sidebar",
  archiveSort: "recent", freeArrange: false,
  startup: "empty", dateFormat: "relative", numberFormat: "default", timezone: "system",
};

const oneOf = (list, v) => list.some((x) => x.id === v);

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    return {
      theme: oneOf(THEMES, s.theme) ? s.theme : DEFAULTS.theme,
      density: oneOf(DENSITIES, s.density) ? s.density : DEFAULTS.density,
      accent: oneOf(ACCENTS, s.accent) ? s.accent : DEFAULTS.accent,
      accentMode: oneOf(ACCENT_MODES, s.accentMode) ? s.accentMode : DEFAULTS.accentMode,
      accentScope: oneOf(ACCENT_SCOPES, s.accentScope) ? s.accentScope : DEFAULTS.accentScope,
      archiveSort: oneOf(ARCHIVE_SORTS, s.archiveSort) ? s.archiveSort : DEFAULTS.archiveSort,
      freeArrange: typeof s.freeArrange === "boolean" ? s.freeArrange : DEFAULTS.freeArrange,
      startup: oneOf(STARTUPS, s.startup) ? s.startup : DEFAULTS.startup,
      dateFormat: oneOf(DATE_FORMATS, s.dateFormat) ? s.dateFormat : DEFAULTS.dateFormat,
      numberFormat: oneOf(NUMBER_FORMATS, s.numberFormat) ? s.numberFormat : DEFAULTS.numberFormat,
      // any IANA string is legal; the picker only ever offers real ones
      timezone: typeof s.timezone === "string" && s.timezone ? s.timezone : DEFAULTS.timezone,
      lastNoteId: typeof s.lastNoteId === "string" ? s.lastNoteId : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function applySettings(s) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.density = s.density;
  /* Text mode always applies at the root — it's the writing everywhere. A tint
     only reaches the root when its scope is the whole app; a sidebar-scoped
     tint is applied by the sidebar itself. */
  applyAccent(root, {
    accent: s.accent,
    mode: s.accentMode,
    theme: s.theme,
    active: s.accentMode === "text" || s.accentScope === "app",
  });
}
