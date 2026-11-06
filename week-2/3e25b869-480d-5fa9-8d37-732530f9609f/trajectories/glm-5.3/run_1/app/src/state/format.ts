// Client formatting: money, dates, drop times, countdowns, per the published formats.
import type { Locale } from "./i18n.js";

const NBSP = "\u00A0";

export function formatMoney(cents: number, locale: Locale): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const frac = abs % 100;
  if (locale === "fr-CA") {
    const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    const s = `${grouped},${frac < 10 ? `0${frac}` : frac}${NBSP}$`;
    return negative ? `-${s}` : s;
  }
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const s = `$${grouped}.${frac < 10 ? `0${frac}` : frac}`;
  return negative ? `-${s}` : s;
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function torontoParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const hour = get("hour");
  return { year: get("year"), month: get("month"), day: get("day"), hour: hour === 24 ? 0 : hour, minute: get("minute") };
}

export function torontoDateOf(date: Date): string {
  const parts = torontoParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Long date format from a YYYY-MM-DD string. */
export function formatLongDate(date: string, locale: Locale): string {
  const [year, monthS, dayS] = date.split("-");
  const day = Number(dayS);
  if (locale === "fr-CA") {
    return `${day === 1 ? "1er" : day} ${MONTHS_FR[Number(monthS) - 1]} ${year}`;
  }
  return `${MONTHS_EN[Number(monthS) - 1]} ${day}, ${year}`;
}

/** Drop-time format from a local YYYY-MM-DDTHH:MM value. */
export function formatDropTime(local: string, locale: Locale): string {
  const [date, time] = local.split("T");
  const [year, monthS, dayS] = date.split("-");
  const day = Number(dayS);
  const [hourS, minute] = time.split(":");
  const hour = String(Number(hourS));
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (locale === "fr-CA") {
    return `${WEEKDAYS_FR[weekday]} ${day === 1 ? "1er" : day} ${MONTHS_FR[Number(monthS) - 1]} ${year} à ${hour}${NBSP}h${NBSP}${minute} (heure de Toronto)`;
  }
  return `${WEEKDAYS_EN[weekday]}, ${MONTHS_EN[Number(monthS) - 1]} ${day}, ${year} at ${hour}:${minute} (Toronto time)`;
}

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${rest < 10 ? `0${rest}` : rest}`;
}

export function formatCutoff(hhmm: string, locale: Locale): string {
  if (locale === "fr-CA") {
    const [h, m] = hhmm.split(":");
    return `${h}${NBSP}h${NBSP}${m}`;
  }
  return hhmm;
}

export function formatTaxCode(code: string, locale: Locale): string {
  if (locale === "fr-CA") {
    return code === "GST" ? "TPS" : code === "QST" ? "TVQ" : "TVH";
  }
  return code;
}

export function formatRate(rate: string, locale: Locale): string {
  if (locale === "fr-CA") {
    return rate.replace(".", ",").replace("%", `${NBSP}%`);
  }
  return rate;
}
