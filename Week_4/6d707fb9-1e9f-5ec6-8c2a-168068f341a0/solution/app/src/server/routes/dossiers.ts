import { readFileSync } from "node:fs";
import { MEASURE_NAMES, STAGE_NAMES } from "../../shared/catalog";
import type { Measure, Result, SignOffPage } from "../../shared/api";
import { instantText, shownDate, wallTime } from "../../shared/time";
import { config } from "../config";
import { now, pool, transaction, type Queryable, type DbRow } from "../db";
import { ApiError, conflict, fieldErrors, notFound, ok, publicAddress, route, type Answer, type Call, type Session } from "../http";
import { addSeconds } from "../figures";
import { fileStoreUnavailable, readObject, renderPdf, storeObject } from "../providers";
import { spendDownload } from "../rate";
import {
  assertWritable,
  dossierJson,
  dossierKey,
  instant,
  latestResultRow,
  loadStyle,
  newId,
  newToken,
  pastEnd,
  resultJson,
  suppliersOf,
  type StyleRecord,
} from "../domain";

const desk = (call: Call): string => (call.session as Session).assessorId;
const theStyle = (call: Call): Promise<StyleRecord> => loadStyle(pool, desk(call), call.params[0] as string);

const FONT_DIR = new URL("./assets/fonts/", import.meta.url);

function fontFace(file: string, family: string, weight: number): string {
  const data = readFileSync(new URL(file, FONT_DIR)).toString("base64");
  return `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/woff2;base64,${data}) format("woff2");}`;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The dossier's HTML with its styles and fonts inline; Gotenberg never fetches an address. */
function dossierHtml(style: Pick<StyleRecord, "name" | "gtin" | "label_name">, result: Result): string {
  const tables = (result.measures as Measure[])
    .map(
      (measure) => `<section><h2>${MEASURE_NAMES[measure.measure]}: ${escapeHtml(measure.totalShown)}</h2><table><thead><tr><th>Stage</th><th>Figure (${escapeHtml(measure.unit)})</th><th>Share</th></tr></thead><tbody>${measure.stages
        .map((stage) => `<tr><td>${STAGE_NAMES[stage.stage]}</td><td>${escapeHtml(stage.shown)}</td><td>${stage.share}%</td></tr>`)
        .join("")}</tbody></table></section>`,
    )
    .join("");
  const fonts = [
    fontFace("sora-latin-300-normal.woff2", "Sora", 300),
    fontFace("sora-latin-400-normal.woff2", "Sora", 400),
    fontFace("sora-latin-ext-400-normal.woff2", "Sora", 400),
    fontFace("noto-sans-figures-400-normal.woff2", "Noto Sans", 400),
  ].join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(style.name)}</title><style>${fonts}
    body{font-family:"Sora","Noto Sans",sans-serif;color:#2a1d17;font-size:11pt;line-height:1.5;margin:0}
    h1{font-weight:300;font-size:26pt;margin:0 0 8pt}h2{font-weight:400;font-size:13pt;margin:18pt 0 6pt}
    table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:4pt 6pt}
    tbody tr:nth-child(odd){background:#dad5ca}section{break-inside:avoid}</style></head>
    <body><h1>${escapeHtml(style.name)}</h1><p>${escapeHtml(style.label_name)} · GTIN ${style.gtin}</p>
    <p>Factor edition ${escapeHtml(result.edition)}</p><p>Data quality ${result.dataQualityGrade} (${result.dataQualityPercent}%)</p>
    ${tables}<p>These figures are published sums. They are not a legal claim.</p></body></html>`;
}

/** Makes and stores one dossier's PDF: Ready only follows Gotenberg's answer and MinIO's confirmation. */
export async function storeDossierPdf(style: Pick<StyleRecord, "name" | "gtin" | "label_name">, result: Result, assessorId: string, dossierId: string): Promise<void> {
  await storeObject(dossierKey(assessorId, dossierId), await renderPdf(dossierHtml(style, result)));
}

route("POST", "/api/styles/:id/dossiers", {
  input: "emptyOrJson",
  resource: theStyle,
  handle: async (_call, style) => {
    const latest = await latestResultRow(pool, style.id);
    if (!latest) throw conflict("Work out the footprint first.");
    assertWritable(style);
    const id = newId();
    await storeDossierPdf(style, resultJson(latest, latest.id), style.assessor_id, id);
    const made = await transaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO dossiers (id, assessor_id, style_id, result_id, edition, state, made_at, pdf_stored) VALUES ($1, $2, $3, $4, $5, 'ready', $6, true) RETURNING *`,
        [id, style.assessor_id, style.id, latest.id, latest.edition, now()],
      );
      await tx.query(`UPDATE dossiers SET state = 'replaced' WHERE style_id = $1 AND id <> $2 AND state IN ('ready', 'signedOff')`, [style.id, id]);
      return rows[0];
    });
    return ok(dossierJson(made), 201);
  },
});

route("GET", "/api/styles/:id/dossiers", {
  resource: theStyle,
  handle: async (_call, style) => {
    const { rows } = await pool.query(`SELECT * FROM dossiers WHERE style_id = $1 ORDER BY seq DESC`, [style.id]);
    return ok({ dossiers: rows.map(dossierJson) });
  },
});

const theDossier = async (call: Call): Promise<DbRow> => {
  const { rows } = await pool.query(`SELECT * FROM dossiers WHERE id = $1 AND assessor_id = $2`, [call.params[0], desk(call)]);
  if (!rows[0]) throw notFound();
  return rows[0];
};

route("GET", "/api/dossiers/:id", {
  resource: theDossier,
  handle: async (_call, dossier) => ok(dossierJson(dossier)),
});

async function pdfOf(dossier: DbRow): Promise<Answer> {
  if (!dossier.pdf_stored) throw fileStoreUnavailable();
  return {
    status: 200,
    bytes: await readObject(dossierKey(dossier.assessor_id, dossier.id)),
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="dossier-${dossier.id}.pdf"` },
  };
}

route("GET", "/api/dossiers/:id/file", {
  rate: "download",
  resource: theDossier,
  handle: async (call, dossier) => {
    const answer = await pdfOf(dossier);
    await spendDownload(desk(call));
    return answer;
  },
});

async function queueSignOffMail(db: Queryable, labelId: string, recipient: string, contact: string, styleName: string, address: string, endsAt: Date): Promise<void> {
  const body = [
    `Hello ${contact},`,
    `Please read and sign off the dossier for ${styleName} on this private page:`,
    address,
    `This page ends on ${shownDate(endsAt)}, ${wallTime(endsAt)} Lisbon time.`,
  ].join("\n");
  await db.query(`INSERT INTO mail_queue (label_id, recipient, subject, body) VALUES ($1, $2, $3, $4)`, [labelId, recipient, `Dossier to sign off: ${styleName}`, body]);
}

route("POST", "/api/dossiers/:id/sign-off-page", {
  input: "emptyOrJson",
  resource: theDossier,
  handle: async (call, dossier) => {
    const style = await loadStyle(pool, desk(call), dossier.style_id);
    assertWritable(style);
    if (dossier.state !== "ready") throw conflict("Only a ready dossier can be sent for sign-off.");
    const label = (await pool.query(`SELECT contact_name, contact_email FROM labels WHERE id = $1`, [style.label_id])).rows[0];
    const token = newToken();
    const endsAt = addSeconds(now(), config.signOffPageSeconds);
    const address = publicAddress(`/s/${token}`);
    await transaction(async (tx) => {
      await tx.query(`UPDATE sign_off_pages SET ended = true WHERE dossier_id = $1`, [dossier.id]);
      await tx.query(`INSERT INTO sign_off_pages (token, dossier_id, ends_at) VALUES ($1, $2, $3)`, [token, dossier.id, endsAt]);
      await queueSignOffMail(tx, style.label_id, label.contact_email, label.contact_name, style.name, address, endsAt);
    });
    return ok({ signOffAddress: address, endsAt: instantText(endsAt) }, 201);
  },
});

type SignOffLookup = { kind: "none" } | { kind: "ended" } | { kind: "live"; row: DbRow };

export async function signOffPageFor(db: Queryable, token: string): Promise<SignOffLookup> {
  const { rows } = await db.query(
    `SELECT p.token, p.ends_at, p.ended, d.*, s.name AS style_name, s.label_id, l.state AS label_state, r.measures, r.data_quality_percent, r.data_quality_grade
     FROM sign_off_pages p JOIN dossiers d ON d.id = p.dossier_id JOIN styles s ON s.id = d.style_id JOIN labels l ON l.id = s.label_id
     JOIN results r ON r.id = d.result_id WHERE p.token = $1`,
    [token],
  );
  const row = rows[0];
  if (!row) return { kind: "none" };
  if (row.ended || pastEnd(row.ends_at) || row.label_state !== "open") return { kind: "ended" };
  return { kind: "live", row };
}

export function signOffJson(row: DbRow): SignOffPage {
  return {
    dossier: {
      id: row.id,
      state: row.state,
      styleName: row.style_name,
      edition: row.edition,
      dataQualityPercent: row.data_quality_percent,
      dataQualityGrade: row.data_quality_grade,
      measures: row.measures,
      madeAt: instantText(row.made_at),
      signedOffBy: row.signed_off_by,
      signedOffAt: instant(row.signed_off_at),
    },
    endsAt: instantText(row.ends_at),
  };
}

const ENDED_COPY = "This page has ended.";

const theSignOffPage = async (call: Call): Promise<DbRow> => {
  const page = await signOffPageFor(pool, call.params[0] as string);
  if (page.kind === "none") throw notFound();
  if (page.kind === "ended") throw new ApiError(410, "page_ended", ENDED_COPY);
  return page.row;
};

route("GET", "/api/s/:token", {
  auth: false,
  resource: theSignOffPage,
  handle: async (_call, row) => ok(signOffJson(row)),
});

route("GET", "/api/s/:token/file", {
  auth: false,
  resource: theSignOffPage,
  handle: async (_call, row) => pdfOf(row),
});

route("POST", "/api/s/:token/sign", {
  auth: false,
  input: "json",
  resource: theSignOffPage,
  handle: async (call, row) => {
    const name = (call.body as { name?: unknown }).name;
    if (typeof name !== "string" || !name.trim()) throw fieldErrors({ name: "Type your name to sign off." });
    if (row.state === "signedOff") throw conflict("This dossier is already signed off.");
    if (row.state === "replaced") {
      const { rows } = await pool.query(`SELECT made_at FROM dossiers WHERE style_id = $1 ORDER BY seq DESC LIMIT 1`, [row.style_id]);
      throw new ApiError(409, "newer_dossier", `A newer dossier was made at ${wallTime(rows[0].made_at)} Lisbon time. Read it first.`);
    }
    const { rows } = await pool.query(
      `UPDATE dossiers SET state = 'signedOff', signed_off_by = $2, signed_off_at = $3 WHERE id = $1 AND state = 'ready' RETURNING *`,
      [row.id, name.trim(), now()],
    );
    if (!rows[0]) throw conflict("This dossier is already signed off.");
    const page = await signOffPageFor(pool, call.params[0] as string);
    return ok(page.kind === "live" ? signOffJson(page.row).dossier : dossierJson(rows[0]));
  },
});

/** One data row of the results file: any risky cell gets an apostrophe. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

const COLUMNS = "style,gtin,label,suppliers,notes,edition,workedOutAt,climate,water,fossilEnergy,landUse,freshwaterToxicity,microfibres,dataQualityPercent,dataQualityGrade".split(",");

route("GET", "/api/styles/:id/results-file", {
  rate: "download",
  resource: theStyle,
  handle: async (call, style) => {
    const suppliers = (await suppliersOf(pool, style.id)).join("; ");
    const { rows } = await pool.query(`SELECT * FROM results WHERE style_id = $1 ORDER BY seq DESC`, [style.id]);
    const lines = rows.map((row) => {
      const measures = row.measures as Measure[];
      const shown = (id: Measure["measure"]): string => measures.find((measure) => measure.measure === id)?.totalShown ?? "";
      return [
        style.name,
        style.gtin,
        style.label_name,
        suppliers,
        style.notes ?? "",
        row.edition,
        instantText(row.worked_out_at),
        shown("climate"),
        shown("water"),
        shown("fossilEnergy"),
        shown("landUse"),
        shown("freshwaterToxicity"),
        shown("microfibres"),
        String(row.data_quality_percent),
        row.data_quality_grade,
      ].map(csvCell).join(",");
    });
    await spendDownload(desk(call));
    return {
      status: 200,
      text: [COLUMNS.map((column) => `"${column}"`).join(","), ...lines].map((line) => `${line}\r\n`).join(""),
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="results-${style.gtin}.csv"` },
    };
  },
});
