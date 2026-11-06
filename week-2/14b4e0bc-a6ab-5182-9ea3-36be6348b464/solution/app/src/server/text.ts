/** Character limits count Unicode code points, never UTF-16 units or bytes (DP-80). */
export function codePoints(value: string): number {
  let count = 0;
  for (const _ of value) count++;
  return count;
}

export function withinLength(value: unknown, min: number, max: number): value is string {
  if (typeof value !== "string") return false;
  const n = codePoints(value);
  return n >= min && n <= max;
}

export function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

/** Server time in the published format, always three fractional digits. */
export function serverTime(date = new Date()): string {
  return date.toISOString();
}

const TAG_ORDER = ["Confidential", "PII"] as const;
export type Tag = (typeof TAG_ORDER)[number];
const TAGS: readonly Tag[] = TAG_ORDER;

export function isTag(value: unknown): value is Tag {
  return value === "PII" || value === "Confidential";
}

/** Every tag list is sorted alphabetically: Confidential before PII. */
export function sortTags(tags: Iterable<Tag>): Tag[] {
  const set = new Set(tags);
  return TAG_ORDER.filter((t) => set.has(t));
}

export const ROLES = ["Admin", "Steward", "Analyst", "Viewer"] as const;
export type Role = (typeof ROLES)[number];
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Name order for terms, owners and users: case-folded name, ties broken by id. */
export function byName<T extends { name: string; id: string }>(a: T, b: T): number {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
