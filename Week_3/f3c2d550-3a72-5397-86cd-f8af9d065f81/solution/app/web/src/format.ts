/** `2026-11-03T10:00:00Z` as `2026-11-03 10:00 UTC`, never through the browser's locale or zone. */
export function utcStamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function unitName(unit: "mm" | "in"): string {
  return unit === "mm" ? "millimetres" : "inches";
}
