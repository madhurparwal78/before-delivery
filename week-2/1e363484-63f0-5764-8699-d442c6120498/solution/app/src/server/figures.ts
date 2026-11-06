// Figures, their readings scope, the figure state machine, the ledger and the project summary.

import type { Project } from "./auth.js";
import { pool, type Db } from "./db.js";
import { byteOrder, derive, percent, readingValue, tonnes, type Contribution, type Derivation, type Reading } from "./domain/derivation.js";
import { isoTimestamp } from "./domain/time.js";

export type FigureStatus = "sealed" | "broken" | "superseded";

export interface StoredFigure {
  id: string;
  project: string;
  start: number;
  end: number;
  sensor_ids: string[];
  status: FigureStatus;
  supersedes: string | null;
  superseded_by: string | null;
  coverage_tenths: number;
  floor_tenths: number;
  buffer_tenths: number;
  net_milli: number;
  co2_milli: number;
  ch4_milli: number;
  buffer_milli: number;
  credited_milli: number;
  readings_count: number;
  fingerprint: string;
  contributions: Contribution[];
  sealed_at: number;
  sealed_by: string;
  checked_at: number;
  revision_watermark: number;
}

export const FIGURE_COLUMNS = `id, project, epoch(start_at) AS start, epoch(end_at) AS "end", sensor_ids, status, supersedes,
  superseded_by, coverage_tenths, floor_tenths, buffer_tenths, net_milli, co2_milli, ch4_milli, buffer_milli,
  credited_milli, readings_count, fingerprint, contributions, epoch(sealed_at) AS sealed_at, sealed_by,
  epoch(checked_at) AS checked_at, revision_watermark`;

export const figureSequence = (projectCode: string) => `figure_seq_${projectCode.toLowerCase()}`;

export function evidenceKeys(figureId: string) {
  return { readings_key: `figures/${figureId}/readings.csv`, derivation_key: `figures/${figureId}/derivation.json` };
}

/** The published figure body. */
export function figureBody(row: StoredFigure) {
  return {
    id: row.id,
    project: row.project,
    start: isoTimestamp(row.start),
    end: isoTimestamp(row.end),
    sensor_ids: [...row.sensor_ids].sort(byteOrder),
    status: row.status,
    supersedes: row.supersedes,
    superseded_by: row.superseded_by,
    coverage_pct: percent(row.coverage_tenths),
    floor_pct: percent(row.floor_tenths),
    net_tco2e: tonnes(BigInt(row.net_milli)),
    co2_tco2e: tonnes(BigInt(row.co2_milli)),
    ch4_tco2e: tonnes(BigInt(row.ch4_milli)),
    buffer_pct: percent(row.buffer_tenths),
    buffer_tco2e: tonnes(BigInt(row.buffer_milli)),
    credited_tco2e: tonnes(BigInt(row.credited_milli)),
    readings_count: row.readings_count,
    fingerprint: row.fingerprint,
    sealed_at: isoTimestamp(row.sealed_at),
    sealed_by: row.sealed_by,
    checked_at: isoTimestamp(row.checked_at),
    contributions: row.contributions,
    evidence: evidenceKeys(row.id),
  };
}

/** The derived fields shared by previews and figures. */
export function derivedFields(project: Project, start: number, end: number, sensorIds: string[], d: Derivation) {
  return {
    start: isoTimestamp(start),
    end: isoTimestamp(end),
    sensor_ids: [...sensorIds].sort(byteOrder),
    coverage_pct: percent(d.coverageTenths),
    floor_pct: percent(project.floorTenths),
    net_tco2e: tonnes(d.netMilli),
    co2_tco2e: tonnes(d.co2Milli),
    ch4_tco2e: tonnes(d.ch4Milli),
    buffer_pct: percent(project.bufferTenths),
    buffer_tco2e: tonnes(d.bufferMilli),
    credited_tco2e: tonnes(d.creditedMilli),
    readings_count: d.readingsCount,
    fingerprint: d.fingerprint,
    contributions: d.contributions,
  };
}

/** The stored readings of the given sensors in [start, end). */
export async function readingsInScope(db: Db | typeof pool, sensorIds: string[], start: number, end: number): Promise<Reading[]> {
  const { rows } = await db.query<{ sensor_id: string; t: number; fc_e4: number; fch4_e4: number; qc: number }>(
    `SELECT sensor_id, epoch(interval_start) AS t, fc_e4, fch4_e4, qc FROM readings
      WHERE sensor_id = ANY($1) AND interval_start >= to_timestamp($2) AND interval_start < to_timestamp($3)`,
    [sensorIds, start, end]);
  return rows.map((r) => ({ sensorId: r.sensor_id, intervalStart: r.t, fcE4: r.fc_e4, fch4E4: r.fch4_e4, qc: r.qc }));
}

export async function deriveScope(db: Db | typeof pool, project: Project, start: number, end: number, sensorIds: string[]): Promise<Derivation> {
  return derive(project, start, end, sensorIds, await readingsInScope(db, sensorIds, start, end));
}

/** The intact (sealed) figures of a project, oldest first. */
export async function intactFigures(db: Db | typeof pool, slug: string) {
  const { rows } = await db.query<{ id: string; start: number; end: number }>(
    `SELECT id, epoch(start_at) AS start, epoch(end_at) AS "end" FROM figures
      WHERE project = $1 AND status = 'sealed' ORDER BY sealed_at, id`, [slug]);
  return rows;
}

export async function findFigure(db: Db | typeof pool, id: string): Promise<StoredFigure | null> {
  const { rows } = await db.query<StoredFigure>(`SELECT ${FIGURE_COLUMNS} FROM figures WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Re-derives a figure from current readings at `now`, records the check time and returns the figure
 * body with its re-derivation.
 */
export async function rederivedFigure(project: Project, row: StoredFigure, now: number) {
  const current = await deriveScope(pool, project, row.start, row.end, row.sensor_ids);
  await pool.query("UPDATE figures SET checked_at = to_timestamp($2) WHERE id = $1", [row.id, now]);
  return {
    ...figureBody({ ...row, checked_at: now }),
    rederived: {
      fingerprint: current.fingerprint,
      coverage_pct: percent(current.coverageTenths),
      net_tco2e: tonnes(current.netMilli),
      matches: current.fingerprint === row.fingerprint,
    },
  };
}

// --- Figure state machine: sealed → broken → superseded, and no other transition -----------------

/** A reading change altered a sealed figure's fingerprint. */
export async function markBroken(db: Db, figureId: string): Promise<void> {
  await db.query("UPDATE figures SET status = 'broken' WHERE id = $1 AND status = 'sealed'", [figureId]);
}

/** A new seal with exactly a broken figure's interval replaces it. */
export async function markSuperseded(db: Db, figureId: string, supersededBy: string): Promise<void> {
  await db.query("UPDATE figures SET status = 'superseded', superseded_by = $2 WHERE id = $1 AND status = 'broken'",
    [figureId, supersededBy]);
}

// --- Ledger and summary ------------------------------------------------------------------------

type LedgerKind = "issuance" | "buffer" | "reversal";

interface LedgerRow { id: number; figure_id: string; kind: LedgerKind; tco2e_milli: number; reverses: number | null; recorded_at: number }

export function ledgerEntryBody(e: LedgerRow) {
  return {
    id: String(e.id), figure_id: e.figure_id, kind: e.kind, tco2e: tonnes(BigInt(e.tco2e_milli)),
    reverses: e.reverses === null ? null : String(e.reverses), recorded_at: isoTimestamp(e.recorded_at),
  };
}

/**
 * The ledger entries and figure counts of a project read in one statement (one snapshot), and the
 * balance, buffer total and counts computed from them: the one place the ledger balance is decided.
 */
export async function ledgerState(db: Db | typeof pool, slug: string) {
  const { rows } = await db.query<{ entries: LedgerRow[]; counts: Record<FigureStatus, number> }>(
    `SELECT coalesce((SELECT json_agg(json_build_object('id', id, 'figure_id', figure_id, 'kind', kind,
                       'tco2e_milli', tco2e_milli, 'reverses', reverses, 'recorded_at', epoch(recorded_at)) ORDER BY id)
                      FROM ledger_entries WHERE project = $1), '[]') AS entries,
            (SELECT json_build_object('sealed', count(*) FILTER (WHERE status = 'sealed'),
                                      'broken', count(*) FILTER (WHERE status = 'broken'),
                                      'superseded', count(*) FILTER (WHERE status = 'superseded'))
               FROM figures WHERE project = $1) AS counts`, [slug]);
  const { entries, counts } = rows[0]!;
  const bufferIds = new Set(entries.filter((e) => e.kind === "buffer").map((e) => e.id));
  const balance = entries.reduce((sum, e) => sum + BigInt(e.tco2e_milli), 0n);
  const buffer = entries
    .filter((e) => e.kind === "buffer" || (e.reverses !== null && bufferIds.has(e.reverses)))
    .reduce((sum, e) => sum + BigInt(e.tco2e_milli), 0n);
  return {
    entries,
    summary: {
      sealed_net_tco2e: tonnes(balance),
      buffer_tco2e: tonnes(buffer),
      intact_count: counts.sealed,
      broken_count: counts.broken,
      superseded_count: counts.superseded,
    },
  };
}

/** Writes one issuance entry and, for a net removal, one buffer entry. */
export async function writeIssuance(db: Db, slug: string, figure: StoredFigure, now: number): Promise<void> {
  await db.query(`INSERT INTO ledger_entries (project, figure_id, kind, tco2e_milli, recorded_at)
                  VALUES ($1, $2, 'issuance', $3, to_timestamp($4))`, [slug, figure.id, figure.net_milli, now]);
  if (figure.net_milli < 0) {
    await db.query(`INSERT INTO ledger_entries (project, figure_id, kind, tco2e_milli, recorded_at)
                    VALUES ($1, $2, 'buffer', $3, to_timestamp($4))`, [slug, figure.id, figure.buffer_milli, now]);
  }
}

/** Writes one reversal per entry of the figure, each the exact negation of its entry; returns their sum. */
export async function writeReversals(db: Db, figureId: string, now: number): Promise<bigint> {
  const { rows } = await db.query<{ tco2e_milli: number }>(
    `INSERT INTO ledger_entries (project, figure_id, kind, tco2e_milli, reverses, recorded_at)
     SELECT project, figure_id, 'reversal', -tco2e_milli, id, to_timestamp($2)
       FROM ledger_entries WHERE figure_id = $1 AND kind <> 'reversal' ORDER BY id
     RETURNING tco2e_milli`, [figureId, now]);
  return rows.reduce((sum, r) => sum + BigInt(r.tco2e_milli), 0n);
}

// --- Audit trail -------------------------------------------------------------------------------

export async function auditTrail(figure: StoredFigure) {
  const { rows } = await pool.query<{
    sensor_id: string; t: number; old_fc_e4: number | null; old_fch4_e4: number | null; old_qc: number | null;
    new_fc_e4: number; new_fch4_e4: number; new_qc: number; revised_at: number; batch_id: string;
  }>(
    `SELECT sensor_id, epoch(interval_start) AS t, old_fc_e4, old_fch4_e4, old_qc, new_fc_e4, new_fch4_e4, new_qc,
            epoch(revised_at) AS revised_at, batch_id
       FROM revisions
      WHERE sensor_id = ANY($1) AND interval_start >= to_timestamp($2) AND interval_start < to_timestamp($3) AND id > $4
      ORDER BY revised_at, sensor_id COLLATE "C", interval_start, id`,
    [figure.sensor_ids, figure.start, figure.end, figure.revision_watermark]);
  return {
    figure_id: figure.id,
    moved: rows.map((r) => ({
      sensor_id: r.sensor_id,
      interval_start: isoTimestamp(r.t),
      old: r.old_qc === null ? null : { fc: readingValue(r.old_fc_e4!), fch4: readingValue(r.old_fch4_e4!), qc: r.old_qc },
      new: { fc: readingValue(r.new_fc_e4), fch4: readingValue(r.new_fch4_e4), qc: r.new_qc },
      revised_at: isoTimestamp(r.revised_at),
      batch_id: r.batch_id,
    })),
  };
}
