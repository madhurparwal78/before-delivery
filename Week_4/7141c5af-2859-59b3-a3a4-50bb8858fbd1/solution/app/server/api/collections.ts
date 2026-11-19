import { createHash, randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { query, tx } from "../db/pool.ts";
import { labelKey } from "../domain/files.ts";
import { copy } from "../domain/copy.ts";
import { type Currency, minorOfPrice, printAmount } from "../domain/money.ts";
import { TOWNS, type Town } from "../domain/towns.ts";
import { dateCopy, instant, timeCopy, wallInstant, wholeSecond } from "../domain/time.ts";
import { conflict, invalid, notFound, unavailable } from "../http/errors.ts";
import { bytes, type Ctx, json, route } from "../http/router.ts";
import { call, ProviderDown } from "../providers/call.ts";
import { askQuote, bookCollection, fetchLabel, readCollection } from "../providers/courier.ts";
import { getObject, putObject } from "../providers/s3.ts";
import { bodyOf, dateField, requiredText, timeField } from "./fields.ts";
import { pieceOf, pieceResource } from "./resources.ts";

const STATE_READ_SECONDS = 30;
const COURIER_STATES = ["booked", "collected", "delivered"];
const ORIGIN_TOWN = "Turin";

interface CollectionRow {
  id: string;
  piece_id: string;
  quote_id: string;
  repeat_key: string;
  courier_id: string | null;
  state: string;
  collect_at: Date;
  local_date: string;
  local_time: string;
  town: Town;
  label_sha256: string | null;
}

function collectionTime(row: Pick<CollectionRow, "local_date" | "local_time" | "town">): string {
  return `${dateCopy(row.local_date)}, ${row.local_time} ${row.town} time`;
}

function collectionBody(row: CollectionRow) {
  const head = collectionTime(row);
  return {
    id: row.id,
    state: row.state,
    collectAt: instant(row.collect_at),
    localDate: row.local_date,
    localTime: row.local_time,
    town: row.town,
    display: row.town === "Turin" ? head : `${head} · ${timeCopy(row.collect_at)} Turin time`,
    labelSha256: row.label_sha256,
  };
}

/** The repeat key is derived from the piece and quote, so every attempt at this booking carries the same one. */
function repeatKey(pieceId: string, quoteId: string): string {
  return createHash("sha256").update(`collection:${pieceId}:${quoteId}`).digest("hex");
}

/** The courier's state, read when the screen asks and at most once per 30 seconds; a failed read keeps the last one. */
async function refreshState(row: CollectionRow): Promise<CollectionRow> {
  if (!row.courier_id || row.state === "waiting") return row;
  const claimed = await query(
    `UPDATE collections SET state_read_at = now()
     WHERE id = $1 AND (state_read_at IS NULL OR state_read_at <= now() - make_interval(secs => $2)) RETURNING id`,
    [row.id, STATE_READ_SECONDS],
  );
  if (claimed.length === 0) return row;
  try {
    const { state } = await readCollection(row.courier_id);
    if (!COURIER_STATES.includes(state) || state === row.state) return row;
    await query("UPDATE collections SET state = $1 WHERE id = $2", [state, row.id]);
    return { ...row, state };
  } catch {
    return row;
  }
}

function dimensions(ctx: Ctx) {
  const piece = pieceOf(ctx);
  const { width_cm: width, depth_cm: depth, height_cm: height, weight_kg: weight } = piece;
  if (width === null || depth === null || height === null || weight === null) throw conflict("needsDimensions", copy("F-78"));
  return { widthCm: Number(width), depthCm: Number(depth), heightCm: Number(height), weightKg: Number(weight) };
}

/** The file store is checked first: with it down no booking call goes to the courier. */
async function checkFileStore(): Promise<void> {
  await call(config.s3.endpoint);
}

async function book(ctx: Ctx, quoteId: string, localDate: string, localTime: string, collectAt: Date) {
  const piece = pieceOf(ctx);
  const town = piece.client_town;
  const key = repeatKey(piece.id, quoteId);
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
    const [held] = await query<CollectionRow>("SELECT * FROM collections WHERE piece_id = $1 AND repeat_key = $2", [piece.id, key], client);
    if (held) {
      if (held.local_date === localDate && held.local_time === localTime) return json(200, { collection: collectionBody(held) });
      throw conflict("alreadyBooked", copy("F-79", { "collection time": collectionTime(held) }));
    }
    try {
      await checkFileStore();
      const booked = await bookCollection({ quoteId, collectAt: instant(collectAt), town }, key);
      if (!booked) throw conflict("slotTaken", copy("F-74", { time: timeCopy(new Date()) }));
      const label = await fetchLabel(booked.labelPath);
      const id = randomUUID();
      await putObject(labelKey(ctx.deskId, piece.id, id), label, "application/pdf");
      const [row] = await query<CollectionRow>(
        `INSERT INTO collections (id, piece_id, quote_id, repeat_key, courier_id, state, collect_at, local_date, local_time, town, label_sha256, state_read_at)
         VALUES ($1, $2, $3, $4, $5, 'booked', $6, $7, $8, $9, $10, now()) RETURNING *`,
        [id, piece.id, quoteId, key, booked.id, collectAt, localDate, localTime, town, createHash("sha256").update(label).digest("hex")],
        client,
      );
      return json(201, { collection: collectionBody(row as CollectionRow) });
    } catch (error) {
      if (error instanceof ProviderDown) throw unavailable("courierUnavailable", copy("F-72"));
      throw error;
    }
  });
}

export function register(): void {
  route({
    method: "POST",
    pattern: "/api/pieces/:id/collections/quote",
    resource: pieceResource,
    handle: async (ctx) => {
      const size = dimensions(ctx);
      try {
        const quote = await askQuote({ fromTown: ORIGIN_TOWN, toTown: pieceOf(ctx).client_town, ...size });
        const currency = quote.currency as Currency;
        return json(200, { quote: { ...quote, display: printAmount(minorOfPrice(quote.amount, currency), currency) } });
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("quoteUnavailable", copy("F-77"));
        throw error;
      }
    },
  });

  route({
    method: "GET",
    pattern: "/api/pieces/:id/collections",
    resource: pieceResource,
    handle: async (ctx) => {
      const rows = await query<CollectionRow>("SELECT * FROM collections WHERE piece_id = $1 ORDER BY collect_at, id", [pieceOf(ctx).id]);
      const collections = await Promise.all(rows.map(refreshState));
      return json(200, { collections: collections.map(collectionBody) });
    },
  });

  route({
    method: "POST",
    pattern: "/api/pieces/:id/collections",
    resource: pieceResource,
    handle: async (ctx) => {
      const body = bodyOf(ctx);
      const quoteId = requiredText(body, "quoteId", 200);
      const localDate = dateField(body, "localDate");
      const localTime = timeField(body, "localTime");
      const town = pieceOf(ctx).client_town;
      const collectAt = wallInstant(localDate, localTime, TOWNS[town].zone);
      if (!collectAt) throw invalid("localTime", copy("F-68", { time: localTime, town, date: dateCopy(localDate) }));
      return book(ctx, quoteId, localDate, localTime, wholeSecond(collectAt));
    },
  });

  route({
    method: "GET",
    pattern: "/api/pieces/:id/collections/:collectionId/label",
    resource: pieceResource,
    handle: async (ctx) => {
      const [row] = await query<CollectionRow>("SELECT * FROM collections WHERE id = $1 AND piece_id = $2", [ctx.params.collectionId, pieceOf(ctx).id]);
      if (!row) throw notFound();
      if (row.state === "waiting") throw unavailable("fileStoreUnavailable", copy("F-27"));
      try {
        return bytes(200, "application/pdf", await getObject(labelKey(ctx.deskId, row.piece_id, row.id)));
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("fileStoreUnavailable", copy("F-27"));
        throw error;
      }
    },
  });
}
