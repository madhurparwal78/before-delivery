// Wording shared by the server (emails, API) and the page: the count rule, span labels and the
// minute-precision time in a utility's time zone.

/** Singular for exactly 1, plural otherwise (including 0). */
export function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function spanLabel(fromTower: number, toTower: number): string {
  return `Span ${fromTower}–${toTower}`;
}

/** `YYYY-MM-DD HH:mm` in an IANA time zone. */
export function zonedMinute(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function findingLabel(labelNumber: number): string {
  return `F-${labelNumber}`;
}
