// Display formatting only; every amount arrives from the server in integer cents.

export function dollars(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100).toLocaleString("en-US");
  return `${cents < 0 ? "-" : ""}$${whole}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

export function hoursText(quarters: number): string {
  return `${Math.floor(quarters / 4)}.${String((quarters % 4) * 25).padStart(2, "0")}`;
}

/** Dollars typed by a person ("29.50") to cents, or null when it is not dollars and cents. */
export function centsFromInput(text: string): number | null {
  const match = /^\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export const stateName = (state: string): string => state.replace(/_/g, " ");

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function kitchenDateTime(iso: string, zone: string): string {
  return new Date(iso).toLocaleString("en-CA", { timeZone: zone, dateStyle: "short", timeStyle: "short", hourCycle: "h23" });
}

export function kitchenDay(iso: string, zone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: zone });
}

export function kitchenClock(iso: string, zone: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
