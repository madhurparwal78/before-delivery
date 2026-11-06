import { newId } from "../config";
import { now } from "../clock";
import { pool, q, one, tx, type Db } from "../db";
import { lockName } from "../lockname";
import { ApiError, conflict, validation, fieldMsg } from "../errors";
import type { Ctx, Person, Studio } from "../http/context";
import { sendJson } from "../http/context";
import type { ChargeRow, PieceRow, LoadRow, KilnRow } from "../types";
import { loadBody, chargeBodyWithTitle } from "./bodies";
import { computeLoadFigures, figuresWithPlacement, figuresWithMove, footprintExceedsLimit } from "../loads";
import { feeCents } from "../quote";
import { loadTransitionRefusal, LOAD_STATUS_LABELS } from "../domain/loadstates";
import { publish } from "../events";
import { insertCharge, settleCharge } from "../billing/charges";
import { bodyHash, lookupStored, storeResponse, validateKey, withKeyLock } from "../billing/idempotency";
import { sendMail } from "../services/mailer";
import { addDays, dateOfInstant, formatScreenDate } from "../studiodays";

type MinTicket = { id: string; title: string; status: string; clay_body: string; length_in: number; width_in: number; height_in: number; photo_url: string | null; owner_handle: string; waiting_since: Date | null };

function minTicket(p: PieceRow): MinTicket {
  return { id: p.id, title: p.title, status: p.status, clay_body: "", length_in: p.length_in, width_in: p.width_in, height_in: p.height_in, photo_url: null, owner_handle: "", waiting_since: null };
}

function feeForFiring(piece: PieceRow, firing: "bisque" | "glaze"): number {
  return feeCents(piece.cubic_eighths, firing === "bisque" ? piece.bisque_rate_cents : piece.glaze_rate_cents);
}

async function loadForViewer(ctx: Ctx): Promise<LoadRow> {
  const studio = ctx.studio as Studio;
  const load = await one<LoadRow>(pool, "SELECT * FROM loads WHERE id = $1 AND studio_id = $2", [ctx.params.id, studio.id]);
  if (!load) throw new ApiError(404, "not_found", "Not found.");
  const person = ctx.person as Person;
  if (person.role === "member") throw new ApiError(403, "forbidden", "Only studio staff may do that.");
  return load;
}

async function kilnOf(load: LoadRow): Promise<KilnRow> {
  const kiln = await one<KilnRow>(pool, "SELECT * FROM kilns WHERE id = $1", [load.kiln_id]);
  if (!kiln) throw new ApiError(404, "not_found", "Not found.");
  return kiln;
}

type PlacedInput = { ticket: MinTicket; deck: number; position: number };

async function loadInputs(db: Db, loadId: string, firing: "bisque" | "glaze"): Promise<{ area: number; deckCount: number; placed: PlacedInput[]; pieceById: Map<string, PieceRow> }> {
  const load = await one<{ kiln_id: string }>(db, "SELECT kiln_id FROM loads WHERE id = $1", [loadId]);
  const kiln = await one<KilnRow>(db, "SELECT * FROM kilns WHERE id = $1", [load?.kiln_id ?? ""]);
  const deckCount = Number((await one<{ n: string }>(db, "SELECT COUNT(*) AS n FROM load_decks WHERE load_id = $1", [loadId]))?.n ?? 0);
  const rows = await q<{ id: string; deck: number; position: number }>(db, "SELECT piece_id AS id, deck, position FROM placements WHERE load_id = $1", [loadId]);
  const pieceById = new Map<string, PieceRow>();
  for (const r of rows) {
    const p = await one<PieceRow>(db, "SELECT * FROM pieces WHERE id = $1", [r.id]);
    if (p) pieceById.set(r.id, p);
  }
  const placed = rows.filter((r) => pieceById.has(r.id)).map((r) => ({ ticket: minTicket(pieceById.get(r.id) as PieceRow), deck: r.deck, position: r.position }));
  void firing;
  return { area: kiln?.shelf_area_sq_in ?? 380, deckCount, placed, pieceById };
}

function figures(area: number, deckCount: number, placed: PlacedInput[], firing: "bisque" | "glaze", pieceById: Map<string, PieceRow>) {
  return computeLoadFigures(area, deckCount, placed as never, (t: { id: string }) => {
    const piece = pieceById.get(t.id);
    return piece ? feeForFiring(piece, firing) : 0;
  });
}

export async function postLoad(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const kilnId = typeof ctx.body.kiln_id === "string" ? ctx.body.kiln_id : "";
  const firing = ctx.body.firing;
  const kiln = await one<KilnRow>(pool, "SELECT * FROM kilns WHERE studio_id = $1 AND id = $2", [studio.id, kilnId]);
  if (!kiln || (firing !== "bisque" && firing !== "glaze")) {
    throw validation({ kiln_id: fieldMsg.kilnFiring });
  }
  const load = await tx(async (client) => {
    const id = newId();
    const rows = await q<LoadRow>(client, "INSERT INTO loads (id, studio_id, kiln_id, firing, status, created_at) VALUES ($1,$2,$3,$4,'planning',$5) RETURNING *", [id, studio.id, kiln.id, firing, now()]);
    await client.query("INSERT INTO load_decks (load_id, number) VALUES ($1, 1)", [id]);
    return rows[0];
  });
  await publish(pool, "load", load.id, studio.id);
  sendJson(ctx.res, 201, await loadBody(pool, load.id));
}

export async function listLoads(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const openOnly = ctx.query.get("open") === "1";
  const rows = openOnly
    ? await q<{ id: string }>(pool, "SELECT id FROM loads WHERE studio_id = $1 AND status IN ('planning','loaded','firing','cooling') ORDER BY created_at DESC, id", [studio.id])
    : await q<{ id: string }>(pool, "SELECT id FROM loads WHERE studio_id = $1 ORDER BY created_at DESC, id", [studio.id]);
  const out = [];
  for (const r of rows) out.push(await loadBody(pool, r.id));
  sendJson(ctx.res, 200, out);
}

export async function getLoad(ctx: Ctx): Promise<void> {
  await loadForViewer(ctx);
  sendJson(ctx.res, 200, await loadBody(pool, ctx.params.id));
}

export async function addDeck(ctx: Ctx): Promise<void> {
  const load = await loadForViewer(ctx);
  const inputs = await loadInputs(pool, load.id, load.firing);
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.load(load.id)]);
    const fresh = await one<LoadRow>(client, "SELECT * FROM loads WHERE id = $1", [load.id]);
    if (!fresh || fresh.status !== "planning") throw conflict("load_not_planning", "This load is no longer being planned.");
    const would = figures(inputs.area, inputs.deckCount + 1, inputs.placed, load.firing, inputs.pieceById);
    if (would.headroom_in < 0) {
      throw conflict("exceeds_headroom", `Too tall for this stack: headroom would be ${would.headroom_in.toFixed(3)} in.`);
    }
    await client.query("INSERT INTO load_decks (load_id, number) VALUES ($1, $2)", [load.id, inputs.deckCount + 1]);
  });
  await publish(pool, "load", load.id, (ctx.studio as Studio).id);
  sendJson(ctx.res, 201, await loadBody(pool, load.id));
}

export async function removeDeck(ctx: Ctx): Promise<void> {
  const load = await loadForViewer(ctx);
  const deckParam = ctx.params.number;
  // Deck numbers are path ids: malformed or out-of-range numbers answer 404.
  const deckNumber = Number(deckParam);
  if (!/^\d+$/.test(deckParam) || !Number.isSafeInteger(deckNumber) || deckNumber < 1) {
    throw new ApiError(404, "not_found", "Not found.");
  }
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.load(load.id)]);
    const fresh = await one<LoadRow>(client, "SELECT * FROM loads WHERE id = $1", [load.id]);
    if (!fresh || fresh.status !== "planning") throw conflict("load_not_planning", "This load is no longer being planned.");
    const deck = await one<{ number: number }>(client, "SELECT number FROM load_decks WHERE load_id = $1 AND number = $2", [load.id, deckNumber]);
    if (!deck) throw new ApiError(404, "not_found", "Not found.");
    const maxDeck = Number((await one<{ n: string }>(client, "SELECT MAX(number) AS n FROM load_decks WHERE load_id = $1", [load.id]))?.n ?? 0);
    const hasPieces = await one<{ n: string }>(client, "SELECT COUNT(*) AS n FROM placements WHERE load_id = $1 AND deck = $2", [load.id, deckNumber]);
    if (Number(hasPieces?.n ?? 0) > 0 || deckNumber !== maxDeck) {
      throw conflict("deck_not_removable", "Only an empty top deck can be removed.");
    }
    await client.query("DELETE FROM load_decks WHERE load_id = $1 AND number = $2", [load.id, deckNumber]);
  });
  await publish(pool, "load", load.id, (ctx.studio as Studio).id);
  sendJson(ctx.res, 200, await loadBody(pool, load.id));
}

export async function postPlacement(ctx: Ctx): Promise<void> {
  const load = await loadForViewer(ctx);
  const kiln = await kilnOf(load);
  const pieceId = typeof ctx.body.piece_id === "string" ? ctx.body.piece_id : "";
  const piece = await one<PieceRow>(pool, "SELECT * FROM pieces WHERE id = $1 AND studio_id = $2", [pieceId, (ctx.studio as Studio).id]);
  if (!piece) throw new ApiError(404, "not_found", "Not found.");
  const deckRaw = ctx.body.deck;
  const outcome = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.load(load.id)]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.piece(piece.id)]);
    const freshLoad = await one<LoadRow>(client, "SELECT * FROM loads WHERE id = $1", [load.id]);
    if (!freshLoad || freshLoad.status !== "planning") {
      return { error: conflict("load_not_planning", "This load is no longer being planned.") };
    }
    const wanted = load.firing === "bisque" ? "waiting_bisque" : "waiting_glaze";
    if (piece.status !== wanted) {
      return { error: conflict("wrong_firing", `${piece.title} is waiting for a different firing.`) };
    }
    const inOpen = await one<{ n: string }>(
      client,
      `SELECT COUNT(*) AS n FROM placements pl JOIN loads l ON l.id = pl.load_id
        WHERE pl.piece_id = $1 AND l.status IN ('planning','loaded','firing','cooling')`,
      [piece.id],
    );
    if (Number(inOpen?.n ?? 0) > 0) {
      return { error: conflict("piece_taken", `Taken: ${piece.title} is already in another load.`) };
    }
    const deck = typeof deckRaw === "number" ? deckRaw : NaN;
    if (!Number.isInteger(deck)) return { error: validation({ deck: fieldMsg.deck }) };
    const deckRow = await one<{ number: number }>(client, "SELECT number FROM load_decks WHERE load_id = $1 AND number = $2", [load.id, deck]);
    if (!deckRow) return { error: validation({ deck: fieldMsg.deck }) };
    // Would-be figures with the piece appended to that deck.
    const deckCount = Number((await one<{ n: string }>(client, "SELECT COUNT(*) AS n FROM load_decks WHERE load_id = $1", [load.id]))?.n ?? 0);
    const rows = await q<{ id: string; deck: number; position: number }>(client, "SELECT piece_id AS id, deck, position FROM placements WHERE load_id = $1", [load.id]);
    const pieceById = new Map<string, PieceRow>();
    for (const r of rows) {
      const p = await one<PieceRow>(client, "SELECT * FROM pieces WHERE id = $1", [r.id]);
      if (p) pieceById.set(r.id, p);
    }
    const placed = rows.filter((r) => pieceById.has(r.id)).map((r) => ({ ticket: minTicket(pieceById.get(r.id) as PieceRow), deck: r.deck, position: r.position }));
    const would = figuresWithPlacement(kiln.shelf_area_sq_in, deckCount, placed as never, (t: { id: string }) => 0, minTicket(piece) as never, deck);
    if (would.headroom_in < 0) {
      return { error: conflict("exceeds_headroom", `Too tall for this stack: headroom would be ${would.headroom_in.toFixed(3)} in.`) };
    }
    const deckFigures = would.decks.find((d) => d.number === deck);
    if (deckFigures && footprintExceedsLimit(deckFigures.footprint_sq_in, kiln.shelf_area_sq_in)) {
      return { error: conflict("exceeds_footprint", `Deck ${deck} is full: footprint would be ${deckFigures.footprint_pct.toFixed(1)}%.`) };
    }
    const position = Number((await one<{ n: string }>(client, "SELECT COUNT(*) AS n FROM placements WHERE load_id = $1 AND deck = $2", [load.id, deck]))?.n ?? 0);
    await client.query("INSERT INTO placements (id, load_id, piece_id, deck, position, created_at) VALUES ($1,$2,$3,$4,$5,$6)", [newId(), load.id, piece.id, deck, position, now()]);
    return { error: null };
  });
  if (outcome.error) throw outcome.error;
  await publish(pool, "load", load.id, (ctx.studio as Studio).id);
  await publish(pool, "piece", piece.id, (ctx.studio as Studio).id, { memberId: piece.owner_id });
  sendJson(ctx.res, 201, await loadBody(pool, load.id));
}

export async function postMove(ctx: Ctx): Promise<void> {
  const load = await loadForViewer(ctx);
  const kiln = await kilnOf(load);
  const pieceId = typeof ctx.body.piece_id === "string" ? ctx.body.piece_id : "";
  const piece = await one<PieceRow>(pool, "SELECT * FROM pieces WHERE id = $1 AND studio_id = $2", [pieceId, (ctx.studio as Studio).id]);
  if (!piece) throw new ApiError(404, "not_found", "Not found.");
  const deckRaw = ctx.body.deck;
  const outcome = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.load(load.id)]);
    const freshLoad = await one<LoadRow>(client, "SELECT * FROM loads WHERE id = $1", [load.id]);
    if (!freshLoad || freshLoad.status !== "planning") {
      return { error: conflict("load_not_planning", "This load is no longer being planned.") };
    }
    const placement = await one<{ deck: number }>(client, "SELECT deck FROM placements WHERE load_id = $1 AND piece_id = $2", [load.id, piece.id]);
    if (!placement) return { error: new ApiError(404, "not_found", "Not found.") };
    const deck = typeof deckRaw === "number" ? deckRaw : NaN;
    if (!Number.isInteger(deck)) return { error: validation({ deck: fieldMsg.deck }) };
    const deckRow = await one<{ number: number }>(client, "SELECT number FROM load_decks WHERE load_id = $1 AND number = $2", [load.id, deck]);
    if (!deckRow) return { error: validation({ deck: fieldMsg.deck }) };
    if (placement.deck === deck) {
      // A move to the deck the piece already sits on answers 200 and changes nothing.
      return { error: null };
    }
    const deckCount = Number((await one<{ n: string }>(client, "SELECT COUNT(*) AS n FROM load_decks WHERE load_id = $1", [load.id]))?.n ?? 0);
    const rows = await q<{ id: string; deck: number; position: number }>(client, "SELECT piece_id AS id, deck, position FROM placements WHERE load_id = $1", [load.id]);
    const pieceById = new Map<string, PieceRow>();
    for (const r of rows) {
      const p = await one<PieceRow>(client, "SELECT * FROM pieces WHERE id = $1", [r.id]);
      if (p) pieceById.set(r.id, p);
    }
    const placed = rows.filter((r) => pieceById.has(r.id)).map((r) => ({ ticket: minTicket(pieceById.get(r.id) as PieceRow), deck: r.deck, position: r.position }));
    // Headroom and footprint are computed with the piece already removed from its old deck.
    const would = figuresWithMove(kiln.shelf_area_sq_in, deckCount, placed as never, (t: { id: string }) => 0, minTicket(piece) as never, deck);
    if (would.headroom_in < 0) {
      return { error: conflict("exceeds_headroom", `Too tall for this stack: headroom would be ${would.headroom_in.toFixed(3)} in.`) };
    }
    const deckFigures = would.decks.find((d) => d.number === deck);
    if (deckFigures && footprintExceedsLimit(deckFigures.footprint_sq_in, kiln.shelf_area_sq_in)) {
      return { error: conflict("exceeds_footprint", `Deck ${deck} is full: footprint would be ${deckFigures.footprint_pct.toFixed(1)}%.`) };
    }
    const position = Number((await one<{ n: string }>(client, "SELECT COUNT(*) AS n FROM placements WHERE load_id = $1 AND deck = $2", [load.id, deck]))?.n ?? 0);
    await client.query("UPDATE placements SET deck = $1, position = $2 WHERE load_id = $3 AND piece_id = $4", [deck, position, load.id, piece.id]);
    return { error: null };
  });
  if (outcome.error) throw outcome.error;
  await publish(pool, "load", load.id, (ctx.studio as Studio).id);
  sendJson(ctx.res, 200, await loadBody(pool, load.id));
}

export async function deletePlacement(ctx: Ctx): Promise<void> {
  const load = await loadForViewer(ctx);
  const pieceId = ctx.params.piece_id;
  const piece = await one<PieceRow>(pool, "SELECT * FROM pieces WHERE id = $1 AND studio_id = $2", [pieceId, (ctx.studio as Studio).id]);
  if (!piece) throw new ApiError(404, "not_found", "Not found.");
  const outcome = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.load(load.id)]);
    const freshLoad = await one<LoadRow>(client, "SELECT * FROM loads WHERE id = $1", [load.id]);
    if (!freshLoad || freshLoad.status !== "planning") {
      return { error: conflict("load_not_planning", "This load is no longer being planned.") };
    }
    const res = await client.query("DELETE FROM placements WHERE load_id = $1 AND piece_id = $2", [load.id, piece.id]);
    if (res.rowCount === 0) return { error: new ApiError(404, "not_found", "Not found.") };
    return { error: null };
  });
  if (outcome.error) throw outcome.error;
  await publish(pool, "load", load.id, (ctx.studio as Studio).id);
  await publish(pool, "piece", piece.id, (ctx.studio as Studio).id, { memberId: piece.owner_id });
  sendJson(ctx.res, 200, await loadBody(pool, load.id));
}

export async function postStatus(ctx: Ctx): Promise<void> {
  const load = await loadForViewer(ctx);
  const kiln = await kilnOf(load);
  const status = ctx.body.status;
  if (status !== "loaded" && status !== "firing" && status !== "cooling" && status !== "cancelled") {
    throw validation({ status: fieldMsg.loadStatus });
  }
  const released: string[] = [];
  const outcome = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.load(load.id)]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.kiln(kiln.id)]);
    const freshLoad = await one<LoadRow>(client, "SELECT * FROM loads WHERE id = $1", [load.id]);
    if (!freshLoad) return { error: new ApiError(404, "not_found", "Not found.") };
    const pieceCount = Number((await one<{ n: string }>(client, "SELECT COUNT(*) AS n FROM placements WHERE load_id = $1", [load.id]))?.n ?? 0);
    const busyRow = await one<{ n: string }>(
      client,
      "SELECT COUNT(*) AS n FROM loads WHERE kiln_id = $1 AND status IN ('loaded','firing','cooling') AND id <> $2",
      [kiln.id, load.id],
    );
    const refusal = loadTransitionRefusal(freshLoad.status, status, pieceCount, Number(busyRow?.n ?? 0) > 0);
    if (refusal) {
      if (refusal === "illegal_transition") {
        return { error: conflict("illegal_transition", `Load can't move from ${LOAD_STATUS_LABELS[freshLoad.status]} to ${LOAD_STATUS_LABELS[status]}.`) };
      }
      if (refusal === "empty_load") return { error: conflict("empty_load", "Place at least one piece first.") };
      return { error: conflict("kiln_busy", `${kiln.name} already has a load in it.`) };
    }
    if (status === "cancelled") {
      // Cancel releases every piece the load holds, even when placements race it.
      const placed = await q<{ id: string; owner_id: string }>(
        client,
        "SELECT p.id, p.owner_id FROM placements pl JOIN pieces p ON p.id = pl.piece_id WHERE pl.load_id = $1",
        [load.id],
      );
      for (const p of placed) {
        const backTo = load.firing === "bisque" ? "waiting_bisque" : "waiting_glaze";
        await client.query("DELETE FROM placements WHERE load_id = $1 AND piece_id = $2", [load.id, p.id]);
        await client.query("UPDATE pieces SET status = $1, waiting_since = $2 WHERE id = $3", [backTo, now(), p.id]);
        await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,$3,$4)", [newId(), p.id, backTo, now()]);
        released.push(p.id);
      }
    }
    await client.query("UPDATE loads SET status = $1 WHERE id = $2", [status, load.id]);
    return { error: null };
  });
  if (outcome.error) throw outcome.error;
  for (const pieceId of released) {
    const piece = await one<PieceRow>(pool, "SELECT * FROM pieces WHERE id = $1", [pieceId]);
    await publish(pool, "piece", pieceId, (ctx.studio as Studio).id, { memberId: piece?.owner_id });
  }
  await publish(pool, "load", load.id, (ctx.studio as Studio).id);
  sendJson(ctx.res, 200, await loadBody(pool, load.id));
}

export async function postUnload(ctx: Ctx): Promise<void> {
  const load = await loadForViewer(ctx);
  const studio = ctx.studio as Studio;
  const keyHeader = ctx.req.headers["idempotency-key"];
  validateKey(typeof keyHeader === "string" ? keyHeader : undefined);
  const idemKey = keyHeader as string;
  const hash = bodyHash(ctx.body);
  const result = await withKeyLock(studio.id, "unload", idemKey, async () => {
    const stored = await lookupStored(studio.id, "unload", idemKey, hash);
    if (stored) return { status: stored.status, body: stored.body };
    try {
      return { status: 200, body: await unloadNow(ctx, load, studio, idemKey, hash) };
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        const text = JSON.stringify({ error: e.code, message: e.message });
        await storeResponse(pool, studio.id, "unload", idemKey, hash, e.status, text);
      }
      throw e;
    }
  });
  sendJson(ctx.res, result.status, JSON.parse(result.body));
}

async function unloadNow(ctx: Ctx, load: LoadRow, studio: Studio, idemKey: string, hash: string): Promise<string> {
  const outcomesRaw = ctx.body.outcomes;
  const freshLoad = await one<LoadRow>(pool, "SELECT * FROM loads WHERE id = $1", [load.id]);
  if (!freshLoad) throw new ApiError(404, "not_found", "Not found.");
  const rows = await q<{ id: string; deck: number; position: number }>(pool, "SELECT piece_id AS id, deck, position FROM placements WHERE load_id = $1", [load.id]);
  const pieces = new Map<string, PieceRow>();
  for (const r of rows) {
    const p = await one<PieceRow>(pool, "SELECT * FROM pieces WHERE id = $1", [r.id]);
    if (p) pieces.set(r.id, p);
  }
  const ids = new Set(rows.map((r) => r.id));
  const outcomesOk =
    typeof outcomesRaw === "object" && outcomesRaw !== null && !Array.isArray(outcomesRaw) &&
    Object.keys(outcomesRaw).length === ids.size &&
    Object.entries(outcomesRaw).every(([pid, val]) => ids.has(pid) && (val === "intact" || val === "cracked" || val === "damaged"));
  if (!outcomesOk) throw validation({ outcomes: fieldMsg.outcomes });
  const outcomes = outcomesRaw as Record<string, "intact" | "cracked" | "damaged">;
  const unloadedAt = now();
  const createdCharges: ChargeRow[] = [];
  const glazeDeadline = addDays(dateOfInstant(unloadedAt.getTime(), studio.time_zone), studio.pickup_window_days);
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.load(load.id)]);
    const reloaded = await one<LoadRow>(client, "SELECT * FROM loads WHERE id = $1", [load.id]);
    if (!reloaded || reloaded.status !== "cooling") {
      throw conflict("illegal_transition", "This load can't be unloaded now.");
    }
    for (const row of [...rows].sort((a, b) => a.deck - b.deck || a.position - b.position)) {
      const piece = pieces.get(row.id);
      if (!piece) continue;
      const outcome = outcomes[row.id];
      const firingKey = load.firing === "bisque" ? "bisque_outcome" : "glaze_outcome";
      await client.query(`UPDATE pieces SET ${firingKey} = $1 WHERE id = $2`, [outcome, piece.id]);
      if (load.firing === "bisque") {
        await client.query("UPDATE pieces SET status = 'bisqued' WHERE id = $1", [piece.id]);
        await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'bisqued',$3)", [newId(), piece.id, unloadedAt]);
      } else {
        // A glaze unload moves waiting_glaze → glazed → ready_for_pickup in one step,
        // and the history records both.
        await client.query("UPDATE pieces SET status = 'ready_for_pickup', pickup_deadline = $1 WHERE id = $2", [glazeDeadline, piece.id]);
        await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'glazed',$3)", [newId(), piece.id, unloadedAt]);
        await client.query("INSERT INTO piece_history (id, piece_id, status, at) VALUES ($1,$2,'ready_for_pickup',$3)", [newId(), piece.id, unloadedAt]);
      }
      if (outcome !== "damaged") {
        const charge = await insertCharge(client, {
          studioId: studio.id,
          memberId: piece.owner_id,
          pieceId: piece.id,
          firing: load.firing,
          cubicEighths: piece.cubic_eighths,
          rateCents: load.firing === "bisque" ? piece.bisque_rate_cents : piece.glaze_rate_cents,
          feeCents: feeForFiring(piece, load.firing),
          at: unloadedAt,
        });
        if (charge) createdCharges.push(charge);
      }
    }
    await client.query("UPDATE loads SET status = 'unloaded', unloaded_at = $1 WHERE id = $2", [unloadedAt, load.id]);
  });

  for (const row of rows) {
    const piece = pieces.get(row.id);
    await publish(pool, "piece", row.id, studio.id, { memberId: piece?.owner_id });
  }
  await publish(pool, "load", load.id, studio.id);
  for (const c of createdCharges) await publish(pool, "charge", c.id, studio.id, { memberId: c.member_id });

  // Settle in deck order and then placement order, on the request path.
  const ordered = [...rows]
    .sort((a, b) => a.deck - b.deck || a.position - b.position)
    .map((r) => createdCharges.find((c) => c.piece_id === r.id))
    .filter((c): c is ChargeRow => c !== undefined);
  for (const charge of ordered) {
    const outcome = await settleCharge(charge, 5000);
    if (outcome === "pending") break; // that charge and every later one stay pending
  }
  const finalCharges = [];
  for (const c of createdCharges) {
    const fresh = await one<ChargeRow>(pool, "SELECT * FROM charges WHERE id = $1", [c.id]);
    if (fresh) finalCharges.push(await chargeBodyWithTitle(pool, fresh));
  }
  const body = { load: await loadBody(pool, load.id), charges: finalCharges };
  const bodyText = JSON.stringify(body);
  await storeResponse(pool, studio.id, "unload", idemKey, hash, 200, bodyText);

  // Ready-for-pickup emails, one per member per glaze unload, within 10 seconds.
  if (load.firing === "glaze") {
    void sendReadyEmails(load.id, studio, glazeDeadline, pieces);
  }
  return bodyText;
}

async function sendReadyEmails(loadId: string, studio: Studio, deadline: string, pieces: Map<string, PieceRow>): Promise<void> {
  const byMember = new Map<string, { email: string; titles: string[] }>();
  for (const piece of pieces.values()) {
    const owner = await one<{ email: string }>(pool, "SELECT email FROM people WHERE id = $1", [piece.owner_id]);
    if (!owner) continue;
    const entry = byMember.get(piece.owner_id) ?? { email: owner.email, titles: [] };
    entry.titles.push(piece.title);
    byMember.set(piece.owner_id, entry);
  }
  for (const [memberId, entry] of byMember) {
    const claimed = await tx(async (client) => {
      const res = await client.query("INSERT INTO sent_ready_emails (load_id, member_id, sent_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [loadId, memberId, now()]);
      return res.rowCount === 1;
    });
    if (!claimed) continue;
    await sendMail(entry.email, `Ready for pickup at ${studio.name}`, `${studio.name}\n${entry.titles.join("\n")}\nCollect by ${formatScreenDate(deadline)}\n`).catch(() => {});
  }
}
