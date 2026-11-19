import { config } from '../config.js';
import { one, query, transaction } from '../db.js';
import {
  Actor,
  createProjectFromTemplate,
  createTextFile,
  createUploadedFile,
  deleteFile,
  liveFileById,
  renameFile,
  saveTextFile,
} from '../domain/files.js';
import { newId, sha256Hex } from '../domain/ids.js';
import {
  extensionOf,
  isTextPath,
  isValidFolder,
  isValidPath,
  isValidDeviceFileName,
  joinFolder,
  PATH_MESSAGE,
} from '../domain/paths.js';
import { fileShape, FileRow, iso, ProjectSummary } from '../domain/shapes.js';
import { findTemplate } from '../domain/templates.js';
import { judgeUpload } from '../domain/uploads.js';
import {
  allowedKeys,
  checkIdempotencyKey,
  checkTextContent,
  checkTitle,
  FieldCheck,
  TEXT_BYTE_LIMIT,
} from '../domain/validation.js';
import { assetObjectKey, storage } from '../infra/storage.js';
import { Ctx, ProjectRow, Reply, requireProject, requireUser, SessionUser } from '../http/context.js';
import { ApiError, conflict, forbidden, invalid, notFound } from '../http/errors.js';
import { parseMultipart } from '../http/multipart.js';
import { Route } from '../http/router.js';
import { ProjectRole } from '../domain/roles.js';

export function actorOf(user: SessionUser): Actor {
  return { id: user.id, displayName: user.display_name, handle: user.handle };
}

function summary(project: ProjectRow, role: ProjectRole): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    template: project.template,
    role,
    projectRevision: project.project_revision,
  };
}

async function listProjects(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const rows = await query<ProjectRow & { role: ProjectRole }>(
    `select p.*, m.role from projects p
       join memberships m on m.project_id = p.id
      where m.user_id = $1
      order by p.title`,
    [user.id],
  );
  return { status: 200, body: { projects: rows.map((row) => summary(row, row.role)) } };
}

async function createProject(ctx: Ctx): Promise<Reply> {
  const user = requireUser(ctx);
  const workspace = await one<{ workspace_id: string }>(
    `select workspace_id from workspace_members where user_id = $1 and role = 'owner'`,
    [user.id],
  );
  if (workspace === null) throw forbidden();
  allowedKeys(ctx.body, ['title', 'template']);
  const title = checkTitle(ctx.body);
  const template = findTemplate(typeof ctx.body.template === 'string' ? ctx.body.template : '');
  if (template === null) throw invalid({ template: 'Unknown template.' });

  const project = await transaction(async (tx) => {
    const projectId = await createProjectFromTemplate(tx, {
      workspaceId: workspace.workspace_id,
      title,
      templateId: template.id,
      actor: actorOf(user),
    });
    return tx.one<ProjectRow>(`select * from projects where id = $1`, [projectId]);
  });
  return {
    status: 201,
    body: { project: summary(project as ProjectRow, 'owner') },
  };
}

async function readProject(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'read');
  const files = await query<FileRow>(
    `select * from files where project_id = $1 and deleted = false order by path`,
    [access.project.id],
  );
  return {
    status: 200,
    body: {
      project: summary(access.project, access.role),
      files: files.map((row) => fileShape(row, false)),
    },
  };
}

async function requireFile(projectId: string, fileId: string): Promise<FileRow> {
  const file = await one<FileRow>(
    `select * from files where project_id = $1 and id = $2 and deleted = false`,
    [projectId, fileId],
  );
  if (file === null) throw notFound();
  return file;
}

async function readFile(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'read');
  const file = await requireFile(access.project.id, ctx.params.fid);
  return { status: 200, body: { file: fileShape(file, true) } };
}

export async function rawFileReply(file: FileRow, projectId: string): Promise<Reply> {
  if (file.kind === 'text') {
    return {
      status: 200,
      bytes: Buffer.from(file.content ?? '', 'utf8'),
      contentType: 'text/plain; charset=utf-8',
    };
  }
  const bytes = await storage.get(assetObjectKey(projectId, file.id));
  if (bytes === null) throw new ApiError(503, 'storage_unavailable');
  return {
    status: 200,
    bytes,
    contentType: file.content_type ?? 'application/octet-stream',
  };
}

async function readRawFile(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'read');
  const file = await requireFile(access.project.id, ctx.params.fid);
  return rawFileReply(file, access.project.id);
}

async function createFile(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'write_files');
  allowedKeys(ctx.body, ['path', 'content']);
  const path = typeof ctx.body.path === 'string' ? ctx.body.path : '';
  if (!isValidPath(path)) throw invalid({ path: PATH_MESSAGE });
  if (!isTextPath(path)) throw invalid({ path: PATH_MESSAGE });
  const content = checkTextContent(ctx.body);

  return transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    const taken = await tx.one(
      `select 1 from files where project_id = $1 and path = $2 and deleted = false`,
      [access.project.id, path],
    );
    if (taken !== null) throw conflict('path_taken');
    const created = await createTextFile(tx, {
      projectId: access.project.id,
      path,
      content,
      actor: actorOf(access.user),
    });
    return {
      status: 201,
      body: {
        file: fileShape(created.file, true),
        projectRevision: created.projectRevision,
      },
    };
  });
}

interface StoredAnswer {
  content_hash: string;
  base_revision: number;
  http_status: number;
  body: string;
}

async function saveFile(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'write_files');
  const file = await requireFile(access.project.id, ctx.params.fid);
  const header = ctx.request.headers['idempotency-key'];
  const key = checkIdempotencyKey(typeof header === 'string' ? header : undefined);

  allowedKeys(ctx.body, ['content', 'baseRevision']);
  const check = new FieldCheck(ctx.body);
  const baseRevision = check.integer('baseRevision', { min: 1 });
  const text = check.text('content', { min: 0, max: TEXT_BYTE_LIMIT });
  if (text !== null && Buffer.byteLength(text, 'utf8') > TEXT_BYTE_LIMIT) {
    check.fail('content', 'Out of range.');
  }
  if (file.kind !== 'text') check.fail('content', 'This file is not a text file.');
  check.done();
  const content = text as string;
  const contentHash = sha256Hex(content);

  return transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    if (key !== null) {
      const stored = await tx.one<StoredAnswer>(
        `select content_hash, base_revision, http_status, body from save_answers
          where user_id = $1 and file_id = $2 and idempotency_key = $3
            and created_at > now() - make_interval(secs => $4)`,
        [access.user.id, file.id, key, config.idempotencyTtlSeconds],
      );
      if (stored !== null) {
        if (stored.content_hash !== contentHash || stored.base_revision !== baseRevision) {
          throw conflict('idempotency_key_reused');
        }
        return {
          status: stored.http_status,
          body: JSON.parse(stored.body) as unknown,
          headers: { 'Idempotent-Replayed': 'true' },
        };
      }
    }

    const current = (await tx.one<FileRow>(`select * from files where id = $1 for update`, [
      file.id,
    ])) as FileRow;

    const answer: Reply =
      current.revision !== baseRevision
        ? {
            status: 412,
            body: { error: 'stale_revision', current: fileShape(current, true) },
          }
        : await (async () => {
            const saved = await saveTextFile(tx, {
              file: current,
              content,
              actor: actorOf(access.user),
            });
            return {
              status: 200,
              body: {
                file: fileShape(saved.file, true),
                projectRevision: saved.projectRevision,
              },
            };
          })();

    if (key !== null) {
      await tx.query(
        `insert into save_answers
           (user_id, file_id, idempotency_key, content_hash, base_revision, http_status, body,
            created_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (user_id, file_id, idempotency_key) do update
            set content_hash = excluded.content_hash,
                base_revision = excluded.base_revision,
                http_status = excluded.http_status,
                body = excluded.body,
                created_at = excluded.created_at`,
        [
          access.user.id,
          file.id,
          key,
          contentHash,
          baseRevision,
          answer.status,
          JSON.stringify(answer.body),
        ],
      );
    }
    return answer;
  });
}

async function patchFile(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'write_files');
  const file = await requireFile(access.project.id, ctx.params.fid);
  allowedKeys(ctx.body, ['path']);
  const path = typeof ctx.body.path === 'string' ? ctx.body.path : '';
  if (!isValidPath(path) || extensionOf(path) !== extensionOf(file.path)) {
    throw invalid({ path: PATH_MESSAGE });
  }
  return transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    const taken = await tx.one(
      `select 1 from files where project_id = $1 and path = $2 and deleted = false and id <> $3`,
      [access.project.id, path, file.id],
    );
    if (taken !== null) throw conflict('path_taken');
    const renamed = await renameFile(tx, { file, path, actor: actorOf(access.user) });
    return {
      status: 200,
      body: {
        file: fileShape(renamed.file, true),
        projectRevision: renamed.projectRevision,
      },
    };
  });
}

async function removeFile(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'write_files');
  const file = await requireFile(access.project.id, ctx.params.fid);
  const projectRevision = await transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    const current = await liveFileById(tx, access.project.id, file.id);
    if (current === null) throw notFound();
    return deleteFile(tx, { file: current, actor: actorOf(access.user) });
  });
  return { status: 200, body: { projectRevision } };
}

async function uploadAsset(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'write_files');
  const parts = parseMultipart(ctx.request, ctx.raw);
  const unknown: Record<string, string> = {};
  for (const part of parts) {
    if (part.name !== 'file' && part.name !== 'folder') unknown[part.name] = 'Unknown field.';
  }
  if (Object.keys(unknown).length > 0) throw invalid(unknown);

  const filePart = parts.find((part) => part.name === 'file');
  if (filePart === undefined || filePart.filename === null) {
    throw invalid({ file: 'Choose a file to upload.' });
  }
  const deviceName = filePart.filename;
  if (!isValidDeviceFileName(deviceName)) throw invalid({ file: PATH_MESSAGE });

  const folderPart = parts.find((part) => part.name === 'folder');
  const extension = extensionOf(deviceName);
  const defaultFolder = extension === '.bib' ? '' : 'figures';
  const folder =
    folderPart === undefined ? defaultFolder : folderPart.bytes.toString('utf8').trim();
  if (!isValidFolder(folder)) throw invalid({ folder: PATH_MESSAGE });
  const path = joinFolder(folder, deviceName);
  if (!isValidPath(path)) throw invalid({ folder: PATH_MESSAGE });

  const taken = await one(
    `select 1 from files where project_id = $1 and path = $2 and deleted = false`,
    [access.project.id, path],
  );
  if (taken !== null) throw conflict('path_taken');

  const judgement = judgeUpload(filePart.bytes, extension);
  if (judgement.outcome === 'too_large') throw new ApiError(413, 'too_large');
  if (judgement.outcome === 'unsupported') throw new ApiError(415, 'unsupported_file_type');

  const fileId = newId('f');
  const objectKey = assetObjectKey(access.project.id, fileId);
  await storage.put(objectKey, filePart.bytes, judgement.type.contentType);

  try {
    return await transaction(async (tx) => {
      await tx.lockProject(access.project.id);
      const clash = await tx.one(
        `select 1 from files where project_id = $1 and path = $2 and deleted = false`,
        [access.project.id, path],
      );
      if (clash !== null) throw conflict('path_taken');
      const created = await createUploadedFile(tx, {
        id: fileId,
        projectId: access.project.id,
        path,
        kind: judgement.type.kind === 'bib' ? 'text' : 'asset',
        content: judgement.text,
        size: filePart.bytes.length,
        sha256: sha256Hex(filePart.bytes),
        contentType: judgement.type.contentType,
        actor: actorOf(access.user),
      });
      return {
        status: 201,
        body: {
          file: fileShape(created.file, true),
          projectRevision: created.projectRevision,
        },
      };
    });
  } catch (error) {
    await storage.remove(objectKey).catch(() => undefined);
    throw error;
  }
}

async function readRevision(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'read');
  const projectRevision = Number(ctx.params.n);
  if (!Number.isInteger(projectRevision) || projectRevision < 1) throw notFound();
  const rows = await query<{
    file_id: string;
    path: string;
    kind: string;
    size: number;
    sha256: string;
  }>(
    `select file_id, path, kind, size, sha256 from revision_files
      where project_id = $1 and project_revision = $2 order by path`,
    [access.project.id, projectRevision],
  );
  const entry = await one(
    `select 1 from ledger_entries where project_id = $1 and project_revision = $2`,
    [access.project.id, projectRevision],
  );
  if (entry === null) throw notFound();
  return {
    status: 200,
    body: {
      projectRevision,
      files: rows.map((row) => ({
        id: row.file_id,
        path: row.path,
        kind: row.kind,
        size: row.size,
        sha256: row.sha256,
      })),
    },
  };
}

async function readHistory(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'read');
  const rows = await query<{
    project_revision: number;
    kind: string;
    summary: string;
    actor_id: string;
    actor_display_name: string;
    actor_handle: string;
    at: Date;
    labels: string[] | null;
  }>(
    `select e.project_revision, e.kind, e.summary, e.actor_id, e.actor_display_name,
            e.actor_handle, e.at,
            array_remove(array_agg(l.name order by l.created_at), null) as labels
       from ledger_entries e
       left join labels l
         on l.project_id = e.project_id and l.project_revision = e.project_revision
      where e.project_id = $1
      group by e.project_revision, e.kind, e.summary, e.actor_id, e.actor_display_name,
               e.actor_handle, e.at
      order by e.project_revision desc`,
    [access.project.id],
  );
  return {
    status: 200,
    body: {
      entries: rows.map((row) => ({
        projectRevision: row.project_revision,
        kind: row.kind,
        summary: row.summary,
        actor: {
          id: row.actor_id,
          displayName: row.actor_display_name,
          handle: row.actor_handle,
        },
        at: iso(row.at),
        labels: row.labels ?? [],
      })),
    },
  };
}

export const fileRoutes: Route[] = [
  { method: 'GET', path: '/api/projects', keys: [], handler: listProjects },
  { method: 'POST', path: '/api/projects', keys: ['title', 'template'], handler: createProject },
  { method: 'GET', path: '/api/projects/:pid', keys: [], handler: readProject },
  {
    method: 'POST',
    path: '/api/projects/:pid/files',
    keys: ['path', 'content'],
    handler: createFile,
  },
  { method: 'GET', path: '/api/projects/:pid/files/:fid', keys: [], handler: readFile },
  { method: 'GET', path: '/api/projects/:pid/files/:fid/raw', keys: [], handler: readRawFile },
  {
    method: 'PUT',
    path: '/api/projects/:pid/files/:fid',
    keys: ['content', 'baseRevision'],
    handler: saveFile,
  },
  { method: 'PATCH', path: '/api/projects/:pid/files/:fid', keys: ['path'], handler: patchFile },
  { method: 'DELETE', path: '/api/projects/:pid/files/:fid', keys: [], handler: removeFile },
  {
    method: 'POST',
    path: '/api/projects/:pid/assets',
    keys: [],
    upload: true,
    handler: uploadAsset,
  },
  { method: 'GET', path: '/api/projects/:pid/revisions/:n', keys: [], handler: readRevision },
  { method: 'GET', path: '/api/projects/:pid/history', keys: [], handler: readHistory },
];
