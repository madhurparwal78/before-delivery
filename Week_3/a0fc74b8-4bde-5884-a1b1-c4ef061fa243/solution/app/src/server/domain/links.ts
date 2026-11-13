import { type Db, pool, tx } from "../db.js";
import { linkClosed, notFound } from "../errors.js";
import { sha256Hex } from "../util.js";
import type { LinkState, SignLinkJson } from "../../shared/types.js";
import { linkState } from "./linkState.js";
import { type DocumentRow, type FieldRow, type RecipientRow, fieldsOf, ownerOf, recipientsOf } from "./rows.js";
import { signFieldJson } from "./serialize.js";
import { expireDue, markViewed } from "./workflow.js";

export interface LinkContext {
  document: DocumentRow;
  recipient: RecipientRow;
  state: LinkState;
}

async function locate(db: Db, token: string): Promise<{ documentId: string; recipientId: string } | null> {
  const { rows } = await db.query<{ document_id: string; recipient_id: string }>(
    "SELECT r.document_id, l.recipient_id FROM links l JOIN recipients r ON r.id = l.recipient_id WHERE l.token_hash = $1",
    [sha256Hex(token)],
  );
  const row = rows[0];
  return row ? { documentId: row.document_id, recipientId: row.recipient_id } : null;
}

async function context(db: Db, token: string, lock: boolean): Promise<LinkContext> {
  const found = await locate(db, token);
  if (!found) throw notFound();
  const { rows: documents } = await db.query<DocumentRow>(`SELECT * FROM documents WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [found.documentId]);
  const document = documents[0];
  if (!document) throw notFound();
  await expireDue(db, document.id);
  const { rows: recipients } = await db.query<RecipientRow>("SELECT * FROM recipients WHERE id = $1", [found.recipientId]);
  const { rows: links } = await db.query<{ replaced: boolean }>("SELECT replaced FROM links WHERE token_hash = $1", [sha256Hex(token)]);
  const recipient = recipients[0];
  if (!recipient) throw notFound();
  const { rows: current } = await db.query<DocumentRow>("SELECT * FROM documents WHERE id = $1", [document.id]);
  const fresh = current[0] ?? document;
  return { document: fresh, recipient, state: linkState(fresh, recipient, links[0]?.replaced ?? false) };
}

export async function readLink(token: string): Promise<LinkContext> {
  const first = await context(pool, token, false);
  if (first.state !== "your_turn" || first.recipient.status !== "invited") return first;
  return tx(async (client) => {
    const locked = await context(client, token, true);
    if (locked.state === "your_turn") await markViewed(client, locked.document, locked.recipient);
    return context(client, token, false);
  });
}

export async function lockLink(db: Db, token: string): Promise<LinkContext> {
  return context(db, token, true);
}

export function requireTurn(link: LinkContext): void {
  if (link.state !== "your_turn") throw linkClosed(link.state);
}

export async function signView(link: LinkContext): Promise<SignLinkJson> {
  const { document, recipient, state } = link;
  const [recipients, fields, owner] = await Promise.all([recipientsOf(pool, document.id), fieldsOf(pool, document.id), ownerOf(pool, document.owner_id)]);
  const playing = state === "your_turn";
  const current = document.status === "in_progress" ? recipients.find((r) => r.signing_order === document.current_order) : undefined;
  const decliner = recipients.find((r) => r.status === "declined");
  const own: FieldRow[] = playing ? fields.filter((f) => f.recipient_id === recipient.id) : [];
  return {
    state,
    title: document.title,
    recipient: { id: recipient.id, name: recipient.name, order: recipient.signing_order, status: recipient.status },
    signerCount: recipients.length,
    current: current ? { name: current.name, order: current.signing_order } : null,
    senderName: owner.name,
    declinedBy: decliner?.name ?? null,
    voidReason: document.void_reason,
    pageCount: document.page_count,
    pageSizes: document.page_sizes,
    timeZone: document.time_zone,
    fields: own.map(signFieldJson),
    otherFields: playing
      ? fields.filter((f) => f.recipient_id !== recipient.id).map((f) => ({ page: f.page, x: f.x, y: f.y, w: f.w, h: f.h }))
      : [],
  };
}
