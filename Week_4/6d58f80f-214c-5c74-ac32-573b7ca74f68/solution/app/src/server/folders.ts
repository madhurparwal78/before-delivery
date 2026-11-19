// Folders, the folder tree and folder activity (brief: API; Business rules, People and capabilities).
import { pool, rows, tx } from "./db.js";
import { now } from "./clock.js";
import { bodyObject, forbidden, invalid, notFound, route, sendJson } from "./http.js";
import { isId, newId } from "./ids.js";
import { checkName } from "./names.js";
import { present, record, type LedgerRow } from "./ledger.js";
import { publish } from "./changes.js";
import { Viewer } from "./access.js";
import { collator } from "../shared/rules.js";
import type { LedgerEntry } from "../shared/api.js";


export function register(): void {
  route("GET", "/api/folders", async ({ res, session }) => {
    const viewer = await Viewer.load(pool, session.person);
    const folders = viewer.visibleFolders().sort((a, b) => collator.compare(a.name, b.name)).map((f) => viewer.folder(f));
    sendJson(res, 200, { folders });
  });

  route("GET", "/api/folders/:id", async ({ res, session, params }) => {
    const viewer = await Viewer.load(pool, session.person);
    const row = isId(params.id) ? viewer.folders.get(params.id) : undefined;
    if (!row || !viewer.canSeeFolder(row.id)) throw notFound();
    sendJson(res, 200, { folder: viewer.folder(row), path: viewer.path(row.id) });
  });

  route("POST", "/api/folders", async (ctx) => {
    const { res, session } = ctx;
    const body = bodyObject(ctx);
    const viewer = await Viewer.load(pool, session.person);
    const parentId = body.parentId;
    if (parentId !== null && parentId !== undefined) {
      const parent = isId(parentId) ? viewer.folders.get(parentId) : undefined;
      if (!parent || !viewer.canSeeFolder(parent.id)) throw notFound();
      if (viewer.folderRole(parent.id) !== "editor") throw forbidden();
    } else if (!viewer.staff) {
      throw forbidden();
    }
    const fields: Record<string, string> = {};
    if (parentId === undefined) fields.parentId = "Choose where the folder goes.";
    const checked = checkName(body.name);
    if ("error" in checked) fields.name = checked.error;
    if (Object.keys(fields).length || "error" in checked) throw invalid(fields);
    const parent = typeof parentId === "string" ? viewer.folders.get(parentId) ?? null : null;
    const id = newId();
    await tx(async (client) => {
      await client.query(
        "INSERT INTO folders (id, name, parent_id, owner_id, owner_name, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, checked.name, parent?.id ?? null, parent ? null : session.person.id, parent ? null : session.person.name, now()]);
      await record(client, {
        actor: session.person, action: "folder_created", folderId: id,
        detail: { name: checked.name, ...(parent ? { folder: { id: parent.id, name: parent.name } } : {}) },
      });
      await publish(client, { kind: "folders", folderIds: parent ? [id, parent.id] : [id] });
    });
    const fresh = await Viewer.load(pool, session.person);
    const created = fresh.folders.get(id);
    if (!created) throw notFound();
    sendJson(res, 201, { folder: fresh.folder(created) });
  });

  route("GET", "/api/folders/:id/activity", async ({ res, session, params }) => {
    const viewer = await Viewer.load(pool, session.person);
    if (!isId(params.id) || !viewer.canSeeFolder(params.id)) throw notFound();
    const entries = await rows<LedgerRow>(pool,
      `SELECT * FROM ledger WHERE folder_id = $1
          OR file_id IN (SELECT id FROM files WHERE folder_id = $1 AND binned_date IS NULL)
        ORDER BY at DESC, id DESC LIMIT 200`, [params.id]);
    sendJson(res, 200, { entries: entries.map((e) => present(viewer, e)).filter((e): e is LedgerEntry => e !== null) });
  });
}
