/** Number and label formatting. One place decides how every measurement reads. */

function fixed(value: number, decimals: number): string {
  const rounded = value.toFixed(decimals);
  // Avoid "-0.0" for values that round to zero from below.
  return rounded.replace(/^-(0(?:\.0+)?)$/, "$1");
}

function group(value: string): string {
  const [whole, fraction] = value.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + grouped + (fraction === undefined ? "" : `.${fraction}`);
}

/** Chainage outside the readout and the slider: one decimal, ungrouped. */
export function chainage(value: number): string {
  return fixed(value, 1);
}

/** Heights, clearances, offsets and radii: two decimals, ungrouped. */
export function measure(value: number): string {
  return fixed(value, 2);
}

/** The readout's chainage line: one decimal with thousands commas. */
export function chainageGrouped(value: number): string {
  return group(fixed(value, 1));
}

/** The slider value text: whole metres with thousands commas. */
export function chainageWhole(value: number): string {
  return group(fixed(Math.round(value), 0));
}

export function angle(value: number): string {
  return fixed(value, 1);
}

export function degrees7(value: number): string {
  return fixed(value, 7);
}

export function degrees6(value: number): string {
  return fixed(value, 6);
}

/** Singular when the count is exactly 1, plural otherwise, including 0. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : pluralForm ?? `${singular}s`;
}

export function countOf(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${plural(count, singular, pluralForm)}`;
}

export function spanLabel(fromTower: number, toTower: number): string {
  return `Span ${fromTower}\u2013${toTower}`;
}

export function towerLabel(towerNumber: number): string {
  return `T${towerNumber}`;
}

export function findingLabel(n: number): string {
  return `F-${n}`;
}

const SET_STATE_WORDS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  accepted: "Accepted",
  disputed: "Disputed",
  closed: "Closed",
};

export function setStateWord(state: string | null | undefined): string {
  if (!state) return "No findings set";
  return SET_STATE_WORDS[state] ?? state;
}

export function statusWord(status: "violation" | "clear"): string {
  return status === "violation" ? "Violation" : "Clear";
}

export const ASSET_KIND_LABELS = {
  tileset: "Tileset",
  terrain: "Terrain",
  czml: "Flight track",
} as const;

export type AssetKind = keyof typeof ASSET_KIND_LABELS;

export function assetKindLabel(kind: AssetKind): string {
  return ASSET_KIND_LABELS[kind];
}

/** `YYYY-MM-DD HH:mm` for an instant in an IANA zone. */
export function zonedMinute(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** `YYYY-MM-DD HH:mm:ss` in UTC, truncated to whole seconds. */
export function utcSecond(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
}

export function inspectionDueLine(due: string, timeZone: string): string {
  return `Inspection due ${due} (${timeZone})`;
}

export function linkExpiryLine(expiresAt: string, timeZone: string): string {
  return `Link expires ${zonedMinute(expiresAt, timeZone)} (${timeZone})`;
}
