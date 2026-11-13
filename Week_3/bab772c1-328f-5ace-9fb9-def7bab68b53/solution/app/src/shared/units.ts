import { fixed, formatScaled, scaleRoundHalfAway } from "./decimal.js";

export type DistanceUnit = "km" | "nmi";
export type SpeedUnit = "m_s" | "ft_s";

const DISTANCE: Record<DistanceUnit, { num: bigint; den: bigint; label: string }> = {
  km: { num: 1n, den: 1000n, label: "km" },
  nmi: { num: 1n, den: 1852n, label: "nmi" },
};

const SPEED: Record<SpeedUnit, { num: bigint; den: bigint; label: string }> = {
  m_s: { num: 1n, den: 1n, label: "m/s" },
  ft_s: { num: 10000n, den: 3048n, label: "ft/s" },
};

export function isDistanceUnit(value: unknown): value is DistanceUnit {
  return value === "km" || value === "nmi";
}

export function isSpeedUnit(value: unknown): value is SpeedUnit {
  return value === "m_s" || value === "ft_s";
}

export function distanceUnitLabel(unit: DistanceUnit): string {
  return DISTANCE[unit].label;
}

function speedUnitLabel(unit: SpeedUnit): string {
  return SPEED[unit].label;
}

/** Distance in the display unit, one decimal, without unit text. */
export function distanceNumber(metres: number, unit: DistanceUnit): string {
  const { num, den } = DISTANCE[unit];
  return fixed(metres, num, den, 1);
}

/** Speed in the display unit, whole, without unit text. */
export function speedNumber(metresPerSecond: number, unit: SpeedUnit): string {
  const { num, den } = SPEED[unit];
  return fixed(metresPerSecond, num, den, 0);
}

/** `<altitude>`, `<range>` and `<residual>`. */
export function formatDistance(metres: number, unit: DistanceUnit): string {
  return `${distanceNumber(metres, unit)} ${DISTANCE[unit].label}`;
}

/** `<speed>`. */
export function formatSpeed(metresPerSecond: number, unit: SpeedUnit): string {
  return `${speedNumber(metresPerSecond, unit)} ${SPEED[unit].label}`;
}

function formatDegrees(degrees: number, positive: string, negative: string): string {
  const scaled = scaleRoundHalfAway(degrees, 1n, 1n, 2);
  const magnitude = scaled < 0n ? -scaled : scaled;
  const hemisphere = scaled < 0n ? negative : positive;
  return `${formatScaled(magnitude, 2)}\u00b0 ${hemisphere}`;
}

/** `<latitude>`. */
export function formatLatitude(degrees: number): string {
  return formatDegrees(degrees, "N", "S");
}

/** `<longitude>`. */
export function formatLongitude(degrees: number): string {
  return formatDegrees(degrees, "E", "W");
}
