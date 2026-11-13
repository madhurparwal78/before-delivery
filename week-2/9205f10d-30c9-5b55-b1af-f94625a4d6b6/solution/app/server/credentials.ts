import { randomUUID } from "node:crypto";
import { parseIsoDate, toAgencyIso } from "../shared/agencyTime.js";
import { type Db, many, one, pool, transaction } from "./db.js";
import { ApiError, invalidTransition, notFound, validation } from "./errors.js";
import { type Context, type Router, ok } from "./http.js";
import { CREDENTIAL_TYPES, agencyToday, credentialStatus } from "./rules.js";
import { LINK_SECONDS, fileLink, putObject } from "./storage.js";
import { Fields } from "./validate.js";

/** A certificate file may be at most this many bytes; exactly this many is allowed. */
const FILE_LIMIT = 5_000_000;

interface CredentialRow {
  id: string;
  interpreter_id: string;
  credential_type: string;
  verified_at: Date | null;
  expires_on: string | null;
  uploaded_at: Date;
  file_name: string | null;
  storage_key: string | null;
  display_name: string;
  full_name: string;
}

const SELECT = `
  SELECT c.id, c.interpreter_id, c.credential_type, c.verified_at, c.expires_on, c.uploaded_at, c.file_name,
         c.storage_key, p.display_name, p.full_name
  FROM credentials c JOIN people p ON p.id = c.interpreter_id`;

function credentialJson(row: CredentialRow, today: string): Record<string, unknown> {
  return {
    id: row.id,
    credential_type: row.credential_type,
    status: credentialStatus(row.verified_at, row.expires_on, today),
    expires_on: row.expires_on,
    uploaded_at: toAgencyIso(row.uploaded_at),
    file_name: row.file_name,
  };
}

/** The file type judged by its leading bytes only: PDF, PNG or JPEG. */
function sniff(content: Buffer): { extension: "pdf" | "png" | "jpg"; contentType: string } | null {
  if (content.subarray(0, 5).toString("latin1") === "%PDF-") return { extension: "pdf", contentType: "application/pdf" };
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: "png", contentType: "image/png" };
  }
  if (content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { extension: "jpg", contentType: "image/jpeg" };
  return null;
}

/** Kept for display only: the last path part, without control characters. */
function displayName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  return [...last].filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f).join("").slice(0, 255);
}

interface Part {
  name: string;
  fileName: string | null;
  content: Buffer;
}

/** Splits a multipart/form-data body into its parts. */
function multipart(body: Buffer, contentType: string): Part[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const marker = Buffer.from(`--${boundary?.[1] ?? boundary?.[2] ?? ""}`);
  const parts: Part[] = [];
  let start = body.indexOf(marker);
  while (start !== -1) {
    const headerStart = start + marker.length + 2;
    const next = body.indexOf(marker, headerStart);
    if (next === -1) break;
    const headerEnd = body.indexOf("\r\n\r\n", headerStart);
    if (headerEnd !== -1 && headerEnd < next) {
      const headers = body.subarray(headerStart, headerEnd).toString("utf8");
      const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? "";
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
      const fileName = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
      if (name !== undefined) {
        // Browsers escape a quote and line breaks in the file name; nothing else is decoded.
        const unescaped = fileName?.replace(/%22/g, '"').replace(/%0D/gi, "\r").replace(/%0A/gi, "\n") ?? null;
        parts.push({ name, fileName: unescaped, content: body.subarray(headerEnd + 4, next - 2) });
      }
    }
    start = next;
  }
  return parts;
}

async function mine(ctx: Context) {
  ctx.allow("interpreter");
  const rows = await many<CredentialRow>(pool, `${SELECT} WHERE c.interpreter_id = $1 ORDER BY c.uploaded_at DESC, c.id`, [
    ctx.user.id,
  ]);
  const today = agencyToday();
  return ok({ credentials: rows.map((row) => credentialJson(row, today)) });
}

async function upload(ctx: Context) {
  ctx.allow("interpreter");
  const type = ctx.header("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(type)) throw new ApiError("unsupported_type", "Upload the certificate as multipart/form-data.");
  const parts = multipart(ctx.rawBody, type);
  const file = parts.find((p) => p.name === "file" && p.fileName !== null);
  if (file && file.content.length > FILE_LIMIT) {
    throw new ApiError("payload_too_large", `The certificate file is over ${FILE_LIMIT} bytes.`);
  }
  const detected = file ? sniff(file.content) : null;
  if (file && !detected) throw new ApiError("unsupported_type", "Upload a PDF, PNG or JPEG file.");
  const fields = new Fields({ credential_type: parts.find((p) => p.name === "credential_type")?.content.toString("utf8") });
  const credentialType = fields.oneOf("credential_type", CREDENTIAL_TYPES, "Choose NIC, CDI, SC:L or EIPA.");
  if (!file || !detected) fields.fail("file", "Choose a certificate file to upload.");
  if (!fields.ok || !file || !detected) throw validation(fields.errors);

  const id = randomUUID();
  const key = `credentials/${ctx.user.id}/${id}.${detected.extension}`;
  const row = await transaction(async (client) => {
    await client.query(
      "INSERT INTO credentials (id, interpreter_id, credential_type, file_name, storage_key) VALUES ($1, $2, $3, $4, $5)",
      [id, ctx.user.id, credentialType, displayName(file.fileName ?? ""), key],
    );
    await putObject(key, file.content, detected.contentType);
    return one<CredentialRow>(client, `${SELECT} WHERE c.id = $1`, [id]);
  });
  return ok(row ? credentialJson(row, agencyToday()) : {}, 201);
}

const REVIEW_FILTERS = ["uploaded", "verified", "expired", "all"] as const;

async function review(ctx: Context) {
  ctx.allow("coordinator");
  const fields = new Fields({ status: ctx.url.searchParams.get("status") ?? "uploaded" });
  const filter = fields.oneOf("status", REVIEW_FILTERS, "Filter by uploaded, verified, expired or all.");
  if (!filter) throw validation(fields.errors);
  const rows = await many<CredentialRow>(pool, `${SELECT} ORDER BY c.uploaded_at, c.id`);
  const today = agencyToday();
  return ok({
    credentials: rows
      .filter((row) => filter === "all" || credentialStatus(row.verified_at, row.expires_on, today) === filter)
      .map((row) => ({
        ...credentialJson(row, today),
        interpreter: { id: row.interpreter_id, display_name: row.display_name, full_name: row.full_name },
      })),
  });
}

/** A credential the caller may see: coordinators see all, interpreters their own. */
async function visibleCredential(db: Db, ctx: Context): Promise<CredentialRow> {
  const row = await one<CredentialRow>(db, `${SELECT} WHERE c.id = $1`, [ctx.params.id ?? ""]);
  const visible = row && (ctx.user.role === "coordinator" || (ctx.user.role === "interpreter" && row.interpreter_id === ctx.user.id));
  if (!row || !visible) throw notFound();
  return row;
}

async function verify(ctx: Context) {
  const verified = await transaction(async (client) => {
    await client.query("SELECT 1 FROM credentials WHERE id = $1 FOR UPDATE", [ctx.params.id ?? ""]);
    const row = await visibleCredential(client, ctx);
    ctx.allow("coordinator");
    if (row.verified_at) throw invalidTransition("Only an uploaded certificate can be verified.");
    const fields = new Fields(ctx.json());
    const expiresOn = fields.value("expires_on");
    const today = agencyToday();
    if (typeof expiresOn !== "string" || !parseIsoDate(expiresOn) || expiresOn < today) {
      throw validation({ expires_on: "Enter a real expiry date, today or later, as YYYY-MM-DD." });
    }
    await client.query("UPDATE credentials SET verified_at = now(), expires_on = $2 WHERE id = $1", [row.id, expiresOn]);
    return { ...row, verified_at: new Date(), expires_on: expiresOn };
  });
  return ok(credentialJson(verified, agencyToday()));
}

async function link(ctx: Context) {
  const row = await visibleCredential(pool, ctx);
  ctx.allow("coordinator");
  if (!row.storage_key) throw notFound();
  return ok({ url: await fileLink(row.storage_key), expires_in_seconds: LINK_SECONDS });
}

export function registerCredentials(router: Router): void {
  router.on("GET", "/api/me/credentials", mine);
  router.on("POST", "/api/me/credentials", upload, "upload");
  router.on("GET", "/api/credentials", review);
  router.on("POST", "/api/credentials/:id/verify", verify);
  router.on("GET", "/api/credentials/:id/file", link);
}
