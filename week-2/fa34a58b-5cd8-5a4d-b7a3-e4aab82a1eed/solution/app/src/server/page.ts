// The six page routes share one HTML shell; the browser code draws the page named in data-page.

import { parseDate, type HouseholdZone } from "../shared/zone.ts";

const AT_RE = /^(\d{2}):(\d{2})([+-]\d{2}:\d{2})?$/;

/**
 * The full plan address `/plan?day=YYYY-MM-DD&at=HH:MM±HH:MM` for a request's query. Missing or
 * unparseable values mean the hub's now.
 */
export function planAddress(query: URLSearchParams, zone: HouseholdZone, now: number): string {
  const day = parseDate(query.get("day"));
  const at = AT_RE.exec((query.get("at") ?? "").replace(/ /g, "+"));
  const end = at && at[1] === "24" && at[2] === "00";
  const valid = day && at && (end || (Number(at[1]) <= 23 && Number(at[2]) <= 59));
  if (!valid || !day || !at) return `/plan?day=${zone.day(now)}&at=${zone.clock(now)}${zone.offsetText(now)}`;
  if (end) return `/plan?day=${day}&at=24:00${zone.offsetText(zone.dayEnd(day))}`;
  const instant = zone.addressInstant(day, Number(at[1]), Number(at[2]), at[3] ?? null);
  return `/plan?day=${day}&at=${zone.clock(instant)}${zone.offsetText(instant)}`;
}

export const PAGES = [
  { path: "/plan", name: "plan", title: "Plan" },
  { path: "/schedules", name: "schedules", title: "Schedules" },
  { path: "/scenes", name: "scenes", title: "Scenes" },
  { path: "/guests", name: "guests", title: "Guests" },
  { path: "/log", name: "log", title: "Day log" },
  { path: "/notices", name: "notices", title: "Notices" },
] as const;

type Page = (typeof PAGES)[number];

const FONTS = [
  "space-grotesk-latin-600-normal",
  "ibm-plex-sans-latin-400-normal",
  "jetbrains-mono-latin-500-normal",
];

const escapeAttr = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The shell; on /plan it carries the full address the browser writes into the address bar at once. */
export function pageHtml(page: Page, address: string | null): string {
  const preloads = FONTS.map(
    (font) => `<link rel="preload" href="/assets/fonts/${font}.woff2" as="font" type="font/woff2" crossorigin>`,
  ).join("");
  return `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0A1222">
<title>${page.title} · Gablework Nightplan</title>
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
${preloads}
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body data-page="${page.name}"${address ? ` data-address="${escapeAttr(address)}"` : ""}>
<noscript><p class="noscript">Nightplan needs JavaScript to draw the plan.</p></noscript>
</body>
</html>
`;
}
