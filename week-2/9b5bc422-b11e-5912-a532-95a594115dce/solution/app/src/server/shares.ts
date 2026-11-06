import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FieldState } from "../shared/sync.ts";
import { requireSession } from "./accounts.ts";
import { documentAttachment, documentAttachments, sendAttachment } from "./attachments.ts";
import { config } from "./config.ts";
import { db, requireDatabase, transaction } from "./db.ts";
import { deadLink, notFound, sendEmpty, sendJson } from "./http.ts";
import { requireStorage } from "./storage.ts";

type ShareRow = { token: string; expires_at: Date };

const isActive = `NOT revoked AND expires_at > now()`;

function shareBody(req: IncomingMessage, row: ShareRow) {
  const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return { token: row.token, url: `${proto}://${req.headers.host}/s/${row.token}`, expiresAt: row.expires_at.toISOString() };
}

async function requireHeldDocument(accountId: string, documentId: string): Promise<void> {
  const found = await db.query("SELECT 1 FROM change_log WHERE account_id = $1 AND kind = 'document' AND record_id = $2", [accountId, documentId]);
  if (!found.rowCount) throw notFound();
}

export async function getShare(req: IncomingMessage, res: ServerResponse, documentId: string): Promise<void> {
  const session = await requireSession(req);
  await requireHeldDocument(session.accountId, documentId);
  const found = await db.query<ShareRow>(
    `SELECT token, expires_at FROM share_links WHERE account_id = $1 AND document_id = $2 AND ${isActive}`,
    [session.accountId, documentId],
  );
  const row = found.rows[0];
  sendJson(res, 200, { share: row ? shareBody(req, row) : null });
}

export async function createShare(req: IncomingMessage, res: ServerResponse, documentId: string): Promise<void> {
  const session = await requireSession(req);
  await requireHeldDocument(session.accountId, documentId);
  const row = await transaction(async (client) => {
    await client.query("SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE", [session.accountId]);
    await client.query("UPDATE share_links SET revoked = true WHERE account_id = $1 AND document_id = $2", [session.accountId, documentId]);
    const created = await client.query<ShareRow>(
      `INSERT INTO share_links (token, account_id, document_id, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4)) RETURNING token, expires_at`,
      [randomBytes(32).toString("base64url"), session.accountId, documentId, config.shareLinkSeconds],
    );
    return created.rows[0] as ShareRow;
  });
  sendJson(res, 201, shareBody(req, row));
}

export async function deleteShare(req: IncomingMessage, res: ServerResponse, documentId: string): Promise<void> {
  const session = await requireSession(req);
  const revoked = await db.query(
    `UPDATE share_links SET revoked = true WHERE account_id = $1 AND document_id = $2 AND ${isActive}`,
    [session.accountId, documentId],
  );
  if (!revoked.rowCount) throw notFound();
  sendEmpty(res);
}

type LiveLink = { accountId: string; documentId: string; document: Record<string, FieldState> };

/** Share link validity: active, unexpired, and its document held and not in trash. */
async function requireLiveLink(token: string): Promise<LiveLink> {
  await requireDatabase();
  const found = await db.query<{ account_id: string; document_id: string; fields: Record<string, FieldState> }>(
    `SELECT s.account_id, s.document_id, c.fields
       FROM share_links s
       JOIN change_log c ON c.account_id = s.account_id AND c.kind = 'document' AND c.record_id = s.document_id
      WHERE s.token = $1 AND ${isActive}`,
    [token],
  );
  const row = found.rows[0];
  if (!row || row.fields["trashedAt"]?.value) throw deadLink();
  return { accountId: row.account_id, documentId: row.document_id, document: row.fields };
}

export async function getShared(res: ServerResponse, token: string): Promise<void> {
  const link = await requireLiveLink(token);
  const found = await db.query<{ record_id: string; fields: Record<string, FieldState> }>(
    "SELECT record_id, fields FROM change_log WHERE account_id = $1 AND kind = 'block' AND parent_id = $2",
    [link.accountId, link.documentId],
  );
  const orderOf = (fields: Record<string, FieldState>): string => String(fields["order"]?.value ?? "");
  const rows = found.rows
    .filter((row) => row.fields["deleted"]?.value !== true)
    .sort((a, b) => orderOf(a.fields).localeCompare(orderOf(b.fields), "en") || a.record_id.localeCompare(b.record_id, "en"));
  const tableIds = rows.flatMap((row) => (row.fields["tableId"]?.value ? [String(row.fields["tableId"].value)] : []));
  const tables = await db.query<{ record_id: string; fields: Record<string, FieldState> }>(
    "SELECT record_id, fields FROM change_log WHERE account_id = $1 AND kind = 'table' AND record_id = ANY($2)",
    [link.accountId, tableIds],
  );
  const tableNames = new Map(tables.rows.map((row) => [row.record_id, String(row.fields["name"]?.value ?? "")]));
  sendJson(res, 200, {
    title: link.document["title"]?.value ?? "",
    blocks: rows.map((row) => ({
      id: row.record_id,
      type: row.fields["type"]?.value,
      text: String(row.fields["fileName"]?.value || tableNames.get(String(row.fields["tableId"]?.value)) || row.fields["text"]?.value || ""),
      indent: row.fields["indent"]?.value ?? 0,
      checked: row.fields["checked"]?.value ?? false,
    })),
    attachments: await documentAttachments(link.accountId, link.documentId),
  });
}

export async function getSharedAttachment(res: ServerResponse, token: string, id: string): Promise<void> {
  await requireStorage();
  const link = await requireLiveLink(token);
  const attachment = await documentAttachment(link.accountId, link.documentId, id);
  if (!attachment) throw deadLink();
  await sendAttachment(res, link.accountId, attachment);
}
