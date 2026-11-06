import { fieldErrors, notices } from '../shared/notices.js';
import { OpFailure, parseOp } from '../shared/ops.js';
import { findNode, findPage } from '../shared/tree.js';
import type { PlinthDocument, Role } from '../shared/types.js';
import {
  EMAIL_RE,
  authenticate,
  createAccount,
  createSession,
  deleteSession,
  findAccountByEmail,
  sessionCookie,
  sessionIdOf,
  clearedCookie,
  accountForRequest,
  type Account,
} from './auth.js';
import { config, MAX_IMAGE_BYTES } from './config.js';
import { one, query } from './db.js';
import { submitOperation, submitRestore } from './engine.js';
import { ApiError, forbiddenRole, invalidFields, notFound, unauthenticated } from './errors.js';
import {
  broadcast,
  broadcastAccepted,
  closeForRemoval,
  pushRole,
} from './hub.js';
import { newId, inviteToken } from './ids.js';
import { storeImage } from './images.js';
import { sendMail } from './mail.js';
import { publishPage, publishStatus, unpublishPage } from './publish.js';
import {
  getObject,
  imageKey,
  setStorageOutage,
  storageReachable,
} from './storage.js';
import {
  Router,
  readJson,
  readUpload,
  sendBytes,
  sendJson,
  sendNoContent,
  type RequestContext,
} from './http.js';
import {
  accessFor,
  createWorkspace,
  loadDocument,
  requireAccess,
  workspaceOfPage,
  workspacesOf,
  type WorkspaceAccess,
} from './workspaces.js';
import { seedWorkspaces } from './grading.js';

async function requireAccount(ctx: RequestContext): Promise<Account> {
  const account = await accountForRequest(ctx.request);
  if (!account) throw unauthenticated();
  return account;
}

function requireEditor(access: WorkspaceAccess): void {
  if (access.role === 'viewer') throw new ApiError(403, 'forbidden_role', notices.roleRefused);
}

function requireOwner(access: WorkspaceAccess): void {
  if (access.role !== 'owner') throw forbiddenRole();
}

async function workspaceContext(
  ctx: RequestContext,
  workspaceId: string,
): Promise<{ account: Account; access: WorkspaceAccess }> {
  const account = await requireAccount(ctx);
  const access = await requireAccess(account.id, workspaceId);
  return { account, access };
}

async function pageContext(
  ctx: RequestContext,
  pageId: string,
): Promise<{ account: Account; access: WorkspaceAccess; doc: PlinthDocument; pageId: string }> {
  const account = await requireAccount(ctx);
  const workspaceId = await workspaceOfPage(pageId);
  if (workspaceId === undefined) throw notFound();
  const access = await requireAccess(account.id, workspaceId);
  const doc = await loadDocument(workspaceId);
  return { account, access, doc, pageId };
}

function versionLineName(count: number): string {
  return `Version ${count + 1}`;
}

async function cutVersion(
  workspaceId: string,
  authorId: string,
  name: string | undefined,
  doc: PlinthDocument,
): Promise<{ id: string; name: string; createdAt: string; seq: number }> {
  const counted = await one<{ count: string }>(
    'select count(*)::text as count from versions where workspace_id = $1',
    [workspaceId],
  );
  const id = newId('v');
  const finalName = name ?? versionLineName(Number(counted?.count ?? '0'));
  const row = await one<{ created_at: string }>(
    `insert into versions (id, workspace_id, name, author_id, seq, document)
     values ($1, $2, $3, $4, $5, $6) returning created_at`,
    [id, workspaceId, finalName, authorId, doc.seq, JSON.stringify(doc)],
  );
  return { id, name: finalName, createdAt: String(row?.created_at), seq: doc.seq };
}

interface ThreadRow {
  id: string;
  page_id: string;
  node_id: string;
  node_name: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  status: 'open' | 'resolved';
  parent_id: string | null;
}

interface Thread {
  id: string;
  pageId: string;
  nodeId: string;
  nodeName: string;
  author: { id: string; name: string };
  body: string;
  createdAt: string;
  status: 'open' | 'resolved';
  replies: { id: string; author: { id: string; name: string }; body: string; createdAt: string }[];
}

async function threadsOf(workspaceId: string, pageId: string | undefined): Promise<Thread[]> {
  const rows = await query<ThreadRow>(
    `select c.id, c.page_id, c.node_id, c.node_name, c.author_id, u.name as author_name,
            c.body, c.created_at, c.status, c.parent_id
     from comments c join users u on u.id = c.author_id
     where c.workspace_id = $1 and ($2::text is null or c.page_id = $2)
     order by c.created_at asc`,
    [workspaceId, pageId ?? null],
  );
  const threads = new Map<string, Thread>();
  for (const row of rows.filter((r) => r.parent_id === null)) {
    threads.set(row.id, {
      id: row.id,
      pageId: row.page_id,
      nodeId: row.node_id,
      nodeName: row.node_name,
      author: { id: row.author_id, name: row.author_name },
      body: row.body,
      createdAt: new Date(row.created_at).toISOString(),
      status: row.status,
      replies: [],
    });
  }
  for (const row of rows.filter((r) => r.parent_id !== null)) {
    const thread = threads.get(row.parent_id!);
    if (!thread) continue;
    thread.replies.push({
      id: row.id,
      author: { id: row.author_id, name: row.author_name },
      body: row.body,
      createdAt: new Date(row.created_at).toISOString(),
    });
  }
  return [...threads.values()];
}

async function threadById(commentId: string): Promise<{ workspaceId: string; thread: Thread } | undefined> {
  const row = await one<{ workspace_id: string; page_id: string }>(
    'select workspace_id, page_id from comments where id = $1 and parent_id is null',
    [commentId],
  );
  if (!row) return undefined;
  const threads = await threadsOf(row.workspace_id, row.page_id);
  const thread = threads.find((t) => t.id === commentId);
  return thread ? { workspaceId: row.workspace_id, thread } : undefined;
}

async function mentionMails(
  workspaceId: string,
  doc: PlinthDocument,
  pageId: string,
  nodeName: string,
  body: string,
  author: Account,
): Promise<string[]> {
  const addresses = [...body.matchAll(/@([^\s@]+@[^\s@]+\.[^\s@,;]+)/g)].map((m) =>
    m[1]!.toLowerCase().replace(/[.,;]+$/, ''),
  );
  if (addresses.length === 0) return [];
  const members = await query<{ email: string; name: string }>(
    `select u.email, u.name from members m join users u on u.id = m.user_id
     where m.workspace_id = $1`,
    [workspaceId],
  );
  const page = findPage(doc, pageId);
  const failed: string[] = [];
  for (const address of new Set(addresses)) {
    const member = members.find((m) => m.email === address);
    if (!member || address === author.email) continue;
    try {
      await sendMail({
        to: member.email,
        subject: `${author.name} mentioned you on ${page?.name ?? doc.name}`,
        body:
          `${author.name} mentioned you on ${page?.name ?? doc.name}, on ${nodeName}.\n\n` +
          `"${body}"\n\n` +
          `${config.publicUrl}/w/${workspaceId}/edit?page=${pageId}\n`,
      });
    } catch {
      failed.push(member.email);
    }
  }
  return failed;
}

export function registerApi(router: Router): void {
  router.add('GET', '/api/health', (ctx) => {
    sendJson(ctx, 200, { status: 'ok' });
  });

  router.add('POST', '/api/auth/signup', async (ctx) => {
    const body = await readJson(ctx);
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    const email = typeof body['email'] === 'string' ? body['email'].trim() : '';
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    const fields: Record<string, string> = {};
    if (name === '' || name.length > 80) fields['name'] = fieldErrors.nameEmpty;
    if (!EMAIL_RE.test(email)) fields['email'] = fieldErrors.emailInvalid;
    if (password.length < 10) fields['password'] = fieldErrors.passwordShort;
    if (Object.keys(fields).length > 0) throw invalidFields(fields);
    if (await findAccountByEmail(email)) {
      throw new ApiError(409, 'email_taken', fieldErrors.emailTaken);
    }
    const account = await createAccount(name, email, password);
    const sessionId = await createSession(account.id);
    ctx.response.setHeader('set-cookie', sessionCookie(sessionId));
    sendJson(ctx, 201, { user: account });
  });

  router.add('POST', '/api/auth/signin', async (ctx) => {
    const body = await readJson(ctx);
    const email = typeof body['email'] === 'string' ? body['email'].trim() : '';
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    const account = await authenticate(email, password);
    if (!account) {
      throw new ApiError(401, 'invalid_credentials', fieldErrors.signInFailed);
    }
    const sessionId = await createSession(account.id);
    ctx.response.setHeader('set-cookie', sessionCookie(sessionId));
    sendJson(ctx, 200, { user: account });
  });

  router.add('POST', '/api/auth/signout', async (ctx) => {
    const sessionId = sessionIdOf(ctx.request);
    if (sessionId !== undefined) await deleteSession(sessionId);
    ctx.response.setHeader('set-cookie', clearedCookie());
    sendNoContent(ctx);
  });

  router.add('GET', '/api/me', async (ctx) => {
    const account = await requireAccount(ctx);
    sendJson(ctx, 200, { user: account, workspaces: await workspacesOf(account.id) });
  });

  router.add('POST', '/api/workspaces', async (ctx) => {
    const account = await requireAccount(ctx);
    const body = await readJson(ctx);
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    if (name === '' || name.length > 80) throw invalidFields({ name: fieldErrors.nameEmpty });
    const doc = await createWorkspace(account.id, name);
    sendJson(ctx, 201, {
      id: doc.id,
      name: doc.name,
      slug: doc.slug,
      pages: doc.pages.map((page) => ({ id: page.id, name: page.name, slug: page.slug })),
    });
  });

  router.add('GET', '/api/workspaces/:workspaceId/document', async (ctx) => {
    const { access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    sendJson(ctx, 200, await loadDocument(access.workspaceId));
  });

  router.add('POST', '/api/workspaces/:workspaceId/operations', async (ctx) => {
    const { account, access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    requireEditor(access);
    const body = await readJson(ctx);
    const opId = typeof body['opId'] === 'string' ? body['opId'] : '';
    if (opId === '' || opId.length > 64) {
      throw invalidFields({ opId: 'Expected an operation id of 1 to 64 characters.' });
    }
    const baseSeq = typeof body['baseSeq'] === 'number' ? body['baseSeq'] : 0;
    let parsed;
    try {
      parsed = parseOp(body);
    } catch (error) {
      if (error instanceof OpFailure) {
        throw new ApiError(error.status, error.code, error.message, error.fields);
      }
      throw error;
    }
    const accepted = await submitOperation({
      workspaceId: access.workspaceId,
      userId: account.id,
      opId,
      baseSeq,
      body: parsed,
    });
    if (!accepted.replayed) {
      broadcastAccepted(access.workspaceId, accepted, { id: account.id, name: account.name });
    }
    const response: Record<string, unknown> = { opId: accepted.opId, seq: accepted.seq };
    if (accepted.created !== undefined) response['created'] = accepted.created;
    sendJson(ctx, 200, response);
  });

  router.add('GET', '/api/workspaces/:workspaceId/operations', async (ctx) => {
    const { access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    const since = Number(ctx.url.searchParams.get('since') ?? '0');
    const rows = await query<{
      seq: string;
      op_id: string | null;
      kind: string;
      at: string;
      body: Record<string, unknown>;
      author_id: string;
      author_name: string;
    }>(
      `select o.seq, o.op_id, o.kind, o.at, o.body, o.author_id, u.name as author_name
       from operations o join users u on u.id = o.author_id
       where o.workspace_id = $1 and o.seq > $2 order by o.seq asc limit 500`,
      [access.workspaceId, Number.isFinite(since) ? since : 0],
    );
    sendJson(ctx, 200, {
      operations: rows.map((row) => ({
        seq: Number(row.seq),
        opId: row.op_id,
        kind: row.kind,
        author: { id: row.author_id, name: row.author_name },
        at: new Date(row.at).toISOString(),
        ...row.body,
      })),
    });
  });

  router.add('POST', '/api/workspaces/:workspaceId/images', async (ctx) => {
    const { access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    requireEditor(access);
    const upload = await readUpload(ctx);
    if (upload.bytes.length > MAX_IMAGE_BYTES) {
      throw new ApiError(413, 'image_too_large', notices.uploadTooBig);
    }
    const record = await storeImage(access.workspaceId, upload.fileName, upload.bytes);
    sendJson(ctx, 201, record);
  });

  router.add('GET', '/api/workspaces/:workspaceId/images', async (ctx) => {
    const { access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    const rows = await query<{ id: string; file_name: string; width: number; height: number }>(
      `select id, file_name, width, height from images
       where workspace_id = $1 and status = 'confirmed' order by created_at asc`,
      [access.workspaceId],
    );
    sendJson(ctx, 200, {
      images: rows.map((row) => ({
        id: row.id,
        status: 'confirmed',
        fileName: row.file_name,
        width: row.width,
        height: row.height,
      })),
    });
  });

  router.add('GET', '/api/images/:imageId', async (ctx) => {
    const account = await requireAccount(ctx);
    const row = await one<{ workspace_id: string }>(
      'select workspace_id from images where id = $1',
      [ctx.params['imageId']!],
    );
    if (!row) throw notFound();
    const access = await accessFor(account.id, row.workspace_id);
    if (!access) throw notFound();
    const object = await getObject(row.workspace_id, imageKey(row.workspace_id, ctx.params['imageId']!));
    sendBytes(ctx, 200, object.body, object.contentType);
  });

  router.add('GET', '/api/workspaces/:workspaceId/storage', async (ctx) => {
    const { access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    const reachable = await storageReachable(access.workspaceId);
    sendJson(ctx, 200, { status: reachable ? 'ok' : 'unavailable' });
  });

  router.add('GET', '/api/pages/:pageId/publish', async (ctx) => {
    const { doc, pageId } = await pageContext(ctx, ctx.params['pageId']!);
    const page = findPage(doc, pageId);
    if (!page) throw notFound();
    sendJson(ctx, 200, await publishStatus(doc, page));
  });

  router.add('POST', '/api/pages/:pageId/publish', async (ctx) => {
    const { access, doc, pageId } = await pageContext(ctx, ctx.params['pageId']!);
    requireEditor(access);
    const page = findPage(doc, pageId);
    if (!page) throw notFound();
    const key = ctx.request.headers['idempotency-key'];
    const idempotencyKey = typeof key === 'string' && key.length > 0 && key.length <= 64 ? key : undefined;
    const status = await publishPage(doc, page, idempotencyKey);
    sendJson(ctx, 201, status);
  });

  router.add('POST', '/api/pages/:pageId/unpublish', async (ctx) => {
    const { access, doc, pageId } = await pageContext(ctx, ctx.params['pageId']!);
    requireOwner(access);
    const page = findPage(doc, pageId);
    if (!page) throw notFound();
    sendJson(ctx, 200, await unpublishPage(doc, page));
  });

  router.add('GET', '/api/workspaces/:workspaceId/versions', async (ctx) => {
    const { access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    const rows = await query<{
      id: string;
      name: string;
      author_id: string;
      author_name: string;
      created_at: string;
      seq: string;
    }>(
      `select v.id, v.name, v.author_id, u.name as author_name, v.created_at, v.seq
       from versions v join users u on u.id = v.author_id
       where v.workspace_id = $1 order by v.created_at desc, v.seq desc`,
      [access.workspaceId],
    );
    sendJson(ctx, 200, {
      versions: rows.map((row) => ({
        id: row.id,
        name: row.name,
        author: { id: row.author_id, name: row.author_name },
        createdAt: new Date(row.created_at).toISOString(),
        seq: Number(row.seq),
      })),
    });
  });

  router.add('POST', '/api/workspaces/:workspaceId/versions', async (ctx) => {
    const { account, access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    requireEditor(access);
    const body = await readJson(ctx);
    let name: string | undefined;
    if (body['name'] !== undefined) {
      if (typeof body['name'] !== 'string' || body['name'].length < 1 || body['name'].length > 80) {
        throw invalidFields({ name: 'Expected a name of 1 to 80 characters.' });
      }
      name = body['name'];
    }
    const doc = await loadDocument(access.workspaceId);
    const version = await cutVersion(access.workspaceId, account.id, name, doc);
    sendJson(ctx, 201, {
      id: version.id,
      name: version.name,
      author: { id: account.id, name: account.name },
      createdAt: version.createdAt,
      seq: version.seq,
    });
  });

  router.add('GET', '/api/versions/:versionId', async (ctx) => {
    const account = await requireAccount(ctx);
    const row = await one<{
      id: string;
      workspace_id: string;
      name: string;
      author_id: string;
      author_name: string;
      created_at: string;
      seq: string;
      document: PlinthDocument;
    }>(
      `select v.id, v.workspace_id, v.name, v.author_id, u.name as author_name,
              v.created_at, v.seq, v.document
       from versions v join users u on u.id = v.author_id where v.id = $1`,
      [ctx.params['versionId']!],
    );
    if (!row) throw notFound();
    if (!(await accessFor(account.id, row.workspace_id))) throw notFound();
    sendJson(ctx, 200, {
      id: row.id,
      name: row.name,
      author: { id: row.author_id, name: row.author_name },
      createdAt: new Date(row.created_at).toISOString(),
      seq: Number(row.seq),
      document: row.document,
    });
  });

  router.add('POST', '/api/versions/:versionId/restore', async (ctx) => {
    const account = await requireAccount(ctx);
    const row = await one<{
      workspace_id: string;
      name: string;
      document: PlinthDocument;
    }>('select workspace_id, name, document from versions where id = $1', [
      ctx.params['versionId']!,
    ]);
    if (!row) throw notFound();
    const access = await accessFor(account.id, row.workspace_id);
    if (!access) throw notFound();
    requireEditor(access);
    const accepted = await submitRestore({
      workspaceId: row.workspace_id,
      userId: account.id,
      versionId: ctx.params['versionId']!,
      versionName: row.name,
      document: row.document,
    });
    const doc = await loadDocument(row.workspace_id);
    const version = await cutVersion(
      row.workspace_id,
      account.id,
      `Restored ${row.name}`,
      doc,
    );
    broadcastAccepted(row.workspace_id, accepted, { id: account.id, name: account.name });
    broadcast(row.workspace_id, {
      type: 'restored',
      by: { id: account.id, name: account.name },
      versionName: row.name,
      seq: accepted.seq,
    });
    sendJson(ctx, 201, {
      version: {
        id: version.id,
        name: version.name,
        author: { id: account.id, name: account.name },
        createdAt: version.createdAt,
        seq: version.seq,
      },
      seq: accepted.seq,
    });
  });

  router.add('GET', '/api/workspaces/:workspaceId/comments', async (ctx) => {
    const { access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    const pageId = ctx.url.searchParams.get('pageId') ?? undefined;
    sendJson(ctx, 200, { threads: await threadsOf(access.workspaceId, pageId) });
  });

  router.add('POST', '/api/workspaces/:workspaceId/comments', async (ctx) => {
    const { account, access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    const body = await readJson(ctx);
    const pageId = typeof body['pageId'] === 'string' ? body['pageId'] : '';
    const nodeId = typeof body['nodeId'] === 'string' ? body['nodeId'] : '';
    const text = typeof body['body'] === 'string' ? body['body'] : '';
    if (text.length < 1 || text.length > 2000) {
      throw invalidFields({ body: 'Write between 1 and 2,000 characters.' });
    }
    const doc = await loadDocument(access.workspaceId);
    const page = findPage(doc, pageId);
    if (!page) throw notFound();
    const node = findNode(doc, nodeId);
    if (!node) throw notFound();
    const id = newId('m');
    await query(
      `insert into comments (id, workspace_id, page_id, node_id, node_name, author_id, body)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, access.workspaceId, pageId, nodeId, node.node.name, account.id, text],
    );
    const found = await threadById(id);
    if (!found) throw notFound();
    broadcast(access.workspaceId, { type: 'comment', thread: found.thread });
    const mailFailed = await mentionMails(
      access.workspaceId,
      doc,
      pageId,
      node.node.name,
      text,
      account,
    );
    sendJson(ctx, 201, { ...found.thread, mailFailed });
  });

  router.add('POST', '/api/comments/:commentId/replies', async (ctx) => {
    const account = await requireAccount(ctx);
    const found = await threadById(ctx.params['commentId']!);
    if (!found) throw notFound();
    const access = await accessFor(account.id, found.workspaceId);
    if (!access) throw notFound();
    const body = await readJson(ctx);
    const text = typeof body['body'] === 'string' ? body['body'] : '';
    if (text.length < 1 || text.length > 2000) {
      throw invalidFields({ body: 'Write between 1 and 2,000 characters.' });
    }
    const id = newId('m');
    await query(
      `insert into comments (id, workspace_id, page_id, node_id, node_name, author_id, body, parent_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        found.workspaceId,
        found.thread.pageId,
        found.thread.nodeId,
        found.thread.nodeName,
        account.id,
        text,
        found.thread.id,
      ],
    );
    const updated = await threadById(found.thread.id);
    if (!updated) throw notFound();
    broadcast(found.workspaceId, { type: 'comment', thread: updated.thread });
    const doc = await loadDocument(found.workspaceId);
    const mailFailed = await mentionMails(
      found.workspaceId,
      doc,
      found.thread.pageId,
      found.thread.nodeName,
      text,
      account,
    );
    const reply = updated.thread.replies.find((item) => item.id === id);
    sendJson(ctx, 201, { ...reply, mailFailed });
  });

  const setStatus = (status: 'resolved' | 'open'): Parameters<Router['add']>[2] =>
    async (ctx) => {
      const account = await requireAccount(ctx);
      const found = await threadById(ctx.params['commentId']!);
      if (!found) throw notFound();
      const access = await accessFor(account.id, found.workspaceId);
      if (!access) throw notFound();
      if (access.role === 'viewer' && found.thread.author.id !== account.id) {
        throw forbiddenRole();
      }
      if (status === 'resolved' && found.thread.status === 'resolved') {
        throw new ApiError(409, 'already_resolved', 'That thread is already resolved.');
      }
      if (status === 'open' && found.thread.status !== 'resolved') {
        throw new ApiError(409, 'not_resolved', 'That thread is not resolved.');
      }
      await query('update comments set status = $2 where id = $1', [found.thread.id, status]);
      const updated = await threadById(found.thread.id);
      if (!updated) throw notFound();
      broadcast(found.workspaceId, { type: 'comment', thread: updated.thread });
      sendJson(ctx, 200, updated.thread);
    };

  router.add('POST', '/api/comments/:commentId/resolve', setStatus('resolved'));
  router.add('POST', '/api/comments/:commentId/reopen', setStatus('open'));

  router.add('GET', '/api/workspaces/:workspaceId/members', async (ctx) => {
    const { access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    const active = await query<{ user_id: string; email: string; name: string; role: Role }>(
      `select m.user_id, u.email, u.name, m.role from members m join users u on u.id = m.user_id
       where m.workspace_id = $1 order by m.role desc, u.email asc`,
      [access.workspaceId],
    );
    const invited = await query<{ id: string; email: string; role: Role }>(
      `select id, email, role from invitations
       where workspace_id = $1 and status = 'pending' order by created_at asc`,
      [access.workspaceId],
    );
    sendJson(ctx, 200, {
      members: [
        ...active.map((row) => ({
          userId: row.user_id,
          email: row.email,
          name: row.name,
          role: row.role,
          status: 'active' as const,
        })),
        ...invited.map((row) => ({
          inviteId: row.id,
          email: row.email,
          role: row.role,
          status: 'invited' as const,
        })),
      ],
    });
  });

  router.add('POST', '/api/workspaces/:workspaceId/invites', async (ctx) => {
    const { account, access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    requireOwner(access);
    const body = await readJson(ctx);
    const email = (typeof body['email'] === 'string' ? body['email'] : '').trim().toLowerCase();
    const role = body['role'];
    if (!EMAIL_RE.test(email)) throw invalidFields({ email: fieldErrors.emailInvalid });
    if (role !== 'editor' && role !== 'viewer') {
      throw invalidFields({ role: 'Choose editor or viewer.' });
    }
    const member = await one<{ id: string }>(
      `select u.id from members m join users u on u.id = m.user_id
       where m.workspace_id = $1 and u.email = $2`,
      [access.workspaceId, email],
    );
    if (member) throw new ApiError(409, 'already_member', fieldErrors.alreadyMember(email));
    const pending = await one<{ id: string }>(
      `select id from invitations where workspace_id = $1 and email = $2 and status = 'pending'`,
      [access.workspaceId, email],
    );
    if (pending) throw new ApiError(409, 'already_invited', fieldErrors.alreadyInvited(email));
    const token = inviteToken();
    const roleWord = role === 'editor' ? 'an editor' : 'a viewer';
    try {
      await sendMail({
        to: email,
        subject: `${account.name} invited you to ${access.name} as ${roleWord}`,
        body:
          `${account.name} invited you to the workspace ${access.name} as ${roleWord}.\n\n` +
          `${config.publicUrl}/invites/${token}\n\n` +
          'Open the link to accept.\n',
      });
    } catch {
      throw new ApiError(503, 'mail_unavailable', notices.inviteFailed);
    }
    const id = newId('inv');
    await query(
      `insert into invitations (id, workspace_id, email, role, token, status, inviter_id)
       values ($1, $2, $3, $4, $5, 'pending', $6)`,
      [id, access.workspaceId, email, role, token, account.id],
    );
    sendJson(ctx, 201, { inviteId: id, email, role, status: 'invited' });
  });

  router.add('DELETE', '/api/invites/:inviteId', async (ctx) => {
    const account = await requireAccount(ctx);
    const row = await one<{ workspace_id: string; status: string }>(
      'select workspace_id, status from invitations where id = $1',
      [ctx.params['inviteId']!],
    );
    if (!row) throw notFound();
    const access = await accessFor(account.id, row.workspace_id);
    if (!access) throw notFound();
    requireOwner(access);
    if (row.status !== 'pending') {
      throw new ApiError(409, 'not_pending', 'That invitation is not pending.');
    }
    await query(`update invitations set status = 'revoked' where id = $1`, [
      ctx.params['inviteId']!,
    ]);
    sendNoContent(ctx);
  });

  router.add('PATCH', '/api/workspaces/:workspaceId/members/:userId', async (ctx) => {
    const { access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    requireOwner(access);
    const target = await one<{ role: Role; email: string; name: string }>(
      `select m.role, u.email, u.name from members m join users u on u.id = m.user_id
       where m.workspace_id = $1 and m.user_id = $2`,
      [access.workspaceId, ctx.params['userId']!],
    );
    if (!target) throw notFound();
    const body = await readJson(ctx);
    const role = body['role'];
    if (role !== 'editor' && role !== 'viewer') {
      throw invalidFields({ role: 'Choose editor or viewer.' });
    }
    if (target.role === 'owner') {
      throw new ApiError(409, 'owner_role_fixed', "The owner's role cannot change.");
    }
    await query('update members set role = $3 where workspace_id = $1 and user_id = $2', [
      access.workspaceId,
      ctx.params['userId']!,
      role,
    ]);
    pushRole(access.workspaceId, ctx.params['userId']!, role);
    sendJson(ctx, 200, {
      userId: ctx.params['userId'],
      email: target.email,
      name: target.name,
      role,
      status: 'active',
    });
  });

  router.add('DELETE', '/api/workspaces/:workspaceId/members/:userId', async (ctx) => {
    const { access } = await workspaceContext(ctx, ctx.params['workspaceId']!);
    requireOwner(access);
    const target = await one<{ role: Role }>(
      'select role from members where workspace_id = $1 and user_id = $2',
      [access.workspaceId, ctx.params['userId']!],
    );
    if (!target) throw notFound();
    if (target.role === 'owner') {
      throw new ApiError(409, 'owner_role_fixed', "The owner's role cannot change.");
    }
    await query('delete from members where workspace_id = $1 and user_id = $2', [
      access.workspaceId,
      ctx.params['userId']!,
    ]);
    closeForRemoval(access.workspaceId, ctx.params['userId']!);
    sendNoContent(ctx);
  });

  router.add('POST', '/api/invites/:token/accept', async (ctx) => {
    const account = await requireAccount(ctx);
    const result = await acceptInvitation(ctx.params['token']!, account);
    sendJson(ctx, 200, result);
  });

  if (config.gradingRoutes) {
    router.add('POST', '/api/grading/seed', async (ctx) => {
      const body = await readJson(ctx);
      sendJson(ctx, 201, await seedWorkspaces(body));
    });
    router.add('POST', '/api/grading/storage-outage', async (ctx) => {
      const body = await readJson(ctx);
      const workspaceId = typeof body['workspaceId'] === 'string' ? body['workspaceId'] : '';
      const ms = typeof body['ms'] === 'number' ? body['ms'] : 0;
      setStorageOutage(workspaceId, ms);
      sendJson(ctx, 200, { status: 'ok' });
    });
  }
}

export interface AcceptedInvite {
  workspaceId: string;
  role: Role;
  redirect: string;
}

export async function acceptInvitation(token: string, account: Account): Promise<AcceptedInvite> {
  const row = await one<{
    id: string;
    workspace_id: string;
    email: string;
    role: Role;
    status: string;
  }>('select id, workspace_id, email, role, status from invitations where token = $1', [token]);
  if (!row || row.status !== 'pending' || row.email !== account.email.toLowerCase()) {
    throw new ApiError(404, 'invite_invalid', 'That invitation is not valid.');
  }
  await query(`update invitations set status = 'accepted' where id = $1`, [row.id]);
  await query(
    `insert into members (workspace_id, user_id, role) values ($1, $2, $3)
     on conflict (workspace_id, user_id) do nothing`,
    [row.workspace_id, account.id, row.role],
  );
  const doc = await loadDocument(row.workspace_id);
  return {
    workspaceId: row.workspace_id,
    role: row.role,
    redirect: `/w/${row.workspace_id}/edit?page=${doc.pages[0]?.id ?? ''}`,
  };
}
