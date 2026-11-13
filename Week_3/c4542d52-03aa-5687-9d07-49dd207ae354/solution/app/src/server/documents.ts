import { createHash } from "node:crypto";
import type { Document, DocumentKind } from "../shared/types.js";
import { dollars, displayDate, groupThousands, VESTING_LABEL } from "../shared/format.js";
import { nextId, query, transaction, type Tx } from "./db.js";
import { conflict, notFound, validation, vaultUnavailable, ApiError } from "./errors.js";
import { iso, now } from "./time.js";
import { readObject, writeObject } from "./vault.js";
import type { Person } from "../shared/types.js";

type DocumentRow = {
  id: string;
  kind: DocumentKind;
  title: string;
  owner_id: string;
  status: "pending" | "sealed";
  sha256: string;
  vault_key: string;
  created_at: Date;
  version: number;
  supersedes: string | null;
  superseded_by: string | null;
  body: string | null;
};

const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export function presentDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    owner_id: row.owner_id,
    status: row.status,
    sha256: row.sha256,
    vault_key: row.vault_key,
    created_at: iso(row.created_at),
    version: row.version,
    supersedes: row.supersedes,
    superseded_by: row.superseded_by,
  };
}

export function grantAgreementText(grant: {
  id: string;
  holderName: string;
  options: number;
  strike: string;
  vestingType: keyof typeof VESTING_LABEL;
  vestingStart: string;
  signedAt: Date;
}): string {
  return [
    "Tidecraft Robotics, Inc. — Stock Option Grant Agreement",
    `Grant: ${grant.id}`,
    `Holder: ${grant.holderName}`,
    `Options: ${groupThousands(grant.options)}`,
    `Strike price: ${dollars(grant.strike)}`,
    `Vesting: ${VESTING_LABEL[grant.vestingType]}, from ${displayDate(grant.vestingStart)}`,
    `Signed by: ${grant.holderName}`,
    `Signed at: ${iso(grant.signedAt)}`,
    "",
  ].join("\n");
}

export function exerciseNoticeText(order: {
  id: string;
  grantId: string;
  holderName: string;
  options: number;
  strike: string;
  cost: string;
  paymentId: string;
  issuedAt: Date;
}): string {
  return [
    "Tidecraft Robotics, Inc. — Notice of Exercise",
    `Order: ${order.id}`,
    `Grant: ${order.grantId}`,
    `Holder: ${order.holderName}`,
    `Options exercised: ${groupThousands(order.options)}`,
    `Strike price: ${dollars(order.strike)}`,
    `Exercise cost: ${dollars(order.cost)}`,
    `Payment reference: ${order.paymentId}`,
    `Issued at: ${iso(order.issuedAt)}`,
    "",
  ].join("\n");
}

export function tenderNdaText(nda: { tenderId: string; sellerName: string; signedAt: Date }): string {
  return [
    "Tidecraft Robotics, Inc. — Tender Offer Confidentiality Agreement",
    `Tender: ${nda.tenderId}`,
    `Seller: ${nda.sellerName}`,
    `Signed at: ${iso(nda.signedAt)}`,
    "",
  ].join("\n");
}

/** Records a document as pending, with the hash its bytes must have in the vault. */
export async function createPendingDocument(
  tx: Tx,
  document: { kind: DocumentKind; title: string; ownerId: string; vaultKey: string; text: string },
): Promise<string> {
  const id = await nextId(tx, "document_number", "DOC-", 6);
  await tx.query(
    `INSERT INTO documents (id, kind, title, owner_id, status, sha256, vault_key, created_at, body)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)`,
    [id, document.kind, document.title, document.ownerId, sha256Of(Buffer.from(document.text, "utf-8")), document.vaultKey, now(), document.text],
  );
  return id;
}

/** Seals a pending document: its bytes are in the vault and read back matching the recorded hash. Throws vault_unavailable. */
export async function sealDocument(tx: Tx, documentId: string): Promise<void> {
  const [row] = await tx.query<DocumentRow>("SELECT * FROM documents WHERE id = $1 FOR UPDATE", [documentId]);
  if (!row || row.status === "sealed") return;
  await writeObject(row.vault_key, Buffer.from(row.body ?? "", "utf-8"));
  const stored = await readObject(row.vault_key);
  if (stored === null || sha256Of(stored) !== row.sha256) throw vaultUnavailable();
  await tx.query("UPDATE documents SET status = 'sealed', body = NULL WHERE id = $1", [documentId]);
  tx.emit({ to: row.owner_id, type: "changed", data: { topics: ["documents"] } });
  tx.emit({ to: null, type: "changed", data: { topics: ["documents"] } });
}

export async function listDocuments(person: Person): Promise<Document[]> {
  const rows = person.role === "founder_admin"
    ? await query<DocumentRow>("SELECT * FROM documents ORDER BY id DESC")
    : await query<DocumentRow>("SELECT * FROM documents WHERE owner_id = $1 ORDER BY id DESC", [person.id]);
  return rows.map(presentDocument);
}

export async function documentRow(person: Person, id: string): Promise<DocumentRow> {
  const [row] = await query<DocumentRow>("SELECT * FROM documents WHERE id = $1", [id]);
  if (!row || (person.role !== "founder_admin" && row.owner_id !== person.id)) throw notFound();
  return row;
}

export async function documentContent(row: DocumentRow): Promise<Buffer> {
  if (row.status !== "sealed") throw conflict("document_pending", "This document is still waiting to be sealed in the vault.");
  const bytes = await readObject(row.vault_key);
  if (bytes === null) throw vaultUnavailable();
  return bytes;
}

/** A correction is a new, linked, sealed version; the original stays readable byte for byte. */
export async function correctDocument(row: DocumentRow, text: unknown): Promise<Document> {
  if (row.kind === "tender_nda") throw conflict("document_not_correctable", "A tender NDA is never corrected.");
  if (row.superseded_by !== null) throw conflict("document_superseded", "Only the latest version of a document can be corrected.");
  if (row.status !== "sealed") throw conflict("document_pending", "This document is still waiting to be sealed in the vault.");
  if (typeof text !== "string" || text.length < 1 || [...text].length > 20000) {
    throw validation({ text: "Enter the corrected text, 1 to 20,000 characters." });
  }
  const version = row.version + 1;
  const root = row.vault_key.replace(/(\.v\d+)?\.txt$/, "");
  const vaultKey = `${root}.v${version}.txt`;
  const bytes = Buffer.from(text, "utf-8");
  const hash = sha256Of(bytes);
  await writeObject(vaultKey, bytes);
  const stored = await readObject(vaultKey);
  if (stored === null || sha256Of(stored) !== hash) throw vaultUnavailable();
  return transaction(async (tx) => {
    const [current] = await tx.query<DocumentRow>("SELECT * FROM documents WHERE id = $1 FOR UPDATE", [row.id]);
    if (!current || current.superseded_by !== null) {
      throw new ApiError(409, "document_superseded", "Only the latest version of a document can be corrected.");
    }
    const id = await nextId(tx, "document_number", "DOC-", 6);
    await tx.query(
      `INSERT INTO documents (id, kind, title, owner_id, status, sha256, vault_key, created_at, version, supersedes)
       VALUES ($1, $2, $3, $4, 'sealed', $5, $6, $7, $8, $9)`,
      [id, row.kind, row.title, row.owner_id, hash, vaultKey, now(), version, row.id],
    );
    await tx.query("UPDATE documents SET superseded_by = $2 WHERE id = $1", [row.id, id]);
    tx.emit({ to: null, type: "changed", data: { topics: ["documents"] } });
    const [created] = await tx.query<DocumentRow>("SELECT * FROM documents WHERE id = $1", [id]);
    if (!created) throw notFound();
    return presentDocument(created);
  });
}
