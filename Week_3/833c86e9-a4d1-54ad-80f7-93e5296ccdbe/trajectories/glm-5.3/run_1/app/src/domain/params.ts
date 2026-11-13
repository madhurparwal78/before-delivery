import { CURRENCIES, type CurrencyCode } from "./money.js";
import { LANGS, type Lang } from "./messages.js";

export type SortKey = "rank" | "price_asc" | "price_desc" | "score_desc" | "distance_asc";
export type Display = "total" | "night";

export const PARAM_ORDER = ["dest", "in", "out", "adults", "ages", "lang", "cur", "display", "tax", "stars", "amen", "free", "min", "max", "sort", "cursor", "zoom", "cx", "cy", "sel"] as const;

export type SearchParams = {
  dest: string;
  in: string | null;
  out: string | null;
  adults: number;
  ages: number[];
  lang: Lang;
  cur: CurrencyCode;
  display: Display;
  tax: boolean;
  stars: number[];
  amen: string[];
  free: boolean;
  min: number | null;
  max: number | null;
  sort: SortKey;
  cursor: string | null;
  zoom: number | null;
  cx: number | null;
  cy: number | null;
  sel: string | null;
};

export type Notice = {
  key: "notice.ignored" | "notice.arrival" | "notice.departure" | "notice.adults" | "notice.age" | "notice.reset" | "notice.swapped";
  name?: string;
  date?: string;
  n?: number;
  value?: string;
};

export const DEFAULTS = {
  adults: 2,
  display: "total" as Display,
  tax: true,
  sort: "rank" as SortKey,
  amenKeys: ["pool", "parking", "wifi", "spa", "pets"],
  starKeys: [3, 4, 5]
};

export const STAR_KEYS = [3, 4, 5];
export const AMEN_KEYS = ["pool", "parking", "wifi", "spa", "pets"];

export const SORT_KEYS: SortKey[] = ["rank", "price_asc", "price_desc", "score_desc", "distance_asc"];
export const DISPLAY_KEYS: Display[] = ["total", "night"];

function parseList(v: string | null): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

function sortedUniqueNums(v: string | null): number[] {
  const out = new Set<number>();
  for (const s of parseList(v)) {
    const n = Number(s);
    if (Number.isInteger(n)) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export type NormaliseInput = {
  /** stored caller values used when lang or cur is absent or unknown */
  storedLang: Lang;
  storedCur: CurrencyCode;
  /** property-local today in the destination's zone, for date normalisation */
  today: string;
};

/**
 * Normalise a raw query string into the canonical link form, applying the published
 * rules in order and returning one notice per rule applied.
 */
export function normaliseQuery(raw: URLSearchParams, input: NormaliseInput): { canonical: URLSearchParams; notices: Notice[]; params: SearchParams } {
  const q = new URLSearchParams();
  const notices: Notice[] = [];
  const seen = new Set<string>();
  const unknown = new Set<string>();
  for (const [k] of raw) {
    if (!(PARAM_ORDER as readonly string[]).includes(k)) unknown.add(k);
    seen.add(k);
  }
  for (const name of [...unknown].sort()) notices.push({ key: "notice.ignored", name });

  // in
  let inDate = raw.get("in");
  if (!inDate || !/^\d{4}-\d{2}-\d{2}$/.test(inDate) || inDate < input.today) {
    inDate = input.today;
    notices.push({ key: "notice.arrival", date: input.today });
  }
  // out
  let outDate = raw.get("out");
  const nightsOut = outDate && /^\d{4}-\d{2}-\d{2}$/.test(outDate) ? Math.round((Date.parse(outDate) - Date.parse(inDate)) / 86400000) : -1;
  if (outDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(outDate) || nightsOut <= 0 || nightsOut > 30) {
    const d = new Date(inDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    outDate = d.toISOString().slice(0, 10);
    notices.push({ key: "notice.departure", date: outDate });
  }
  // adults
  let adults = raw.get("adults");
  let adultsN = adults === null ? DEFAULTS.adults : Number(adults);
  if (adults !== null && (!Number.isInteger(adultsN) || adultsN < 1 || adultsN > 16)) {
    adultsN = adultsN < 1 ? 1 : 16;
    notices.push({ key: "notice.adults", n: adultsN });
  }
  // ages
  const ages: number[] = [];
  const rawAges = raw.get("ages");
  if (rawAges !== null) {
    for (const s of parseList(rawAges)) {
      const n = Number(s);
      if (Number.isInteger(n) && n >= 0 && n <= 17) ages.push(n);
      else notices.push({ key: "notice.age", value: s });
    }
  }
  // lang / cur
  let lang = raw.get("lang");
  if (!lang || !LANGS.includes(lang as Lang)) {
    notices.push({ key: "notice.reset", name: "lang" });
    lang = input.storedLang;
  }
  let cur = raw.get("cur");
  if (!cur || !CURRENCIES.includes(cur as CurrencyCode)) {
    notices.push({ key: "notice.reset", name: "cur" });
    cur = input.storedCur;
  }
  // display
  let display = raw.get("display");
  if (display === null) display = DEFAULTS.display;
  else if (!DISPLAY_KEYS.includes(display as Display)) { notices.push({ key: "notice.reset", name: "display" }); display = DEFAULTS.display; }
  // tax
  let tax = raw.get("tax");
  let taxB = true;
  if (tax === "0") taxB = false;
  else if (tax !== null && tax !== "1") { notices.push({ key: "notice.reset", name: "tax" }); }
  // stars
  const stars = sortedUniqueNums(raw.get("stars")).filter((n) => STAR_KEYS.includes(n)).sort((a, b) => a - b);
  // amen
  const amen = parseList(raw.get("amen")).filter((a) => AMEN_KEYS.includes(a)).sort();
  // free
  const free = raw.get("free") === "1";
  // min / max
  let min = raw.get("min");
  let max = raw.get("max");
  let minN: number | null = min === null ? null : Number(min);
  let maxN: number | null = max === null ? null : Number(max);
  if (minN !== null && !Number.isFinite(minN)) minN = null;
  if (maxN !== null && !Number.isFinite(maxN)) maxN = null;
  if (minN !== null && maxN !== null && minN > maxN) {
    const t = minN; minN = maxN; maxN = t;
    notices.push({ key: "notice.swapped" });
  }
  // sort
  let sort = raw.get("sort");
  if (sort === null) sort = DEFAULTS.sort;
  else if (!SORT_KEYS.includes(sort as SortKey)) { notices.push({ key: "notice.reset", name: "sort" }); sort = DEFAULTS.sort; }
  const cursor = raw.get("cursor");
  let zoom: number | null = null, cx: number | null = null, cy: number | null = null;
  if (raw.has("zoom") && raw.has("cx") && raw.has("cy")) {
    const z = Number(raw.get("zoom")), x = Number(raw.get("cx")), y = Number(raw.get("cy"));
    if (Number.isInteger(z) && z >= 0 && z <= 5 && Number.isFinite(x) && Number.isFinite(y)) {
      zoom = z; cx = Math.round(x * 10) / 10; cy = Math.round(y * 10) / 10;
    }
  }
  const sel = raw.get("sel");

  // canonical order
  q.set("dest", raw.get("dest") ?? "");
  q.set("in", inDate);
  q.set("out", outDate);
  q.set("adults", String(adultsN));
  if (ages.length > 0) q.set("ages", ages.join(","));
  q.set("lang", lang);
  q.set("cur", cur);
  if (display !== "total") q.set("display", display);
  if (!taxB) q.set("tax", "0");
  if (stars.length > 0) q.set("stars", stars.join(","));
  if (amen.length > 0) q.set("amen", amen.join(","));
  if (free) q.set("free", "1");
  if (minN !== null) q.set("min", String(minN));
  if (maxN !== null) q.set("max", String(maxN));
  if (sort !== "rank") q.set("sort", sort);
  if (cursor) q.set("cursor", cursor);
  if (zoom !== null) { q.set("zoom", String(zoom)); q.set("cx", String(cx)); q.set("cy", String(cy)); }
  if (sel) q.set("sel", sel);

  return {
    canonical: q,
    notices,
    params: {
      dest: raw.get("dest") ?? "", in: inDate, out: outDate, adults: adultsN, ages,
      lang: lang as Lang, cur: cur as CurrencyCode,
      display: display as Display, tax: taxB, stars, amen, free,
      min: minN, max: maxN, sort: sort as SortKey, cursor, zoom, cx, cy, sel
    }
  };
}

export function canonicalString(q: URLSearchParams): string {
  const parts: string[] = [];
  for (const key of PARAM_ORDER) {
    const v = q.get(key);
    if (v !== null) parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(v));
  }
  return parts.join("&");
}
