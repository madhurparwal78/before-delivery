import { addMonths, isMonth } from '../../shared/calendar.js';
import { db } from '../db/pool.js';
import { formatInstant, localMonthOf, monthStartInstant } from '../domain/time.js';
import { withinLength, normalise } from '../domain/text.js';
import { requireRole, type RequestContext } from '../http/context.js';
import { errors, fieldCopy } from '../http/errors.js';
import { json, type Result } from '../http/respond.js';
import { sanitationEntryObject } from '../api/shapes.js';
import { asInteger, asString, exactBody, FieldErrors } from '../api/validate.js';
import { fileHeaders } from './documents.js';
import {
  entriesBetween,
  insertEntry,
  listReports,
  loadReport,
  markReportQueued,
  markReportStored,
} from '../store/sanitation.js';
import { renderSanitationPdf } from '../services/sanitationPdf.js';
import { getObject, putObject, sanitationKey, StorageUnavailable } from '../services/storage.js';

const areas = [
  'Prep stations',
  'Ovens and ranges',
  'Walk-in cooler',
  'Dish area',
  'Floors and drains',
];

/** POST /api/sanitation-entries */
export async function logEntry(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['shift_lead', 'operator']);
  const body = exactBody(signedContext.json, ['area', 'task', 'initials'], ['sanitizerPpm', 'notes']);
  const fieldErrors = new FieldErrors();
  const area = asString(body['area']);
  if (area === null || !areas.includes(area)) fieldErrors.add('area', fieldCopy.area);
  const task = asString(body['task']);
  if (task === null || !withinLength(normalise(task), 1, 120)) {
    fieldErrors.add('task', fieldCopy.task);
  }
  const initials = asString(body['initials']);
  if (initials === null || !/^[A-Za-z]{1,4}$/.test(initials)) {
    fieldErrors.add('initials', fieldCopy.initials);
  }
  const rawPpm = body['sanitizerPpm'];
  let sanitizerPpm: number | null = null;
  if (rawPpm !== undefined && rawPpm !== null) {
    const parsed = asInteger(rawPpm);
    if (parsed === null || parsed < 0 || parsed > 400) {
      fieldErrors.add('sanitizerPpm', fieldCopy.sanitizerPpm);
    } else sanitizerPpm = parsed;
  }
  const rawNotes = body['notes'] === undefined ? '' : asString(body['notes']);
  if (rawNotes === null || !withinLength(normalise(rawNotes), 0, 500)) {
    fieldErrors.add('notes', fieldCopy.notes);
  }
  fieldErrors.throwIfAny();

  const entry = await insertEntry(db(), {
    kitchenId: signedContext.kitchen.id,
    area: area!,
    task: normalise(task!),
    sanitizerPpm,
    initials: initials!,
    notes: normalise(rawNotes!),
    loggedAtMs: signedContext.nowMs,
    loggedBy: signedContext.person.name,
  });
  return json(201, { entry: sanitationEntryObject(entry, signedContext.kitchen.timeZone) });
}

/** GET /api/sanitation-entries */
export async function listEntries(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['shift_lead', 'operator']);
  const requested = signedContext.query.get('month');
  if (requested !== null && !isMonth(requested)) {
    throw errors.validationFailed({ month: fieldCopy.month });
  }
  const zone = signedContext.kitchen.timeZone;
  const month = requested ?? localMonthOf(zone, signedContext.nowMs);
  const entries = await entriesBetween(
    db(),
    signedContext.kitchen.id,
    monthStartInstant(zone, month),
    monthStartInstant(zone, addMonths(month, 1)),
  );
  return json(200, { entries: entries.map((entry) => sanitationEntryObject(entry, zone)) });
}

/** POST /api/sanitation-reports */
export async function generateReport(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['operator']);
  const body = exactBody(signedContext.json, ['month']);
  const month = asString(body['month']);
  if (month === null || !isMonth(month)) {
    throw errors.validationFailed({ month: fieldCopy.month });
  }
  const kitchen = signedContext.kitchen;
  try {
    const pdf = await renderSanitationPdf(kitchen, month);
    await putObject(sanitationKey(kitchen.id, month), pdf, 'application/pdf');
    await markReportStored(db(), kitchen.id, month, signedContext.nowMs);
    const report = (await loadReport(db(), kitchen.id, month))!;
    return json(201, { report: reportObject(report, kitchen.timeZone) });
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    await markReportQueued(db(), kitchen.id, month);
    const report = (await loadReport(db(), kitchen.id, month))!;
    return json(202, { report: reportObject(report, kitchen.timeZone) });
  }
}

function reportObject(
  report: { month: string; status: 'stored' | 'queued'; storedAtMs: number | null },
  zone: string,
): Record<string, unknown> {
  return {
    month: report.month,
    status: report.status,
    storedAt: report.storedAtMs === null ? null : formatInstant(zone, report.storedAtMs),
  };
}

/** GET /api/sanitation-reports */
export async function listSanitationReports(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['shift_lead', 'operator']);
  const reports = await listReports(db(), signedContext.kitchen.id);
  return json(200, {
    reports: reports.map((report) => reportObject(report, signedContext.kitchen.timeZone)),
  });
}

/** GET /api/sanitation-reports/{month}/file */
export async function readReportFile(
  context: RequestContext,
  month: string,
): Promise<Result> {
  const signedContext = requireRole(context, ['shift_lead', 'operator']);
  if (!isMonth(month)) throw errors.validationFailed({ month: fieldCopy.month });
  const report = await loadReport(db(), signedContext.kitchen.id, month);
  if (!report || report.status !== 'stored') throw errors.notFound();
  return sanitationFileResult(signedContext.kitchen.id, month);
}

export async function sanitationFileResult(
  kitchenId: string,
  month: string,
): Promise<Result> {
  let body: Buffer | null;
  try {
    body = await getObject(sanitationKey(kitchenId, month));
  } catch (error) {
    if (error instanceof StorageUnavailable) throw errors.storageUnavailableDownload();
    throw error;
  }
  if (body === null) throw errors.notFound();
  return {
    kind: 'binary',
    status: 200,
    body,
    contentType: 'application/pdf',
    headers: fileHeaders(`sanitation-${month}.pdf`),
  };
}
