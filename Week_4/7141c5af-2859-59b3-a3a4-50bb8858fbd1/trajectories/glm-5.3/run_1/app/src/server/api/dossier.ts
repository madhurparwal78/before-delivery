import { Router, type Request, type Response } from "express";
import { q, q1 } from "../db.js";
import { err, asyncHandler } from "../http.js";
import { requireSession } from "../session.js";
import { apiMessages } from "../copy.js";
import { readJsonBody, asBody, assertDepth, assertOrigin, countAndLimit, bumpCount } from "../request.js";
import { pieceOfDesk } from "./clients-pieces.js";
import { config, newToken } from "../config.js";
import { isoZ, fmtDateTimeTurin, fmtMinuteTurin } from "../time.js";
import { renderDossierPdf } from "../dossier-pdf.js";
import { s3 } from "../providers/s3.js";
import { toCsv } from "../csv.js";
import { renderNoteText } from "../markup.js";

export const dossierRouter = Router({ mergeParams: true });

const dossierJson = (row: { id: string; piece_id: string; state: string; message: string | null; signed_by: string | null; signed_at: Date | null; history: { at: string; who: string; what: string }[] }) => ({
  id: row.id,
  pieceId: row.piece_id,
  state: row.state,
  message: row.message,
  signedBy: row.signed_by,
  signedAt: row.signed_at ? isoZ(row.signed_at) : null,
  history: row.history,
});

const downloadMessage = (retry: number) => apiMessages.downloadLimited.replace("<minute>", fmtMinuteTurin(new Date(Date.now() + retry * 1000)));

dossierRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  await readJsonBody(req);
  const signedOff = await q1<{ id: string }>(
    "SELECT id FROM estimates WHERE piece_id=$1 AND state='signedOff' ORDER BY version DESC LIMIT 1", [piece.id]
  );
  if (!signedOff) throw err.state("F-92", apiMessages.noSignedOffEstimate);
  const existing = await q1<{ id: string; state: string }>("SELECT id, state FROM dossiers WHERE piece_id=$1 ORDER BY created_at DESC LIMIT 1", [piece.id]);
  if (existing && (existing.state === "stored" || existing.state === "signed")) throw err.state("F-96", apiMessages.signedDossierFixed);
  const id = newToken(8);
  const history = [{ at: isoZ(new Date()), who: session.name, what: "asked" }];
  await q("INSERT INTO dossiers (id, piece_id, desk_id, state, history) VALUES ($1,$2,$3,'waiting',$4)", [
    id, piece.id, session.deskId, JSON.stringify(history),
  ]);
  const row = await q1<{ id: string; piece_id: string; state: string; message: string | null; signed_by: string | null; signed_at: Date | null; history: { at: string; who: string; what: string }[] }>(
    "SELECT id, piece_id, state, message, signed_by, signed_at, history FROM dossiers WHERE id=$1", [id]
  );
  res.status(202).json({ dossier: dossierJson(row!) });
  // Render and store asynchronously; the screen polls and the sweep advances the state.
  void renderAndStore(session.deskId, piece.id, id).catch(() => undefined);
}));

export async function renderAndStore(deskId: string, pieceId: string, dossierId: string): Promise<void> {
  const row = await q1<{ state: string }>("SELECT state FROM dossiers WHERE id=$1", [dossierId]);
  if (!row || row.state !== "waiting") return;
  await q("UPDATE dossiers SET state='rendering' WHERE id=$1 AND state='waiting'", [dossierId]);
  await appendHistory(dossierId, "rendered");
  const pdf = await renderDossierPdf(deskId, pieceId);
  if (!pdf) {
    await q("UPDATE dossiers SET state='failed', message=$1 WHERE id=$2", [apiMessages.pdfDown, dossierId]);
    return;
  }
  const key = `dossiers/${deskId}/${pieceId}/${dossierId}.pdf`;
  const stored = await s3.put(key, pdf, "application/pdf");
  if (!stored) {
    await q("UPDATE dossiers SET state='failed', message=$1 WHERE id=$2", [apiMessages.storageDown, dossierId]);
    return;
  }
  await q("UPDATE dossiers SET state='stored', message=NULL WHERE id=$1", [dossierId]);
  await appendHistory(dossierId, "stored");
}

async function appendHistory(dossierId: string, what: string): Promise<void> {
  const row = await q1<{ history: { at: string; who: string; what: string }[] }>("SELECT history FROM dossiers WHERE id=$1", [dossierId]);
  if (!row) return;
  const history = [...(row.history ?? []), { at: isoZ(new Date()), who: "Agnese Ferrero", what }];
  await q("UPDATE dossiers SET history=$1 WHERE id=$2", [JSON.stringify(history), dossierId]);
}

dossierRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const row = await q1<{ id: string; piece_id: string; state: string; message: string | null; signed_by: string | null; signed_at: Date | null; history: { at: string; who: string; what: string }[] }>(
    "SELECT id, piece_id, state, message, signed_by, signed_at, history FROM dossiers WHERE piece_id=$1 ORDER BY created_at DESC LIMIT 1", [piece.id]
  );
  if (!row) throw err.notFound();
  res.json({ dossier: dossierJson(row) });
}));

dossierRouter.get("/pdf", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const row = await q1<{ id: string; state: string }>("SELECT id, state FROM dossiers WHERE piece_id=$1 ORDER BY created_at DESC LIMIT 1", [piece.id]);
  if (!row || (row.state !== "stored" && row.state !== "signed")) throw err.state("F-97", apiMessages.dossierNotStored);
  await countAndLimit(session.deskId, "download_counts", "desk_id", config.timers.fileWindow, 5, downloadMessage);
  await bumpCount("download_counts", "desk_id", session.deskId, config.timers.fileWindow);
  const bytes = await s3.get(`dossiers/${session.deskId}/${piece.id}/${row.id}.pdf`);
  if (!bytes) throw err.unavailable(apiMessages.storageDown);
  res.setHeader("Content-Type", "application/pdf");
  res.send(bytes);
}));

dossierRouter.post("/sign", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const typedName = typeof body.typedName === "string" ? body.typedName : "";
  const { nameMatches } = await import("../stamps.js");
  if (typedName.trim() === "" || !nameMatches(typedName, session.name)) {
    throw err.field({ typedName: apiMessages.nameMismatch });
  }
  const row = await q1<{ id: string; state: string; history: { at: string; who: string; what: string }[] }>(
    "SELECT id, state, history FROM dossiers WHERE piece_id=$1 ORDER BY created_at DESC LIMIT 1", [piece.id]
  );
  if (!row) throw err.state("F-97", apiMessages.dossierNotStored);
  if (row.state === "signed") throw err.state("F-96", apiMessages.signedDossierFixed);
  if (row.state !== "stored") throw err.state("F-97", apiMessages.dossierNotStored);
  const at = isoZ(new Date());
  await q("UPDATE dossiers SET state='signed', signed_by=$1, signed_at=$2 WHERE id=$3", [typedName, new Date().toISOString(), row.id]);
  await appendHistory(row.id, "signed");
  const updated = await q1<{ id: string; piece_id: string; state: string; message: string | null; signed_by: string | null; signed_at: Date | null; history: { at: string; who: string; what: string }[] }>(
    "SELECT id, piece_id, state, message, signed_by, signed_at, history FROM dossiers WHERE id=$1", [row.id]
  );
  void fmtDateTimeTurin;
  void renderNoteText;
  void toCsv;
  res.json({ dossier: dossierJson(updated!) });
}));
