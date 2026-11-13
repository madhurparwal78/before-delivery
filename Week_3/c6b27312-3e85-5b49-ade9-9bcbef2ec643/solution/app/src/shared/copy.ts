// Copy and wire formats both sides must agree on, written once.

export const DOWNLOAD_OUTAGE = "Downloads are paused: part storage is unreachable. Your parts are safe; try again in a few minutes.";
export const SAVE_OUTAGE = "Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes.";

/** The strong ETag of the revision history: the quoted id of its head revision. */
export const etagOf = (headRevisionId: string): string => `"${headRevisionId}"`;
