import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type Ctx, readJson, readUpload, sendJson, setSessionCookie } from "../http.js";
import { errors } from "../errors.js";
import { config } from "../config.js";
import { query, queryOne, withTransaction } from "../db.js";
import { studioInstant } from "../time.js";
import * as storage from "../services/storage.js";
import { inviteMessage, queueMessage } from "../mailer.js";
import { COPY } from "../../shared/copy.js";
import { planName } from "../../shared/plans.js";
import { checkUpload } from "../domain/uploads.js";
import {
  type ProjectRow,
  canUploadAsset,
  canUploadDeliverable,
  projectsVisibleTo,
  requireUuid,
  visibleProject,
} from "../domain/access.js";
import {
  accountById,
  createSession,
  createUser,
  emailTaken,
  serializeUser,
  userById,
  type UserRow,
} from "../domain/accounts.js";
import { orderById } from "../domain/orders.js";
import { invoiceViews, serializeInvoice } from "../domain/billing.js";

function requireUser(ctx: Ctx): UserRow {
  if (!ctx.user) throw errors.unauthenticated();
  return ctx.user;
}

function requireClientOwner(ctx: Ctx): UserRow {
  const user = requireUser(ctx);
  if (user.role !== "client_owner") throw errors.forbidden();
  return user;
}

export async function listInvoices(ctx: Ctx): Promise<void> {
  const user = requireClientOwner(ctx);
  const views = await invoiceViews(user.accountId ?? "");
  sendJson(ctx.res, 200, { invoices: views.map(serializeInvoice) });
}

export async function getInvoice(ctx: Ctx): Promise<void> {
  const user = requireClientOwner(ctx);
  const views = await invoiceViews(user.accountId ?? "");
  const found = views.find((view) => view.id === ctx.params.id);
  if (!found) throw errors.notFound();
  sendJson(ctx.res, 200, serializeInvoice(found));
}

async function issueLink(input: {
  userId: string;
  fileId: string | null;
  invoiceId: string | null;
  orderId: string | null;
}): Promise<{ url: string; expiresAt: Date }> {
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + config.durations.downloadLinkSeconds * 1000);
  await query(
    `insert into download_links (id, token_hash, user_id, file_id, invoice_id, order_id, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      createHash("sha256").update(token).digest("hex"),
      input.userId,
      input.fileId,
      input.invoiceId,
      input.orderId,
      expiresAt.toISOString(),
    ],
  );
  return { url: `/download/${token}`, expiresAt };
}

export async function createInvoiceLink(ctx: Ctx): Promise<void> {
  const user = requireClientOwner(ctx);
  await readJson(ctx);
  const views = await invoiceViews(user.accountId ?? "");
  const invoice = views.find((view) => view.id === ctx.params.id);
  if (!invoice) throw errors.notFound();
  if (!invoice.pdf) throw errors.pdfPending();
  const link = await issueLink({
    userId: user.id,
    fileId: null,
    invoiceId: invoice.id,
    orderId: invoice.orderId,
  });
  sendJson(ctx.res, 201, { url: link.url, expiresAt: studioInstant(link.expiresAt) });
}

interface ProjectSummary {
  id: string;
  orderNumber: string;
  businessName: string;
  planName: string;
  state: string;
  closedAt: string | null;
}

export async function projectSummary(project: ProjectRow): Promise<ProjectSummary> {
  const order = await orderById(project.orderId);
  const account = await accountById(project.accountId);
  if (!order || !account) throw errors.notFound();
  return {
    id: project.id,
    orderNumber: order.number,
    businessName: account.businessName,
    planName: planName(order.plan),
    state: order.state,
    closedAt: project.closedAt ? studioInstant(project.closedAt) : null,
  };
}

export async function listProjects(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const projects = await projectsVisibleTo(user);
  const summaries = [];
  for (const project of projects) summaries.push(await projectSummary(project));
  sendJson(ctx.res, 200, { projects: summaries });
}

export interface FileView {
  id: string;
  kind: "asset" | "deliverable";
  name: string;
  type: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export async function filesOfProject(projectId: string): Promise<FileView[]> {
  const rows = await query<{
    id: string;
    kind: string;
    name: string;
    content_type: string;
    size_bytes: string;
    uploaded_at: Date;
    uploader: string;
  }>(
    `select f.id, f.kind, f.name, f.content_type, f.size_bytes, f.uploaded_at, u.name as uploader
       from files f join users u on u.id = f.uploaded_by
      where f.project_id = $1 order by f.uploaded_at asc`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as "asset" | "deliverable",
    name: row.name,
    type: row.content_type,
    size: Number(row.size_bytes),
    uploadedBy: row.uploader,
    uploadedAt: studioInstant(row.uploaded_at),
  }));
}

export async function contractorsOfProject(projectId: string): Promise<Array<{ id: string; name: string; email: string }>> {
  const rows = await query<{ id: string; name: string; email: string }>(
    `select u.id, u.name, u.email from project_assignments a join users u on u.id = a.contractor_id
      where a.project_id = $1 order by u.name asc`,
    [projectId],
  );
  return rows;
}

export async function getProject(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const project = await visibleProject(user, ctx.params.id ?? "");
  const summary = await projectSummary(project);
  const files = await filesOfProject(project.id);
  const showContractors = user.role === "client_owner" || user.role === "studio_owner";
  sendJson(ctx.res, 200, {
    ...summary,
    assets: files.filter((file) => file.kind === "asset"),
    deliverables: files.filter((file) => file.kind === "deliverable"),
    contractors: showContractors ? await contractorsOfProject(project.id) : [],
  });
}

async function uploadInto(ctx: Ctx, kind: "asset" | "deliverable"): Promise<void> {
  const user = requireUser(ctx);
  const project = await visibleProject(user, ctx.params.id ?? "");
  const allowed = kind === "asset" ? canUploadAsset(user) : await canUploadDeliverable(user, project);
  if (!allowed) throw errors.forbidden();
  if (project.closedAt) throw errors.projectClosed();
  const part = await readUpload(ctx);
  const accepted = checkUpload(part.fileName, part.bytes);
  const fileId = randomUUID();
  const objectKey = storage.fileObjectKey(project.orderId, kind, fileId, accepted.name);
  await storage.putObject(objectKey, accepted.bytes);
  await query(
    `insert into files (id, project_id, kind, name, content_type, size_bytes, uploaded_by, object_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [fileId, project.id, kind, accepted.name, accepted.contentType, accepted.bytes.length, user.id, objectKey],
  );
  const files = await filesOfProject(project.id);
  const view = files.find((file) => file.id === fileId);
  if (!view) throw errors.notFound();
  sendJson(ctx.res, 201, view);
}

export async function uploadAsset(ctx: Ctx): Promise<void> {
  await uploadInto(ctx, "asset");
}

export async function uploadDeliverable(ctx: Ctx): Promise<void> {
  await uploadInto(ctx, "deliverable");
}

interface FileRecord {
  id: string;
  project_id: string;
  name: string;
  content_type: string;
  object_key: string;
}

async function fileById(id: string): Promise<FileRecord | null> {
  return queryOne<FileRecord>(
    `select id, project_id, name, content_type, object_key from files where id = $1`,
    [id],
  );
}

export async function createFileLink(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  await readJson(ctx);
  const file = await fileById(requireUuid(ctx.params.id));
  if (!file) throw errors.notFound();
  await visibleProject(user, file.project_id);
  const link = await issueLink({ userId: user.id, fileId: file.id, invoiceId: null, orderId: null });
  sendJson(ctx.res, 201, { url: link.url, expiresAt: studioInstant(link.expiresAt) });
}

export async function download(ctx: Ctx): Promise<void> {
  const token = ctx.params.token ?? "";
  const hash = createHash("sha256").update(token).digest("hex");
  const link = await queryOne<{
    user_id: string;
    file_id: string | null;
    invoice_id: string | null;
    order_id: string | null;
    expires_at: Date;
  }>(
    `select user_id, file_id, invoice_id, order_id, expires_at from download_links where token_hash = $1`,
    [hash],
  );
  if (!link) throw errors.notFound();
  const user = ctx.user;
  if (!user || user.id !== link.user_id) throw errors.notFound();
  if (link.expires_at.getTime() < Date.now()) throw errors.linkExpired();

  let name: string;
  let contentType: string;
  let objectKey: string;
  if (link.file_id) {
    const file = await fileById(link.file_id);
    if (!file) throw errors.notFound();
    await visibleProject(user, file.project_id);
    name = file.name;
    contentType = file.content_type;
    objectKey = file.object_key;
  } else {
    if (user.role !== "client_owner" && user.role !== "studio_owner") throw errors.forbidden();
    const order = link.order_id ? await orderById(link.order_id) : null;
    if (!order || !link.invoice_id) throw errors.notFound();
    if (user.role === "client_owner" && order.accountId !== user.accountId) throw errors.notFound();
    const task = await queryOne<{ invoice_number: string | null }>(
      `select invoice_number from invoice_tasks where killbill_invoice_id = $1`,
      [link.invoice_id],
    );
    name = `invoice-${task?.invoice_number ?? link.invoice_id}.pdf`;
    contentType = "application/pdf";
    objectKey = storage.invoicePdfKey(order.id, link.invoice_id);
  }

  const bytes = await storage.getObject(objectKey);
  if (!bytes) throw errors.notFound();
  ctx.res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": bytes.length.toString(),
    "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
    "X-Content-Type-Options": "nosniff",
  });
  ctx.res.end(bytes);
}

export async function createInvite(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const user = requireClientOwner(ctx);
  const project = await visibleProject(user, ctx.params.id ?? "");
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw errors.validation({ email: "Enter a valid email address." });
  }
  if (await emailTaken(email)) throw errors.validation({ email: COPY.inviteEmailTaken });
  const order = await orderById(project.orderId);
  const account = await accountById(project.accountId);
  if (!order || !account) throw errors.notFound();
  const token = randomBytes(24).toString("hex");
  const inviteId = randomUUID();
  const expiresAt = new Date(Date.now() + config.durations.inviteTtlSeconds * 1000);
  await withTransaction(async (client) => {
    await client.query(
      `insert into invites (id, project_id, account_id, email, token_hash, expires_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        inviteId,
        project.id,
        project.accountId,
        email,
        createHash("sha256").update(token).digest("hex"),
        expiresAt.toISOString(),
      ],
    );
    await queueMessage(
      client,
      inviteMessage({
        to: email,
        inviteId,
        businessName: account.businessName,
        projectName: planName(order.plan),
        token,
      }),
    );
  });
  sendJson(ctx.res, 201, {
    invite: { id: inviteId, email, expiresAt: studioInstant(expiresAt) },
  });
}

interface InviteRecord {
  id: string;
  project_id: string;
  account_id: string;
  email: string;
  expires_at: Date;
  used_at: Date | null;
}

export async function inviteByToken(token: string): Promise<InviteRecord | null> {
  return queryOne<InviteRecord>(
    `select id, project_id, account_id, email, expires_at, used_at from invites where token_hash = $1`,
    [createHash("sha256").update(token).digest("hex")],
  );
}

export async function getInvite(ctx: Ctx): Promise<void> {
  const invite = await inviteByToken(ctx.params.token ?? "");
  if (!invite) throw errors.notFound();
  if (invite.used_at) throw errors.inviteUsed();
  if (invite.expires_at.getTime() < Date.now()) throw errors.inviteExpired();
  const account = await accountById(invite.account_id);
  const project = await queryOne<{ order_id: string }>(`select order_id from projects where id = $1`, [
    invite.project_id,
  ]);
  const order = project ? await orderById(project.order_id) : null;
  if (!account || !order) throw errors.notFound();
  sendJson(ctx.res, 200, {
    businessName: account.businessName,
    projectName: planName(order.plan),
    email: invite.email,
  });
}

export async function acceptInvite(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const invite = await inviteByToken(ctx.params.token ?? "");
  if (!invite) throw errors.notFound();
  if (invite.used_at) throw errors.inviteUsed();
  if (invite.expires_at.getTime() < Date.now()) throw errors.inviteExpired();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const fields: Record<string, string> = {};
  if (name.length < 1 || name.length > 80) fields.name = "Enter your name.";
  if (password.length < 10) fields.password = "Use at least 10 characters.";
  if (Object.keys(fields).length > 0) throw errors.validation(fields);

  const userId = await withTransaction(async (client) => {
    const claimed = await client.query(`update invites set used_at = now() where id = $1 and used_at is null returning id`, [
      invite.id,
    ]);
    if (claimed.rows.length === 0) throw errors.inviteUsed();
    const created = await createUser(client, {
      accountId: invite.account_id,
      name,
      email: invite.email,
      password,
      role: "teammate",
    });
    return created.id;
  });
  const sessionId = await createSession(userId);
  setSessionCookie(ctx.res, sessionId);
  const user = await userById(userId);
  if (!user) throw errors.notFound();
  sendJson(ctx.res, 201, { user: serializeUser(user), projectId: invite.project_id });
}
