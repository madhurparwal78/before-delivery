// Every published bilingual string. Server copy table: messages by code, field
// messages, email bodies, and locale formatting helpers.
import { type Locale } from "./catalog.js";

export type { Locale };

/** Format cents in the locale's money format. */
export function formatMoney(cents: number, locale: Locale): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const frac = abs % 100;
  if (locale === "fr-CA") {
    const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
    const s = `${grouped},${frac < 10 ? `0${frac}` : frac}\u00A0$`;
    return negative ? `-${s}` : s;
  }
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const s = `$${grouped}.${frac < 10 ? `0${frac}` : frac}`;
  return negative ? `-${s}` : s;
}

const NBSP = "\u00A0";

/** Long date format: "November 30, 2026" / "30 novembre 2026". */
export function formatLongDate(date: string, locale: Locale): string {
  const [y, mS, dS] = date.split("-");
  const d = Number(dS);
  const month = monthName(Number(mS), locale);
  if (locale === "fr-CA") {
    return `${d === 1 ? "1er" : d} ${month} ${y}`;
  }
  return `${month} ${d}, ${y}`;
}

/** Drop-time format from local fields (YYYY-MM-DDTHH:MM). */
export function formatDropTime(local: string, locale: Locale): string {
  const [date, time] = local.split("T");
  const [y, mS, dS] = date.split("-");
  const d = Number(dS);
  const [hS, miS] = time.split(":");
  const h = Number(hS);
  if (locale === "fr-CA") {
    const wd = weekdayName(date, true);
    return `${wd} ${d === 1 ? "1er" : d} ${monthName(Number(mS), "fr-CA")} ${y} à ${h}${NBSP}h${NBSP}${miS} (heure de Toronto)`;
  }
  const wd = weekdayName(date, false);
  return `${wd}, ${monthName(Number(mS), "en-CA")} ${d}, ${y} at ${h}:${miS} (Toronto time)`;
}

function monthName(month: number, locale: Locale): string {
  const en = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const fr = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  return locale === "fr-CA" ? fr[month - 1] : en[month - 1];
}

function weekdayName(date: string, lowercase: boolean): string {
  const d = new Date(`${date}T12:00:00Z`);
  const en = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const fr = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const idx = d.getUTCDay();
  const name = fr[idx];
  return lowercase ? name : en[idx];
}

/** Hour-minute for Toronto clock times in copy: "14:00" / "14 h 00" handled by callers. */
export function formatCutoff(hhmm: string, locale: Locale): string {
  if (locale === "fr-CA") {
    const [h, m] = hhmm.split(":");
    return `${h}${NBSP}h${NBSP}${m}`;
  }
  return hhmm;
}

/** Rate display: "9.975%" / "9,975 %". */
export function formatRate(rateLabel: string, locale: Locale): string {
  if (locale === "fr-CA") {
    return rateLabel.replace("%", `${NBSP}%`).replace(".", ",");
  }
  return rateLabel;
}

/** Tax code display: GST / TPS, QST / TVQ, HST / TVH. */
export function formatTaxCode(code: "GST" | "QST" | "HST", locale: Locale): string {
  if (locale === "fr-CA") {
    return code === "GST" ? "TPS" : code === "QST" ? "TVQ" : "TVH";
  }
  return code;
}

/** m:ss countdown text. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${rest < 10 ? `0${rest}` : rest}`;
}

/** Time as H:MM Toronto clock for emails: "10:00". */
export function clockFromLocalMinute(local: string): string {
  const t = local.split("T")[1] ?? "00:00";
  return t;
}
