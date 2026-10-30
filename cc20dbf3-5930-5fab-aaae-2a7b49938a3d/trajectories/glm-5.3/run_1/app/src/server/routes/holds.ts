import { PoolClient } from "pg";
import { Router, Ctx, sendJson, readString, requireUser, requireStaff } from "../http";
import { ApiError, validation, notFound, conflict, invalidTransition, FIELD_COPY } from "../errors";
import { Pool } from "pg";
import { AppServices } from "../routes";
import { withTransaction, lockKeys } from "../db";
import { readCalendar } from "../domain/library";
import { activeSpansForItem, countFreeForRange, lowestFreeUnit, isFreeForRange } from "../domain/spans";
import { isBorrowingPaused, activeCount, maxActivePerMember } from "../domain/borrowing";
import { holdView, HoldRow, buildSpanViews, isStaff } from "../domain/views";
import { insertHold, markHoldReady, cancelHoldRow, selectHoldById, selectHoldPage } from "../domain/holds";
import { queueEmail } from "../email";
import { formatLocalTime, localDate, parseDate, addDays, dateDiff } from "../time";
import { isOpenDay } from "../calendar";
import { randomUuid } from "../config";
import { beginIdempotent, storeIdempotentResponse } from "../idempotency";
import { encodeCursor, decodeCursor, readCursorSecret } from "../paging";

export function holdRoutes(router: Router, services: AppServices): void {
  const { pool } = services;

  router.add("POST", "/api/holds", async (ctx) => {
    const user = requireUser(ctx);
    if (user.role !== "member") throw new ApiError(403, "forbidden");
    const key = requireIdempotencyKey(ctx);
    const body = (await ctx.json()) as Record<string, unknown>;
    const itemId = readString(body.item_id);
    const startDate = readString(body.start_date);
    const endDate = readString(body.end_date);

    const fields: Record<string, string> = {};
    if (typeof body.item_id !== "string" || body.item_id.length === 0) fields.item_id = FIELD_COPY.item_id;
    const calendar = await readCalendar(pool);
    const today = localDate(new Date(), calendar.timeZone);
    const start = startDate !== null ? parseDate(startDate) : null;
    const end = endDate !== null ? parseDate(endDate) : null;
    if (start === null || !isOpenDay(calendar, start.iso) || dateDiff(today, start.iso) < 0 || dateDiff(today, start.iso) > 27) {
      fields.start_date = FIELD_COPY.start_date;
    }
    if (end === null || !isOpenDay(calendar, end.iso) || start === null || end.iso < start.iso || dateDiff(start.iso, end.iso) > 7) {
      fields.end_date = FIELD_COPY.end_date;
    }
    if (Object.keys(fields).length > 0) throw validation(fields);

    await withTransaction(pool, async (client) => {
      // Replay a stored response for the same key and request.
      const itemRow = await client.query("SELECT id FROM items WHERE id = $1", [itemId]);
      if (itemRow.rowCount === 0) {
        throw validation({ item_id: FIELD_COPY.item_id });
      }
      const item = itemRow.rows[0].id as string;
      await lockKeys(client, [`item:${item}`, `member:${user.id}`]);

      const outcome = await beginIdempotent(client, user, key, "POST", "/api/holds", ctx.rawBody);
      if (outcome.replay !== null) {
        ctx.res.writeHead(outcome.replay.status, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(outcome.replay.body),
        });
        ctx.res.end(outcome.replay.body);
        return;
      }

      const units = (await client.query("SELECT id, item_id, label, lane_index FROM units WHERE item_id = $1", [item])).rows as {
        id: string; item_id: string; label: string; lane_index: number;
      }[];
      const spans = await activeSpansForItem(client, item);

      // Conflicts are checked in the order: borrowing_paused, borrowing_limit, no_unit_free.
      if (await isBorrowingPaused(client, user.id)) throw conflict("borrowing_paused");
      const limit = await maxActivePerMember(client);
      if ((await activeCount(client, user.id)) + 1 > limit) throw conflict("borrowing_limit");
      const from = (start as { iso: string }).iso;
      const to = (end as { iso: string }).iso;
      const chosen = lowestFreeUnit(units, spans, from, to);
      if (chosen === null) throw conflict("no_unit_free");

      const holdId = randomUuid();
      await insertHold(client, {
        id: holdId,
        itemId: item,
        unitId: chosen.id,
        memberId: user.id,
        startDate: from,
        endDate: to,
      });
      const hold = (await selectHoldById(client, holdId)) as HoldRow;
      const unitsFree = countFreeForRange(units, spans, from, to) - 1;
      const responseBody = JSON.stringify({
        hold: holdView(hold as HoldRow),
        units_free: unitsFree,
        unit_count: units.length,
      });
      await storeIdempotentResponse(client, user, key, 201, responseBody);
      sendRawJson(ctx, 201, responseBody);
    });
  });

  router.add("GET", "/api/holds", async (ctx) => {
    const user = requireUser(ctx);
    const { rows, nextCursor } = await holdPage(pool, ctx, user);
    sendJson(ctx, 200, {
      holds: rows.map((row) => holdView(row)),
      next_cursor: nextCursor === null ? null : encodeCursor(await readCursorSecret(pool), nextCursor),
    });
  });

  router.add("GET", "/api/holds/:holdId", async (ctx) => {
    const user = requireUser(ctx);
    const hold = await holdVisibleTo(pool, ctx.params.holdId, user);
    sendJson(ctx, 200, { hold: holdView(hold) });
  });

  router.add("POST", "/api/holds/:holdId/ready", async (ctx) => {
    requireStaff(ctx);
    await ctx.json();
    const calendar = await readCalendar(pool);
    const ready = await withTransaction(pool, async (client) => {
      const initial = await selectHoldById(client, ctx.params.holdId);
      if (initial === null) throw notFound();
      await lockKeys(client, [`hold:${ctx.params.holdId}`]);
      const pickupDeadline = new Date(Date.now() + services.config.pickupWindowSeconds * 1000);
      const moved = await markHoldReady(client, ctx.params.holdId, pickupDeadline);
      if (!moved) {
        // Re-read for the true state after a racing transition.
        const current = (await selectHoldById(client, ctx.params.holdId)) as HoldRow;
        throw invalidTransition("hold", statusWordOfHold(current));
      }
      const readyRow = (await selectHoldById(client, ctx.params.holdId)) as HoldRow;
      const member = await client.query("SELECT email FROM users WHERE id = $1", [readyRow.member_id]);
      const deadlineText = formatLocalTime(readyRow.pickup_deadline as Date, calendar.timeZone);
      queueEmail(client, member.rows[0].email, {
        kind: "hold_ready",
        itemName: readyRow.item_name,
        unitLabel: readyRow.unit_label,
        pickupDeadline: deadlineText,
      });
      return readyRow;
    });
    sendJson(ctx, 200, { hold: holdView(ready as HoldRow) });
  });

  router.add("POST", "/api/holds/:holdId/cancel", async (ctx) => {
    const user = requireUser(ctx);
    await ctx.json();
    const hold = await withTransaction(pool, async (client) => {
      const existing = await selectHoldById(client, ctx.params.holdId);
      if (existing === null || (user.role === "member" && existing.member_id !== user.id)) throw notFound();
      await lockKeys(client, [`hold:${ctx.params.holdId}`]);
      const moved = await cancelHoldRow(client, ctx.params.holdId);
      if (!moved) {
        const current = (await selectHoldById(client, ctx.params.holdId)) as HoldRow;
        throw invalidTransition("hold", statusWordOfHold(current));
      }
      return (await selectHoldById(client, ctx.params.holdId)) as HoldRow;
    });
    sendJson(ctx, 200, { hold: holdView(hold as HoldRow) });
  });

  router.add("GET", "/api/items/:itemId/lanes", async (ctx) => {
    const user = requireUser(ctx);
    const calendar = await readCalendar(pool);
    const fromParam = ctx.query.get("from") ?? localDate(new Date(), calendar.timeZone);
    const startParam = ctx.query.get("start");
    const endParam = ctx.query.get("end");
    const fields: Record<string, string> = {};
    const from = parseDate(fromParam);
    if (from === null) fields.from = FIELD_COPY.from;
    if ((startParam === null) !== (endParam === null)) {
      if (startParam === null) fields.start_date = FIELD_COPY.start_date;
      else fields.end_date = FIELD_COPY.end_date;
    }
    if (Object.keys(fields).length > 0) throw validation(fields);
    const client = await pool.connect();
    try {
      const item = await client.query("SELECT id, name FROM items WHERE id = $1", [ctx.params.itemId]);
      if (item.rowCount === 0) throw notFound();
      const units = (
        await client.query("SELECT id, label, lane_index FROM units WHERE item_id = $1 ORDER BY lane_index ASC", [
          ctx.params.itemId,
        ])
      ).rows as { id: string; label: string; lane_index: number }[];
      const spans = await activeSpansForItem(client, ctx.params.itemId);
      const windowFrom = (from as { iso: string }).iso;
      const windowTo = addDays(windowFrom, 27);
      const rangeStart = startParam !== null ? parseDate(startParam) : null;
      const rangeEnd = endParam !== null ? parseDate(endParam) : null;
      const hasRange = rangeStart !== null && rangeEnd !== null;
      const lanes = [];
      for (const unit of units) {
        const unitSpans = spans.filter((span) => span.unit_id === unit.id && span.start_date <= windowTo && span.end_date >= windowFrom);
        lanes.push({
          lane_index: unit.lane_index,
          unit_id: unit.id,
          label: unit.label,
          busy_for_range: hasRange ? !isFreeForRange(unitSpans, (rangeStart as { iso: string }).iso, (rangeEnd as { iso: string }).iso) : null,
          spans: buildSpanViews(unitSpans, user, calendar),
        });
      }
      const unitsFree = hasRange
        ? countFreeForRange(units, spans, (rangeStart as { iso: string }).iso, (rangeEnd as { iso: string }).iso)
        : null;
      sendJson(ctx, 200, {
        item_id: ctx.params.itemId,
        from: windowFrom,
        to: windowTo,
        unit_count: units.length,
        units_free: unitsFree,
        lanes,
      });
    } finally {
      client.release();
    }
  });
}

function sendRawJson(ctx: Ctx, status: number, body: string): void {
  ctx.res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  ctx.res.end(body);
}

function requireIdempotencyKey(ctx: Ctx): string {
  const key = ctx.req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 1 || key.length > 100) {
    throw validation({ idempotency_key: FIELD_COPY.idempotency_key });
  }
  return key;
}

function statusWordOfHold(hold: HoldRow): string {
  return hold.status;
}

async function holdVisibleTo(pool: Pool, holdId: string, user: { id: string; role: string }): Promise<HoldRow> {
  const client = await pool.connect();
  try {
    const hold = await selectHoldById(client, holdId);
    if (hold === null) throw notFound();
    if (user.role === "member" && hold.member_id !== user.id) throw notFound();
    return hold;
  } finally {
    client.release();
  }
}

async function holdPage(pool: Pool, ctx: Ctx, user: { id: string; role: string }): Promise<{ rows: HoldRow[]; nextCursor: { k: string; i: string } | null }> {
  const limitParam = ctx.query.get("limit");
  let limit = 20;
  if (limitParam !== null) {
    const parsed = Number.parseInt(limitParam, 10);
    if (String(parsed) !== limitParam || parsed < 1 || parsed > 50) {
      throw validation({ limit: FIELD_COPY.limit });
    }
    limit = parsed;
  }
  const cursorParam = ctx.query.get("cursor");
  let before: { k: string; i: string } | null = null;
  if (cursorParam !== null) {
    const secret = await readCursorSecret(pool);
    const decoded = decodeCursor(secret, cursorParam);
    if (decoded === null) throw validation({ cursor: FIELD_COPY.cursor });
    before = decoded;
  }
  const statusParam = ctx.query.get("status");
  const client = await pool.connect();
  try {
    return await selectHoldPage(client, {
      memberId: user.id,
      status: statusParam ?? undefined,
      limit,
      before,
      viewerIsMember: user.role === "member",
    });
  } finally {
    client.release();
  }
}

export { requireIdempotencyKey, statusWordOfHold, sendRawJson };
