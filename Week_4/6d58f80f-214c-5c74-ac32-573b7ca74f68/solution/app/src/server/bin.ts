// The bin, purge and the storage meter (brief: Business rules, Bin and purge; Derived values).
import type pg from "pg";
import { first, pool, rows, tx } from "./db.js";
import { addDays, daysBetween, today } from "./clock.js";
import { config } from "./config.js";
import { bodyObject, forbidden, invalid, notFound, route, sendEmpty, sendJson, storageUnavailable } from "./http.js";
import { isId } from "./ids.js";
import { record } from "./ledger.js";
import { publish } from "./changes.js";
import { inForce } from "./policies.js";
import { endGrant, GRANT_COLUMNS, type GrantRow } from "./grants.js";
import { Viewer, type FileRow } from "./access.js";
import { deleteObject, objectKey, StorageUnavailable } from "./storage.js";
import type { BinItem, CompanyDate, Named } from "../shared/api.js";

const MAX_IDS = 500;

type BinnedRow = FileRow & { binned_date: CompanyDate; retention_days: number };

function isBinned(row: FileRow): row is BinnedRow {
  return row.binned_date !== null && row.retention_days !== null;
}

/** Bin days left: purge date = binned date + the retention in force on the binned date. */
function binFigures(row: BinnedRow, day: CompanyDate): Pick<BinItem, "purgeDate" | "daysLeft" | "purgePending"> {
  const purgeDate = addDays(row.binned_date, row.retention_days);
  return { purgeDate, daysLeft: daysBetween(day, purgeDate), purgePending: purgeDate <= day };
}

/** Removes a binned file for good once storage has deleted its object; false when it is already gone. */
async function purge(client: pg.PoolClient, row: BinnedRow, actor: Named | null): Promise<boolean> {
  const locked = await first<FileRow>(client, "SELECT * FROM files WHERE id = $1 AND binned_date IS NOT NULL FOR UPDATE", [row.id]);
  if (!locked) return false;
  const grants = await rows<GrantRow>(client,
    `SELECT ${GRANT_COLUMNS} FROM grants WHERE item_id = $1 AND status = 'active'`, [row.id]);
  for (const grant of grants) await endGrant(client, grant, "purged", actor);
  await client.query("DELETE FROM files WHERE id = $1", [row.id]);
  const folder = await first<{ id: string; name: string }>(client, "SELECT id, name FROM folders WHERE id = $1", [row.folder_id]);
  await record(client, { actor, action: "purged", fileId: row.id, folderId: row.folder_id, detail: { name: row.name, ...(folder ? { folder } : {}) } });
  await publish(client, { kind: "files", fileIds: [row.id], folderIds: [row.folder_id], storage: true });
  return true;
}

/** Sweep step: files whose purge date has come are removed, each only after storage confirms the deletion. */
export async function purgeDue(): Promise<void> {
  const day = today();
  const binned = (await rows<FileRow>(pool, "SELECT * FROM files WHERE binned_date IS NOT NULL")).filter(isBinned);
  for (const row of binned.filter((r) => binFigures(r, day).purgePending)) {
    try {
      await deleteObject(objectKey(row.id));
    } catch (error) {
      if (error instanceof StorageUnavailable) return;
      throw error;
    }
    await tx((client) => purge(client, row, null));
  }
}

/** Bin routes are staff only; a partner naming a binned file gets 404 like any file they cannot see. */
async function binnedFile(viewer: Viewer, id: string | undefined): Promise<BinnedRow> {
  if (!viewer.staff || !isId(id)) throw notFound();
  const row = await first<FileRow>(pool, "SELECT * FROM files WHERE id = $1", [id]);
  if (!row || !isBinned(row)) throw notFound();
  return row;
}

export function register(): void {
  route("GET", "/api/storage", async ({ res, session }) => {
    if (session.person.kind !== "staff") throw forbidden();
    const totals = await first<{ used: number; bin: number }>(pool,
      "SELECT coalesce(sum(size), 0)::bigint AS used, coalesce(sum(size) FILTER (WHERE binned_date IS NOT NULL), 0)::bigint AS bin FROM files");
    sendJson(res, 200, { usedBytes: totals?.used ?? 0, binBytes: totals?.bin ?? 0, quotaBytes: config.quotaBytes });
  });

  route("GET", "/api/bin", async ({ res, session }) => {
    if (session.person.kind !== "staff") throw forbidden();
    const viewer = await Viewer.load(pool, session.person);
    const binned = (await rows<FileRow>(pool, "SELECT * FROM files WHERE binned_date IS NOT NULL")).filter(isBinned);
    const items: BinItem[] = binned.map((row) => {
      const from = viewer.folders.get(row.folder_id);
      return {
        file: viewer.file(row),
        fromFolder: { id: row.folder_id, name: from?.name ?? "" },
        binnedDate: row.binned_date,
        retentionDays: row.retention_days,
        ...binFigures(row, viewer.today),
      };
    }).sort((a, b) => a.purgeDate.localeCompare(b.purgeDate) || a.file.name.localeCompare(b.file.name));
    sendJson(res, 200, { items });
  });

  route("POST", "/api/bin", async (ctx) => {
    const { res, session } = ctx;
    const body = bodyObject(ctx);
    const viewer = await Viewer.load(pool, session.person);
    const ids: unknown[] = Array.isArray(body.fileIds) ? body.fileIds : [];
    const found = await rows<FileRow>(pool, "SELECT * FROM files WHERE id = ANY($1)", [ids.filter(isId)]);
    const visible = (id: unknown) => {
      const row = found.find((f) => f.id === id);
      return row !== undefined && viewer.fileRole(row) !== null;
    };
    if (!viewer.staff) throw ids.some(visible) ? forbidden() : notFound();
    const fileIds = ids.filter(isId);
    if (fileIds.length !== ids.length || !ids.every(visible)) throw notFound();
    if (!Array.isArray(body.fileIds) || ids.length < 1 || ids.length > MAX_IDS || new Set(ids).size !== ids.length) {
      throw invalid({ fileIds: "Choose 1 to 500 different files." });
    }
    const day = viewer.today;
    const result = await tx(async (client) => {
      const retention = await inForce(client, "bin_retention_days", day);
      const out: { binned: string[]; stayed: { fileId: string; reason: "locked" }[] } = { binned: [], stayed: [] };
      const folders = new Set<string>();
      for (const id of fileIds) {
        const row = await first<FileRow>(client, "SELECT * FROM files WHERE id = $1 AND binned_date IS NULL FOR UPDATE", [id]);
        if (!row) continue;
        if (row.locked) {
          out.stayed.push({ fileId: id, reason: "locked" });
          continue;
        }
        await client.query("UPDATE files SET binned_date = $2, retention_days = $3 WHERE id = $1", [id, day, retention]);
        await record(client, { actor: session.person, action: "binned", fileId: id, folderId: row.folder_id, detail: { name: row.name, folder: viewer.shownFolder(row.folder_id), retentionDays: retention } });
        folders.add(row.folder_id);
        out.binned.push(id);
      }
      if (out.binned.length) await publish(client, { kind: "files", fileIds: out.binned, folderIds: [...folders], storage: true });
      return out;
    });
    sendJson(res, 200, result);
  });

  route("POST", "/api/bin/:id/restore", async ({ res, session, params }) => {
    const viewer = await Viewer.load(pool, session.person);
    const row = await binnedFile(viewer, params.id);
    const file = await tx(async (client) => {
      const changed = await client.query<FileRow>(
        "UPDATE files SET binned_date = NULL, retention_days = NULL WHERE id = $1 AND binned_date IS NOT NULL RETURNING *", [row.id]);
      const restored = changed.rows[0];
      if (!restored) throw notFound();
      await record(client, { actor: session.person, action: "restored", fileId: row.id, folderId: row.folder_id, detail: { name: row.name, folder: viewer.shownFolder(row.folder_id) } });
      await publish(client, { kind: "files", fileIds: [row.id], folderIds: [row.folder_id], storage: true });
      return restored;
    });
    sendJson(res, 200, { file: viewer.file(file) });
  });

  route("DELETE", "/api/bin/:id", async ({ res, session, params }) => {
    const viewer = await Viewer.load(pool, session.person);
    const row = await binnedFile(viewer, params.id);
    if (!viewer.isController) throw forbidden();
    try {
      await deleteObject(objectKey(row.id));
    } catch (error) {
      if (error instanceof StorageUnavailable) throw storageUnavailable();
      throw error;
    }
    const done = await tx((client) => purge(client, row, session.person));
    if (!done) throw notFound();
    sendEmpty(res);
  });
}
