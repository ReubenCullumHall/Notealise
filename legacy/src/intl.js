/*
  Date, time and number formatting, driven by the settings page.

  Everything takes an explicit timezone so a note's timestamps read the same
  whichever machine you're on — "system" means follow the browser.
*/

export const DATE_FORMATS = [
  { id: "full", label: "Full date" },
  { id: "short", label: "Short date" },
  { id: "mdy", label: "Month/Day/Year" },
  { id: "dmy", label: "Day/Month/Year" },
  { id: "ymd", label: "Year/Month/Day" },
  { id: "relative", label: "Relative" },
];

export const NUMBER_FORMATS = [
  { id: "default", label: "Default" },
  { id: "comma", label: "1,000,000.00" },
  { id: "dot", label: "1.000.000,00" },
];

const zoneOpt = (tz) => (tz && tz !== "system" ? { timeZone: tz } : {});

export const localZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; }
};

/* The full IANA list where the browser exposes it, a usable handful where it
   doesn't. "system" always leads. */
export function timezones() {
  try {
    const all = Intl.supportedValuesOf("timeZone");
    if (all && all.length) return ["system", ...all];
  } catch { /* older browser */ }
  return ["system", "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin",
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Australia/Sydney"];
}

/* YYYY-MM-DD as seen in that timezone — the basis for "is this the same day?" */
const dayKey = (ms, tz) =>
  new Intl.DateTimeFormat("en-CA", { ...zoneOpt(tz), year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ms));

/* Locale order can't be trusted for the numeric formats, so assemble the parts
   ourselves — Day/Month/Year has to mean exactly that. */
function numeric(ms, order, tz) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...zoneOpt(tz), year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms)).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return order.map((k) => parts[k]).join("/");
}

function relative(ms, tz) {
  const days = Math.round(
    (Date.parse(dayKey(Date.now(), tz)) - Date.parse(dayKey(ms, tz))) / 86400000
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days === -1) return "Tomorrow";
  if (days > 1 && days < 7) return `${days} days ago`;
  if (days >= 7 && days < 31) {
    const w = Math.round(days / 7);
    return `${w} week${w > 1 ? "s" : ""} ago`;
  }
  return null;   // too long ago to be useful — caller falls back to a real date
}

export function formatDate(ms, fmt = "relative", tz = "system") {
  if (!ms) return null;
  if (fmt === "relative") return relative(ms, tz) ?? formatDate(ms, "short", tz);
  if (fmt === "mdy") return numeric(ms, ["month", "day", "year"], tz);
  if (fmt === "dmy") return numeric(ms, ["day", "month", "year"], tz);
  if (fmt === "ymd") return numeric(ms, ["year", "month", "day"], tz);
  const opts = fmt === "short"
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "long", year: "numeric" };
  return new Intl.DateTimeFormat(undefined, { ...zoneOpt(tz), ...opts }).format(new Date(ms));
}

export const formatTime = (ms, tz = "system") =>
  new Intl.DateTimeFormat(undefined, { ...zoneOpt(tz), hour: "2-digit", minute: "2-digit" })
    .format(new Date(ms));

/* Always a real date here, never "Today" — a tooltip is where you go for the
   precise answer. */
export const formatDateTime = (ms, fmt = "full", tz = "system") =>
  ms ? `${formatDate(ms, fmt === "relative" ? "full" : fmt, tz)} at ${formatTime(ms, tz)}` : null;

export function formatNumber(n, fmt = "default") {
  if (typeof n !== "number" || !isFinite(n)) return String(n);
  const locale = fmt === "comma" ? "en-US" : fmt === "dot" ? "de-DE" : undefined;
  return new Intl.NumberFormat(locale).format(n);
}
