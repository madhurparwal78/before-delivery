import type { Tx } from "./db.js";
import { Errors, type FieldReason } from "./errors.js";
import { randomId, randomToken, type AppConfig } from "./config.js";
import {
  balanceOf, courierForSession, createSession, encodeCursor, decodeCursor, serializeMe, siteSecret,
  serializeMovement, withTicket, satchelById, writeMovement, type CourierRow,
} from "./domain.js";
import { checkDisplayName, findUnknownKeys, positionSchema, presenceSchema, validatePosition, validStream, validateEmailField, isValidReturnTo } from "./validate.js";

/** The `{"lat","lon"}` published-position schema, shared with the routes. */
export const positionSchemaPublic = (): Record<string, unknown> => positionSchema;
import { isoFromPgDate, isoNow } from "./time.js";
import { boardDate } from "./zones.js";
import { studioZone } from "./missions.js";
import { RESIDENTS, SATCHELS, EMOTES, type Emote } from "../shared/seed.js";
import { arcM, DOOR_DISTANCE_M, PLANET_RADIUS_M } from "../shared/geometry.js";
import { heartbeat, listPresence, listStaffPresence, removeSessionPresence, moveSessionPresence } from "./presence.js";
import { readDepot, parcelFromRow, routeFacts, effectiveStatus, type MissionRow } from "./rush.js";
import { validatePng } from "./png.js";
import type { PostcardStore } from "./store.js";
import type { PostOffice } from "./mail.js";
import { randomShareToken } from "./config.js";
import { base } from "./http-util.js";

export type ApiDeps = { cfg: AppConfig; store: PostcardStore; postOffice: PostOffice };

/** Position validation for accept/claim/deliver: each endpoint's published keys only. */
export function validatedPosition(body: Record<string, unknown>, published: Record<string, unknown> = { position: positionSchema }): { lat: number; lon: number } {
  const unknown = findUnknownKeys(body, published);
  if (Object.keys(unknown).length > 0) throw Errors.validation(unknown);
  if (!("position" in body)) throw Errors.validation({ position: "required" });
  const check = validatePosition(body, "position", ["lat", "lon"], false);
  if (Object.keys(check.fields).length > 0) throw Errors.validation(check.fields);
  return { lat: check.value.lat, lon: check.value.lon };
}

// ---------------------------------------------------------------------------
// World

export function worldBody(): Record<string, unknown> {
  return {
    radius_m: PLANET_RADIUS_M,
    depot: { lat: 0, lon: 0 },
    residents: RESIDENTS.map((r) => ({ resident_id: r.resident_id, name: r.name, home: r.home, door: r.door })),
  };
}

// ---------------------------------------------------------------------------
// Guest and me

export async function startGuest(deps: ApiDeps, tx: Tx, existing: CourierRow | null): Promise<{ token: string | null; body: string; status: number }> {
  if (existing) {
    const me = await serializeMe(tx, existing);
    return { token: null, body: JSON.stringify(me), status: 200 };
  }
  const id = randomId("cu_");
  const name = `Courier ${String(Math.floor(1000 + Math.random() * 9000))}`;
  await tx.query(
    `INSERT INTO couriers (id, email, role, display_name, worn_satchel, moderation_ref) VALUES ($1, NULL, 'guest', $2, 'canvas', $3)`,
    [id, name, randomId("mod_")],
  );
  await tx.query(`INSERT INTO satchel_ownership (courier_id, satchel_id) VALUES ($1, 'canvas')`, [id]);
  const token = await createSession(tx, id);
  const me = await serializeMe(tx, (await courierForSession(tx, token))!.courier);
  void deps;
  return { token, body: JSON.stringify(me), status: 201 };
}

export async function patchMe(tx: Tx, courier: CourierRow, body: Record<string, unknown>): Promise<string> {
  const unknown = findUnknownKeys(body, { display_name: null, satchel_id: null });
  if (Object.keys(unknown).length > 0) throw Errors.validation(unknown);

  // A name_locked refusal (step 7) comes before field validation (step 10).
  if ("display_name" in body && courier.name_locked) {
    throw Errors.forbidden("name_locked", "A community helper reset your name. It can't be changed right now.");
  }
  let displayName: string | null = null;
  if ("display_name" in body) {
    const check = checkDisplayName(body.display_name);
    if (Object.keys(check.fields).length > 0) throw Errors.validation(check.fields);
    displayName = check.value;
  }
  let satchelId: string | null = null;
  if ("satchel_id" in body) {
    const v = body.satchel_id;
    if (typeof v !== "string" || !satchelById(v)) throw Errors.validation({ satchel_id: "invalid" });
    satchelId = v;
  }

  if (displayName !== null) {
    await tx.query(`UPDATE couriers SET display_name=$2 WHERE id=$1`, [courier.id, displayName]);
  }
  if (satchelId !== null) {
    const { rows } = await tx.query(`SELECT 1 FROM satchel_ownership WHERE courier_id=$1 AND satchel_id=$2`, [courier.id, satchelId]);
    if (rows.length === 0) throw Errors.conflict("not_owned", "Buy this satchel first.");
    await tx.query(`UPDATE couriers SET worn_satchel=$2 WHERE id=$1`, [courier.id, satchelId]);
  }
  const { rows: fresh } = await tx.query<CourierRow>(`SELECT * FROM couriers WHERE id=$1`, [courier.id]);
  return JSON.stringify(await serializeMe(tx, fresh[0]));
}

// ---------------------------------------------------------------------------
// Ledger paging

export async function ledgerPage(tx: Tx, courierId: string, limit: number, before: string | null): Promise<string> {
  const secret = await siteSecret(tx);
  let cursor: { created_at: Date; movement_id: string } | null = null;
  if (before !== null) {
    const id = decodeCursor(secret, courierId, before);
    if (id === null) throw Errors.validation({ before: "invalid" });
    const { rows } = await tx.query<{ created_at: Date; movement_id: string }>(
      `SELECT created_at, movement_id FROM ledger_movements WHERE movement_id=$1 AND courier_id=$2`, [id, courierId],
    );
    if (rows.length === 0) throw Errors.validation({ before: "invalid" });
    cursor = rows[0];
  }
  const { rows: page } = await tx.query<{ movement_id: string; kind: "delivery" | "purchase"; created_at: Date }>(
    `SELECT movement_id, kind, created_at FROM ledger_movements
     WHERE courier_id = $1
       AND ($2::timestamptz IS NULL OR (created_at, movement_id) < ($2::timestamptz, $3::text))
     ORDER BY created_at DESC, movement_id DESC
     LIMIT $4`,
    [courierId, cursor?.created_at ?? null, cursor?.movement_id ?? null, limit + 1],
  );
  const hasOlder = page.length > limit;
  const shown = page.slice(0, limit);
  let nextCursor: string | null = null;
  if (hasOlder && shown.length > 0) nextCursor = encodeCursor(secret, courierId, shown[shown.length - 1].movement_id);

  const { rows: entries } = await tx.query<{ movement_id: string; account: string; amount: number; ref: string; kind: "delivery" | "purchase"; created_at: Date }>(
    `SELECT e.movement_id, e.account, e.amount, m.ref, m.kind, m.created_at
     FROM ledger_entries e JOIN ledger_movements m ON m.movement_id = e.movement_id
     WHERE m.courier_id = $1 AND e.movement_id = ANY($2::text[])
     ORDER BY m.created_at DESC, m.movement_id DESC`,
    [courierId, shown.map((s) => s.movement_id)],
  );
  const byMovement = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byMovement.get(e.movement_id) ?? [];
    list.push(e);
    byMovement.set(e.movement_id, list);
  }
  const movements = shown
    .map((s) => serializeMovement(byMovement.get(s.movement_id) ?? []))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  const balance = await balanceOf(tx, courierId);
  return JSON.stringify({ balance, movements, next_cursor: nextCursor });
}

// ---------------------------------------------------------------------------
// Depot board

export async function depotRead(tx: Tx, courierId: string): Promise<string> {
  const zone = await studioZone(tx);
  const day = boardDate(zone);
  const { rush, rushLeft, missions } = await readDepot(tx, courierId, day);
  return JSON.stringify({ board_date: day, time_zone: zone, rush_left: rushLeft, missions, rush });
}

// ---------------------------------------------------------------------------
// Accept, claim, drop, deliver

type AcceptanceRow = {
  acceptance_id: string; courier_id: string; mission_id: string; version: number; kind: string;
  rush_id: string | null; route_id: string; door_lat: number; door_lon: number;
  total_arc_m: number; initial_bearing_deg: number; first_answer: string;
  hold_expires_at: Date | null; status: string;
};

/** Serializes a courier's accept/claim decisions so two concurrent claims can't both win. */
async function lockCourierHands(tx: Tx, courierId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`hands:${courierId}`]);
}

/** The open-parcel check: a repeat answers 200 with the original Parcel, decided before every other state check. */
async function openParcelCheck(tx: Tx, courierId: string, missionId: string | null, rushId: string | null): Promise<string | null> {
  const { rows } = await tx.query<AcceptanceRow>(
    `SELECT * FROM acceptances WHERE courier_id = $1 AND status = 'open' LIMIT 1`,
    [courierId],
  );
  if (rows.length === 0) return null;
  const open = rows[0];
  if (missionId !== null && open.rush_id === null && open.mission_id === missionId) {
    return open.first_answer; // repeated accept, byte for byte
  }
  if (rushId !== null && open.rush_id === rushId && open.hold_expires_at !== null && open.hold_expires_at.getTime() > Date.now()) {
    return open.first_answer; // repeated claim before the hold lapses
  }
  throw Errors.conflict("hands_full", "Your hands are full — deliver or drop your parcel first.");
}

export async function acceptMission(tx: Tx, courierId: string, missionId: string, position: { lat: number; lon: number }): Promise<{ status: number; body: string }> {
  await lockCourierHands(tx, courierId);
  const { rows: mrows } = await tx.query<MissionRow>(`SELECT * FROM missions WHERE mission_id = $1`, [missionId]);
  if (mrows.length === 0) throw Errors.notFound();
  const mission = mrows[0];
  const repeat = await openParcelCheck(tx, courierId, missionId, null);
  if (repeat !== null) return { status: 200, body: repeat };

  if (effectiveStatus(mission) !== "live") throw Errors.conflict("mission_not_live", "This errand is no longer posted.");
  if (mission.kind === "rush") throw Errors.conflict("rush_claim_required", "Rush parcels are claimed from the board.");

  const { rows: vrows } = await tx.query<{
    mission_id: string; version: number; title: string; resident_id: string; reward_stamps: number; offer: string[]; thanks: string[];
  }>(`SELECT mission_id, version, title, resident_id, reward_stamps, offer, thanks FROM mission_versions WHERE mission_id=$1 AND version=$2`, [missionId, mission.version]);
  const versionRow = normalize(vrows[0]);

  const acceptanceId = randomId("acc_");
  const facts = routeFacts(position, mission.resident_id);
  const row = {
    acceptance_id: acceptanceId,
    mission_id: missionId,
    version: mission.version,
    rush_id: null as string | null,
    hold_expires_at: null as Date | null,
    route_id: facts.route_id,
    total_arc_m: facts.total_arc_m,
    initial_bearing_deg: facts.initial_bearing_deg,
  };
  const parcelJson = JSON.stringify(parcelFromRow(row, versionRow));
  await tx.query(
    `INSERT INTO acceptances (acceptance_id, courier_id, mission_id, version, kind, rush_id, route_id, door_lat, door_lon,
       total_arc_m, initial_bearing_deg, first_answer, hold_expires_at, status)
     VALUES ($1,$2,$3,$4,'standard',NULL,$5,$6,$7,$8,$9,$10,NULL,'open')`,
    [acceptanceId, courierId, missionId, mission.version, facts.route_id, versionRowDoor(versionRow).lat, versionRowDoor(versionRow).lon,
     facts.total_arc_m, facts.initial_bearing_deg, parcelJson],
  );
  return { status: 201, body: parcelJson };
}

function versionRowDoor(versionRow: { resident_id: string }): { lat: number; lon: number } {
  return RESIDENTS.find((r) => r.resident_id === versionRow.resident_id)!.door;
}

function normalize(row: { offer: unknown; thanks: unknown; mission_id: string; version: number; title: string; resident_id: string; reward_stamps: number }): { mission_id: string; version: number; title: string; resident_id: string; reward_stamps: number; offer: string[]; thanks: string[] } {
  return { ...row, offer: row.offer as string[], thanks: row.thanks as string[] };
}

export async function claimRush(tx: Tx, courierId: string, rushId: string, position: { lat: number; lon: number }, holdSeconds: number): Promise<{ status: number; body: string }> {
  await lockCourierHands(tx, courierId);
  const repeat = await openParcelCheck(tx, courierId, null, rushId);
  if (repeat !== null) return { status: 200, body: repeat };

  const { rows: prows } = await tx.query<{
    rush_id: string; mission_id: string; board_date: string; slot: number; slots: number;
    status: string; claimed_by: string | null;
  }>(`SELECT * FROM rush_parcels WHERE rush_id = $1 FOR UPDATE`, [rushId]);
  if (prows.length === 0) throw Errors.notFound();
  const parcel = prows[0];

  const { rows: mrows } = await tx.query<MissionRow>(`SELECT * FROM missions WHERE mission_id = $1`, [parcel.mission_id]);
  const mission = mrows[0];
  const zone = await studioZone(tx);
  const today = boardDate(zone);
  if (parcel.status === "gone" || effectiveStatus(mission) !== "live") {
    throw Errors.conflict("mission_not_live", "This errand is no longer posted.");
  }
  if (parcel.board_date !== today) throw Errors.conflict("board_closed", "That board has closed for the day.");

  // Expiry is judged per request: a lapsed claim reads as posted and can be re-claimed.
  if (parcel.status === "claimed" && parcel.claimed_by) {
    const { rows: arows } = await tx.query<{ hold_expires_at: Date }>(
      `SELECT hold_expires_at FROM acceptances WHERE rush_id=$1 AND status='open' LIMIT 1`, [rushId],
    );
    const lapsed = arows.length === 0 || arows[0].hold_expires_at.getTime() <= Date.now();
    if (!lapsed) throw Errors.conflict("parcel_taken", "Another courier got there first.");
    await tx.query(`UPDATE acceptances SET status='expired' WHERE rush_id=$1 AND status='open'`, [rushId]);
  } else if (parcel.status === "delivered") {
    throw Errors.conflict("parcel_taken", "Another courier got there first.");
  }

  const { rows: vrows } = await tx.query<{
    mission_id: string; version: number; title: string; resident_id: string; reward_stamps: number; offer: string[]; thanks: string[];
  }>(`SELECT mission_id, version, title, resident_id, reward_stamps, offer, thanks FROM mission_versions WHERE mission_id=$1 AND version=$2`, [mission.mission_id, mission.version]);
  const versionRow = normalize(vrows[0]);

  const acceptanceId = randomId("acc_");
  const holdExpires = new Date(Date.now() + holdSeconds * 1000);
  const facts = routeFacts(position, mission.resident_id);
  const row = {
    acceptance_id: acceptanceId,
    mission_id: mission.mission_id,
    version: mission.version,
    rush_id: rushId,
    hold_expires_at: holdExpires,
    route_id: facts.route_id,
    total_arc_m: facts.total_arc_m,
    initial_bearing_deg: facts.initial_bearing_deg,
  };
  const parcelJson = JSON.stringify(parcelFromRow(row, versionRow));
  await tx.query(
    `INSERT INTO acceptances (acceptance_id, courier_id, mission_id, version, kind, rush_id, route_id, door_lat, door_lon,
       total_arc_m, initial_bearing_deg, first_answer, hold_expires_at, status)
     VALUES ($1,$2,$3,$4,'rush',$5,$6,$7,$8,$9,$10,$11,$12,'open')`,
    [acceptanceId, courierId, mission.mission_id, mission.version, rushId, facts.route_id, versionRowDoor(versionRow).lat, versionRowDoor(versionRow).lon,
     facts.total_arc_m, facts.initial_bearing_deg, parcelJson, holdExpires],
  );
  await tx.query(`UPDATE rush_parcels SET status='claimed', claimed_by=$2, claimed_at=now() WHERE rush_id=$1`, [rushId, courierId]);
  return { status: 201, body: parcelJson };
}

export async function dropParcel(tx: Tx, courierId: string, acceptanceId: string): Promise<string> {
  const { rows } = await tx.query<AcceptanceRow>(`SELECT * FROM acceptances WHERE acceptance_id = $1`, [acceptanceId]);
  if (rows.length === 0 || rows[0].courier_id !== courierId) throw Errors.notFound();
  const acc = rows[0];
  if (acc.status !== "open") throw Errors.conflict("parcel_closed", "That parcel is already closed.");
  await tx.query(`UPDATE acceptances SET status='dropped' WHERE acceptance_id=$1`, [acceptanceId]);
  if (acc.rush_id) {
    const { rows: mrows } = await tx.query<MissionRow>(`SELECT * FROM missions WHERE mission_id=$1`, [acc.mission_id]);
    const missionLive = mrows.length > 0 && effectiveStatus(mrows[0]) === "live";
    await tx.query(
      `UPDATE rush_parcels SET status=$2, claimed_by=NULL WHERE rush_id=$1`,
      [acc.rush_id, missionLive ? "posted" : "gone"],
    );
  }
  return JSON.stringify({ acceptance_id: acceptanceId, status: "dropped" });
}

/** Hand-over: replay, ownership, hold expiry, door distance, delivery and its paired ledger movement — in that order. */
export async function deliverParcel(
  tx: Tx,
  courierId: string,
  ticket: string,
  rawBody: string,
  acceptanceId: string,
  position: { lat: number; lon: number },
): Promise<{ status: number; body: string }> {
  return withTicket(tx, "handover", courierId, ticket, rawBody, async (tx2) => {
    const { rows } = await tx2.query<AcceptanceRow>(`SELECT * FROM acceptances WHERE acceptance_id = $1`, [acceptanceId]);
    if (rows.length === 0 || rows[0].courier_id !== courierId) throw Errors.notFound();
    const acc = rows[0];
    if (acc.status === "delivered") throw Errors.conflict("already_delivered", "That parcel was already delivered.");
    if (acc.status === "dropped") throw Errors.conflict("parcel_dropped", "That parcel was dropped.");
    if (acc.status === "expired") {
      throw Errors.conflict("hold_expired", "Your rush hold ran out. The parcel is back on the board.");
    }
    if (acc.rush_id !== null) {
      // Hold expiry is judged by the server clock as this request is processed.
      const hold = acc.hold_expires_at;
      if (hold !== null && hold.getTime() <= Date.now()) {
        await tx2.query(`UPDATE acceptances SET status='expired' WHERE acceptance_id=$1`, [acceptanceId]);
        await tx2.query(`UPDATE rush_parcels SET status='posted', claimed_by=NULL WHERE rush_id=$1`, [acc.rush_id]);
        throw Errors.conflict("hold_expired", "Your rush hold ran out. The parcel is back on the board.");
      }
    }
    const door = { lat: acc.door_lat, lon: acc.door_lon };
    if (arcM(position, door) > DOOR_DISTANCE_M) {
      throw Errors.validation({ position: "too_far" });
    }

    // The courier gets the door, reward and thanks lines of the mission version they accepted.
    const { rows: vrows } = await tx2.query<{ thanks: string[]; reward_stamps: number }>(
      `SELECT thanks, reward_stamps FROM mission_versions WHERE mission_id=$1 AND version=$2`, [acc.mission_id, acc.version],
    );
    const reward = vrows[0].reward_stamps;
    const movement = await writeMovement(tx2, courierId, "delivery", acc.mission_id, reward);
    const deliveryId = randomId("dl_");
    await tx2.query(
      `INSERT INTO deliveries (delivery_id, acceptance_id, mission_id, version, stamps_awarded, movement_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [deliveryId, acceptanceId, acc.mission_id, acc.version, reward, movement.movementId],
    );
    await tx2.query(`UPDATE acceptances SET status='delivered' WHERE acceptance_id=$1`, [acceptanceId]);
    if (acc.rush_id) await tx2.query(`UPDATE rush_parcels SET status='delivered' WHERE rush_id=$1`, [acc.rush_id]);
    const balance = await balanceOf(tx2, courierId);
    return {
      status: 201,
      body: JSON.stringify({
        delivery_id: deliveryId,
        acceptance_id: acceptanceId,
        mission_id: acc.mission_id,
        version: acc.version,
        stamps_awarded: reward,
        balance,
        movement_id: movement.movementId,
        dialogue: { thanks: vrows[0].thanks },
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Outfitter

export async function outfitterList(tx: Tx, courierId: string): Promise<string> {
  const { rows: owned } = await tx.query<{ satchel_id: string }>(`SELECT satchel_id FROM satchel_ownership WHERE courier_id=$1`, [courierId]);
  const { rows: worn } = await tx.query<{ worn_satchel: string }>(`SELECT worn_satchel FROM couriers WHERE id=$1`, [courierId]);
  const ownedSet = new Set(owned.map((r) => r.satchel_id));
  return JSON.stringify({
    satchels: SATCHELS.map((s) => ({
      satchel_id: s.satchel_id,
      name: s.name,
      price: s.price,
      colour: s.colour,
      owned: ownedSet.has(s.satchel_id),
      worn: worn[0].worn_satchel === s.satchel_id,
    })),
  });
}

export async function buySatchel(tx: Tx, courierId: string, ticket: string, satchelId: string): Promise<{ status: number; body: string }> {
  return withTicket(tx, "purchase", courierId, ticket, satchelId, async (tx2) => {
    const satchel = satchelById(satchelId);
    if (!satchel) throw Errors.notFound();
    const { rows: owned } = await tx2.query(`SELECT 1 FROM satchel_ownership WHERE courier_id=$1 AND satchel_id=$2`, [courierId, satchelId]);
    if (owned.length > 0) throw Errors.conflict("already_owned", "You already own this satchel.");
    const balance = await balanceOf(tx2, courierId);
    // A purchase that would take the balance below zero fails; only purchases the balance covers succeed.
    let movementId: string | null = null;
    if (balance < satchel.price) {
      throw Errors.conflict("insufficient_stamps", "You need more stamps for that satchel.");
    }
    if (satchel.price > 0) {
      const movement = await writeMovement(tx2, courierId, "purchase", satchelId, -satchel.price);
      movementId = movement.movementId;
    }
    await tx2.query(`INSERT INTO satchel_ownership (courier_id, satchel_id) VALUES ($1,$2)`, [courierId, satchelId]);
    const newBalance = await balanceOf(tx2, courierId);
    return { status: 201, body: JSON.stringify({ satchel_id: satchelId, balance: newBalance, movement_id: movementId }) };
  });
}

// ---------------------------------------------------------------------------
// Presence endpoints

export async function presencePost(tx: Tx, courier: CourierRow, sessionId: string, body: Record<string, unknown>): Promise<string> {
  const unknown = findUnknownKeys(body, { stream: null, seq: null, position: presenceSchema, emote: null });
  if (Object.keys(unknown).length > 0) throw Errors.validation(unknown);

  const fields: Record<string, FieldReason> = {};
  if (!("stream" in body)) fields.stream = "required";
  else if (!validStream(body.stream)) fields.stream = "invalid";
  if (!("seq" in body)) fields.seq = "required";
  else if (typeof body.seq !== "number" || !Number.isInteger(body.seq)) fields.seq = "invalid";
  else if (body.seq < 1 || body.seq > 9_007_199_254_740_991) fields.seq = "out_of_range";
  let emote: Emote | null = null;
  if ("emote" in body && body.emote !== null && body.emote !== undefined) {
    if (typeof body.emote !== "string" || !(EMOTES as readonly string[]).includes(body.emote)) fields.emote = "invalid";
    else emote = body.emote as Emote;
  }
  if (!("position" in body)) fields.position = "required";
  else if (typeof body.position !== "object" || body.position === null) fields.position = "invalid";
  const pos = validatePosition(body, "position", ["lat", "lon", "heading_deg"], true);
  Object.assign(fields, pos.fields);
  if (Object.keys(fields).length > 0) throw Errors.validation(fields);

  const result = await heartbeat(tx, {
    sessionId,
    courierId: courier.id,
    muted: courier.muted,
    stream: body.stream as string,
    seq: body.seq as number,
    position: { lat: pos.value.lat, lon: pos.value.lon, heading_deg: pos.value.heading_deg ?? 0 },
    emote,
  });
  return JSON.stringify(result);
}

export async function presenceGet(tx: Tx, courierId: string): Promise<string> {
  const entries = await listPresence(tx, courierId);
  return JSON.stringify({ couriers: entries });
}

// ---------------------------------------------------------------------------
// Moderation

export async function moderationPresence(tx: Tx): Promise<string> {
  const entries = await listStaffPresence(tx);
  return JSON.stringify({ couriers: entries });
}

export async function moderationMute(tx: Tx, actor: CourierRow, moderationRef: string, mute: boolean): Promise<string> {
  const { rows } = await tx.query<CourierRow>(`SELECT * FROM couriers WHERE moderation_ref = $1 FOR UPDATE`, [moderationRef]);
  if (rows.length === 0) throw Errors.notFound();
  const target = rows[0];
  if (target.role === "helper" || target.role === "founder") {
    throw Errors.forbidden("cannot_moderate_staff", "Helpers can't moderate staff.");
  }
  if (target.muted === mute) {
    throw Errors.conflict(mute ? "already_muted" : "not_muted", mute ? "That courier is already muted." : "That courier isn't muted.");
  }
  await tx.query(`UPDATE couriers SET muted=$2 WHERE id=$1`, [target.id, mute]);
  if (mute) await tx.query(`UPDATE presence SET emote=NULL, emote_at=NULL WHERE courier_id=$1`, [target.id]);
  await writeAudit(tx, mute ? "mute" : "unmute", actor, target, target.display_name, target.display_name);
  return JSON.stringify({ display_name: target.display_name, muted: mute });
}

export async function moderationRename(tx: Tx, actor: CourierRow, moderationRef: string): Promise<string> {
  const { rows } = await tx.query<CourierRow>(`SELECT * FROM couriers WHERE moderation_ref = $1 FOR UPDATE`, [moderationRef]);
  if (rows.length === 0) throw Errors.notFound();
  const target = rows[0];
  if (target.role === "helper" || target.role === "founder") {
    throw Errors.forbidden("cannot_moderate_staff", "Helpers can't moderate staff.");
  }
  const before = target.display_name;
  const after = `Courier ${String(Math.floor(1000 + Math.random() * 9000))}`;
  await tx.query(`UPDATE couriers SET display_name=$2, name_locked=true WHERE id=$1`, [target.id, after]);
  await writeAudit(tx, "rename", actor, target, before, after);
  return JSON.stringify({ display_name: after, name_locked: true });
}

async function writeAudit(tx: Tx, action: "mute" | "unmute" | "rename", actor: CourierRow, target: CourierRow, before: string, after: string): Promise<void> {
  await tx.query(
    `INSERT INTO moderation_audit (entry_id, action, actor_role, actor_display_name, moderation_ref, target_name_before, target_name_after, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
    [randomId("au_"), action, actor.role === "founder" ? "founder" : "helper", actor.display_name, target.moderation_ref, before, after],
  );
}

export async function auditList(tx: Tx): Promise<string> {
  const { rows } = await tx.query<{
    entry_id: string; action: string; actor_role: string; actor_display_name: string;
    moderation_ref: string; target_name_before: string; target_name_after: string; at: Date;
  }>(`SELECT * FROM moderation_audit ORDER BY at DESC, entry_id DESC LIMIT 20`);
  return JSON.stringify({
    entries: rows.map((r) => ({
      entry_id: r.entry_id,
      action: r.action,
      actor_role: r.actor_role,
      actor_display_name: r.actor_display_name,
      moderation_ref: r.moderation_ref,
      target_name_before: r.target_name_before,
      target_name_after: r.target_name_after,
      at: isoFromPgDate(r.at),
    })),
  });
}

// ---------------------------------------------------------------------------
// Postbox keys, redeem and guest save merge

export async function requestPostboxKey(deps: ApiDeps, tx: Tx, body: Record<string, unknown>): Promise<string> {
  const unknown = findUnknownKeys(body, { email: null, return_to: null });
  if (Object.keys(unknown).length > 0) throw Errors.validation(unknown);
  if (!("email" in body)) throw Errors.validation({ email: "required" });
  const emailReason = validateEmailField(body.email, "email", 254);
  if (emailReason) throw Errors.validation({ email: emailReason });
  let returnTo = "/";
  if ("return_to" in body && body.return_to !== undefined) {
    if (typeof body.return_to !== "string") throw Errors.validation({ return_to: "invalid" });
    if (body.return_to.length > 200) throw Errors.validation({ return_to: "too_long" });
    if (!isValidReturnTo(body.return_to)) throw Errors.validation({ return_to: "invalid" });
    returnTo = body.return_to;
  }
  const token = randomToken(48);
  const expires = new Date(Date.now() + deps.cfg.postboxKeyTtlSeconds * 1000);
  await tx.query(
    `INSERT INTO postbox_keys (token, email, return_to, created_at, expires_at) VALUES ($1,$2,$3, now(), $4)`,
    [token, body.email as string, returnTo, expires],
  );
  const sent = await deps.postOffice.sendPostboxKey(body.email as string, `${base(deps.cfg)}/claim?token=${token}`);
  if (!sent) throw Errors.postOfficeClosed();
  return JSON.stringify({ status: "sent" });
}

export type RedeemOutcome = { status: number; body: string; sessionToken: string };

/** Redeems a postbox key: exactly one of two simultaneous redeems succeeds; a redeem rotates the session. */
export async function redeemKey(deps: ApiDeps, tx: Tx, oldSessionToken: string | null, token: string): Promise<RedeemOutcome> {
  const { rows } = await tx.query<{ email: string; return_to: string; created_at: Date; expires_at: Date; used_at: Date | null }>(
    `SELECT * FROM postbox_keys WHERE token = $1 FOR UPDATE`, [token],
  );
  if (rows.length === 0) throw Errors.gone("link_invalid", "This postbox key doesn't fit any postbox.");
  const key = rows[0];
  if (key.used_at !== null) throw Errors.gone("link_used", "This postbox key was already used.");
  if (Date.now() > key.expires_at.getTime()) throw Errors.gone("link_expired", "This postbox key has expired. Ask for a new one.");
  await tx.query(`UPDATE postbox_keys SET used_at = now() WHERE token = $1`, [token]);

  // Find or create the courier for the email; the courier role is set on first use.
  const { rows: existing } = await tx.query<CourierRow>(`SELECT * FROM couriers WHERE email = $1 FOR UPDATE`, [key.email]);
  let courier: CourierRow;
  let created = false;
  if (existing.length === 0) {
    const id = randomId("cu_");
    const name = `Courier ${String(Math.floor(1000 + Math.random() * 9000))}`;
    await tx.query(
      `INSERT INTO couriers (id, email, role, display_name, worn_satchel, moderation_ref) VALUES ($1,$2,'courier',$3,'canvas',$4)`,
      [id, key.email, name, randomId("mod_")],
    );
    await tx.query(`INSERT INTO satchel_ownership (courier_id, satchel_id) VALUES ($1,'canvas')`, [id]);
    const { rows: fresh } = await tx.query<CourierRow>(`SELECT * FROM couriers WHERE id=$1`, [id]);
    courier = fresh[0];
    created = true;
  } else {
    courier = existing[0];
  }

  // Merge the browser's guest save once, if it has progress.
  let merged = false;
  let mergeReport: Record<string, unknown> | null = null;
  if (oldSessionToken) {
    const { rows: srows } = await tx.query<{ courier_id: string }>(`SELECT courier_id FROM sessions WHERE token=$1`, [oldSessionToken]);
    if (srows.length > 0) {
      const { rows: grows } = await tx.query<CourierRow>(`SELECT * FROM couriers WHERE id=$1`, [srows[0].courier_id]);
      const candidate = grows[0];
      if (candidate.role === "guest" && !candidate.guest_save_claimed) {
        const report = await mergeGuestSave(tx, candidate, courier, created);
        if (report) {
          merged = true;
          mergeReport = report;
        }
      }
    }
  }

  // Rotate sessions: the old session ends and its heartbeats move over in the same step.
  const newToken = await createSession(tx, courier.id);
  if (oldSessionToken) {
    await moveSessionPresence(tx, oldSessionToken, newToken);
    await tx.query(`DELETE FROM sessions WHERE token=$1`, [oldSessionToken]);
  }
  const { rows: final } = await tx.query<CourierRow>(`SELECT * FROM couriers WHERE id=$1`, [courier.id]);
  return {
    status: 200,
    body: JSON.stringify({
      role: final[0].role,
      display_name: final[0].display_name,
      balance: await balanceOf(tx, courier.id),
      merged_guest: merged,
      merge_report: mergeReport,
      return_to: key.return_to,
    }),
    sessionToken: newToken,
  };
}

/** Merges a guest save into a courier exactly once, or returns null when it has no progress. */
async function mergeGuestSave(
  tx: Tx,
  guest: CourierRow,
  target: CourierRow,
  targetCreated: boolean,
): Promise<Record<string, unknown> | null> {
  const { rows: movements } = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ledger_movements WHERE courier_id=$1`, [guest.id],
  );
  const { rows: extraSatchels } = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM satchel_ownership WHERE courier_id=$1 AND satchel_id <> 'canvas'`, [guest.id],
  );
  const { rows: open } = await tx.query<{ acceptance_id: string }>(
    `SELECT acceptance_id FROM acceptances WHERE courier_id=$1 AND status='open' LIMIT 1`, [guest.id],
  );
  const hasProgress = Number(movements[0].n) > 0 || Number(extraSatchels[0].n) > 0 || open.length > 0;
  if (!hasProgress) return null;

  await tx.query(`UPDATE couriers SET guest_save_claimed=true WHERE id=$1`, [guest.id]);

  // Movements move with their original ids and times.
  await tx.query(`UPDATE ledger_movements SET courier_id=$2 WHERE courier_id=$1`, [guest.id, target.id]);

  // Satchels the courier didn't already own are reported, then combined.
  const { rows: addedRows } = await tx.query<{ satchel_id: string }>(
    `SELECT s.satchel_id FROM satchel_ownership s
     WHERE s.courier_id=$1 AND NOT EXISTS (
       SELECT 1 FROM satchel_ownership o WHERE o.courier_id=$2 AND o.satchel_id=s.satchel_id)`,
    [guest.id, target.id],
  );
  await tx.query(
    `INSERT INTO satchel_ownership (courier_id, satchel_id, acquired_at)
     SELECT $2, satchel_id, acquired_at FROM satchel_ownership WHERE courier_id=$1
     ON CONFLICT (courier_id, satchel_id) DO NOTHING`,
    [guest.id, target.id],
  );

  // The open parcel moves if the courier has none, keeping its first answer; otherwise it drops.
  const { rows: targetOpen } = await tx.query(`SELECT acceptance_id FROM acceptances WHERE courier_id=$1 AND status='open' LIMIT 1`, [target.id]);
  let parcelOutcome: "moved" | "dropped" | "none" = "none";
  if (open.length > 0) {
    if (targetOpen.length === 0) {
      await tx.query(`UPDATE acceptances SET courier_id=$2 WHERE acceptance_id=$1`, [open[0].acceptance_id, target.id]);
      parcelOutcome = "moved";
    } else {
      await tx.query(`UPDATE acceptances SET status='dropped' WHERE acceptance_id=$1`, [open[0].acceptance_id]);
      parcelOutcome = "dropped";
    }
  }

  // Stored tickets move; where the courier stored the same ticket value, the courier's entry wins.
  await tx.query(
    `UPDATE tickets t SET courier_id=$2
     WHERE t.courier_id=$1 AND NOT EXISTS (
       SELECT 1 FROM tickets c WHERE c.courier_id=$2 AND c.namespace=t.namespace AND c.ticket=t.ticket AND c.status IS NOT NULL)`,
    [guest.id, target.id],
  );
  await tx.query(`DELETE FROM tickets WHERE courier_id=$1`, [guest.id]);

  // A new courier takes the guest's name and worn satchel; an existing courier keeps theirs.
  let nameKept: "guest" | "courier" = "courier";
  if (targetCreated) {
    await tx.query(`UPDATE couriers SET display_name=$2, worn_satchel=$3 WHERE id=$1`, [target.id, guest.display_name, guest.worn_satchel]);
    nameKept = "guest";
  }
  return {
    movements: Number(movements[0].n),
    satchels_added: addedRows.map((r) => r.satchel_id),
    parcel: parcelOutcome,
    name_kept: nameKept,
  };
}

export async function signOut(tx: Tx, sessionToken: string): Promise<void> {
  await removeSessionPresence(tx, sessionToken);
  await tx.query(`DELETE FROM sessions WHERE token=$1`, [sessionToken]);
}


// ---------------------------------------------------------------------------
// Postcards

export async function listPostcards(tx: Tx, courierId: string): Promise<string> {
  const { rows } = await tx.query<{
    postcard_id: string; share_token: string; width: number; height: number; bytes: number; created_at: Date;
  }>(
    `SELECT postcard_id, share_token, width, height, bytes, created_at FROM postcards
     WHERE courier_id=$1 AND revoked=false ORDER BY created_at DESC, postcard_id DESC`,
    [courierId],
  );
  return JSON.stringify({
    postcards: rows.map((r) => ({
      postcard_id: r.postcard_id,
      share_url: `/p/${r.share_token}`,
      width: r.width,
      height: r.height,
      bytes: r.bytes,
      created_at: isoFromPgDate(r.created_at),
    })),
  });
}

/** Upload: validate every chunk, store the image, then write the record. */
export async function uploadPostcard(deps: ApiDeps, tx: Tx, courierId: string, png: Buffer): Promise<{ status: number; body: string }> {
  const check = await validatePng(png);
  if (check.reason !== null) throw Errors.validation({ image: check.reason });
  const { rows: count } = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM postcards WHERE courier_id=$1 AND revoked=false`, [courierId],
  );
  if (Number(count[0].n) >= 24) throw Errors.conflict("postbox_full", "Your postbox is full.");

  const postcardId = randomId("pc_");
  const stored = await deps.store.put(postcardId, png);
  if (!stored) throw Errors.darkroomClosed();
  const shareToken = randomShareToken();
  try {
    await tx.query(
      `INSERT INTO postcards (postcard_id, courier_id, share_token, width, height, bytes) VALUES ($1,$2,$3,$4,$5,$6)`,
      [postcardId, courierId, shareToken, check.width!, check.height!, png.length],
    );
  } catch (err) {
    await deps.store.delete(postcardId);
    throw err;
  }
  return {
    status: 201,
    body: JSON.stringify({
      postcard_id: postcardId,
      share_url: `/p/${shareToken}`,
      width: check.width,
      height: check.height,
      bytes: png.length,
      created_at: isoNow(),
    }),
  };
}

/** Revoke: mark, remove the image, remove the record; a failed image removal lifts the mark. */
export async function revokePostcard(deps: ApiDeps, tx: Tx, courierId: string, postcardId: string): Promise<number> {
  const { rows } = await tx.query<{ postcard_id: string; revoked: boolean }>(
    `SELECT postcard_id, revoked FROM postcards WHERE postcard_id=$1 AND courier_id=$2 FOR UPDATE`,
    [postcardId, courierId],
  );
  if (rows.length === 0 || rows[0].revoked) throw Errors.notFound();
  await tx.query(`UPDATE postcards SET revoked=true WHERE postcard_id=$1`, [postcardId]);
  const removed = await deps.store.delete(postcardId);
  if (!removed) {
    await tx.query(`UPDATE postcards SET revoked=false WHERE postcard_id=$1`, [postcardId]);
    throw Errors.darkroomClosed();
  }
  await tx.query(`DELETE FROM postcards WHERE postcard_id=$1`, [postcardId]);
  return 204;
}

export async function postcardByShareToken(tx: Tx, shareToken: string): Promise<{ postcard_id: string } | null> {
  const { rows } = await tx.query<{ postcard_id: string }>(
    `SELECT postcard_id FROM postcards WHERE share_token=$1 AND revoked=false`, [shareToken],
  );
  return rows.length ? rows[0] : null;
}

/** Mails a postcard's share link to one friend, with replay, limit and outage handling. */
export async function mailPostcard(
  deps: ApiDeps,
  tx: Tx,
  courier: CourierRow,
  postcardId: string,
  ticket: string,
  to: string,
): Promise<{ status: number; body: string }> {
  const binding = `${postcardId}|${to}`;
  return withTicket(tx, "mail", courier.id, ticket, binding, async (tx2) => {
    const { rows } = await tx2.query<{ share_token: string }>(
      `SELECT share_token FROM postcards WHERE postcard_id=$1 AND courier_id=$2 AND revoked=false`,
      [postcardId, courier.id],
    );
    if (rows.length === 0) throw Errors.notFound();

    // Reserve the slot in the same transaction that checks the count.
    const windowStart = new Date(Date.now() - deps.cfg.postcardMailWindowSeconds * 1000);
    const { rows: sends } = await tx2.query<{ n: string; oldest: Date | null }>(
      `SELECT count(*)::text AS n, min(at) AS oldest FROM mail_sends WHERE courier_id=$1 AND at > $2`,
      [courier.id, windowStart],
    );
    const used = Number(sends[0].n);
    if (used >= 5) {
      const oldest = sends[0].oldest!;
      const retryAfter = Math.max(1, Math.ceil((oldest.getTime() + deps.cfg.postcardMailWindowSeconds * 1000 - Date.now()) / 1000));
      throw Errors.mailLimit(retryAfter);
    }
    const { rows: freshCourier } = await tx2.query<CourierRow>(`SELECT * FROM couriers WHERE id=$1`, [courier.id]);
    const displayName = freshCourier[0].display_name;
    const shareUrl = `${base(deps.cfg)}/p/${rows[0].share_token}`;
    const sent = await deps.postOffice.sendPostcard(to, displayName, shareUrl);
    if (!sent) {
      // A slot whose mail failed is released before the 503 is returned.
      throw Errors.postOfficeClosed();
    }
    await tx2.query(`INSERT INTO mail_sends (courier_id, at) VALUES ($1, now())`, [courier.id]);
    return { status: 200, body: JSON.stringify({ status: "sent", sent_at: isoNow() }) };
  });
}

/** A failed mail slot is released: the window query counts only inserted rows. */
