import { query, queryOne, withTransaction, type Transaction } from '../db/pool.js';
import { fail, validation, type FieldReasons } from '../http/errors.js';
import { isoTime } from './time.js';
import { isWholeNumber, type JsonObject } from './requestFields.js';

export type MissionKind = 'standard' | 'rush';
export type MissionStatus = 'draft' | 'scheduled' | 'live' | 'retired';

export interface Dialogue {
  offer: string[];
  thanks: string[];
}

export interface MissionRecord {
  mission_id: string;
  title: string;
  resident_id: string;
  reward_stamps: number;
  kind: MissionKind;
  rush_slots: number | null;
  dialogue: Dialogue;
  status: MissionStatus;
  version: number;
  revision: number;
  live_at: Date | null;
}

const MISSION_SELECT = `select m.mission_id, m.kind, m.status, m.version, m.revision,
                               m.rush_slots, m.live_at, v.title, v.resident_id, v.reward_stamps,
                               v.dialogue
                        from missions m
                        join mission_versions v
                          on v.mission_id = m.mission_id and v.version = m.version`;

interface MissionRow {
  mission_id: string;
  kind: MissionKind;
  status: MissionStatus;
  version: number;
  revision: number;
  rush_slots: number | null;
  live_at: Date | null;
  title: string;
  resident_id: string;
  reward_stamps: number;
  dialogue: Dialogue;
}

function toRecord(row: MissionRow): MissionRecord {
  return {
    mission_id: row.mission_id,
    title: row.title,
    resident_id: row.resident_id,
    reward_stamps: row.reward_stamps,
    kind: row.kind,
    rush_slots: row.rush_slots,
    dialogue: row.dialogue,
    status: row.status,
    version: row.version,
    revision: row.revision,
    live_at: row.live_at,
  };
}

export function missionBody(mission: MissionRecord): unknown {
  return {
    mission_id: mission.mission_id,
    title: mission.title,
    resident_id: mission.resident_id,
    reward_stamps: mission.reward_stamps,
    kind: mission.kind,
    rush_slots: mission.rush_slots,
    dialogue: mission.dialogue,
    status: mission.status,
    version: mission.version,
    revision: mission.revision,
    live_at: mission.live_at === null ? null : isoTime(mission.live_at),
  };
}

export async function listMissions(): Promise<MissionRecord[]> {
  const rows = await query<MissionRow>(`${MISSION_SELECT} order by m.created_at, m.mission_id`);
  return rows.map(toRecord);
}

export async function loadMission(missionId: string): Promise<MissionRecord | null> {
  const row = await queryOne<MissionRow>(`${MISSION_SELECT} where m.mission_id = $1`, [missionId]);
  return row === null ? null : toRecord(row);
}

export async function loadMissionIn(
  tx: Transaction,
  missionId: string,
  lock = false,
): Promise<MissionRecord | null> {
  const row = await tx.one<MissionRow>(
    `${MISSION_SELECT} where m.mission_id = $1${lock ? ' for update of m' : ''}`,
    [missionId],
  );
  return row === null ? null : toRecord(row);
}

/** The version a courier is holding, whatever has happened to the mission since. */
export async function loadMissionVersion(
  tx: Transaction,
  missionId: string,
  version: number,
): Promise<{ title: string; resident_id: string; reward_stamps: number; dialogue: Dialogue }> {
  const row = await tx.one<{
    title: string;
    resident_id: string;
    reward_stamps: number;
    dialogue: Dialogue;
  }>(
    `select title, resident_id, reward_stamps, dialogue from mission_versions
     where mission_id = $1 and version = $2`,
    [missionId, version],
  );
  if (row === null) throw fail('internal');
  return row;
}

const LINE_BREAK = /[\r\n\u2028\u2029]/;

function codePoints(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

export interface MissionFields {
  title: string;
  resident_id: string;
  reward_stamps: number;
  kind: MissionKind;
  rush_slots: number | null;
  dialogue: Dialogue;
}

type Mode = { mode: 'create' } | { mode: 'edit'; storedKind: MissionKind };

function checkTitle(raw: unknown, into: FieldReasons): string | null {
  if (raw === undefined) {
    into.title = 'required';
    return null;
  }
  if (typeof raw !== 'string' || LINE_BREAK.test(raw)) {
    into.title = 'invalid';
    return null;
  }
  if (raw.length === 0) {
    into.title = 'required';
    return null;
  }
  if (codePoints(raw) > 60) {
    into.title = 'too_long';
    return null;
  }
  return raw;
}

function checkReward(raw: unknown, into: FieldReasons): number | null {
  if (raw === undefined || raw === null) {
    into.reward_stamps = 'required';
    return null;
  }
  if (!isWholeNumber(raw)) {
    into.reward_stamps = 'invalid';
    return null;
  }
  if (raw < 1 || raw > 50) {
    into.reward_stamps = 'out_of_range';
    return null;
  }
  return raw;
}

function checkResident(raw: unknown, seeded: Set<string>, into: FieldReasons): string | null {
  if (raw === undefined) {
    into.resident_id = 'required';
    return null;
  }
  if (typeof raw !== 'string') {
    into.resident_id = 'invalid';
    return null;
  }
  if (!seeded.has(raw)) {
    into.resident_id = 'unknown_resident';
    return null;
  }
  return raw;
}

function checkKind(raw: unknown, mode: Mode, into: FieldReasons): MissionKind | null {
  if (raw === undefined) {
    if (mode.mode === 'create') into.kind = 'required';
    return mode.mode === 'edit' ? mode.storedKind : null;
  }
  if (raw !== 'standard' && raw !== 'rush') {
    into.kind = 'invalid';
    return null;
  }
  if (mode.mode === 'edit') {
    into.kind = 'fixed_after_create';
    return mode.storedKind;
  }
  return raw;
}

function checkRushSlots(raw: unknown, kind: MissionKind | null, into: FieldReasons): number | null {
  if (raw === undefined) {
    into.rush_slots = 'required';
    return null;
  }
  if (kind === 'standard') {
    if (raw !== null) into.rush_slots = 'invalid';
    return null;
  }
  if (raw === null) {
    into.rush_slots = 'required';
    return null;
  }
  if (!isWholeNumber(raw)) {
    into.rush_slots = 'invalid';
    return null;
  }
  if (raw < 1 || raw > 5) {
    into.rush_slots = 'out_of_range';
    return null;
  }
  return raw;
}

function checkLines(
  raw: unknown,
  path: string,
  min: number,
  max: number,
  into: FieldReasons,
): string[] | null {
  if (raw === undefined) {
    into[path] = 'required';
    return null;
  }
  if (!Array.isArray(raw) || raw.some((line) => typeof line !== 'string' || LINE_BREAK.test(line))) {
    into[path] = 'invalid';
    return null;
  }
  const lines = raw as string[];
  if (lines.length < min || lines.length > max) {
    into[path] = 'out_of_range';
    return null;
  }
  if (lines.some((line) => line.length === 0)) {
    into[path] = 'required';
    return null;
  }
  if (lines.some((line) => codePoints(line) > 200)) {
    into[path] = 'too_long';
    return null;
  }
  return lines;
}

function checkDialogue(raw: unknown, into: FieldReasons): Dialogue | null {
  if (raw === undefined) {
    into.dialogue = 'required';
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    into.dialogue = 'invalid';
    return null;
  }
  const value = raw as JsonObject;
  const offer = checkLines(value.offer, 'dialogue.offer', 1, 6, into);
  const thanks = checkLines(value.thanks, 'dialogue.thanks', 1, 3, into);
  return offer && thanks ? { offer, thanks } : null;
}

/** The one place mission fields and their reasons are decided. */
export function readMissionFields(
  body: JsonObject,
  seededResidents: Set<string>,
  mode: Mode,
): Partial<MissionFields> {
  const reasons: FieldReasons = {};
  const present = (key: string): boolean => mode.mode === 'create' || key in body;
  const draft: Partial<MissionFields> = {};

  if (present('title')) {
    const title = checkTitle(body.title, reasons);
    if (title !== null) draft.title = title;
  }
  if (present('resident_id')) {
    const resident = checkResident(body.resident_id, seededResidents, reasons);
    if (resident !== null) draft.resident_id = resident;
  }
  if (present('reward_stamps')) {
    const reward = checkReward(body.reward_stamps, reasons);
    if (reward !== null) draft.reward_stamps = reward;
  }
  const kind = present('kind') ? checkKind(body.kind, mode, reasons) : mode.mode === 'edit' ? mode.storedKind : null;
  if (mode.mode === 'create' && kind !== null) draft.kind = kind;
  if (present('rush_slots')) {
    const slots = checkRushSlots(body.rush_slots, kind, reasons);
    draft.rush_slots = slots;
  }
  if (present('dialogue')) {
    const dialogue = checkDialogue(body.dialogue, reasons);
    if (dialogue !== null) draft.dialogue = dialogue;
  }
  if (Object.keys(reasons).length > 0) throw validation(reasons);
  return draft;
}

const SLUG_TRIM = /^-+|-+$/g;

export function missionIdFromTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(SLUG_TRIM, '')
    .slice(0, 64)
    .replace(SLUG_TRIM, '');
  return slug.length > 0 ? slug : 'mission';
}

async function freeMissionId(tx: Transaction, base: string): Promise<string> {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base.slice(0, 64 - String(suffix).length - 1)}-${suffix}`;
    const taken = await tx.one<{ mission_id: string }>(
      'select mission_id from missions where mission_id = $1',
      [candidate],
    );
    if (!taken) return candidate;
  }
}

export async function createMission(fields: MissionFields): Promise<MissionRecord> {
  return withTransaction(async (tx) => {
    await tx.lock('mission-ids');
    const missionId = await freeMissionId(tx, missionIdFromTitle(fields.title));
    await tx.query(
      `insert into missions (mission_id, kind, status, version, revision, rush_slots, live_at)
       values ($1, $2, 'draft', 1, 1, $3, null)`,
      [missionId, fields.kind, fields.rush_slots],
    );
    await tx.query(
      `insert into mission_versions
         (mission_id, version, title, resident_id, reward_stamps, rush_slots, dialogue)
       values ($1, 1, $2, $3, $4, $5, $6)`,
      [
        missionId,
        fields.title,
        fields.resident_id,
        fields.reward_stamps,
        fields.rush_slots,
        JSON.stringify(fields.dialogue),
      ],
    );
    return (await loadMissionIn(tx, missionId))!;
  });
}

/** Requires the revision the change was made from, so a stale view changes nothing. */
export function checkRevision(mission: MissionRecord, ifMatch: string | undefined): void {
  if (ifMatch === undefined) throw fail('precondition_required');
  if (ifMatch !== `"${mission.revision}"`) {
    throw fail('stale_revision', { headers: { ETag: `"${mission.revision}"` } });
  }
}

export function etagOf(mission: MissionRecord): Record<string, string> {
  return { ETag: `"${mission.revision}"` };
}

/** Editing a live mission makes a new version; a draft or scheduled one changes in place. */
export async function applyEdit(
  tx: Transaction,
  mission: MissionRecord,
  changes: Partial<MissionFields>,
): Promise<MissionRecord> {
  if (mission.status === 'retired') throw fail('mission_retired');
  const next: MissionFields = {
    title: changes.title ?? mission.title,
    resident_id: changes.resident_id ?? mission.resident_id,
    reward_stamps: changes.reward_stamps ?? mission.reward_stamps,
    kind: mission.kind,
    rush_slots: 'rush_slots' in changes ? changes.rush_slots ?? null : mission.rush_slots,
    dialogue: changes.dialogue ?? mission.dialogue,
  };
  const version = mission.status === 'live' ? mission.version + 1 : mission.version;
  if (version === mission.version) {
    await tx.query(
      `update mission_versions
       set title = $3, resident_id = $4, reward_stamps = $5, rush_slots = $6, dialogue = $7
       where mission_id = $1 and version = $2`,
      [
        mission.mission_id,
        version,
        next.title,
        next.resident_id,
        next.reward_stamps,
        next.rush_slots,
        JSON.stringify(next.dialogue),
      ],
    );
  } else {
    await tx.query(
      `insert into mission_versions
         (mission_id, version, title, resident_id, reward_stamps, rush_slots, dialogue)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        mission.mission_id,
        version,
        next.title,
        next.resident_id,
        next.reward_stamps,
        next.rush_slots,
        JSON.stringify(next.dialogue),
      ],
    );
  }
  await tx.query(
    'update missions set version = $2, revision = revision + 1, rush_slots = $3 where mission_id = $1',
    [mission.mission_id, version, next.rush_slots],
  );
  return (await loadMissionIn(tx, mission.mission_id))!;
}

export type Move = 'schedule' | 'publish' | 'unschedule' | 'retire';

const LEGAL_FROM: Record<Move, MissionStatus[]> = {
  schedule: ['draft'],
  publish: ['draft'],
  unschedule: ['scheduled'],
  retire: ['live'],
};

const MOVE_TO: Record<Move, MissionStatus> = {
  schedule: 'scheduled',
  publish: 'live',
  unschedule: 'draft',
  retire: 'retired',
};

export function legalMoves(status: MissionStatus): Move[] {
  return (Object.keys(LEGAL_FROM) as Move[]).filter((move) => LEGAL_FROM[move].includes(status));
}

export function refuseIllegalMove(mission: MissionRecord, move: Move): void {
  if (!LEGAL_FROM[move].includes(mission.status)) {
    throw fail('illegal_transition', {
      sentence: `That mission can't move from ${mission.status} to ${MOVE_TO[move]}.`,
    });
  }
}

export async function applyMove(
  tx: Transaction,
  mission: MissionRecord,
  move: Move,
  instant: Date | null,
): Promise<MissionRecord> {
  const liveAt = move === 'unschedule' ? null : move === 'retire' ? mission.live_at : instant;
  await tx.query(
    'update missions set status = $2, live_at = $3, revision = revision + 1 where mission_id = $1',
    [mission.mission_id, MOVE_TO[move], liveAt],
  );
  if (move === 'retire') {
    await tx.query(
      `delete from rush_parcels where mission_id = $1 and status = 'posted'`,
      [mission.mission_id],
    );
  }
  return (await loadMissionIn(tx, mission.mission_id))!;
}

/** A scheduled mission goes live by itself the moment its instant arrives. */
export async function promoteDueMissions(): Promise<string[]> {
  const rows = await query<{ mission_id: string }>(
    `update missions set status = 'live', revision = revision + 1
     where status = 'scheduled' and live_at <= now()
     returning mission_id`,
  );
  return rows.map((row) => row.mission_id);
}
