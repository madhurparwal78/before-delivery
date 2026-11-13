// The desk formats shared by the server's copy (field messages, notices, statements) and the browser.
// Every input is an integer held as a bigint or a base-10 integer string; nothing passes through floating point.

export const NNBSP = "\u202f";
const MINUS = "\u2212";
const PRICE_DECIMALS = 8;

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

/** Split a non-negative integer string at `decimals` places: ["7877", "529600"]. */
function splitMinor(minor: string, decimals: number): [string, string] {
  const padded = minor.padStart(decimals + 1, "0");
  return [padded.slice(0, padded.length - decimals), padded.slice(padded.length - decimals)];
}

/** Desk form of an amount: grouped integer part, a comma, exactly the asset's decimals, U+2212 for negatives. */
export function displayAmount(minor: bigint | string, decimals: number): string {
  const text = minor.toString();
  const negative = text.startsWith("-");
  const [whole, fraction] = splitMinor(negative ? text.slice(1) : text, decimals);
  return `${negative ? MINUS : ""}${groupThousands(whole)}${decimals === 0 ? "" : `,${fraction}`}`;
}

/** A signed amount as statement legs show it: positive amounts start with `+`. */
export function displaySigned(minor: bigint | string, decimals: number): string {
  return `${BigInt(minor) > 0n ? "+" : ""}${displayAmount(minor, decimals)}`;
}

/** Share counts in desk format with no decimals. */
export function displayShares(shares: bigint | string): string {
  return displayAmount(shares, 0);
}

/** Price units of a plain price string such as `64000.00000000` (at most 8 decimals). */
export function priceUnits(plain: string): bigint {
  const [whole = "0", fraction = ""] = plain.split(".");
  return BigInt(whole) * 10n ** BigInt(PRICE_DECIMALS) + BigInt(fraction.padEnd(PRICE_DECIMALS, "0"));
}

/** The API's price form with exactly 8 decimals, e.g. `56000.00000000`. */
export function plainPrice(units: bigint | string): string {
  const [whole, fraction] = splitMinor(units.toString(), PRICE_DECIMALS);
  return `${whole}.${fraction}`;
}

/** Desk form of a price, e.g. `$56 000,00000000`. Accepts price units or the API's plain string. */
export function displayPrice(price: bigint | string): string {
  const units = typeof price === "bigint" ? price : priceUnits(price);
  return `$${displayAmount(units, PRICE_DECIMALS)}`;
}

/** Basis points as a two-decimal percentage number with a comma, e.g. 1005 → `10,05`. */
export function bpsPercent(bps: number): string {
  const digits = String(bps).padStart(3, "0");
  return `${digits.slice(0, -2)},${digits.slice(-2)}`;
}

/** A health factor string from the API (`1.1250`) in desk format, `No debt` for null. */
export function displayHealth(hf: string | null): string {
  return hf === null ? "No debt" : hf.replace(".", ",");
}

/** A twelve-decimal share price from the API in desk format. */
export function displaySharePrice(price: string): string {
  return price.replace(".", ",");
}

/** Durations as `m:ss`; minutes may exceed 59. */
export function displayDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Seconds as an ISO 8601 duration using only H, M and S, zero parts left out: `PT1M30S`, `PT0S`. */
export function isoDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const text = `${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}${rest ? `${rest}S` : ""}`;
  return `PT${text || "0S"}`;
}

/** The seconds in an ISO 8601 duration written by `isoDuration`. */
export function secondsOfIso(duration: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
  return Number(match?.[1] ?? 0) * 3600 + Number(match?.[2] ?? 0) * 60 + Number(match?.[3] ?? 0);
}

/** The shock in tenths of a percent as the desk shows it: `−12,5`, `+5,0`, `0,0`. */
export function displayShock(tenths: number): string {
  const sign = tenths < 0 ? MINUS : tenths > 0 ? "+" : "";
  const abs = Math.abs(tenths);
  return `${sign}${Math.floor(abs / 10)},${abs % 10}`;
}

// ---- desk time ----

interface WallParts {
  date: string;
  time: string;
  abbreviation: string;
  /** The wall clock read as if it were UTC, in milliseconds. */
  wallMs: number;
}

function wallParts(instantMs: number, zone: string): WallParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    timeZoneName: "short",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}:${get("second")}`;
  return { date, time, abbreviation: get("timeZoneName"), wallMs: Date.parse(`${date}T${time}Z`) };
}

/** Desk wall time of an API instant: `HH:MM:SS NST`, or with the date `YYYY-MM-DD HH:MM:SS NST`. */
export function deskWall(iso: string, zone: string, withDate: boolean): string {
  const parts = wallParts(Date.parse(iso), zone);
  return `${withDate ? `${parts.date} ` : ""}${parts.time} ${parts.abbreviation}`;
}

/** A desk wall time as the Ledger fields show it: `YYYY-MM-DD HH:MM`. */
export function deskInput(iso: string, zone: string): string {
  const parts = wallParts(Date.parse(iso), zone);
  return `${parts.date} ${parts.time.slice(0, 5)}`;
}

type DeskTimeParse = { ok: true; iso: string } | { ok: false; reason: "format" | "gap" };

/**
 * Reads a typed `YYYY-MM-DD HH:MM` desk wall time as a canonical UTC instant. A time inside a daylight-saving gap
 * is refused; a time inside a fold means the earlier of its two instants.
 */
export function parseDeskTime(typed: string, zone: string): DeskTimeParse {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(typed.trim());
  if (!match) return { ok: false, reason: "format" };
  const [, year, month, day, hour, minute] = match;
  const wallMs = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
  if (Number.isNaN(wallMs) || new Date(wallMs).toISOString().slice(0, 16) !== `${year}-${month}-${day}T${hour}:${minute}`) {
    return { ok: false, reason: "format" };
  }
  const DAY = 86_400_000;
  const offsets = new Set([wallParts(wallMs - DAY, zone).wallMs - (wallMs - DAY), wallParts(wallMs + DAY, zone).wallMs - (wallMs + DAY)]);
  const instants = [...offsets].map((offset) => wallMs - offset).filter((instant) => wallParts(instant, zone).wallMs === wallMs);
  const earliest = Math.min(...instants);
  if (instants.length === 0) return { ok: false, reason: "gap" };
  return { ok: true, iso: new Date(earliest).toISOString().replace(/\.\d{3}Z$/, "Z") };
}
