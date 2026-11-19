// Moves (brief: Business rules, Moves). The move winner is decided by one conditional update per file inside one
// transaction: among simultaneous moves of a file exactly one sees its folder still equal to `fromFolderId`.
import type pg from "pg";
import { first, isUniqueViolation, pool, rows, tx } from "./db.js";
import { bodyObject, forbidden, invalid, notFound, route, sendJson } from "./http.js";
import { isId } from "./ids.js";
import { record } from "./ledger.js";
import { publish } from "./changes.js";
import { Viewer, type FileRow } from "./access.js";
import { keyOf, remember, replay } from "./idempotency.js";
import type { MoveResult, Named } from "../shared/api.js";

const MAX_ITEMS = 500;
const SCOPE = "moves";

interface Item {
  fileId: string;
  fromFolderId: string;
}

/** Who put the file where it is now: the actor of its latest move, else its uploader. */
async function placedBy(client: pg.PoolClient, fileId: string): Promise<Named> {
  const row = await first<{ actor_id: string | null; actor_name: string | null }>(client,
    "SELECT actor_id, actor_name FROM ledger WHERE file_id = $1 AND action IN ('moved', 'uploaded', 'restored') ORDER BY id DESC LIMIT 1", [fileId]);
  return { id: row?.actor_id ?? "", name: row?.actor_name ?? "" };
}

export function register(): void {
  route("POST", "/api/moves", async (ctx) => {
    const { req, res, session } = ctx;
    const body = bodyObject(ctx);
    const viewer = await Viewer.load(pool, session.person);
    const to = isId(body.toFolderId) ? viewer.folders.get(body.toFolderId) : undefined;
    if (!to || !viewer.canSeeFolder(to.id)) throw notFound();
    const raw = Array.isArray(body.items) ? body.items : [];
    const items: Item[] = [];
    for (const entry of raw) {
      const fileId = (entry as Record<string, unknown> | null)?.fileId;
      const fromFolderId = (entry as Record<string, unknown> | null)?.fromFolderId;
      if (!isId(fileId) || !isId(fromFolderId) || !viewer.folders.has(fromFolderId)) throw notFound();
      items.push({ fileId, fromFolderId });
    }
    const files = items.length
      ? await rows<FileRow>(pool, "SELECT * FROM files WHERE id = ANY($1)", [items.map((i) => i.fileId)])
      : [];
    const byId = new Map(files.map((f) => [f.id, f]));
    for (const item of items) {
      const file = byId.get(item.fileId);
      if (!file || viewer.fileRole(file) === null) throw notFound();
    }
    if (!viewer.staff) {
      const sources = new Set(items.map((i) => byId.get(i.fileId)?.folder_id ?? i.fromFolderId));
      if (viewer.folderRole(to.id) !== "editor" || [...sources].some((s) => viewer.folderRole(s) !== "editor")) throw forbidden();
    }
    const key = keyOf(req.headers["idempotency-key"]);
    const stored = await replay(pool, session.person.id, SCOPE, key, body);
    if (stored) {
      sendJson(res, stored.status, stored.body, { "idempotent-replayed": "true" });
      return;
    }
    if (!Array.isArray(body.items) || items.length < 1 || items.length > MAX_ITEMS || new Set(items.map((i) => i.fileId)).size !== items.length) {
      throw invalid({ items: "Choose 1 to 500 different files." });
    }
    const result = await tx(async (client) => {
      await client.query("SELECT id FROM files WHERE id = ANY($1) ORDER BY id FOR UPDATE", [items.map((i) => i.fileId)]);
      const out: MoveResult = { toFolder: { id: to.id, name: to.name }, moved: [], stayed: [], lostTo: [], unchanged: [], folderCounts: {} };
      const touched = new Set<string>([to.id, ...items.map((i) => i.fromFolderId)]);
      for (const item of items) {
        const file = await first<FileRow>(client, "SELECT * FROM files WHERE id = $1 AND binned_date IS NULL", [item.fileId]);
        if (!file) throw notFound();
        if (file.locked) {
          out.stayed.push({ fileId: file.id, reason: "locked" });
        } else if (file.folder_id === to.id && item.fromFolderId === to.id) {
          out.unchanged.push(file.id);
        } else {
          const moved = file.folder_id === item.fromFolderId && await client.query(
            "UPDATE files SET folder_id = $2 WHERE id = $1 AND folder_id = $3 AND NOT locked AND binned_date IS NULL", [file.id, to.id, item.fromFolderId]);
          if (moved && moved.rowCount) {
            const from = viewer.folders.get(item.fromFolderId);
            out.moved.push({ fileId: file.id, fromFolderId: item.fromFolderId });
            await record(client, {
              actor: session.person, action: "moved", fileId: file.id, folderId: to.id,
              detail: { name: file.name, from: { id: item.fromFolderId, name: from?.name ?? "" }, to: { id: to.id, name: to.name } },
            });
          } else {
            out.lostTo.push({ fileId: file.id, folder: viewer.shownFolder(file.folder_id), by: await placedBy(client, file.id) });
          }
        }
      }
      const counts = await rows<{ folder_id: string; n: number }>(client,
        "SELECT folder_id, count(*)::int AS n FROM files WHERE folder_id = ANY($1) AND binned_date IS NULL GROUP BY folder_id", [[...touched]]);
      for (const id of touched) out.folderCounts[id] = counts.find((c) => c.folder_id === id)?.n ?? 0;
      if (out.moved.length) {
        await publish(client, { kind: "moved", by: { id: session.person.id, name: session.person.name }, toFolder: { id: to.id, name: to.name }, items: out.moved });
      }
      await remember(client, session.person.id, SCOPE, key, body, { status: 200, body: out });
      return out;
    }).catch(async (error: unknown) => {
      const raced = isUniqueViolation(error) ? await replay(pool, session.person.id, SCOPE, key, body) : null;
      if (!raced) throw error;
      return raced;
    });
    if ("status" in result) sendJson(res, result.status, result.body, { "idempotent-replayed": "true" });
    else sendJson(res, 200, result);
  });
}
