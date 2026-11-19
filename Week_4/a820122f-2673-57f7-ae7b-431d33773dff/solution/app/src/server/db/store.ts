import { randomUUID } from 'node:crypto';
import { pool, query } from './pool.js';
import type { ClockChange, VesselClock } from '../domain/ship-time.js';
import type { PositionFix } from '../domain/position.js';
import type { RuleSetPeriod } from '../domain/rule-sets.js';
import type { DaySignature } from '../domain/day-state.js';
import type { RestRule, RuleSetName } from '../domain/rest-rules.js';
import { formatInstant } from '../domain/time.js';

export type Role = 'owner_master' | 'crew';

type Owner = { id: string; name: string; email: string };
export type Crew = { id: string; vesselId: string; name: string; rank: string; email: string };
export type VesselKind = 'workboat' | 'survey_boat' | 'coaster' | 'charter_yacht';
export type Vessel = {
  id: string;
  ownerId: string;
  name: string;
  kind: VesselKind;
  initialOffsetMinutes: number;
};

export type WatchEntryRow = {
  seq: number;
  id: string;
  crewId: string;
  entryKey: string;
  startMs: number;
  endMs: number;
  kind: 'rest' | 'work';
  shipDate: string;
  late: boolean;
  applied: boolean;
  receivedAtMs: number;
};

export type NoteRow = {
  id: string;
  crewId: string;
  shipDate: string;
  text: string;
  eventId: string | null;
  authorRole: Role;
  createdAtMs: number;
};

export type EventRow = {
  id: string;
  vesselId: string;
  crewId: string;
  kind: 'drill' | 'call_out';
  startMs: number;
  endMs: number;
  description: string;
};

type BreachRow = {
  id: string;
  crewId: string;
  rule: RestRule;
  windowHours: 24 | 168;
  windowStartMs: number;
  ruleSet: RuleSetName;
  restHours: number;
  recordedAtMs: number;
};

export type MonthRow = {
  crewId: string;
  month: string;
  state: 'open' | 'awaiting_archive' | 'sealed';
  recordKey: string | null;
  recordSha256: string | null;
  copyKey: string | null;
  sealedAtMs: number | null;
};

export type LinkRow = {
  id: string;
  vesselId: string;
  token: string;
  fromDate: string;
  toDate: string;
  expiresAtMs: number;
  revokedAtMs: number | null;
};

type RotaWatchRow = {
  id: string;
  vesselId: string;
  crewId: string;
  label: string;
  startTime: string;
  endTime: string;
  fromDate: string;
  toDate: string;
};

function ms(value: Date | string | null): number | null {
  if (value === null) return null;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function msRequired(value: Date | string): number {
  return ms(value) as number;
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

// --- people -----------------------------------------------------------------

type OwnerDbRow = { id: string; name: string; email: string; passcode_hash: string };
type CrewDbRow = {
  id: string;
  vessel_id: string;
  name: string;
  rank: string;
  email: string;
  passcode_hash: string;
};

export async function insertOwner(
  id: string,
  name: string,
  email: string,
  passcodeHash: string,
): Promise<boolean> {
  const rows = await query(
    `insert into owner_master (id, name, email, passcode_hash) values ($1,$2,$3,$4)
     on conflict do nothing returning id`,
    [id, name, email, passcodeHash],
  );
  return rows.length === 1;
}

export async function emailTaken(email: string): Promise<boolean> {
  const rows = await query<{ taken: boolean }>(
    `select exists(
       select 1 from owner_master where lower(email) = lower($1)
       union all select 1 from crew_member where lower(email) = lower($1)
     ) as taken`,
    [email],
  );
  return rows[0]?.taken === true;
}

export async function findOwnerByEmail(email: string): Promise<(Owner & { passcodeHash: string }) | null> {
  const rows = await query<OwnerDbRow>(
    `select id, name, email, passcode_hash from owner_master where lower(email) = lower($1)`,
    [email],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { id: row.id, name: row.name, email: row.email, passcodeHash: row.passcode_hash };
}

export async function findCrewByEmail(email: string): Promise<(Crew & { passcodeHash: string }) | null> {
  const rows = await query<CrewDbRow>(
    `select id, vessel_id, name, rank, email, passcode_hash from crew_member where lower(email) = lower($1)`,
    [email],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    vesselId: row.vessel_id,
    name: row.name,
    rank: row.rank,
    email: row.email,
    passcodeHash: row.passcode_hash,
  };
}

export async function findOwnerById(id: string): Promise<Owner | null> {
  const rows = await query<OwnerDbRow>(`select id, name, email, passcode_hash from owner_master where id = $1`, [id]);
  const row = rows[0];
  return row === undefined ? null : { id: row.id, name: row.name, email: row.email };
}

export async function findCrewById(id: string): Promise<Crew | null> {
  const rows = await query<CrewDbRow>(
    `select id, vessel_id, name, rank, email, passcode_hash from crew_member where id = $1`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { id: row.id, vesselId: row.vessel_id, name: row.name, rank: row.rank, email: row.email };
}

export async function listCrewByVessel(vesselId: string): Promise<Crew[]> {
  const rows = await query<CrewDbRow>(
    `select id, vessel_id, name, rank, email, passcode_hash from crew_member
     where vessel_id = $1 order by created_at_utc, id`,
    [vesselId],
  );
  return rows.map((row) => ({
    id: row.id,
    vesselId: row.vessel_id,
    name: row.name,
    rank: row.rank,
    email: row.email,
  }));
}

export async function insertCrew(
  id: string,
  vesselId: string,
  name: string,
  rank: string,
  email: string,
  passcodeHash: string,
): Promise<boolean> {
  const rows = await query(
    `insert into crew_member (id, vessel_id, name, rank, email, passcode_hash)
     values ($1,$2,$3,$4,$5,$6) on conflict do nothing returning id`,
    [id, vesselId, name, rank, email, passcodeHash],
  );
  return rows.length === 1;
}

// --- sessions ---------------------------------------------------------------

export async function insertSession(token: string, personId: string, role: Role): Promise<void> {
  await query(`insert into app_session (token, person_id, role) values ($1,$2,$3)`, [token, personId, role]);
}

export async function findSession(token: string): Promise<{ personId: string; role: Role } | null> {
  const rows = await query<{ person_id: string; role: Role }>(
    `select person_id, role from app_session where token = $1`,
    [token],
  );
  const row = rows[0];
  return row === undefined ? null : { personId: row.person_id, role: row.role };
}

export async function deleteSession(token: string): Promise<void> {
  await query(`delete from app_session where token = $1`, [token]);
}

// --- vessels ----------------------------------------------------------------

type VesselDbRow = {
  id: string;
  owner_id: string;
  name: string;
  kind: VesselKind;
  initial_offset_minutes: number;
};

function toVessel(row: VesselDbRow): Vessel {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    kind: row.kind,
    initialOffsetMinutes: row.initial_offset_minutes,
  };
}

export async function listVesselsByOwner(ownerId: string): Promise<Vessel[]> {
  const rows = await query<VesselDbRow>(
    `select id, owner_id, name, kind, initial_offset_minutes from vessel
     where owner_id = $1 order by created_at_utc, id`,
    [ownerId],
  );
  return rows.map(toVessel);
}

export async function findVesselById(id: string): Promise<Vessel | null> {
  const rows = await query<VesselDbRow>(
    `select id, owner_id, name, kind, initial_offset_minutes from vessel where id = $1`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toVessel(row);
}

export async function insertVessel(
  id: string,
  ownerId: string,
  name: string,
  kind: VesselKind,
  initialOffsetMinutes: number,
): Promise<void> {
  await query(
    `insert into vessel (id, owner_id, name, kind, initial_offset_minutes) values ($1,$2,$3,$4,$5)
     on conflict (id) do nothing`,
    [id, ownerId, name, kind, initialOffsetMinutes],
  );
}

/** Adds a vessel unless the owner-master already runs `limit`; the owner row lock serialises concurrent adds. */
export async function insertVesselWithinLimit(
  id: string,
  ownerId: string,
  name: string,
  kind: VesselKind,
  initialOffsetMinutes: number,
  limit: number,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select 1 from owner_master where id = $1 for update', [ownerId]);
    const counted = await client.query<{ n: number }>(
      'select count(*)::int as n from vessel where owner_id = $1',
      [ownerId],
    );
    if ((counted.rows[0]?.n ?? 0) >= limit) {
      await client.query('rollback');
      return false;
    }
    await client.query(
      `insert into vessel (id, owner_id, name, kind, initial_offset_minutes) values ($1,$2,$3,$4,$5)`,
      [id, ownerId, name, kind, initialOffsetMinutes],
    );
    await client.query('commit');
    return true;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

// --- clock changes and fixes ------------------------------------------------

type ClockChangeDbRow = {
  id: string;
  changes_at_utc: Date;
  old_offset_minutes: number;
  new_offset_minutes: number;
  latitude: number;
  longitude: number;
  fix_id: string | null;
};

async function listClockChanges(vesselId: string): Promise<ClockChange[]> {
  const rows = await query<ClockChangeDbRow>(
    `select id, changes_at_utc, old_offset_minutes, new_offset_minutes, latitude, longitude, fix_id
     from clock_change where vessel_id = $1 order by changes_at_utc`,
    [vesselId],
  );
  return rows.map((row) => ({
    id: row.id,
    changesAtMs: msRequired(row.changes_at_utc),
    oldOffsetMinutes: row.old_offset_minutes,
    newOffsetMinutes: row.new_offset_minutes,
    latitude: row.latitude,
    longitude: row.longitude,
    fixId: row.fix_id,
  }));
}

export async function loadVesselClock(vessel: Vessel): Promise<VesselClock> {
  return {
    initialOffsetMinutes: vessel.initialOffsetMinutes,
    changes: await listClockChanges(vessel.id),
  };
}

export async function insertClockChange(
  id: string,
  vesselId: string,
  changesAtMs: number,
  oldOffsetMinutes: number,
  newOffsetMinutes: number,
  latitude: number,
  longitude: number,
  fixId: string,
): Promise<void> {
  await query(
    `insert into clock_change
       (id, vessel_id, changes_at_utc, old_offset_minutes, new_offset_minutes, latitude, longitude, fix_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (vessel_id, changes_at_utc) do nothing`,
    [
      id,
      vesselId,
      formatInstant(changesAtMs),
      oldOffsetMinutes,
      newOffsetMinutes,
      latitude,
      longitude,
      fixId,
    ],
  );
}

export async function listFixes(vesselId: string): Promise<PositionFix[]> {
  const rows = await query<{ id: string; at_utc: Date; latitude: number; longitude: number }>(
    `select id, at_utc, latitude, longitude from position_fix where vessel_id = $1 order by at_utc`,
    [vesselId],
  );
  return rows.map((row) => ({
    id: row.id,
    atMs: msRequired(row.at_utc),
    latitude: row.latitude,
    longitude: row.longitude,
  }));
}

export async function insertFix(
  id: string,
  vesselId: string,
  atMs: number,
  latitude: number,
  longitude: number,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `insert into position_fix (id, vessel_id, at_utc, latitude, longitude) values ($1,$2,$3,$4,$5)
     on conflict (vessel_id, at_utc) do nothing returning id`,
    [id, vesselId, formatInstant(atMs), latitude, longitude],
  );
  return rows.length > 0;
}

export async function findFixAt(vesselId: string, atMs: number): Promise<PositionFix | null> {
  const rows = await query<{ id: string; at_utc: Date; latitude: number; longitude: number }>(
    `select id, at_utc, latitude, longitude from position_fix where vessel_id = $1 and at_utc = $2`,
    [vesselId, formatInstant(atMs)],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : { id: row.id, atMs: msRequired(row.at_utc), latitude: row.latitude, longitude: row.longitude };
}

// --- rule sets --------------------------------------------------------------

export async function listRuleSets(vesselId: string): Promise<RuleSetPeriod[]> {
  const rows = await query<{
    id: string;
    rule_set: 'flag_exception';
    effective_from_utc: Date;
    effective_until_utc: Date;
    flag_reference: string;
  }>(
    `select id, rule_set, effective_from_utc, effective_until_utc, flag_reference
     from rule_set_period where vessel_id = $1 order by effective_from_utc`,
    [vesselId],
  );
  return rows.map((row) => ({
    id: row.id,
    ruleSet: row.rule_set,
    effectiveFromMs: msRequired(row.effective_from_utc),
    effectiveUntilMs: msRequired(row.effective_until_utc),
    flagReference: row.flag_reference,
  }));
}

export async function insertRuleSet(
  id: string,
  vesselId: string,
  effectiveFromMs: number,
  effectiveUntilMs: number,
  flagReference: string,
): Promise<void> {
  await query(
    `insert into rule_set_period (id, vessel_id, rule_set, effective_from_utc, effective_until_utc, flag_reference)
     values ($1,$2,'flag_exception',$3,$4,$5) on conflict (id) do nothing`,
    [id, vesselId, formatInstant(effectiveFromMs), formatInstant(effectiveUntilMs), flagReference],
  );
}

// --- rota -------------------------------------------------------------------

export async function insertRotaWatch(watch: RotaWatchRow): Promise<void> {
  await query(
    `insert into rota_watch (id, vessel_id, crew_id, label, start_time, end_time, from_date, to_date)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing`,
    [
      watch.id,
      watch.vesselId,
      watch.crewId,
      watch.label,
      watch.startTime,
      watch.endTime,
      watch.fromDate,
      watch.toDate,
    ],
  );
}

export async function listRotaWatches(vesselId: string, crewId: string): Promise<RotaWatchRow[]> {
  const rows = await query<{
    id: string;
    vessel_id: string;
    crew_id: string;
    label: string;
    start_time: string;
    end_time: string;
    from_date: string;
    to_date: string;
  }>(
    `select id, vessel_id, crew_id, label, start_time, end_time, from_date, to_date
     from rota_watch where vessel_id = $1 and crew_id = $2 order by start_time, label`,
    [vesselId, crewId],
  );
  return rows.map((row) => ({
    id: row.id,
    vesselId: row.vessel_id,
    crewId: row.crew_id,
    label: row.label,
    startTime: row.start_time,
    endTime: row.end_time,
    fromDate: row.from_date,
    toDate: row.to_date,
  }));
}

// --- watch entries ----------------------------------------------------------

type WatchEntryDbRow = {
  seq: string;
  id: string;
  crew_id: string;
  entry_key: string;
  start_utc: Date;
  end_utc: Date;
  kind: 'rest' | 'work';
  ship_date: string;
  late: boolean;
  applied: boolean;
  received_at_utc: Date;
};

function toEntry(row: WatchEntryDbRow): WatchEntryRow {
  return {
    seq: Number(row.seq),
    id: row.id,
    crewId: row.crew_id,
    entryKey: row.entry_key,
    startMs: msRequired(row.start_utc),
    endMs: msRequired(row.end_utc),
    kind: row.kind,
    shipDate: row.ship_date,
    late: row.late,
    applied: row.applied,
    receivedAtMs: msRequired(row.received_at_utc),
  };
}

const ENTRY_COLUMNS = `seq, id, crew_id, entry_key, start_utc, end_utc, kind, ship_date, late, applied, received_at_utc`;

export async function listEntriesInRange(
  crewId: string,
  fromMs: number,
  toMs: number,
): Promise<WatchEntryRow[]> {
  const rows = await query<WatchEntryDbRow>(
    `select ${ENTRY_COLUMNS} from watch_entry
     where crew_id = $1 and end_utc > $2 and start_utc < $3 order by seq`,
    [crewId, formatInstant(fromMs), formatInstant(toMs)],
  );
  return rows.map(toEntry);
}

export async function listEntriesForDay(crewId: string, shipDate: string): Promise<WatchEntryRow[]> {
  const rows = await query<WatchEntryDbRow>(
    `select ${ENTRY_COLUMNS} from watch_entry where crew_id = $1 and ship_date = $2 order by seq`,
    [crewId, shipDate],
  );
  return rows.map(toEntry);
}

export async function findEntryByKey(crewId: string, entryKey: string): Promise<WatchEntryRow | null> {
  const rows = await query<WatchEntryDbRow>(
    `select ${ENTRY_COLUMNS} from watch_entry where crew_id = $1 and entry_key = $2`,
    [crewId, entryKey],
  );
  const row = rows[0];
  return row === undefined ? null : toEntry(row);
}

/** Stores one watch entry. Returns the stored entry, which may be an entry already held under the key. */
export async function insertEntry(entry: {
  crewId: string;
  entryKey: string;
  startMs: number;
  endMs: number;
  kind: 'rest' | 'work';
  shipDate: string;
  late: boolean;
  applied: boolean;
  receivedAtMs: number;
}): Promise<{ entry: WatchEntryRow; stored: boolean }> {
  const rows = await query<WatchEntryDbRow>(
    `insert into watch_entry (id, crew_id, entry_key, start_utc, end_utc, kind, ship_date, late, applied, received_at_utc)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (crew_id, entry_key) do nothing
     returning ${ENTRY_COLUMNS}`,
    [
      newId('entry'),
      entry.crewId,
      entry.entryKey,
      formatInstant(entry.startMs),
      formatInstant(entry.endMs),
      entry.kind,
      entry.shipDate,
      entry.late,
      entry.applied,
      formatInstant(entry.receivedAtMs),
    ],
  );
  const row = rows[0];
  if (row !== undefined) return { entry: toEntry(row), stored: true };
  const existing = await findEntryByKey(entry.crewId, entry.entryKey);
  return { entry: existing as WatchEntryRow, stored: false };
}

export async function latestLoggedCellEnd(crewId: string): Promise<number | null> {
  const rows = await query<{ latest: Date | null }>(
    `select max(end_utc) as latest from watch_entry where crew_id = $1 and applied = true`,
    [crewId],
  );
  const row = rows[0];
  return row === undefined || row.latest === null ? null : msRequired(row.latest);
}

export async function shipDatesWithCells(crewId: string, fromDate: string, toDate: string): Promise<string[]> {
  const rows = await query<{ ship_date: string }>(
    `select distinct ship_date from watch_entry
     where crew_id = $1 and applied = true and ship_date >= $2 and ship_date <= $3 order by ship_date`,
    [crewId, fromDate, toDate],
  );
  return rows.map((row) => row.ship_date);
}

// --- signatures -------------------------------------------------------------

export async function listSignatures(
  crewId: string,
  fromDate: string,
  toDate: string,
): Promise<Map<string, DaySignature>> {
  const rows = await query<{ ship_date: string; signed_at_utc: Date | null; countersigned_at_utc: Date | null }>(
    `select ship_date, signed_at_utc, countersigned_at_utc from day_signature
     where crew_id = $1 and ship_date >= $2 and ship_date <= $3`,
    [crewId, fromDate, toDate],
  );
  const map = new Map<string, DaySignature>();
  for (const row of rows) {
    map.set(row.ship_date, {
      signedAtMs: ms(row.signed_at_utc),
      countersignedAtMs: ms(row.countersigned_at_utc),
    });
  }
  return map;
}

export async function findSignature(crewId: string, shipDate: string): Promise<DaySignature | null> {
  const map = await listSignatures(crewId, shipDate, shipDate);
  return map.get(shipDate) ?? null;
}

/** Records a crew signature, returning false when the day was already signed. */
export async function signDay(crewId: string, shipDate: string, atMs: number): Promise<boolean> {
  const rows = await query<{ crew_id: string }>(
    `insert into day_signature (crew_id, ship_date, signed_at_utc) values ($1,$2,$3)
     on conflict (crew_id, ship_date) do update set signed_at_utc = $3
     where day_signature.signed_at_utc is null
     returning crew_id`,
    [crewId, shipDate, formatInstant(atMs)],
  );
  return rows.length > 0;
}

export async function countersignDay(crewId: string, shipDate: string, atMs: number): Promise<boolean> {
  const rows = await query<{ crew_id: string }>(
    `update day_signature set countersigned_at_utc = $3
     where crew_id = $1 and ship_date = $2 and signed_at_utc is not null and countersigned_at_utc is null
     returning crew_id`,
    [crewId, shipDate, formatInstant(atMs)],
  );
  return rows.length > 0;
}

// --- notes and events -------------------------------------------------------

export async function insertNote(note: NoteRow & { authorId: string }): Promise<void> {
  await query(
    `insert into day_note (id, crew_id, ship_date, text, event_id, author_role, author_id, created_at_utc)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      note.id,
      note.crewId,
      note.shipDate,
      note.text,
      note.eventId,
      note.authorRole,
      note.authorId,
      formatInstant(note.createdAtMs),
    ],
  );
}

type NoteDbRow = {
  id: string;
  crew_id: string;
  ship_date: string;
  text: string;
  event_id: string | null;
  author_role: Role;
  created_at_utc: Date;
};

function toNote(row: NoteDbRow): NoteRow {
  return {
    id: row.id,
    crewId: row.crew_id,
    shipDate: row.ship_date,
    text: row.text,
    eventId: row.event_id,
    authorRole: row.author_role,
    createdAtMs: msRequired(row.created_at_utc),
  };
}

export async function listNotes(crewId: string, fromDate: string, toDate: string): Promise<NoteRow[]> {
  const rows = await query<NoteDbRow>(
    `select id, crew_id, ship_date, text, event_id, author_role, created_at_utc from day_note
     where crew_id = $1 and ship_date >= $2 and ship_date <= $3 order by created_at_utc, id`,
    [crewId, fromDate, toDate],
  );
  return rows.map(toNote);
}

export async function listNotesForCrew(crewId: string): Promise<NoteRow[]> {
  const rows = await query<NoteDbRow>(
    `select id, crew_id, ship_date, text, event_id, author_role, created_at_utc from day_note
     where crew_id = $1 order by created_at_utc, id`,
    [crewId],
  );
  return rows.map(toNote);
}

export async function insertEvent(event: EventRow): Promise<void> {
  await query(
    `insert into vessel_event (id, vessel_id, crew_id, kind, start_utc, end_utc, description)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
    [
      event.id,
      event.vesselId,
      event.crewId,
      event.kind,
      formatInstant(event.startMs),
      formatInstant(event.endMs),
      event.description,
    ],
  );
}

type EventDbRow = {
  id: string;
  vessel_id: string;
  crew_id: string;
  kind: 'drill' | 'call_out';
  start_utc: Date;
  end_utc: Date;
  description: string;
};

function toEvent(row: EventDbRow): EventRow {
  return {
    id: row.id,
    vesselId: row.vessel_id,
    crewId: row.crew_id,
    kind: row.kind,
    startMs: msRequired(row.start_utc),
    endMs: msRequired(row.end_utc),
    description: row.description,
  };
}

export async function listEventsForCrew(crewId: string): Promise<EventRow[]> {
  const rows = await query<EventDbRow>(
    `select id, vessel_id, crew_id, kind, start_utc, end_utc, description from vessel_event
     where crew_id = $1 order by start_utc, id`,
    [crewId],
  );
  return rows.map(toEvent);
}

export async function listEventsForVessel(vesselId: string): Promise<EventRow[]> {
  const rows = await query<EventDbRow>(
    `select id, vessel_id, crew_id, kind, start_utc, end_utc, description from vessel_event
     where vessel_id = $1 order by start_utc, id`,
    [vesselId],
  );
  return rows.map(toEvent);
}

// --- breaches ---------------------------------------------------------------

export async function recordBreaches(
  crewId: string,
  breaches: readonly {
    rule: RestRule;
    windowHours: 24 | 168;
    windowStartMs: number;
    ruleSet: RuleSetName;
    restHours: number;
  }[],
  recordedAtMs: number,
): Promise<void> {
  if (breaches.length === 0) return;
  const values: unknown[] = [];
  const rows: string[] = [];
  breaches.forEach((breach, index) => {
    const base = index * 7;
    rows.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
    values.push(
      newId('breach'),
      crewId,
      breach.rule,
      breach.windowHours,
      formatInstant(breach.windowStartMs),
      breach.ruleSet,
      breach.restHours,
    );
  });
  await query(
    `insert into breach_record (id, crew_id, rule, window_hours, window_start_utc, rule_set, rest_hours, recorded_at_utc)
     select v.id, v.crew_id, v.rule, v.window_hours::int, v.window_start_utc::timestamptz, v.rule_set,
            v.rest_hours::double precision, '${formatInstant(recordedAtMs)}'::timestamptz
     from (values ${rows.join(',')})
          as v(id, crew_id, rule, window_hours, window_start_utc, rule_set, rest_hours)
     on conflict (crew_id, window_hours, window_start_utc, rule) do nothing`,
    values,
  );
}

export async function listBreaches(
  crewId: string,
  fromMs: number | null,
  toMs: number | null,
): Promise<BreachRow[]> {
  const conditions = ['crew_id = $1'];
  const values: unknown[] = [crewId];
  if (fromMs !== null) {
    values.push(formatInstant(fromMs));
    conditions.push(`window_start_utc >= $${values.length}`);
  }
  if (toMs !== null) {
    values.push(formatInstant(toMs));
    conditions.push(`window_start_utc <= $${values.length}`);
  }
  const rows = await query<{
    id: string;
    crew_id: string;
    rule: RestRule;
    window_hours: number;
    window_start_utc: Date;
    rule_set: RuleSetName;
    rest_hours: number;
    recorded_at_utc: Date;
  }>(
    `select id, crew_id, rule, window_hours, window_start_utc, rule_set, rest_hours, recorded_at_utc
     from breach_record where ${conditions.join(' and ')}
     order by window_start_utc, window_hours, rule`,
    values,
  );
  return rows.map((row) => ({
    id: row.id,
    crewId: row.crew_id,
    rule: row.rule,
    windowHours: row.window_hours === 168 ? 168 : 24,
    windowStartMs: msRequired(row.window_start_utc),
    ruleSet: row.rule_set,
    restHours: row.rest_hours,
    recordedAtMs: msRequired(row.recorded_at_utc),
  }));
}

// --- months -----------------------------------------------------------------

type MonthDbRow = {
  crew_id: string;
  month: string;
  state: 'open' | 'awaiting_archive' | 'sealed';
  record_key: string | null;
  record_sha256: string | null;
  copy_key: string | null;
  sealed_at_utc: Date | null;
};

function toMonth(row: MonthDbRow): MonthRow {
  return {
    crewId: row.crew_id,
    month: row.month,
    state: row.state,
    recordKey: row.record_key,
    recordSha256: row.record_sha256,
    copyKey: row.copy_key,
    sealedAtMs: ms(row.sealed_at_utc),
  };
}

const MONTH_COLUMNS = `crew_id, month, state, record_key, record_sha256, copy_key, sealed_at_utc`;

export async function findMonth(crewId: string, month: string): Promise<MonthRow> {
  const rows = await query<MonthDbRow>(
    `select ${MONTH_COLUMNS} from month_state where crew_id = $1 and month = $2`,
    [crewId, month],
  );
  const row = rows[0];
  return row === undefined
    ? {
        crewId,
        month,
        state: 'open',
        recordKey: null,
        recordSha256: null,
        copyKey: null,
        sealedAtMs: null,
      }
    : toMonth(row);
}

export async function listSealedMonths(crewId: string): Promise<MonthRow[]> {
  const rows = await query<MonthDbRow>(
    `select ${MONTH_COLUMNS} from month_state where crew_id = $1 and state = 'sealed'`,
    [crewId],
  );
  return rows.map(toMonth);
}

export async function startAwaitingArchive(crewId: string, month: string): Promise<MonthRow> {
  const rows = await query<MonthDbRow>(
    `insert into month_state (crew_id, month, state) values ($1,$2,'awaiting_archive')
     on conflict (crew_id, month) do update set state = 'awaiting_archive'
     where month_state.state = 'open'
     returning ${MONTH_COLUMNS}`,
    [crewId, month],
  );
  const row = rows[0];
  return row === undefined ? await findMonth(crewId, month) : toMonth(row);
}

export async function markMonthSealed(
  crewId: string,
  month: string,
  recordKey: string,
  recordSha256: string,
  copyKey: string,
  sealedAtMs: number,
): Promise<void> {
  await query(
    `update month_state set state = 'sealed', record_key = $3, record_sha256 = $4, copy_key = $5, sealed_at_utc = $6
     where crew_id = $1 and month = $2 and state = 'awaiting_archive'`,
    [crewId, month, recordKey, recordSha256, copyKey, formatInstant(sealedAtMs)],
  );
}

/**
 * Runs work while holding this month's archive lock, across every app instance. Returns false without
 * running it when another attempt holds the lock, so two attempts never write the month's objects at once.
 */
export async function withMonthArchiveLock(
  crewId: string,
  month: string,
  work: () => Promise<void>,
): Promise<boolean> {
  const client = await pool.connect();
  const key = `month-archive:${crewId}:${month}`;
  try {
    const locked = await client.query<{ ok: boolean }>(
      'select pg_try_advisory_lock(hashtext($1)) as ok',
      [key],
    );
    if (locked.rows[0]?.ok !== true) return false;
    try {
      await work();
      return true;
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [key]);
    }
  } finally {
    client.release();
  }
}

export async function listMonthsAwaitingArchive(): Promise<{ crewId: string; month: string }[]> {
  const rows = await query<{ crew_id: string; month: string }>(
    `select crew_id, month from month_state where state = 'awaiting_archive'`,
  );
  return rows.map((row) => ({ crewId: row.crew_id, month: row.month }));
}

// --- inspection links -------------------------------------------------------

type LinkDbRow = {
  id: string;
  vessel_id: string;
  token: string;
  from_date: string;
  to_date: string;
  expires_at_utc: Date;
  revoked_at_utc: Date | null;
};

function toLink(row: LinkDbRow): LinkRow {
  return {
    id: row.id,
    vesselId: row.vessel_id,
    token: row.token,
    fromDate: row.from_date,
    toDate: row.to_date,
    expiresAtMs: msRequired(row.expires_at_utc),
    revokedAtMs: ms(row.revoked_at_utc),
  };
}

const LINK_COLUMNS = `id, vessel_id, token, from_date, to_date, expires_at_utc, revoked_at_utc`;

export async function insertLink(link: {
  id: string;
  vesselId: string;
  token: string;
  fromDate: string;
  toDate: string;
  expiresAtMs: number;
  createdAtMs: number;
}): Promise<LinkRow> {
  const rows = await query<LinkDbRow>(
    `insert into inspection_link (id, vessel_id, token, from_date, to_date, expires_at_utc, created_at_utc)
     values ($1,$2,$3,$4,$5,$6,$7) returning ${LINK_COLUMNS}`,
    [
      link.id,
      link.vesselId,
      link.token,
      link.fromDate,
      link.toDate,
      formatInstant(link.expiresAtMs),
      formatInstant(link.createdAtMs),
    ],
  );
  return toLink(rows[0] as LinkDbRow);
}

export async function listLinks(vesselId: string): Promise<LinkRow[]> {
  const rows = await query<LinkDbRow>(
    `select ${LINK_COLUMNS} from inspection_link where vessel_id = $1 order by created_at_utc, id`,
    [vesselId],
  );
  return rows.map(toLink);
}

export async function findLinkById(id: string): Promise<LinkRow | null> {
  const rows = await query<LinkDbRow>(`select ${LINK_COLUMNS} from inspection_link where id = $1`, [id]);
  const row = rows[0];
  return row === undefined ? null : toLink(row);
}

export async function findLinkByToken(token: string): Promise<LinkRow | null> {
  const rows = await query<LinkDbRow>(`select ${LINK_COLUMNS} from inspection_link where token = $1`, [token]);
  const row = rows[0];
  return row === undefined ? null : toLink(row);
}

export async function revokeLink(id: string, atMs: number): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update inspection_link set revoked_at_utc = $2 where id = $1 and revoked_at_utc is null returning id`,
    [id, formatInstant(atMs)],
  );
  return rows.length > 0;
}
