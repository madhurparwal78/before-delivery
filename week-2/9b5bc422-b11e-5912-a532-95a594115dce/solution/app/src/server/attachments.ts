import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ATTACHMENT_LIMIT_BYTES, ATTACHMENT_LIMIT_TEXT } from "../shared/limits.ts";
import { requireSession } from "./accounts.ts";
import { config } from "./config.ts";
import { db, transaction } from "./db.ts";
import type { Queryable } from "./db.ts";
import { ApiError, notFound, readBody, sendEmpty, sendJson } from "./http.ts";
import { attachmentKey, deleteObject, getObject, putObject, requireStorage } from "./storage.ts";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLBACK_TYPE = "application/octet-stream";

type AttachmentRow = { id: string; name: string; size: number; content_type: string; digest: string };

const storedBody = (row: AttachmentRow) => ({ id: row.id, name: row.name, size: row.size, contentType: row.content_type, state: "stored" });

function fileName(req: IncomingMessage, id: string): string {
  const header = req.headers["x-file-name"];
  const raw = typeof header === "string" ? header : "";
  try {
    return decodeURIComponent(raw).replaceAll("\0", "") || id;
  } catch {
    return raw;
  }
}

export async function putAttachment(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  await requireStorage();
  const session = await requireSession(req);
  const bytes = await readBody(req, ATTACHMENT_LIMIT_BYTES);
  const header = req.headers["x-document-id"];
  const documentId = typeof header === "string" ? header.trim() : "";
  const digest = bytes ? createHash("sha256").update(bytes).digest("hex") : "";
  const contentType = req.headers["content-type"] ?? FALLBACK_TYPE;
  const answer = await transaction(async (client) => {
    await client.query("SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE", [session.accountId]);
    const found = await client.query<AttachmentRow>(
      "SELECT id, name, size, content_type, digest FROM attachments WHERE account_id = $1 AND id = $2 AND NOT awaiting_removal",
      [session.accountId, id],
    );
    const existing = found.rows[0];
    if (existing) {
      if (existing.digest !== digest) throw new ApiError(409, { form: "That attachment id is already used." });
      return { status: 200, row: existing };
    }
    const gone = await client.query("SELECT 1 FROM deleted_documents WHERE account_id = $1 AND document_id = $2", [session.accountId, documentId]);
    if (gone.rowCount) throw notFound();
    if (!bytes) throw new ApiError(413, { file: `That file is larger than ${ATTACHMENT_LIMIT_TEXT}.` });
    const used = await client.query<{ total: string }>("SELECT coalesce(sum(size), 0) AS total FROM attachments WHERE account_id = $1", [session.accountId]);
    if (Number(used.rows[0]?.total) + bytes.length > config.accountStorageBytes) {
      throw new ApiError(507, { file: "Your account storage is full." });
    }
    if (!UUID_SHAPE.test(id)) throw new ApiError(422, { id: "Use a UUID." });
    if (!documentId) throw new ApiError(422, { documentId: "Enter a document id." });
    await putObject(attachmentKey(session.accountId, id), bytes, contentType);
    const row: AttachmentRow = { id, name: fileName(req, id), size: bytes.length, content_type: contentType, digest };
    await client.query(
      "INSERT INTO attachments (account_id, id, document_id, name, size, content_type, digest) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [session.accountId, id, documentId, row.name, row.size, row.content_type, digest],
    );
    return { status: 201, row };
  });
  sendJson(res, answer.status, storedBody(answer.row));
}

async function findAttachment(accountId: string, id: string): Promise<AttachmentRow> {
  const found = await db.query<AttachmentRow>(
    "SELECT id, name, size, content_type, digest FROM attachments WHERE account_id = $1 AND id = $2 AND NOT awaiting_removal",
    [accountId, id],
  );
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

/** Sends stored bytes with the stored type, a download disposition and no content sniffing. */
export async function sendAttachment(res: ServerResponse, accountId: string, row: AttachmentRow): Promise<void> {
  const bytes = await getObject(attachmentKey(accountId, row.id));
  res.writeHead(200, {
    "Content-Type": row.content_type,
    "Content-Length": bytes.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(bytes);
}

export async function getAttachment(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  await requireStorage();
  const session = await requireSession(req);
  await sendAttachment(res, session.accountId, await findAttachment(session.accountId, id));
}

export async function deleteAttachment(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  await requireStorage();
  const session = await requireSession(req);
  await findAttachment(session.accountId, id);
  await deleteObject(attachmentKey(session.accountId, id));
  await db.query("DELETE FROM attachments WHERE account_id = $1 AND id = $2", [session.accountId, id]);
  sendEmpty(res);
}

export async function documentAttachment(accountId: string, documentId: string, id: string): Promise<AttachmentRow | undefined> {
  const found = await db.query<AttachmentRow>(
    "SELECT id, name, size, content_type, digest FROM attachments WHERE account_id = $1 AND id = $2 AND document_id = $3",
    [accountId, id, documentId],
  );
  return found.rows[0];
}

export async function documentAttachments(accountId: string, documentId: string): Promise<{ id: string; name: string; contentType: string }[]> {
  const found = await db.query<AttachmentRow>(
    "SELECT id, name, size, content_type, digest FROM attachments WHERE account_id = $1 AND document_id = $2 AND NOT awaiting_removal ORDER BY name",
    [accountId, documentId],
  );
  return found.rows.map((row) => ({ id: row.id, name: row.name, contentType: row.content_type }));
}

/** Empties a deleted document's attachment rows; the objects go in `removeAwaitedObjects` so storage being down cannot block sync. */
export async function removeDocumentAttachments(client: Queryable, accountId: string, documentId: string): Promise<void> {
  await client.query(
    "UPDATE attachments SET awaiting_removal = true, document_id = NULL, name = '', content_type = '' WHERE account_id = $1 AND document_id = $2",
    [accountId, documentId],
  );
}

export async function removeAwaitedObjects(): Promise<void> {
  const awaited = await db.query<{ account_id: string; id: string }>("SELECT account_id, id FROM attachments WHERE awaiting_removal");
  for (const row of awaited.rows) {
    await deleteObject(attachmentKey(row.account_id, row.id));
    await db.query("DELETE FROM attachments WHERE account_id = $1 AND id = $2", [row.account_id, row.id]);
  }
}

