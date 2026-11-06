import type pg from "pg";
import { one, pool, rows, transaction, type Db } from "../db";
import { ApiError, notFound, type Json } from "../http";
import { route, type Ctx } from "../router";
import { asBody, Fields } from "../validate";
import { FIELD } from "../../shared/copy";
import { isoInstant, isRealDate, weekday } from "../../shared/zones";
import { firstBreach, weekSlots } from "../domain/rota";
import { crewOf, visibleYacht, type YachtRow } from "../domain/yachts";

interface RotaRow {
  version: number;
  saved_by: string | null;
  saved_at: Date | null;
}

function rotaWeek(ctx: Ctx): string {
  const value = ctx.query("weekStart");
  const fields = new Fields();
  if (!value) fields.fail("weekStart", FIELD.required);
  else if (!isRealDate(value)) fields.fail("weekStart", FIELD.date);
  else if (weekday(value) !== 6) fields.fail("weekStart", FIELD.saturday);
  fields.check();
  return value!;
}

async function rotaJson(db: Db, yacht: YachtRow, weekStart: string): Promise<Json> {
  const rota = await one<RotaRow>(db, "SELECT version, saved_by, saved_at FROM rotas WHERE yacht_id = $1 AND week_start = $2", [yacht.id, weekStart]);
  const crew = await crewOf(db, yacht.id);
  const cells = await rows<{ crew_id: string; slot_start: Date }>(
    db, "SELECT crew_id, slot_start FROM rota_work WHERE yacht_id = $1 AND week_start = $2 ORDER BY slot_start", [yacht.id, weekStart]);
  const work: Record<string, string[]> = Object.fromEntries(crew.map((c) => [c.id, []]));
  for (const cell of cells) work[cell.crew_id]?.push(isoInstant(cell.slot_start.getTime()));
  return {
    yachtSlug: yacht.slug,
    weekStart,
    base: yacht.base,
    version: rota?.version ?? 0,
    savedBy: rota?.saved_by ?? null,
    savedAt: rota?.saved_at ? isoInstant(rota.saved_at.getTime()) : null,
    crew,
    slots: weekSlots(weekStart, yacht.base).map(({ startsAt, date, label }) => ({ startsAt, date, label })),
    work,
  };
}

route("GET", "/api/w/:ws/yachts/:slug/rota", {
  staff: true,
  handle: async (ctx) => {
    const yacht = await visibleYacht(pool, ctx.member, ctx.params.slug);
    ctx.allow(["captain", "crew_member"]);
    return { status: 200, body: await rotaJson(pool, yacht, rotaWeek(ctx)) };
  },
});

route("PUT", "/api/w/:ws/yachts/:slug/rota", {
  staff: true,
  handle: async (ctx) => {
    await visibleYacht(pool, ctx.member, ctx.params.slug);
    ctx.allow(["captain"]);
    const weekStart = rotaWeek(ctx);
    const body = asBody(await ctx.json());
    const saved = await transaction(async (db: pg.PoolClient) => {
      const yacht = await visibleYacht(db, ctx.member, ctx.params.slug, true);
      const crew = await crewOf(db, yacht.id);
      const work = asBody(body.work);
      for (const id of Object.keys(work)) if (!crew.some((c) => c.id === id)) throw notFound();
      await db.query("INSERT INTO rotas (yacht_id, week_start, version) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING", [yacht.id, weekStart]);
      const stored = (await one<RotaRow>(db, "SELECT version, saved_by, saved_at FROM rotas WHERE yacht_id = $1 AND week_start = $2 FOR UPDATE", [yacht.id, weekStart]))!;
      const fields = new Fields();
      const version = fields.whole("version", body.version, 0, 2_000_000_000);
      if (version !== null && version !== stored.version) {
        throw new ApiError(412, { error: "stale_rota", savedBy: stored.saved_by, savedAt: stored.saved_at ? isoInstant(stored.saved_at.getTime()) : null });
      }
      const slots = weekSlots(weekStart, yacht.base);
      const byStart = new Map(slots.map((s) => [s.startsAt, s.ms]));
      const chosen = new Map<string, Set<number>>();
      for (const member of crew) {
        const list = work[member.id];
        const set = new Set<number>();
        if (list !== undefined && !Array.isArray(list)) fields.fail("work", FIELD.rotaSlot);
        for (const start of Array.isArray(list) ? list : []) {
          const ms = typeof start === "string" ? byStart.get(start) : undefined;
          if (ms === undefined) fields.fail("work", FIELD.rotaSlot);
          else set.add(ms);
        }
        chosen.set(member.id, set);
      }
      fields.check();
      for (const member of crew) {
        const breach = firstBreach(slots, chosen.get(member.id)!);
        if (breach) {
          throw new ApiError(422, {
            error: "rest_rule",
            crewId: member.id,
            crewName: member.name,
            rule: breach.rule,
            windowStart: isoInstant(breach.windowStartMs),
            windowEnd: isoInstant(breach.windowEndMs),
          });
        }
      }
      await db.query("DELETE FROM rota_work WHERE yacht_id = $1 AND week_start = $2", [yacht.id, weekStart]);
      for (const [crewId, set] of chosen) {
        if (set.size) {
          await db.query(
            "INSERT INTO rota_work (yacht_id, week_start, crew_id, slot_start) SELECT $1, $2, $3, unnest($4::timestamptz[])",
            [yacht.id, weekStart, crewId, [...set].map((ms) => new Date(ms))],
          );
        }
      }
      await db.query("UPDATE rotas SET version = version + 1, saved_by = $3, saved_at = now() WHERE yacht_id = $1 AND week_start = $2",
        [yacht.id, weekStart, ctx.member.name]);
      return rotaJson(db, yacht, weekStart);
    });
    return { status: 200, body: saved };
  },
});
