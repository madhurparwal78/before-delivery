import { COUNTRIES, LANGUAGES, TOWNS, townName, townZone, type Language } from "../../shared/catalog";
import { ANSWER_COPY } from "../../shared/copy";
import type { AnswerPage } from "../../shared/api";
import { instantText, isRealDate, localDate, wallToInstant } from "../../shared/time";
import { now, pool, transaction, type Queryable, type DbRow } from "../db";
import { ApiError, conflict, fieldErrors, multipartFile, notFound, ok, publicAddress, route, type Call, type Session } from "../http";
import { isEnergyUnit, plain, readLocalNumber, toMegajoules } from "../figures";
import { readObject, storeObject } from "../providers";
import { rateSpend, spendDownload } from "../rate";
import {
  answerPageFor,
  assertWritable,
  evidenceKey,
  footprintInputs,
  instant,
  insertResult,
  latestResultRow,
  legsOf,
  linesOf,
  loadStyle,
  newId,
  newToken,
  object,
  pageEnd,
  requestJson,
  requestMail,
  requestState,
  touchStyle,
} from "../domain";

const EMPTY = "Give a value here.";
const QUESTIONS = ["energy", "water", "fibreOrigin"];

const desk = (call: Call): string => (call.session as Session).assessorId;

const REQUEST_SELECT = `SELECT r.*, s.name AS style_name FROM requests r JOIN styles s ON s.id = r.style_id`;

async function loadRequest(db: Queryable, assessorId: string, id: string): Promise<DbRow> {
  const { rows } = await db.query(`${REQUEST_SELECT} WHERE r.id = $1 AND r.assessor_id = $2`, [id, assessorId]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

function dueEnd(dueDate: string, town: string): Date {
  return wallToInstant(dueDate, "23:59:59", townZone(town)) as Date;
}

interface MailFacts {
  contact_name: string;
  contact_email: string;
  town: string;
  language: Language;
  due_date: string;
}

async function queueRequestMail(
  tx: Queryable,
  labelId: string,
  labelName: string,
  styleName: string,
  request: MailFacts,
  token: string,
  kind: "request" | "reminder",
): Promise<void> {
  const { subject, body } = requestMail(
    request.language,
    kind,
    { label: labelName, style: styleName, contact: request.contact_name, town: townName(request.town) },
    publicAddress(`/a/${token}`),
    request.due_date,
  );
  await tx.query(`INSERT INTO mail_queue (label_id, recipient, subject, body) VALUES ($1, $2, $3, $4)`, [labelId, request.contact_email, subject, body]);
}

route("GET", "/api/requests", {
  handle: async (call) => {
    const { rows } = await pool.query(`${REQUEST_SELECT} WHERE r.assessor_id = $1 ORDER BY r.seq`, [desk(call)]);
    const wanted = call.query.get("state");
    const requests = rows.map(requestJson).filter((request) => !wanted || request.state === wanted);
    return ok({ requests });
  },
});

function requestFieldProblems(body: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of ["supplierName", "contactName"]) {
    if (typeof body[key] !== "string" || !(body[key] as string).trim()) fields[key] = EMPTY;
  }
  if (typeof body.contactEmail !== "string" || !/^[^\s@]+@[^\s@]+$/.test(body.contactEmail)) fields.contactEmail = EMPTY;
  const townKnown = TOWNS.some((town) => town.id === body.town);
  if (!townKnown) fields.town = EMPTY;
  if (!LANGUAGES.some((language) => language.id === body.language)) fields.language = EMPTY;
  if (!Array.isArray(body.questions) || !body.questions.length || !body.questions.every((question) => QUESTIONS.includes(question))) {
    fields.questions = EMPTY;
  }
  if (typeof body.dueDate !== "string" || !isRealDate(body.dueDate)) {
    fields.dueDate = "Give the date as YYYY-MM-DD.";
  } else if (townKnown && body.dueDate < localDate(now(), townZone(body.town as string))) {
    fields.dueDate = `The due date must be today or later in ${townName(body.town as string)}.`;
  }
  return fields;
}

route("POST", "/api/requests", {
  input: "json",
  rate: "request",
  handle: async (call) => {
    const body = object(call.body);
    if (typeof body.styleId !== "string" || !body.styleId) throw fieldErrors({ styleId: EMPTY, ...requestFieldProblems(body) });
    const style = await loadStyle(pool, desk(call), body.styleId);
    if (typeof body.lineId !== "string" || !body.lineId) throw fieldErrors({ lineId: EMPTY, ...requestFieldProblems(body) });
    const line = await pool.query(`SELECT id FROM lines WHERE id = $1 AND style_id = $2`, [body.lineId, style.id]);
    if (!line.rows[0]) throw notFound();
    const fields = requestFieldProblems(body);
    if (Object.keys(fields).length) throw fieldErrors(fields);
    assertWritable(style);
    const id = newId();
    const token = newToken();
    const sentAt = now();
    const row = {
      contact_name: body.contactName as string,
      contact_email: body.contactEmail as string,
      town: body.town as string,
      language: body.language as Language,
      due_date: body.dueDate as string,
    };
    await transaction(async (tx) => {
      await rateSpend(tx, desk(call), "request");
      await tx.query(
        `INSERT INTO suppliers (id, label_id, name, town, language, contact_name, contact_email) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (label_id, name) DO UPDATE SET town = EXCLUDED.town, language = EXCLUDED.language, contact_name = EXCLUDED.contact_name, contact_email = EXCLUDED.contact_email`,
        [newId(), style.label_id, body.supplierName, row.town, row.language, row.contact_name, row.contact_email],
      );
      await tx.query(
        `INSERT INTO requests (id, assessor_id, style_id, line_id, supplier_name, contact_name, contact_email, town, language, questions, due_date, token, sent_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [id, desk(call), style.id, body.lineId, body.supplierName, row.contact_name, row.contact_email, row.town, row.language, JSON.stringify(body.questions), row.due_date, token, sentAt, pageEnd(dueEnd(row.due_date, row.town), sentAt)],
      );
      await tx.query(`INSERT INTO request_pages (token, request_id) VALUES ($1, $2)`, [token, id]);
      await queueRequestMail(tx, style.label_id, style.label_name, style.name, row, token, "request");
    });
    return ok(requestJson(await loadRequest(pool, desk(call), id)), 201);
  },
});

const theRequest = (call: Call): Promise<DbRow> => loadRequest(pool, desk(call), call.params[0] as string);

route("GET", "/api/requests/:id", {
  resource: theRequest,
  handle: async (_call, request) => ok(requestJson(request)),
});

route("POST", "/api/requests/:id/new-address", {
  input: "emptyOrJson",
  rate: "request",
  resource: theRequest,
  handle: async (call, request) => {
    if (request.answered_at) throw conflict("This request has been answered.");
    const style = await loadStyle(pool, desk(call), request.style_id);
    assertWritable(style);
    const token = newToken();
    const sentAt = now();
    await transaction(async (tx) => {
      await rateSpend(tx, desk(call), "request");
      // Under the row's lock: an answer that got in first keeps the request answered.
      const held = await tx.query(`SELECT answered_at FROM requests WHERE id = $1 FOR UPDATE`, [request.id]);
      if (held.rows[0].answered_at) throw conflict("This request has been answered.");
      await tx.query(`INSERT INTO request_pages (token, request_id) VALUES ($1, $2)`, [token, request.id]);
      await tx.query(
        `UPDATE requests SET token = $2, sent_at = $3, ends_at = $4, ended = false, reminded_at = NULL WHERE id = $1`,
        [request.id, token, sentAt, pageEnd(dueEnd(request.due_date, request.town), sentAt)],
      );
      const facts: MailFacts = {
        contact_name: request.contact_name,
        contact_email: request.contact_email,
        town: request.town,
        language: request.language,
        due_date: request.due_date,
      };
      await queueRequestMail(tx, style.label_id, style.label_name, style.name, facts, token, "request");
    });
    return ok(requestJson(await loadRequest(pool, desk(call), request.id)), 201);
  },
});

route("POST", "/api/requests/:id/end", {
  input: "emptyOrJson",
  resource: theRequest,
  handle: async (call, request) => {
    if (request.answered_at) throw conflict("This request has been answered.");
    assertWritable(await loadStyle(pool, desk(call), request.style_id));
    await pool.query(`UPDATE requests SET ended = true WHERE id = $1`, [request.id]);
    return ok(requestJson(await loadRequest(pool, desk(call), request.id)));
  },
});

// ---- the private answer page

function pageEnded(language: Language): ApiError {
  return new ApiError(410, "page_ended", ANSWER_COPY[language].ended);
}

const thePage = async (call: Call): Promise<DbRow> => {
  const page = await answerPageFor(pool, call.params[0] as string);
  if (page.kind === "none") throw notFound();
  if (page.kind === "ended") throw pageEnded(page.language);
  return page.row;
};

export function answerPageJson(row: DbRow): AnswerPage {
  return {
    language: row.language,
    supplierName: row.supplier_name,
    labelName: row.label_name,
    styleName: row.style_name,
    town: row.town,
    townName: townName(row.town),
    questions: row.questions,
    dueDate: row.due_date,
    endsAt: instantText(row.ends_at),
    state: requestState(row) as AnswerPage["state"],
    answeredAt: instant(row.answered_at),
  };
}

route("GET", "/api/a/:token", {
  auth: false,
  resource: thePage,
  handle: async (_call, row) => ok(answerPageJson(row)),
});

/** Judged by content only: the first bytes are the signature. */
function contentTypeOf(data: Buffer): string | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

route("POST", "/api/a/:token/evidence", {
  auth: false,
  input: "multipart",
  resource: thePage,
  handle: async (call, row) => {
    const copy = ANSWER_COPY[row.language as Language];
    const file = multipartFile(call.raw, call.request.headers["content-type"] ?? "");
    if (!file) throw new ApiError(415, "unsupported_media_type", copy.fileType);
    const contentType = contentTypeOf(file.data);
    if (!contentType) throw new ApiError(415, "unsupported_media_type", copy.fileType);
    const id = newId();
    const key = evidenceKey(row.assessor_id, row.id, id);
    await storeObject(key, file.data, copy.storeDown);
    await pool.query(
      `INSERT INTO evidence (id, request_id, assessor_id, file_name, size_bytes, content_type, object_key) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, row.id, row.assessor_id, file.fileName, file.data.length, contentType, key],
    );
    return ok({ evidenceId: id, fileName: file.fileName, sizeBytes: file.data.length, contentType }, 201);
  },
});

interface ReadAnswer {
  energyValue: string | null;
  energyUnit: string | null;
  energyMjPerKg: string | null;
  waterLitresPerKg: string | null;
  fibreOrigin: string | null;
  evidenceIds: string[];
}

async function readAnswer(body: Record<string, unknown>, row: DbRow): Promise<ReadAnswer> {
  const language = row.language as Language;
  const copy = ANSWER_COPY[language];
  const asked = row.questions as string[];
  const fields: Record<string, string> = {};
  const answer: ReadAnswer = { energyValue: null, energyUnit: null, energyMjPerKg: null, waterLitresPerKg: null, fibreOrigin: null, evidenceIds: [] };

  const readNumber = (key: string, typed: unknown) => {
    if (typeof typed === "string" && !typed.trim()) {
      fields[key] = copy.empty;
      return null;
    }
    const value = typeof typed === "string" ? readLocalNumber(typed, language) : null;
    if (!value) fields[key] = copy.number;
    return value;
  };

  if (asked.includes("energy") && body.energy !== undefined) {
    const energy = object(body.energy ?? {});
    const value = readNumber("energy.value", energy.value);
    if (!isEnergyUnit(energy.unit)) fields["energy.unit"] = copy.empty;
    else if (value) {
      answer.energyValue = plain(value);
      answer.energyUnit = energy.unit;
      answer.energyMjPerKg = plain(toMegajoules(value, energy.unit));
    }
  }
  if (asked.includes("water") && body.water !== undefined) {
    const value = readNumber("water.value", object(body.water ?? {}).value);
    if (value) answer.waterLitresPerKg = plain(value);
  }
  if (asked.includes("fibreOrigin") && body.fibreOrigin !== undefined) {
    if (COUNTRIES.some((country) => country.id === body.fibreOrigin)) answer.fibreOrigin = body.fibreOrigin as string;
    else fields.fibreOrigin = copy.empty;
  }
  if (!Object.keys(fields).length && !answer.energyValue && !answer.waterLitresPerKg && !answer.fibreOrigin) {
    const first = asked[0] as string;
    fields[first === "fibreOrigin" ? first : `${first}.value`] = copy.empty;
  }
  if (body.evidenceIds !== undefined) {
    const ids = Array.isArray(body.evidenceIds) ? (body.evidenceIds as unknown[]) : [null];
    const held = await pool.query(`SELECT id FROM evidence WHERE request_id = $1`, [row.id]);
    const known = new Set(held.rows.map((entry) => entry.id as string));
    if (ids.every((id) => typeof id === "string" && known.has(id))) answer.evidenceIds = ids as string[];
    else fields.evidenceIds = copy.fileType;
  }
  if (Object.keys(fields).length) throw fieldErrors(fields);
  return answer;
}

route("POST", "/api/a/:token/answers", {
  auth: false,
  input: "json",
  resource: thePage,
  replay: async (_call, row) => (row.answered_at ? ok(row.answer) : null),
  handle: async (call, row) => {
    const answer = await readAnswer(object(call.body), row);
    return transaction(async (tx) => {
      const style = await loadStyle(tx, row.assessor_id, row.style_id, true);
      const recheck = await tx.query(`SELECT answer, token, ended FROM requests WHERE id = $1 FOR UPDATE`, [row.id]);
      if (recheck.rows[0].answer) return ok(recheck.rows[0].answer);
      // A new address or an end that got in first has ended this page.
      if (recheck.rows[0].ended || recheck.rows[0].token !== call.params[0]) throw pageEnded(row.language as Language);
      const at = now();
      const stored = { ...answer, answeredAt: instantText(at), state: "answered" };
      await tx.query(`UPDATE requests SET answered_at = $2, answer = $3 WHERE id = $1`, [row.id, at, JSON.stringify(stored)]);
      if (row.line_id) {
        await tx.query(
          `UPDATE lines SET
             energy_mj_per_kg = COALESCE($2, energy_mj_per_kg),
             water_litres_per_kg = COALESCE($3, water_litres_per_kg),
             fibre_origin = COALESCE($4, fibre_origin),
             tier3 = CASE WHEN $4::text IS NULL THEN tier3
                          ELSE COALESCE(tier3, '{"factory":"","town":""}'::jsonb) || jsonb_build_object('country', $4::text) END
           WHERE id = $1`,
          [row.line_id, answer.energyMjPerKg, answer.waterLitresPerKg, answer.fibreOrigin],
        );
      }
      await touchStyle(tx, row.style_id, row.supplier_name, true);
      const latest = await latestResultRow(tx, row.style_id);
      if (latest) {
        const lines = await linesOf(tx, row.style_id);
        if (lines.every((line) => line.tier1?.country)) {
          const inputs = footprintInputs(lines, await legsOf(tx, row.style_id), style.washes);
          await insertResult(tx, style, latest.edition, latest.edition_valid_from, latest.kept_rows, inputs, at);
        }
      }
      return ok(stored, 201);
    });
  },
});

route("GET", "/api/evidence/:id/file", {
  rate: "download",
  resource: async (call) => {
    const { rows } = await pool.query(`SELECT * FROM evidence WHERE id = $1 AND assessor_id = $2`, [call.params[0], desk(call)]);
    if (!rows[0]) throw notFound();
    return rows[0] as DbRow;
  },
  handle: async (call, evidence) => {
    const bytes = await readObject(evidence.object_key);
    await spendDownload(desk(call));
    return {
      status: 200,
      bytes,
      headers: {
        "Content-Type": evidence.content_type,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(evidence.file_name)}"`,
      },
    };
  },
});
