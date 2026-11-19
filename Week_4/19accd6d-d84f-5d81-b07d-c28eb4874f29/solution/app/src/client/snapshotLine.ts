import type { Snapshot, SnapshotStatus } from "../shared/api";
import { briefDate } from "../shared/dates";
import { SNAPSHOT_REVOKED_MESSAGE, snapshotExpiredMessage } from "../shared/snapshot-copy";

export const BADGES: Record<SnapshotStatus, string> = { pending: "Pending", active: "Active", expired: "Expired", revoked: "Revoked" };

/** The sentence that follows a snapshot's badge. */
export function snapshotLine(snapshot: Pick<Snapshot, "status" | "expiresAt">): string {
  const date = briefDate(snapshot.expiresAt);
  switch (snapshot.status) {
    case "pending":
      return "Pending: storage has not confirmed the input yet.";
    case "active":
      return `Active until ${date}.`;
    case "expired":
      return snapshotExpiredMessage(snapshot.expiresAt);
    case "revoked":
      return SNAPSHOT_REVOKED_MESSAGE;
  }
}
