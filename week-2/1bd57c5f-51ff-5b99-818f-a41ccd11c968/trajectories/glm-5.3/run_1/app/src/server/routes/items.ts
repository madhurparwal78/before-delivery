import express, { type Request, type Response } from "express";
import type { Db } from "../db/schema.js";
import { ApiError, Errors, FIELD_MESSAGES } from "../errors.js";
import { newId } from "../identity.js";
import { EventLog } from "../events.js";
import { detectImage, stripMetadata, storage } from "../storage.js";
import { utcIso } from "../times.js";
import * as money from "../money.js";
import type { Pt, TradeKey, Role } from "../../shared/types.js";
import { TRADES } from "../../shared/types.js";
import { pointInOutline } from "../geometry.js";
import type { Outline } from "../../shared/types.js";
import {
  actionPermitted, awaitingTrade, blockedByNumbers, completionPhotoRequired, conflictsOf, completionCount,
  derivedCounts, itemById, itemExtras, nextItemNumber, notesOf, photosOf, recordChange, recordItemChange,
  roomForPin, roomsOf, roomNameOf, targetStatus, transitionAllowed, unverifiedBlockers, validatePin, visibleItem,
} from "../domain.js";
import { canSeeItem, checkItemVisible, projectItem, projectNote, type DbItem } from "../projection.js";
import {
  applyEdit, charsForBody, latestActiveOwnEdit, latestRedoableEdit, visibleBodyAt,
  type CharState, type EditSpec, type RevisionMeta, type RevisionKind,
} from "../notes-model.js";
import { assignmentNotices } from "../notices.js";
import { withJob } from "./shared.js";

type LoadedNote = {
  id: string;
  item_id: string;
  parent_id: string | null;
  body: string;
  audience: "crew" | "everyone";
  author_id: string;
  rev: number;
  chars: CharState[];
  revisions: RevisionMeta[];
};

export function createItemsRouter(db: Db): express.Router {
  const router = express.Router();

  router.get("/jobs/:jobId/items", async (req: Request, res: Response) => {
    const items = await withJob(req, db, req.params.jobId, async (ctx) => {
      const rows = await ctx.client.query<{ id: string }>(
        `SELECT i.id FROM items i JOIN rooms r ON r.id = i.room_id
         WHERE i.job_id = $1 AND i.deleted_at IS NULL ORDER BY r.sort_order, i.number`,
        [ctx.jobId],
      );
      const out: Record<string, unknown>[] = [];
      for (const row of rows.rows) {
        const item = await itemById(ctx.client, ctx.jobId, row.id);
        if (item === null || item.deleted_at !== null) continue;
        if (!canSeeItem(ctx.membership, item)) continue;
        out.push(projectItem(ctx, ctx.jobId, item, await itemExtras(ctx, item)));
      }
      return out;
    });
    res.json({ items });
  });

  router.post("/jobs/:jobId/items", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const itemId = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const role = ctx.membership.role;
      if (role === "trade") throw Errors.forbidden();

      const fields: Record<string, string> = {};
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (title.length < 1 || title.length > 200) fields.title = "Give the item a title.";
      const rooms = await roomsOf(ctx.client, ctx.jobId);
      const room = typeof body.room_id === "string" ? rooms.find((r) => r.id === body.room_id) : undefined;
      if (room === undefined) fields.room_id = "Pick a room.";

      const pinSent = body.pin !== undefined && body.pin !== null;
      const pin = pinSent ? validatePin(body.pin) : null;
      if (pinSent && pin === null) fields.pin = FIELD_MESSAGES.pin;

      const forbiddenSent = ["trade", "cost_note", "quantity", "unit_cost"].some((k) => sentValue(body[k]));
      if (role === "homeowner" && forbiddenSent) throw Errors.forbidden();

      const trade = tradeOrNull(body.trade, fields);
      const costNote = body.cost_note === undefined || body.cost_note === null ? null : typeof body.cost_note === "string" ? body.cost_note : undefined;
      if (costNote === undefined) fields.cost_note = "The cost note is text.";
      else if (costNote !== null && costNote.length > 1000) fields.cost_note = "The cost note is up to 1,000 characters.";
      const quantity = decimalOrNull(body.quantity, "quantity", fields, money.parseQuantity);
      const unitCost = decimalOrNull(body.unit_cost, "unit_cost", fields, money.parseUnitCost);
      if (Object.keys(fields).length > 0) throw Errors.validation(fields);

      // The pin decides the room; the given room_id breaks shared edges.
      let roomId = room!.id;
      if (pin !== null) {
        const decided = roomForPin(pin, rooms, room!.id, null);
        if (decided === null) throw Errors.validation({ pin: FIELD_MESSAGES.pin });
        roomId = decided;
      }

      const log = new EventLog(ctx.client);
      const id = newId("item");
      const number = await nextItemNumber(ctx.client, ctx.jobId);
      await ctx.client.query(
        `INSERT INTO items (id, job_id, number, title, room_id, trade, status, pin_x, pin_y, pin_status, cost_note, quantity, unit_cost, created_by, last_edited_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, $12, $13, $13)`,
        [id, ctx.jobId, number, title, roomId, trade,
          pin === null ? null : pin.x.toFixed(4), pin === null ? null : pin.y.toFixed(4),
          pin === null ? "unpinned" : "placed",
          costNote,
          quantity === undefined ? null : quantity === null ? null : money.fmtFixed(quantity, 3),
          unitCost === undefined ? null : unitCost === null ? null : money.fmtFixed(unitCost, 2),
          ctx.membership.id],
      );
      await recordChange(ctx.client, ctx.jobId);
      await recordItemChange(ctx.client, ctx.jobId, { id, number, title }, "created");
      if (trade !== null && trade !== undefined) {
        const roomName = await roomNameOf(ctx.client, roomId);
        await assignmentNotices(ctx.client, ctx.jobId, { number, title, roomName }, trade);
      }
      await log.emit(ctx.jobId, "item", { item_id: id });
      await log.emit(ctx.jobId, "counts", {});
      await log.emit(ctx.jobId, "costs", {});
      return id;
    });
    res.status(201).json(await fullItem(req, db, req.params.jobId, itemId));
  });

  router.get("/jobs/:jobId/items/:itemId", async (req: Request, res: Response) => {
    const item = await withJob(req, db, req.params.jobId, async (ctx) => {
      const loaded = await visibleItem(ctx, req.params.itemId);
      return projectItem(ctx, ctx.jobId, loaded, await itemExtras(ctx, loaded));
    });
    res.json(item);
  });

  router.patch("/jobs/:jobId/items/:itemId", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const itemId = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const item = await visibleItem(ctx, req.params.itemId);
      const role = ctx.membership.role;
      const crew = role === "owner" || role === "lead";
      if (!crew) {
        const onlyPin = Object.keys(body).length > 0 && Object.keys(body).every((k) => k === "pin");
        const own = item.created_by_person === ctx.membership.personId;
        if (role !== "homeowner" || !onlyPin || !own) throw Errors.forbidden();
      }

      const fields: Record<string, string> = {};
      const rooms = await roomsOf(ctx.client, ctx.jobId);

      if (body.title !== undefined) {
        if (typeof body.title !== "string" || body.title.trim().length < 1 || body.title.trim().length > 200) {
          fields.title = "Give the item a title.";
        }
      }
      if (body.cost_note !== undefined) {
        if (body.cost_note !== null && typeof body.cost_note !== "string") fields.cost_note = "The cost note is text.";
        else if (body.cost_note !== null && (body.cost_note as string).length > 1000) fields.cost_note = "The cost note is up to 1,000 characters.";
      }
      const quantity = decimalOrNull(body.quantity, "quantity", fields, money.parseQuantity);
      const unitCost = decimalOrNull(body.unit_cost, "unit_cost", fields, money.parseUnitCost);
      const trade = tradeOrNull(body.trade, fields);

      let pin: Pt | null | undefined = undefined;
      let requestedRoomId: string | undefined = undefined;
      if (body.pin !== undefined) {
        pin = body.pin === null ? null : validatePin(body.pin);
        if (pin === null && body.pin !== null) fields.pin = FIELD_MESSAGES.pin;
      }
      if (body.room_id !== undefined) {
        const room = rooms.find((r) => r.id === body.room_id);
        if (room === undefined) fields.room_id = "Pick a room.";
        else requestedRoomId = room.id;
      }
      if (Object.keys(fields).length > 0) throw Errors.validation(fields);

      let roomId = item.room_id;
      let newPinX = item.pin_x === null ? null : Number(item.pin_x);
      let newPinY = item.pin_y === null ? null : Number(item.pin_y);
      let newPinStatus = item.pin_status;

      if (pin !== undefined) {
        if (pin === null) {
          newPinX = null;
          newPinY = null;
          newPinStatus = "unpinned";
        } else {
          const decided = roomForPin(pin, rooms, requestedRoomId ?? null, item.room_id);
          if (decided === null) throw Errors.validation({ pin: FIELD_MESSAGES.pin });
          roomId = decided;
          newPinX = pin.x;
          newPinY = pin.y;
          newPinStatus = "placed";
        }
      } else if (requestedRoomId !== undefined && requestedRoomId !== item.room_id) {
        roomId = requestedRoomId;
        if (newPinX !== null && newPinY !== null) {
          const room = rooms.find((r) => r.id === requestedRoomId)!;
          if (!pointInOutline({ x: newPinX, y: newPinY }, room.outline as unknown as Outline)) {
            newPinX = null;
            newPinY = null;
            newPinStatus = "unpinned";
          }
        }
        await recordChange(ctx.client, ctx.jobId);
        await recordItemChange(ctx.client, ctx.jobId, item, "refiled");
      }

      if (trade !== undefined && trade !== item.trade && (item.status === "ready_for_check" || item.status === "verified")) {
        throw Errors.invalidTransition();
      }

      await ctx.client.query(
        `UPDATE items SET
           title = CASE WHEN $2 THEN $3 ELSE title END,
           cost_note = CASE WHEN $4 THEN $5 ELSE cost_note END,
           quantity = CASE WHEN $6 THEN $7 ELSE quantity END,
           unit_cost = CASE WHEN $8 THEN $9 ELSE unit_cost END,
           trade = CASE WHEN $10 THEN $11 ELSE trade END,
           room_id = $12, pin_x = $13, pin_y = $14, pin_status = $15, last_edited_by = $16, updated_at = now()
         WHERE id = $1`,
        [item.id,
          body.title !== undefined, typeof body.title === "string" ? body.title.trim() : null,
          body.cost_note !== undefined, body.cost_note ?? null,
          body.quantity !== undefined, quantity === undefined || quantity === null ? null : money.fmtFixed(quantity, 3),
          body.unit_cost !== undefined, unitCost === undefined || unitCost === null ? null : money.fmtFixed(unitCost, 2),
          body.trade !== undefined, trade ?? null,
          roomId,
          newPinX === null ? null : newPinX.toFixed(4),
          newPinY === null ? null : newPinY.toFixed(4),
          newPinStatus,
          ctx.membership.id,
        ],
      );

      // Each field sent clears that field's conflict.
      for (const field of ["title", "cost_note", "quantity", "unit_cost", "trade", "room_id", "pin"]) {
        if (body[field] !== undefined && !(field === "room_id" && pin !== undefined)) {
          await ctx.client.query(`DELETE FROM conflicts WHERE item_id = $1 AND field = $2`, [item.id, field]);
        }
      }

      if (trade !== undefined && trade !== null && trade !== item.trade) {
        const roomName = await roomNameOf(ctx.client, roomId);
        await assignmentNotices(ctx.client, ctx.jobId, { number: item.number, title: item.title, roomName }, trade);
      }
      const log = new EventLog(ctx.client);
      await log.emit(ctx.jobId, "item", { item_id: item.id });
      await log.emit(ctx.jobId, "counts", {});
      await log.emit(ctx.jobId, "costs", {});
      return item.id;
    });
    res.json(await fullItem(req, db, req.params.jobId, itemId));
  });

  router.delete("/jobs/:jobId/items/:itemId", async (req: Request, res: Response) => {
    await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const item = await visibleItem(ctx, req.params.itemId);
      const role = ctx.membership.role;
      if (role === "owner") {
        if (item.status === "verified") throw Errors.invalidTransition();
      } else if (role === "lead") {
        if (item.status !== "open" || item.created_by_person !== ctx.membership.personId) throw Errors.forbidden();
      } else {
        throw Errors.forbidden();
      }

      // The photo objects go first; only then do the records commit.
      const keys = (await ctx.client.query<{ object_key: string }>(
        `SELECT object_key FROM item_photos WHERE item_id = $1`, [item.id],
      )).rows;
      for (const row of keys) {
        await storage.delete(row.object_key);
      }
      await ctx.client.query(`UPDATE items SET deleted_at = now() WHERE id = $1`, [item.id]);
      await ctx.client.query(`DELETE FROM item_links WHERE item_id = $1 OR blocker_id = $1`, [item.id]);
      await ctx.client.query(`DELETE FROM conflicts WHERE item_id = $1`, [item.id]);
      await recordChange(ctx.client, ctx.jobId);
      await recordItemChange(ctx.client, ctx.jobId, item, "deleted");
      const log = new EventLog(ctx.client);
      await log.emit(ctx.jobId, "item_deleted", { id: item.id, number: item.number, trade: item.trade });
      await log.emit(ctx.jobId, "counts", {});
      await log.emit(ctx.jobId, "costs", {});
      return item.id;
    });
    res.status(204).end();
  });

  router.post("/jobs/:jobId/items/:itemId/actions", async (req: Request, res: Response) => {
    const body = req.body as { action?: unknown; reason?: unknown };
    const action = body.action;
    if (action !== "start" && action !== "mark_done" && action !== "verify" && action !== "send_back" && action !== "reopen") {
      throw Errors.validation({ action: "Pick an action." });
    }
    if (action === "send_back" && (typeof body.reason !== "string" || body.reason.trim().length < 1 || body.reason.trim().length > 500)) {
      throw Errors.validation({ reason: "Give a reason." });
    }
    const outcome = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const item = await visibleItem(ctx, req.params.itemId);
      if (!actionPermitted(ctx.membership.role, action, item, ctx.membership.trade)) throw Errors.forbidden();
      if (!transitionAllowed(action, item.status)) throw Errors.invalidTransition();

      if (action === "mark_done" || action === "verify") {
        const blockers = await unverifiedBlockers(ctx.client, item.id);
        if (blockers.length > 0) throw Errors.blocked(blockers);
      }
      if (awaitingTrade(action, item)) throw Errors.awaitingTrade();
      if (completionPhotoRequired(action, item, await completionCount(ctx.client, item.id))) {
        throw Errors.completionPhotoRequired();
      }

      const log = new EventLog(ctx.client);
      await ctx.client.query(
        `UPDATE items SET status = $2, sent_back_reason = $3, updated_at = now() WHERE id = $1`,
        [item.id, targetStatus(action),
          action === "send_back" ? (body.reason as string).trim() : action === "mark_done" ? null : item.sent_back_reason],
      );
      await recordChange(ctx.client, ctx.jobId);
      await recordItemChange(ctx.client, ctx.jobId, item, "changed");

      let reopenedDependents: number[] = [];
      if (action === "reopen") {
        reopenedDependents = await reopenCascade(ctx.client, ctx.jobId, item.id);
      }
      await log.emit(ctx.jobId, "item", { item_id: item.id });
      for (const dep of reopenedDependents) {
        const depItem = await ctx.client.query<{ id: string }>(`SELECT id FROM items WHERE job_id = $1 AND number = $2`, [ctx.jobId, dep]);
        if (depItem.rows[0] !== undefined) await log.emit(ctx.jobId, "item", { item_id: depItem.rows[0].id });
      }
      await log.emit(ctx.jobId, "counts", {});
      return { id: item.id, reopenedDependents };
    });
    const item = await fullItem(req, db, req.params.jobId, outcome.id);
    res.json({ ...item, reopened_dependents: outcome.reopenedDependents });
  });

  router.put("/jobs/:jobId/items/:itemId/blocked-by", async (req: Request, res: Response) => {
    const body = req.body as { item_ids?: unknown };
    const itemId = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const item = await visibleItem(ctx, req.params.itemId);
      if (!Array.isArray(body.item_ids)) throw Errors.validation({ item_ids: "Pick the items this one waits on." });
      if (body.item_ids.some((v) => typeof v !== "string")) throw Errors.validation({ item_ids: "Pick the items this one waits on." });
      const ids = [...new Set(body.item_ids as string[])];
      if (ids.length > 10) throw Errors.validation({ item_ids: "An item waits on at most 10 items." });

      const blockers: DbItem[] = [];
      for (const id of ids) {
        const blocker = await itemById(ctx.client, ctx.jobId, id);
        if (blocker === null || blocker.deleted_at !== null) throw Errors.notFound();
        if (blocker.id === item.id) throw Errors.validation({ item_ids: FIELD_MESSAGES.itemIdsCycle });
        blockers.push(blocker);
      }
      for (const blocker of blockers) {
        if (await reaches(ctx.client, blocker.id, item.id)) throw Errors.validation({ item_ids: FIELD_MESSAGES.itemIdsCycle });
      }
      if (item.status === "ready_for_check" || item.status === "verified") {
        for (const blocker of blockers) {
          if (blocker.status !== "verified") throw Errors.blocked([blocker.number]);
        }
      }
      await ctx.client.query(`DELETE FROM item_links WHERE item_id = $1`, [item.id]);
      for (const blocker of blockers) {
        await ctx.client.query(`INSERT INTO item_links (job_id, item_id, blocker_id) VALUES ($1, $2, $3)`, [ctx.jobId, item.id, blocker.id]);
      }
      await new EventLog(ctx.client).emit(ctx.jobId, "item", { item_id: item.id });
      return item.id;
    });
    res.json(await fullItem(req, db, req.params.jobId, itemId));
  });

  router.post("/jobs/:jobId/items/bulk", async (req: Request, res: Response) => {
    const body = req.body as { action?: unknown; trade?: unknown; item_ids?: unknown };
    const action = body.action;
    if (action !== "start" && action !== "mark_done" && action !== "verify" && action !== "set_trade") {
      throw Errors.validation({ action: "Pick an action." });
    }
    if (action === "set_trade" && body.trade !== null && typeof body.trade !== "string") {
      throw Errors.validation({ trade: "Pick a trade." });
    }
    if (!Array.isArray(body.item_ids) || body.item_ids.some((v) => typeof v !== "string")) {
      throw Errors.validation({ item_ids: "Pick the items." });
    }
    const rawIds = body.item_ids as string[];
    if (new Set(rawIds).size !== rawIds.length && (rawIds.length > 100 || rawIds.length < 1)) {
      throw Errors.validation({ item_ids: "Pick 1 to 100 items." });
    }
    const ids = [...new Set(rawIds)];
    if (ids.length < 1 || ids.length > 100) throw Errors.validation({ item_ids: "Pick 1 to 100 items." });

    const itemIds = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      // Every id must be visible; then role is checked for the whole request.
      const loaded: DbItem[] = [];
      for (const id of ids) {
        loaded.push(await visibleItem(ctx, id));
      }
      if (ctx.membership.role === "homeowner") throw Errors.forbidden();
      if (ctx.membership.role === "trade" && (action === "verify" || action === "set_trade")) throw Errors.forbidden();

      const sorted = [...loaded].sort((a, b) => a.number - b.number);
      const overlay = new Map<string, string>();
      const failures: { number: number; error: string; message: string }[] = [];
      const touched: { item: DbItem; status?: string; trade?: TradeKey | null }[] = [];
      for (const item of sorted) {
        try {
          if (action === "set_trade") {
            const trade = (body.trade as TradeKey | null) ?? null;
            if (trade !== null && !TRADES.includes(trade)) throw Errors.validation({ trade: "Pick a trade." });
            if (trade !== item.trade && (item.status === "ready_for_check" || item.status === "verified")) {
              throw Errors.invalidTransition();
            }
            touched.push({ item, trade });
            if (trade !== null) overlay.set(item.id, item.status);
          } else {
            if (!actionPermitted(ctx.membership.role, action, item, ctx.membership.trade)) throw Errors.forbidden();
            if (!transitionAllowed(action, item.status)) throw Errors.invalidTransition();
            if (action === "mark_done" || action === "verify") {
              const blockers = await overlayBlockers(ctx.client, item.id, overlay);
              if (blockers.length > 0) throw Errors.blocked(blockers);
            }
            if (awaitingTrade(action, item)) throw Errors.awaitingTrade();
            if (completionPhotoRequired(action, item, await completionCount(ctx.client, item.id))) {
              throw Errors.completionPhotoRequired();
            }
            const status = targetStatus(action);
            touched.push({ item, status });
            overlay.set(item.id, status);
          }
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          failures.push({ number: item.number, error: e.code, message: e.message });
        }
      }
      if (failures.length > 0) throw Errors.bulkFailed(failures);

      const log = new EventLog(ctx.client);
      for (const t of touched) {
        if (t.status !== undefined) {
          await ctx.client.query(
            `UPDATE items SET status = $2, sent_back_reason = CASE WHEN $2 = 'ready_for_check' THEN NULL ELSE sent_back_reason END, updated_at = now() WHERE id = $1`,
            [t.item.id, t.status],
          );
          await recordChange(ctx.client, ctx.jobId);
          await recordItemChange(ctx.client, ctx.jobId, t.item, "changed");
        }
        if (t.trade !== undefined) {
          await ctx.client.query(`UPDATE items SET trade = $2, updated_at = now() WHERE id = $1`, [t.item.id, t.trade]);
          await recordChange(ctx.client, ctx.jobId);
        }
        await log.emit(ctx.jobId, "item", { item_id: t.item.id });
      }
      if (action === "set_trade") {
        const trade = (body.trade as TradeKey | null) ?? null;
        for (const t of touched) {
          if (trade !== null && trade !== t.item.trade) {
            const roomName = await roomNameOf(ctx.client, t.item.room_id);
            await assignmentNotices(ctx.client, ctx.jobId, { number: t.item.number, title: t.item.title, roomName }, trade);
          }
        }
      }
      await log.emit(ctx.jobId, "counts", {});
      await log.emit(ctx.jobId, "costs", {});
      return touched.map((t) => t.item.id);
    });
    const out = [];
    for (const id of itemIds) {
      out.push(await fullItem(req, db, req.params.jobId, id));
    }
    out.sort((a, b) => (a.number as number) - (b.number as number));
    res.json({ items: out });
  });

  // --- Photos ---

  router.post("/jobs/:jobId/items/:itemId/photos", async (req: Request, res: Response) => {
    const file = (req as Request & { fileBuffer?: Buffer }).fileBuffer;
    const kindPart = (req as Request & { formFields?: Record<string, string> }).formFields?.kind;
    if (file === undefined || (kindPart !== "defect" && kindPart !== "completion")) {
      throw Errors.validation({ file: "Pick an image.", kind: "Pick the photo kind." });
    }
    const kindImage = detectImage(file);
    if (kindImage === null) throw Errors.unsupportedImage();
    const clean = stripMetadata(file, kindImage);

    const photo = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const item = await visibleItem(ctx, req.params.itemId);
      const role = ctx.membership.role;
      if (kindPart === "defect") {
        if (role !== "owner" && role !== "lead") throw Errors.forbidden();
      } else {
        const assigned = role === "trade" && ctx.membership.trade !== null && item.trade === ctx.membership.trade;
        if (role !== "owner" && role !== "lead" && !assigned) throw Errors.forbidden();
      }
      const id = newId("photo");
      const objectKey = `jobs/${ctx.jobId}/items/${item.id}/photos/${id}.${kindImage.ext}`;
      await storage.put(objectKey, clean, kindImage.contentType);
      await ctx.client.query(
        `INSERT INTO item_photos (id, job_id, item_id, kind, object_key, content_type, bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, ctx.jobId, item.id, kindPart, objectKey, kindImage.contentType, clean.length, ctx.membership.id],
      );
      await new EventLog(ctx.client).emit(ctx.jobId, "item", { item_id: item.id });
      return { id, item_id: item.id };
    });
    res.status(201).json(await photoPayload(req, db, req.params.jobId, photo.id));
  });

  router.get("/jobs/:jobId/photos/:photoId", async (req: Request, res: Response) => {
    const info = await withJob(req, db, req.params.jobId, async (ctx) => {
      const row = await ctx.client.query<{ item_id: string; object_key: string; content_type: string }>(
        `SELECT item_id, object_key, content_type FROM item_photos WHERE job_id = $1 AND id = $2`,
        [ctx.jobId, req.params.photoId],
      );
      const photo = row.rows[0];
      if (photo === undefined) throw Errors.notFound();
      const item = await itemById(ctx.client, ctx.jobId, photo.item_id);
      if (item === null || item.deleted_at !== null) throw Errors.notFound();
      checkItemVisible(ctx, item);
      return photo;
    });
    const bytes = await storage.get(info.object_key);
    if (bytes === null) throw Errors.notFound();
    res.type(info.content_type).send(bytes);
  });

  router.delete("/jobs/:jobId/photos/:photoId", async (req: Request, res: Response) => {
    await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const row = await ctx.client.query<{ id: string; item_id: string; object_key: string; uploaded_by: string }>(
        `SELECT id, item_id, object_key, uploaded_by FROM item_photos WHERE job_id = $1 AND id = $2`,
        [ctx.jobId, req.params.photoId],
      );
      const photo = row.rows[0];
      if (photo === undefined) throw Errors.notFound();
      const item = await visibleItem(ctx, photo.item_id);
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead" && photo.uploaded_by !== ctx.membership.id) {
        throw Errors.forbidden();
      }
      await storage.delete(photo.object_key);
      await ctx.client.query(`DELETE FROM item_photos WHERE id = $1`, [photo.id]);
      await new EventLog(ctx.client).emit(ctx.jobId, "item", { item_id: item.id });
      return photo.id;
    });
    res.status(204).end();
  });

  // --- Notes ---

  router.post("/jobs/:jobId/items/:itemId/notes", async (req: Request, res: Response) => {
    const body = req.body as { body?: unknown; audience?: unknown; parent_id?: unknown };
    const noteId = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const item = await visibleItem(ctx, req.params.itemId);
      const fields: Record<string, string> = {};
      const bodyText = typeof body.body === "string" ? body.body : null;
      if (bodyText === null || [...bodyText].length < 1 || [...bodyText].length > 2000) fields.body = "Notes are 1 to 2,000 characters.";
      const audience = body.audience === "crew" || body.audience === "everyone" ? body.audience : undefined;
      if (audience === undefined) fields.audience = "Pick who can see this.";

      let parent: { id: string; audience: "crew" | "everyone" } | null = null;
      if (body.parent_id !== undefined && body.parent_id !== null) {
        if (typeof body.parent_id !== "string") throw Errors.notFound();
        const row = await ctx.client.query<{ id: string; parent_id: string | null; audience: "crew" | "everyone"; item_id: string }>(
          `SELECT id, parent_id, audience, item_id FROM notes WHERE job_id = $1 AND item_id = $2 AND id = $3`,
          [ctx.jobId, item.id, body.parent_id],
        );
        const found = row.rows[0];
        if (found === undefined) throw Errors.notFound();
        if (found.parent_id !== null) throw Errors.validation({ parent_id: "Reply to a top-level note." });
        if (ctx.membership.role === "homeowner" && found.audience === "crew") throw Errors.notFound();
        if (audience !== undefined && found.audience === "crew" && audience === "everyone") {
          throw Errors.validation({ audience: "Replies to crew notes stay crew-only." });
        }
        parent = found;
      }
      if (Object.keys(fields).length > 0) throw Errors.validation(fields);

      if (ctx.membership.role === "homeowner" && audience === "crew") throw Errors.forbidden();

      const id = newId("note");
      await ctx.client.query(
        `INSERT INTO notes (id, job_id, item_id, parent_id, body, audience, author_id, rev, chars)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)`,
        [id, ctx.jobId, item.id, parent === null ? null : parent.id, bodyText, audience, ctx.membership.id, JSON.stringify(charsForBody(bodyText!))],
      );
      await ctx.client.query(
        `INSERT INTO note_revisions (note_id, rev, kind, author_id, edit_json, body) VALUES ($1, 0, 'create', $2, NULL, $3)`,
        [id, ctx.membership.id, bodyText],
      );
      await new EventLog(ctx.client).emit(ctx.jobId, "note", { item_id: item.id, note_id: id });
      return id;
    });
    res.status(201).json(await notePayload(req, db, req.params.jobId, noteId));
  });

  router.post("/jobs/:jobId/items/:itemId/notes/:noteId/edits", async (req: Request, res: Response) => {
    const body = req.body as { base_rev?: unknown; pos?: unknown; delete?: unknown; insert?: unknown };
    const noteId = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const item = await visibleItem(ctx, req.params.itemId);
      const note = await loadNote(ctx, item.id, req.params.noteId);
      if (!mayEditNote(ctx, note)) throw Errors.forbidden();

      const fields: Record<string, string> = {};
      if (typeof body.base_rev !== "number" || !Number.isInteger(body.base_rev) || body.base_rev < 0 || body.base_rev > note.rev) {
        fields.base_rev = "Pick a revision to edit from.";
      }
      if (typeof body.pos !== "number" || !Number.isInteger(body.pos) || body.pos < 0) fields.pos = "Give a position.";
      if (typeof body.delete !== "number" || !Number.isInteger(body.delete) || body.delete < 0) fields.delete = "Give a delete count.";
      if (typeof body.insert !== "string") fields.insert = "Give the text to insert.";
      if (Object.keys(fields).length > 0) throw Errors.validation(fields);

      const baseText = visibleBodyAt(note.chars, note.revisions, body.base_rev as number);
      if ((body.pos as number) + (body.delete as number) > [...baseText].length) {
        throw Errors.validation({ pos: "That position is past the end of the text." });
      }
      if (!((body.delete as number) > 0) && (body.insert as string).length === 0) {
        throw Errors.validation({ delete: "Delete something or insert something." });
      }
      const newRev = note.rev + 1;
      const spec: EditSpec = { pos: body.pos as number, delete: body.delete as number, insert: body.insert as string };
      const chars = applyEdit(note.chars, note.revisions, body.base_rev as number, spec, ctx.membership.id, newRev);
      const revisions = [...note.revisions, { rev: newRev, kind: "edit" as RevisionKind, authorMemberId: ctx.membership.id, target: null }];
      const bodyText = visibleBodyAt(chars, revisions, newRev);
      if ([...bodyText].length < 1 || [...bodyText].length > 2000) {
        throw Errors.validation({ insert: "Notes are 1 to 2,000 characters." });
      }
      await ctx.client.query(`UPDATE notes SET chars = $2, body = $3, rev = $4 WHERE id = $1`, [note.id, JSON.stringify(chars), bodyText, newRev]);
      await ctx.client.query(
        `INSERT INTO note_revisions (note_id, rev, kind, author_id, edit_json, body) VALUES ($1, $2, 'edit', $3, $4, $5)`,
        [note.id, newRev, ctx.membership.id, JSON.stringify({ base: body.base_rev, ...spec }), bodyText],
      );
      await new EventLog(ctx.client).emit(ctx.jobId, "note", { item_id: item.id, note_id: note.id });
      return note.id;
    });
    res.json(await notePayload(req, db, req.params.jobId, noteId));
  });

  router.post("/jobs/:jobId/items/:itemId/notes/:noteId/undo", async (req: Request, res: Response) => {
    const noteId = await withJob(req, db, req.params.jobId, async (ctx) => {
      const item = await visibleItem(ctx, req.params.itemId);
      const note = await loadNote(ctx, item.id, req.params.noteId);
      if (!mayEditNote(ctx, note)) throw Errors.forbidden();
      const target = latestActiveOwnEdit(note.revisions, ctx.membership.id, note.rev);
      if (target === null) throw Errors.nothingToUndo();
      const newRev = note.rev + 1;
      const revisions = [...note.revisions, { rev: newRev, kind: "undo" as RevisionKind, authorMemberId: ctx.membership.id, target }];
      const bodyText = visibleBodyAt(note.chars, revisions, newRev);
      await ctx.client.query(`UPDATE notes SET body = $2, rev = $3 WHERE id = $1`, [note.id, bodyText, newRev]);
      await ctx.client.query(
        `INSERT INTO note_revisions (note_id, rev, kind, author_id, edit_json, body) VALUES ($1, $2, 'undo', $3, $4, $5)`,
        [note.id, newRev, ctx.membership.id, JSON.stringify({ target }), bodyText],
      );
      await new EventLog(ctx.client).emit(ctx.jobId, "note", { item_id: item.id, note_id: note.id });
      return note.id;
    });
    res.json(await notePayload(req, db, req.params.jobId, noteId));
  });

  router.post("/jobs/:jobId/items/:itemId/notes/:noteId/redo", async (req: Request, res: Response) => {
    const noteId = await withJob(req, db, req.params.jobId, async (ctx) => {
      const item = await visibleItem(ctx, req.params.itemId);
      const note = await loadNote(ctx, item.id, req.params.noteId);
      if (!mayEditNote(ctx, note)) throw Errors.forbidden();
      const redoable = latestRedoableEdit(note.revisions, ctx.membership.id, note.rev);
      if (redoable === null) throw Errors.nothingToRedo();
      const newRev = note.rev + 1;
      const revisions = [...note.revisions, { rev: newRev, kind: "redo" as RevisionKind, authorMemberId: ctx.membership.id, target: redoable.target }];
      const bodyText = visibleBodyAt(note.chars, revisions, newRev);
      await ctx.client.query(`UPDATE notes SET body = $2, rev = $3 WHERE id = $1`, [note.id, bodyText, newRev]);
      await ctx.client.query(
        `INSERT INTO note_revisions (note_id, rev, kind, author_id, edit_json, body) VALUES ($1, $2, 'redo', $3, $4, $5)`,
        [note.id, newRev, ctx.membership.id, JSON.stringify({ target: redoable.target }), bodyText],
      );
      await new EventLog(ctx.client).emit(ctx.jobId, "note", { item_id: item.id, note_id: note.id });
      return note.id;
    });
    res.json(await notePayload(req, db, req.params.jobId, noteId));
  });

  router.get("/jobs/:jobId/items/:itemId/notes/:noteId/history", async (req: Request, res: Response) => {
    const revisions = await withJob(req, db, req.params.jobId, async (ctx) => {
      const item = await visibleItem(ctx, req.params.itemId);
      const note = await loadNote(ctx, item.id, req.params.noteId);
      const rows = await ctx.client.query<{ rev: number; kind: "create" | "edit" | "undo" | "redo"; body: string; created_at: Date; name: string; role: Role }>(
        `SELECT r.rev, r.kind, r.body, r.created_at, p.name, m.role
         FROM note_revisions r JOIN job_members m ON m.id = r.author_id JOIN people p ON p.id = m.person_id
         WHERE r.note_id = $1 ORDER BY r.rev`,
        [note.id],
      );
      return rows.rows.map((r) => ({
        rev: r.rev,
        kind: r.kind,
        author: { name: r.name, role: r.role },
        body: r.body,
        created_at: utcIso(r.created_at),
      }));
    });
    res.json({ revisions });
  });

  // --- Conflict resolution ---

  router.post("/jobs/:jobId/items/:itemId/resolve", async (req: Request, res: Response) => {
    const body = req.body as { field?: unknown; value?: unknown };
    const itemId = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const item = await visibleItem(ctx, req.params.itemId);
      const conflicts = await conflictsOf(ctx.client, item.id);
      const conflict = conflicts.find((c) => c.field === body.field);
      if (conflict === undefined) throw Errors.noConflict();
      if (JSON.stringify(conflict.server_value) !== JSON.stringify(body.value) && JSON.stringify(conflict.phone_value) !== JSON.stringify(body.value)) {
        throw Errors.validation({ value: "Pick one of the recorded values." });
      }

      const rooms = await roomsOf(ctx.client, ctx.jobId);
      if (conflict.field === "pin") {
        const value = body.value as { x: number; y: number } | null;
        if (value === null) {
          await ctx.client.query(`UPDATE items SET pin_x = NULL, pin_y = NULL, pin_status = 'unpinned', updated_at = now() WHERE id = $1`, [item.id]);
        } else {
          const pin = validatePin(value);
          const decided = pin === null ? null : roomForPin(pin, rooms, null, item.room_id);
          if (decided === null) throw Errors.validation({ pin: FIELD_MESSAGES.pin });
          await ctx.client.query(
            `UPDATE items SET pin_x = $2, pin_y = $3, pin_status = 'placed', room_id = $4, updated_at = now() WHERE id = $1`,
            [item.id, pin!.x.toFixed(4), pin!.y.toFixed(4), decided],
          );
          await recordChange(ctx.client, ctx.jobId);
          await recordItemChange(ctx.client, ctx.jobId, item, "refiled");
        }
      } else if (conflict.field === "room_id") {
        await ctx.client.query(`UPDATE items SET room_id = $2, updated_at = now() WHERE id = $1`, [item.id, body.value as string]);
        await recordChange(ctx.client, ctx.jobId);
        await recordItemChange(ctx.client, ctx.jobId, item, "refiled");
      } else {
        const column = conflict.field === "title" ? "title" : conflict.field === "cost_note" ? "cost_note"
          : conflict.field === "quantity" ? "quantity" : conflict.field === "unit_cost" ? "unit_cost" : "trade";
        await ctx.client.query(`UPDATE items SET ${column} = $2, updated_at = now() WHERE id = $1`, [item.id, body.value as string | null]);
      }
      await ctx.client.query(`DELETE FROM conflicts WHERE item_id = $1 AND field = $2`, [item.id, conflict.field]);
      if (conflict.field === "trade") {
        const newTrade = body.value as TradeKey | null;
        if (newTrade !== null && newTrade !== item.trade) {
          const roomName = await roomNameOf(ctx.client, item.room_id);
          await assignmentNotices(ctx.client, ctx.jobId, { number: item.number, title: item.title, roomName }, newTrade);
        }
      }
      await new EventLog(ctx.client).emit(ctx.jobId, "item", { item_id: item.id });
      await new EventLog(ctx.client).emit(ctx.jobId, "counts", {});
      return item.id;
    });
    res.json(await fullItem(req, db, req.params.jobId, itemId));
  });

  return router;
}

function sentValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

function tradeOrNull(v: unknown, fields: Record<string, string>): TradeKey | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string" && TRADES.includes(v as TradeKey)) return v as TradeKey;
  fields.trade = "Pick a trade.";
  return undefined;
}

function decimalOrNull(v: unknown, field: string, fields: Record<string, string>, parse: (s: string) => { int: bigint; scale: number } | null): money.Decimal | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string" || parse(v) === null) {
    fields[field] = field === "quantity" ? "Quantity is a decimal like 2.500." : "Unit cost is a decimal like 12.50.";
    return undefined;
  }
  return parse(v);
}

export async function fullItem(req: Request, db: Db, jobId: string, itemId: string): Promise<Record<string, unknown>> {
  return withJob(req, db, jobId, async (ctx) => {
    const item = await visibleItem(ctx, itemId);
    return projectItem(ctx, jobId, item, await itemExtras(ctx, item));
  });
}

async function photoPayload(req: Request, db: Db, jobId: string, photoId: string): Promise<Record<string, unknown>> {
  return withJob(req, db, jobId, async (ctx) => {
    const row = await ctx.client.query(
      `SELECT ph.id, ph.kind, ph.content_type, ph.bytes, p.name AS uploaded_by_name, m.role AS uploaded_by_role, ph.created_at
       FROM item_photos ph JOIN job_members m ON m.id = ph.uploaded_by JOIN people p ON p.id = m.person_id
       WHERE ph.job_id = $1 AND ph.id = $2`,
      [jobId, photoId],
    );
    const photo = row.rows[0];
    if (photo === undefined) throw Errors.notFound();
    const item = await itemById(ctx.client, jobId, photo.item_id);
    if (item === null || item.deleted_at !== null || !canSeeItem(ctx.membership, item)) throw Errors.notFound();
    return {
      id: photo.id,
      kind: photo.kind,
      content_type: photo.content_type,
      bytes: photo.bytes,
      url: `/api/jobs/${jobId}/photos/${photo.id}`,
      uploaded_by: { name: photo.uploaded_by_name, role: photo.uploaded_by_role },
      created_at: utcIso(photo.created_at),
    };
  });
}

async function notePayload(req: Request, db: Db, jobId: string, noteId: string): Promise<Record<string, unknown>> {
  return withJob(req, db, jobId, async (ctx) => {
    const row = await ctx.client.query<{ id: string; item_id: string }>(
      `SELECT id, item_id FROM notes WHERE job_id = $1 AND id = $2`, [jobId, noteId],
    );
    const note = row.rows[0];
    if (note === undefined) throw Errors.notFound();
    const item = await itemById(ctx.client, jobId, note.item_id);
    if (item === null || item.deleted_at !== null || !canSeeItem(ctx.membership, item)) throw Errors.notFound();
    const visible = await notesOf(ctx.client, jobId, note.item_id, ctx.membership, item.trade);
    const found = visible.find((n) => n.id === noteId);
    if (found === undefined) throw Errors.notFound();
    return projectNote(found);
  });
}

async function loadNote(ctx: Parameters<Parameters<typeof withJob>[3]>[0], itemId: string, noteId: string): Promise<LoadedNote> {
  const row = await ctx.client.query<{ id: string; item_id: string; parent_id: string | null; body: string; audience: "crew" | "everyone"; author_id: string; rev: number; chars: CharState[] }>(
    `SELECT id, item_id, parent_id, body, audience, author_id, rev, chars FROM notes WHERE job_id = $1 AND item_id = $2 AND id = $3`,
    [ctx.jobId, itemId, noteId],
  );
  const note = row.rows[0];
  if (note === undefined) throw Errors.notFound();
  // Audience scoping: homeowners and other trades never see crew notes.
  const item = await itemById(ctx.client, ctx.jobId, note.item_id);
  if (item === null || item.deleted_at !== null) throw Errors.notFound();
  if (note.audience === "crew") {
    const role = ctx.membership.role;
    const allowed = role === "owner" || role === "lead" || (role === "trade" && ctx.membership.trade !== null && item.trade === ctx.membership.trade);
    if (!allowed) throw Errors.notFound();
  }
  const revRows = await ctx.client.query<{ rev: number; kind: RevisionKind; author_id: string; edit_json: unknown }>(
    `SELECT rev, kind, author_id, edit_json FROM note_revisions WHERE note_id = $1 ORDER BY rev`,
    [note.id],
  );
  const revisions: RevisionMeta[] = revRows.rows.map((r) => {
    const edit = r.kind === "undo" || r.kind === "redo" ? (r.edit_json as { target?: number } | null) : null;
    return { rev: r.rev, kind: r.kind, authorMemberId: r.author_id, target: edit?.target ?? null };
  });
  return { ...note, revisions };
}

function mayEditNote(ctx: Parameters<Parameters<typeof withJob>[3]>[0], note: LoadedNote): boolean {
  const role = ctx.membership.role;
  if (role === "owner" || role === "lead") return true;
  if (note.author_id === ctx.membership.id) return true;
  return false;
}

/** Blockers not verified, with earlier bulk items in the same request counted. */
async function overlayBlockers(client: Parameters<Parameters<typeof withJob>[3]>[0]["client"], itemId: string, overlay: Map<string, string>): Promise<number[]> {
  const rows = await client.query<{ number: number; blocker_id: string; status: string }>(
    `SELECT b.number, b.id AS blocker_id, b.status FROM item_links l JOIN items b ON b.id = l.blocker_id
     WHERE l.item_id = $1 ORDER BY b.number`,
    [itemId],
  );
  const out: number[] = [];
  for (const row of rows.rows) {
    const status = overlay.get(row.blocker_id) ?? row.status;
    if (status !== "verified") out.push(row.number);
  }
  return out;
}

/** Whether `from` transitively waits on `to`. */
async function reaches(client: Parameters<Parameters<typeof withJob>[3]>[0]["client"], fromId: string, toId: string): Promise<boolean> {
  const seen = new Set<string>([fromId]);
  let frontier = [fromId];
  while (frontier.length > 0) {
    const rows = await client.query<{ blocker_id: string }>(
      `SELECT blocker_id FROM item_links WHERE item_id = ANY($1::text[])`, [frontier],
    );
    frontier = [];
    for (const row of rows.rows) {
      if (row.blocker_id === toId) return true;
      if (!seen.has(row.blocker_id)) {
        seen.add(row.blocker_id);
        frontier.push(row.blocker_id);
      }
    }
  }
  return false;
}

/** The owner's reopen cascade: every dependent of the reopened item, through
 *  any chain, that was ready for check or verified becomes open. */
async function reopenCascade(client: Parameters<Parameters<typeof withJob>[3]>[0]["client"], jobId: string, itemId: string): Promise<number[]> {
  const dependents = new Set<string>();
  let frontier = [itemId];
  while (frontier.length > 0) {
    const rows = await client.query<{ item_id: string }>(
      `SELECT item_id FROM item_links WHERE blocker_id = ANY($1::text[])`, [frontier],
    );
    frontier = [];
    for (const row of rows.rows) {
      if (!dependents.has(row.item_id)) {
        dependents.add(row.item_id);
        frontier.push(row.item_id);
      }
    }
  }
  const reopened: number[] = [];
  if (dependents.size > 0) {
    const rows = await client.query<{ id: string; number: number; title: string }>(
      `SELECT id, number, title FROM items WHERE job_id = $1 AND id = ANY($2::text[])
       AND status IN ('ready_for_check', 'verified') ORDER BY number`,
      [jobId, [...dependents]],
    );
    for (const row of rows.rows) {
      await client.query(`UPDATE items SET status = 'open', sent_back_reason = NULL, updated_at = now() WHERE id = $1`, [row.id]);
      await recordItemChange(client, jobId, row, "changed");
      reopened.push(row.number);
    }
  }
  return reopened;
}
