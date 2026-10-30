/** The kitchen clock and time formatting in the kitchen's time zone. */

export function kitchenClockFormatter(zone: string): (epochMs: number) => string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return (epochMs: number) => {
    const parts = fmt.format(epochMs);
    return parts === "24:00" ? "00:00" : parts;
  };
}

export function kitchenDateFormatter(zone: string): (epochMs: number) => string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return (epochMs: number) => fmt.format(epochMs);
}

/** Wall-clock minutes → "HH:MM" (1440 renders as "24:00"). */
export function minuteLabel(minute: number): string {
  const clamped = Math.max(0, Math.min(1440, minute));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Cents → "$1,234.56" */
export function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).startsWith("$")
    ? ""
    : `$${(cents / 100).toFixed(2)}`;
}

/** Minutes → "h:mm" (360 → "6:00", 45 → "0:45"). */
export function hmm(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** Seconds → "m:ss" for hold countdowns. */
export function mss(secondsRemaining: number): string {
  const s = Math.max(0, secondsRemaining);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
