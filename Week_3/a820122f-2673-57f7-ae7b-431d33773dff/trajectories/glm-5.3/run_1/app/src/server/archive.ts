import { createHash } from "node:crypto";
import { query } from "./db.js";
import { CrewRecord, type CrewDayView } from "./crew-record.js";
import { s3Get, s3Put, s3Reachable, type S3Options } from "./s3.js";
import { buildPdf, paginate, type PdfLine } from "./pdf.js";
import { buildMonthDocument } from "./pdf-month.js";
import { serverNow, crewRecordFor } from "./auth.js";
import { toUtcString } from "../shared/time.js";

const bucket = process.env.S3_BUCKET ?? "";

function s3Options(): S3Options {
  return {
    endpoint: process.env.S3_ENDPOINT ?? "",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket,
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  };
}

/** A fresh connection per check, so a returning archive is seen at once. */
async function pingArchive(): Promise<boolean> {
  return s3Reachable(s3Options());
}

let lastCheckAt = 0;
let lastReachable = false;

/** Reachability, checked at least every 10 seconds. */
export async function archiveStatus(): Promise<{ archive: "reachable" | "unreachable"; checked_at_utc: string }> {
  const now = serverNow();
  if (now - lastCheckAt < 10_000) {
    return { archive: lastReachable ? "reachable" : "unreachable", checked_at_utc: toUtcString(lastCheckAt) };
  }
  lastReachable = await pingArchive();
  lastCheckAt = now;
  return { archive: lastReachable ? "reachable" : "unreachable", checked_at_utc: toUtcString(lastCheckAt) };
}

export async function archiveReachable(): Promise<boolean> {
  const status = await archiveStatus();
  return status.archive === "reachable";
}

export async function readObject(key: string): Promise<Buffer | null> {
  return s3Get(s3Options(), key);
}

export interface SealOutcome {
  state: "open" | "awaiting_archive" | "sealed";
  ok: boolean;
}

/**
 * Seal one month: write the record PDF and the seafarer's copy, read the record
 * back and compare SHA-256, then mark the month sealed. On any failure the
 * month stays awaiting_archive and is retried by the seal loop.
 */
export async function sealMonth(crewId: string, month: string): Promise<SealOutcome> {
  const record = await crewRecordFor(crewId);
  if (!record) return { state: "open", ok: false };
  const monthRow = await query<{ state: string }>(`SELECT state FROM months WHERE crew_id = $1 AND month = $2`, [crewId, month]);
  if (monthRow[0]?.state === "sealed") return { state: "sealed", ok: true };

  const reachable = await archiveReachable();
  if (!reachable) return { state: "awaiting_archive", ok: false };

  const days = await sealedDaysOf(record, month);
  const pdf = await buildMonthDocument(record, month, days);
  const recordKey = `records/${record.vesselId}/${crewId}/${month}/record.pdf`;
  const copyKey = `records/${record.vesselId}/${crewId}/${month}/seafarer-copy.pdf`;
  const digest = createHash("sha256").update(pdf).digest("hex");

  try {
    const options = s3Options();
    await s3Put(options, recordKey, pdf, "application/pdf");
    await s3Put(options, copyKey, pdf, "application/pdf");
    const readBack = await s3Get(options, recordKey);
    if (!readBack || createHash("sha256").update(readBack).digest("hex") !== digest) {
      return { state: "awaiting_archive", ok: false };
    }
  } catch {
    return { state: "awaiting_archive", ok: false };
  }

  const sealedAt = toUtcString(serverNow());
  await query(`UPDATE months SET state = 'sealed', label = $3, record_key = $4, record_sha256 = $5, copy_key = $6, sealed_at_utc = $7
    WHERE crew_id = $1 AND month = $2`,
    [crewId, month, monthLabel(month), recordKey, digest, copyKey, sealedAt]);
  return { state: "sealed", ok: true };
}

export function monthLabel(month: string): string {
  return month;
}

/** The ship's dates of a month that hold a logged cell. */
export async function monthShipDates(record: CrewRecord, month: string): Promise<string[]> {
  const entries = await query<{ ship_date: string }>(
    `SELECT DISTINCT ship_date FROM watch_entries WHERE crew_id = $1 AND ship_date LIKE $2 ORDER BY ship_date`,
    [record.crewId, `${month}-%`]);
  return entries.map((e) => e.ship_date);
}

async function sealedDaysOf(record: CrewRecord, month: string): Promise<CrewDayView[]> {
  const dates = await monthShipDates(record, month);
  const views: CrewDayView[] = [];
  for (const shipDate of dates) {
    views.push(await record.dayView(shipDate));
  }
  return views;
}

/** Write an inspector's document for a link, holding the same content as its
 *  JSON. Failure does not block link creation; the download reports the
 *  archive when the object is missing. */
export async function writeInspectionDocument(
  linkId: string,
  vesselId: string,
  fromDate: string,
  toDate: string
): Promise<void> {
  const crewRows = await query<{ id: string; name: string; rank: string }>(
    `SELECT id, name, rank FROM crew WHERE vessel_id = $1 ORDER BY name`, [vesselId]);
  const lines: PdfLine[] = [{ text: "Sixbell Rest Log - Inspection record", bold: true }];
  lines.push({ text: `Sealed ship's dates ${fromDate} to ${toDate}.` });
  for (const member of crewRows) {
    const record = await crewRecordFor(member.id);
    if (!record) continue;
    let cursor = fromDate;
    while (cursor <= toDate) {
      const sealed = await query<{ state: string }>(`SELECT state FROM months WHERE crew_id = $1 AND month = $2`,
        [member.id, cursor.slice(0, 7)]);
      if (sealed[0]?.state === "sealed") {
        const view = await record.dayView(cursor);
        lines.push({ text: `Ship's day ${cursor}: ${member.name}, ${view.rest_hours.toFixed(1)} hours of rest, ${view.state}.`, bold: true });
        if (view.signed_at_utc) lines.push({ text: `  Signed at ${view.signed_at_utc}` });
        if (view.countersigned_at_utc) lines.push({ text: `  Countersigned at ${view.countersigned_at_utc}` });
        for (const note of view.notes) lines.push({ text: `  Note by ${note.author_role}: ${note.text}` });
        for (const event of view.events) lines.push({ text: `  Event: ${event.description}${event.mismatch ? " (record mismatch)" : ""}` });
      }
      cursor = addDay(cursor);
    }
  }
  const bytes = buildPdf(paginate(lines).pages);
  const key = `inspections/${linkId}/document.pdf`;
  try {
    await s3Put(s3Options(), key, bytes, "application/pdf");
  } catch {
    // The document download reports the archive when the store is unreachable.
  }
}

function addDay(shipDate: string): string {
  const ms = Date.parse(`${shipDate}T00:00:00Z`);
  return new Date(ms + 86_400_000).toISOString().slice(0, 10);
}

export async function retrySeals(): Promise<void> {
  const awaiting = await query<{ crew_id: string; month: string }>(
    `SELECT crew_id, month FROM months WHERE state = 'awaiting_archive'`);
  for (const row of awaiting) {
    await sealMonth(row.crew_id, row.month);
  }
}

/** The sealing readiness of a month: blocking dates and the last day's closure. */
export async function monthReadiness(crewId: string, month: string): Promise<{
  ready: boolean;
  blockingDates: string[];
}> {
  const record = await crewRecordFor(crewId);
  if (!record) return { ready: false, blockingDates: [] };
  const dates = await monthShipDates(record, month);
  if (dates.length === 0) return { ready: false, blockingDates: [] };
  const recorded = await record.dayStates();
  const now = serverNow();
  const blocking: string[] = [];
  let lastClosed = false;
  for (const shipDate of dates) {
    const { state } = record.dayStateOf(shipDate, recorded.get(shipDate), now);
    if (state !== "countersigned") blocking.push(shipDate);
    if (state !== "open") lastClosed = true;
  }
  // The last ship's date in the month must have closed.
  const last = dates[dates.length - 1]!;
  const lastState = record.dayStateOf(last, recorded.get(last), now);
  if (lastState.state === "open") lastClosed = false;
  return { ready: blocking.length === 0 && lastClosed, blockingDates: blocking };
}
