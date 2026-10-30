// Play endpoints: health and status, the world, guests and Me, the depot, parcels, hand-overs,
// the outfitter, stamp history and presence.
import { depotView, parcelRow } from "./board";
import { databaseReady, one, pool, tx } from "./db";
import { conflict, forbidden, notFound, validation, type Fields } from "./errors";
import { json, parsedBody, publishedBody, route, isObject, type Ctx } from "./http";
import { historyPage, balanceOf, writeMovement } from "./ledger";
import { loadMission, promoteDue } from "./missions";
import { acceptMission, claimRushParcel, dropParcel, handOver, ownAcceptance, positionReasons } from "./parcels";
import { EMOTES, heartbeat, presenceFor, type Beat } from "./presence";
import { DEPOT, RADIUS_M, RESIDENTS, SATCHELS, satchelById } from "./seed";
import { darkroom, postOffice } from "./services";
import {
  createCourier,
  lockCourier,
  meOf,
  ownedSatchels,
  requireSession,
  requireSignedIn,
  sessionCookie,
  sessionOf,
  startSession,
} from "./sessions";
import { checkDisplayName } from "../shared/names";
import { storedTicket, storeTicket, ticketHeader } from "./tickets";

route(
  "GET",
  "/api/health",
  "none",
  async () => (databaseReady() ? json(200, { status: "ok" }) : json(503, { status: "waiting_for_database" })),
  false,
);

route(
  "GET",
  "/api/status",
  "none",
  async () => {
    const [store, mail] = await Promise.all([darkroom.isOpen(), postOffice.isOpen()]);
    return json(200, { darkroom: store ? "open" : "closed", post_office: mail ? "open" : "closed" });
  },
  false,
);

route(
  "GET",
  "/api/world",
  "none",
  async () =>
    json(200, {
      radius_m: RADIUS_M,
      depot: DEPOT,
      residents: RESIDENTS.map((r) => ({ resident_id: r.id, name: r.name, home: r.home, door: r.door })),
    }),
  false,
);

route(
  "POST",
  "/api/guest",
  "json",
  async (ctx) => {
    const existing = await sessionOf(ctx, pool);
    publishedBody(ctx, {});
    if (existing) return json(200, await meOf(pool, existing.courier.id));
    const { me, token } = await tx(async (db) => {
      const id = await createCourier(db, "guest", null);
      const { token } = await startSession(db, id);
      return { me: await meOf(db, id), token };
    });
    return json(201, me, { "Set-Cookie": sessionCookie(token) });
  },
  false,
);

route("GET", "/api/me", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  return json(200, await meOf(pool, s.courier.id));
});

route("PATCH", "/api/me", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  const raw = parsedBody(ctx)?.value;
  const sent = isObject(raw) ? raw : {};
  if ("display_name" in sent && s.courier.name_locked) throw forbidden("name_locked");
  return tx(async (db) => {
    await lockCourier(db, s.courier.id);
    if (typeof sent.satchel_id === "string" && satchelById(sent.satchel_id)) {
      const owned = await ownedSatchels(db, s.courier.id);
      if (!owned.includes(sent.satchel_id)) throw conflict("not_owned");
    }
    const body = publishedBody(ctx, { display_name: true, satchel_id: true });
    const fields: Fields = {};
    let name: string | undefined;
    if ("display_name" in body) {
      const checked = checkDisplayName(body.display_name);
      if (checked.ok) name = checked.name;
      else fields.display_name = checked.reason;
    }
    if ("satchel_id" in body && !(typeof body.satchel_id === "string" && satchelById(body.satchel_id)))
      fields.satchel_id = "invalid";
    if (Object.keys(fields).length) throw validation(fields);
    if (name !== undefined)
      await db.query("UPDATE couriers SET display_name = $2 WHERE id = $1", [s.courier.id, name]);
    if (typeof body.satchel_id === "string")
      await db.query("UPDATE couriers SET satchel_id = $2 WHERE id = $1", [s.courier.id, body.satchel_id]);
    return json(200, await meOf(db, s.courier.id));
  });
});

route("GET", "/api/me/ledger", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  return json(200, await historyPage(pool, s.courier.id, { limit: ctx.query.get("limit"), before: ctx.query.get("before") }));
});

route("GET", "/api/depot", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  await promoteDue();
  return json(200, await tx((db) => depotView(db, s.courier.id)));
});

/** Step 10 for accept and claim bodies, run only when the open-parcel check lets the request through. */
const positionBody = (ctx: Ctx) => () => publishedBody(ctx, { position: { lat: true, lon: true } });

route("POST", "/api/missions/:mission_id/accept", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  await promoteDue();
  if (!(await loadMission(pool, ctx.params.mission_id!))) throw notFound();
  const answer = await tx(async (db) => {
    await lockCourier(db, s.courier.id);
    return acceptMission(db, s.courier.id, ctx.params.mission_id!, positionBody(ctx));
  });
  return json(answer.status, answer.body);
});

route("POST", "/api/rush/:rush_id/claim", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  await promoteDue();
  if (!(await parcelRow(pool, ctx.params.rush_id!))) throw notFound();
  requireSignedIn(s.courier);
  const answer = await tx(async (db) => {
    await lockCourier(db, s.courier.id);
    return claimRushParcel(db, s.courier.id, ctx.params.rush_id!, positionBody(ctx));
  });
  return json(answer.status, answer.body);
});

route("POST", "/api/acceptances/:acceptance_id/drop", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  const found = await ownAcceptance(pool, s.courier.id, ctx.params.acceptance_id!);
  return tx(async (db) => {
    await lockCourier(db, s.courier.id);
    return json(200, await dropParcel(db, found, () => publishedBody(ctx, {})));
  });
});

/** A hand-over ticket is bound to the request body as sent (canonical JSON when it parses). */
function bodyBinding(ctx: Ctx): string {
  const parsed = parsedBody(ctx);
  return parsed ? JSON.stringify(parsed.value) : ctx.raw.toString("utf8");
}

route("POST", "/api/deliveries", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  const ticket = ticketHeader(ctx, "Handover-Ticket");
  const binding = bodyBinding(ctx);
  return tx(async (db) => {
    const replay = await storedTicket(db, s.courier.id, "handover", ticket, binding);
    if (replay) return replay;
    const raw = parsedBody(ctx)?.value;
    const acceptanceId = isObject(raw) ? raw.acceptance_id : undefined;
    const found = typeof acceptanceId === "string" ? await ownAcceptance(db, s.courier.id, acceptanceId) : null;
    await lockCourier(db, s.courier.id);
    const fieldsOf = (): { body: Record<string, unknown>; fields: Fields } => {
      const b = publishedBody(ctx, { acceptance_id: true, position: { lat: true, lon: true } });
      const fields: Fields = {};
      if (!("acceptance_id" in b)) fields.acceptance_id = "required";
      else if (typeof b.acceptance_id !== "string") fields.acceptance_id = "invalid";
      positionReasons(b.position, "position", false, fields);
      return { body: b, fields };
    };
    // Without an acceptance id there is nothing to look up: the field reasons refuse the request.
    if (!found) throw validation(fieldsOf().fields);
    const body = () => {
      const checked = fieldsOf();
      if (Object.keys(checked.fields).length) throw validation(checked.fields);
      return checked.body;
    };
    const answer = await handOver(db, s.courier.id, found, body);
    return storeTicket(db, s.courier.id, "handover", ticket, binding, { status: 201, body: answer });
  });
});

route("GET", "/api/outfitter", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  const owned = await ownedSatchels(pool, s.courier.id);
  const worn = (await one<{ satchel_id: string }>(pool, "SELECT satchel_id FROM couriers WHERE id = $1", [s.courier.id]))!
    .satchel_id;
  return json(200, {
    satchels: SATCHELS.map((x) => ({
      satchel_id: x.id,
      name: x.name,
      price: x.price,
      colour: x.id,
      owned: owned.includes(x.id),
      worn: x.id === worn,
    })),
  });
});

route("POST", "/api/outfitter/:satchel_id/buy", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  const ticket = ticketHeader(ctx, "Purchase-Ticket");
  const satchelId = ctx.params.satchel_id!;
  return tx(async (db) => {
    const replay = await storedTicket(db, s.courier.id, "purchase", ticket, satchelId);
    if (replay) return replay;
    const satchel = satchelById(satchelId);
    if (!satchel) throw notFound();
    await lockCourier(db, s.courier.id);
    if ((await ownedSatchels(db, s.courier.id)).includes(satchel.id)) throw conflict("already_owned");
    if ((await balanceOf(db, s.courier.id)) < satchel.price) throw conflict("insufficient_stamps");
    publishedBody(ctx, {});
    const movementId = await writeMovement(db, s.courier.id, "purchase", satchel.id, -satchel.price);
    await db.query("INSERT INTO owned_satchels (courier_id, satchel_id) VALUES ($1, $2)", [s.courier.id, satchel.id]);
    const answer = JSON.stringify({ satchel_id: satchel.id, balance: await balanceOf(db, s.courier.id), movement_id: movementId });
    return storeTicket(db, s.courier.id, "purchase", ticket, satchelId, { status: 201, body: answer });
  });
});

route("GET", "/api/presence", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  return json(200, await presenceFor(pool, s.courier.id));
});

const STREAM = /^[A-Za-z0-9_-]{8,64}$/;

route("POST", "/api/presence", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  const body = publishedBody(ctx, { stream: true, seq: true, position: { lat: true, lon: true, heading_deg: true }, emote: true });
  const fields: Fields = {};
  if (!("stream" in body)) fields.stream = "required";
  else if (typeof body.stream !== "string" || !STREAM.test(body.stream)) fields.stream = "invalid";
  if (!("seq" in body)) fields.seq = "required";
  else if (typeof body.seq !== "number" || !Number.isInteger(body.seq)) fields.seq = "invalid";
  else if (body.seq < 1 || body.seq > Number.MAX_SAFE_INTEGER) fields.seq = "out_of_range";
  positionReasons(body.position, "position", true, fields);
  const emote = body.emote ?? null;
  if (emote !== null && !EMOTES.includes(emote as never)) fields.emote = "invalid";
  if (Object.keys(fields).length) throw validation(fields);
  const beat = { stream: body.stream, seq: body.seq, position: body.position, emote } as Beat;
  return json(200, await tx((db) => heartbeat(db, s.id, s.courier.id, beat)));
});
