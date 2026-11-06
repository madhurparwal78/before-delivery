// Money is handled in whole cents end to end. Hours and percentages in
// hundredths. No floating-point arithmetic on amounts, percentages or hours.

export const centsToMoney = (cents: number): string => (cents / 100).toFixed(2);

export const parseMoney = (raw: unknown): number | null => {
  if (typeof raw !== "string") return null;
  if (!/^\d+\.\d{2}$/.test(raw)) return null;
  const cents = Number(raw.replace(".", ""));
  return cents <= Number.MAX_SAFE_INTEGER ? cents : null;
};

export const formatHours = (hundredths: number): string => (hundredths / 100).toFixed(2);

export const parseHours = (raw: unknown): number | null => {
  if (typeof raw !== "string") return null;
  if (!/^\d+\.\d{2}$/.test(raw)) return null;
  return Number(raw.replace(".", ""));
};

export const formatPercent = (hundredths: number): string => (hundredths / 100).toFixed(2);

// Contact hours: minutes / 60 rounded down to the nearest quarter hour,
// returned in hundredths of an hour.
export const contactHoursHundredths = (minutes: number): number =>
  Math.floor(Math.floor(minutes / 15) * 25);

export const percentHundredths = (raw: unknown): number | null => {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const text = String(raw);
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const parts = text.split(".");
  const whole = Number(parts[0] ?? 0);
  const frac = parts.length === 2 ? Number((parts[1] as string).padEnd(2, "0")) : 0;
  const value = whole * 100 + frac;
  return value <= 10000 ? value : null;
};

// employer share = floor(list price * percent / 100) in cents; learner share is
// the remainder so the two always add up to the list price exactly.
export const employerShareCents = (listPriceCents: number, percentH: number): number =>
  Math.floor((listPriceCents * percentH) / 10000);

export const splitShareCents = (totalCents: number, partCents: number, wholeCents: number): number =>
  wholeCents === 0 ? 0 : Math.floor((totalCents * partCents) / wholeCents);
