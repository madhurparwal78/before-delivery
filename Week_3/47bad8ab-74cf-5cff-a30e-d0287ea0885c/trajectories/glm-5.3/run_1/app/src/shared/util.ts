export function countChars(s: string): number {
  let count = 0;
  for (const _ of s) count++;
  return count;
}

export function hasControlChars(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

export function validName(s: string, max: number): boolean {
  const t = s.trim();
  const n = countChars(t);
  return n >= 1 && n <= max && !hasControlChars(t);
}

export function isValidEntry(s: string): boolean {
  if (s.length < 1 || s.length > 8) return false;
  return /^[A-Z0-9]+$/.test(s);
}

export function isValidCellKey(s: string): boolean {
  return /^[A-Z0-9]$/.test(s);
}

export function isValidRebusChar(s: string): boolean {
  return /^[A-Z0-9]$/.test(s);
}

/** The one place where <time> is formatted. */
export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDateUTC(iso: string): string {
  return iso.slice(0, 10);
}

export function revealedPhrase(n: number): string {
  return n === 1 ? "Revealed 1 square" : `Revealed ${n} squares`;
}

export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : "puzzle";
}
