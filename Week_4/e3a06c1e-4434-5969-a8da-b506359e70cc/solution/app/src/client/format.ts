// Display formats for server values. Dates are read in UTC from server timestamps, never the device clock.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthYear(iso: string): string {
  const date = new Date(iso);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// The usage month arrives as "YYYY-MM".
export function usageMonth(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return `${MONTHS[index - 1]} ${year}`;
}

export function dayMonthYear(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function stamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** Milliseconds as seconds with three decimals. */
export function seconds3(ms: number): string {
  return `${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, "0")}`;
}

/** Milliseconds as mm:ss.mmm. */
export function clock(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const rest = ms % 60_000;
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(rest / 1000)).padStart(2, "0")}.${String(rest % 1000).padStart(3, "0")}`;
}

export function quotaBanner(quota: { limit_minutes: number; period_start: string; resets_at: string }): string {
  return `Quota reached. This project's ${quota.limit_minutes} audio minutes for ${monthYear(quota.period_start)} are used up. New sessions are refused until ${dayMonthYear(quota.resets_at)} UTC or until an admin raises the quota.`;
}

export const STATE_LABEL: Record<string, string> = {
  connecting: "Connecting",
  live: "Live",
  closed: "Closed",
  idle_closed: "Idle closed",
  quota_halted: "Quota halted",
  revoked: "Revoked",
};

export const ROLE_LABEL: Record<string, string> = { admin: "Admin", developer: "Developer", reviewer: "Reviewer", approver: "Approver", billing: "Billing viewer" };
