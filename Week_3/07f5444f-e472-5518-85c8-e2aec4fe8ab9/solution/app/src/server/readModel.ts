// Reads programmes, works and parts from Postgres and derives every figure the API reports:
// copies, running time, parts to mark, seating and publish blockers. Nothing derived is stored.

import type {
  Copies,
  Cut,
  Mark,
  Part,
  ProgrammeDetail,
  ProgrammeStatus,
  ProgrammeSummary,
  Role,
  Scan,
  ScanKind,
  StringCount,
  WorkDetail,
  WorkSummary,
} from "../shared/api.js";
import { clockText } from "../shared/api.js";
import { londonDate, londonTimestamp } from "../shared/london.js";
import { rows, type Db } from "./db.js";
import { partCopies, sumCopies } from "./domain/copies.js";
import { publishBlockers } from "./domain/publish.js";
import { spanMs, uncutMs, wholeSeconds } from "./domain/runningTime.js";
import { isSeated, type SeatedChair } from "./domain/seating.js";

interface ProgrammeRow {
  id: string;
  number: number;
  title: string;
  status: ProgrammeStatus;
  first_rehearsal: number;
  violin_1: number;
  violin_2: number;
  viola: number;
  cello: number;
  bass: number;
}

interface WorkRow {
  id: string;
  programme_id: string;
  catalogue_work_id: string;
  title: string;
  composer: string;
}

interface SegmentRow {
  work_id: string;
  from_bar: number;
  to_bar: number;
  bar_ms: number;
}

interface LetterRow {
  work_id: string;
  letter: string;
  bar: number;
}

export interface PartRow {
  id: string;
  work_id: string;
  chair_key: string;
  name: string;
  bars_from: number;
  bars_to: number;
  copies_on_hand: number;
}

interface CutRow {
  id: string;
  work_id: string;
  from_bar: number;
  to_bar: number;
  created_at: number;
}

interface MarkRow {
  part_id: string;
  cut_id: string;
  from_bar: number;
  to_bar: number;
  person_id: string;
  person_name: string;
  person_role: Role;
  marked_at: number;
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
  filed_at: number;
  uploaded_by: string;
  uploaded_by_name: string;
}

export interface WorkModel {
  row: WorkRow;
  barMap: SegmentRow[];
  letters: LetterRow[];
  parts: PartRow[];
  cuts: CutRow[];
  marks: MarkRow[];
}

export interface ProgrammeModel {
  row: ProgrammeRow;
  performances: number[];
  works: WorkModel[];
}

export const pad2 = (n: number): string => String(n).padStart(2, "0");

export function stringCountOf(row: ProgrammeRow): StringCount {
  return { violin_1: row.violin_1, violin_2: row.violin_2, viola: row.viola, cello: row.cello, bass: row.bass };
}

function groupBy<T extends { [K in Key]: string }, Key extends string>(items: T[], key: Key): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(item[key]);
    if (list) list.push(item);
    else groups.set(item[key], [item]);
  }
  return groups;
}

/** Loads programmes (all of them when `ids` is null) with their works, bar maps, parts, cuts and marks. */
export async function loadProgrammes(db: Db, ids: string[] | null): Promise<ProgrammeModel[]> {
  const where = ids === null ? "" : "WHERE id = ANY($1)";
  const params = ids === null ? [] : [ids];
  const programmes = await rows<ProgrammeRow>(db, `SELECT * FROM programmes ${where} ORDER BY number`, params);
  if (programmes.length === 0) return [];
  const programmeIds = programmes.map((p) => p.id);
  const [performances, works] = await Promise.all([
    rows<{ programme_id: string; performs_at: number }>(
      db,
      "SELECT programme_id, performs_at FROM performances WHERE programme_id = ANY($1) ORDER BY performs_at",
      [programmeIds],
    ),
    rows<WorkRow>(
      db,
      "SELECT id, programme_id, catalogue_work_id, title, composer FROM works WHERE programme_id = ANY($1) ORDER BY position",
      [programmeIds],
    ),
  ]);
  const workIds = works.map((w) => w.id);
  const [segments, letters, parts, cuts, marks] = await Promise.all([
    rows<SegmentRow>(db, "SELECT * FROM bar_segments WHERE work_id = ANY($1) ORDER BY from_bar", [workIds]),
    rows<LetterRow>(db, "SELECT * FROM rehearsal_letters WHERE work_id = ANY($1) ORDER BY bar", [workIds]),
    rows<PartRow>(
      db,
      "SELECT id, work_id, chair_key, name, bars_from, bars_to, copies_on_hand FROM parts WHERE work_id = ANY($1) ORDER BY position",
      [workIds],
    ),
    rows<CutRow>(db, "SELECT * FROM cuts WHERE work_id = ANY($1) ORDER BY from_bar", [workIds]),
    rows<MarkRow & { work_id: string }>(
      db,
      `SELECT m.part_id, m.cut_id, c.from_bar, c.to_bar, m.marked_at,
              pe.id AS person_id, pe.name AS person_name, pe.role AS person_role, pa.work_id
       FROM marks m JOIN parts pa ON pa.id = m.part_id JOIN cuts c ON c.id = m.cut_id JOIN people pe ON pe.id = m.marked_by
       WHERE pa.work_id = ANY($1)`,
      [workIds],
    ),
  ]);
  const bySegment = groupBy(segments, "work_id");
  const byLetter = groupBy(letters, "work_id");
  const byPart = groupBy(parts, "work_id");
  const byCut = groupBy(cuts, "work_id");
  const byMark = groupBy(marks, "work_id");
  const byWork = groupBy(works, "programme_id");
  const byPerformance = groupBy(performances, "programme_id");
  return programmes.map((row) => ({
    row,
    performances: (byPerformance.get(row.id) ?? []).map((p) => p.performs_at),
    works: (byWork.get(row.id) ?? []).map((work) => ({
      row: work,
      barMap: bySegment.get(work.id) ?? [],
      letters: byLetter.get(work.id) ?? [],
      parts: byPart.get(work.id) ?? [],
      cuts: byCut.get(work.id) ?? [],
      marks: byMark.get(work.id) ?? [],
    })),
  }));
}

/** Every rostered chair (players and section principals), for seating. */
export async function loadRoster(db: Db): Promise<(SeatedChair & { person_id: string })[]> {
  return rows(
    db,
    "SELECT id AS person_id, chair_key AS key, chair_number AS number FROM people WHERE chair_key IS NOT NULL ORDER BY sort_order",
  );
}

export function chairKeysOf(model: ProgrammeModel): Set<string> {
  return new Set(model.works.flatMap((work) => work.parts.map((part) => part.chair_key)));
}

export function seatedRoster<T extends SeatedChair>(model: ProgrammeModel, roster: T[]): T[] {
  const chairKeys = chairKeysOf(model);
  const count = stringCountOf(model.row);
  return roster.filter((chair) => isSeated(chair, count, chairKeys));
}

/** A cut shares a bar with the part's printed bars. */
export function overlaps(part: Pick<PartRow, "bars_from" | "bars_to">, cut: { from_bar: number; to_bar: number }): boolean {
  return part.bars_from <= cut.to_bar && cut.from_bar <= part.bars_to;
}

/** Whether a bar lies inside one of the work's stored cuts. */
export function barInCut(work: WorkModel, bar: number): boolean {
  return work.cuts.some((cut) => cut.from_bar <= bar && bar <= cut.to_bar);
}

/** Cuts the part's printed bars share a bar with and that no mark records for it, ascending. */
function cutsToMark(work: WorkModel, part: PartRow): CutRow[] {
  const marked = new Set(work.marks.filter((m) => m.part_id === part.id).map((m) => m.cut_id));
  return work.cuts.filter((cut) => overlaps(part, cut) && !marked.has(cut.id));
}

function workCopies(model: ProgrammeModel, work: WorkModel): Copies {
  const count = stringCountOf(model.row);
  return sumCopies(work.parts.map((part) => partCopies(part.chair_key, part.copies_on_hand, count)));
}

function workPartsToMark(work: WorkModel): number {
  return work.parts.filter((part) => cutsToMark(work, part).length > 0).length;
}

function workBars(work: WorkModel): number {
  return work.barMap.at(-1)?.to_bar ?? 0;
}

export function workSummary(model: ProgrammeModel, work: WorkModel): WorkSummary {
  const seconds = wholeSeconds(uncutMs(work.barMap, work.cuts));
  return {
    id: work.row.id,
    programme_id: model.row.id,
    catalogue_work_id: work.row.catalogue_work_id,
    title: work.row.title,
    composer: work.row.composer,
    bars: workBars(work),
    running_time_seconds: seconds,
    running_time: clockText(seconds),
    copies: workCopies(model, work),
    parts_to_mark: workPartsToMark(work),
  };
}

function programmeCopies(model: ProgrammeModel): Copies {
  return sumCopies(model.works.map((work) => workCopies(model, work)));
}

export function programmeSummary(model: ProgrammeModel, roster: SeatedChair[], now: number): ProgrammeSummary {
  const copies = programmeCopies(model);
  const seconds = wholeSeconds(model.works.reduce((total, work) => total + uncutMs(work.barMap, work.cuts), 0));
  const latest = model.performances.at(-1) ?? model.row.first_rehearsal;
  return {
    id: model.row.id,
    number: pad2(model.row.number),
    title: model.row.title,
    status: model.row.status,
    first_rehearsal: londonTimestamp(model.row.first_rehearsal),
    performances: model.performances.map(londonTimestamp),
    final_performance_date: londonDate(latest),
    string_count: stringCountOf(model.row),
    running_time_seconds: seconds,
    running_time: clockText(seconds),
    copies,
    parts_to_mark: model.works.reduce((total, work) => total + workPartsToMark(work), 0),
    seated_players: seatedRoster(model, roster).length,
    publish_blockers: publishBlockers(
      {
        status: model.row.status,
        firstRehearsal: model.row.first_rehearsal,
        workCount: model.works.length,
        shortfall: copies.shortfall,
      },
      now,
    ),
  };
}

export function programmeDetail(model: ProgrammeModel, roster: SeatedChair[], now: number): ProgrammeDetail {
  return { ...programmeSummary(model, roster, now), works: model.works.map((work) => workSummary(model, work)) };
}

function cutJson(work: WorkModel, cut: CutRow): Cut {
  const saved = wholeSeconds(spanMs(work.barMap, cut.from_bar, cut.to_bar));
  return {
    id: cut.id,
    work_id: work.row.id,
    from_bar: cut.from_bar,
    to_bar: cut.to_bar,
    saved_seconds: saved,
    saved: clockText(saved),
    parts_to_mark: work.parts.filter((part) => cutsToMark(work, part).some((c) => c.id === cut.id)).length,
    created_at: londonTimestamp(cut.created_at),
  };
}

export function scanJson(scan: ScanRow): Scan {
  return {
    id: scan.id,
    part_id: scan.part_id,
    kind: scan.kind,
    file_name: scan.file_name,
    content_type: scan.content_type,
    size_bytes: scan.size_bytes,
    sha256: scan.sha256,
    object_key: scan.object_key,
    filed_at: londonTimestamp(scan.filed_at),
    uploaded_by: { id: scan.uploaded_by, name: scan.uploaded_by_name },
  };
}

export const SCAN_SELECT = `
  SELECT s.id, s.part_id, s.kind, s.file_name, s.content_type, s.size_bytes, s.sha256, s.object_key, s.filed_at,
         s.uploaded_by, pe.name AS uploaded_by_name
  FROM scans s JOIN people pe ON pe.id = s.uploaded_by`;

/** Scans of the given parts, newest first. */
export async function loadScans(db: Db, partIds: string[]): Promise<ScanRow[]> {
  return rows<ScanRow>(db, `${SCAN_SELECT} WHERE s.part_id = ANY($1) ORDER BY s.filed_at DESC, s.id DESC`, [partIds]);
}

export function partJson(model: ProgrammeModel, work: WorkModel, part: PartRow, scans: ScanRow[]): Part {
  const toMark = cutsToMark(work, part);
  const marks: Mark[] = work.marks
    .filter((m) => m.part_id === part.id)
    .map((m) => ({
      cut_id: m.cut_id,
      from_bar: m.from_bar,
      to_bar: m.to_bar,
      marked_by: { id: m.person_id, name: m.person_name, role: m.person_role },
      marked_at: londonTimestamp(m.marked_at),
    }))
    .sort((a, b) => a.from_bar - b.from_bar);
  const latest = (kind: ScanKind): Scan | null => {
    const found = scans.find((scan) => scan.part_id === part.id && scan.kind === kind);
    return found ? scanJson(found) : null;
  };
  return {
    id: part.id,
    work_id: work.row.id,
    name: part.name,
    chair_key: part.chair_key,
    bars_from: part.bars_from,
    bars_to: part.bars_to,
    copies: partCopies(part.chair_key, part.copies_on_hand, stringCountOf(model.row)),
    cuts_to_mark: toMark.map((cut) => cut.id),
    mark_cut: toMark.length > 0,
    marks,
    latest_marked_scan: latest("marked_part"),
    latest_bowing_master: latest("bowing_master"),
  };
}

function workDetail(model: ProgrammeModel, work: WorkModel, scans: ScanRow[]): WorkDetail {
  return {
    ...workSummary(model, work),
    full_running_time_seconds: wholeSeconds(uncutMs(work.barMap, [])),
    bar_map: work.barMap.map(({ from_bar, to_bar, bar_ms }) => ({ from_bar, to_bar, bar_ms })),
    rehearsal_letters: work.letters.map(({ letter, bar }) => ({ letter, bar, cut: barInCut(work, bar) })),
    cuts: work.cuts.map((cut) => cutJson(work, cut)),
    parts: work.parts.map((part) => partJson(model, work, part, scans)),
  };
}

/** The programme model holding a work, with the work itself. */
export async function loadWork(db: Db, workId: string): Promise<{ model: ProgrammeModel; work: WorkModel } | null> {
  const [found] = await rows<{ programme_id: string }>(db, "SELECT programme_id FROM works WHERE id = $1", [workId]);
  if (!found) return null;
  const [model] = await loadProgrammes(db, [found.programme_id]);
  const work = model?.works.find((w) => w.row.id === workId);
  return model && work ? { model, work } : null;
}

export async function workDetailOf(db: Db, model: ProgrammeModel, work: WorkModel): Promise<WorkDetail> {
  return workDetail(model, work, await loadScans(db, work.parts.map((p) => p.id)));
}
