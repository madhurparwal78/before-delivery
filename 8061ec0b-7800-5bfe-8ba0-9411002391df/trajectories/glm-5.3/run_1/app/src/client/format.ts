// Store time-zone formatting, shared by every screen. The browser's own
// zone and clock play no part.
const TZ = "America/Chicago";

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(frac).padStart(2, "0")}`;
}

export function formatTaxPercent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const frac = basisPoints % 100;
  return `${whole}.${String(frac).padStart(2, "0")}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatDateShort(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const zone = zoneAbbreviation(date);
  return `${datePart}, ${timePart} ${zone}`;
}

function zoneAbbreviation(date: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

export function parseCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac] = trimmed.split(".");
  const cents = Number(whole) * 100 + (frac ? Number(frac.padEnd(2, "0")) : 0);
  return Number.isFinite(cents) ? cents : null;
}

export function parsePercentToBp(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac] = trimmed.split(".");
  const bp = Number(whole) * 100 + (frac ? Number(frac.padEnd(2, "0")) : 0);
  return Number.isFinite(bp) ? bp : null;
}

export function moneyInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
