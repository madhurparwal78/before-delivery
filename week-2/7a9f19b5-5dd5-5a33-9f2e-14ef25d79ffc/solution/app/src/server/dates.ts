import { config } from "./config.js";

/** The server's date for every date rule: today in Pacific/Auckland, or LIGHTFALL_TODAY when set. */
export function serverDate(): string {
  if (config.today) return config.today;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
}

/** An account invoice is due on the 20th of the month after its invoice date. */
export function dueDate(invoiceDate: string): string {
  const [year, month] = invoiceDate.split("-").map(Number) as [number, number];
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return `${next.year}-${String(next.month).padStart(2, "0")}-20`;
}

/** Overdue from the day after the due date. */
export function isOverdue(due: string, today = serverDate()): boolean {
  return today > due;
}
