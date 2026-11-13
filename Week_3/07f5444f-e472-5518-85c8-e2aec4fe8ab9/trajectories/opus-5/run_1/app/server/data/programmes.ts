import type { ProgrammeStatus, Role, ScanKind, StringCount } from '../../shared/api.js';
import type { Queryable } from '../db/pool.js';

export interface ProgrammeRow {
  id: string;
  number: number;
  title: string;
  status: ProgrammeStatus;
  first_rehearsal: Date;
  violin_1: number;
  violin_2: number;
  viola: number;
  cello: number;
  bass: number;
}

export interface WorkRow {
  id: string;
  programme_id: string;
  catalogue_work_id: string;
  ord: number;
  title: string;
  composer: string;
  bars: number;
}

export interface PartRow {
  id: string;
  programme_work_id: string;
  chair_key: string;
  name: string;
  bars_from: number;
  bars_to: number;
  ord: number;
  copies_on_hand: number;
}

export interface CutRow {
  id: string;
  programme_work_id: string;
  from_bar: number;
  to_bar: number;
  created_at: Date;
}

export interface MarkRow {
  part_id: string;
  cut_id: string;
  marked_by: string;
  marked_at: Date;
  marked_by_name: string;
  marked_by_role: Role;
}

export interface ScanRow {
  id: string;
  part_id: string;
  kind: ScanKind;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
  filed_at: Date;
  uploaded_by: string;
  uploaded_by_name: string;
}

interface BarSpanRow {
  catalogue_work_id: string;
  from_bar: number;
  to_bar: number;
  bar_ms: number;
}

interface LetterRow {
  catalogue_work_id: string;
  letter: string;
  bar: number;
}

export interface WorkAggregate {
  row: WorkRow;
  barMap: { from_bar: number; to_bar: number; bar_ms: number }[];
  letters: { letter: string; bar: number }[];
  parts: PartRow[];
  cuts: CutRow[];
  marksByPart: Map<string, MarkRow[]>;
  latestScans: Map<string, Partial<Record<ScanKind, ScanRow>>>;
}

export interface ProgrammeAggregate {
  row: ProgrammeRow;
  performances: Date[];
  works: WorkAggregate[];
}

export interface RosterChair {
  person_id: string;
  chair_key: string;
  chair_number: number;
}

export function stringCountOf(row: ProgrammeRow): StringCount {
  return {
    violin_1: row.violin_1,
    violin_2: row.violin_2,
    viola: row.viola,
    cello: row.cello,
    bass: row.bass,
  };
}

export async function loadRoster(db: Queryable): Promise<RosterChair[]> {
  const result = await db.query<RosterChair>(
    `SELECT id AS person_id, chair_key, chair_number
       FROM people
      WHERE chair_key IS NOT NULL AND chair_number IS NOT NULL
      ORDER BY chair_key, chair_number`,
  );
  return result.rows;
}

export async function loadSectionRosterSizes(db: Queryable): Promise<Map<string, number>> {
  const result = await db.query<{ chair_key: string; players: number }>(
    `SELECT chair_key, count(*)::int AS players
       FROM people
      WHERE chair_key IS NOT NULL
      GROUP BY chair_key`,
  );
  return new Map(result.rows.map((row) => [row.chair_key, row.players]));
}

export async function loadProgrammeAggregates(
  db: Queryable,
  programmeIds: string[] | null,
): Promise<ProgrammeAggregate[]> {
  const programmes = programmeIds
    ? await db.query<ProgrammeRow>(`SELECT * FROM programmes WHERE id = ANY($1::text[]) ORDER BY number`, [
        programmeIds,
      ])
    : await db.query<ProgrammeRow>(`SELECT * FROM programmes ORDER BY number`);
  if (programmes.rows.length === 0) return [];
  const ids = programmes.rows.map((row) => row.id);

  const [performances, works] = await Promise.all([
    db.query<{ programme_id: string; at: Date }>(
      `SELECT programme_id, at FROM performances WHERE programme_id = ANY($1::text[]) ORDER BY at`,
      [ids],
    ),
    db.query<WorkRow>(
      `SELECT pw.id, pw.programme_id, pw.catalogue_work_id, pw.ord, cw.title, cw.composer, cw.bars
         FROM programme_works pw
         JOIN catalogue_works cw ON cw.id = pw.catalogue_work_id
        WHERE pw.programme_id = ANY($1::text[])
        ORDER BY pw.ord`,
      [ids],
    ),
  ]);

  const workIds = works.rows.map((row) => row.id);
  const catalogueIds = [...new Set(works.rows.map((row) => row.catalogue_work_id))];

  const [barSpans, letters, parts, cuts] = await Promise.all([
    db.query<BarSpanRow>(
      `SELECT * FROM catalogue_bar_spans WHERE catalogue_work_id = ANY($1::text[]) ORDER BY from_bar`,
      [catalogueIds],
    ),
    db.query<LetterRow>(`SELECT * FROM catalogue_letters WHERE catalogue_work_id = ANY($1::text[]) ORDER BY bar`, [
      catalogueIds,
    ]),
    db.query<PartRow>(`SELECT * FROM parts WHERE programme_work_id = ANY($1::text[]) ORDER BY ord`, [workIds]),
    db.query<CutRow>(`SELECT * FROM cuts WHERE programme_work_id = ANY($1::text[]) ORDER BY from_bar`, [workIds]),
  ]);

  const partIds = parts.rows.map((row) => row.id);
  const [marks, scans] = await Promise.all([
    db.query<MarkRow>(
      `SELECT m.part_id, m.cut_id, m.marked_by, m.marked_at,
              p.name AS marked_by_name, p.role AS marked_by_role
         FROM marks m
         JOIN people p ON p.id = m.marked_by
        WHERE m.part_id = ANY($1::text[])`,
      [partIds],
    ),
    db.query<ScanRow>(
      `SELECT DISTINCT ON (s.part_id, s.kind) s.*, p.name AS uploaded_by_name
         FROM scans s
         JOIN people p ON p.id = s.uploaded_by
        WHERE s.part_id = ANY($1::text[])
        ORDER BY s.part_id, s.kind, s.filed_at DESC, s.id DESC`,
      [partIds],
    ),
  ]);

  const byWork = new Map<string, WorkAggregate>();
  for (const row of works.rows) {
    byWork.set(row.id, {
      row,
      barMap: barSpans.rows
        .filter((span) => span.catalogue_work_id === row.catalogue_work_id)
        .map((span) => ({ from_bar: span.from_bar, to_bar: span.to_bar, bar_ms: span.bar_ms })),
      letters: letters.rows
        .filter((letter) => letter.catalogue_work_id === row.catalogue_work_id)
        .map((letter) => ({ letter: letter.letter, bar: letter.bar })),
      parts: [],
      cuts: [],
      marksByPart: new Map(),
      latestScans: new Map(),
    });
  }
  for (const part of parts.rows) byWork.get(part.programme_work_id)?.parts.push(part);
  for (const cut of cuts.rows) byWork.get(cut.programme_work_id)?.cuts.push(cut);

  const workOfPart = new Map(parts.rows.map((part) => [part.id, part.programme_work_id]));
  for (const mark of marks.rows) {
    const work = byWork.get(workOfPart.get(mark.part_id) ?? '');
    if (!work) continue;
    const list = work.marksByPart.get(mark.part_id) ?? [];
    list.push(mark);
    work.marksByPart.set(mark.part_id, list);
  }
  for (const scan of scans.rows) {
    const work = byWork.get(workOfPart.get(scan.part_id) ?? '');
    if (!work) continue;
    const kinds = work.latestScans.get(scan.part_id) ?? {};
    kinds[scan.kind] = scan;
    work.latestScans.set(scan.part_id, kinds);
  }

  return programmes.rows.map((row) => ({
    row,
    performances: performances.rows.filter((entry) => entry.programme_id === row.id).map((entry) => entry.at),
    works: works.rows
      .filter((work) => work.programme_id === row.id)
      .map((work) => {
        const aggregate = byWork.get(work.id);
        if (!aggregate) throw new Error(`work aggregate missing: ${work.id}`);
        return aggregate;
      }),
  }));
}

export async function loadProgrammeAggregate(
  db: Queryable,
  programmeId: string,
): Promise<ProgrammeAggregate | null> {
  const [aggregate] = await loadProgrammeAggregates(db, [programmeId]);
  return aggregate ?? null;
}

export async function programmeIdOfWork(db: Queryable, workId: string): Promise<string | null> {
  const result = await db.query<{ programme_id: string }>(
    `SELECT programme_id FROM programme_works WHERE id = $1`,
    [workId],
  );
  return result.rows[0]?.programme_id ?? null;
}

export async function programmeIdOfPart(db: Queryable, partId: string): Promise<string | null> {
  const result = await db.query<{ programme_id: string }>(
    `SELECT pw.programme_id
       FROM parts p JOIN programme_works pw ON pw.id = p.programme_work_id
      WHERE p.id = $1`,
    [partId],
  );
  return result.rows[0]?.programme_id ?? null;
}
