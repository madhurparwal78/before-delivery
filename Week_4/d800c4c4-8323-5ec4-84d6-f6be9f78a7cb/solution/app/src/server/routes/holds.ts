import type pg from "pg";
import { one, pool, rows, transaction } from "../db.js";
import { loadCalendar, today, type Calendar } from "../domain/calendar.js";
import { promoteNextHold } from "../domain/holds.js";
import { membershipOf, membershipStatus } from "../domain/membership.js";
import { conflict, MEMBER, notFound, route, type Reply } from "../http/pipeline.js";
import { idFrom, pathId } from "../http/values.js";
import { loadHolds, loadItems } from "../views.js";
import { kickMail } from "../workers.js";

/** Promotes the next hold when a tool with no ready hold stands on the wall complete. */
export async function promoteIfFree(client: pg.PoolClient, itemId: number, calendar: Calendar, now: number): Promise<void> {
  const [item] = await loadItems(client, [itemId]);
  if (item!.status === "on-wall") await promoteNextHold(client, itemId, calendar, now);
}

export const holdRoutes = [
  route({
    method: "GET",
    path: "/api/holds",
    access: "signed-in",
    body: "none",
    handle: async (ctx): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      const member = ctx.caller!.role === "member";
      const itemId = member ? undefined : (idFrom(ctx.query.get("item_id")) ?? undefined);
      const holds = await loadHolds(pool, member ? { memberId: ctx.caller!.id } : { itemId }, calendar);
      return { status: 200, body: { holds } };
    },
  }),
  route({
    method: "POST",
    path: "/api/holds",
    access: "signed-in",
    roles: MEMBER,
    body: "json",
    find: async (ctx) => {
      const itemId = idFrom(ctx.json?.item_id);
      if (itemId !== null && !(await one(pool, `SELECT 1 FROM items WHERE id = $1`, [itemId]))) throw notFound();
      return itemId;
    },
    validate: (_ctx, itemId) => (itemId === null ? { item_id: "Choose a tool." } : null),
    handle: async (ctx, itemId): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      const holdId = await transaction(async (client) => {
        await client.query(`SELECT id FROM items WHERE id = $1 FOR UPDATE`, [itemId]);
        const membership = await membershipOf(client, ctx.caller!.id);
        if (membershipStatus(membership!, today(calendar, ctx.now)) !== "active") throw conflict("Your membership is not active.");
        const [item] = await loadItems(client, [itemId!]);
        if (item!.status === "on-wall") throw conflict("This tool is on the wall. Ask at the desk to borrow it.");
        const mine = await one(client, `SELECT 1 FROM holds WHERE item_id = $1 AND member_id = $2 AND status IN ('queued','ready')`, [
          itemId,
          ctx.caller!.id,
        ]);
        if (mine) throw conflict("You already have a hold on this tool.");
        const [created] = await rows<{ id: number }>(
          client,
          `INSERT INTO holds (item_id, member_id, status) VALUES ($1, $2, 'queued') RETURNING id`,
          [itemId, ctx.caller!.id],
        );
        return created!.id;
      });
      const [hold] = await loadHolds(pool, { ids: [holdId] }, calendar);
      return { status: 201, body: { hold } };
    },
  }),
  route({
    method: "DELETE",
    path: "/api/holds/:id",
    access: "signed-in",
    roles: MEMBER,
    body: "none",
    find: async (ctx) => {
      const id = pathId(ctx.params.id);
      const hold = id === null ? undefined : await one<{ id: number; item_id: number; member_id: number }>(pool, `SELECT id, item_id, member_id FROM holds WHERE id = $1`, [id]);
      if (!hold || (ctx.caller!.role === "member" && hold.member_id !== ctx.caller!.id)) throw notFound();
      return hold;
    },
    handle: async (ctx, hold): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      await transaction(async (client) => {
        await client.query(`SELECT id FROM items WHERE id = $1 FOR UPDATE`, [hold.item_id]);
        const [current] = await rows<{ status: string }>(client, `SELECT status FROM holds WHERE id = $1`, [hold.id]);
        if (current!.status !== "queued" && current!.status !== "ready") throw conflict("This hold is no longer active.");
        await client.query(`UPDATE holds SET status = 'cancelled' WHERE id = $1`, [hold.id]);
        if (current!.status === "ready") await promoteIfFree(client, hold.item_id, calendar, ctx.now);
      });
      kickMail();
      const [view] = await loadHolds(pool, { ids: [hold.id] }, calendar);
      return { status: 200, body: { hold: view } };
    },
  }),
];
