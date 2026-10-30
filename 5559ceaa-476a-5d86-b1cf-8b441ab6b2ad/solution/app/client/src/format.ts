const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number): string => String(n).padStart(2, "0");

/** Ledger time: `HH:MM` in local 24-hour time, preceded by `D Mon` when the local date is not today. */
export function ledgerTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? time : `${at.getDate()} ${MONTHS[at.getMonth()]} ${time}`;
}

/** `D Mon YYYY, HH:MM` in the viewer's local time. */
export function stamp(iso: string): string {
  const at = new Date(iso);
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function lineOf(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n") };
}
