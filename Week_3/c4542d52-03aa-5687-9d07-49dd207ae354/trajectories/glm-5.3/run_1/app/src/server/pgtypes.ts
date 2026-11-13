// PostgreSQL returns `date` columns as Date objects in local time and timestamptz
// as UTC Dates. Dates on the register are plain calendar strings (YYYY-MM-DD);
// this normalizer is used everywhere a row is read.

export function dateStr(v: Date | string | null): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const y = v.getFullYear();
  const m = String(v.getMonth() + 1).padStart(2, '0');
  const d = String(v.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function instantStr(v: Date | string | null): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return new Date(v).toISOString();
  return v.toISOString();
}
