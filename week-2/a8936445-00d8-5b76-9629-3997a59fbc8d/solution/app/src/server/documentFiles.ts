// Reading a compliance document's stored bytes.
import type { Queryable } from "./db";
import type { DocumentRow } from "./records";
import { seededDocumentFile } from "./seed";
import { getObject, putObject } from "./storage";

/** A document's bytes; a seeded document whose file could not be written at seed time is written now. */
export async function documentFile(db: Queryable, doc: DocumentRow): Promise<Buffer | null> {
  if (doc.file_pending) {
    const data = await seededDocumentFile(db, doc);
    await putObject(doc.storage_key, data, doc.content_type);
    await db.query("UPDATE documents SET file_pending = false WHERE id = $1", [doc.id]);
    return data;
  }
  return getObject(doc.storage_key);
}
