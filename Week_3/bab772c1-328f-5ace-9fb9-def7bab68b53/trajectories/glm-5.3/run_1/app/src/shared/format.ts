// Shared formatting and parsing. The single implementation used by the server,
// the browser and the dossier. No other rounding or parsing path exists for
// these values anywhere in the app.

export const MOON_RADIUS_M = 1_737_400;
export const NMI_M = 1852;
export const FT_M = 0.3048;

export type DistanceUnit = "km" | "nmi";
export type SpeedUnit = "m_s" | "ft_s";

export function roundHalfAwayFromZero(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = Math.pow(10, digits);
  const scaled = value * factor;
  // Normalize binary float noise (e.g. 100.04999999999999 * 10).
  const epsilon = Math.abs(scaled) < 1e15 ? Math.abs(scaled) * 1e-12 : 0;
  const adjusted = scaled + (scaled >= 0 ? epsilon : -epsilon);
  const floor = Math.floor(Math.abs(adjusted));
  const frac = Math.abs(adjusted) - floor;
  let roundedAbs = floor;
  if (frac === 0.5) {
    roundedAbs = floor + 1; // exact half-way rounds away from zero
  } else {
    roundedAbs = Math.round(Math.abs(adjusted));
  }
  const scaledRounded = adjusted < 0 ? -roundedAbs : roundedAbs;
  return scaledRounded / factor;
}

export function formatFixed(value: number, digits: number): string {
  const r = roundHalfAwayFromZero(value, digits);
  if (r === 0) {
    // A result that rounds to zero has no minus sign.
    return (0).toFixed(digits);
  }
  return r.toFixed(digits);
}

export function metresToDistance(metres: number, unit: DistanceUnit): number {
  return unit === "km" ? metres / 1000 : metres / NMI_M;
}

export function metresPerSecToSpeed(mps: number, unit: SpeedUnit): number {
  return unit === "m_s" ? mps : mps / FT_M;
}

export function formatAltitude(metres: number, unit: DistanceUnit): string {
  return `${formatFixed(metresToDistance(metres, unit), 1)} ${unit}`;
}

export function formatSpeed(mps: number, unit: SpeedUnit): string {
  const value = metresPerSecToSpeed(mps, unit);
  return `${Math.round(value)} ${unit === "m_s" ? "m/s" : "ft/s"}`;
}

export function formatLatitude(deg: number): string {
  const hemi = deg < 0 ? "S" : "N";
  return `${formatFixed(Math.abs(deg), 2)}° ${hemi}`;
}

export function formatLongitude(deg: number): string {
  const hemi = deg < 0 ? "W" : "E";
  return `${formatFixed(Math.abs(deg), 2)}° ${hemi}`;
}

// <size>: binary units with one decimal, rounded half away from zero.
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatFixed(bytes / 1024, 1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${formatFixed(bytes / (1024 * 1024), 1)} MiB`;
  return `${formatFixed(bytes / (1024 * 1024 * 1024), 1)} GiB`;
}

// <money>: integer cents written as whole units, two digits.
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${frac < 10 ? "0" : ""}${frac}`;
}

export function formatBalance(cents: number | null): string {
  return cents === null ? "—" : `${formatMoney(cents)} USD`;
}

// ---- ISO instants (YYYY-MM-DDTHH:MM:SSZ) ----

export const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

export function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_RE.test(value)) return false;
  return isoToEpochMs(value) !== null;
}

export function isoToEpochMs(iso: string): number | null {
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function epochMsToIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
  );
}

// ---- GMT day-of-year ----

export const DOY_RE = /^(\d{4})-(\d{3})\/(\d{2}):(\d{2}):(\d{2})$/;

export function isDayOfYear(value: string): boolean {
  return dayOfYearToEpochMs(value) !== null;
}

export function dayOfYearToEpochMs(value: string): number | null {
  const m = DOY_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const doy = Number(m[2]);
  const hour = Number(m[3]);
  const minute = Number(m[4]);
  const second = Number(m[5]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = isLeap ? 366 : 365;
  if (doy < 1 || doy > maxDay) return null;
  return (
    Date.UTC(year, 0, 1) +
    (doy - 1) * 86400000 +
    hour * 3600000 +
    minute * 60000 +
    second * 1000
  );
}

export function epochMsToDayOfYear(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const doy = Math.floor((ms - startOfYear) / 86400000) + 1;
  return (
    `${d.getUTCFullYear()}-${p(doy, 3)}` +
    `/${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

export function isoToDayOfYear(iso: string): string {
  const ms = isoToEpochMs(iso);
  return ms === null ? iso : epochMsToDayOfYear(ms);
}

export function dayOfYearToIso(value: string): string | null {
  const ms = dayOfYearToEpochMs(value);
  return ms === null ? null : epochMsToIso(ms);
}

// ---- MET labels ----

export function formatMetLabel(metSeconds: number): string {
  const sign = metSeconds < 0 ? "T-" : "+";
  const abs = Math.abs(Math.round(metSeconds));
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${sign}${p(days, 3)}:${p(hours)}:${p(minutes)}:${p(seconds)}`;
}

export const MET_LABEL_RE = /^(?:\+(\d{3,}):(\d{2}):(\d{2}):(\d{2})|T-(\d{3,}):(\d{2}):(\d{2}):(\d{2}))$/;

export function parseMetLabel(value: string): number | null {
  const m = MET_LABEL_RE.exec(value);
  if (!m) return null;
  if (m[1] !== undefined) {
    const days = Number(m[1]);
    const h = Number(m[2]);
    const mi = Number(m[3]);
    const s = Number(m[4]);
    if (h > 23 || mi > 59 || s > 59) return null;
    return days * 86400 + h * 3600 + mi * 60 + s;
  }
  const days = Number(m[5]);
  const h = Number(m[6]);
  const mi = Number(m[7]);
  const s = Number(m[8]);
  if (h > 23 || mi > 59 || s > 59) return null;
  return -(days * 86400 + h * 3600 + mi * 60 + s);
}

// ---- Typed coordinates ----

export const LAT_FIELD_ERROR = "Use a latitude like 12.5° S or −12.5.";
export const LON_FIELD_ERROR = "Use a longitude like 45.25° W or −45.25.";

const NUM_LETTER_RE = /^(\d+(?:\.\d{1,6})?)(°)?\s*([NnSsEeWw])$/;
const SIGNED_RE = /^([−-])?(\d+(?:\.\d{1,6})?)(°)?$/;

export type CoordinateParse = { value: number } | { error: string };

export function parseCoordinate(raw: string, axis: "lat" | "lon"): CoordinateParse {
  const trimmed = raw.trim();
  const withLetter = NUM_LETTER_RE.exec(trimmed);
  if (withLetter) {
    const magnitude = Number(withLetter[1]);
    const letter = withLetter[3];
    const expected = axis === "lat" ? /[NnSs]/ : /[EeWw]/;
    if (!expected.test(letter)) return { error: axis === "lat" ? LAT_FIELD_ERROR : LON_FIELD_ERROR };
    const negative =
      letter === "S" || letter === "s" || letter === "W" || letter === "w";
    return checkRange(negative ? -magnitude : magnitude, axis);
  }
  const signed = SIGNED_RE.exec(trimmed);
  if (signed) {
    const sign = signed[1] === "−" || signed[1] === "-" ? -1 : 1;
    return checkRange(sign * Number(signed[2]), axis);
  }
  return { error: axis === "lat" ? LAT_FIELD_ERROR : LON_FIELD_ERROR };
}

function checkRange(value: number, axis: "lat" | "lon"): CoordinateParse {
  if (axis === "lat") {
    if (value >= -90 && value <= 90) return { value };
    return { error: LAT_FIELD_ERROR };
  }
  if (value > -180 && value <= 180) return { value };
  return { error: LON_FIELD_ERROR };
}

// ---- Plans ----

export type PlanId = "archive-free" | "archive-1" | "archive-10-annual";

export interface PlanDefinition {
  plan: PlanId;
  label: string;
  quota_bytes: number;
  period: "month" | "year";
  price_cents: number;
}

export const PLAN_CATALOGUE: PlanDefinition[] = [
  { plan: "archive-free", label: "Free", quota_bytes: 268435456, period: "month", price_cents: 0 },
  { plan: "archive-1", label: "Archive 1 GiB", quota_bytes: 1073741824, period: "month", price_cents: 400 },
  {
    plan: "archive-10-annual",
    label: "Archive 10 GiB",
    quota_bytes: 10737418240,
    period: "year",
    price_cents: 28800,
  },
];

export function planDefinition(plan: PlanId): PlanDefinition {
  for (const def of PLAN_CATALOGUE) {
    if (def.plan === plan) return def;
  }
  throw new Error("unknown plan");
}

export function planRadioLabel(def: PlanDefinition): string {
  if (def.plan === "archive-free") return `Free, ${formatSize(def.quota_bytes)}`;
  if (def.period === "month") {
    return `${def.label}, ${formatMoney(def.price_cents)} USD/month`;
  }
  const monthly = roundHalfAwayFromZero(def.price_cents / 12, 0);
  return `${def.label}, ${formatMoney(monthly)} USD/month, billed ${formatMoney(def.price_cents)} USD yearly`;
}

export function planPriceText(def: PlanDefinition): string {
  if (def.plan === "archive-free") return "Free";
  if (def.period === "month") return `${formatMoney(def.price_cents)} USD/month`;
  const monthly = roundHalfAwayFromZero(def.price_cents / 12, 0);
  return `${formatMoney(monthly)} USD/month, billed ${formatMoney(def.price_cents)} USD yearly`;
}

// ---- Derived values from an SI position ----

export interface DerivedValues {
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
}

export function deriveFromPosition(
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
): DerivedValues {
  const r = Math.sqrt(x * x + y * y + z * z);
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lon = Math.atan2(y, x);
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  return {
    lat_deg: (lat * 180) / Math.PI,
    lon_deg: (lon * 180) / Math.PI,
    altitude_m: r - MOON_RADIUS_M,
    speed_m_s: speed,
  };
}

// ---- Cubic Hermite interpolation and the frame grid ----

export interface HermiteSample {
  met: number; // seconds
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

function hermitePosition(s: number, pa: number, va: number, pb: number, vb: number, h: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * pa +
    (s3 - 2 * s2 + s) * h * va +
    (-2 * s3 + 3 * s2) * pb +
    (s3 - s2) * h * vb
  );
}

function hermiteVelocity(s: number, pa: number, va: number, pb: number, vb: number, h: number): number {
  const s2 = s * s;
  return (
    ((6 * s2 - 6 * s) * pa +
      (3 * s2 - 4 * s + 1) * h * va +
      (-6 * s2 + 6 * s) * pb +
      (3 * s2 - 2 * s) * h * vb) /
    h
  );
}

export interface FrameValues {
  met_ms: number;
  altitude_m: number;
  lat_deg: number;
  lon_deg: number;
  speed_m_s: number;
}

export function roundHalfEven(value: number): number {
  if (!Number.isFinite(value)) return value;
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function frameGridMetMs(fromSeconds: number, fps: number, k: number): number {
  return fromSeconds * 1000 + roundHalfEven((k * 1000) / fps);
}

export function computeFrame(samples: HermiteSample[], metMs: number): FrameValues {
  const t = metMs / 1000;
  let aIndex = -1;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].met <= t) {
      aIndex = i;
      break;
    }
  }
  if (aIndex === -1) {
    const first = samples[0];
    return frameDerived(metMs, first.x, first.y, first.z, first.vx, first.vy, first.vz);
  }
  const a = samples[aIndex];
  const b = samples[aIndex + 1];
  if (!b || b.met - a.met > 600) {
    return frameDerived(metMs, a.x, a.y, a.z, a.vx, a.vy, a.vz);
  }
  const h = b.met - a.met;
  const s = (t - a.met) / h;
  const px = hermitePosition(s, a.x, a.vx, b.x, b.vx, h);
  const py = hermitePosition(s, a.y, a.vy, b.y, b.vy, h);
  const pz = hermitePosition(s, a.z, a.vz, b.z, b.vz, h);
  const vx = hermiteVelocity(s, a.x, a.vx, b.x, b.vx, h);
  const vy = hermiteVelocity(s, a.y, a.vy, b.y, b.vy, h);
  const vz = hermiteVelocity(s, a.z, a.vz, b.z, b.vz, h);
  return frameDerived(metMs, px, py, pz, vx, vy, vz);
}

function frameDerived(
  metMs: number,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
): FrameValues {
  const d = deriveFromPosition(x, y, z, vx, vy, vz);
  return { met_ms: metMs, ...d };
}

// Great-circle landmark range on the mean lunar radius (haversine).
export function landmarkRangeM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const p1 = lat1 * toRad;
  const p2 = lat2 * toRad;
  const halfDLon = ((lon2 - lon1) * toRad) / 2;
  const hav =
    Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(halfDLon) ** 2;
  const central = 2 * Math.asin(Math.min(1, Math.sqrt(hav)));
  return MOON_RADIUS_M * central;
}

// Snapping: the last sample in track order whose MET is at or before t.
export function snapSampleIndex(mets: number[], t: number): number {
  for (let i = mets.length - 1; i >= 0; i--) {
    if (mets[i] <= t) return i;
  }
  return 0;
}
