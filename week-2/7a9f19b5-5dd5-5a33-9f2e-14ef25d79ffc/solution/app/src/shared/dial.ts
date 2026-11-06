const LIGHT_STATES = ["morning", "day", "evening", "night", "gallery"] as const;
export type LightState = (typeof LIGHT_STATES)[number];

export const DIAL_MODES = ["auto", ...LIGHT_STATES] as const;
export type DialMode = (typeof DIAL_MODES)[number];

export function isDialMode(value: unknown): value is DialMode {
  return typeof value === "string" && (DIAL_MODES as readonly string[]).includes(value);
}

/** Auto bands by the viewer's local hour: Morning 05–10, Day 11–16, Evening 17–20, Night 21–04. */
export function lightForHour(hour: number): LightState {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}
