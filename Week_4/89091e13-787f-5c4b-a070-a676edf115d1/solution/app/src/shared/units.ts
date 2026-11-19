export const UFERN_PER_FERN = 1_000_000;

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function groupThousands(n: number): string {
  return group(String(n));
}

/** 3999992000 -> "3,999.992000" (amount in the published screen format, without the unit). */
export function formatFern(ufern: number | bigint): string {
  const value = typeof ufern === "bigint" ? ufern : BigInt(Math.trunc(ufern));
  const abs = value < 0n ? -value : value;
  const per = BigInt(UFERN_PER_FERN);
  const fraction = String(abs % per).padStart(6, "0");
  return `${value < 0n ? "-" : ""}${group(String(abs / per))}.${fraction}`;
}

export function formatFernUnit(ufern: number): string {
  return `${formatFern(ufern)} FERN`;
}

/** 6552 -> "0.006552": the machine form used in request bodies and input values. */
export function plainFern(ufern: number): string {
  return `${Math.floor(ufern / UFERN_PER_FERN)}.${String(ufern % UFERN_PER_FERN).padStart(6, "0")}`;
}

/** A decimal FERN string with at most 6 decimals -> exact ufern, however long it is, or null when it is not one. */
export function parseFernExact(text: unknown): bigint | null {
  if (typeof text !== "string") return null;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!match) return null;
  return BigInt(match[1] as string) * BigInt(UFERN_PER_FERN) + BigInt((match[2] ?? "").padEnd(6, "0"));
}

/** As parseFernExact, as a number: an amount beyond the safe integers saturates (it is above any balance, so a limit refuses it). */
export function parseFern(text: unknown): number | null {
  const exact = parseFernExact(text);
  if (exact === null) return null;
  return exact > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(exact);
}

/** numerator / denominator as a percentage with `decimals` places, half away from zero, from exact integers. */
export function percent(numerator: number, denominator: number, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const den = BigInt(denominator);
  if (den === 0n) return decimals === 0 ? "0" : `0.${"0".repeat(decimals)}`;
  const scaled = (BigInt(numerator) * 100n * scale * 2n + den) / (den * 2n);
  const whole = scaled / scale;
  const fraction = String(scaled % scale).padStart(decimals, "0");
  return decimals === 0 ? String(whole) : `${whole}.${fraction}`;
}

function parts(at: Date | string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", ...options }).formatToParts(new Date(at))) {
    out[part.type] = part.value;
  }
  return out;
}

/** "HH:mm:ss", 24-hour, in the display time zone. */
export function formatTime(at: Date | string, timeZone: string): string {
  const p = parts(at, timeZone, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** "6 Nov 2026" in the display time zone. */
export function formatDate(at: Date | string, timeZone: string): string {
  const p = parts(at, timeZone, { day: "numeric", month: "short", year: "numeric" });
  return `${p.day} ${p.month} ${p.year}`;
}

export function formatDateTime(at: Date | string, timeZone: string): string {
  return `${formatDate(at, timeZone)} ${formatTime(at, timeZone)}`;
}

export function pluralBlobs(n: number): string {
  return `${n} ${n === 1 ? "blob" : "blobs"}`;
}
