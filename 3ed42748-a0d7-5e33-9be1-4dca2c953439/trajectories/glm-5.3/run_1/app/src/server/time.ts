// ISO 8601 UTC with Z and exactly three fractional-second digits — the only time format the API returns.
const PAD = (n: number, w = 2) => String(n).padStart(w, "0");

export function isoNow(): string {
  return isoFromMs(Date.now());
}

export function isoFromMs(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${PAD(d.getUTCMonth() + 1)}-${PAD(d.getUTCDate())}` +
    `T${PAD(d.getUTCHours())}:${PAD(d.getUTCMinutes())}:${PAD(d.getUTCSeconds())}` +
    `.${PAD(d.getUTCMilliseconds(), 3)}Z`
  );
}

export function isoFromPgDate(v: Date): string {
  return isoFromMs(v.getTime());
}

/** Parse an ISO 8601 instant with an explicit offset or Z. Returns null when absent or malformed. */
export function parseIsoInstant(s: string): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec, frac, off] = m;
  const ms = frac ? Number((frac + "000").slice(0, 3)) : 0;
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec ?? 0), ms);
  let offset = 0;
  if (off !== "Z") {
    const oh = Number(off.slice(1, 3));
    const om = Number(off.slice(-2));
    offset = (oh * 60 + om) * 60_000 * (off[0] === "+" ? 1 : -1);
  }
  return base - offset;
}
