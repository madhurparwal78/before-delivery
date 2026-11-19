import { Router, type Request, type Response } from "express";
import { q, q1 } from "../db.js";
import { err, asyncHandler } from "../http.js";
import { requireSession } from "../session.js";
import { apiMessages } from "../copy.js";
import { readJsonBody, asBody, assertDepth, assertOrigin } from "../request.js";
import { pieceOfDesk } from "./clients-pieces.js";
import { courierBook, courierLabel, courierQuote, ProviderError } from "../providers/third-party.js";
import { s3 } from "../providers/s3.js";
import { newToken, sha256 } from "../config.js";
import { fmtDateEn, isoZ, localTimeHM, townZone } from "../time.js";

export const collectionsRouter = Router({ mergeParams: true });

type CollectionRow = { id: string; state: string; collect_at: Date; local_date: string; local_time: string; town: string; label_sha256: string | null };

const collectionJson = (row: CollectionRow) => {
  const zone = townZone[row.town as "Turin"];
  const display = `${fmtDateEn(row.collect_at, zone)}, ${localTimeHM(row.collect_at, zone)} ${row.town} time`;
  return {
    id: row.id,
    state: row.state,
    collectAt: isoZ(row.collect_at),
    localDate: row.local_date,
    localTime: row.local_time,
    town: row.town,
    display,
    labelSha256: row.label_sha256,
  };
};

collectionsRouter.post("/quote", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  await readJsonBody(req);
  if (piece.width_cm === null || piece.depth_cm === null || piece.height_cm === null || piece.weight_kg === null) {
    throw err.state("F-78", apiMessages.needDimensions);
  }
  const client = piece.client_id ? await q1<{ town: string }>("SELECT town FROM clients WHERE id=$1 AND desk_id=$2", [piece.client_id, session.deskId]) : null;
  const toTown = client?.town ?? "Turin";
  const quote = await courierQuote("Turin", toTown, Number(piece.width_cm), Number(piece.depth_cm), Number(piece.height_cm), Number(piece.weight_kg));
  if (quote instanceof ProviderError) {
    if (quote.kind === "busy") throw err.limited(Math.ceil(quote.retryAfter ?? 60), apiMessages.courierBusy);
    throw err.unavailable(apiMessages.quoteFailed);
  }
  const { printAmount } = await import("../decimal.js");
  res.json({ quote: { quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, display: printAmount(quote.amount, quote.currency as never) } });
}));

collectionsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const rows = await q<CollectionRow>("SELECT id, state, collect_at, local_date, local_time, town, label_sha256 FROM collections WHERE piece_id=$1 ORDER BY collect_at", [piece.id]);
  res.json({ collections: rows.map(collectionJson) });
}));

collectionsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const quoteId = typeof body.quoteId === "string" ? body.quoteId : "";
  const localDate = typeof body.localDate === "string" ? body.localDate : "";
  const localTime = typeof body.localTime === "string" ? body.localTime : "";
  const fields: Record<string, string> = {};
  if (quoteId === "") fields.quoteId = apiMessages.fieldRequired;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) fields.localDate = apiMessages.date;
  if (!/^\d{2}:\d{2}$/.test(localTime)) fields.localTime = apiMessages.notATime;
  if (Object.keys(fields).length) throw err.field(fields);
  const client = piece.client_id ? await q1<{ town: string }>("SELECT town FROM clients WHERE id=$1 AND desk_id=$2", [piece.client_id, session.deskId]) : null;
  const town = client?.town ?? "Turin";
  const { wallTimeToInstant } = await import("../time.js");
  const at = wallTimeToInstant(townZone[town as "Turin"], localDate, localTime);
  if (!at) throw err.field({ localTime: apiMessages.timeMissing.replace("<time>", localTime).replace("<town>", town).replace("<date>", fmtDateEn(new Date(`${localDate}T12:00:00Z`), "UTC")) });

  const prior = await q1<CollectionRow>(
    "SELECT id, state, collect_at, local_date, local_time, town, label_sha256 FROM collections WHERE desk_id=$1 AND piece_id=$2 AND quote_id=$3", [session.deskId, piece.id, quoteId]
  );
  if (prior) {
    if (prior.local_date === localDate && prior.local_time === localTime) {
      res.status(200).json({ collection: collectionJson(prior) });
      return;
    }
    const display = `${fmtDateEn(prior.collect_at, townZone[prior.town as "Turin"])}, ${localTimeHM(prior.collect_at, townZone[prior.town as "Turin"])} ${prior.town} time`;
    throw err.state("F-79", apiMessages.alreadyBooked.replace("<collection time>", display));
  }

  const repeatKey = `${piece.id}:${quoteId}`;
  // File store first: with it down, no booking call goes to the courier.
  const probe = await s3.put(`labels/${session.deskId}/probe-${newToken(4)}.tmp`, Buffer.from(""));
  if (!probe) throw err.unavailable(apiMessages.courierFailed);
  const booking = await courierBook(quoteId, isoZ(at), town, repeatKey);
  if (booking instanceof ProviderError) {
    if (booking.kind === "busy") {
      if (booking.retryAfter && booking.retryAfter > 0) throw err.limited(Math.ceil(booking.retryAfter), apiMessages.courierBusy);
      throw err.state("F-74", apiMessages.slotTaken);
    }
    throw err.unavailable(apiMessages.courierFailed);
  }
  const label = await courierLabel(booking.labelPath);
  if (label instanceof ProviderError) throw err.unavailable(apiMessages.courierFailed);
  const key = `labels/${session.deskId}/${piece.id}/${booking.id}.pdf`;
  const stored = await s3.put(key, label, "application/pdf");
  if (!stored) throw err.unavailable(apiMessages.courierFailed);
  const id = booking.id;
  await q(
    "INSERT INTO collections (id, piece_id, desk_id, quote_id, collect_at, local_date, local_time, town, state, label_sha256, label_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'booked',$9,$10)",
    [id, piece.id, session.deskId, quoteId, at.toISOString(), localDate, localTime, town, sha256(label), label.length]
  );
  await q("INSERT INTO collection_calls (desk_id, piece_id, quote_id, collection_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [session.deskId, piece.id, quoteId, id]);
  const row = await q1<CollectionRow>("SELECT id, state, collect_at, local_date, local_time, town, label_sha256 FROM collections WHERE id=$1", [id]);
  res.status(201).json({ collection: collectionJson(row!) });
}));

collectionsRouter.get("/:collectionId/label", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const row = await q1<{ id: string }>("SELECT id FROM collections WHERE id=$1 AND piece_id=$2", [req.params.collectionId, piece.id]);
  if (!row) throw err.notFound();
  const bytes = await s3.get(`labels/${session.deskId}/${piece.id}/${row.id}.pdf`);
  if (!bytes) throw err.unavailable(apiMessages.storageDown);
  res.setHeader("Content-Type", "application/pdf");
  res.send(bytes);
}));
