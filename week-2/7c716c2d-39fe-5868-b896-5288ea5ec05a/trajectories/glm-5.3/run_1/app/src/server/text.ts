/** Unicode code-point length, matching every length limit in the brief. */
export function codePointLength(value: string): number {
  let n = 0;
  for (const _ of value) n++;
  return n;
}

export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/** Text that cannot be stored as submitted: U+0000 or an unpaired surrogate. */
export function isUnstorableText(value: string): boolean {
  if (value.includes("\u0000")) return true;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      const prev = value.charCodeAt(i - 1);
      if (!(prev >= 0xd800 && prev <= 0xdbff)) return true;
    }
  }
  return false;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real date typed as YYYY-MM-DD. */
export function parseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return value;
}

export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  const dt = new Date(Date.UTC(Number(m![1]), Number(m![2]) - 1, Number(m![3])));
  dt.setUTCDate(dt.getUTCDate() + days);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export function daysBetween(a: string, b: string): number {
  const ma = DATE_RE.exec(a)!;
  const mb = DATE_RE.exec(b)!;
  const ta = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
  const tb = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
  return Math.round((tb - ta) / 86400000);
}

/** ISO weekday: Monday is 1. */
export function weekdayOf(date: string): number {
  const m = DATE_RE.exec(date)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return ((d.getUTCDay() + 6) % 7) + 1;
}
