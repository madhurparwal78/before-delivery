import { counted, raw, type CountNoun, type Lang, type MsgKey, LOCALES, CURRENCY_WORDS } from "./messages.js";
import { DECIMALS, type CurrencyCode } from "./money.js";

export type Formatters = {
  amount(minor: number, cur: CurrencyCode): string;
  date(iso: string, zone: string): string;
  dayMonth(iso: string, zone: string): string;
  weekdayDayMonth(iso: string, zone: string): string;
  monthYear(iso: string, zone: string): string;
  moment(at: Date, zone: string): string;
  num(x: number, digits?: number): string;
};

export function makeFormatters(lang: Lang): Formatters {
  const locale = LOCALES[lang];
  const numFmt = new Intl.NumberFormat(locale, { useGrouping: true });
  const dateCache = new Map<string, Intl.DateTimeFormat>();
  function fmt(zone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = zone + JSON.stringify(opts);
    let f = dateCache.get(key);
    if (!f) {
      f = new Intl.DateTimeFormat(locale, { timeZone: zone, numberingSystem: "latn", ...opts });
      dateCache.set(key, f);
    }
    return f;
  }
  const amountCache = new Map<string, Intl.NumberFormat>();
  function amountFmt(cur: CurrencyCode): Intl.NumberFormat {
    let f = amountCache.get(cur);
    if (!f) {
      f = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: cur,
        currencyDisplay: "narrowSymbol",
        numberingSystem: "latn",
        minimumFractionDigits: DECIMALS[cur],
        maximumFractionDigits: DECIMALS[cur]
      });
      amountCache.set(cur, f);
    }
    return f;
  }
  return {
    amount: (minor, cur) => amountFmt(cur).format(minor / 10 ** DECIMALS[cur]),
    date: (iso, zone) => fmt(zone, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso + "T12:00:00Z")),
    dayMonth: (iso, zone) => fmt(zone, { day: "numeric", month: "long" }).format(new Date(iso + "T12:00:00Z")),
    weekdayDayMonth: (iso, zone) => fmt(zone, { weekday: "long", day: "numeric", month: "long" }).format(new Date(iso + "T12:00:00Z")),
    monthYear: (iso, zone) => fmt(zone, { month: "long", year: "numeric" }).format(new Date(iso + "T12:00:00Z")),
    moment: (at, zone) => fmt(zone, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(at),
    num: (x, digits = 1) => (digits === 1 ? new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, numberingSystem: "latn" }).format(x) : numFmt.format(x))
  };
}

export type MsgParams = {
  n?: number; m?: number; p?: number; a?: string; b?: string; season?: string;
  date?: string; from?: string; to?: string; value?: string; name?: string; code?: string;
  amount?: number; currency?: CurrencyCode; count?: { noun: CountNoun; n: number };
  old?: number; new?: number; iso_date?: string; room?: string; last4?: string; tier?: string;
  zone?: string; property_moment?: string; browser_moment?: string; reason?: string;
  fmt: Formatters;
};

/** Render a published message. Placeholder replacement follows the published tables. */
export function msg(lang: Lang, key: MsgKey, p: MsgParams): string {
  let s = raw(lang, key);
  const f = p.fmt;
  const rep = (ph: string, v: string) => { s = s.split("{" + ph + "}").join(v); };
  if (p.count) rep("count:" + p.count.noun, counted(lang, p.count.noun, p.count.n));
  if (p.n !== undefined) rep("n", String(p.n));
  if (p.m !== undefined) rep("m", String(p.m));
  if (p.p !== undefined) rep("p", String(p.p));
  if (p.a !== undefined) rep("a", p.a);
  if (p.season !== undefined) rep("season", p.season);
  if (p.b !== undefined) rep("b", p.b);
  if (p.date) rep("date", p.date);
  if (p.from !== undefined && (key === "import.order" || s.includes("{from} euros"))) rep("from", p.from);
  if (p.to !== undefined && (key === "import.order" || s.includes("{to} euros"))) rep("to", p.to);
  if (p.value !== undefined) rep("value", p.value);
  if (p.name !== undefined) rep("name", p.name);
  if (p.code !== undefined) rep("code", p.code);
  if (p.old !== undefined && p.currency) rep("old", f.amount(p.old, p.currency));
  if (p.new !== undefined && p.currency) rep("new", f.amount(p.new, p.currency));
  if (p.amount !== undefined && p.currency) rep("amount", f.amount(p.amount, p.currency));
  if (p.iso_date) rep("iso date", p.iso_date);
  if (p.room) rep("room", p.room);
  if (p.last4) rep("last4", p.last4);
  if (p.tier) rep("tier", p.tier);
  if (p.zone) rep("zone", p.zone);
  if (p.property_moment) rep("moment in property zone", p.property_moment);
  if (p.browser_moment) rep("moment in browser zone", p.browser_moment);
  if (p.reason) rep("reason", p.reason);
  if (p.currency) rep("currency words", CURRENCY_WORDS[lang][p.currency]);
  return s;
}
