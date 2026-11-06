import { newId } from "../config";
import { now, nowMs } from "../clock";
import { pool, q, one, tx } from "../db";
import { lockName } from "../lockname";
import { ApiError, validation, fieldMsg } from "../errors";
import type { Ctx, Person, Studio } from "../http/context";
import { sendJson } from "../http/context";
import { studioBody } from "./bodies";
import { storageFeeCentsFor } from "../billing/storage";
import { today, dayStart } from "../studiodays";
import { checkPickupWindow, checkStorageFee, checkRateField, checkEffectiveFrom, checkDimension } from "./validate";
import { publish } from "../events";
import { addDays } from "../studiodays";
import { roundDims, cubicEighths, feeCents } from "../quote";

export async function getStudio(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const studioRow = await one<{ id: string; name: string; slug: string; time_zone: string; pickup_window_days: number }>(pool, "SELECT * FROM studios WHERE id = $1", [studio.id]);
  const todayStr = today(studio.time_zone, nowMs());
  const fee = await storageFeeCentsFor(studio.id, todayStr);
  sendJson(ctx.res, 200, studioBody(studioRow!, todayStr, fee));
}

export async function putSettings(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  let pickupWindow: number | undefined;
  let storageFee: number | undefined;
  if (ctx.body.pickup_window_days !== undefined) pickupWindow = checkPickupWindow(ctx.body.pickup_window_days);
  if (ctx.body.storage_fee_cents !== undefined) storageFee = checkStorageFee(ctx.body.storage_fee_cents);
  await tx(async (client) => {
    if (pickupWindow !== undefined) {
      await client.query("UPDATE studios SET pickup_window_days = $1 WHERE id = $2", [pickupWindow, studio.id]);
    }
    if (storageFee !== undefined) {
      // A changed fee applies only to studio days that begin after the change.
      const todayStr = today(studio.time_zone, nowMs());
      const effectiveFrom = addDays(todayStr, 1);
      await client.query("DELETE FROM storage_fee_history WHERE studio_id = $1 AND effective_from = $2", [studio.id, effectiveFrom]);
      await client.query("INSERT INTO storage_fee_history (studio_id, effective_from, cents) VALUES ($1,$2,$3)", [studio.id, effectiveFrom, storageFee]);
    }
  });
  await publish(pool, "studio", studio.id, studio.id);
  const studioRow = await one<{ id: string; name: string; slug: string; time_zone: string; pickup_window_days: number }>(pool, "SELECT * FROM studios WHERE id = $1", [studio.id]);
  const todayStr = today(studio.time_zone, nowMs());
  const fee = await storageFeeCentsFor(studio.id, todayStr);
  sendJson(ctx.res, 200, studioBody(studioRow!, todayStr, fee));
}

export async function getClayBodies(ctx: Ctx): Promise<void> {
  const rows = await q<{ id: string; name: string }>(pool, "SELECT id, name FROM clay_bodies WHERE studio_id = $1 ORDER BY name", [(ctx.studio as Studio).id]);
  sendJson(ctx.res, 200, rows);
}

export async function getKilns(ctx: Ctx): Promise<void> {
  const rows = await q<{ id: string; name: string; stack_height_in: number; shelf_area_sq_in: number }>(pool, "SELECT id, name, stack_height_in, shelf_area_sq_in FROM kilns WHERE studio_id = $1 ORDER BY name", [(ctx.studio as Studio).id]);
  sendJson(ctx.res, 200, rows);
}

export async function getCreditPacks(ctx: Ctx): Promise<void> {
  const rows = await q<{ id: string; name: string; amount_cents: number }>(pool, "SELECT id, name, amount_cents FROM credit_packs WHERE studio_id = $1 ORDER BY amount_cents", [(ctx.studio as Studio).id]);
  sendJson(ctx.res, 200, rows);
}

export type RateScheduleRow = {
  id: string;
  effective_from: string;
  member_bisque_cents: number;
  member_glaze_cents: number;
  dropoff_bisque_cents: number;
  dropoff_glaze_cents: number;
};

// The schedule in force at a moment (quotes use it), decided in one place.
export async function scheduleInForce(studioId: string, tz: string): Promise<RateScheduleRow | undefined> {
  const todayStr = today(tz, nowMs());
  return one<RateScheduleRow>(
    pool,
    `SELECT * FROM rate_schedules WHERE studio_id = $1 AND effective_from <= $2
      ORDER BY effective_from DESC LIMIT 1`,
    [studioId, todayStr],
  );
}

export async function getRateSchedules(ctx: Ctx): Promise<void> {
  const rows = await q<RateScheduleRow>(pool, "SELECT * FROM rate_schedules WHERE studio_id = $1 ORDER BY effective_from DESC", [(ctx.studio as Studio).id]);
  sendJson(ctx.res, 200, rows);
}

export async function postRateSchedule(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const body = ctx.body;
  const fields: Record<string, number> = {
    member_bisque_cents: checkRateField("member_bisque_cents", body.member_bisque_cents),
    member_glaze_cents: checkRateField("member_glaze_cents", body.member_glaze_cents),
    dropoff_bisque_cents: checkRateField("dropoff_bisque_cents", body.dropoff_bisque_cents),
    dropoff_glaze_cents: checkRateField("dropoff_glaze_cents", body.dropoff_glaze_cents),
  };
  const effectiveFrom = checkEffectiveFrom(body.effective_from);
  const todayStr = today(studio.time_zone, nowMs());
  if (effectiveFrom < todayStr) throw validation({ effective_from: fieldMsg.effectiveFrom });
  const schedule = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.schedule(studio.id, effectiveFrom)]);
    const exists = await one<{ id: string }>(client, "SELECT id FROM rate_schedules WHERE studio_id = $1 AND effective_from = $2", [studio.id, effectiveFrom]);
    if (exists) {
      throw validation({ effective_from: fieldMsg.effectiveTaken });
    }
    const id = newId();
    const rows = await q<RateScheduleRow>(
      client,
      `INSERT INTO rate_schedules (id, studio_id, effective_from, member_bisque_cents, member_glaze_cents, dropoff_bisque_cents, dropoff_glaze_cents, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, studio.id, effectiveFrom, fields.member_bisque_cents, fields.member_glaze_cents, fields.dropoff_bisque_cents, fields.dropoff_glaze_cents, now()],
    );
    return rows[0];
  });
  await publish(pool, "rates", schedule.id, studio.id);
  sendJson(ctx.res, 201, schedule);
}

export async function postQuote(ctx: Ctx): Promise<void> {
  const person = ctx.person as Person;
  const studio = ctx.studio as Studio;
  const [lengthIn, widthIn, heightIn] = checkDimension(["length_in", "width_in", "height_in"], ctx.body);
  const schedule = (await scheduleInForce(studio.id, studio.time_zone)) ?? (await one<RateScheduleRow>(pool, "SELECT * FROM rate_schedules WHERE studio_id = $1 ORDER BY effective_from ASC LIMIT 1", [studio.id]));
  if (!schedule) throw new ApiError(409, "no_rates", "No rate schedule is in force.");
  const membership = (person.membership as "member" | "drop_off") ?? "member";
  const bisqueRate = membership === "member" ? schedule.member_bisque_cents : schedule.dropoff_bisque_cents;
  const glazeRate = membership === "member" ? schedule.member_glaze_cents : schedule.dropoff_glaze_cents;
  const rounded = roundDims(lengthIn, widthIn, heightIn);
  const cubicE = cubicEighths(rounded);
  sendJson(ctx.res, 200, {
    length_in: rounded.lengthHalf / 2,
    width_in: rounded.widthHalf / 2,
    height_in: rounded.heightHalf / 2,
    cubic_inches: cubicE / 8,
    membership,
    rates_effective_from: schedule.effective_from,
    bisque: { rate_cents: bisqueRate, fee_cents: feeCents(cubicE, bisqueRate) },
    glaze: { rate_cents: glazeRate, fee_cents: feeCents(cubicE, glazeRate) },
  });
}

export { dayStart };
