// Versions: list, save (snapshot in object storage), restore and undo.
import { tx } from "../db.js";
import { ApiError, invalid, notFound } from "../errors.js";
import { jsonBody, member } from "../http.js";
import { requireRole } from "../rules/roles.js";
import { editBlock } from "../rules/season.js";
import { type Services } from "../services/index.js";
import { StoredObjects, type VersionRow, recordVersion, restoreVersion, versionOut } from "../versions.js";
import { derive, isUuid, stationClock, stationWorkbook } from "../workbook.js";

export function versionRoutes(svc: Services): void {
  member("GET", "/api/workbooks/:id/versions", async ({ req, member: me }) => {
    const row = await stationWorkbook(svc.db, me.stationId, req.params.id);
    requireRole(me.role, "versions");
    const r = await svc.db.query<VersionRow>("SELECT * FROM versions WHERE workbook_id = $1 ORDER BY number DESC", [row.id]);
    return { status: 200, json: { versions: r.rows.map(versionOut) } };
  });

  member("POST", "/api/workbooks/:id/versions", async ({ req, member: me }) => {
    const workbook = await stationWorkbook(svc.db, me.stationId, req.params.id);
    requireRole(me.role, "versions");
    const label = jsonBody(req).label;
    if (typeof label !== "string" || label.length < 1 || label.length > 60) {
      throw invalid({ label: "Give the version a label of 1 to 60 characters." });
    }
    const objects = new StoredObjects(svc.storage);
    try {
      return await tx(svc.db, async (t) => {
        const row = await stationWorkbook(t, me.stationId, workbook.id, true);
        const derived = await derive(t, row, stationClock(me.timeZone));
        const version = await recordVersion(t, objects, row, me, { label, kind: "saved", seq: derived.headSeq, content: derived.engine.content() });
        return { status: 201, json: { version: versionOut(version) } };
      });
    } catch (error) {
      // Undo: the version row was not committed, so its stored snapshot is removed.
      await objects.undo();
      throw error;
    }
  });

  member("POST", "/api/workbooks/:id/versions/:versionId/restore", async ({ req, member: me }) => {
    const workbook = await stationWorkbook(svc.db, me.stationId, req.params.id);
    if (!isUuid(req.params.versionId)) throw notFound();
    const found = await svc.db.query<VersionRow>("SELECT * FROM versions WHERE id = $1 AND workbook_id = $2", [req.params.versionId, workbook.id]);
    const target = found.rows[0];
    if (!target) throw notFound();
    requireRole(me.role, "restore");
    const objects = new StoredObjects(svc.storage);
    try {
      return await tx(svc.db, async (t) => {
        const row = await stationWorkbook(t, me.stationId, workbook.id, true);
        const blocked = editBlock(row.state, row.closes_at_utc, new Date());
        if (blocked) throw new ApiError(409, blocked, "That isn't allowed in this season state.");
        const derived = await derive(t, row, stationClock(me.timeZone));
        const done = await restoreVersion(t, svc.storage, objects, row, derived, me, target);
        return { status: 201, json: { restored: versionOut(done.restored), undo: versionOut(done.undo), headSeq: done.headSeq } };
      });
    } catch (error) {
      // Undo: nothing of the restore was committed, so the snapshots it stored are removed.
      await objects.undo();
      throw error;
    }
  });
}
