// Seating and folder visibility, worked out from stored data on every request.
import { STRING_SECTIONS } from "./copies.js";
/**
 * A string player is seated when their chair number is within their section's count; any other
 * player is seated when a work in the programme has a part for their chair.
 */
export function isSeated(chair, stringCount, chairKeysInProgramme) {
    const section = STRING_SECTIONS[chair.key];
    if (section !== undefined)
        return chair.number !== null && chair.number <= stringCount[section];
    return chairKeysInProgramme.has(chair.key);
}
/** A folder is visible only while its programme is published or in performance and the player is seated. */
export function folderVisible(status, seated) {
    return foldersOpen(status) && seated;
}
/** Folders are open to seated players while the programme is published or in performance. */
export function foldersOpen(status) {
    return status === "published" || status === "in_performance";
}
