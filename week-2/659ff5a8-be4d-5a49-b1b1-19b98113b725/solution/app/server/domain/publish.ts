import type { EventView, Publication } from "../../shared/api.js";
import { PUBLISH_MOVE, publishRefusal } from "../../shared/lifecycle.js";
import { formatMs } from "../../shared/rules.js";
import { type ClubAuth, requireRole } from "../auth.js";
import { config } from "../config.js";
import { type Db, one, pool, returning } from "../db.js";
import { ApiError } from "../errors.js";
import { deliver, recordFailureFor } from "../services/outbox.js";
import { rendererStatus, renderPdf } from "../services/pdf.js";
import { type ResultsLine, resultsHtml } from "../services/pdfHtml.js";
import { readObject, storeOnce } from "../services/storage.js";
import { type EventRow, eventView, findEvent, reportedStatus } from "./events.js";
import { factorText } from "./indexTables.js";
import { type Ranked, loadEntries, orderForView, rankEntries } from "./standings.js";

const NO_TIME = "No time";


function line(entry: Ranked, position: number | null, time: number | null, factor: string): ResultsLine {
  return {
    position: position === null ? NO_TIME : `P${position}`,
    carNumber: entry.carNumber,
    classCode: entry.classCode,
    driverName: entry.driverName,
    time: time === null ? "" : formatMs(time),
    factor,
  };
}

async function resultsPdf(db: Db, event: EventRow, factors: Record<string, string>): Promise<Buffer> {
  const ranked = rankEntries(await loadEntries(db, event.id));
  const factorOf = (entry: Ranked): string => factorText(factors, entry.classCode);
  return renderPdf(
    resultsHtml({
      eventName: event.name,
      raw: orderForView(ranked, "raw", null).map((e) => line(e, e.rawPosition, e.bestAdjustedMs, "")),
      classes: orderForView(ranked, "class", null).map((e) => line(e, e.classPosition, e.bestAdjustedMs, "")),
      indexed: orderForView(ranked, "indexed", null).map((e) => line(e, e.position, e.bestIndexedMs, factorOf(e))),
    }),
  );
}

export async function publication(auth: ClubAuth, eventId: number): Promise<Publication> {
  const event = await findEvent(pool, auth.club.id, eventId);
  requireRole(auth, "chair");
  return describe(event);
}

async function describe(event: EventRow): Promise<Publication> {
  const stored = await one<{ pdf_key: string; checksum: string }>(
    pool,
    "select pdf_key, checksum from publications where event_id = $1",
    [event.id],
  );
  const counts = await returning<{ total: number; accepted: number }>(
    pool,
    `select count(*)::int as total,
            (select count(*)::int from email_deliveries d join registrations x on x.id = d.registration_id
              where x.event_id = $1 and d.kind = 'results' and d.status = 'sent') as accepted
       from registrations where event_id = $1 and checked_in_at is not null`,
    [event.id],
  );
  return {
    status: reportedStatus(event, new Date()),
    renderer: await rendererStatus(),
    publishedAt: event.published_at?.toISOString() ?? null,
    pdfKey: stored?.pdf_key ?? null,
    checksum: stored?.checksum ?? null,
    emailsAccepted: counts.accepted,
    emailsTotal: counts.total,
  };
}

function resultsKey(auth: ClubAuth, eventId: number): string {
  return `clubs/${auth.club.slug}/events/${eventId}/results/final.pdf`;
}

/** Render, store, email every checked-in driver, and only then mark the event published. */
export async function publish(auth: ClubAuth, eventId: number): Promise<{ event: EventView; publication: Publication }> {
  const event = await findEvent(pool, auth.club.id, eventId);
  return { event: await publishSteps(auth, event), publication: await describe(await findEvent(pool, auth.club.id, eventId)) };
}

async function publishSteps(auth: ClubAuth, event: EventRow): Promise<EventView> {
  const refusal = publishRefusal(reportedStatus(event, new Date()));
  if (refusal) throw new ApiError(refusal);
  const view = await eventView(pool, auth.club, event);
  try {
    const key = resultsKey(auth, event.id);
    const kept = await one<{ checksum: string }>(pool, "select checksum from publications where event_id = $1", [event.id]);
    if (!kept) {
      const checksum = await storeOnce(key, await resultsPdf(pool, event, view.factors));
      await pool.query("insert into publications (event_id, pdf_key, checksum) values ($1, $2, $3) on conflict do nothing", [
        event.id,
        key,
        checksum,
      ]);
    }
    await emailResults(event);
  } catch (error) {
    await recordFailureFor(error, auth.club.id, event.id);
    throw error;
  }
  const marked = await pool.query(
    "update events set status = $2, published_at = now() where id = $1 and status = $3",
    [event.id, PUBLISH_MOVE.to, PUBLISH_MOVE.from],
  );
  if (marked.rowCount === 0) throw new ApiError("already_published");
  return eventView(pool, auth.club, await findEvent(pool, auth.club.id, event.id));
}

async function emailResults(event: EventRow): Promise<void> {
  const ranked = rankEntries(await loadEntries(pool, event.id));
  const subject = `Final results: ${event.name}`;
  for (const entry of ranked.filter((e) => e.checkedIn)) {
    const finish = entry.position === null ? "no time" : `P${entry.position}`;
    const created = await returning<{ id: number }>(
      pool,
      `with new as (
         insert into email_deliveries (kind, registration_id, recipient, subject, body)
         select 'results', r.id, u.email, $2, $3 from registrations r join users u on u.id = r.user_id where r.id = $1
         on conflict do nothing returning id)
       select coalesce((select id from new),
                       (select id from email_deliveries where kind = 'results' and registration_id = $1)) as id`,
      [
        entry.registrationId,
        subject,
        [
          `Hello ${entry.driverName},`,
          "",
          `Final results for ${event.name} are published.`,
          `Download the results: ${config.publicUrl}/api/events/${event.id}/results.pdf`,
          `Your indexed finish: ${finish}`,
        ].join("\n"),
      ],
    );
    if (!(await deliver(created.id))) throw new ApiError("mail_unavailable");
  }
}

export async function resultsFile(auth: ClubAuth, eventId: number): Promise<Buffer> {
  const event = await findEvent(pool, auth.club.id, eventId);
  if (event.published_at === null) throw new ApiError("not_published");
  const stored = await returning<{ pdf_key: string }>(pool, "select pdf_key from publications where event_id = $1", [eventId]);
  return readObject(stored.pdf_key);
}
