import { randomUUID } from "node:crypto";
import type { Member } from "../auth";
import { one, pool, rows, type Db } from "../db";
import { conflict, notFound, type Json } from "../http";
import { route, type Ctx } from "../router";
import { asBody, Fields, type Body } from "../validate";
import { FIELD } from "../../shared/copy";
import { apiDistance, isValidSpeed, MAX_LEGS, planPassage, type Anchorage, type LegInput } from "../../shared/energy";
import { isoInstant, localToInstant } from "../../shared/zones";
import { energyProfile, visibleYacht, type YachtRow } from "../domain/yachts";

interface AnchorageRow {
  id: string;
  name: string;
  base: "split" | "lavrio";
  latitude: string;
  longitude: string;
}

async function anchorages(db: Db): Promise<Map<string, Anchorage>> {
  const list = await rows<AnchorageRow>(db, "SELECT * FROM anchorages ORDER BY sort");
  return new Map(list.map((a) => [a.id, { id: a.id, name: a.name, base: a.base, latitude: Number(a.latitude), longitude: Number(a.longitude) }]));
}

route("GET", "/api/w/:ws/anchorages", {
  staff: true,
  handle: async () => ({ status: 200, body: { anchorages: [...(await anchorages(pool)).values()] as unknown as Json } }),
});

interface PassageRow {
  id: string;
  workspace_slug: string;
  yacht_id: string;
  name: string;
  status: "draft" | "sent";
  start_anchorage_id: string;
  departure_date: string;
  departure_time: string;
  departs_at: Date;
  start_charge_pct: number;
  legs: LegInput[];
  updated_at: Date;
}

function passageJson(p: PassageRow, yacht: YachtRow, places: Map<string, Anchorage>): Json {
  const legs = planPassage(energyProfile(yacht), places, p.start_anchorage_id, p.legs, p.start_charge_pct, p.departs_at.getTime());
  return {
    id: p.id,
    yachtSlug: yacht.slug,
    name: p.name,
    status: p.status,
    base: yacht.base,
    startAnchorageId: p.start_anchorage_id,
    departureDate: p.departure_date,
    departureTime: p.departure_time,
    departsAt: isoInstant(p.departs_at.getTime()),
    startChargePct: p.start_charge_pct,
    legs: legs.map((l) => ({
      index: l.index,
      fromAnchorageId: l.fromAnchorageId,
      toAnchorageId: l.toAnchorageId,
      speedKn: l.speedKn,
      distanceNm: apiDistance(l.distanceNm),
      departsAt: isoInstant(l.departsAtMs),
      arrivesAt: isoInstant(l.arrivesAtMs),
      arrivalBase: l.arrivalBase,
      arrivalChargePct: l.arrivalChargePct,
      reserve: l.reserve,
    })),
    minChargePct: legs.length ? Math.min(...legs.map((l) => l.arrivalChargePct)) : null,
    updatedAt: isoInstant(p.updated_at.getTime()),
  };
}

interface PassageFields {
  name: string;
  startAnchorageId: string;
  departureDate: string;
  departureTime: string;
  departsAt: number;
  startChargePct: number;
  legs: LegInput[];
}

/** Validates a passage body in ladder order: unknown anchorages answer 404, then every field error at once. */
function passageFields(body: Body, yacht: YachtRow, places: Map<string, Anchorage>): PassageFields {
  const legsRaw = Array.isArray(body.legs) ? body.legs.map(asBody) : [];
  if (typeof body.startAnchorageId !== "string" || !places.has(body.startAnchorageId)) {
    if (body.startAnchorageId !== undefined && body.startAnchorageId !== "") throw notFound();
  }
  for (const leg of legsRaw) {
    if (typeof leg.toAnchorageId === "string" && leg.toAnchorageId !== "" && !places.has(leg.toAnchorageId)) throw notFound();
  }
  const fields = new Fields();
  const name = fields.text("name", body.name, 80);
  const start = typeof body.startAnchorageId === "string" && places.has(body.startAnchorageId) ? body.startAnchorageId : null;
  if (!start) fields.fail("startAnchorageId", FIELD.required);
  const departureDate = fields.date("departureDate", body.departureDate);
  let departureTime: string | null = null;
  if (typeof body.departureTime !== "string" || body.departureTime === "") fields.fail("departureTime", FIELD.required);
  else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.departureTime)) fields.fail("departureTime", FIELD.time);
  else departureTime = body.departureTime;
  const startChargePct = fields.whole("startChargePct", body.startChargePct, 0, 100);
  if (!Array.isArray(body.legs)) fields.fail("legs", FIELD.required);
  else if (legsRaw.length > MAX_LEGS) fields.fail("legs", FIELD.legs);
  let here = start;
  const legs: LegInput[] = legsRaw.map((leg, i) => {
    const to = typeof leg.toAnchorageId === "string" && leg.toAnchorageId !== "" ? leg.toAnchorageId : null;
    if (!to) fields.fail(`legs.${i}.toAnchorageId`, FIELD.required);
    else if (to === here) fields.fail(`legs.${i}.toAnchorageId`, FIELD.sameAnchorage);
    if (!isValidSpeed(leg.speedKn)) fields.fail(`legs.${i}.speedKn`, FIELD.speed);
    here = to;
    return { toAnchorageId: to ?? "", speedKn: Number(leg.speedKn) };
  });
  let departsAt: number | null = null;
  if (departureDate && departureTime) {
    departsAt = localToInstant(departureDate, departureTime, yacht.base);
    if (departsAt === null) fields.fail("departureTime", FIELD.gap);
  }
  fields.check();
  return { name: name!, startAnchorageId: start!, departureDate: departureDate!, departureTime: departureTime!, departsAt: departsAt!, startChargePct: startChargePct!, legs };
}

async function passageById(db: Db, member: Member, id: string): Promise<{ passage: PassageRow; yacht: YachtRow }> {
  const passage = /^[0-9a-f-]{36}$/i.test(id)
    ? await one<PassageRow>(db, "SELECT * FROM passages WHERE id = $1 AND workspace_slug = $2", [id, member.workspaceSlug])
    : undefined;
  if (!passage) throw notFound();
  const yacht = (await one<YachtRow>(db, "SELECT * FROM yachts WHERE id = $1", [passage.yacht_id]))!;
  if (member.role === "crew_member" && (yacht.id !== member.yachtId || passage.status !== "sent")) throw notFound();
  return { passage, yacht };
}

const PASSAGE_READERS = ["captain", "crew_member"] as const;

route("GET", "/api/w/:ws/passages", {
  staff: true,
  handle: async (ctx) => {
    const slug = ctx.query("yachtSlug");
    const yacht = slug ? await visibleYacht(pool, ctx.member, slug) : null;
    ctx.allow(PASSAGE_READERS);
    const crew = ctx.member.role === "crew_member";
    const list = await rows<PassageRow>(
      pool,
      `SELECT * FROM passages WHERE workspace_slug = $1 AND ($2::uuid IS NULL OR yacht_id = $2) AND ($3::uuid IS NULL OR yacht_id = $3)
         AND (NOT $4 OR status = 'sent') ORDER BY departs_at, created_at`,
      [ctx.params.ws, yacht?.id ?? null, crew ? ctx.member.yachtId : null, crew],
    );
    const yachts = new Map((await rows<YachtRow>(pool, "SELECT * FROM yachts WHERE workspace_slug = $1", [ctx.params.ws])).map((y) => [y.id, y]));
    const places = await anchorages(pool);
    return { status: 200, body: { passages: list.map((p) => passageJson(p, yachts.get(p.yacht_id)!, places)) } };
  },
});

route("POST", "/api/w/:ws/passages", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow(["captain"]);
    const body = asBody(await ctx.json());
    if (typeof body.yachtSlug !== "string") throw notFound();
    const yacht = await visibleYacht(pool, ctx.member, body.yachtSlug);
    const places = await anchorages(pool);
    const f = passageFields(body, yacht, places);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO passages (id, workspace_slug, yacht_id, name, status, start_anchorage_id, departure_date, departure_time, departs_at,
         start_charge_pct, legs, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10, now(), now())`,
      [id, ctx.params.ws, yacht.id, f.name, f.startAnchorageId, f.departureDate, f.departureTime, new Date(f.departsAt), f.startChargePct, JSON.stringify(f.legs)],
    );
    const { passage } = await passageById(pool, ctx.member, id);
    return { status: 201, body: { passage: passageJson(passage, yacht, places) } };
  },
});

async function readable(ctx: Ctx) {
  const found = await passageById(pool, ctx.member, ctx.params.id);
  ctx.allow(PASSAGE_READERS);
  return found;
}

route("GET", "/api/w/:ws/passages/:id", {
  staff: true,
  handle: async (ctx) => {
    const { passage, yacht } = await readable(ctx);
    return { status: 200, body: { passage: passageJson(passage, yacht, await anchorages(pool)) } };
  },
});

route("PUT", "/api/w/:ws/passages/:id", {
  staff: true,
  handle: async (ctx) => {
    const { passage, yacht } = await passageById(pool, ctx.member, ctx.params.id);
    ctx.allow(["captain"]);
    const body = asBody(await ctx.json());
    const places = await anchorages(pool);
    const f = passageFields(body, yacht, places);
    await pool.query(
      `UPDATE passages SET name = $2, status = 'draft', start_anchorage_id = $3, departure_date = $4, departure_time = $5, departs_at = $6,
         start_charge_pct = $7, legs = $8, updated_at = now() WHERE id = $1`,
      [passage.id, f.name, f.startAnchorageId, f.departureDate, f.departureTime, new Date(f.departsAt), f.startChargePct, JSON.stringify(f.legs)],
    );
    const saved = await passageById(pool, ctx.member, passage.id);
    return { status: 200, body: { passage: passageJson(saved.passage, yacht, places) } };
  },
});

route("POST", "/api/w/:ws/passages/:id/send", {
  staff: true,
  handle: async (ctx) => {
    const { passage, yacht } = await passageById(pool, ctx.member, ctx.params.id);
    ctx.allow(["captain"]);
    const places = await anchorages(pool);
    const legs = planPassage(energyProfile(yacht), places, passage.start_anchorage_id, passage.legs, passage.start_charge_pct, passage.departs_at.getTime());
    if (!legs.length) throw conflict("no_legs");
    const below = legs.find((l) => l.reserve === "below_reserve");
    if (below) throw conflict("below_reserve", { legIndex: below.index });
    await pool.query("UPDATE passages SET status = 'sent', updated_at = now() WHERE id = $1", [passage.id]);
    const sent = await passageById(pool, ctx.member, passage.id);
    return { status: 200, body: { passage: passageJson(sent.passage, yacht, places) } };
  },
});
