import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { newId, newToken } from "../engine/ids.js";
import {
  addSeconds,
  endOfDayInstant,
  instantOf,
  isValidLocalDate,
  localDateOf,
  shownTime,
  TOWNS,
  type TownId,
} from "../engine/time.js";
import { requireDesk } from "../app.js";
import { errConflict, errNotFound, errRateLimited, errValidation } from "./errors.js";
import { ANSWER_COPY, COPY, MAIL_COPY, type Lang } from "../engine/copy.js";
import { one, rows } from "../db/pool.js";
import { REQUESTS_PER_WINDOW } from "../config/env.js";
import { styleOfDesk } from "./styles.js";

interface RequestRow {
  style_name?: string;
  id: string;
  desk_id: string;
  style_id: string;
  line_id: string;
  supplier_id: string;
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
  reminded_at: string | null;
  answered_at: string | null;
  token: string | null;
  token_ends_at: string | null;
}

async function requestOfDesk(deskId: string, requestId: string): Promise<RequestRow> {
  const r = await one<RequestRow>(`SELECT * FROM requests WHERE id = $1`, [requestId]);
  if (!r || r.desk_id !== deskId) throw errNotFound();
  return r;
}

export function requestOut(
  r: RequestRow,
  answer: unknown,
  answerAddress: string | null,
  townName: string,
): unknown {
  return {
    id: r.id,
    styleId: r.style_id,
    lineId: r.line_id,
    styleName: r.style_name,
    supplierName: r.supplier_name,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    town: r.town,
    townName,
    language: r.language,
    questions: r.questions,
    dueDate: r.due_date,
    state: r.state,
    sentAt: r.sent_at,
    endsAt: r.ends_at,
    remindedAt: r.reminded_at,
    answeredAt: r.answered_at,
    answer,
    answerAddress,
  };
}

export function townNameOf(town: string): string {
  return TOWNS[town as TownId]?.name ?? town;
}

export async function answerOfRequest(requestId: string): Promise<unknown | null> {
  const a = await one<{
    request_id: string; energy_value: string | null; energy_unit: string | null; energy_mj: string | null;
    water_l: string | null; fibre_origin: string | null; evidence_ids: string[]; answered_at: string;
  }>(`SELECT * FROM answers WHERE request_id = $1`, [requestId]);
  if (!a) return null;
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

/** Ladder step 3: the request rate limit, keyed on the desk and never the network address. */
export async function checkRequestRate(deskId: string, windowSeconds: number): Promise<void> {
  const now = instantOf(new Date());
  const from = instantOf(addSeconds(new Date(), -windowSeconds));
  const recent = await rows<{ at: string }>(
    `SELECT at FROM rate_requests WHERE desk_id = $1 AND kind = 'request' AND at > $2 ORDER BY at ASC`,
    [deskId, from],
  );
  if (recent.length >= REQUESTS_PER_WINDOW) {
    const oldest = recent[0].at;
    const retryAfter = Math.max(1, Math.ceil((Date.parse(oldest) + windowSeconds * 1000 - Date.parse(now)) / 1000));
    const retryAt = instantOf(addSeconds(new Date(), retryAfter));
    throw errRateLimited(retryAfter, COPY.tooManyRequests(shownTime(new Date(retryAt), "Europe/Lisbon")));
  }
  await rows(`INSERT INTO rate_requests (desk_id, at, kind) VALUES ($1,$2,'request')`, [deskId, now]);
}

export async function registerRequestRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/requests", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const query = req.query as Record<string, string>;
    const state = query.state ?? "";
    const list = await rows<RequestRow & { style_name: string }>(
      `SELECT r.*, s.name AS style_name FROM requests r JOIN styles s ON s.id = r.style_id
       WHERE r.desk_id = $1 ORDER BY r.sent_at DESC`,
      [deskId],
    );
    const now = instantOf(new Date());
    const out = [];
    for (const r of list) {
      let stateNow = r.state;
      if (stateNow === "sent" || stateNow === "reminded") {
        if (r.token_ends_at !== null && r.token_ends_at <= now && r.answered_at === null) stateNow = "ended";
      }
      if (state.length > 0 && stateNow !== state) continue;
      const answer = await answerOfRequest(r.id);
      out.push(requestOut({ ...r, state: stateNow }, answer, r.token ? `/a/${r.token}` : null, townNameOf(r.town)));
    }
    return { requests: out };
  });

  app.post("/api/requests", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    await checkRequestRate(deskId, app.state.config.requestRateWindowSeconds);
    const body = req.body as Record<string, unknown>;
    const styleId = typeof body?.styleId === "string" ? body.styleId : "";
    const lineId = typeof body?.lineId === "string" ? body.lineId : "";
    const supplierName = typeof body?.supplierName === "string" ? body.supplierName : "";
    const contactName = typeof body?.contactName === "string" ? body.contactName : "";
    const contactEmail = typeof body?.contactEmail === "string" ? body.contactEmail : "";
    const town = typeof body?.town === "string" ? body.town : "";
    const language = typeof body?.language === "string" ? body.language : "en";
    const dueDate = typeof body?.dueDate === "string" ? body.dueDate : "";
    const questionsRaw = body?.questions;
    const fields: Record<string, string> = {};
    const style = await styleOfDesk(deskId, styleId);
    if (style.state === "archived") fields.styleId = COPY.archivedStyle;
    const line = await one<{ id: string; style_id: string }>(`SELECT id, style_id FROM lines WHERE id = $1 AND style_id = $2`, [lineId, styleId]);
    if (!line) fields.lineId = COPY.emptyField;
    if (supplierName.length === 0 || supplierName.length > 120) fields.supplierName = COPY.emptyField;
    if (contactName.length === 0 || contactName.length > 120) fields.contactName = COPY.emptyField;
    if (contactEmail.length === 0) fields.contactEmail = COPY.emptyField;
    if (!["porto", "izmir", "hoChiMinhCity", "cairo"].includes(town)) fields.town = COPY.emptyField;
    if (!["en", "fr", "tr", "ar"].includes(language)) fields.language = COPY.emptyField;
    if (!isValidLocalDate(dueDate)) fields.dueDate = COPY.dateForm;
    const questions = Array.isArray(questionsRaw)
      ? (questionsRaw as unknown[]).filter((q): q is string => typeof q === "string")
      : [];
    const validQuestions = questions.filter((q) => ["energy", "water", "fibreOrigin"].includes(q));
    if (validQuestions.length === 0) fields.questions = COPY.emptyField;
    if (Object.keys(fields).length === 0) {
      const zone = TOWNS[town as TownId].zone;
      const todayLocal = localDateOf(new Date(), zone);
      if (dueDate < todayLocal) {
        fields.dueDate = COPY.dueDatePast(townNameOf(town));
      }
    }
    if (Object.keys(fields).length > 0) throw errValidation(fields);
    if (style.state === "published" || style.state === "worked" || style.state === "draft") {
      // any state but archived accepts a request
    }
    const label = await one<{ id: string; state: string; name: string }>(`SELECT id, state, name FROM labels WHERE id = $1`, [style.label_id]);
    if (!label) throw errNotFound();
    if (label.state !== "open") throw errConflict(COPY.closedLabel);

    // Find or create the supplier on the style's label by exact name.
    let supplierId = (await one<{ id: string }>(`SELECT id FROM suppliers WHERE label_id = $1 AND name = $2`, [style.label_id, supplierName]))?.id;
    if (!supplierId) {
      supplierId = newId();
      await rows(
        `INSERT INTO suppliers (id, label_id, name, town, language, contact_name, contact_email) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [supplierId, style.label_id, supplierName, town, language, contactName, contactEmail],
      );
    } else {
      await rows(
        `UPDATE suppliers SET town = $1, language = $2, contact_name = $3, contact_email = $4 WHERE id = $5`,
        [town, language, contactName, contactEmail, supplierId],
      );
    }

    const requestId = newId();
    const token = newToken();
    const now = new Date();
    const sentAt = instantOf(now);
    const zone = TOWNS[town as TownId].zone;
    const dueEnd = endOfDayInstant(dueDate, zone);
    const answerEnd = instantOf(addSeconds(now, app.state.config.answerPageSeconds));
    const endsAt = dueEnd.toISOString() < answerEnd ? instantOf(dueEnd) : answerEnd;
    await rows(
      `INSERT INTO requests (id, desk_id, style_id, line_id, supplier_id, supplier_name, contact_name, contact_email, town, language, questions, due_date, state, sent_at, ends_at, token, token_ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'sent',$13,$14,$15,$14)`,
      [requestId, deskId, styleId, lineId, supplierId, supplierName, contactName, contactEmail, town, language, validQuestions, dueDate, sentAt, endsAt, token],
    );
    await queueRequestMail(app, {
      lang: language as Lang,
      contactName,
      contactEmail,
      labelName: label.name,
      styleName: style.name,
      town: townNameOf(town),
      dueDate,
      address: `${app.state.config.appPublicUrl}/a/${token}`,
      reminder: false,
    });
    reply.status(201);
    const saved = await requestOfDesk(deskId, requestId);
    const styleName = (await one<{ name: string }>(`SELECT name FROM styles WHERE id = $1`, [styleId]))?.name ?? "";
    return requestOut({ ...saved, style_name: styleName }, null, `/a/${token}`, townNameOf(town));
  });

  app.get("/api/requests/:id", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const r = await one<RequestRow & { style_name: string }>(
      `SELECT r.*, s.name AS style_name FROM requests r JOIN styles s ON s.id = r.style_id WHERE r.id = $1`,
      [id],
    );
    if (!r || r.desk_id !== deskId) throw errNotFound();
    const answer = await answerOfRequest(r.id);
    return requestOut(r, answer, r.token ? `/a/${r.token}` : null, townNameOf(r.town));
  });

  app.post("/api/requests/:id/new-address", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    await checkRequestRate(deskId, app.state.config.requestRateWindowSeconds);
    const { id } = req.params as { id: string };
    const r = await requestOfDesk(deskId, id);
    if (r.answered_at !== null) throw errConflict(COPY.requestAnswered);
    const style = await one<{ name: string; label_id: string }>(`SELECT name, label_id FROM styles WHERE id = $1`, [r.style_id]);
    const label = await one<{ id: string; name: string }>(`SELECT id, name FROM labels WHERE id = $1`, [style?.label_id ?? ""]);
    const token = newToken();
    const now = new Date();
    const zone = TOWNS[r.town as TownId].zone;
    const dueEnd = endOfDayInstant(r.due_date, zone);
    const answerEnd = instantOf(addSeconds(now, app.state.config.answerPageSeconds));
    const endsAt = dueEnd.toISOString() < answerEnd ? instantOf(dueEnd) : answerEnd;
    await rows(`UPDATE requests SET token = $1, token_ends_at = $2, state = 'sent', sent_at = $3, reminded_at = NULL WHERE id = $4`, [
      token, endsAt, instantOf(now), id,
    ]);
    await queueRequestMail(app, {
      lang: r.language as Lang,
      contactName: r.contact_name,
      contactEmail: r.contact_email,
      labelName: label?.name ?? "",
      styleName: style?.name ?? "",
      town: townNameOf(r.town),
      dueDate: r.due_date,
      address: `${app.state.config.appPublicUrl}/a/${token}`,
      reminder: false,
    });
    reply.status(201);
    const after = await requestOfDesk(deskId, id);
    return requestOut({ ...after, style_name: style?.name ?? "" }, await answerOfRequest(id), `/a/${token}`, townNameOf(after.town));
  });

  app.post("/api/requests/:id/end", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const r = await requestOfDesk(deskId, id);
    if (r.answered_at !== null) throw errConflict(COPY.requestAnswered);
    await rows(`UPDATE requests SET state = 'ended', token = NULL, token_ends_at = $1 WHERE id = $2`, [
      instantOf(new Date()), id,
    ]);
    const after = await requestOfDesk(deskId, id);
    const styleName = (await one<{ name: string }>(`SELECT name FROM styles WHERE id = $1`, [r.style_id]))?.name ?? "";
    return requestOut({ ...after, style_name: styleName }, await answerOfRequest(id), null, townNameOf(after.town));
  });
}

export async function queueRequestMail(
  app: import("fastify").FastifyInstance,
  data: {
    lang: Lang; contactName: string; contactEmail: string; labelName: string; styleName: string;
    town: string; dueDate: string; address: string; reminder: boolean;
  },
): Promise<void> {
  const copy = ANSWER_COPY[data.lang];
  const mail = MAIL_COPY[data.lang];
  const dueLine = copy.dueLine
    .replace("<dueDate>", data.dueDate)
    .replace("<town>", data.town);
  const subject = (data.reminder ? mail.reminderSubject : mail.requestSubject).replace("<labelName>", data.labelName);
  const body = [
    mail.greeting.replace("<contactName>", data.contactName),
    "",
    mail.ask.replace("<labelName>", data.labelName).replace("<styleName>", data.styleName),
    "",
    data.address,
    "",
    dueLine,
  ].join("\n");
  const { queueMail } = await import("../services/mailer.js");
  await queueMail(data.contactEmail, subject, body);
}

/** The published state of a request as read on the desk, with the page-end rule applied. */
export async function requestStateNow(r: RequestRow, now: string): Promise<string> {
  if (r.answered_at !== null) return "answered";
  if (r.state === "ended") return "ended";
  if (r.token_ends_at !== null && r.token_ends_at <= now) return "ended";
  return r.state;
}
