import { db } from "../db.js";
import { attachmentKey, contentDisposition, contentMatches, contentTypeOf, extensionOf } from "../domain/attachmentRules.js";
import { conflict, invalid, notFound, storageUnavailable } from "../http/errors.js";
import { ANY, member, type MemberCtx, type Router } from "../http/router.js";
import { getObject, putObject, StorageUnavailable } from "../services/storage.js";
import { audit } from "./records.js";

async function noteOf(ctx: MemberCtx): Promise<string> {
  const id = ctx.params.id ?? "";
  if ((await db.query("SELECT 1 FROM notes WHERE id = $1 AND workspace_id = $2", [id, ctx.session.workspace.id])).length === 0) throw notFound();
  return id;
}

async function attachmentOf(ctx: MemberCtx): Promise<{ id: string; filename: string; content_type: string; status: string; storage_key: string }> {
  const [row] = await db.query<{ id: string; filename: string; content_type: string; status: string; storage_key: string }>(
    `SELECT a.id, a.filename, a.content_type, a.status, a.storage_key
       FROM attachments a JOIN notes n ON n.id = a.note_id WHERE a.id = $1 AND n.workspace_id = $2`,
    [ctx.params.id ?? "", ctx.session.workspace.id],
  );
  if (!row) throw notFound();
  return row;
}

export function attachmentRoutes(router: Router): void {
  router.add("/api/notes/:id/attachments", {
    POST: member({
      roles: ANY,
      body: "multipart",
      load: noteOf,
      handle: async (ctx, noteId) => {
        const upload = ctx.upload;
        if (upload === null) throw invalid({ file: "Attach a .txt, .vtt, .pdf, .png or .jpg file." });
        const extension = extensionOf(upload.filename).toLowerCase();
        if (!contentMatches(upload.kind, upload.bytes)) throw invalid({ file: `${upload.filename} is not a valid ${extension} file.` });
        const contentType = contentTypeOf(upload.kind);
        const [{ id }] = await db.query<{ id: string }>("SELECT gen_id('a') AS id");
        const key = attachmentKey(noteId, id, upload.filename);
        let status: "available" | "pending" = "available";
        try {
          await putObject(key, upload.bytes, contentType);
        } catch (error) {
          if (!(error instanceof StorageUnavailable)) throw error;
          status = "pending";
        }
        await db.transaction(async (tx) => {
          await tx.query(
            `INSERT INTO attachments (id, note_id, filename, content_type, size, status, storage_key, pending_bytes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, noteId, upload.filename, contentType, upload.bytes.length, status, key, status === "pending" ? upload.bytes : null],
          );
          await audit(tx, ctx, ctx.session.workspace.id, "attachment.added", id, { noteId, status });
        });
        return { status: 201, json: { attachment: { id, filename: upload.filename, contentType, size: upload.bytes.length, status } } };
      },
    }),
  });

  router.add("/api/attachments/:id", {
    GET: member({
      roles: ANY,
      load: attachmentOf,
      handle: async (_ctx, attachment) => {
        if (attachment.status === "pending") throw conflict("attachment_pending", "This file will upload when storage is back.");
        let bytes: Buffer;
        try {
          bytes = await getObject(attachment.storage_key);
        } catch (error) {
          if (error instanceof StorageUnavailable) throw storageUnavailable();
          throw error;
        }
        return {
          status: 200,
          body: bytes,
          headers: {
            "Content-Type": attachment.content_type,
            "Content-Disposition": contentDisposition(attachment.filename),
            "Cache-Control": "private, no-store",
          },
        };
      },
    }),
  });
}
