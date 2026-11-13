import { randomBytes } from 'node:crypto';
import { ValidationError, fail } from '../http/errors.js';
import { requireOwnedVessel, requireOwner, route, sendJson, sendPdf } from '../http/router.js';
import { requireInstant, requireShipDateField, queryShipDate } from '../http/validate.js';
import * as store from '../db/store.js';
import { linkState } from '../domain/inspection-link.js';
import { shipDayBounds } from '../domain/ship-time.js';
import { HOUR_MS, formatInstant, monthOfShipDate, oneDecimal, shipDateRange } from '../domain/time.js';
import {
  dayCellsPayload,
  dayRestHours,
  eventPayload,
  loadCrewContext,
} from '../services/crew-records.js';
import { archiveStatus } from '../services/archive.js';
import { getObject, putObject } from '../services/object-store.js';
import { buildPdf } from '../services/pdf.js';
import { inspectionKeyFor } from '../services/sealing.js';
import { clockChangeKind, clockChangeLabel } from '../domain/ship-time.js';

function linkPayload(link: store.LinkRow, nowMs: number): Record<string, unknown> {
  return {
    id: link.id,
    vessel_id: link.vesselId,
    url: `/inspect/${link.token}`,
    from_date: link.fromDate,
    to_date: link.toDate,
    expires_at_utc: formatInstant(link.expiresAtMs),
    state: linkState(link, nowMs),
  };
}

type InspectionRecord = {
  payload: Record<string, unknown>;
  lines: string[];
  title: string;
};

async function buildInspectionRecord(
  link: store.LinkRow,
  fromDate: string,
  toDate: string,
  nowMs: number,
): Promise<InspectionRecord> {
  const vessel = (await store.findVesselById(link.vesselId)) as store.Vessel;
  const clock = await store.loadVesselClock(vessel);
  const crewMembers = await store.listCrewByVessel(vessel.id);
  const dates = shipDateRange(fromDate, toDate);
  const rangeStartMs = shipDayBounds(clock, fromDate).startMs;
  const rangeEndMs = shipDayBounds(clock, toDate).endMs;
  const unsealed = new Set<string>();
  const lines: string[] = [];
  lines.push(`Vessel: ${vessel.name}`);
  lines.push(`Ship's dates ${fromDate} to ${toDate}`);
  lines.push(`Link expires at ${formatInstant(link.expiresAtMs)}`);
  lines.push('');

  const crewPayload: Record<string, unknown>[] = [];
  for (const crew of crewMembers) {
    const context = await loadCrewContext(crew, rangeStartMs, rangeEndMs);
    const signatures = await store.listSignatures(crew.id, fromDate, toDate);
    const notes = await store.listNotes(crew.id, fromDate, toDate);
    const sealedMonths = new Set(
      (await store.listSealedMonths(crew.id)).map((month) => month.month),
    );
    const days: Record<string, unknown>[] = [];
    lines.push(`Crew member: ${crew.name}, ${crew.rank}`);
    for (const shipDate of dates) {
      if (!sealedMonths.has(monthOfShipDate(shipDate))) {
        unsealed.add(shipDate);
        continue;
      }
      const cells = dayCellsPayload(context, shipDate);
      const signature = signatures.get(shipDate) ?? null;
      const dayNotes = notes.filter((note) => note.shipDate === shipDate);
      const lateEntries = context.entries.filter(
        (entry) => entry.shipDate === shipDate && entry.late,
      );
      days.push({
        ship_date: shipDate,
        cell_count: cells.length,
        cells,
        rest_hours: dayRestHours(cells),
        signed_at_utc: signature?.signedAtMs == null ? null : formatInstant(signature.signedAtMs),
        countersigned_at_utc:
          signature?.countersignedAtMs == null
            ? null
            : formatInstant(signature.countersignedAtMs),
        late_entries: lateEntries.map((entry) => ({
          entry_key: entry.entryKey,
          start_utc: formatInstant(entry.startMs),
          end_utc: formatInstant(entry.endMs),
          kind: entry.kind,
          applied: entry.applied,
          received_at_utc: formatInstant(entry.receivedAtMs),
        })),
        notes: dayNotes.map((note) => ({
          id: note.id,
          text: note.text,
          event_id: note.eventId,
          author_role: note.authorRole,
          created_at_utc: formatInstant(note.createdAtMs),
        })),
      });
      lines.push(
        `  ${shipDate}: ${oneDecimal(dayRestHours(cells))} hours of rest, ${cells.length} cells, ` +
          `${lateEntries.length} late entries, ${dayNotes.length} notes`,
      );
    }
    const breaches = (await store.listBreaches(crew.id, rangeStartMs, rangeEndMs)).map((breach) => ({
      id: breach.id,
      rule: breach.rule,
      window_hours: breach.windowHours,
      window_start_utc: formatInstant(breach.windowStartMs),
      window_end_utc: formatInstant(breach.windowStartMs + breach.windowHours * HOUR_MS),
      rule_set: breach.ruleSet,
      rest_hours: breach.restHours,
      recorded_at_utc: formatInstant(breach.recordedAtMs),
    }));
    for (const breach of breaches) {
      lines.push(
        `  Breach: ${breach.rule} in the ${breach.window_hours}-hour window from ${breach.window_start_utc}`,
      );
    }
    crewPayload.push({
      id: crew.id,
      name: crew.name,
      rank: crew.rank,
      days,
      breaches,
    });
    lines.push('');
  }

  const clockChanges = clock.changes
    .filter((change) => change.changesAtMs >= rangeStartMs && change.changesAtMs <= rangeEndMs)
    .map((change) => ({
      id: change.id,
      changes_at_utc: formatInstant(change.changesAtMs),
      old_offset_minutes: change.oldOffsetMinutes,
      new_offset_minutes: change.newOffsetMinutes,
      kind: clockChangeKind(change),
      label: clockChangeLabel(change),
    }));
  const fixes = (await store.listFixes(vessel.id))
    .filter((fix) => fix.atMs >= rangeStartMs && fix.atMs <= rangeEndMs)
    .map((fix) => ({
      id: fix.id,
      at_utc: formatInstant(fix.atMs),
      latitude: fix.latitude,
      longitude: fix.longitude,
    }));
  const vesselEvents = (await store.listEventsForVessel(vessel.id)).filter(
    (event) => event.endMs > rangeStartMs && event.startMs < rangeEndMs,
  );
  const events: Record<string, unknown>[] = [];
  for (const event of vesselEvents) {
    const crew = crewMembers.find((member) => member.id === event.crewId);
    if (crew === undefined) continue;
    const context = await loadCrewContext(crew, event.startMs, event.endMs);
    const notes = await store.listNotesForCrew(crew.id);
    events.push(eventPayload(context, event, notes));
  }

  lines.push('Voyage events');
  for (const change of clockChanges) {
    lines.push(`  Clock change ${change.label} at ${change.changes_at_utc}`);
  }
  for (const fix of fixes) {
    lines.push(`  Position fix at ${fix.at_utc}: ${fix.latitude}, ${fix.longitude}`);
  }
  for (const event of events) {
    lines.push(`  ${String(event['kind'])} from ${String(event['start_utc'])} to ${String(event['end_utc'])}`);
  }
  if (unsealed.size > 0) {
    lines.push('');
    lines.push(`Not sealed in range: ${[...unsealed].sort().join(', ')}`);
  }

  return {
    payload: {
      vessel: { id: vessel.id, name: vessel.name },
      from_date: fromDate,
      to_date: toDate,
      expires_at_utc: formatInstant(link.expiresAtMs),
      server_now_utc: formatInstant(nowMs),
      crew: crewPayload,
      unsealed_dates: [...unsealed].sort(),
      clock_changes: clockChanges,
      fixes,
      events,
    },
    lines,
    title: `Inspection record, ${vessel.name}, ${fromDate} to ${toDate}`,
  };
}

async function requireUsableLink(token: string, nowMs: number): Promise<store.LinkRow> {
  const link = await store.findLinkByToken(token);
  if (link === null) fail(404, 'not_found');
  const state = linkState(link, nowMs);
  if (state === 'revoked') fail(410, 'link_revoked');
  if (state === 'expired') fail(410, 'link_expired');
  return link;
}

export function registerLinkRoutes(): void {
  route('GET', '/api/vessels/:vesselId/inspection-links', 'session', async (context) => {
    const vessel = await requireOwnedVessel(context);
    const links = await store.listLinks(vessel.id);
    sendJson(context.res, 200, {
      links: links.map((link) => linkPayload(link, context.nowMs)),
    });
  });

  route('POST', '/api/vessels/:vesselId/inspection-links', 'session', async (context) => {
    const vessel = await requireOwnedVessel(context);
    const body = context.json();
    const fromDate = requireShipDateField(body, 'from_date', "The first ship's date");
    const toDate = requireShipDateField(body, 'to_date', "The last ship's date");
    const expiresAtMs = requireInstant(body, 'expires_at_utc', 'The expiry');
    if (toDate < fromDate) {
      throw new ValidationError({ to_date: "The last ship's date comes before the first." });
    }
    if (expiresAtMs <= context.nowMs) {
      throw new ValidationError({ expires_at_utc: 'Pick an expiry after now.' });
    }
    const link = await store.insertLink({
      id: store.newId('link'),
      vesselId: vessel.id,
      token: randomBytes(24).toString('hex'),
      fromDate,
      toDate,
      expiresAtMs,
      createdAtMs: context.nowMs,
    });
    sendJson(context.res, 201, linkPayload(link, context.nowMs));
  });

  route('POST', '/api/inspection-links/:linkId/revoke', 'session', async (context) => {
    const ownerId = requireOwner(context);
    const link = await store.findLinkById(context.params['linkId'] as string);
    if (link === null) fail(404, 'not_found');
    const vessel = await store.findVesselById(link.vesselId);
    if (vessel === null || vessel.ownerId !== ownerId) fail(404, 'not_found');
    if (linkState(link, context.nowMs) !== 'active') fail(409, 'link_ended');
    await store.revokeLink(link.id, context.nowMs);
    const updated = (await store.findLinkById(link.id)) as store.LinkRow;
    sendJson(context.res, 200, linkPayload(updated, context.nowMs));
  });

  route('POST', '/api/inspection-links/:linkId/regenerate', 'session', async (context) => {
    const ownerId = requireOwner(context);
    const link = await store.findLinkById(context.params['linkId'] as string);
    if (link === null) fail(404, 'not_found');
    const vessel = await store.findVesselById(link.vesselId);
    if (vessel === null || vessel.ownerId !== ownerId) fail(404, 'not_found');
    if (linkState(link, context.nowMs) !== 'active') fail(409, 'link_ended');
    await store.revokeLink(link.id, context.nowMs);
    const replacement = await store.insertLink({
      id: store.newId('link'),
      vesselId: link.vesselId,
      token: randomBytes(24).toString('hex'),
      fromDate: link.fromDate,
      toDate: link.toDate,
      expiresAtMs: link.expiresAtMs,
      createdAtMs: context.nowMs,
    });
    sendJson(context.res, 201, linkPayload(replacement, context.nowMs));
  });

  route('GET', '/api/inspect/:token', 'none', async (context) => {
    const link = await requireUsableLink(context.params['token'] as string, context.nowMs);
    const fromDate = queryShipDate(context.query, 'from', 'A first date') ?? link.fromDate;
    const toDate = queryShipDate(context.query, 'to', 'A last date') ?? link.toDate;
    if (fromDate < link.fromDate || toDate > link.toDate || toDate < fromDate) {
      fail(403, 'outside_scope');
    }
    const record = await buildInspectionRecord(link, fromDate, toDate, context.nowMs);
    sendJson(context.res, 200, record.payload);
  });

  route('GET', '/api/inspect/:token/document', 'none', async (context) => {
    const link = await requireUsableLink(context.params['token'] as string, context.nowMs);
    const fromDate = queryShipDate(context.query, 'from', 'A first date') ?? link.fromDate;
    const toDate = queryShipDate(context.query, 'to', 'A last date') ?? link.toDate;
    if (fromDate < link.fromDate || toDate > link.toDate || toDate < fromDate) {
      fail(403, 'outside_scope');
    }
    if (archiveStatus().archive === 'unreachable') fail(503, 'archive_unreachable');
    const record = await buildInspectionRecord(link, fromDate, toDate, context.nowMs);
    const key = inspectionKeyFor(link.id);
    let body: Buffer;
    try {
      await putObject(key, buildPdf(record.title, record.lines));
      body = await getObject(key);
    } catch {
      fail(503, 'archive_unreachable');
    }
    sendPdf(context.res, body, `inspection-${link.fromDate}-to-${link.toDate}.pdf`);
  });
}
