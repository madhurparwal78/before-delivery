// Figures as the brief writes them (Feedback states, Fixed texts). The browser never computes expiry or "today";
// it only formats the figures the API returns.
import { PHOENIX_OFFSET_MS } from "../shared/rules";
const UNITS = ["KB", "MB", "GB", "TB"];

export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  for (const [i, unit] of UNITS.entries()) {
    if (bytes < 1000 ** (i + 2) || unit === "TB") return `${(bytes / 1000 ** (i + 1)).toFixed(2)} ${unit}`;
  }
  return `${bytes} B`;
}


/** "YYYY-MM-DD HH:MM" in Phoenix time, the company zone (UTC-7 all year). */
export function phoenixMinute(instant: string): string {
  return new Date(Date.parse(instant) + PHOENIX_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

export function filesWord(n: number): string {
  return n === 1 ? "1 file" : `${n} files`;
}

function daysLeft(n: number): string {
  return n === 1 ? "1 day left" : `${n} days left`;
}

export function grantDaysLeft(n: number): string {
  return n === 0 ? "Last day" : daysLeft(n);
}

export function binDaysLeft(item: { daysLeft: number; retentionDays: number; purgePending: boolean }): string {
  return item.purgePending ? `Purge pending · ${item.retentionDays}-day rule` : `${daysLeft(item.daysLeft)} · ${item.retentionDays}-day rule`;
}

export function kindOf(contentType: string): string {
  const type = contentType.split(";")[0]?.trim() ?? "";
  if (type === "application/pdf") return "PDF document";
  if (type === "image/png") return "PNG image";
  if (type === "image/jpeg") return "JPEG image";
  return type || "File";
}
