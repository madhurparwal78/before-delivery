import { db } from "../../db.js";
import { nextDocumentId } from "../../ids.js";
import { writeWithEvents } from "../../live/events.js";
import { personAudience } from "../../flows/audiences.js";
import { DOCUMENT_COLUMNS, toDocument, type DocumentRow } from "../../services/documents.js";
import { getObject, sealObject, VaultUnavailableError } from "../../services/vault.js";
import { conflict, forbidden, notFound, unavailable, validation } from "../errors.js";
import { field, readText } from "../fields.js";
import { json, requirePerson, requireRole, type Handler } from "../context.js";
import { route, type Route } from "../router.js";

async function documentFor(id: string, personId: string, isAdmin: boolean): Promise<DocumentRow> {
  const row = await db.queryOne<DocumentRow>(`select ${DOCUMENT_COLUMNS} from documents where id = $1`, [id]);
  if (row === null) throw notFound();
  if (!isAdmin && row.owner_id !== personId) throw notFound();
  return row;
}

const listDocuments: Handler = async (context) => {
  const person = requirePerson(context);
  if (person.role === "board_member") throw forbidden();
  const rows =
    person.role === "founder_admin"
      ? await db.query<DocumentRow>(`select ${DOCUMENT_COLUMNS} from documents order by id`)
      : await db.query<DocumentRow>(`select ${DOCUMENT_COLUMNS} from documents where owner_id = $1 order by id`, [
          person.id,
        ]);
  return json({ documents: rows.map(toDocument) });
};

const readDocument: Handler = async (context) => {
  const person = requirePerson(context);
  const row = await documentFor(context.params["id"] ?? "", person.id, person.role === "founder_admin");
  return json(toDocument(row));
};

const readContent: Handler = async (context) => {
  const person = requirePerson(context);
  const row = await documentFor(context.params["id"] ?? "", person.id, person.role === "founder_admin");
  if (row.status !== "sealed" || row.sha256 === null) {
    throw conflict("document_pending", "This document is not sealed in the vault yet.");
  }
  try {
    const bytes = await getObject(row.vault_key);
    return {
      status: 200,
      raw: bytes,
      headers: { "content-type": "text/plain; charset=utf-8", "x-document-sha256": row.sha256 },
    };
  } catch (error) {
    if (!(error instanceof VaultUnavailableError)) throw error;
    throw unavailable("vault_unavailable", "The document vault can't be reached. Try again shortly.");
  }
};

const correctDocument: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const id = context.params["id"] ?? "";
  const original = await db.queryOne<DocumentRow>(`select ${DOCUMENT_COLUMNS} from documents where id = $1`, [id]);
  if (original === null) throw notFound();
  if (original.kind === "tender_nda") throw conflict("document_not_correctable", "A tender NDA is never corrected.");
  if (original.superseded_by !== null) {
    throw conflict("document_superseded", "Only the latest version of a document can be corrected.");
  }
  if (original.status !== "sealed") throw conflict("document_pending", "This document is not sealed in the vault yet.");
  const text = readText(field(context.body, "text"));
  if (text === null || [...text].length < 1 || [...text].length > 20000) {
    throw validation({ text: "Enter the corrected document text of 1 to 20,000 characters." });
  }
  const version = original.version + 1;
  const vaultKey = `${original.vault_key.replace(/\.txt$/, "")}.v${version}.txt`;
  let hash: string;
  try {
    hash = await sealObject(vaultKey, text);
  } catch (error) {
    if (!(error instanceof VaultUnavailableError)) throw error;
    throw unavailable("vault_unavailable", "The document vault can't be reached. Try again shortly.");
  }
  return writeWithEvents(async (tx, emit) => {
    const newId = await nextDocumentId(tx);
    const rows = await tx.query<DocumentRow>(
      `insert into documents (id, kind, title, owner_id, status, sha256, vault_key, body, version, supersedes)
       values ($1, $2, $3, $4, 'sealed', $5, $6, $7, $8, $9)
       returning ${DOCUMENT_COLUMNS}`,
      [newId, original.kind, original.title, original.owner_id, hash, vaultKey, text, version, original.id],
    );
    const created = rows[0];
    if (created === undefined) throw new Error("the correction was not written");
    await tx.query("update documents set superseded_by = $2 where id = $1", [original.id, newId]);
    await emit("document_changed", { document_id: newId, corrects: original.id }, personAudience(original.owner_id));
    return json(toDocument(created), 201);
  });
};

export const documentRoutes: Route[] = [
  route("GET", "/api/documents", listDocuments),
  route("GET", "/api/documents/:id", readDocument),
  route("GET", "/api/documents/:id/content", readContent),
  route("POST", "/api/documents/:id/corrections", correctDocument),
];
