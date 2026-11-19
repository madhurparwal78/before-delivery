// The ledger, labels and byte-identical restores.
import { replacedSpan } from "../shared/anchors.ts";
import type { Entry, Label } from "../shared/api.ts";
import { membership, personShape, requireRole } from "./access.ts";
import { signedIn } from "./auth.ts";
import { one, pool, query, transaction, type Db } from "./db.ts";
import { fail, ok, type Context, type Reply } from "./http.ts";
import { commitRevision, lockProject, textOf, treeAt, type Change } from "./projects.ts";
import { moveAnchors, orphanAnchors } from "./review.ts";
import { Fields, onlyKeys, unstorable } from "./validate.ts";

interface EntryRow {
  project_revision: number;
  kind: Entry["kind"];
  summary: string;
  actor_id: string;
  actor_name: string;
  actor_handle: string;
  at: Date;
  labels: string[] | null;
}

interface LabelRow {
  id: string;
  name: string;
  project_revision: number;
  created_at: Date;
  creator_id: string;
  creator_name: string;
  creator_handle: string;
}

function entryShape(row: EntryRow): Entry {
  return {
    projectRevision: row.project_revision,
    kind: row.kind,
    summary: row.summary,
    actor: personShape({ id: row.actor_id, display_name: row.actor_name, handle: row.actor_handle }),
    at: row.at.toISOString(),
    labels: row.labels ?? [],
  };
}

function labelShape(row: LabelRow): Label {
  return {
    id: row.id,
    name: row.name,
    projectRevision: row.project_revision,
    createdAt: row.created_at.toISOString(),
    createdBy: personShape({ id: row.creator_id, display_name: row.creator_name, handle: row.creator_handle }),
  };
}

const ENTRY_SELECT = `
  SELECT l.*, (SELECT array_agg(b.name ORDER BY b.created_at) FROM labels b
                WHERE b.project_id = l.project_id AND b.project_revision = l.project_revision) AS labels
    FROM ledger l`;

async function entries(db: Db, projectId: string): Promise<Entry[]> {
  return (await query<EntryRow>(db, `${ENTRY_SELECT} WHERE l.project_id = $1 ORDER BY l.project_revision DESC`, [projectId])).map(entryShape);
}

export async function readHistory(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const { project } = await membership(pool, user.id, ctx.params.pid ?? "");
  return ok({ entries: await entries(pool, project.id) });
}

export async function readLabels(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const { project } = await membership(pool, user.id, ctx.params.pid ?? "");
  const rows = await query<LabelRow>(pool, "SELECT * FROM labels WHERE project_id = $1 ORDER BY created_at", [project.id]);
  return ok({ labels: rows.map(labelShape) });
}

const LABEL_MESSAGE = "Enter a label of 1 to 60 characters.";

export async function createLabel(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  requireRole(access, "own");
  const name = typeof ctx.body.name === "string" ? ctx.body.name.trim() : "";
  const taken = async (): Promise<boolean> =>
    (await one(pool, "SELECT 1 FROM labels WHERE project_id = $1 AND name_key = $2", [access.project.id, name.toLowerCase()])) !== undefined;
  if (name && !unstorable(name) && (await taken())) throw fail.conflict("label_taken");
  const fields = new Fields(ctx.body, ["name", "projectRevision"]);
  fields.string("name", LABEL_MESSAGE, (value) => value.trim().length >= 1 && value.trim().length <= 60);
  const revision =
    fields.optionalInteger("projectRevision", "Choose a revision of this project.", (value) => value >= 1 && value <= access.project.revision) ??
    access.project.revision;
  fields.check();
  try {
    const row = await one<LabelRow>(
      pool,
      `INSERT INTO labels (id, project_id, name, name_key, project_revision, created_at, creator_id, creator_name, creator_handle)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [access.project.id, name, name.toLowerCase(), revision, new Date(), user.id, user.display_name, user.handle],
    );
    return ok({ label: labelShape(row as LabelRow) }, 201);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw fail.conflict("label_taken");
    throw error;
  }
}

export async function restoreLabel(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  const label = await one<LabelRow>(pool, "SELECT * FROM labels WHERE project_id = $1 AND id = $2", [access.project.id, ctx.params.lid]);
  if (!label) throw fail.notFound();
  requireRole(access, "own");
  onlyKeys(ctx.body, []);
  return transaction(async (client) => {
    const project = await lockProject(client, access.project.id);
    const target = await treeAt(client, project.id, label.project_revision);
    const current = new Map((await treeAt(client, project.id, project.revision)).map((file) => [file.id, file]));
    const wanted = new Set(target.map((file) => file.id));
    const changes: Change[] = [];
    const moves: { fileId: string; before: string; after: string }[] = [];
    const removed = [...current.values()].filter((file) => !wanted.has(file.id)).map((file) => file.id);
    for (const fileId of removed) changes.push({ kind: "remove", fileId });
    for (const file of target) {
      const now = current.get(file.id);
      const restored = file.kind === "text" ? await textOf(client, file.id, file.text_revision ?? 1) : "";
      if (!now) {
        const latest = await client.query<{ revision: number | null }>("SELECT max(revision) AS revision FROM text_revisions WHERE file_id = $1", [
          file.id,
        ]);
        const last = latest.rows[0]?.revision ?? null;
        changes.push({ kind: "add", fileId: file.id, path: file.path, textRevision: file.kind === "text" ? last : null });
        if (file.kind === "text" && last !== null && (await textOf(client, file.id, last)) !== restored) {
          changes.push({ kind: "text", fileId: file.id, content: restored });
        }
        continue;
      }
      if (now.path !== file.path) changes.push({ kind: "rename", fileId: file.id, path: file.path });
      if (file.kind === "text") {
        const before = await textOf(client, file.id, now.text_revision ?? 1);
        if (before !== restored) {
          changes.push({ kind: "text", fileId: file.id, content: restored });
          moves.push({ fileId: file.id, before, after: restored });
        }
      }
    }
    const revision = await commitRevision(client, project, { kind: "restore", summary: `Restored label ${label.name}` }, user, changes);
    await orphanAnchors(client, removed);
    for (const move of moves) await moveAnchors(client, move.fileId, replacedSpan(move.before, move.after));
    const entry = await one<EntryRow>(client, `${ENTRY_SELECT} WHERE l.project_id = $1 AND l.project_revision = $2`, [project.id, revision]);
    return ok({ projectRevision: revision, entry: entryShape(entry as EntryRow) }, 201);
  });
}
