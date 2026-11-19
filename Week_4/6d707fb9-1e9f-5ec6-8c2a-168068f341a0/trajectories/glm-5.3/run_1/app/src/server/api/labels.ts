import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { newId } from "../engine/ids.js";
import { instantOf, addSeconds } from "../engine/time.js";
import { requireDesk } from "../app.js";
import {
  errConflict,
  errNotFound,
  errValidation,
} from "./errors.js";
import { COPY } from "../engine/copy.js";
import { one, rows } from "../db/pool.js";
import { checkGtin } from "../engine/rules.js";
import { fold } from "../engine/fold.js";

export interface LabelRecord {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  state: string;
  closedAt: string | null;
  eraseAt: string | null;
}

export function labelOut(r: {
  id: string; name: string; contact_name: string; contact_email: string; state: string; closed_at: string | null; erase_at: string | null;
}): LabelRecord {
  return {
    id: r.id,
    name: r.name,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    state: r.state,
    closedAt: r.closed_at,
    eraseAt: r.erase_at,
  };
}

/** A label of this desk, or 404 exactly like an unknown id. */
export async function labelOfDesk(deskId: string, labelId: string): Promise<{
  id: string; desk_id: string; name: string; contact_name: string; contact_email: string; state: string;
  closed_at: string | null; erase_at: string | null;
}> {
  const r = await one<{
    id: string; desk_id: string; name: string; contact_name: string; contact_email: string; state: string;
    closed_at: string | null; erase_at: string | null;
  }>(`SELECT id, desk_id, name, contact_name, contact_email, state, closed_at, erase_at FROM labels WHERE id = $1`, [labelId]);
  if (!r || r.desk_id !== deskId) throw errNotFound();
  return r;
}

export function registerLabelRoutes(app: FastifyInstance): void {
  app.get("/api/labels", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const list = await rows<{ id: string; name: string; contact_name: string; contact_email: string; state: string; closed_at: string | null; erase_at: string | null }>(
      `SELECT id, name, contact_name, contact_email, state, closed_at, erase_at FROM labels WHERE desk_id = $1`,
      [deskId],
    );
    const sorted = [...list].sort((a, b) => (fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : a.id < b.id ? -1 : 1));
    return { labels: sorted.map(labelOut) };
  });

  app.post("/api/labels", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const body = req.body as Record<string, unknown>;
    const name = typeof body?.name === "string" ? body.name : "";
    const contactName = typeof body?.contactName === "string" ? body.contactName : "";
    const contactEmail = typeof body?.contactEmail === "string" ? body.contactEmail : "";
    const fields: Record<string, string> = {};
    if (name.length === 0 || name.length > 120) fields.name = COPY.emptyField;
    if (contactName.length === 0 || contactName.length > 120) fields.contactName = COPY.emptyField;
    if (contactEmail.length === 0 || contactEmail.length > 320) fields.contactEmail = COPY.emptyField;
    if (Object.keys(fields).length > 0) throw errValidation(fields);
    const id = newId();
    await rows(
      `INSERT INTO labels (id, desk_id, name, contact_name, contact_email, state) VALUES ($1,$2,$3,$4,$5,'open')`,
      [id, deskId, name, contactName, contactEmail],
    );
    reply.status(201);
    const r = await one<Parameters<typeof labelOut>[0]>(`SELECT id, name, contact_name, contact_email, state, closed_at, erase_at FROM labels WHERE id = $1`, [id]);
    return labelOut(r!);
  });

  app.get("/api/labels/:id", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const label = await labelOfDesk(deskId, id);
    const suppliers = await rows<{
      id: string; name: string; town: string; language: string; contact_name: string; contact_email: string;
    }>(
      `SELECT id, name, town, language, contact_name, contact_email FROM suppliers WHERE label_id = $1 ORDER BY name ASC`,
      [id],
    );
    return {
      ...labelOut(label),
      suppliers: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        town: s.town,
        townName: townName(s.town),
        language: s.language,
        contactName: s.contact_name,
        contactEmail: s.contact_email,
      })),
    };
  });

  app.patch("/api/labels/:id", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const label = await labelOfDesk(deskId, id);
    if (label.state !== "open") throw errConflict(COPY.closedLabel);
    const body = req.body as Record<string, unknown>;
    const name = typeof body?.name === "string" ? body.name : "";
    const fields: Record<string, string> = {};
    if (name.length === 0 || name.length > 120) fields.name = COPY.emptyField;
    if (Object.keys(fields).length > 0) throw errValidation(fields);
    await rows(`UPDATE labels SET name = $1 WHERE id = $2`, [name, id]);
    const r = await one<Parameters<typeof labelOut>[0]>(`SELECT id, name, contact_name, contact_email, state, closed_at, erase_at FROM labels WHERE id = $1`, [id]);
    return labelOut(r!);
  });

  app.delete("/api/labels/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    await labelOfDesk(deskId, id);
    await deleteLabelCascade(app, id);
    reply.status(204);
    return reply.send(null);
  });

  app.post("/api/labels/:id/close", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const label = await labelOfDesk(deskId, id);
    if (label.state !== "open") throw errConflict(COPY.closedLabel);
    const eraseAt = instantOf(addSeconds(new Date(), app.state.config.closureWaitSeconds));
    await rows(`UPDATE labels SET state = 'closed', closed_at = $1, erase_at = $2 WHERE id = $3`, [
      instantOf(new Date()),
      eraseAt,
      id,
    ]);
    const r = await one<Parameters<typeof labelOut>[0]>(`SELECT id, name, contact_name, contact_email, state, closed_at, erase_at FROM labels WHERE id = $1`, [id]);
    return labelOut(r!);
  });

  app.post("/api/labels/:id/bring-back", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const label = await labelOfDesk(deskId, id);
    if (label.state !== "closed") throw errConflict(`This label is not closed.`);
    if (label.erase_at !== null && label.erase_at <= instantOf(new Date())) {
      throw errConflict(`This label's wait has passed.`);
    }
    await rows(`UPDATE labels SET state = 'open', closed_at = NULL, erase_at = NULL WHERE id = $1`, [id]);
    const r = await one<Parameters<typeof labelOut>[0]>(`SELECT id, name, contact_name, contact_email, state, closed_at, erase_at FROM labels WHERE id = $1`, [id]);
    return labelOut(r!);
  });

  app.post("/api/labels/:id/catalogue/preview", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    await labelOfDesk(deskId, id);
    const csv = req.body as string;
    const existing = await rows<{ style_code: string | null }>(
      `SELECT style_code FROM styles WHERE label_id = $1`,
      [id],
    );
    const out = parseCatalogueWithExisting(csv, existing, id);
    return out;
  });

  app.post("/api/labels/:id/catalogue/save", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const label = await labelOfDesk(deskId, id);
    if (label.state !== "open") throw errConflict(COPY.closedLabel);
    const csv = req.body as string;
    const existing = await rows<{ style_code: string | null }>(
      `SELECT style_code FROM styles WHERE label_id = $1`,
      [id],
    );
    const parsed = parseCatalogueWithExisting(csv, existing, id);
    for (const row of parsed.rows.filter((r) => r.outcome === "new")) {
      const styleId = newId();
      await rows(
        `INSERT INTO styles (id, desk_id, label_id, style_code, name, season, gtin, garment, washes, state, version, changed_at, changed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'tshirt',30,'draft',1,$8,NULL)`,
        [styleId, deskId, id, row.styleCode, row.name, row.season, row.gtin, instantOf(new Date())],
      );
    }
    return { newCount: parsed.newCount, matchedCount: parsed.matchedCount, refusedCount: parsed.refusedCount };
  });
}

export function townName(town: string): string {
  const names: Record<string, string> = {
    porto: "Porto",
    izmir: "Izmir",
    hoChiMinhCity: "Ho Chi Minh City",
    cairo: "Cairo",
  };
  return names[town] ?? town;
}

async function deleteLabelCascade(app: FastifyInstance, labelId: string): Promise<void> {
  const evidenceKeys = await rows<{ key: string }>(
    `SELECT CONCAT('evidence/', r.desk_id, '/', r.id, '/', e.id) AS key
     FROM evidence e JOIN requests r ON r.id = e.request_id
     WHERE r.desk_id = (SELECT desk_id FROM labels WHERE id = $1)`,
    [labelId],
  );
  const dossierKeys = await rows<{ key: string }>(
    `SELECT CONCAT('dossiers/', d.desk_id, '/', d.id, '.pdf') AS key FROM dossiers d
     WHERE d.desk_id = (SELECT desk_id FROM labels WHERE id = $1)
       AND d.style_id IN (SELECT id FROM styles WHERE label_id = $1)`,
    [labelId],
  );
  for (const k of [...evidenceKeys, ...dossierKeys]) {
    try {
      await app.state.files.remove(k.key);
    } catch {
      // retried until confirmed by the erasure pass
    }
  }
  await rows(`DELETE FROM labels WHERE id = $1`, [labelId]);
}

export interface CatalogueRow {
  row: number;
  styleCode: string | null;
  name: string | null;
  season: string | null;
  gtin: string | null;
  outcome: "new" | "matched" | "refused";
  reason: string | null;
}

export function parseCatalogueWithExisting(
  csv: string,
  existing: { style_code: string | null }[],
  _labelId: string,
): {
  rows: CatalogueRow[];
  newCount: number;
  matchedCount: number;
  refusedCount: number;
} {
  const text = csv.replace(/^\uFEFF/, "");
  const lines = text.split(/\r\n|\n|\r/).filter((l, i, arr) => !(l === "" && i === arr.length - 1));
  const out: CatalogueRow[] = [];
  if (lines.length === 0 || lines[0].trim() !== "styleCode,name,season,gtin") {
    return {
      rows: [
        {
          row: 1,
          styleCode: null,
          name: null,
          season: null,
          gtin: null,
          outcome: "refused",
          reason: COPY.catalogueHeader,
        },
      ],
      newCount: 0,
      matchedCount: 0,
      refusedCount: 1,
    };
  }
  const seenCodes = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    const rowNumber = i + 1;
    const cols = parseCsvLine(line);
    const [styleCode, name, season, gtin] = [cols[0] ?? "", cols[1] ?? "", cols[2] ?? "", cols[3] ?? ""];
    if (styleCode === "" && name === "" && season === "" && gtin === "") continue;
    const reason = catalogueRowReason(styleCode, name, season, gtin, existing, seenCodes, rowNumber);
    if (reason !== null) {
      out.push({ row: rowNumber, styleCode: styleCode || null, name: name || null, season: season || null, gtin: gtin || null, outcome: "refused", reason });
      continue;
    }
    const matched = existing.some((s) => s.style_code === styleCode);
    seenCodes.set(styleCode, rowNumber);
    out.push({
      row: rowNumber,
      styleCode,
      name,
      season,
      gtin,
      outcome: matched ? "matched" : "new",
      reason: null,
    });
  }
  return {
    rows: out,
    newCount: out.filter((r) => r.outcome === "new").length,
    matchedCount: out.filter((r) => r.outcome === "matched").length,
    refusedCount: out.filter((r) => r.outcome === "refused").length,
  };
}

function catalogueRowReason(
  styleCode: string,
  name: string,
  season: string,
  gtin: string,
  existing: { style_code: string | null }[],
  seenCodes: Map<string, number>,
  rowNumber: number,
): string | null {
  const gtinCheck = checkGtin(gtin);
  if (!gtinCheck.ok) {
    if (gtinCheck.problem === "digit") return COPY.gtinCheckDigit(gtinCheck.expectedDigit!);
    return COPY.gtinLength;
  }
  if (name.length === 0) return COPY.catalogueNameNeeded;
  if (season.length === 0) return COPY.catalogueSeasonNeeded;
  if (styleCode.length > 0) {
    const seen = seenCodes.get(styleCode);
    if (seen !== undefined) return COPY.catalogueCodeRepeat(seen);
    if (existing.some((s) => s.style_code === styleCode)) {
      // matched rows are fine; only a repeat inside this file is refused
    }
  }
  return null;
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cols.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}
