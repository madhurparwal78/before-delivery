import { ukFields } from "./uktime.js";

export function foldEmail(email: string): string {
  return (email ?? "").toLowerCase().replace(/\s+/g, "");
}

export function foldTelephone(tel: string): string {
  let digits = (tel ?? "").replace(/\D+/g, "");
  if (digits.startsWith("44")) digits = "0" + digits.slice(2);
  return digits;
}

export function foldName(name: string): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

export const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const REF_RE = /^CV-([0123456789ABCDEFGHJKMNPQRSTVWXYZ]{5})$/;

export function makeReference(rng: () => number): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += REF_ALPHABET[Math.floor(rng() * REF_ALPHABET.length)];
  return "CV-" + s;
}

export function isoInstant(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Mon 29 Mar 2027 from a UK-date. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ukLongDate(instant: Date): string {
  const f = ukFields(instant);
  return `${DAYS[instant.getUTCDay() === instant.getUTCDay() ? dayOfWeek(f.y, f.m, f.d) : 0]} ${f.d} ${MONTHS[f.m - 1]} ${f.y}`;
}

function dayOfWeek(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function ukTimeHM(instant: Date): string {
  const f = ukFields(instant);
  return `${String(f.hh).padStart(2, "0")}:${String(f.mm).padStart(2, "0")}`;
}

export function ukDateTimeLong(instant: Date): string {
  return `${ukLongDate(instant)}, ${ukTimeHM(instant)}`;
}

/** DD/MM/YYYY -> YYYY-MM-DD, or null. */
export function parseDDMMYYYY(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((text ?? "").trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  const dim = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d < 1 || d > dim[mo - 1]) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Any user-typed date is DD/MM/YYYY. Server canonical dates are YYYY-MM-DD. */
export function looksLikeIsoDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text ?? "");
}
