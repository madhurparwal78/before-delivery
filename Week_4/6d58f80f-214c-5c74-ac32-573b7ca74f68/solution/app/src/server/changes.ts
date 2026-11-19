// A committed state change, written to the outbox in the same transaction as the change itself. Every server
// process LISTENs and delivers it to its own open screens, filtered per session (hub.ts).
import type pg from "pg";
import type { ItemType, Named, Notice, Upload } from "../shared/api.js";

export type Change =
  | { kind: "files"; fileIds: string[]; folderIds: string[]; storage: boolean }
  | { kind: "moved"; by: Named; toFolder: Named; items: { fileId: string; fromFolderId: string }[] }
  | { kind: "folders"; folderIds: string[] }
  | { kind: "grants"; itemType: ItemType; itemId: string; personId: string; notice: Notice | null }
  | { kind: "handovers"; fromId: string; toId: string; notice: Notice | null }
  | { kind: "policies" }
  | { kind: "upload"; ownerId: string; upload: Upload; expired: boolean }
  | { kind: "signout"; sessionHash: string };

export const CHANNEL = "lintel_events";

export async function publish(client: pg.PoolClient, change: Change): Promise<void> {
  await client.query(
    "WITH inserted AS (INSERT INTO outbox (change) VALUES ($1) RETURNING id) SELECT pg_notify($2, id::text) FROM inserted",
    [JSON.stringify(change), CHANNEL]);
}
