import { Tx } from '../db.js';
import {
  computeSpan,
  moveSuggestionAnchor,
  moveThreadAnchor,
  ReplacedSpan,
  spanOfReplacement,
} from '../../shared/anchors.js';
import { newId, sha256Hex } from './ids.js';
import { FileRow } from './shapes.js';
import { findTemplate, TemplateId } from './templates.js';

export interface Actor {
  id: string;
  displayName: string;
  handle: string;
}

export type EntryKind =
  | 'created'
  | 'save'
  | 'accept'
  | 'file_create'
  | 'file_rename'
  | 'file_delete'
  | 'upload'
  | 'restore';

export async function liveFiles(tx: Tx, projectId: string): Promise<FileRow[]> {
  return tx.query<FileRow>(
    `select * from files where project_id = $1 and deleted = false order by path`,
    [projectId],
  );
}

export async function liveFileById(
  tx: Tx,
  projectId: string,
  fileId: string,
): Promise<FileRow | null> {
  return tx.one<FileRow>(
    `select * from files where project_id = $1 and id = $2 and deleted = false`,
    [projectId, fileId],
  );
}

async function bumpProjectRevision(tx: Tx, projectId: string): Promise<number> {
  const row = await tx.one<{ project_revision: number }>(
    `update projects set project_revision = project_revision + 1
     where id = $1 returning project_revision`,
    [projectId],
  );
  return (row as { project_revision: number }).project_revision;
}

async function appendEntry(
  tx: Tx,
  projectId: string,
  projectRevision: number,
  kind: EntryKind,
  summary: string,
  actor: Actor,
): Promise<void> {
  await tx.query(
    `insert into ledger_entries
       (project_id, project_revision, kind, summary, actor_id, actor_display_name, actor_handle)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [projectId, projectRevision, kind, summary, actor.id, actor.displayName, actor.handle],
  );
}

async function snapshotRevision(
  tx: Tx,
  projectId: string,
  projectRevision: number,
): Promise<void> {
  await tx.query(
    `insert into revision_files
       (project_id, project_revision, file_id, path, kind, file_revision, size, sha256)
     select project_id, $2, id, path, kind, revision, size, sha256
       from files where project_id = $1 and deleted = false`,
    [projectId, projectRevision],
  );
}

/** One committed change to a project's files: a ledger entry and a new revision. */
async function commitChange(
  tx: Tx,
  projectId: string,
  kind: EntryKind,
  summary: string,
  actor: Actor,
): Promise<number> {
  const projectRevision = await bumpProjectRevision(tx, projectId);
  await appendEntry(tx, projectId, projectRevision, kind, summary, actor);
  await snapshotRevision(tx, projectId, projectRevision);
  return projectRevision;
}

interface AnchorRow {
  id: string;
  from_pos: number;
  to_pos: number;
}

/** Moves every open suggestion and unorphaned thread of one file by the span. */
async function applySpanToAnchors(
  tx: Tx,
  fileId: string,
  span: ReplacedSpan,
  exceptSuggestionId: string | null,
): Promise<void> {
  const suggestions = await tx.query<AnchorRow>(
    `select id, from_pos, to_pos from suggestions
      where file_id = $1 and status = 'open' and ($2::text is null or id <> $2)`,
    [fileId, exceptSuggestionId],
  );
  for (const row of suggestions) {
    const moved = moveSuggestionAnchor(row.from_pos, row.to_pos, span);
    if (moved.orphaned) {
      await tx.query(
        `update suggestions
            set status = 'orphaned', orphaned_at = now(), from_pos = null, to_pos = null
          where id = $1`,
        [row.id],
      );
    } else if (moved.from !== row.from_pos || moved.to !== row.to_pos) {
      await tx.query(`update suggestions set from_pos = $2, to_pos = $3 where id = $1`, [
        row.id,
        moved.from,
        moved.to,
      ]);
    }
  }

  const threads = await tx.query<AnchorRow>(
    `select id, from_pos, to_pos from threads where file_id = $1 and orphaned_at is null`,
    [fileId],
  );
  for (const row of threads) {
    const moved = moveThreadAnchor(row.from_pos, row.to_pos, span);
    if (moved.orphaned) {
      await tx.query(
        `update threads set orphaned_at = now(), from_pos = null, to_pos = null where id = $1`,
        [row.id],
      );
    } else if (moved.from !== row.from_pos || moved.to !== row.to_pos) {
      await tx.query(`update threads set from_pos = $2, to_pos = $3 where id = $1`, [
        row.id,
        moved.from,
        moved.to,
      ]);
    }
  }
}

/** Removing a file from the current tree orphans its open review items. */
async function orphanFileAnchors(tx: Tx, fileId: string): Promise<void> {
  await tx.query(
    `update suggestions
        set status = 'orphaned', orphaned_at = now(), from_pos = null, to_pos = null
      where file_id = $1 and status = 'open'`,
    [fileId],
  );
  await tx.query(
    `update threads set orphaned_at = now(), from_pos = null, to_pos = null
      where file_id = $1 and orphaned_at is null`,
    [fileId],
  );
}

async function writeTextRevision(
  tx: Tx,
  file: FileRow,
  content: string,
  path: string,
): Promise<FileRow> {
  const size = Buffer.byteLength(content, 'utf8');
  const digest = sha256Hex(Buffer.from(content, 'utf8'));
  const updated = await tx.one<FileRow>(
    `update files
        set content = $2, size = $3, sha256 = $4, revision = revision + 1,
            path = $5, deleted = false
      where id = $1
      returning *`,
    [file.id, content, size, digest, path],
  );
  const row = updated as FileRow;
  await tx.query(
    `insert into file_revisions (file_id, revision, path, content, size, sha256)
     values ($1, $2, $3, $4, $5, $6)`,
    [row.id, row.revision, row.path, content, size, digest],
  );
  return row;
}

async function insertFile(
  tx: Tx,
  projectId: string,
  values: {
    id?: string;
    kind: 'text' | 'asset';
    path: string;
    content: string | null;
    size: number;
    sha256: string;
    contentType: string | null;
  },
): Promise<FileRow> {
  const id = values.id ?? newId('f');
  const row = await tx.one<FileRow>(
    `insert into files (id, project_id, kind, path, revision, content, size, sha256, content_type)
     values ($1, $2, $3, $4, 1, $5, $6, $7, $8)
     returning *`,
    [
      id,
      projectId,
      values.kind,
      values.path,
      values.content,
      values.size,
      values.sha256,
      values.contentType,
    ],
  );
  const file = row as FileRow;
  await tx.query(
    `insert into file_revisions (file_id, revision, path, content, size, sha256)
     values ($1, 1, $2, $3, $4, $5)`,
    [file.id, file.path, values.content, values.size, values.sha256],
  );
  return file;
}

export async function createProjectFromTemplate(
  tx: Tx,
  input: { workspaceId: string; title: string; templateId: TemplateId; actor: Actor },
): Promise<string> {
  const template = findTemplate(input.templateId);
  if (template === null) throw new Error('unknown template');
  const projectId = newId('p');
  await tx.query(
    `insert into projects (id, workspace_id, title, template, project_revision)
     values ($1, $2, $3, $4, 1)`,
    [projectId, input.workspaceId, input.title, template.id],
  );
  await tx.query(`insert into memberships (project_id, user_id, role) values ($1, $2, 'owner')`, [
    projectId,
    input.actor.id,
  ]);
  for (const file of template.files) {
    await insertFile(tx, projectId, {
      kind: 'text',
      path: file.path,
      content: file.content,
      size: Buffer.byteLength(file.content, 'utf8'),
      sha256: sha256Hex(Buffer.from(file.content, 'utf8')),
      contentType: null,
    });
  }
  await appendEntry(
    tx,
    projectId,
    1,
    'created',
    `Created from template ${template.name}`,
    input.actor,
  );
  await snapshotRevision(tx, projectId, 1);
  return projectId;
}

export async function createTextFile(
  tx: Tx,
  input: { projectId: string; path: string; content: string; actor: Actor },
): Promise<{ file: FileRow; projectRevision: number }> {
  const file = await insertFile(tx, input.projectId, {
    kind: 'text',
    path: input.path,
    content: input.content,
    size: Buffer.byteLength(input.content, 'utf8'),
    sha256: sha256Hex(Buffer.from(input.content, 'utf8')),
    contentType: null,
  });
  const projectRevision = await commitChange(
    tx,
    input.projectId,
    'file_create',
    `Created ${input.path}`,
    input.actor,
  );
  return { file, projectRevision };
}

export async function saveTextFile(
  tx: Tx,
  input: { file: FileRow; content: string; actor: Actor },
): Promise<{ file: FileRow; projectRevision: number }> {
  const span = computeSpan(input.file.content ?? '', input.content);
  const file = await writeTextRevision(tx, input.file, input.content, input.file.path);
  await applySpanToAnchors(tx, file.id, span, null);
  const projectRevision = await commitChange(
    tx,
    input.file.project_id,
    'save',
    `Saved ${file.path}`,
    input.actor,
  );
  return { file, projectRevision };
}

export async function renameFile(
  tx: Tx,
  input: { file: FileRow; path: string; actor: Actor },
): Promise<{ file: FileRow; projectRevision: number }> {
  const row = await tx.one<FileRow>(
    `update files set path = $2 where id = $1 returning *`,
    [input.file.id, input.path],
  );
  const file = row as FileRow;
  const projectRevision = await commitChange(
    tx,
    file.project_id,
    'file_rename',
    `Renamed ${input.file.path} to ${input.path}`,
    input.actor,
  );
  return { file, projectRevision };
}

export async function deleteFile(
  tx: Tx,
  input: { file: FileRow; actor: Actor },
): Promise<number> {
  await tx.query(`update files set deleted = true where id = $1`, [input.file.id]);
  await orphanFileAnchors(tx, input.file.id);
  return commitChange(
    tx,
    input.file.project_id,
    'file_delete',
    `Deleted ${input.file.path}`,
    input.actor,
  );
}

export async function createUploadedFile(
  tx: Tx,
  input: {
    id: string;
    projectId: string;
    path: string;
    kind: 'text' | 'asset';
    content: string | null;
    size: number;
    sha256: string;
    contentType: string | null;
    actor: Actor;
  },
): Promise<{ file: FileRow; projectRevision: number }> {
  const file = await insertFile(tx, input.projectId, {
    id: input.id,
    kind: input.kind,
    path: input.path,
    content: input.content,
    size: input.size,
    sha256: input.sha256,
    contentType: input.contentType,
  });
  const projectRevision = await commitChange(
    tx,
    input.projectId,
    'upload',
    `Uploaded ${input.path}`,
    input.actor,
  );
  return { file, projectRevision };
}

export async function applyAcceptedSuggestion(
  tx: Tx,
  input: {
    file: FileRow;
    suggestionId: string;
    from: number;
    to: number;
    inserted: string;
    actor: Actor;
  },
): Promise<{ file: FileRow; projectRevision: number }> {
  const old = input.file.content ?? '';
  const content = old.slice(0, input.from) + input.inserted + old.slice(input.to);
  const span = spanOfReplacement(input.from, input.to, input.inserted);
  const file = await writeTextRevision(tx, input.file, content, input.file.path);
  await applySpanToAnchors(tx, file.id, span, input.suggestionId);
  const projectRevision = await commitChange(
    tx,
    file.project_id,
    'accept',
    `Accepted a suggestion in ${file.path}`,
    input.actor,
  );
  return { file, projectRevision };
}

interface SnapshotRow {
  file_id: string;
  path: string;
  kind: 'text' | 'asset';
  file_revision: number;
  size: number;
  sha256: string;
}

export async function restoreRevision(
  tx: Tx,
  input: { projectId: string; projectRevision: number; labelName: string; actor: Actor },
): Promise<number> {
  const target = await tx.query<SnapshotRow>(
    `select file_id, path, kind, file_revision, size, sha256
       from revision_files where project_id = $1 and project_revision = $2`,
    [input.projectId, input.projectRevision],
  );
  const current = await liveFiles(tx, input.projectId);
  const targetIds = new Set(target.map((row) => row.file_id));

  await tx.query(`update files set deleted = true where project_id = $1 and deleted = false`, [
    input.projectId,
  ]);

  for (const row of current) {
    if (!targetIds.has(row.id)) await orphanFileAnchors(tx, row.id);
  }

  for (const wanted of target) {
    const live = current.find((row) => row.id === wanted.file_id);
    if (wanted.kind === 'asset') {
      await tx.query(
        `update files set deleted = false, path = $2, size = $3, sha256 = $4 where id = $1`,
        [wanted.file_id, wanted.path, wanted.size, wanted.sha256],
      );
      continue;
    }
    const stored = await tx.one<{ content: string }>(
      `select content from file_revisions where file_id = $1 and revision = $2`,
      [wanted.file_id, wanted.file_revision],
    );
    const content = stored === null ? '' : stored.content;
    if (live !== undefined && live.path === wanted.path && (live.content ?? '') === content) {
      await tx.query(`update files set deleted = false where id = $1`, [wanted.file_id]);
      continue;
    }
    const base =
      live ??
      ((await tx.one<FileRow>(`select * from files where id = $1`, [wanted.file_id])) as FileRow);
    await writeTextRevision(tx, base, content, wanted.path);
    if (live !== undefined) {
      await applySpanToAnchors(tx, wanted.file_id, computeSpan(live.content ?? '', content), null);
    }
  }

  return commitChange(
    tx,
    input.projectId,
    'restore',
    `Restored label ${input.labelName}`,
    input.actor,
  );
}
