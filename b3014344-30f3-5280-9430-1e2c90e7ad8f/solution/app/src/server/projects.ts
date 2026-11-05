import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { newToken, tokenHash } from "./auth";
import { config } from "./config";
import { one, query, type Row } from "./db";
import { errors, HttpError, type Upload } from "./http";
import { getObject, objectKeys, putObject } from "./storage";
import { studioInstant } from "./time";
import { COPY } from "../shared/copy";
import { PLAN_NAMES, type Contractor, type FileKind, type FileRecord, type OrderState, type PlanId, type Project, type ProjectSummary, type User } from "../shared/domain";

interface ProjectRow extends Row {
  id: string;
  order_id: string;
  account_id: string;
  closed_at: Date | null;
  number: string;
  plan: PlanId;
  state: OrderState;
  business_name: string;
}

const PROJECT_SELECT = `SELECT p.id, p.order_id, p.account_id, p.closed_at, o.number, o.plan, o.state, a.business_name
  FROM projects p JOIN orders o ON o.id = p.order_id JOIN client_accounts a ON a.id = p.account_id`;

type ProjectAccess = "owner" | "teammate" | "studio" | "contractor";

/**
 * The one access rule for projects and their files. Client owners and teammates see every project
 * of their account, the studio owner sees all, and a contractor sees a project only while assigned
 * and open; a contractor whose project has closed gets access_ended. Everyone else gets 404.
 */
export async function projectAccess(projectId: string, user: User): Promise<{ project: ProjectRow; access: ProjectAccess }> {
  const project = await one<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = $1`, [projectId]);
  if (!project) throw errors.notFound();
  if (user.role === "studio_owner") return { project, access: "studio" };
  if ((user.role === "client_owner" || user.role === "teammate") && user.accountId === project.account_id) {
    return { project, access: user.role === "client_owner" ? "owner" : "teammate" };
  }
  if (user.role === "contractor") {
    const assigned = await one("SELECT 1 FROM assignments WHERE project_id = $1 AND contractor_id = $2", [projectId, user.id]);
    if (assigned) {
      if (project.closed_at) throw errors.accessEnded();
      return { project, access: "contractor" };
    }
  }
  throw errors.notFound();
}

function summary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    orderNumber: row.number,
    businessName: row.business_name,
    planName: PLAN_NAMES[row.plan],
    state: row.state,
    closedAt: row.closed_at ? studioInstant(row.closed_at) : null,
  };
}

export async function visibleProjects(user: User): Promise<ProjectSummary[]> {
  const order = "ORDER BY o.created_at DESC";
  if (user.role === "studio_owner") return (await query<ProjectRow>(`${PROJECT_SELECT} ${order}`)).map(summary);
  if (user.role === "contractor") {
    const sql = `${PROJECT_SELECT} JOIN assignments s ON s.project_id = p.id WHERE s.contractor_id = $1 AND p.closed_at IS NULL ${order}`;
    return (await query<ProjectRow>(sql, [user.id])).map(summary);
  }
  return (await query<ProjectRow>(`${PROJECT_SELECT} WHERE p.account_id = $1 ${order}`, [user.accountId])).map(summary);
}

interface FileRow extends Row {
  id: string;
  project_id: string;
  kind: FileKind;
  name: string;
  type: string;
  size: string;
  object_key: string;
  uploader: string;
  uploaded_at: Date;
}

const FILE_SELECT = "SELECT f.*, u.name AS uploader FROM files f JOIN users u ON u.id = f.uploaded_by";

function fileBody(row: FileRow): FileRecord {
  return { id: row.id, kind: row.kind, name: row.name, type: row.type, size: Number(row.size), uploadedBy: row.uploader, uploadedAt: studioInstant(row.uploaded_at) };
}

export async function projectDetail(projectId: string, user: User): Promise<Project> {
  const { project, access } = await projectAccess(projectId, user);
  const files = await query<FileRow>(`${FILE_SELECT} WHERE f.project_id = $1 ORDER BY f.uploaded_at`, [projectId]);
  const contractors =
    access === "owner" || access === "studio"
      ? await query<Contractor & Row>(
          "SELECT u.id, u.name, u.email FROM assignments s JOIN users u ON u.id = s.contractor_id WHERE s.project_id = $1 ORDER BY u.name",
          [projectId],
        )
      : [];
  return {
    ...summary(project),
    orderId: project.order_id,
    assets: files.filter((f) => f.kind === "asset").map(fileBody),
    deliverables: files.filter((f) => f.kind === "deliverable").map(fileBody),
    contractors: contractors.map((c) => ({ id: c.id, name: c.name, email: c.email })),
  };
}

// ---- the upload allowlist

const MAX_FILE_BYTES = 10_000_000;

interface Detected {
  type: string;
  extensions: string[];
}

function svgIsSafe(text: string): boolean {
  const decoded = text
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec)));
  return !/<\s*script\b/i.test(decoded) && !/[\s"'/]on[a-z]+\s*=/i.test(decoded) && !/javascript\s*:/i.test(decoded.replace(/\s+/g, "")) && !/<\s*foreignObject\b/i.test(decoded);
}

/** The file's type from its first bytes, never from its name or declared type. */
function detect(data: Buffer): Detected | null {
  const head = (bytes: number[]) => bytes.every((b, i) => data[i] === b);
  const ascii = (offset: number, text: string) => data.subarray(offset, offset + text.length).toString("latin1") === text;
  if (head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: "image/png", extensions: ["png"] };
  if (head([0xff, 0xd8, 0xff])) return { type: "image/jpeg", extensions: ["jpg", "jpeg"] };
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { type: "image/webp", extensions: ["webp"] };
  if (ascii(0, "%PDF-")) return { type: "application/pdf", extensions: ["pdf"] };
  if (ascii(0, "wOF2")) return { type: "font/woff2", extensions: ["woff2"] };
  if (ascii(0, "OTTO")) return { type: "font/otf", extensions: ["otf"] };
  if (head([0x00, 0x01, 0x00, 0x00]) || ascii(0, "true")) return { type: "font/ttf", extensions: ["ttf"] };
  const text = data.toString("utf8").replace(/^\uFEFF/, "");
  const root = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg[\s>/]/i;
  if (root.test(text) && svgIsSafe(text)) return { type: "image/svg+xml", extensions: ["svg"] };
  return null;
}

/** Name, then size, then content type; nothing refused reaches storage. */
function checkUpload(upload: Upload): Detected {
  const name = upload.name;
  const unsafe = !name || [...name].length > 120 || /[/\\]/.test(name) || name.includes("..") || /[\x00-\x1f\x7f]/.test(name) || name.startsWith(".");
  if (unsafe) throw errors.invalid({ file: COPY.nameRefused });
  if (upload.data.length > MAX_FILE_BYTES) throw new HttpError(413, "file_too_large", `${name} is larger than 10 MB.`);
  const detected = detect(upload.data);
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!detected || !detected.extensions.includes(extension)) {
    throw new HttpError(415, "unsupported_file_type", `${name} is not an accepted file type.`);
  }
  return detected;
}

const MAY_UPLOAD: Record<FileKind, ProjectAccess[]> = { asset: ["owner", "teammate"], deliverable: ["studio", "contractor"] };

export async function uploadFile(projectId: string, kind: FileKind, user: User, upload: Upload): Promise<FileRecord> {
  const { project, access } = await projectAccess(projectId, user);
  if (!MAY_UPLOAD[kind].includes(access)) throw errors.forbidden();
  if (project.closed_at) throw new HttpError(409, "project_closed", "This project is closed, so it takes no new files.");
  const detected = checkUpload(upload);
  const id = randomUUID();
  const key = objectKeys.file(project.order_id, kind, id, upload.name);
  await putObject(key, upload.data);
  const [row] = await query<FileRow>(
    `WITH created AS (
       INSERT INTO files (id, project_id, kind, name, type, size, object_key, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *)
     SELECT created.*, u.name AS uploader FROM created JOIN users u ON u.id = created.uploaded_by`,
    [id, projectId, kind, upload.name, detected.type, upload.data.length, key, user.id],
  );
  return fileBody(row!);
}

// ---- download links: short-lived, issued to one user, re-checked on every use

interface LinkRow extends Row {
  user_id: string;
  file_id: string | null;
  account_id: string | null;
  object_key: string;
  file_name: string;
  content_type: string;
  expires_at: Date;
}

async function issue(user: User, target: { fileId?: string; accountId?: string; objectKey: string; fileName: string; contentType: string }) {
  const token = newToken();
  const expires = new Date(Date.now() + config.downloadLinkSeconds * 1000);
  await query(
    "INSERT INTO download_links (token_hash, user_id, file_id, account_id, object_key, file_name, content_type, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [tokenHash(token), user.id, target.fileId ?? null, target.accountId ?? null, target.objectKey, target.fileName, target.contentType, expires],
  );
  return { url: `/api/downloads/${token}`, expiresAt: studioInstant(expires) };
}

async function visibleFile(fileId: string, user: User): Promise<FileRow> {
  const file = await one<FileRow>(`${FILE_SELECT} WHERE f.id = $1`, [fileId]);
  if (!file) throw errors.notFound();
  await projectAccess(file.project_id, user);
  return file;
}

export async function fileLink(fileId: string, user: User) {
  const file = await visibleFile(fileId, user);
  return issue(user, { fileId: file.id, objectKey: file.object_key, fileName: file.name, contentType: file.type });
}

export async function invoiceLink(user: User, accountId: string, orderId: string, invoiceId: string, number: string) {
  return issue(user, { accountId, objectKey: objectKeys.invoice(orderId, invoiceId), fileName: `Pampero-invoice-${number}.pdf`, contentType: "application/pdf" });
}

function disposition(name: string): string {
  const plain = name.replace(/["\\]/g, "_");
  return /^[\x20-\x7e]*$/.test(name)
    ? `attachment; filename="${plain}"`
    : `attachment; filename="${plain.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function download(token: string, user: User, res: ServerResponse): Promise<void> {
  const link = await one<LinkRow>("SELECT * FROM download_links WHERE token_hash = $1", [tokenHash(token)]);
  if (!link || link.user_id !== user.id) throw errors.notFound();
  if (link.file_id) await visibleFile(link.file_id, user);
  else if (user.role !== "client_owner" || user.accountId !== link.account_id) throw errors.notFound();
  if (link.expires_at.getTime() <= Date.now()) throw new HttpError(410, "link_expired", COPY.linkExpired);
  const object = await getObject(link.object_key);
  res.writeHead(200, {
    "Content-Type": link.content_type,
    "Content-Disposition": disposition(link.file_name),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    ...(object.headers.get("content-length") ? { "Content-Length": object.headers.get("content-length")! } : {}),
  });
  Readable.fromWeb(object.body as import("node:stream/web").ReadableStream).pipe(res);
}
