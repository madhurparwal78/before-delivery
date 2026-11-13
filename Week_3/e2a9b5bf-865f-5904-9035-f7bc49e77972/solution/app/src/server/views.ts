import type {
  CatalogueObject,
  Derived,
  Kit,
  Observation,
  Optics,
  Packet,
  PacketRow,
  PacketState,
  Pair,
  ProgramDetail,
  ProgramEdition,
  Session,
  SketchRef,
} from "../shared/types";
import { representative, type Ranked } from "../shared/completeness";
import { PACKET_LABELS } from "../shared/messages";
import { TRAINS } from "../shared/optics";
import { measuredPair } from "../shared/pair";
import { isoSeconds, localClock, offsetAt } from "../shared/time";
import type { Db } from "./db";

export interface SessionRow {
  id: string;
  site_id: string;
  site_name: string;
  time_zone: string;
  started_at: Date;
  evening_date: string;
  local_start: string;
  local_start_offset: string;
  optics: Optics;
  derived: Derived;
  observation_count: number;
}

export const SESSION_SELECT = `
  SELECT s.id, s.site_id, st.name AS site_name, st.time_zone, s.started_at, s.evening_date, s.local_start,
         s.local_start_offset, s.optics, s.derived,
         (SELECT count(*)::int FROM observations o WHERE o.session_id = s.id AND NOT o.deleted) AS observation_count
  FROM obs_sessions s JOIN sites st ON st.id = s.site_id`;

export function sessionView(row: SessionRow): Session {
  return {
    id: row.id,
    site: { id: row.site_id, name: row.site_name, time_zone: row.time_zone },
    started_at: isoSeconds(row.started_at),
    evening_date: row.evening_date,
    local_start: row.local_start,
    local_start_offset: row.local_start_offset,
    optics: row.optics,
    derived: row.derived,
    observation_count: row.observation_count,
  };
}

export interface FieldEdit {
  at: string;
  device: string;
  version: number;
}

export type FieldMeta = Partial<Record<string, FieldEdit>>;

export interface ObservationRow {
  id: string;
  account_id: string;
  session_id: string;
  object_id: string;
  designation: string;
  object_name: string;
  kind: CatalogueObject["kind"];
  observed_at: Date | null;
  seeing: number | null;
  transparency_nelm: number | null;
  concentration_class: string | null;
  pair: { primary: [number, number]; secondary: [number, number] } | null;
  description: string;
  optics: Optics;
  derived: Derived;
  sketch: SketchRef | null;
  sketch_marks: number;
  raster_sha: string | null;
  version: number;
  field_meta: FieldMeta;
  deleted: boolean;
  created_seq: number;
  evening_date: string;
  site_id: string;
  site_name: string;
  time_zone: string;
  started_at: Date;
}

export const OBSERVATION_SELECT = `
  SELECT o.*, c.designation, c.name AS object_name, c.kind, s.evening_date, s.started_at, s.site_id,
         st.name AS site_name, st.time_zone
  FROM observations o
  JOIN obs_sessions s ON s.id = o.session_id
  JOIN sites st ON st.id = s.site_id
  JOIN catalogue_objects c ON c.id = o.object_id`;

function pairView(pair: ObservationRow["pair"]): Pair | null {
  return pair ? measuredPair(pair.primary, pair.secondary) : null;
}

export function observationView(row: ObservationRow): Observation {
  return {
    id: row.id,
    session_id: row.session_id,
    object_id: row.object_id,
    designation: row.designation,
    kind: row.kind,
    observed_at: row.observed_at ? isoSeconds(row.observed_at) : null,
    local_time: row.observed_at ? localClock(row.observed_at, row.time_zone) : null,
    local_offset: row.observed_at ? offsetAt(row.observed_at, row.time_zone) : null,
    evening_date: row.evening_date,
    site: { id: row.site_id, name: row.site_name, time_zone: row.time_zone },
    seeing: row.seeing,
    transparency_nelm: row.transparency_nelm,
    concentration_class: row.concentration_class,
    pair: pairView(row.pair),
    description: row.description,
    optics: row.optics,
    derived: row.derived,
    sketch: row.sketch,
    version: row.version,
  };
}

export async function observationRow(db: Db, id: string, accountId: string, lock = false): Promise<ObservationRow | null> {
  const { rows } = await db.query<ObservationRow>(
    `${OBSERVATION_SELECT} WHERE o.id = $1 AND o.account_id = $2${lock ? " FOR UPDATE OF o" : ""}`,
    [id, accountId],
  );
  return rows[0] ?? null;
}

export async function loadKit(db: Db, accountId: string): Promise<Kit> {
  const [telescopes, eyepieces, barlows] = await Promise.all([
    db.query("SELECT id, name, aperture_mm, focal_length_mm FROM telescopes WHERE account_id = $1 ORDER BY seq", [accountId]),
    db.query("SELECT id, name, focal_length_mm, apparent_field_deg FROM eyepieces WHERE account_id = $1 ORDER BY focal_length_mm DESC, seq", [accountId]),
    db.query("SELECT id, name, factor FROM barlows WHERE account_id = $1 ORDER BY seq", [accountId]),
  ]);
  return { telescopes: telescopes.rows, eyepieces: eyepieces.rows, barlows: barlows.rows, trains: [...TRAINS] };
}

/* ---- programs ---- */

interface ProgramDef {
  id: string;
  name: string;
  required_count: number;
  coordinator_name: string;
  coordinator_email: string;
  object_ids: string[];
  editions: ProgramEdition[];
}

export async function loadPrograms(db: Db, id?: string): Promise<ProgramDef[]> {
  const where = id ? "WHERE p.id = $1" : "";
  const args = id ? [id] : [];
  const { rows } = await db.query<Omit<ProgramDef, "object_ids" | "editions">>(
    `SELECT p.id, p.name, p.required_count, p.coordinator_name, p.coordinator_email FROM programs p ${where} ORDER BY p.position`,
    args,
  );
  const objects = await db.query<{ program_id: string; object_id: string }>(
    "SELECT program_id, object_id FROM program_objects ORDER BY program_id, position",
  );
  const editions = await db.query<ProgramEdition & { program_id: string }>(
    "SELECT * FROM program_editions ORDER BY program_id, edition",
  );
  return rows.map((p) => ({
    ...p,
    object_ids: objects.rows.filter((o) => o.program_id === p.id).map((o) => o.object_id),
    editions: editions.rows
      .filter((e) => e.program_id === p.id)
      .map(({ edition, effective_from, min_description, sketch_required, concentration_required, pair_required }) => ({
        edition,
        effective_from,
        min_description,
        sketch_required,
        concentration_required,
        pair_required,
      })),
  }));
}

interface Judged extends Ranked {
  designation: string;
}

async function loadJudged(db: Db, accountId: string, ids?: string[]): Promise<Judged[]> {
  const { rows } = await db.query<ObservationRow>(
    `${OBSERVATION_SELECT} WHERE o.account_id = $1 AND NOT o.deleted${ids ? " AND o.id = ANY($2::uuid[])" : ""}`,
    ids ? [accountId, ids] : [accountId],
  );
  return rows.map(judgedOf);
}

export function judgedOf(row: ObservationRow): Judged {
  return {
    id: row.id,
    designation: row.designation,
    object_id: row.object_id,
    kind: row.kind,
    evening_date: row.evening_date,
    observed_at: row.observed_at ? isoSeconds(row.observed_at) : null,
    seeing: row.seeing,
    transparency_nelm: row.transparency_nelm,
    description: row.description,
    concentration_class: row.concentration_class,
    pair: row.pair,
    has_sketch: row.sketch_marks > 0,
    created_seq: row.created_seq,
  };
}

export async function programViews(db: Db, accountId: string): Promise<ProgramDetail[]> {
  const [programs, judged, followed, objectRows] = await Promise.all([
    loadPrograms(db),
    loadJudged(db, accountId),
    db.query<{ program_id: string }>("SELECT program_id FROM follows WHERE account_id = $1", [accountId]),
    db.query<CatalogueObject>("SELECT id, designation, name, kind FROM catalogue_objects"),
  ]);
  const names = new Map(objectRows.rows.map((o) => [o.id, o]));
  return programs.map((program) => {
    const newest = program.editions[program.editions.length - 1];
    if (!newest) throw new Error(`program ${program.id} has no edition`);
    const objects = program.object_ids.map((objectId) => {
      const rep = representative(judged.filter((o) => o.object_id === objectId), program);
      const object = names.get(objectId);
      return {
        object_id: objectId,
        designation: object?.designation ?? objectId,
        name: object?.name ?? objectId,
        qualifying_observation_id: rep.qualifying ? (rep.observation?.id ?? null) : null,
      };
    });
    return {
      id: program.id,
      name: program.name,
      required_count: program.required_count,
      sketch_required: newest.sketch_required,
      min_description: newest.min_description,
      concentration_required: newest.concentration_required,
      pair_required: newest.pair_required,
      editions: program.editions,
      coordinator_name: program.coordinator_name,
      coordinator_email: program.coordinator_email,
      following: followed.rows.some((f) => f.program_id === program.id),
      progress: {
        qualifying: objects.filter((o) => o.qualifying_observation_id !== null).length,
        total: program.object_ids.length,
        required: program.required_count,
      },
      objects,
    };
  });
}


/* ---- packets ---- */

export interface PacketRowData {
  id: string;
  account_id: string;
  number: number;
  program_id: string;
  state: PacketState;
  revision: number;
  observation_ids: string[];
  rows: PacketRow[];
  pdf: Packet["pdf"];
  failure: Packet["failure"];
  sent_at: Date | null;
  returned_to_draft: boolean;
  created_at: Date;
  render_attempt: string | null;
  state_since: Date;
  before_send: { state: PacketState; revision: number; failure: Packet["failure"] } | null;
}

export function packetView(row: PacketRowData): Packet {
  return {
    id: row.id,
    number: row.number,
    program_id: row.program_id,
    state: row.state,
    label: PACKET_LABELS[row.state],
    revision: row.revision,
    observation_ids: row.observation_ids,
    rows: row.rows,
    pdf: row.pdf,
    failure: row.failure,
    sent_at: row.sent_at ? isoSeconds(row.sent_at) : null,
    returned_to_draft: row.returned_to_draft,
    created_at: isoSeconds(row.created_at),
  };
}

export async function packetRow(db: Db, id: string, accountId: string, lock = false): Promise<PacketRowData | null> {
  const { rows } = await db.query<PacketRowData>(
    `SELECT * FROM packets WHERE id = $1 AND account_id = $2${lock ? " FOR UPDATE" : ""}`,
    [id, accountId],
  );
  return rows[0] ?? null;
}
