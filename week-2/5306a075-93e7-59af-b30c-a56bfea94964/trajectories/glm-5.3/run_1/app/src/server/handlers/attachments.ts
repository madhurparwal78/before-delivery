import { randomUUID } from "node:crypto";
import type { Attachment } from "../../shared/types.js";
import { errors } from "../errors.js";
import { route, type Route, type RequestContext } from "../router.js";
import { audit } from "../audit.js";
import {
  bytesMatchKind,
  displayFilename,
  kindForExtension,
  MAX_ATTACHMENT_BYTES,
  safeStorageName,
  contentDispositionFilename,
} from "../../shared/attachment.js";
import { storage } from "../services.js";
import { iso } from "./session.js";
import { loadNote, resolveLocalTime } from "./notes.js";

export const noteActionRoutes: Route[] = [
  {
    pattern: route("notes/:id"),
    methods: ["DELETE"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query<{ id: string }>(
          "SELECT id FROM notes WHERE id = $1 AND workspace_id = $2",
          [id, workspaceId],
        );
        if (found.rowCount === 0) throw errors.notFound();
        // Insights and attachments go with the note; storage objects are
        // drained by the deletion worker (DP-46).
        await client.query(
          `INSERT INTO pending_object_deletions (id, workspace_id, prefix)
           VALUES ($1, $2, $3)`,
          [randomUUID(), workspaceId, `notes/${id}/`],
        );
        await client.query(
          "DELETE FROM notes WHERE id = $1 AND workspace_id = $2",
          [id, workspaceId],
        );
        await audit(client, workspaceId, ctx.member!.id, "delete_note", "note", id, null);
        await client.query("COMMIT");
        return { status: 204 };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("notes/:id/status"),
    methods: ["POST"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const to = typeof ctx.body.to === "string" ? ctx.body.to : null;
      if (to !== "processed" && to !== "unprocessed") {
        throw errors.validationFailed({ to: "Pick processed or unprocessed." });
      }
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        // A snooze that has ended returns the note to unprocessed first.
        await client.query(
          `UPDATE notes SET status = 'unprocessed', snoozed_until = NULL
           WHERE workspace_id = $1 AND status = 'snoozed' AND snoozed_until <= now()`,
          [workspaceId],
        );
        const row = await client.query<{ status: string }>(
          "SELECT status FROM notes WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [id, workspaceId],
        );
        if (row.rowCount === 0) throw errors.notFound();
        const from = row.rows[0]!.status;
        // Legal edges: unprocessed → processed, processed → unprocessed (DP-03).
        const legal =
          (from === "unprocessed" && to === "processed") ||
          (from === "processed" && to === "unprocessed");
        if (!legal) {
          throw errors.invalidTransition({ from, to });
        }
        await client.query(
          "UPDATE notes SET status = $1, processed_at = CASE WHEN $1 = 'processed' THEN now() ELSE NULL END, snoozed_until = NULL WHERE id = $2",
          [to, id],
        );
        await audit(client, workspaceId, ctx.member!.id, `note_${to}`, "note", id, { from, to });
        await client.query("COMMIT");
        const note = await loadNote(client, id, workspaceId);
        return { status: 200, body: { note } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("notes/:id/snooze"),
    methods: ["POST"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const until = typeof ctx.body.until === "string" ? ctx.body.until : null;
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE notes SET status = 'unprocessed', snoozed_until = NULL
           WHERE workspace_id = $1 AND status = 'snoozed' AND snoozed_until <= now()`,
          [workspaceId],
        );
        const row = await client.query<{ status: string; time_zone: string }>(
          `SELECT n.status, w.time_zone FROM notes n JOIN workspaces w ON w.id = n.workspace_id
           WHERE n.id = $1 AND n.workspace_id = $2 FOR UPDATE OF n`,
          [id, workspaceId],
        );
        if (row.rowCount === 0) throw errors.notFound();
        const { status, time_zone: timeZone } = row.rows[0]!;
        // The legal edge is checked before the time is validated (DP-37).
        if (status !== "unprocessed" && status !== "snoozed") {
          throw errors.invalidTransition({ from: status, to: "snoozed" });
        }
        if (until === null) {
          throw errors.validationFailed({ until: "Pick a time in the future." });
        }
        const resolved = resolveLocalTime(until, timeZone, new Date());
        if (!resolved.ok || resolved.instant === null) {
          throw errors.validationFailed({ until: "Pick a time in the future." });
        }
        if (resolved.instant.getTime() <= Date.now()) {
          throw errors.validationFailed({ until: "Pick a time in the future." });
        }
        await client.query(
          "UPDATE notes SET status = 'snoozed', snoozed_until = $1 WHERE id = $2",
          [resolved.instant, id],
        );
        await audit(client, workspaceId, ctx.member!.id, "note_snoozed", "note", id, {
          until: iso(resolved.instant),
        });
        await client.query("COMMIT");
        const note = await loadNote(client, id, workspaceId);
        return { status: 200, body: { note } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("notes/:id/attachments"),
    methods: ["POST"],
    roles: "any",
    multipart: true,
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      if (ctx.file === null) {
        throw errors.validationFailed({ file: "Attach a transcript or file." });
      }
      const rawName = ctx.file.filename;
      const name = displayFilename(rawName);
      const kind = kindForExtension(name);
      if (kind === null) {
        throw errors.unsupportedMediaType();
      }
      if (ctx.file.bytes.length > MAX_ATTACHMENT_BYTES) {
        throw errors.payloadTooLarge();
      }
      // The content check runs before anything is stored (DP-47).
      if (!bytesMatchKind(new Uint8Array(ctx.file.bytes), kind.ext)) {
        throw errors.validationFailed({
          file: `${name} is not a valid ${kind.ext} file.`,
        });
      }
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query("SELECT id FROM notes WHERE id = $1 AND workspace_id = $2", [
          id,
          workspaceId,
        ]);
        if (found.rowCount === 0) throw errors.notFound();
        const attachmentId = randomUUID();
        const storageKey = `notes/${id}/${attachmentId}-${safeStorageName(name)}`;
        const uploaded = await storage.put(storageKey, ctx.file.bytes, kind.contentType);
        await client.query(
          `INSERT INTO attachments (id, note_id, workspace_id, filename, content_type, size,
             status, storage_key, pending_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            attachmentId,
            id,
            workspaceId,
            name,
            kind.contentType,
            ctx.file.bytes.length,
            uploaded ? "available" : "pending",
            storageKey,
            uploaded ? null : ctx.file.bytes,
          ],
        );
        await audit(client, workspaceId, ctx.member!.id, "attach_file", "attachment", attachmentId, {
          name,
          pending: !uploaded,
        });
        await client.query("COMMIT");
        const attachment: Attachment = {
          id: attachmentId,
          filename: name,
          contentType: kind.contentType,
          size: ctx.file.bytes.length,
          status: uploaded ? "available" : "pending",
        };
        return { status: 201, body: { attachment } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("attachments/:id"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const result = await ctx.pool.query<{
        id: string;
        filename: string;
        content_type: string;
        status: "available" | "pending";
        storage_key: string;
      }>(
        `SELECT a.id, a.filename, a.content_type, a.status, a.storage_key
         FROM attachments a JOIN notes n ON n.id = a.note_id
         WHERE a.id = $1 AND a.workspace_id = $2`,
        [id, workspaceId],
      );
      const row = result.rows[0];
      if (row === undefined) throw errors.notFound();
      if (row.status === "pending") throw errors.attachmentPending();
      const object = await storage.get(row.storage_key);
      if (object === null) throw errors.storageUnavailable();
      return {
        status: 200,
        body: object.bytes,
        headers: {
          "Content-Type": row.content_type,
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": contentDispositionFilename(row.filename),
          "Cache-Control": "no-store",
        },
      };
    },
  },
];
