// Date, time and label formats the brief publishes, shared by the server (emails, PDFs) and the browser.

export type Milestone = "deposit" | "look_dev" | "final_delivery";

export const MILESTONE_LABELS: Record<Milestone, string> = {
  deposit: "Deposit",
  look_dev: "Look-dev",
  final_delivery: "Final delivery",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `2 November 2026`, in UTC. */
export function longDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** `14:05`, 24-hour UTC. */
export function utcTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

/** The quote region's FX line wording, reused by emails and PDFs. */
export function fxLine(currency: string, rate: string, locked: boolean, lockedAt: string | null): string {
  if (currency === "GBP") return "Priced in GBP.";
  if (locked && lockedAt) return `Locked at ${rate} per £1 on ${longDate(lockedAt)}.`;
  return `Indicative at ${rate} per £1.`;
}
