import { EVIDENCE_FILE_LIMIT, config } from '../config';
import { one, query } from '../db/pool';
import { Decimal } from '../domain/decimal';
import { answerCopy, copy } from '../domain/copy';
import { isCountry } from '../domain/factors';
import { type Language, isEnergyUnit, isLanguage, readLocalNumber, toMegajoules } from '../domain/numbers';
import { TOWNS, endOfLocalDay, isRealDate, isTown, localDate } from '../domain/time';
import { newId, newToken, nextSortIndex } from '../ids';
import { problem } from '../http/problem';
import { boundaryOf, contentTypeOfFile, readParts } from '../http/multipart';
import type { Ctx, Reply } from '../http/router';
import { FieldCollector, requiredEmail, requiredText } from '../store/fields';
import { recordRateEvent } from '../store/rate';
import { queueRequestMail } from '../store/mailOut';
import { endPage, readEndedPage } from '../store/endedPages';
import { findStyle, readEvidence, requestShape, requestState } from '../store/read';
import { remakeResultFromKeptRows } from '../store/results';
import { files, FileStoreDown } from '../services/files';
import { bumpVersion, markScoreOutdated } from './styles';
import { labelOfStyle } from './labels';
import type { EvidenceRow, LabelRow, LineRow, RequestRow, StoredAnswer, StyleRowRecord } from '../store/rows';

const QUESTIONS = ['energy', 'water', 'fibreOrigin'] as const;
type Question = (typeof QUESTIONS)[number];

export async function listRequests(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const state = ctx.query.get('state');
  const rows = await query<RequestRow & { style_name: string }>(
    `select r.*, s.name as style_name from supplier_requests r
     join styles s on s.id = r.style_id join labels l on l.id = r.label_id
     where r.assessor_id = $1 and l.state <> 'erased' order by r.sort_index desc`,
    [desk.id],
  );
  const shapes = rows
    .filter((row) => state === null || state === '' || requestState(row, ctx.now) === state)
    .map((row) => requestShape(row, row.style_name, ctx.now, config.publicUrl));
  return { status: 200, json: { requests: shapes } };
}

export async function readRequest(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const row = await one<RequestRow & { style_name: string }>(
    `select r.*, s.name as style_name from supplier_requests r
     join styles s on s.id = r.style_id join labels l on l.id = r.label_id
     where r.id = $1 and r.assessor_id = $2 and l.state <> 'erased'`,
    [ctx.params.id as string, desk.id],
  );
  if (!row) throw problem.notFound();
  return { status: 200, json: requestShape(row, row.style_name, ctx.now, config.publicUrl) };
}

/** A page's end is the earlier of 23:59:59 supplier local time on the due date and sending + the wait. */
function pageEnd(dueDate: string, town: keyof typeof TOWNS, sentAt: number): number {
  return Math.min(endOfLocalDay(dueDate, TOWNS[town].zone), sentAt + config.answerPageSeconds);
}

export async function createRequest(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const body = ctx.json();
  const style = await findStyle(desk.id, typeof body.styleId === 'string' ? body.styleId : '');
  const line = await one<LineRow>('select * from material_lines where id = $1 and style_id = $2', [
    typeof body.lineId === 'string' ? body.lineId : '',
    style.id,
  ]);
  if (!line) throw problem.notFound();
  const label = await labelOfStyle(style);

  const problems = new FieldCollector();
  const supplierName = requiredText(body, 'supplierName', problems);
  const contactName = requiredText(body, 'contactName', problems);
  const contactEmail = requiredEmail(body, 'contactEmail', problems);
  if (!isTown(body.town)) problems.add('town', copy.emptyField);
  if (!isLanguage(body.language)) problems.add('language', copy.emptyField);
  const questions = Array.isArray(body.questions) ? body.questions : [];
  const chosen = questions.filter((question): question is Question =>
    (QUESTIONS as readonly string[]).includes(question as string),
  );
  if (chosen.length === 0 || chosen.length !== questions.length) problems.add('questions', copy.emptyField);
  const dueDate = typeof body.dueDate === 'string' ? body.dueDate.trim() : '';
  if (!isRealDate(dueDate)) problems.add('dueDate', copy.dateForm);
  else if (isTown(body.town) && dueDate < localDate(ctx.now, TOWNS[body.town].zone)) {
    problems.add('dueDate', copy.dueDatePast(TOWNS[body.town].name));
  }
  problems.throwIfAny();
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);
  if (style.state === 'archived') throw problem.conflict(copy.styleArchived);

  const town = body.town as keyof typeof TOWNS;
  const language = body.language as Language;
  const supplierId = await findOrMakeSupplier(label.id, supplierName, town, language, contactName, contactEmail, ctx.now);

  const id = newId();
  const token = newToken();
  const endsAt = pageEnd(dueDate, town, ctx.now);
  await query(
    `insert into supplier_requests (id, assessor_id, label_id, style_id, line_id, supplier_id, supplier_name,
      contact_name, contact_email, town, language, questions, due_date, state, sent_at, ends_at, token, sort_index)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'sent',$14,$15,$16,$17)`,
    [
      id,
      desk.id,
      label.id,
      style.id,
      line.id,
      supplierId,
      supplierName,
      contactName,
      contactEmail,
      town,
      language,
      JSON.stringify(chosen),
      dueDate,
      ctx.now,
      endsAt,
      token,
      nextSortIndex(),
    ],
  );
  await recordRateEvent('request', desk.id, ctx.now);
  await queueRequestMail('request', {
    labelId: label.id,
    labelName: label.name,
    styleName: style.name,
    contactName,
    contactEmail,
    language,
    token,
    dueDate,
    townName: TOWNS[town].name,
    sendAfter: ctx.now,
  });

  const made = await one<RequestRow>('select * from supplier_requests where id = $1', [id]);
  return { status: 201, json: requestShape(made as RequestRow, style.name, ctx.now, config.publicUrl) };
}

/** A supplier is found or created on the style's label by exact name. */
async function findOrMakeSupplier(
  labelId: string,
  name: string,
  town: keyof typeof TOWNS,
  language: Language,
  contactName: string,
  contactEmail: string,
  now: number,
): Promise<string> {
  const found = await one<{ id: string }>('select id from suppliers where label_id = $1 and name = $2', [
    labelId,
    name,
  ]);
  if (found) {
    await query(
      'update suppliers set town = $1, language = $2, contact_name = $3, contact_email = $4 where id = $5',
      [town, language, contactName, contactEmail, found.id],
    );
    return found.id;
  }
  const id = newId();
  await query(
    `insert into suppliers (id, label_id, name, town, language, contact_name, contact_email, first_sent_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, labelId, name, town, language, contactName, contactEmail, now],
  );
  return id;
}

async function openRequest(ctx: Ctx): Promise<{ request: RequestRow; style: StyleRowRecord; label: LabelRow }> {
  const desk = ctx.requireDesk();
  const request = await one<RequestRow>(
    `select r.* from supplier_requests r join labels l on l.id = r.label_id
     where r.id = $1 and r.assessor_id = $2 and l.state <> 'erased'`,
    [ctx.params.id as string, desk.id],
  );
  if (!request) throw problem.notFound();
  const style = await findStyle(desk.id, request.style_id);
  const label = await labelOfStyle(style);
  return { request, style, label };
}

export async function newAddress(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const { request, style, label } = await openRequest(ctx);
  if (request.state === 'answered') throw problem.conflict(copy.requestAnswered);
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);

  const token = newToken();
  const endsAt = pageEnd(request.due_date, request.town, ctx.now);
  await endPage(request.token, 'answer', request.language, ctx.now);
  await query(
    `update supplier_requests set token = $1, token_ended = false, ends_at = $2, sent_at = $3,
      state = 'sent', reminded_at = null where id = $4`,
    [token, endsAt, ctx.now, request.id],
  );
  await recordRateEvent('request', desk.id, ctx.now);
  await queueRequestMail('request', {
    labelId: label.id,
    labelName: label.name,
    styleName: style.name,
    contactName: request.contact_name ?? '',
    contactEmail: request.contact_email ?? '',
    language: request.language,
    token,
    dueDate: request.due_date,
    townName: TOWNS[request.town].name,
    sendAfter: ctx.now,
  });
  const after = await one<RequestRow>('select * from supplier_requests where id = $1', [request.id]);
  return { status: 201, json: requestShape(after as RequestRow, style.name, ctx.now, config.publicUrl) };
}

export async function endRequest(ctx: Ctx): Promise<Reply> {
  const { request, style } = await openRequest(ctx);
  if (request.state === 'answered') throw problem.conflict(copy.requestAnswered);
  await query(`update supplier_requests set state = 'ended', token_ended = true, ends_at = $1 where id = $2`, [
    Math.min(Number(request.ends_at), ctx.now),
    request.id,
  ]);
  const after = await one<RequestRow>('select * from supplier_requests where id = $1', [request.id]);
  return { status: 200, json: requestShape(after as RequestRow, style.name, ctx.now, config.publicUrl) };
}

export interface AnswerPage {
  request: RequestRow;
  label: LabelRow;
  style: StyleRowRecord;
}

/** An answer page ends at the published instant, and an erased label leaves nothing. */
export async function findAnswerPage(token: string, now: number): Promise<AnswerPage> {
  const request = await one<RequestRow>('select * from supplier_requests where token = $1', [token]);
  if (!request) {
    const ended = await readEndedPage(token);
    if (ended) throw problem.pageEnded(answerCopy.ended[ended.language]);
    throw problem.notFound();
  }
  const label = await one<LabelRow>('select * from labels where id = $1', [request.label_id]);
  if (!label || label.state === 'erased') throw problem.notFound();
  const style = await one<StyleRowRecord>('select * from styles where id = $1', [request.style_id]);
  if (!style) throw problem.notFound();
  if (request.token_ended || now >= Number(request.ends_at) || label.state !== 'open') {
    throw problem.pageEnded(answerCopy.ended[request.language]);
  }
  return { request, label, style };
}

function answerPageJson(page: AnswerPage, now: number): Record<string, unknown> {
  const { request, label, style } = page;
  return {
    language: request.language,
    supplierName: request.supplier_name,
    labelName: label.name,
    styleName: style.name,
    town: request.town,
    townName: TOWNS[request.town].name,
    questions: request.questions,
    dueDate: request.due_date,
    endsAt: `${new Date(Number(request.ends_at) * 1000).toISOString().slice(0, 19)}Z`,
    state: requestState(request, now),
    answeredAt: request.answered_at === null ? null : `${new Date(Number(request.answered_at) * 1000).toISOString().slice(0, 19)}Z`,
  };
}

export async function readAnswerPage(ctx: Ctx): Promise<Reply> {
  const page = await findAnswerPage(ctx.params.token as string, ctx.now);
  return { status: 200, json: answerPageJson(page, ctx.now) };
}

export async function uploadEvidence(ctx: Ctx): Promise<Reply> {
  const boundary = boundaryOf(ctx.headers['content-type']);
  if (boundary !== null) {
    const parts = readParts(ctx.body, boundary);
    const file = parts.find((part) => part.name === 'file');
    if (file && file.content.length > EVIDENCE_FILE_LIMIT) {
      throw problem.tooLarge(answerCopy.fileTooBig.en);
    }
  }

  const page = await findAnswerPage(ctx.params.token as string, ctx.now);
  const language = page.request.language;
  if (boundary === null) throw problem.unsupportedMediaType(answerCopy.fileTypeRefused[language]);
  const parts = readParts(ctx.body, boundary);
  const file = parts.find((part) => part.name === 'file');
  if (!file) throw problem.unsupportedMediaType(answerCopy.fileTypeRefused[language]);
  const contentType = contentTypeOfFile(file.content);
  if (contentType === null) throw problem.unsupportedMediaType(answerCopy.fileTypeRefused[language]);

  const id = newId();
  const key = `evidence/${page.request.assessor_id}/${page.request.id}/${id}`;
  try {
    await files.put(key, file.content, contentType);
  } catch (thrown) {
    if (thrown instanceof FileStoreDown) {
      throw problem.fileStoreUnavailable(answerCopy.fileStoreDown[language]);
    }
    throw thrown;
  }
  await query(
    `insert into evidence_files (id, request_id, assessor_id, label_id, file_name, size_bytes, content_type,
      object_key, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      page.request.id,
      page.request.assessor_id,
      page.request.label_id,
      file.fileName ?? 'evidence',
      file.content.length,
      contentType,
      key,
      ctx.now,
    ],
  );
  return {
    status: 201,
    json: { evidenceId: id, fileName: file.fileName ?? 'evidence', sizeBytes: file.content.length, contentType },
  };
}

function answerJson(answer: StoredAnswer): Record<string, unknown> {
  return {
    energyValue: answer.energyValue,
    energyUnit: answer.energyUnit,
    energyMjPerKg: answer.energyMjPerKg,
    waterLitresPerKg: answer.waterLitresPerKg,
    fibreOrigin: answer.fibreOrigin,
    evidenceIds: answer.evidenceIds,
    answeredAt: answer.answeredAt,
    state: 'answered',
  };
}

export async function sendAnswers(ctx: Ctx): Promise<Reply> {
  const page = await findAnswerPage(ctx.params.token as string, ctx.now);
  const { request } = page;
  if (request.answer) return { status: 200, json: answerJson(request.answer) };

  const body = ctx.json();
  const language = request.language;
  const problems = new FieldCollector();

  let energyValue: Decimal | null = null;
  let energyUnit: 'kWh' | 'MJ' | 'm3' | null = null;
  let energyMj: Decimal | null = null;
  if (request.questions.includes('energy')) {
    const given = (body.energy ?? {}) as Record<string, unknown>;
    const text = typeof given.value === 'string' ? given.value : '';
    if (text.trim() === '') problems.add('energy.value', answerCopy.emptyAnswer[language]);
    else {
      const read = readLocalNumber(text, language);
      if (read === null) problems.add('energy.value', answerCopy.numberRefused[language]);
      else energyValue = read;
    }
    if (!isEnergyUnit(given.unit)) problems.add('energy.unit', answerCopy.emptyAnswer[language]);
    else energyUnit = given.unit;
    if (energyValue && energyUnit) energyMj = toMegajoules(energyValue, energyUnit);
  }

  let waterLitres: Decimal | null = null;
  if (request.questions.includes('water')) {
    const given = (body.water ?? {}) as Record<string, unknown>;
    const text = typeof given.value === 'string' ? given.value : '';
    if (text.trim() === '') problems.add('water.value', answerCopy.emptyAnswer[language]);
    else {
      const read = readLocalNumber(text, language);
      if (read === null) problems.add('water.value', answerCopy.numberRefused[language]);
      else waterLitres = read;
    }
  }

  let fibreOrigin: string | null = null;
  if (request.questions.includes('fibreOrigin')) {
    if (!isCountry(body.fibreOrigin)) problems.add('fibreOrigin', answerCopy.emptyAnswer[language]);
    else fibreOrigin = body.fibreOrigin;
  }

  const evidenceIds = Array.isArray(body.evidenceIds)
    ? body.evidenceIds.filter((id): id is string => typeof id === 'string')
    : [];
  const held = await readEvidence(evidenceIds);
  if (held.length !== evidenceIds.length) problems.add('evidenceIds', answerCopy.emptyAnswer[language]);
  problems.throwIfAny();

  const answer: StoredAnswer = {
    energyValue: energyValue === null ? null : energyValue.toFixed(),
    energyUnit,
    energyMjPerKg: energyMj === null ? null : energyMj.toFixed(),
    waterLitresPerKg: waterLitres === null ? null : waterLitres.toFixed(),
    fibreOrigin: fibreOrigin as StoredAnswer['fibreOrigin'],
    evidenceIds,
    answeredAt: `${new Date(ctx.now * 1000).toISOString().slice(0, 19)}Z`,
    state: 'answered',
  };
  await query(
    `update supplier_requests set answer = $1, answered_at = $2, state = 'answered' where id = $3 and answer is null`,
    [JSON.stringify(answer), ctx.now, request.id],
  );
  const stored = await one<RequestRow>('select * from supplier_requests where id = $1', [request.id]);
  const kept = (stored as RequestRow).answer as StoredAnswer;
  await applyAnswer(page, kept, ctx.now);
  return { status: 201, json: answerJson(kept) };
}

/** An answer applies to the request's line and makes a new result from the kept rows. */
async function applyAnswer(page: AnswerPage, answer: StoredAnswer, now: number): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (answer.energyMjPerKg !== null) {
    values.push(answer.energyMjPerKg);
    sets.push(`answered_energy_mj = $${values.length}`);
  }
  if (answer.waterLitresPerKg !== null) {
    values.push(answer.waterLitresPerKg);
    sets.push(`answered_water_litres = $${values.length}`);
  }
  if (answer.fibreOrigin !== null) {
    values.push(answer.fibreOrigin);
    sets.push(`answered_origin = $${values.length}`);
    const line = await one<LineRow>('select * from material_lines where id = $1', [page.request.line_id]);
    const tier3 = line?.tier3 ?? { factory: null, town: null, country: null };
    values.push(JSON.stringify({ ...tier3, country: answer.fibreOrigin }));
    sets.push(`tier3 = $${values.length}`);
  }
  if (sets.length > 0) {
    values.push(page.request.line_id);
    await query(`update material_lines set ${sets.join(', ')} where id = $${values.length}`, values);
  }
  await bumpVersion(page.style.id, now, page.request.supplier_name);
  await markScoreOutdated(page.style.id);
  const style = await one<StyleRowRecord>('select * from styles where id = $1', [page.style.id]);
  if (style) await remakeResultFromKeptRows(style, now);
}

export async function downloadEvidence(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const row = await one<EvidenceRow>(
    `select e.* from evidence_files e join labels l on l.id = e.label_id
     where e.id = $1 and e.assessor_id = $2 and l.state <> 'erased'`,
    [ctx.params.id as string, desk.id],
  );
  if (!row) throw problem.notFound();
  let bytes: Buffer;
  try {
    bytes = await files.get(row.object_key);
  } catch {
    throw problem.fileStoreUnavailable();
  }
  await recordRateEvent('file', desk.id, ctx.now);
  return {
    status: 200,
    bytes,
    contentType: row.content_type,
    headers: { 'Content-Disposition': `attachment; filename="${row.file_name.replace(/["\\]/g, '')}"` },
  };
}
