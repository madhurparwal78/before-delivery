// Display formatting shared by the server (emails, PDFs) and the browser. No arithmetic on amounts.

export const FLAVOUR_NAMES: Record<string, string> = {
  "guava-lime": "Guava & Lime",
  "yuzu-ginger": "Yuzu Ginger",
  "passionfruit-basil": "Passionfruit Basil",
  "cacao-orange": "Cacao Orange",
};

export const PROVINCE_NAMES: Record<string, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  NS: "Nova Scotia",
  ON: "Ontario",
  QC: "Quebec",
};

/** Integer cents as `$12.34` (a negative amount as `-$4.00`). */
export function money(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Integer cents as `12.34`. */
export function dollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** A rate string like "9.975" shown as "9.975", "5.000" as "5". */
export function rateText(rate: string): string {
  return rate.replace(/\.?0+$/, "");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A calendar date `YYYY-MM-DD` written like `November 30, 2026`. */
export function longDate(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function torontoParts(instant: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** The America/Toronto calendar date of an instant, as `YYYY-MM-DD`. */
export function torontoDay(instant: Date): string {
  const p = torontoParts(instant);
  return `${p.year}-${p.month}-${p.day}`;
}

/** An instant written like `November 30, 2026 at 14:05` in America/Toronto. */
export function longDateTime(instant: Date): string {
  const p = torontoParts(instant);
  return `${longDate(`${p.year}-${p.month}-${p.day}`)} at ${p.hour}:${p.minute}`;
}
