// One server clock, truncated to the whole second. With CLOCK_CONTROL enabled it can be set to an instant
// that then advances in real time.
let pinned: { at: number; setAt: number } | null = null;

function nowSeconds(): number {
  const ms = pinned ? pinned.at + (Date.now() - pinned.setAt) : Date.now();
  return Math.floor(ms / 1000);
}

export function now(): Date {
  return new Date(nowSeconds() * 1000);
}

export function setClock(instant: Date | null): void {
  pinned = instant ? { at: instant.getTime(), setAt: Date.now() } : null;
}

export function iso(date: Date): string {
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;

/** Parses an ISO 8601 UTC string ending in Z; null when it is not one. */
export function parseIsoUtc(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = ISO_UTC.exec(value);
  if (!m) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

/** Time offsets of the business rules, in seconds, defined once. */
export const SECONDS = {
  quoteValid: 1_209_600,
  bookingCloses: 3_600,
  bookingCancelEnds: 86_400,
  demoCreditValid: 7_776_000,
  protectionWindow: 2_592_000,
  callbackLead: 7_200,
  callbackHorizon: 2_592_000,
  lookupWindow: 900,
  resetValid: 1_800,
} as const;

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}
