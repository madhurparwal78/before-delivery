// Sharing a document and its one invite email per share action.
import type { Account } from "./auth.js";
import { query, transaction } from "./db.js";
import { may } from "./access.js";
import { documentAccess } from "./edit.js";
import { ApiError, type Reply, type Request, forbidden, invalid, json, notFound } from "./http.js";
import { isObject } from "./json.js";
import { sendInvite } from "./mail.js";
import { newId } from "./ops.js";

interface ShareRow {
  id: string;
  document_id: string;
  email: string;
  role: "editor" | "viewer";
  row_scope: "all" | "own";
  invite_status: "sent" | "not_sent" | "sending";
}

const EMAIL_MESSAGE = "Enter a valid email address.";

// At most 254 characters, one @ with text on both sides, and nothing that could break a header.
function validEmail(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 254) return false;
  if (/[\s\u0000-\u001f\u007f-\u009f\u2028\u2029,;<>"()]/.test(value)) return false;
  const parts = value.split("@");
  return parts.length === 2 && parts[0]!.length > 0 && parts[1]!.length > 0;
}

function shareJson(s: ShareRow) {
  return { id: s.id, email: s.email, role: s.role, row_scope: s.row_scope, invite_status: s.invite_status === "sent" ? "sent" : "not_sent" };
}

async function ownerContext(account: Account, docId: string) {
  return transaction(async (db) => {
    const { doc, access } = await documentAccess(db, docId, account, false);
    return { doc, access };
  });
}

export async function listShares(account: Account, docId: string): Promise<Reply> {
  await ownerContext(account, docId);
  const rows = await query<ShareRow>("SELECT * FROM shares WHERE document_id = $1 ORDER BY seq", [docId]);
  return json(200, { shares: rows.map(shareJson) });
}

export async function share(req: Request, account: Account, docId: string): Promise<Reply> {
  const { doc, access } = await ownerContext(account, docId);
  if (!may(access, "own")) throw forbidden();
  const body = isObject(req.body) ? req.body : {};
  const fields: Record<string, string> = {};
  const email = validEmail(body.email) ? body.email.toLowerCase() : null;
  if (email === null) fields.email = EMAIL_MESSAGE;
  else if (email === account.email.toLowerCase()) fields.email = "You already own this document.";
  if (body.role !== "editor" && body.role !== "viewer") fields.role = "Choose Editor or Viewer.";
  if (body.row_scope !== "all" && body.row_scope !== "own") fields.row_scope = "Choose All rows or Only their own rows.";
  if (Object.keys(fields).length) throw invalid(fields);
  const [saved] = await query<ShareRow & { created: boolean }>(
    `INSERT INTO shares (id, document_id, email, role, row_scope, invite_status, sending_since)
     VALUES ($1, $2, $3, $4, $5, 'sending', now())
     ON CONFLICT (document_id, email) DO UPDATE
     SET role = EXCLUDED.role, row_scope = EXCLUDED.row_scope, invite_status = 'sending', sending_since = now()
     RETURNING *, (xmax = 0) AS created`,
    [newId("h"), docId, email, body.role, body.row_scope],
  );
  const sent = await sendInvite({
    to: email!, sharerName: account.display_name, documentName: doc.name, documentId: docId, role: body.role as "editor" | "viewer",
  });
  const [updated] = await query<ShareRow>("UPDATE shares SET invite_status = $2, sending_since = NULL WHERE id = $1 RETURNING *", [
    saved!.id, sent ? "sent" : "not_sent",
  ]);
  return json(saved!.created ? 201 : 200, { share: shareJson(updated!) });
}

// Of simultaneous Resends, the one that claims the share sends; the others answer 409.
export async function resend(account: Account, docId: string, shareId: string): Promise<Reply> {
  const { doc, access } = await ownerContext(account, docId);
  const [existing] = await query<ShareRow>("SELECT * FROM shares WHERE id = $1 AND document_id = $2", [shareId, docId]);
  if (!existing) throw notFound();
  if (!may(access, "own")) throw forbidden();
  const [claimed] = await query<ShareRow>(
    `UPDATE shares SET invite_status = 'sending', sending_since = now()
     WHERE id = $1 AND (invite_status = 'not_sent' OR (invite_status = 'sending' AND sending_since < now() - interval '30 seconds'))
     RETURNING *`,
    [shareId],
  );
  if (!claimed) throw new ApiError(409, "invite_already_sent", "This invite was already sent.");
  const sent = await sendInvite({
    to: claimed.email, sharerName: account.display_name, documentName: doc.name, documentId: docId, role: claimed.role,
  });
  const [updated] = await query<ShareRow>("UPDATE shares SET invite_status = $2, sending_since = NULL WHERE id = $1 RETURNING *", [
    shareId, sent ? "sent" : "not_sent",
  ]);
  if (!sent) throw new ApiError(503, "mail_unavailable", "The mail server is unreachable.");
  return json(200, { share: shareJson(updated!) });
}
