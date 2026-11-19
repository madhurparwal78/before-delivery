import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { newId, newToken } from "../engine/ids.js";
import { addSeconds, instantOf, lisbonDate, shownDate, shownTime, LISBON } from "../engine/time.js";
import { fromZonedTime } from "date-fns-tz";
import { requireDesk } from "../app.js";
import {
  errConflict,
  errDossierUnavailable,
  errFileStoreUnavailable,
  errGtinTaken,
  errNewerDossier,
  errNotFound,
  errRateLimited,
  errValidation,
  errWithdrawn,
} from "./errors.js";
import { COPY, PASSPORT_COPY, SIGNOFF_MAIL, type Lang } from "../engine/copy.js";
import { one, rows } from "../db/pool.js";
import { DOWNLOADS_PER_WINDOW } from "../config/env.js";
import { styleOfDesk, assertWritable, linesOfStyle } from "./styles.js";
import { dossierKey, evidenceKey } from "../services/filestore.js";
import { renderPdf } from "../services/gotenberg.js";
import { queueMail } from "../services/mailer.js";
import { MEASURE_LABELS } from "../engine/domain.js";
import { groupInt } from "../engine/display.js";

export async function registerPassportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/styles/:id/passport", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    const latestResult = await one<{ id: string; edition: string; data_quality_percent: number; data_quality_grade: string; measures: { measure: string; totalShown: string }[] }>(
      `SELECT id, edition, data_quality_percent, data_quality_grade, measures FROM results WHERE style_id = $1 ORDER BY worked_out_at DESC, id DESC LIMIT 1`,
      [id],
    );
    if (!latestResult) throw errConflict(COPY.dossierWithoutResult);
    const score = await one<{ state: string; score: number; per_100g: number }>(
      `SELECT state, score, per_100g FROM scores WHERE style_id = $1`,
      [id],
    );
    if (!score || score.state !== "current") throw errConflict(COPY.publishWithoutScore);
    const withdrawn = await one<{ id: string }>(
      `SELECT id FROM passports WHERE style_id = $1 AND state = 'withdrawn' ORDER BY edition DESC LIMIT 1`,
      [id],
    );
    if (withdrawn) throw errConflict(`This style's passport has been withdrawn.`);
    const clash = await one<{ id: string; style_id: string }>(
      `SELECT id, style_id FROM passports WHERE gtin = $1 AND state = 'published' AND style_id <> $2`,
      [style.gtin, id],
    );
    if (clash) throw errGtinTaken();
    const maxEdition = await one<{ max: number | null }>(
      `SELECT MAX(edition) AS max FROM passports WHERE style_id = $1`,
      [id],
    );
    const edition = (maxEdition?.max ?? 0) + 1;
    const label = await one<{ name: string }>(`SELECT name FROM labels WHERE id = $1`, [style.label_id]);
    const publishedAt = instantOf(new Date());
    const snapshot = {
      styleName: style.name,
      labelName: label?.name ?? "",
      garment: style.garment,
      factorEdition: latestResult.edition,
      dataQualityPercent: latestResult.data_quality_percent,
      dataQualityGrade: latestResult.data_quality_grade,
      scoreShown: COPY.scoreShown(groupInt(String(score.score)), groupInt(String(score.per_100g))),
      measures: latestResult.measures.map((m) => ({ measure: m.measure, totalShown: m.totalShown })),
    };
    const passportId = newId();
    await rows(
      `INSERT INTO passports (id, style_id, gtin, edition, state, published_at, snapshot) VALUES ($1,$2,$3,$4,'published',$5,$6)`,
      [passportId, id, style.gtin, edition, publishedAt, JSON.stringify(snapshot)],
    );
    await rows(`UPDATE styles SET state = 'published' WHERE id = $1`, [id]);
    reply.status(201);
    return {
      gtin: style.gtin,
      edition,
      state: "published",
      publishedAt,
      address: `/p/${style.gtin}`,
    };
  });

  app.post("/api/styles/:id/passport/withdraw", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    const published = await one<{ gtin: string }>(`SELECT gtin FROM passports WHERE style_id = $1 AND state = 'published' LIMIT 1`, [id]);
    if (!published) throw errConflict(`This style has no published passport.`);
    await rows(`UPDATE passports SET state = 'withdrawn' WHERE style_id = $1`, [id]);
    await rows(`UPDATE styles SET state = 'worked' WHERE id = $1 AND state = 'published'`, [id]);
    return { gtin: style.gtin, state: "withdrawn" };
  });

  app.get("/api/passports", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const list = await rows<{ id: string; style_id: string; gtin: string; edition: number; state: string; published_at: string; style_name: string }>(
      `SELECT p.id, p.style_id, p.gtin, p.edition, p.state, p.published_at, s.name AS style_name
       FROM passports p JOIN styles s ON s.id = p.style_id WHERE s.desk_id = $1
       ORDER BY p.gtin ASC, p.edition ASC`,
      [deskId],
    );
    return {
      passports: list.map((p) => ({
        styleId: p.style_id,
        styleName: p.style_name,
        gtin: p.gtin,
        edition: p.edition,
        state: p.state,
        publishedAt: p.published_at,
        address: `/p/${p.gtin}/e/${p.edition}`,
      })),
    };
  });

  app.get("/api/passports/:gtin", async (req: FastifyRequest, reply: FastifyReply) => {
    return publicPassport(req, reply, app);
  });

  app.get("/api/passports/:gtin/editions/:n", async (req: FastifyRequest, reply: FastifyReply) => {
    return publicPassport(req, reply, app);
  });
}

interface PassportRow {
  id: string;
  style_id: string;
  gtin: string;
  edition: number;
  state: string;
  published_at: string;
  snapshot: {
    styleName: string;
    labelName: string;
    garment: string;
    factorEdition: string;
    dataQualityPercent: number;
    dataQualityGrade: string;
    scoreShown: string;
    measures: { measure: string; totalShown: string }[];
  };
}

async function publicPassport(req: FastifyRequest, reply: FastifyReply, _app: FastifyInstance): Promise<unknown> {
  const params = req.params as { gtin: string; n?: string };
  const query = req.query as Record<string, string>;
  const lang = (["en", "fr", "tr", "ar"].includes(query.lang ?? "") ? query.lang : "en") as Lang;
  const gtin = params.gtin;
  const edition = params.n !== undefined ? Number.parseInt(params.n, 10) : null;
  let row: PassportRow | null;
  if (edition === null) {
    row = await one<PassportRow>(
      `SELECT * FROM passports WHERE gtin = $1 ORDER BY (state = 'published') DESC, edition DESC LIMIT 1`,
      [gtin],
    );
  } else {
    if (!Number.isFinite(edition)) throw errNotFound();
    row = await one<PassportRow>(`SELECT * FROM passports WHERE gtin = $1 AND edition = $2`, [gtin, edition]);
  }
  if (!row) throw errNotFound();
  if (row.state === "withdrawn") {
    reply.status(410);
    throw errWithdrawn(PASSPORT_COPY[lang].withdrawn);
  }
  const lisbonShown = shownDate(fromZonedTime(`${lisbonDate(new Date(row.published_at))}T12:00:00`, LISBON), LISBON);
  return {
    gtin: row.gtin,
    edition: row.edition,
    lang,
    styleName: row.snapshot.styleName,
    labelName: row.snapshot.labelName,
    garment: row.snapshot.garment,
    publishedAt: row.published_at,
    correctedOn: row.edition > 1 ? lisbonShown : null,
    factorEdition: row.snapshot.factorEdition,
    dataQualityPercent: row.snapshot.dataQualityPercent,
    dataQualityGrade: row.snapshot.dataQualityGrade,
    scoreShown: row.snapshot.scoreShown,
    measures: row.snapshot.measures.map((m) => ({ measure: m.measure, totalShown: m.totalShown })),
  };
}

/** Ladder step 3 for downloads: keyed on the desk and never the network address. */
async function checkDownloadRate(deskId: string, windowSeconds: number): Promise<void> {
  const now = instantOf(new Date());
  const from = instantOf(addSeconds(new Date(), -windowSeconds));
  const recent = await rows<{ at: string }>(
    `SELECT at FROM rate_requests WHERE desk_id = $1 AND kind = 'download' AND at > $2 ORDER BY at ASC`,
    [deskId, from],
  );
  if (recent.length >= DOWNLOADS_PER_WINDOW) {
    const oldest = recent[0].at;
    const retryAfter = Math.max(1, Math.ceil((Date.parse(oldest) + windowSeconds * 1000 - Date.parse(now)) / 1000));
    const retryAt = instantOf(addSeconds(new Date(), retryAfter));
    throw errRateLimited(retryAfter, COPY.tooManyDownloads(shownTime(new Date(retryAt), "Europe/Lisbon")));
  }
  await rows(`INSERT INTO rate_requests (desk_id, at, kind) VALUES ($1,$2,'download')`, [deskId, now]);
}

export async function registerDossierRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/styles/:id/dossiers", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const style = await styleOfDesk(deskId, id);
    assertWritable(style);
    const latestResult = await one<{ id: string; edition: string; data_quality_percent: number; data_quality_grade: string; measures: { measure: string; stages: { stage: string; shown: string }[]; totalShown: string }[] }>(
      `SELECT id, edition, data_quality_percent, data_quality_grade, measures FROM results WHERE style_id = $1 ORDER BY worked_out_at DESC, id DESC LIMIT 1`,
      [id],
    );
    if (!latestResult) throw errConflict(COPY.dossierWithoutResult);
    const label = await one<{ name: string }>(`SELECT name FROM labels WHERE id = $1`, [style.label_id]);
    const dossierId = newId();
    const madeAt = instantOf(new Date());
    const html = dossierHtml(style.name, label?.name ?? "", latestResult.edition, latestResult.data_quality_grade, latestResult.data_quality_percent, latestResult.measures);
    // Ready only after Gotenberg has answered and MinIO has confirmed.
    let pdf: Buffer;
    try {
      pdf = await renderPdf(app.state.config, html);
    } catch {
      throw errDossierUnavailable();
    }
    try {
      await app.state.files.put(dossierKey(deskId, dossierId), pdf, "application/pdf");
    } catch {
      throw errFileStoreUnavailable();
    }
    await rows(
      `INSERT INTO dossiers (id, style_id, result_id, desk_id, edition, state, made_at, pdf_key) VALUES ($1,$2,$3,$4,$5,'ready',$6,$7)`,
      [dossierId, id, latestResult.id, deskId, latestResult.edition, madeAt, dossierKey(deskId, dossierId)],
    );
    await rows(`UPDATE dossiers SET state = 'replaced' WHERE style_id = $1 AND id <> $2 AND state IN ('ready', 'signedOff')`, [id, dossierId]);
    reply.status(201);
    return dossierOut((await one<DossierRow>(`SELECT * FROM dossiers WHERE id = $1`, [dossierId]))!);
  });

  app.get("/api/styles/:id/dossiers", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    await styleOfDesk(deskId, id);
    const list = await rows<DossierRow>(`SELECT * FROM dossiers WHERE style_id = $1 ORDER BY made_at DESC`, [id]);
    return { dossiers: list.map(dossierOut) };
  });

  app.get("/api/dossiers/:id", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const r = await one<DossierRow>(`SELECT * FROM dossiers WHERE id = $1`, [id]);
    if (!r || r.desk_id !== deskId) throw errNotFound();
    return dossierOut(r);
  });

  app.get("/api/dossiers/:id/file", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    await checkDownloadRate(deskId, app.state.config.fileRateWindowSeconds);
    const r = await one<DossierRow>(`SELECT * FROM dossiers WHERE id = $1`, [id]);
    if (!r || r.desk_id !== deskId) throw errNotFound();
    if (r.state === "making" || r.pdf_key === null) throw errNotFound();
    let pdf: Buffer;
    try {
      pdf = await app.state.files.get(r.pdf_key);
    } catch {
      throw errFileStoreUnavailable();
    }
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename="dossier-${id}.pdf"`);
    return reply.send(pdf);
  });

  app.post("/api/dossiers/:id/sign-off-page", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const r = await one<DossierRow & { style_name: string; contact_name: string; contact_email: string }>(
      `SELECT d.*, s.name AS style_name, l.contact_name, l.contact_email
       FROM dossiers d JOIN styles s ON s.id = d.style_id JOIN labels l ON l.id = s.label_id
       WHERE d.id = $1`,
      [id],
    );
    if (!r || r.desk_id !== deskId) throw errNotFound();
    if (r.state === "replaced") throw errConflict(COPY.newerDossier(shownTime(new Date(r.made_at), "Europe/Lisbon")));
    const token = newToken();
    const endsAt = instantOf(addSeconds(new Date(), app.state.config.signOffPageSeconds));
    await rows(`DELETE FROM sign_off_pages WHERE dossier_id = $1`, [id]);
    await rows(`INSERT INTO sign_off_pages (token, dossier_id, ends_at, created_at) VALUES ($1,$2,$3,$4)`, [
      token, id, endsAt, instantOf(new Date()),
    ]);
    await queueMail(
      r.contact_email,
      SIGNOFF_MAIL.subject.replace("<styleName>", r.style_name),
      [
        SIGNOFF_MAIL.greeting.replace("<contactName>", r.contact_name),
        "",
        SIGNOFF_MAIL.ask.replace("<styleName>", r.style_name),
        "",
        `${app.state.config.appPublicUrl}/s/${token}`,
        "",
        SIGNOFF_MAIL.ends
          .replace("<date>", shownDate(new Date(endsAt), LISBON))
          .replace("<time>", shownTime(new Date(endsAt), LISBON)),
      ].join("\n"),
    );
    reply.status(201);
    return { signOffAddress: `/s/${token}`, endsAt };
  });

  app.get("/api/s/:token", async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    const page = await one<{ dossier_id: string; ends_at: string }>(
      `SELECT dossier_id, ends_at FROM sign_off_pages WHERE token = $1`,
      [token],
    );
    if (!page) throw errNotFound();
    if (page.ends_at <= instantOf(new Date())) {
      reply.status(410);
      throw errConflict(`This page has ended.`);
    }
    const d = await one<DossierRow>(`SELECT * FROM dossiers WHERE id = $1`, [page.dossier_id]);
    if (!d) throw errNotFound();
    const style = await one<{ name: string }>(`SELECT name FROM styles WHERE id = $1`, [d.style_id]);
    const result = await one<{ measures: { measure: string; totalShown: string }[]; edition: string; data_quality_percent: number; data_quality_grade: string }>(
      `SELECT measures, edition, data_quality_percent, data_quality_grade FROM results WHERE id = $1`,
      [d.result_id],
    );
    return {
      dossier: {
        id: d.id,
        state: d.state,
        styleName: style?.name ?? "",
        edition: result?.edition ?? "",
        dataQualityPercent: result?.data_quality_percent ?? 0,
        dataQualityGrade: result?.data_quality_grade ?? "C",
        measures: result?.measures.map((m) => ({ measure: m.measure, totalShown: m.totalShown })) ?? [],
        madeAt: d.made_at,
        signedOffBy: d.signed_off_by,
        signedOffAt: d.signed_off_at,
      },
      endsAt: page.ends_at,
    };
  });

  app.get("/api/s/:token/file", async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    const page = await one<{ dossier_id: string; ends_at: string }>(
      `SELECT dossier_id, ends_at FROM sign_off_pages WHERE token = $1`,
      [token],
    );
    if (!page) throw errNotFound();
    if (page.ends_at <= instantOf(new Date())) {
      reply.status(410);
      throw errConflict(`This page has ended.`);
    }
    const d = await one<DossierRow>(`SELECT * FROM dossiers WHERE id = $1`, [page.dossier_id]);
    if (!d) throw errNotFound();
    if (d.pdf_key === null) throw errNotFound();
    let pdf: Buffer;
    try {
      pdf = await app.state.files.get(d.pdf_key);
    } catch {
      throw errFileStoreUnavailable();
    }
    reply.header("Content-Type", "application/pdf");
    return reply.send(pdf);
  });

  app.post("/api/s/:token/sign", async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    const body = req.body as Record<string, unknown>;
    const name = typeof body?.name === "string" ? body.name : "";
    const page = await one<{ dossier_id: string; ends_at: string }>(
      `SELECT dossier_id, ends_at FROM sign_off_pages WHERE token = $1`,
      [token],
    );
    if (!page) throw errNotFound();
    if (page.ends_at <= instantOf(new Date())) {
      reply.status(410);
      throw errConflict(`This page has ended.`);
    }
    if (name.length === 0) throw errValidation({ name: COPY.signOffNameEmpty });
    const d = await one<DossierRow>(`SELECT * FROM dossiers WHERE id = $1`, [page.dossier_id]);
    if (!d) throw errNotFound();
    if (d.state === "replaced") {
      const newer = await one<{ made_at: string }>(`SELECT made_at FROM dossiers WHERE style_id = $1 AND state IN ('ready','signedOff') ORDER BY made_at DESC LIMIT 1`, [d.style_id]);
      throw errNewerDossier(COPY.newerDossier(shownTime(new Date(newer?.made_at ?? d.made_at), "Europe/Lisbon")));
    }
    if (d.state === "signedOff") throw errConflict(COPY.alreadySigned);
    const signedAt = instantOf(new Date());
    await rows(`UPDATE dossiers SET state = 'signedOff', signed_off_by = $1, signed_off_at = $2 WHERE id = $3`, [name, signedAt, d.id]);
    return {
      id: d.id,
      state: "signedOff",
      styleName: (await one<{ name: string }>(`SELECT name FROM styles WHERE id = $1`, [d.style_id]))?.name ?? "",
      madeAt: d.made_at,
      signedOffBy: name,
      signedOffAt: signedAt,
    };
  });

  app.get("/api/styles/:id/results-file", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    await checkDownloadRate(deskId, app.state.config.fileRateWindowSeconds);
    const style = await styleOfDesk(deskId, id);
    const label = await one<{ name: string }>(`SELECT name FROM labels WHERE id = $1`, [style.label_id]);
    const results = await rows<{ edition: string; worked_out_at: string; data_quality_percent: number; data_quality_grade: string; measures: { measure: string; totalShown: string }[] }>(
      `SELECT edition, worked_out_at, data_quality_percent, data_quality_grade, measures FROM results WHERE style_id = $1 ORDER BY worked_out_at DESC, id DESC`,
      [id],
    );
    const suppliers = await suppliersOf(style.id, deskId);
    const header = ["style", "gtin", "label", "suppliers", "notes", "edition", "workedOutAt", "climate", "water", "fossilEnergy", "landUse", "freshwaterToxicity", "microfibres", "dataQualityPercent", "dataQualityGrade"];
        const cells = (values: string[]): string => values.map((v) => `"${v.replace(/"/g, '""')}"`).join(",");
    const body = results.map((r) => {
      const measures = new Map(r.measures.map((m) => [m.measure, m.totalShown]));
      return [
        style.name,
        style.gtin,
        label?.name ?? "",
        suppliers.join("; "),
        style.notes ?? "",
        r.edition,
        r.worked_out_at,
        measures.get("climate") ?? "",
        measures.get("water") ?? "",
        measures.get("fossilEnergy") ?? "",
        measures.get("landUse") ?? "",
        measures.get("freshwaterToxicity") ?? "",
        measures.get("microfibres") ?? "",
        String(r.data_quality_percent),
        r.data_quality_grade,
      ];
    });
    const guard = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
    const allLines = [cells(header.map(guard)), ...body.map((r) => cells(r.map(guard)))];
    reply.header("Content-Type", "text/csv; charset=utf-8");
    return allLines.join("\r\n") + "\r\n";
  });

  app.get("/api/evidence/:id/file", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    await checkDownloadRate(deskId, app.state.config.fileRateWindowSeconds);
    const ev = await one<{ id: string; desk_id: string; request_id: string; file_name: string; content_type: string }>(
      `SELECT * FROM evidence WHERE id = $1`,
      [id],
    );
    if (!ev || ev.desk_id !== deskId) throw errNotFound();
    const key = evidenceKey(ev.desk_id, ev.request_id, ev.id);
    let bytes: Buffer;
    try {
      bytes = await app.state.files.get(key);
    } catch {
      throw errFileStoreUnavailable();
    }
    reply.header("Content-Type", ev.content_type);
    reply.header("Content-Disposition", `attachment; filename="${ev.file_name.replace(/"/g, "")}"`);
    return reply.send(bytes);
  });
}

interface DossierRow {
  id: string;
  style_id: string;
  result_id: string;
  desk_id: string;
  edition: string;
  state: string;
  made_at: string;
  signed_off_by: string | null;
  signed_off_at: string | null;
  pdf_key: string | null;
}

export function dossierOut(d: DossierRow): unknown {
  return {
    id: d.id,
    styleId: d.style_id,
    resultId: d.result_id,
    edition: d.edition,
    state: d.state,
    madeAt: d.made_at,
    signedOffBy: d.signed_off_by,
    signedOffAt: d.signed_off_at,
  };
}

async function suppliersOf(styleId: string, deskId: string): Promise<string[]> {
  const lines = await linesOfStyle(styleId);
  const names: string[] = [];
  for (const line of lines.slice().sort((a, b) => a.position - b.position)) {
    for (const t of [line.tier1_factory, line.tier2_factory, line.tier3_factory]) {
      if (t && !names.includes(t)) names.push(t);
    }
  }
  const reqs = await rows<{ supplier_name: string }>(
    `SELECT supplier_name FROM requests WHERE style_id = $1 AND desk_id = $2 ORDER BY sent_at ASC`,
    [styleId, deskId],
  );
  for (const r of reqs) {
    if (!names.includes(r.supplier_name)) names.push(r.supplier_name);
  }
  return names;
}

/** The dossier's HTML, with styles and fonts inline, holding the published facts and no supplier contact details. */
export function dossierHtml(
  styleName: string,
  labelName: string,
  edition: string,
  grade: string,
  percent: number,
  measures: { measure: string; totalShown: string; stages: { stage: string; shown: string }[] }[],
): string {
  const rowsHtml = measures
    .map((m) => {
      const stageCells = m.stages.map((s) => `<td>${s.shown}</td>`).join("");
      return `<tr><td>${escapeHtml(measureLabel(m.measure))}</td>${stageCells}<td>${escapeHtml(m.totalShown)}</td></tr>`;
    })
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; margin: 24pt; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #999; padding: 4pt 8pt; text-align: left; }
</style>
</head>
<body>
<h1>${escapeHtml(styleName)}</h1>
<p>${escapeHtml(labelName)}</p>
<table>
<thead><tr><th>Measure</th><th>Materials</th><th>Making</th><th>Transport</th><th>Use</th><th>End of life</th><th>Total</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
<p>Factor edition ${escapeHtml(edition)}</p>
<p>Data quality ${escapeHtml(grade)} (${percent}%)</p>
</body>
</html>`;
}

function measureLabel(measure: string): string {
  return MEASURE_LABELS[measure as keyof typeof MEASURE_LABELS] ?? measure;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
