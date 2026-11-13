/** Typed coordinates: decimal degrees with a hemisphere letter or a sign. */

const HEMISPHERE_PATTERN = /^(\d+(?:\.\d{1,6})?)\u00b0?\s*([A-Za-z])$/;
const SIGNED_PATTERN = /^([-\u2212])?(\d+(?:\.\d{1,6})?)\u00b0?$/;

type Axis = "lat" | "lon";

const LETTERS: Record<Axis, { positive: string; negative: string }> = {
  lat: { positive: "N", negative: "S" },
  lon: { positive: "E", negative: "W" },
};

function inRange(axis: Axis, value: number): boolean {
  return axis === "lat" ? value >= -90 && value <= 90 : value > -180 && value <= 180;
}

function parseCoordinate(axis: Axis, raw: string): number | null {
  const text = raw.trim();
  const hemisphere = HEMISPHERE_PATTERN.exec(text);
  if (hemisphere) {
    const letter = hemisphere[2].toUpperCase();
    const { positive, negative } = LETTERS[axis];
    if (letter !== positive && letter !== negative) {
      return null;
    }
    const magnitude = Number(hemisphere[1]);
    const value = letter === negative ? -magnitude : magnitude;
    return inRange(axis, value) ? value : null;
  }
  const signed = SIGNED_PATTERN.exec(text);
  if (signed) {
    const magnitude = Number(signed[2]);
    const value = signed[1] ? -magnitude : magnitude;
    return inRange(axis, value) ? value : null;
  }
  return null;
}

export function parseLatitude(raw: string): number | null {
  return parseCoordinate("lat", raw);
}

export function parseLongitude(raw: string): number | null {
  return parseCoordinate("lon", raw);
}

/** True when a JSON coordinate is in range and holds at most 6 decimals. */
export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90 && hasSixDecimals(value);
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value > -180 && value <= 180 && hasSixDecimals(value);
}

function hasSixDecimals(value: number): boolean {
  return Number(value.toFixed(6)) === value;
}
