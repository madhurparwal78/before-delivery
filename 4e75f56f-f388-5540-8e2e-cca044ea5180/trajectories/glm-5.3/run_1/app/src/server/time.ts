const CHICAGO = "America/Chicago";

function ymdInChicago(instant: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The one source of the venue-local date. Calendar rules use this; timers and
 * server_time always use the real clock.
 */
export function venueDate(frozenNow: string | null): string {
  const instant = frozenNow ? new Date(frozenNow) : new Date();
  if (Number.isNaN(instant.getTime())) return ymdInChicago(new Date());
  return ymdInChicago(instant);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function depositsOpen(venue: string): boolean {
  return venue <= "2027-03-19";
}

export function refundDueCents(paidCents: number, venue: string): number | null {
  if (venue <= "2027-01-15") return Math.max(0, paidCents - 25000);
  if (venue <= "2027-03-19") return Math.floor(paidCents / 2);
  return null;
}

export type ReminderKind = "21" | "7";

export function remindersDue(venue: string): ReminderKind[] {
  if (venue > "2027-03-19") return [];
  if (venue >= "2027-03-12") return ["7"];
  if (venue >= "2027-02-26") return ["21"];
  return [];
}

export function openCheckinDay(venue: string): 1 | 2 | null {
  if (venue === "2027-04-16") return 1;
  if (venue === "2027-04-17") return 2;
  return null;
}
