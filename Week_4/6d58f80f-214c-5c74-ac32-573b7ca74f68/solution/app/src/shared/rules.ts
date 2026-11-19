// Rules and constants both the server and the browser apply, decided here once.
import { PART_SIZE, type Person } from "./api.js";

/** What partners see in place of a folder no active grant of theirs covers (brief: API). */
export const HIDDEN_FOLDER_NAME = "another folder";
export const MAX_FILE_BYTES = 2_000_000_000;
/** America/Phoenix keeps UTC-7 all year (brief: Company time). */
export const PHOENIX_OFFSET_MS = -7 * 3_600_000;
export const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Only a project's owner or a document controller shares inside it or offers it in a handover. */
export function mayShare(person: Person, projectOwnerId: string | null): boolean {
  return person.kind === "staff" && (person.staffRole === "controller" || projectOwnerId === person.id);
}

export function partCount(size: number): number {
  return Math.max(1, Math.ceil(size / PART_SIZE));
}

/** Every part but the last is exactly PART_SIZE bytes; the last carries the remainder. */
export function partBytes(n: number, size: number): number {
  const count = partCount(size);
  return n < count ? PART_SIZE : size - PART_SIZE * (count - 1);
}
