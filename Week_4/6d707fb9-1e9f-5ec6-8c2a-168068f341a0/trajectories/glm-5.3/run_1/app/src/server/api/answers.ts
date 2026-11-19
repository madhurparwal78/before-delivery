import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { newId } from "../engine/ids.js";
import { instantOf } from "../engine/time.js";

import { ANSWER_COPY, COPY, type Lang } from "../engine/copy.js";
import { errNotFound, errValidation } from "./errors.js";
import { one, rows } from "../db/pool.js";
import { EVIDENCE_FILE_LIMIT } from "../config/env.js";
import { parseLocalNumber, energyToMj } from "../engine/numbers.js";
import { evidenceKey } from "../services/filestore.js";
import { bumpStyleVersion, linesOfStyle } from "./styles.js";
import { workOutFootprint } from "../engine/footprint.js";

interface TokenRow {
  id: string;
  desk_id: string;
  style_id: string;
  line_id: string;
  supplier_name: string;
  contact_name: string;
  contact_email: string;
  town: string;
  language: string;
  questions: string[];
  due_date: string;
  state: string;
  sent_at: string;
  ends_at: string;
  answered_at: string | null;
  token: string | null;
  token_ends_at: string | null;
}

async function requestByToken(token: string): Promise<TokenRow | null> {
  return one<TokenRow>(`SELECT * FROM requests WHERE token = $1`, [token]);
}

function pageEndedCopy(lang: Lang): string {
  return ANSWER_COPY[lang].ended;
}

/** The private answer page read, with its published lifetime. */
export async function answerPageData(token: string): Promise<{
  language: string;
  supplierName: string;
  labelName: string;
  styleName: string;
  town: string;
  townName: string;
  questions: string[];
  dueDate: string;
  endsAt: string;
  state: string;
  answeredAt: string | null;
} | "ended"> {
  const r = await requestByToken(token);
  if (!r || r.token === null) return "ended";
  const now = instantOf(new Date());
  if (r.token_ends_at !== null && r.token_ends_at <= now) return "ended";
  const style = await one<{ name: string; label_id: string }>(`SELECT name, label_id FROM styles WHERE id = $1`, [r.style_id]);
  const label = await one<{ name: string }>(`SELECT name FROM labels WHERE id = $1`, [style?.label_id ?? ""]);
  const answered = await one<{ answered_at: string }>(`SELECT answered_at FROM answers WHERE request_id = $1`, [r.id]);
  return {
    language: r.language,
    supplierName: r.supplier_name,
    labelName: label?.name ?? "",
    styleName: style?.name ?? "",
    town: r.town,
    townName: townNameLocal(r.town),
    questions: r.questions,
    dueDate: r.due_date,
    endsAt: r.token_ends_at ?? r.ends_at,
    state: answered ? "answered" : "sent",
    answeredAt: answered?.answered_at ?? null,
  };
}

export function townNameLocal(town: string): string {
  const names: Record<string, string> = {
    porto: "Porto",
    izmir: "Izmir",
    hoChiMinhCity: "Ho Chi Minh City",
    cairo: "Cairo",
  };
  return names[town] ?? town;
}

export function registerAnswerRoutes(app: FastifyInstance): void {
  app.get("/api/a/:token", async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    const data = await answerPageData(token);
    if (data === "ended") {
      const lang = await langOfEndedToken(token);
      reply.status(410);
      return { error: { code: "page_ended", message: pageEndedCopy(lang) } };
    }
    return data;
  });

  app.post("/api/a/:token/evidence", async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    const r = await requestByToken(token);
    const now = instantOf(new Date());
    if (!r || r.token === null || r.token_ends_at === null) {
      reply.status(404);
      return { error: { code: "not_found", message: COPY.notFound } };
    }
    const lang = r.language as Lang;
    if (r.token_ends_at <= now) {
      reply.status(410);
      return { error: { code: "page_ended", message: pageEndedCopy(lang) } };
    }
    const filePart = (req.body as Record<string, { filename?: string; value?: Buffer; mimetype?: string }[]> | undefined)?.file?.[0];
    const file = filePart;
    if (!file || !file.value) {
      throw errValidation({ file: ANSWER_COPY[lang].emptyAnswer });
    }
    const bytes = file.value;
    // The size limit counts the file alone, never the multipart body.
    if (bytes.length > EVIDENCE_FILE_LIMIT) {
      reply.status(413);
      return { error: { code: "too_large", message: ANSWER_COPY[lang].fileTooBig } };
    }
    const contentType = sniffType(bytes);
    if (contentType === null) {
      reply.status(415);
      return { error: { code: "unsupported_media_type", message: ANSWER_COPY[lang].fileTypeRefused } };
    }
    const evidenceId = newId();
    const key = evidenceKey(r.desk_id, r.id, evidenceId);
    try {
      await app.state.files.put(key, bytes, contentType);
    } catch {
      reply.status(503);
      return { error: { code: "file_store_unavailable", message: ANSWER_COPY[lang].fileStoreDown } };
    }
    await rows(
      `INSERT INTO evidence (id, desk_id, request_id, file_name, content_type, size_bytes) VALUES ($1,$2,$3,$4,$5,$6)`,
      [evidenceId, r.desk_id, r.id, file.filename ?? "evidence", contentType, bytes.length],
    );
    reply.status(201);
    return { evidenceId, fileName: file.filename ?? "evidence", sizeBytes: bytes.length, contentType };
  });

  app.post("/api/a/:token/answers", async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    const r = await requestByToken(token);
    const now = instantOf(new Date());
    if (!r || r.token === null) {
      reply.status(404);
      return { error: { code: "not_found", message: COPY.notFound } };
    }
    const lang = r.language as Lang;
    if (r.token_ends_at !== null && r.token_ends_at <= now) {
      reply.status(410);
      return { error: { code: "page_ended", message: pageEndedCopy(lang) } };
    }
    const existing = await one<{ request_id: string }>(`SELECT request_id FROM answers WHERE request_id = $1`, [r.id]);
    if (existing) {
      // Sending answers again answers the first response and changes nothing.
      const first = await answerOfRequestId(r.id);
      reply.status(201);
      return first;
    }
    const body = req.body as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const energy = body?.energy as Record<string, unknown> | undefined;
    const water = body?.water as Record<string, unknown> | undefined;
    const fibreOrigin = typeof body?.fibreOrigin === "string" ? body.fibreOrigin : body?.fibreOrigin ?? null;
    const evidenceIds = Array.isArray(body?.evidenceIds)
      ? (body.evidenceIds as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    let energyValue: string | null = null;
    let energyUnit: string | null = null;
    let energyMj: string | null = null;
    let waterL: string | null = null;
    if (r.questions.includes("energy")) {
      if (energy === undefined || typeof energy.value !== "string") {
        fields["energy.value"] = ANSWER_COPY[lang].emptyAnswer;
      } else {
        const parsed = parseLocalNumber(energy.value, lang);
        if (parsed === null) {
          fields["energy.value"] = ANSWER_COPY[lang].numberRefused;
        } else {
          const unit = typeof energy.unit === "string" ? energy.unit : "";
          if (!["kWh", "MJ", "m3"].includes(unit)) {
            fields["energy.unit"] = ANSWER_COPY[lang].emptyAnswer;
          } else {
            energyValue = energy.value;
            energyUnit = unit;
            energyMj = energyToMj(parsed, unit as "kWh" | "MJ" | "m3");
          }
        }
      }
    }
    if (r.questions.includes("water")) {
      if (water === undefined || typeof water.value !== "string") {
        fields["water.value"] = ANSWER_COPY[lang].emptyAnswer;
      } else {
        const parsed = parseLocalNumber(water.value, lang);
        if (parsed === null) {
          fields["water.value"] = ANSWER_COPY[lang].numberRefused;
        } else {
          waterL = parsed;
        }
      }
    }
    if (r.questions.includes("fibreOrigin")) {
      if (typeof fibreOrigin !== "string" || !["PT", "TR", "VN", "EG", "IN", "BD"].includes(fibreOrigin)) {
        fields.fibreOrigin = ANSWER_COPY[lang].emptyAnswer;
      }
    }
    // Every chosen evidence file must already be stored.
    for (const evId of evidenceIds) {
      const ev = await one<{ id: string }>(`SELECT id FROM evidence WHERE id = $1 AND request_id = $2`, [evId, r.id]);
      if (!ev) fields.evidenceIds = ANSWER_COPY[lang].emptyAnswer;
    }
    if (Object.keys(fields).length > 0) {
      reply.status(422);
      const first = Object.values(fields)[0];
      return { error: { code: "validation_failed", message: first, fields } };
    }
    const answeredAt = instantOf(new Date());
    await rows(
      `INSERT INTO answers (request_id, energy_value, energy_unit, energy_mj, water_l, fibre_origin, evidence_ids, answered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.id, energyValue, energyUnit, energyMj, waterL, typeof fibreOrigin === "string" ? fibreOrigin : null, evidenceIds, answeredAt],
    );
    await rows(`UPDATE requests SET answered_at = $1, state = 'answered' WHERE id = $2`, [answeredAt, r.id]);
    await applyAnswerToLine(app, r.line_id, r.style_id, { energyMj, waterL, fibreOrigin: typeof fibreOrigin === "string" ? fibreOrigin : null }, r.supplier_name);
    reply.status(201);
    return {
      energyValue,
      energyUnit,
      energyMjPerKg: energyMj,
      waterLitresPerKg: waterL,
      fibreOrigin: typeof fibreOrigin === "string" ? fibreOrigin : null,
      evidenceIds,
      answeredAt,
      state: "answered",
    };
  });
}

async function langOfEndedToken(token: string): Promise<Lang> {
  const r = await requestByToken(token);
  return (r?.language as Lang | undefined) ?? "en";
}

async function answerOfRequestId(requestId: string): Promise<unknown> {
  const a = await one<{
    energy_value: string | null; energy_unit: string | null; energy_mj: string | null;
    water_l: string | null; fibre_origin: string | null; evidence_ids: string[]; answered_at: string;
  }>(`SELECT energy_value, energy_unit, energy_mj, water_l, fibre_origin, evidence_ids, answered_at FROM answers WHERE request_id = $1`, [requestId]);
  if (!a) throw errNotFound();
  return {
    energyValue: a.energy_value,
    energyUnit: a.energy_unit,
    energyMjPerKg: a.energy_mj,
    waterLitresPerKg: a.water_l,
    fibreOrigin: a.fibre_origin,
    evidenceIds: a.evidence_ids ?? [],
    answeredAt: a.answered_at,
    state: "answered",
  };
}

/** Applying an answer: the first answer on a page is stored once and applied to its line. */
async function applyAnswerToLine(
  app: import("fastify").FastifyInstance,
  lineId: string,
  styleId: string,
  facts: { energyMj: string | null; waterL: string | null; fibreOrigin: string | null },
  supplierName: string,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (facts.energyMj !== null) {
    params.push(facts.energyMj);
    sets.push(`answered_energy_mj = $${params.length}`);
  }
  if (facts.waterL !== null) {
    params.push(facts.waterL);
    sets.push(`answered_water_l = $${params.length}`);
  }
  if (facts.fibreOrigin !== null) {
    params.push(facts.fibreOrigin);
    const idx = params.length;
    sets.push(`answered_fibre_origin = $${idx}`);
    sets.push(`tier3_country = $${idx}`);
  }
  if (sets.length > 0) {
    params.push(lineId);
    await rows(`UPDATE lines SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    await bumpStyleVersion(styleId, supplierName);
    await rows(`UPDATE scores SET state = 'outdated' WHERE style_id = $1 AND state = 'current'`, [styleId]);
    // A later answer makes a new result from the rows kept with the latest result, with no call.
    await reworkLatestResult(app, styleId, supplierName);
  }
}

async function reworkLatestResult(app: import("fastify").FastifyInstance, styleId: string, supplierName: string): Promise<void> {
  const latest = await one<{ id: string; edition: string; factor_rows: unknown }>(
    `SELECT id, edition, factor_rows FROM results WHERE style_id = $1 ORDER BY worked_out_at DESC, id DESC LIMIT 1`,
    [styleId],
  );
  if (!latest) return;
  const style = await one<{ washes: number }>(`SELECT washes FROM styles WHERE id = $1`, [styleId]);
  const lines = await linesOfStyle(styleId);
  const legs = await rows<{ mode: string; km: string }>(`SELECT mode, km FROM legs WHERE style_id = $1 ORDER BY position`, [styleId]);
  const withTier1 = lines.filter((l) => l.tier1_country !== null);
  if (withTier1.length === 0) return;
  const factorRows = latest.factor_rows as import("../engine/footprint.js").FactorRow[];
  const out = workOutFootprint(
    factorRows,
    withTier1.map((l) => ({
      materialId: l.material_id,
      massGrams: l.mass_grams,
      tier1Country: l.tier1_country,
      answeredEnergyMjPerKg: l.answered_energy_mj,
      answeredWaterLitresPerKg: l.answered_water_l,
      answeredFibreOrigin: l.answered_fibre_origin,
    })),
    legs.map((l) => ({ mode: l.mode, km: l.km })),
    { washes: style?.washes ?? 30 },
  );
  const { newId } = await import("../engine/ids.js");
  await rows(
    `INSERT INTO results (id, style_id, desk_id, edition, worked_out_at, data_quality_percent, data_quality_grade, factor_rows, measures)
     VALUES ($1,$2,(SELECT desk_id FROM styles WHERE id=$2),$3,$4,$5,$6,$7,$8)`,
    [newId(), styleId, latest.edition, instantOf(new Date()), out.dataQualityPercent, out.dataQualityGrade, JSON.stringify(factorRows), JSON.stringify(out.measures)],
  );
}

/** Judged by content only: the first bytes must be the PDF, JPEG or PNG signature. */
export function sniffType(bytes: Buffer): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}
