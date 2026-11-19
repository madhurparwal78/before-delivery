// Projects, their file trees per revision and the numbered ledger.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { EntryKind, ProjectFile, TextFile } from "../shared/api.ts";
import type { PersonRow } from "./access.ts";
import { one, query, type Db } from "./db.ts";
import { fail } from "./http.ts";
import type { Template } from "./templates.ts";

export const newId = (): string => randomUUID();

type Actor = Pick<PersonRow, "id" | "display_name" | "handle">;

export interface TreeFile {
  id: string;
  path: string;
  kind: "text" | "asset";
  text_revision: number | null;
  content_type: string | null;
  size: number;
  sha256: string | null;
}

const TREE_SELECT = `
  SELECT t.file_id AS id, t.path, f.kind, t.text_revision, f.content_type,
         COALESCE(octet_length(tr.content), f.size)::int AS size, f.sha256
    FROM tree t JOIN files f ON f.id = t.file_id
    LEFT JOIN text_revisions tr ON tr.file_id = t.file_id AND tr.revision = t.text_revision
   WHERE t.project_id = $1 AND t.project_revision = $2`;

export async function treeAt(db: Db, projectId: string, revision: number): Promise<TreeFile[]> {
  return query<TreeFile>(db, `${TREE_SELECT} ORDER BY t.path COLLATE "C"`, [projectId, revision]);
}

/** A file of the project's current tree; deleted files and other projects' files are missing. */
export async function currentFile(db: Db, projectId: string, revision: number, fileId: string): Promise<TreeFile> {
  const row = await one<TreeFile>(db, `${TREE_SELECT} AND t.file_id = $3`, [projectId, revision, fileId]);
  if (!row) throw fail.notFound();
  return row;
}

export async function textOf(db: Db, fileId: string, revision: number): Promise<string> {
  const row = await one<{ content: string }>(db, "SELECT content FROM text_revisions WHERE file_id = $1 AND revision = $2", [
    fileId,
    revision,
  ]);
  return row?.content ?? "";
}

export function fileShape(file: TreeFile, content?: string): ProjectFile {
  if (file.kind === "asset") {
    return {
      id: file.id,
      path: file.path,
      kind: "asset",
      size: Number(file.size),
      contentType: file.content_type ?? "application/octet-stream",
      sha256: file.sha256 ?? "",
    };
  }
  const shaped: TextFile = { id: file.id, path: file.path, kind: "text", revision: file.text_revision ?? 1, size: Number(file.size) };
  if (content !== undefined) shaped.content = content;
  return shaped;
}

export async function textFileShape(db: Db, file: TreeFile): Promise<TextFile> {
  return fileShape(file, await textOf(db, file.id, file.text_revision ?? 1)) as TextFile;
}

export type Change =
  | { kind: "text"; fileId: string; content: string }
  | { kind: "add"; fileId: string; path: string; textRevision: number | null }
  | { kind: "remove"; fileId: string }
  | { kind: "rename"; fileId: string; path: string };

/**
 * Append one ledger entry and raise the project revision by one. The new revision's tree
 * starts as a copy of the current one and takes the given changes.
 */
export async function commitRevision(
  client: pg.PoolClient,
  project: { id: string; revision: number },
  entry: { kind: EntryKind; summary: string },
  actor: Actor,
  changes: Change[],
): Promise<number> {
  const next = project.revision + 1;
  await client.query(
    `INSERT INTO tree (project_id, project_revision, file_id, path, text_revision)
     SELECT project_id, $2, file_id, path, text_revision FROM tree WHERE project_id = $1 AND project_revision = $3`,
    [project.id, next, project.revision],
  );
  for (const change of changes) {
    if (change.kind === "text") {
      const row = await client.query<{ revision: number }>(
        `INSERT INTO text_revisions (file_id, revision, content)
         SELECT $1, COALESCE(MAX(revision), 0) + 1, $2 FROM text_revisions WHERE file_id = $1 RETURNING revision`,
        [change.fileId, change.content],
      );
      await client.query("UPDATE tree SET text_revision = $4 WHERE project_id = $1 AND project_revision = $2 AND file_id = $3", [
        project.id,
        next,
        change.fileId,
        row.rows[0]?.revision,
      ]);
    } else if (change.kind === "add") {
      await client.query(
        "INSERT INTO tree (project_id, project_revision, file_id, path, text_revision) VALUES ($1, $2, $3, $4, $5)",
        [project.id, next, change.fileId, change.path, change.textRevision],
      );
    } else if (change.kind === "remove") {
      await client.query("DELETE FROM tree WHERE project_id = $1 AND project_revision = $2 AND file_id = $3", [
        project.id,
        next,
        change.fileId,
      ]);
    } else {
      await client.query("UPDATE tree SET path = $4 WHERE project_id = $1 AND project_revision = $2 AND file_id = $3", [
        project.id,
        next,
        change.fileId,
        change.path,
      ]);
    }
  }
  await client.query(
    `INSERT INTO ledger (project_id, project_revision, kind, summary, actor_id, actor_name, actor_handle, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [project.id, next, entry.kind, entry.summary, actor.id, actor.display_name, actor.handle, new Date()],
  );
  await client.query("UPDATE projects SET revision = $2 WHERE id = $1", [project.id, next]);
  return next;
}

/** Take this project's turn for file changes and read its current revision. */
export async function lockProject(client: pg.PoolClient, projectId: string): Promise<{ id: string; revision: number }> {
  const row = await client.query<{ revision: number }>("SELECT revision FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
  const revision = row.rows[0]?.revision;
  if (revision === undefined) throw fail.notFound();
  return { id: projectId, revision };
}

export async function createProject(
  client: pg.PoolClient,
  workspaceId: string,
  title: string,
  template: Template,
  owner: Actor,
): Promise<string> {
  const projectId = newId();
  await client.query("INSERT INTO projects (id, workspace_id, title, template, revision) VALUES ($1, $2, $3, $4, 1)", [
    projectId,
    workspaceId,
    title,
    template.id,
  ]);
  await client.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, 'owner')", [projectId, owner.id]);
  for (const [path, content] of Object.entries(template.files)) {
    const fileId = newId();
    await client.query("INSERT INTO files (id, project_id, kind) VALUES ($1, $2, 'text')", [fileId, projectId]);
    await client.query("INSERT INTO text_revisions (file_id, revision, content) VALUES ($1, 1, $2)", [fileId, content]);
    await client.query(
      "INSERT INTO tree (project_id, project_revision, file_id, path, text_revision) VALUES ($1, 1, $2, $3, 1)",
      [projectId, fileId, path],
    );
  }
  await client.query(
    `INSERT INTO ledger (project_id, project_revision, kind, summary, actor_id, actor_name, actor_handle, at)
     VALUES ($1, 1, 'created', $2, $3, $4, $5, $6)`,
    [projectId, `Created from template ${template.name}`, owner.id, owner.display_name, owner.handle, new Date()],
  );
  return projectId;
}
