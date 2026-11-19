import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { one, query, tx } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { foldName } from "../domain/folding.ts";
import { instant, minuteCopy, wholeSecond } from "../domain/time.ts";
import { conflict, invalid, notFound, tooMany, unavailable } from "../http/errors.ts";
import { bytes, type Ctx, json, route } from "../http/router.ts";
import { dossierKey, renderSoon } from "../jobs/dossier.ts";
import { ProviderDown } from "../providers/call.ts";
import { getObject } from "../providers/s3.ts";
import { latestSignedOff } from "./estimates.ts";
import { bodyOf, countInWindow, requiredText } from "./fields.ts";
import { pieceOf, pieceResource } from "./resources.ts";

const DOWNLOAD_LIMIT = 5;

interface DossierRow {
  id: string;
  piece_id: string;
  state: string;
  message: string | null;
  signed_by: string | null;
  signed_at: Date | null;
}

async function latestDossier(pieceId: string): Promise<DossierRow | null> {
  return one<DossierRow>("SELECT * FROM dossiers WHERE piece_id = $1 ORDER BY created_at DESC, id LIMIT 1", [pieceId]);
}

async function dossierBody(row: DossierRow) {
  const history = await query<{ at: Date; who: string; what: string }>("SELECT at, who, what FROM dossier_history WHERE piece_id = $1 ORDER BY id", [row.piece_id]);
  return {
    dossier: {
      id: row.id,
      state: row.state,
      message: row.message,
      signedBy: row.signed_by,
      signedAt: row.signed_at ? instant(row.signed_at) : null,
      history: history.map((entry) => ({ at: instant(entry.at), who: entry.who, what: entry.what })),
    },
  };
}

function isSigned(row: DossierRow | null): boolean {
  return row?.signed_by != null;
}

/** Each download request of a live session counts; a request with no session has no desk to count. */
async function downloadRate(ctx: Ctx): Promise<void> {
  if (!ctx.session) return;
  const until = await countInWindow(`download:${ctx.deskId}`, DOWNLOAD_LIMIT, config.fileRateWindowSeconds);
  if (until) throw tooMany("tooManyDownloads", copy("F-91", { minute: minuteCopy(until) }), until);
}

async function askForDossier(ctx: Ctx, who: string): Promise<DossierRow> {
  const piece = pieceOf(ctx);
  return tx(async (client) => {
    await client.query("SELECT id FROM pieces WHERE id = $1 FOR UPDATE", [piece.id]);
    const latest = await one<DossierRow>("SELECT * FROM dossiers WHERE piece_id = $1 ORDER BY created_at DESC, id LIMIT 1", [piece.id], client);
    if (isSigned(latest)) throw conflict("dossierSigned", copy("F-96"));
    const estimate = await latestSignedOff(piece.id, client);
    if (!estimate) throw conflict("noSignedEstimate", copy("F-92"));
    if (latest && ["waiting", "rendering"].includes(latest.state)) return latest;
    const [row] = await query<DossierRow>("INSERT INTO dossiers (id, piece_id, estimate_id, state) VALUES ($1, $2, $3, 'waiting') RETURNING *", [randomUUID(), piece.id, estimate.id], client);
    await client.query("INSERT INTO dossier_history (piece_id, who, what) VALUES ($1, $2, 'asked')", [piece.id, who]);
    return row as DossierRow;
  });
}

export function register(): void {
  route({
    method: "POST",
    pattern: "/api/pieces/:id/dossier",
    resource: pieceResource,
    handle: async (ctx) => {
      const row = await askForDossier(ctx, ctx.session?.name as string);
      renderSoon();
      return json(202, await dossierBody(row));
    },
  });

  route({
    method: "GET",
    pattern: "/api/pieces/:id/dossier",
    resource: pieceResource,
    handle: async (ctx) => {
      const row = await latestDossier(pieceOf(ctx).id);
      if (!row) throw notFound();
      return json(200, await dossierBody(row));
    },
  });

  route({
    method: "GET",
    pattern: "/api/pieces/:id/dossier/pdf",
    rate: downloadRate,
    resource: pieceResource,
    handle: async (ctx) => {
      const piece = pieceOf(ctx);
      const row = await latestDossier(piece.id);
      if (!row || !["stored", "signed"].includes(row.state)) throw conflict("dossierNotStored", copy("F-97"));
      try {
        return bytes(200, "application/pdf", await getObject(dossierKey(ctx.deskId, piece.id, row.id)), { "Content-Disposition": 'attachment; filename="dossier.pdf"' });
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("fileStoreUnavailable", copy("F-27"));
        throw error;
      }
    },
  });

  route({
    method: "POST",
    pattern: "/api/pieces/:id/dossier/sign",
    resource: pieceResource,
    handle: async (ctx) => {
      const piece = pieceOf(ctx);
      const name = ctx.session?.name as string;
      const typed = requiredText(bodyOf(ctx), "typedName", 120);
      if (foldName(typed) !== foldName(name)) throw invalid("typedName", copy("F-95"), "nameRefused");
      const signed = await tx(async (client) => {
        await client.query("SELECT id FROM pieces WHERE id = $1 FOR UPDATE", [piece.id]);
        const latest = await one<DossierRow>("SELECT * FROM dossiers WHERE piece_id = $1 ORDER BY created_at DESC, id LIMIT 1", [piece.id], client);
        if (isSigned(latest)) throw conflict("dossierSigned", copy("F-96"));
        if (latest?.state !== "stored") throw conflict("dossierNotStored", copy("F-97"));
        const [row] = await query<DossierRow>("UPDATE dossiers SET state = 'signed', signed_by = $1, signed_at = $2 WHERE id = $3 RETURNING *", [name, wholeSecond(), latest.id], client);
        await client.query("INSERT INTO dossier_history (piece_id, who, what) VALUES ($1, $2, 'signed')", [piece.id, name]);
        return row as DossierRow;
      });
      return json(200, await dossierBody(signed));
    },
  });
}
