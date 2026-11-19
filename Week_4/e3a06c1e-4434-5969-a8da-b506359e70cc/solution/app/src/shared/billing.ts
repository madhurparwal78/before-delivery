// Billable seconds, cost and the display roundings: the single place these rules are decided.
export type Plan = "pilot" | "scale";

export const PLANS: readonly Plan[] = ["pilot", "scale"];
export const PLAN_TITLE: Record<Plan, string> = { pilot: "Pilot", scale: "Scale" };
export const CENTS_PER_MINUTE: Record<Plan, number> = { pilot: 6, scale: 3 };
const SCALE_MINIMUM_SECONDS = 15;
const MAX_CALCULATOR_MS = 3_600_000;

export function isPlan(value: unknown): value is Plan {
  return value === "pilot" || value === "scale";
}

/** Billable seconds of one session under its plan's per-channel rounding rule. */
export function billableSeconds(plan: Plan, audioMs: number, channels: number): number {
  if (audioMs === 0) return 0;
  if (plan === "pilot") return channels * 60 * Math.ceil(audioMs / 60_000);
  return channels * Math.max(SCALE_MINIMUM_SECONDS, Math.ceil(audioMs / 1000));
}

/** Cost in cents of a plan's summed billable seconds: the one rounding step, up to a whole cent. */
export function costCents(plan: Plan, seconds: number): number {
  return Math.floor((seconds * CENTS_PER_MINUTE[plan] + 59) / 60);
}

/** Seconds shown as minutes, rounded half up to two decimals. */
export function minutesText(seconds: number): string {
  const hundredths = Math.floor((10 * seconds + 3) / 6);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

export function dollarsText(cents: number): string {
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Quota meter value: used / limit as a whole percent, rounded half up and capped at 100. */
export function quotaPercent(usedSeconds: number, limitMinutes: number): number {
  const limitSeconds = limitMinutes * 60;
  return Math.min(100, Math.floor((200 * usedSeconds + limitSeconds) / (2 * limitSeconds)));
}

/** A typed session length for the public calculator, in milliseconds, or null when invalid. */
export function parseLengthMs(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{0,3}))?$/.exec(text);
  if (!match) return null;
  const whole = match[1].replace(/^0+(?=\d)/, "");
  if (whole.length > 4) return null;
  const ms = Number(whole) * 1000 + Number((match[2] ?? "").padEnd(3, "0"));
  return ms <= MAX_CALCULATOR_MS ? ms : null;
}
