// Pure calendar text for Lisbon dates written as YYYY-MM-DD. No clock is read here.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function parseDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

/** `Fri 14 Nov` */
export function formatDayLabel(date: string): string {
  const parsed = parseDate(date);
  return `${WEEKDAYS[parsed.getUTCDay()]} ${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]}`;
}

/** `Fri 14 Nov at 20:30` */
export function formatWhen(date: string, time: string): string {
  return `${formatDayLabel(date)} at ${time}`;
}

export function addDays(date: string, days: number): string {
  const moved = parseDate(date);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

export function guestsLabel(party: number): string {
  return `${party} ${party === 1 ? "guest" : "guests"}`;
}
