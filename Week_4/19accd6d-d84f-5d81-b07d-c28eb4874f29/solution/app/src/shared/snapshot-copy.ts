import { briefDate } from "./dates";

/** The sentence an expired snapshot gives, as the API's 409 and the snapshot screen both word it. */
export const snapshotExpiredMessage = (expiresAt: string): string => `This snapshot expired on ${briefDate(expiresAt)}.`;

export const SNAPSHOT_REVOKED_MESSAGE = "This snapshot was revoked.";
