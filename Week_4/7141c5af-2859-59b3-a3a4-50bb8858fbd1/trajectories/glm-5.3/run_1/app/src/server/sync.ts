import { q } from "./db.js";
import { meili, type EntryDoc } from "./providers/meili.js";

export type SyncEntry = { kind: "client" | "piece" | "material"; refId: string; label: string; href: string; remove?: boolean };

/** Keep the search index and search_sync in step; pending rows retry while the engine is down. */
export async function syncEntries(deskId: string, entries: SyncEntry[]): Promise<void> {
  for (const e of entries) {
    if (e.remove) {
      await q("DELETE FROM search_sync WHERE desk_id=$1 AND kind=$2 AND ref_id=$3", [deskId, e.kind, e.refId]);
      await meili.delete([`${deskId}-${e.kind}-${e.refId}`]);
    } else {
      await q(
        "INSERT INTO search_sync (desk_id, kind, ref_id, label, href, pending) VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (desk_id, kind, ref_id) DO UPDATE SET label=$4, href=$5, pending=true",
        [deskId, e.kind, e.refId, e.label, e.href]
      );
      const ok = await meili.add([docFor(deskId, e.kind, e.refId, e.label, e.href)]);
      if (ok) {
        await q("UPDATE search_sync SET pending=false WHERE desk_id=$1 AND kind=$2 AND ref_id=$3", [deskId, e.kind, e.refId]);
      }
    }
  }
}

export const docFor = (deskId: string, kind: string, refId: string, label: string, href: string): EntryDoc => ({
  id: `${deskId}-${kind}-${refId}`,
  deskId,
  kind,
  refId,
  label,
  href,
});

/** Retry any pending rows (engine was down at write time). */
export async function flushPending(): Promise<void> {
  const rows = await q<{ desk_id: string; kind: string; ref_id: string; label: string; href: string }>(
    "SELECT desk_id, kind, ref_id, label, href FROM search_sync WHERE pending = true LIMIT 200"
  );
  if (!rows.length) return;
  const docs = rows.map((r) => docFor(r.desk_id, r.kind, r.ref_id, r.label, r.href));
  const ok = await meili.add(docs);
  if (!ok) return;
  for (const r of rows) {
    await q("UPDATE search_sync SET pending=false WHERE desk_id=$1 AND kind=$2 AND ref_id=$3", [r.desk_id, r.kind, r.ref_id]);
  }
}

/** Rebuild the whole index from the database, whatever the engine holds. */
export async function rebuildIndex(): Promise<boolean> {
  const rows = await q<{ desk_id: string; kind: string; ref_id: string; label: string; href: string }>(
    "SELECT desk_id, kind, ref_id, label, href FROM search_sync"
  );
  const ok = await meili.replaceAll(rows.map((r) => docFor(r.desk_id, r.kind, r.ref_id, r.label, r.href)));
  if (ok) {
    await q("UPDATE search_sync SET pending=false");
  }
  return ok;
}
