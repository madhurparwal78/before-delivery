import type { Router, Ctx } from './http.js';
import { HttpError, sendJson, newId, config, studioInstant } from './util.js';
import { isUuid, notFound, requireUser } from './auth.js';
import type { UserRow } from './auth.js';
import {
  checkUpload,
  createDownloadLink,
  getDownloadLink,
  insertFile,
  listProjectFiles,
  type FileRow,
} from './files.js';
import { assetKey, deliverableKey, getObject, invoiceKey, putObject } from './storage.js';
import { queueEmail } from './billing.js';

export interface ProjectRow {
  id: string;
  orderId: string;
  businessName: string;
  planName: string;
  closedAt: Date | null;
  orderNumber: string;
  state: string;
}

export async function listVisibleProjects(ctx: Ctx): Promise<ProjectRow[]> {
  const user = requireUser(ctx.session);
  if (user.role === 'studio_owner') {
    const result = await ctx.db.query(
      `SELECT p.id, p.order_id, p.business_name, p.plan_name, p.closed_at, o.number AS order_number, o.state
       FROM projects p JOIN orders o ON o.id = p.order_id ORDER BY o.number ASC`,
    );
    return (result.rows as Record<string, unknown>[]).map(mapProjectRow);
  }
  if (user.role === 'contractor') {
    const result = await ctx.db.query(
      `SELECT DISTINCT p.id, p.order_id, p.business_name, p.plan_name, p.closed_at, o.number AS order_number, o.state
       FROM projects p
       JOIN assignments a ON a.project_id = p.id
       JOIN orders o ON o.id = p.order_id
       WHERE a.contractor_id = $1 AND p.closed_at IS NULL
       ORDER BY o.number ASC`,
      [user.id],
    );
    return (result.rows as Record<string, unknown>[]).map(mapProjectRow);
  }
  if (user.role === 'client_owner' || user.role === 'teammate') {
    const result = await ctx.db.query(
      `SELECT p.id, p.order_id, p.business_name, p.plan_name, p.closed_at, o.number AS order_number, o.state
       FROM projects p
       JOIN orders o ON o.id = p.order_id
       WHERE o.account_id = $1
       ORDER BY o.number ASC`,
      [user.accountId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapProjectRow);
  }
  return [];
}

function mapProjectRow(row: Record<string, unknown>): ProjectRow {
  return {
    id: row.id as string,
    orderId: row.order_id as string,
    businessName: row.business_name as string,
    planName: row.plan_name as string,
    closedAt: row.closed_at ? new Date(row.closed_at as Date) : null,
    orderNumber: row.order_number as string,
    state: row.state as string,
  };
}

export interface VisibleProject {
  row: ProjectRow;
  access: 'client' | 'contractor' | 'studio';
  isClosed: boolean;
}

export async function loadVisibleProject(ctx: Ctx, projectId: string): Promise<VisibleProject> {
  const user = requireUser(ctx.session);
  if (!isUuid(projectId)) throw notFound();
  const projects = await listVisibleProjects(ctx);
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    // a contractor whose project closed gets the access-ended response
    if (user.role === 'contractor') {
      const result = await ctx.db.query(
        `SELECT 1 FROM projects p JOIN assignments a ON a.project_id = p.id JOIN orders o ON o.id = p.order_id
         WHERE p.id = $1 AND a.contractor_id = $2`,
        [projectId, user.id],
      );
      if ((result.rowCount ?? 0) > 0) {
        throw new HttpError(403, 'access_ended', 'Your access to this project ended when it closed.');
      }
    }
    throw notFound();
  }
  const access = user.role === 'studio_owner' ? 'studio' : user.role === 'contractor' ? 'contractor' : 'client';
  return { row: project, access, isClosed: project.closedAt !== null };
}

export function registerPortalRoutes(router: Router): void {
  router.get('/api/projects', async (ctx) => {
    const projects = await listVisibleProjects(ctx);
    sendJson(ctx.res, 200, {
      projects: projects.map((p) => ({
        id: p.id,
        orderNumber: p.orderNumber,
        businessName: p.businessName,
        planName: p.planName,
        state: p.state,
        closedAt: p.closedAt ? studioInstant(p.closedAt) : null,
      })),
    });
  });

  router.get('/api/projects/{id}', async (ctx) => {
    const project = await loadVisibleProject(ctx, ctx.params['id']!);
    const assets = await listProjectFiles(ctx.db, project.row.id, 'asset');
    const deliverables = await listProjectFiles(ctx.db, project.row.id, 'deliverable');
    let contractors: { id: string; name: string }[] = [];
    if (project.access !== 'contractor') {
      const result = await ctx.db.query(
        'SELECT u.id, u.name FROM assignments a JOIN users u ON u.id = a.contractor_id WHERE a.project_id = $1',
        [project.row.id],
      );
      contractors = (result.rows as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }));
    }
    sendJson(ctx.res, 200, {
      id: project.row.id,
      orderId: project.row.orderId,
      orderNumber: project.row.orderNumber,
      businessName: project.row.businessName,
      planName: project.row.planName,
      state: project.row.state,
      closedAt: project.row.closedAt ? studioInstant(project.row.closedAt) : null,
      assets: assets.map(fileToJson),
      deliverables: deliverables.map(fileToJson),
      contractors,
    });
  });

  router.post('/api/projects/{id}/assets', async (ctx) => {
    await uploadRoute(ctx, 'asset');
  });
  router.post('/api/projects/{id}/deliverables', async (ctx) => {
    await uploadRoute(ctx, 'deliverable');
  });

  router.post('/api/files/{id}/links', async (ctx) => {
    const user = requireUser(ctx.session);
    const file = await loadVisibleFile(ctx, ctx.params['id']!, user);
    const link = await createDownloadLink(ctx.db, { fileId: file.id, invoiceId: null, userId: user.id });
    sendJson(ctx.res, 201, { url: link.url, expiresAt: studioInstant(link.expiresAt) });
  });

  router.post('/api/invoices/{id}/links', async (ctx) => {
    const user = requireUser(ctx.session);
    if (user.role !== 'client_owner') throw notFound();
    const record = await ctx.db.query('SELECT * FROM invoice_records WHERE invoice_id = $1 AND account_id = $2', [
      ctx.params['id']!,
      user.accountId,
    ]);
    if ((record.rowCount ?? 0) === 0) throw notFound();
    const row = record.rows[0] as { invoice_id: string; order_id: string; pdf_stored_at: Date | null };
    if (!row.pdf_stored_at) {
      throw new HttpError(409, 'pdf_pending', 'The PDF for this invoice is not ready yet. Try again in a moment.');
    }
    const link = await createDownloadLink(ctx.db, { fileId: null, invoiceId: row.invoice_id, userId: user.id });
    sendJson(ctx.res, 201, { url: link.url, expiresAt: studioInstant(link.expiresAt) });
  });

  router.get('/download/{token}', async (ctx) => {
    const user = requireUser(ctx.session);
    const token = ctx.params['token']!;
    if (!isUuid(token)) throw notFound();
    const link = await getDownloadLink(ctx.db, token);
    if (!link || link.userId !== user.id) throw notFound();
    if (link.expiresAt < new Date()) {
      throw new HttpError(410, 'link_expired', 'This download link expired. Press Download again.');
    }
    if (link.fileId) {
      const file = await loadVisibleFile(ctx, link.fileId, user);
      const project = await loadVisibleProject(ctx, file.projectId);
      let bytes: Buffer;
      try {
        const object = await getObject(objectKeyFor(file, project.row.orderId));
        bytes = object?.body ?? Buffer.alloc(0);
      } catch {
        throw new HttpError(503, 'storage_unavailable', 'File storage is unavailable. Your file was not uploaded. Try again in a minute.');
      }
      streamDownload(ctx, bytes, file.name, contentTypeFor(file.type));
      return;
    }
    if (link.invoiceId) {
      const record = await ctx.db.query('SELECT * FROM invoice_records WHERE invoice_id = $1', [link.invoiceId]);
      if ((record.rowCount ?? 0) === 0) throw notFound();
      const row = record.rows[0] as { invoice_id: string; order_id: string; account_id: string };
      if (user.role !== 'studio_owner' && user.accountId !== row.account_id) throw notFound();
      if (!row.order_id) throw notFound();
      let bytes: Buffer;
      try {
        const object = await getObject(invoiceKey(row.order_id, row.invoice_id));
        if (!object) throw notFound();
        bytes = object.body;
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(503, 'storage_unavailable', 'File storage is unavailable. Your file was not uploaded. Try again in a minute.');
      }
      streamDownload(ctx, bytes, `${row.invoice_id}.pdf`, 'application/pdf');
      return;
    }
    throw notFound();
  });

  router.post('/api/projects/{id}/invites', async (ctx) => {
    const user = requireUser(ctx.session);
    if (user.role !== 'client_owner') {
      throw new HttpError(403, 'forbidden', 'Only the client owner may invite a teammate.');
    }
    const project = await loadVisibleProject(ctx, ctx.params['id']!);
    const body = await ctx.body<{ email?: string }>();
    const email = String(body.email ?? '').trim().toLowerCase();
    const fields: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter a valid email address.';
    else {
      const existing = await ctx.db.query('SELECT id FROM users WHERE email = $1', [email]);
      if ((existing.rowCount ?? 0) > 0) fields.email = 'This person already has a Pampero Ledger sign-in.';
    }
    if (Object.keys(fields).length > 0) {
      throw new HttpError(422, 'invalid_invite', 'Check the email address.', fields);
    }
    const id = newId();
    const token = newId();
    const expiresAt = new Date(Date.now() + config.inviteTtlSeconds * 1000);
    await ctx.db.query(
      'INSERT INTO invites (id, token, email, account_id, project_id, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())',
      [id, token, email, user.accountId, project.row.id, expiresAt.toISOString()],
    );
    await queueEmail(ctx.db, {
      to: email,
      subject: `Join ${project.row.businessName} on Pampero Ledger`,
      body: [
        `${project.row.businessName} invited you to work with them on Pampero Ledger.`,
        '',
        `Accept the invite at ${config.publicUrl}/invite/${token}`,
      ].join('\n'),
    });
    sendJson(ctx.res, 201, { invite: { id, email, expiresAt: studioInstant(expiresAt) } });
  });

  router.get('/api/invites/{token}', async (ctx) => {
    const invite = await loadInvite(ctx, ctx.params['token']!);
    const account = await ctx.db.query('SELECT business_name FROM accounts WHERE id = $1', [invite.account_id]);
    const project = await ctx.db.query('SELECT business_name, plan_name FROM projects WHERE id = $1', [invite.project_id]);
    sendJson(ctx.res, 200, {
      businessName: (account.rows[0] as { business_name: string }).business_name,
      projectName: (project.rows[0] as { plan_name: string }).plan_name,
      email: invite.email,
    });
  });

  router.post('/api/invites/{token}/accept', async (ctx) => {
    const body = await ctx.body<{ name?: string; password?: string }>();
    const invite = await loadInvite(ctx, ctx.params['token']!);
    const fields: Record<string, string> = {};
    const name = String(body.name ?? '').trim();
    const password = String(body.password ?? '');
    if (name.length < 1 || name.length > 80) fields.name = 'Enter your name, up to 80 characters.';
    if (password.length < 10) fields.password = 'Choose a password of at least 10 characters.';
    if (Object.keys(fields).length > 0) {
      throw new HttpError(422, 'invalid_invite_accept', 'Check the form fields.', fields);
    }
    const claimed = await ctx.db.query(
      'UPDATE invites SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id',
      [invite.id],
    );
    if ((claimed.rowCount ?? 0) === 0) {
      throw new HttpError(409, 'invite_used', 'This invite was already used.');
    }
    const { createUser } = await import('./auth.js');
    const user = await createUser(ctx.db, { accountId: invite.account_id, name, email: invite.email, role: 'teammate', password });
    const { createSession } = await import('./auth.js');
    const sessionId = await createSession(ctx.db, user.id);
    ctx.res.setHeader('Set-Cookie', `pampero_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    sendJson(ctx.res, 201, { user, projectId: invite.project_id });
  });
}

async function loadInvite(ctx: Ctx, token: string): Promise<{ id: string; email: string; account_id: string; project_id: string; expires_at: Date; used_at: Date | null }> {
  if (!isUuid(token)) throw notFound();
  const result = await ctx.db.query('SELECT * FROM invites WHERE token = $1', [token]);
  if ((result.rowCount ?? 0) === 0) throw notFound();
  const row = result.rows[0] as Record<string, unknown>;
  const invite = {
    id: row.id as string,
    email: row.email as string,
    account_id: row.account_id as string,
    project_id: row.project_id as string,
    expires_at: new Date(row.expires_at as Date),
    used_at: row.used_at ? new Date(row.used_at as Date) : null,
  };
  if (invite.used_at) throw new HttpError(409, 'invite_used', 'This invite was already used.');
  if (invite.expires_at < new Date()) throw new HttpError(410, 'invite_expired', 'This invite expired. Ask your client to send a new one.');
  return invite;
}

function objectKeyFor(file: FileRow, orderId: string): string {
  return file.kind === 'asset' ? assetKey(orderId, file.id, file.name) : deliverableKey(orderId, file.id, file.name);
}

function contentTypeFor(type: string): string {
  switch (type) {
    case 'PNG': return 'image/png';
    case 'JPEG': return 'image/jpeg';
    case 'WEBP': return 'image/webp';
    case 'SVG': return 'image/svg+xml';
    case 'PDF': return 'application/pdf';
    case 'WOFF2': return 'font/woff2';
    case 'OTF': return 'font/otf';
    case 'TTF': return 'font/ttf';
    default: return 'application/octet-stream';
  }
}

async function loadVisibleFile(ctx: Ctx, fileId: string, user: UserRow): Promise<FileRow> {
  if (!isUuid(fileId)) throw notFound();
  const result = await ctx.db.query('SELECT * FROM files WHERE id = $1', [fileId]);
  if ((result.rowCount ?? 0) === 0) throw notFound();
  const row = result.rows[0] as Record<string, unknown>;
  const file: FileRow = {
    id: row.id as string,
    projectId: row.project_id as string,
    kind: row.kind as 'asset' | 'deliverable',
    name: row.name as string,
    type: row.type as string,
    size: Number(row.size),
    uploadedBy: row.uploaded_by as string | null,
    uploadedAt: new Date(row.uploaded_at as Date),
  };
  // every use re-checks the requester's current access to the file's project
  await loadVisibleProject(ctx, file.projectId);
  void user;
  return file;
}

async function uploadRoute(ctx: Ctx, kind: 'asset' | 'deliverable'): Promise<void> {
  const user = requireUser(ctx.session);
  const project = await loadVisibleProject(ctx, ctx.params['id']!);
  const contentType = ctx.req.headers['content-type'] ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send the file as multipart form data.');
  }
  if (kind === 'asset' && user.role !== 'client_owner' && user.role !== 'teammate') {
    throw new HttpError(403, 'forbidden', 'Only the client team may upload brand assets.');
  }
  if (kind === 'deliverable' && user.role !== 'studio_owner' && user.role !== 'contractor') {
    throw new HttpError(403, 'forbidden', 'Only the studio may upload deliverables.');
  }
  if (user.role === 'contractor' && project.access !== 'contractor') throw notFound();
  const raw = await ctx.rawBody();
  const parsed = parseMultipart(contentType, raw);
  if (!parsed) {
    throw new HttpError(422, 'invalid_upload', 'Choose a file to upload.', { file: 'Choose a file to upload.' });
  }
  const { filename, bytes } = parsed;
  if (project.isClosed || project.row.closedAt) {
    if (user.role === 'contractor') {
      throw new HttpError(403, 'access_ended', 'Your access to this project ended when it closed.');
    }
    throw new HttpError(409, 'project_closed', 'This project is closed.');
  }
  const checked = checkUpload(filename, bytes);
  const file = await insertFile(ctx.db, {
    projectId: project.row.id,
    kind,
    name: filename,
    type: checked.type,
    size: bytes.length,
    uploadedBy: user.id,
  });
  try {
    await putObject(objectKeyFor(file, project.row.orderId), bytes, contentTypeFor(checked.type));
  } catch {
    await ctx.db.query('DELETE FROM files WHERE id = $1', [file.id]);
    throw new HttpError(503, 'storage_unavailable', 'File storage is unavailable. Your file was not uploaded. Try again in a minute.');
  }
  sendJson(ctx.res, 201, fileToJson(file));
}

export function fileToJson(file: FileRow): Record<string, unknown> {
  return {
    id: file.id,
    kind: file.kind,
    name: file.name,
    type: file.type,
    size: file.size,
    uploadedBy: file.uploadedBy,
    uploadedAt: studioInstant(file.uploadedAt),
  };
}

/** Parse a multipart/form-data body with one field named file. */
export function parseMultipart(contentType: string, body: Buffer): { filename: string; bytes: Buffer } | null {
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!boundaryMatch) return null;
  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  const start = body.indexOf(boundary);
  if (start < 0) return null;
  let searchFrom = start + boundary.length;
  let filePart: { filename: string; bytes: Buffer } | null = null;
  for (;;) {
    const next = body.indexOf(boundary, searchFrom);
    const part = body.subarray(searchFrom, next < 0 ? body.length : next);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd >= 0) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const nameMatch = /name="([^"]*)"/.exec(headers);
      const filenameMatch = /filename="([^"]*)"/.exec(headers);
      if (nameMatch?.[1] === 'file' && filenameMatch) {
        let filename = filenameMatch[1]!;
        // RFC 2231/5987: take the last path segment and decode simple escapes
        filename = filename.split(/[/\\]/).pop() ?? filename;
        try {
          filename = decodeURIComponent(filename);
        } catch {
          // keep raw
        }
        filePart = { filename, bytes: part.subarray(headerEnd + 4, part.length - 2) };
      }
    }
    if (next < 0) break;
    searchFrom = next + boundary.length;
  }
  return filePart;
}

function streamDownload(ctx: Ctx, bytes: Buffer, filename: string, contentType: string): void {
  ctx.res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': bytes.length.toString(),
    'Content-Disposition': `attachment; filename="${filename.replace(/(["\\])/g, '\\$1')}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  ctx.res.end(bytes);
}
