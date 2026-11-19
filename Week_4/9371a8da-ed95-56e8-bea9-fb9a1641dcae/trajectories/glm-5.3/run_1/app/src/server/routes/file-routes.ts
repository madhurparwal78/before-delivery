import type { Express } from 'express';
import type { RouteCtx } from './services.js';
import { requireMember } from './session-routes.js';
import { ApiError, pathTaken, staleRevision, idempotencyKeyReused, tooLarge, unsupportedFileType, storageUnavailable, invalid } from '../errors.js';
import { readJson, hasUnstorable, BODY_CAP_UPLOAD } from '../validation.js';
import { isValidPath, isValidDeviceFileName, extensionOf } from '../paths.js';
import { checkSvg } from '../svg.js';
import type { FileRow } from '../domain.js';
import { newId, sha256Hex } from '../ids.js';
import { appendLedger, applyAnchorRules, saveFileText, spanOfChange, currentText } from '../domain.js';
import { person } from './session-routes.js';

function param(req: { params: Record<string, unknown> }, key: string): string {
  const v = req.params[key];
  return typeof v === 'string' ? v : '';
}


const TEXT_EXTS = ['.tex', '.bib', '.sty', '.cls', '.bst', '.txt'];
const MAX_TEXT_BYTES = 1_000_000;

export function registerFileRoutes(app: Express, { wrap, svc }: RouteCtx): void {
  const { sql, storage, config } = svc;

  // ---- Create a text file ----
  app.post('/api/projects/:pid/files', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role !== 'owner' && role !== 'editor') throw new ApiError(403, 'forbidden');
    const body = await readJson(req, ['path', 'content']);
    const path = typeof body.path === 'string' ? body.path : '';
    const content = typeof body.content === 'string' ? body.content : '';
    const errors: Record<string, string> = {};
    if (!isValidPath(path) || !TEXT_EXTS.includes(extensionOf(path))) errors.path = 'bad path';
    if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) errors.content = 'too long';
    if (hasUnstorable(content)) errors.content = 'unstorable character';
    if (Object.keys(errors).length > 0) throw invalid(errors);
    const existing = await sql<FileRow>`
      SELECT id FROM files WHERE project_id = ${param(req, "pid")} AND path = ${path} AND deleted_at IS NULL`;
    if (existing[0]) throw pathTaken();
    const fid = newId('f');
    const buf = Buffer.from(content, 'utf8');
    const revision = await sql.begin(async (tx) => {
      await tx`
        INSERT INTO files (id, project_id, path, kind, revision, size, content_type, sha256)
        VALUES (${fid}, ${param(req, "pid")}, ${path}, 'text', 1, ${buf.length}, 'text/plain', ${sha256Hex(buf)})`;
      await tx`
        INSERT INTO file_versions (file_id, revision, content, sha256) VALUES (${fid}, 1, ${buf}, ${sha256Hex(buf)})`;
      const rev = await appendLedger(tx, param(req, "pid"), 'file_create', `Created ${path}`, person(user));
      await tx`
        INSERT INTO project_revisions (project_id, revision, file_id, path, kind, size, sha256)
        VALUES (${param(req, "pid")}, ${rev}, ${fid}, ${path}, 'text', ${buf.length}, ${sha256Hex(buf)})`;
      return rev;
    });
    const file = await sql<FileRow>`SELECT id, path, kind, revision, size, content_type FROM files WHERE id = ${fid}`;
    const f = file[0];
    res.status(201).json({
      file: { id: f.id, path: f.path, kind: 'text', revision: f.revision, size: f.size, content },
      projectRevision: revision,
    });
  }));

  // ---- Read one file ----
  app.get('/api/projects/:pid/files/:fid', wrap(async (req, res) => {
    const { role } = await requireMember(svc, req, param(req, "pid"));
    void role;
    const rows = await sql<FileRow>`
      SELECT id, path, kind, revision, size, content_type, sha256 FROM files
      WHERE project_id = ${param(req, "pid")} AND id = ${param(req, "fid")} AND deleted_at IS NULL`;
    if (!rows[0]) throw new ApiError(404, 'not_found');
    const f = rows[0];
    if (f.kind === 'text') {
      const content = await currentText(sql, f);
      res.json({ file: { id: f.id, path: f.path, kind: 'text', revision: f.revision, size: f.size, content } });
    } else {
      res.json({ file: { id: f.id, path: f.path, kind: 'asset', size: f.size, contentType: f.content_type, sha256: f.sha256 } });
    }
  }));

  app.get('/api/projects/:pid/files/:fid/raw', wrap(async (req, res) => {
    await requireMember(svc, req, param(req, "pid"));
    const rows = await sql<FileRow>`
      SELECT id, path, kind, revision, content_type FROM files
      WHERE project_id = ${param(req, "pid")} AND id = ${param(req, "fid")} AND deleted_at IS NULL`;
    if (!rows[0]) throw new ApiError(404, 'not_found');
    const f = rows[0];
    if (f.kind === 'asset') {
      const object = await storage.get(`projects/${param(req, "pid")}/assets/${f.id}`).catch(() => undefined);
      if (object === undefined) throw storageUnavailable();
      if (object === null) throw storageUnavailable();
      res.setHeader('Content-Type', f.content_type ?? 'application/octet-stream');
      res.send(object);
      return;
    }
    const content = await currentText(sql, f);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  }));

  // ---- Save with base revision and idempotency ----
  app.put('/api/projects/:pid/files/:fid', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role !== 'owner' && role !== 'editor') throw new ApiError(403, 'forbidden');
    const rawKey = req.headers['idempotency-key'];
    const idemKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (idemKey !== undefined) {
      if (typeof idemKey !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(idemKey)) {
        throw invalid({ idempotencyKey: 'bad key' });
      }
    }
    const body = await readJson(req, ['content', 'baseRevision']);
    const content = typeof body.content === 'string' ? body.content : '';
    const baseRevision = typeof body.baseRevision === 'number' ? body.baseRevision : NaN;
    const errors: Record<string, string> = {};
    if (typeof body.content !== 'string' || hasUnstorable(content)) errors.content = 'unstorable character';
    if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) errors.content = 'too long';
    if (!Number.isInteger(baseRevision) || baseRevision < 1) errors.baseRevision = 'required';
    if (Object.keys(errors).length > 0) throw invalid(errors);

    const frows = await sql<FileRow>`
      SELECT id, path, kind, revision, size FROM files
      WHERE project_id = ${param(req, "pid")} AND id = ${param(req, "fid")} AND deleted_at IS NULL
      FOR UPDATE`;
    if (!frows[0]) throw new ApiError(404, 'not_found');
    const f = frows[0];
    if (f.kind !== 'text') throw invalid({ content: 'not a text file' });

    // Stored save answers
    if (idemKey) {
      const stored = await sql<{ status: number; body: Buffer }>`
        SELECT status, body FROM saved_saves
        WHERE user_id = ${user.id} AND file_id = ${f.id} AND key = ${idemKey}
          AND created_at > now() - (${config.idempotencyTtlSeconds} || ' seconds')::interval`;
      if (stored[0]) {
        const savedBody = JSON.parse(stored[0].body.toString('utf8')) as {
          file?: { content?: string };
          projectRevision?: number;
          request?: { content?: string; baseRevision?: number };
        };
        const storedContent = savedBody.request?.content ?? savedBody.file?.content;
        const storedBase = savedBody.request?.baseRevision;
        const same = content === storedContent && baseRevision === storedBase;
        if (!same) throw idempotencyKeyReused();
        res.setHeader('Idempotent-Replayed', 'true');
        res.status(stored[0].status).json(savedBody);
        return;
      }
    }

    if (f.revision !== baseRevision) {
      const content2 = await currentText(sql, f);
      const current = {
        file: { id: f.id, path: f.path, kind: 'text', revision: f.revision, size: f.size, content: content2 },
        request: { content, baseRevision },
      };
      if (idemKey) await storeSave(user.id, f.id, idemKey, 412, current);
      delete (current as { request?: unknown }).request;
      throw staleRevision(current);
    }

    const oldText = await currentText(sql, f);
    const span = spanOfChange(oldText, content);
    const result = await sql.begin(async (tx) => {
      const r = await saveFileText(tx, param(req, "pid"), f, content, person(user), 'save', `Saved ${f.path}`);
      await applyAnchorRules(tx, param(req, "pid"), f, span);
      return r;
    });
    const answer = {
      file: { id: f.id, path: f.path, kind: 'text' as const, revision: result.fileRevision, size: Buffer.byteLength(content, 'utf8'), content },
      projectRevision: result.revision,
      request: { content, baseRevision },
    };
    if (idemKey) await storeSave(user.id, f.id, idemKey, 200, answer);
    delete (answer as { request?: unknown }).request;
    res.json(answer);
  }));

  async function storeSave(userId: string, fileId: string, key: string, status: number, body: unknown): Promise<void> {
    const json = JSON.stringify(body);
    await sql`
      INSERT INTO saved_saves (id, user_id, file_id, key, status, body)
      VALUES (${newId('ss')}, ${userId}, ${fileId}, ${key}, ${status}, ${Buffer.from(json, 'utf8')})
      ON CONFLICT (user_id, file_id, key) DO NOTHING`;
  }

  // ---- Rename ----
  app.patch('/api/projects/:pid/files/:fid', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role !== 'owner' && role !== 'editor') throw new ApiError(403, 'forbidden');
    const body = await readJson(req, ['path']);
    const path = typeof body.path === 'string' ? body.path : '';
    if (!isValidPath(path)) throw invalid({ path: 'bad path' });
    const rows = await sql<FileRow>`
      SELECT id, path, kind FROM files
      WHERE project_id = ${param(req, "pid")} AND id = ${param(req, "fid")} AND deleted_at IS NULL FOR UPDATE`;
    if (!rows[0]) throw new ApiError(404, 'not_found');
    const oldPath = rows[0].path;
    if (extensionOf(oldPath) !== extensionOf(path)) throw invalid({ path: 'extension must not change' });
    const taken = await sql`
      SELECT id FROM files WHERE project_id = ${param(req, "pid")} AND path = ${path} AND deleted_at IS NULL`;
    if (taken[0] && taken[0].id !== rows[0].id) throw pathTaken();
    const revision = await sql.begin(async (tx) => {
      await tx`UPDATE files SET path = ${path} WHERE id = ${rows[0].id}`;
      const rev = await appendLedger(tx, param(req, "pid"), 'file_rename', `Renamed ${oldPath} to ${path}`, person(user));
      await tx`
        INSERT INTO project_revisions (project_id, revision, file_id, path, kind, size, sha256)
        SELECT ${param(req, "pid")}, ${rev}, id, ${path}, kind, size, sha256 FROM files WHERE id = ${rows[0].id}`;
      return rev;
    });
    const after = await sql<FileRow>`SELECT id, path, kind, revision, size FROM files WHERE id = ${rows[0].id}`;
    const f = after[0];
    const content = await currentText(sql, f);
    res.json({
      file: f.kind === 'text'
        ? { id: f.id, path: f.path, kind: 'text', revision: f.revision, size: f.size, content }
        : { id: f.id, path: f.path, kind: 'asset', size: f.size, contentType: 'image/png', sha256: '' },
      projectRevision: revision,
    });
  }));

  // ---- Delete ----
  app.delete('/api/projects/:pid/files/:fid', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role !== 'owner' && role !== 'editor') throw new ApiError(403, 'forbidden');
    const rows = await sql<FileRow>`
      SELECT id, path FROM files
      WHERE project_id = ${param(req, "pid")} AND id = ${param(req, "fid")} AND deleted_at IS NULL FOR UPDATE`;
    if (!rows[0]) throw new ApiError(404, 'not_found');
    const revision = await sql.begin(async (tx) => {
      await tx`UPDATE files SET deleted_at = now() WHERE id = ${rows[0].id}`;
      await tx`
        UPDATE suggestions SET status = 'orphaned', from_pos = NULL, to_pos = NULL, orphaned_at = now()
        WHERE file_id = ${rows[0].id} AND status = 'open'`;
      await tx`
        UPDATE threads SET orphaned = true, from_pos = NULL, to_pos = NULL, orphaned_at = now()
        WHERE file_id = ${rows[0].id} AND orphaned = false`;
      return await appendLedger(tx, param(req, "pid"), 'file_delete', `Deleted ${rows[0].path}`, person(user));
    });
    res.json({ projectRevision: revision });
  }));

  // ---- Upload (multipart) ----
  app.post('/api/projects/:pid/assets', wrap(async (req, res) => {
    const { user, role } = await requireMember(svc, req, param(req, "pid"));
    if (role !== 'owner' && role !== 'editor') throw new ApiError(403, 'forbidden');
    const { fileBuffer, fileName, folder } = await readMultipart(req);
    const errors: Record<string, string> = {};
    if (!isValidDeviceFileName(fileName)) errors.file = 'bad name';
    if (folder !== undefined && !isValidPath(folder)) errors.folder = 'bad folder';
    if (Object.keys(errors).length > 0) throw invalid(errors);

    const judged = judgeUpload(fileBuffer, fileName);
    if (judged.error) {
      if (judged.error === 'too_large') throw tooLarge();
      throw unsupportedFileType();
    }
    const targetFolder = folder ?? (judged.kind === 'bib' ? '' : 'figures');
    const path = targetFolder ? `${targetFolder}/${fileName}` : fileName;
    const taken = await sql`
      SELECT id FROM files WHERE project_id = ${param(req, "pid")} AND path = ${path} AND deleted_at IS NULL FOR UPDATE`;
    if (taken[0]) throw pathTaken();

    const fid = newId('f');
    const objectKey = `projects/${param(req, "pid")}/assets/${fid}`;
    // The record exists only after its object has been written.
    try {
      await storage.put(objectKey, fileBuffer, judged.contentType);
    } catch {
      throw storageUnavailable();
    }
    const revision = await sql.begin(async (tx) => {
      if (judged.kind === 'bib') {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(fileBuffer);
        await tx`
          INSERT INTO files (id, project_id, path, kind, revision, size, content_type, sha256)
          VALUES (${fid}, ${param(req, "pid")}, ${path}, 'text', 1, ${fileBuffer.length}, 'text/plain', ${sha256Hex(fileBuffer)})`;
        await tx`
          INSERT INTO file_versions (file_id, revision, content, sha256)
          VALUES (${fid}, 1, ${fileBuffer}, ${sha256Hex(fileBuffer)})`;
      } else {
        await tx`
          INSERT INTO files (id, project_id, path, kind, revision, size, content_type, sha256)
          VALUES (${fid}, ${param(req, "pid")}, ${path}, 'asset', 1, ${fileBuffer.length}, ${judged.contentType}, ${sha256Hex(fileBuffer)})`;
      }
      const rev = await appendLedger(tx, param(req, "pid"), 'upload', `Uploaded ${path}`, person(user));
      await tx`
        INSERT INTO project_revisions (project_id, revision, file_id, path, kind, size, sha256)
        VALUES (${param(req, "pid")}, ${rev}, ${fid}, ${path}, ${judged.kind === 'bib' ? 'text' : 'asset'}, ${fileBuffer.length}, ${sha256Hex(fileBuffer)})`;
      return rev;
    }).catch(async (err) => {
      await storage.delete(objectKey).catch(() => {});
      throw err;
    });
    const rows = await sql<FileRow>`SELECT id, path, kind, revision, size, content_type, sha256 FROM files WHERE id = ${fid}`;
    const f = rows[0];
    if (f.kind === 'text') {
      const content = new TextDecoder('utf-8', { fatal: false }).decode(fileBuffer);
      res.status(201).json({
        file: { id: f.id, path: f.path, kind: 'text', revision: f.revision, size: f.size, content },
        projectRevision: revision,
      });
    } else {
      res.status(201).json({
        file: { id: f.id, path: f.path, kind: 'asset', size: f.size, contentType: f.content_type, sha256: f.sha256 },
        projectRevision: revision,
      });
    }
  }));

  // ---- Revisions ----
  app.get('/api/projects/:pid/revisions/:n', wrap(async (req, res) => {
    await requireMember(svc, req, param(req, "pid"));
    const n = Number.parseInt(param(req, "n"), 10);
    if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found');
    const rows = await sql`
      SELECT file_id, path, kind, size, sha256 FROM project_revisions
      WHERE project_id = ${param(req, "pid")} AND revision = ${n}`;
    if (rows.length === 0) throw new ApiError(404, 'not_found');
    res.json({
      projectRevision: n,
      files: rows.map((r) => ({ id: r.file_id, path: r.path, kind: r.kind, size: r.size, sha256: r.sha256 })),
    });
  }));
}

const UPLOAD_CAP_BYTES = 10_000_000;

interface JudgedUpload {
  kind: 'image' | 'pdf' | 'svg' | 'bib';
  contentType: string;
  error?: 'too_large' | 'type';
}

function judgeUpload(buf: Buffer, name: string): JudgedUpload {
  const ext = extensionOf(name).toLowerCase();
  if (buf.length > UPLOAD_CAP_BYTES) return { kind: 'bib', contentType: '', error: 'too_large' };
  const isPng = buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';
  const isSvg = ext === '.svg' && checkSvg(buf) === null;
  const isBib = ext === '.bib';
  if (isPng && (ext === '.png')) return { kind: 'image', contentType: 'image/png' };
  if (isJpg && (ext === '.jpg' || ext === '.jpeg')) return { kind: 'image', contentType: 'image/jpeg' };
  if (isPdf && ext === '.pdf') return { kind: 'pdf', contentType: 'application/pdf' };
  if (isSvg) return { kind: 'image', contentType: 'image/svg+xml' };
  if (isBib) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return { kind: 'bib', contentType: '', error: 'type' };
    }
    if (buf.includes(0)) return { kind: 'bib', contentType: '', error: 'type' };
    return { kind: 'bib', contentType: 'text/plain' };
  }
  return { kind: 'bib', contentType: '', error: 'type' };
}

interface MultipartResult {
  fileBuffer: Buffer;
  fileName: string;
  folder: string | undefined;
}

async function readMultipart(req: import('express').Request): Promise<MultipartResult> {
  const contentType = String(req.headers['content-type'] ?? '');
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!m) throw new ApiError(400, 'malformed_json');
  const boundary = (m[1] ?? m[2]).trim();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike);
    chunks.push(buf);
    total += buf.length;
    if (total > BODY_CAP_UPLOAD) {
      throw new ApiError(413, 'too_large');
    }
  }
  const body = Buffer.concat(chunks);
  const parts: { name: string; filename?: string; data: Buffer }[] = [];
  const delim = Buffer.from(`--${boundary}`);
  let pos = 0;
  while (true) {
    const start = body.indexOf(delim, pos);
    if (start < 0) break;
    const headerStart = start + delim.length;
    if (body[headerStart] === 0x2d && body[headerStart + 1] === 0x2d) break; // closing
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd < 0) break;
    const headerText = body.subarray(headerStart, headerEnd).toString('utf8');
    const nameMatch = /name="([^"]*)"/.exec(headerText);
    const fileMatch = /filename="([^"]*)"/.exec(headerText);
    let dataEnd = body.indexOf(Buffer.from(`\r\n--${boundary}`), headerEnd + 4);
    if (dataEnd < 0) dataEnd = body.length;
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: fileMatch ? decodeURIComponent(fileMatch[1]) : undefined,
      data: body.subarray(headerEnd + 4, dataEnd),
    });
    pos = dataEnd;
  }
  const unknown = parts.filter((p) => p.name !== 'file' && p.name !== 'folder');
  if (unknown.length > 0) {
    const errors: Record<string, string> = {};
    for (const p of unknown) errors[p.name || 'body'] = 'not an allowed key';
    throw invalid(errors);
  }
  const filePart = parts.find((p) => p.name === 'file');
  const folderPart = parts.find((p) => p.name === 'folder');
  if (!filePart) throw invalid({ file: 'required' });
  return {
    fileBuffer: filePart.data,
    fileName: filePart.filename ?? '',
    folder: folderPart ? folderPart.data.toString('utf8') : undefined,
  };
}

