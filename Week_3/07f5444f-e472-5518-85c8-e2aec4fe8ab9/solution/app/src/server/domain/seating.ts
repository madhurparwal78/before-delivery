// Seating and folder visibility, worked out from stored data on every request.

import type { ProgrammeStatus, StringCount } from "../../shared/api.js";
import { STRING_SECTIONS } from "./copies.js";

export interface SeatedChair {
  key: string;
  number: number | null;
}

/**
 * A string player is seated when their chair number is within their section's count; any other
 * player is seated when a work in the programme has a part for their chair.
 */
export function isSeated(chair: SeatedChair, stringCount: StringCount, chairKeysInProgramme: ReadonlySet<string>): boolean {
  const section = STRING_SECTIONS[chair.key];
  if (section !== undefined) return chair.number !== null && chair.number <= stringCount[section];
  return chairKeysInProgramme.has(chair.key);
}

/** A folder is visible only while its programme is published or in performance and the player is seated. */
export function folderVisible(status: ProgrammeStatus, seated: boolean): boolean {
  return foldersOpen(status) && seated;
}

/** Folders are open to seated players while the programme is published or in performance. */
export function foldersOpen(status: ProgrammeStatus): boolean {
  return status === "published" || status === "in_performance";
}
