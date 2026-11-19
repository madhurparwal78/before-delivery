import { one, query, tx } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { photographKey, storedPictureType } from "../domain/files.ts";
import type { Language } from "../domain/towns.ts";
import { dossierHtml } from "../pages/dossierHtml.ts";
import { ProviderDown } from "../providers/call.ts";
import { renderPdf } from "../providers/gotenberg.ts";
import { getObject, putObject } from "../providers/s3.ts";
import { every2s } from "./loop.ts";

interface PendingDossier {
  id: string;
  piece_id: string;
  estimate_id: string;
  signed_by: string | null;
  desk_id: string;
  desk_name: string;
  title: string;
  maker: string | null;
  year: string | null;
  stamp_number: string | null;
  client_name: string;
  language: Language;
}

export function dossierKey(deskId: string, pieceId: string, dossierId: string): string {
  return `dossiers/${deskId}/${pieceId}/${dossierId}.pdf`;
}

async function addHistory(pieceId: string, who: string, what: string): Promise<void> {
  await query("INSERT INTO dossier_history (piece_id, who, what) VALUES ($1, $2, $3)", [pieceId, who, what]);
}

async function latestPicture(dossier: PendingDossier, side: string): Promise<string | null> {
  const row = await one<{ sha256: string }>(
    "SELECT sha256 FROM photographs WHERE piece_id = $1 AND side = $2 AND state = 'stored' ORDER BY number DESC LIMIT 1",
    [dossier.piece_id, side],
  );
  if (!row) return null;
  const file = await getObject(photographKey(dossier.desk_id, dossier.piece_id, row.sha256));
  return `data:${storedPictureType(file)};base64,${file.toString("base64")}`;
}

async function pageHtml(dossier: PendingDossier): Promise<string> {
  const pins = await query<{ number: number; kind: string; note: string }>("SELECT number, kind, note FROM pins WHERE piece_id = $1 AND signed ORDER BY y_tenths, x_tenths", [dossier.piece_id]);
  const estimate = await one<{ code: string | null; name: string | null; lot: string | null }>(
    "SELECT material_code AS code, material_name AS name, lot FROM estimates WHERE id = $1",
    [dossier.estimate_id],
  );
  return dossierHtml({
    title: dossier.title,
    maker: dossier.maker,
    year: dossier.year,
    stamp: dossier.stamp_number,
    clientName: dossier.client_name,
    pins,
    material: estimate?.code ? { code: estimate.code, name: estimate.name, lot: estimate.lot } : null,
    before: await latestPicture(dossier, "before"),
    after: await latestPicture(dossier, "after"),
    language: dossier.language,
  });
}

async function fail(dossier: PendingDossier, message: string): Promise<void> {
  await query("UPDATE dossiers SET state = 'failed', message = $1 WHERE id = $2", [message, dossier.id]);
}

/** A seeded dossier arrives signed and only waits for its file; it is stored on the first pass the providers allow. */
async function finishSeeded(dossier: PendingDossier): Promise<void> {
  await tx(async (client) => {
    await client.query("UPDATE dossiers SET state = 'signed' WHERE id = $1", [dossier.id]);
    await client.query("UPDATE seed_files SET done_at = now() WHERE kind = 'dossier' AND ref = $1", [dossier.piece_id]);
  });
}

async function renderSeeded(dossier: PendingDossier): Promise<void> {
  try {
    const pdf = await renderPdf(await pageHtml(dossier));
    await putObject(dossierKey(dossier.desk_id, dossier.piece_id, dossier.id), pdf, "application/pdf");
    await finishSeeded(dossier);
  } catch (error) {
    if (!(error instanceof ProviderDown)) throw error;
  }
}

/** `waiting` → `rendering` → `stored`; any failure moves to `failed` with no object written. */
async function render(dossier: PendingDossier): Promise<void> {
  await query("UPDATE dossiers SET state = 'rendering' WHERE id = $1", [dossier.id]);
  let html: string;
  try {
    html = await pageHtml(dossier);
  } catch (error) {
    if (!(error instanceof ProviderDown)) throw error;
    return fail(dossier, copy("F-27"));
  }
  let pdf: Buffer;
  try {
    pdf = await renderPdf(html);
  } catch (error) {
    if (!(error instanceof ProviderDown)) throw error;
    return fail(dossier, copy("F-90"));
  }
  await addHistory(dossier.piece_id, dossier.desk_name, "rendered");
  try {
    await putObject(dossierKey(dossier.desk_id, dossier.piece_id, dossier.id), pdf, "application/pdf");
  } catch (error) {
    if (!(error instanceof ProviderDown)) throw error;
    return fail(dossier, copy("F-27"));
  }
  await tx(async (client) => {
    await client.query("UPDATE dossiers SET state = 'stored' WHERE id = $1", [dossier.id]);
    await client.query("INSERT INTO dossier_history (piece_id, who, what) VALUES ($1, $2, 'stored')", [dossier.piece_id, dossier.desk_name]);
  });
}

let running = false;
let askedAgain = false;

/** Rows hold the truth: a dossier left `rendering` by a restart is simply picked up again. */
async function renderPending(): Promise<void> {
  if (running) {
    askedAgain = true;
    return;
  }
  running = true;
  try {
    do {
      askedAgain = false;
      const pending = await query<PendingDossier>(
        `SELECT d.id, d.piece_id, d.estimate_id, d.signed_by, p.desk_id, k.name AS desk_name, p.title, p.maker, p.year, p.stamp_number,
                c.name AS client_name, c.language
         FROM dossiers d JOIN pieces p ON p.id = d.piece_id JOIN clients c ON c.id = p.client_id JOIN desks k ON k.id = p.desk_id
         WHERE d.state IN ('waiting', 'rendering') ORDER BY d.signed_by IS NOT NULL, d.created_at`,
      );
      for (const dossier of pending) await (dossier.signed_by ? renderSeeded(dossier) : render(dossier));
    } while (askedAgain);
  } finally {
    running = false;
  }
}

/** Starts a pass at once after a press, instead of on the next tick. */
export function renderSoon(): void {
  renderPending().catch((error: unknown) => console.error("dossier pass failed:", error instanceof Error ? error.message : error));
}

export function startDossierJob(): void {
  every2s("dossier", renderPending);
}
