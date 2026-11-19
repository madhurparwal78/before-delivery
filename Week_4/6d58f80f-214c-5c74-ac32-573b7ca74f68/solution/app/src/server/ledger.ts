// The activity ledger: one entry per item affected, written in the same transaction as the change (brief: Ledger).
import type pg from "pg";
import { now } from "./clock.js";
import type { Viewer } from "./access.js";
import type { LedgerAction, LedgerDetail, LedgerEntry, Named, ShownFolder } from "../shared/api.js";

export interface LedgerRow {
  id: number;
  at: Date;
  actor_id: string | null;
  actor_name: string | null;
  action: LedgerAction;
  file_id: string | null;
  folder_id: string | null;
  detail: LedgerDetail;
}

const PARTNER_ACTIONS = new Set<LedgerAction>(["uploaded", "renamed", "moved", "locked", "unlocked"]);

export async function record(client: pg.PoolClient, entry: {
  actor: Named | null; action: LedgerAction; fileId?: string | null; folderId?: string | null; detail?: LedgerDetail;
}): Promise<void> {
  await client.query(
    "INSERT INTO ledger (at, actor_id, actor_name, action, file_id, folder_id, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [now(), entry.actor?.id ?? null, entry.actor?.name ?? null, entry.action, entry.fileId ?? null, entry.folderId ?? null,
      JSON.stringify(entry.detail ?? {})],
  );
}

function shown(viewer: Viewer, folder: ShownFolder | undefined): ShownFolder | undefined {
  return folder ? viewer.shownFolder(folder.id) : undefined;
}

/** The entry as this viewer may see it, or null when partners do not see that kind of entry. */
export function present(viewer: Viewer, row: LedgerRow): LedgerEntry | null {
  if (!viewer.staff && (!row.file_id || !PARTNER_ACTIONS.has(row.action))) return null;
  const detail: LedgerDetail = viewer.staff ? row.detail : {
    ...row.detail,
    ...(row.detail.folder ? { folder: shown(viewer, row.detail.folder) } : {}),
    ...(row.detail.from ? { from: shown(viewer, row.detail.from) } : {}),
    ...(row.detail.to ? { to: shown(viewer, row.detail.to) } : {}),
  };
  return {
    id: String(row.id),
    at: row.at.toISOString(),
    actor: row.actor_id ? { id: row.actor_id, name: row.actor_name ?? "" } : null,
    action: row.action,
    fileId: row.file_id,
    folderId: row.folder_id && !viewer.staff ? viewer.shownFolder(row.folder_id).id : row.folder_id,
    detail,
  };
}
