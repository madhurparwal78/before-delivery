// Read models: every derived figure (copies, running time, parts to mark,
// seating, publish blockers, overdue) is computed here, from stored rows.

import { Pool } from "pg";
import {
  formatRunningTime, formatTimestamp, londonDateString, formatDateString,
  formatDateTime, wallToInstant,
} from "../shared/london.js";
import type {
  BarSpan, Chair, Copies, Cut, Mark, Part, ProgrammeSummary,
  PublishBlocker, RentalSet, RehearsalLetter, Role, Scan, SectionKey,
  User, WorkDetail, WorkSummary, Notice,
} from "../shared/domain.js";
import { SECTION_KEYS } from "../shared/domain.js";

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  chair_key: string;
  chair_section: string | null;
  chair_number: number | null;
  chair_label: string;
}

export interface ProgrammeRow {
  id: string;
  number: number;
  title: string;
  status: "draft" | "in_preparation" | "published" | "in_performance" | "closed";
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
  position: number;
  bars: number;
  title: string;
  composer: string;
}

export interface PartRow {
  id: string;
  work_id: string;
  name: string;
  chair_key: string;
  bars_from: number;
  bars_to: number;
  copies_on_hand: number;
}

export interface CutRow {
  id: string;
  work_id: string;
  from_bar: number;
  to_bar: number;
  created_at: Date;
}

export interface ScanRow {
  id: string;
  part_id: string;
  kind: "marked_part" | "bowing_master";
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
  filed_at: Date;
  uploaded_by: string;
}

export function chairOf(person: PersonRow): Chair {
  if (!person.chair_section) {
    return { key: person.chair_key, section: null, number: null, label: person.chair_label };
  }
  return {
    key: person.chair_key,
    section: person.chair_section as SectionKey,
    number: person.chair_number,
    label: person.chair_label,
  };
}

export function userOf(person: PersonRow): User {
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role,
    chair: person.role === "principal_librarian" || person.role === "assistant_librarian" ? null : chairOf(person),
  };
}

/** Copies needed for one part, the desk rule in one place. */
export function copiesNeededForPart(chairKey: string, stringCount: Record<SectionKey, number>): number {
  for (const key of SECTION_KEYS) {
    if (chairKey === sectionChairKey(key)) {
      const count = stringCount[key];
      const desks = Math.ceil(count / 2);
      return count >= 8 ? desks + 1 : desks;
    }
  }
  return 1;
}

const SECTION_CHAIR_KEYS: Record<SectionKey, string> = {
  violin_1: "vn1",
  violin_2: "vn2",
  viola: "va",
  cello: "vc",
  bass: "cb",
};

function sectionChairKey(key: SectionKey): string {
  return SECTION_CHAIR_KEYS[key];
}

export function copiesOf(part: PartRow, stringCount: Record<SectionKey, number>): Copies {
  const needed = copiesNeededForPart(part.chair_key, stringCount);
  const onHand = part.copies_on_hand;
  return { needed, on_hand: onHand, shortfall: Math.max(0, needed - onHand) };
}

export function stringCountOf(programme: ProgrammeRow): Record<SectionKey, number> {
  return {
    violin_1: programme.violin_1,
    violin_2: programme.violin_2,
    viola: programme.viola,
    cello: programme.cello,
    bass: programme.bass,
  };
}

function sumCopies(list: Copies[]): Copies {
  const needed = list.reduce((n, c) => n + c.needed, 0);
  const onHand = list.reduce((n, c) => n + c.on_hand, 0);
  const shortfall = list.reduce((n, c) => n + c.shortfall, 0);
  return { needed, on_hand: onHand, shortfall };
}

/** Whole seconds, with half a second and above rounding up. */
function roundSeconds(ms: number): number {
  return Math.floor(ms / 1000 + 0.5);
}

export interface WorkDerived {
  row: WorkRow;
  barMap: BarSpan[];
  letters: RehearsalLetter[];
  cuts: CutRow[];
  parts: PartRow[];
  runningMs: number;
  copies: Copies;
  partsToMark: number;
  stringCount: Record<SectionKey, number>;
  partsCopies: Map<string, Copies>;
  cutRows: {
    cut: CutRow;
    savedMs: number;
    saved: number;
    partsToMark: number;
  }[];
}

/** Cut bars of a work, as a sorted list of inclusive ranges. */
export function cutRanges(cuts: CutRow[]): [number, number][] {
  return cuts
    .slice()
    .sort((a, b) => a.from_bar - b.from_bar)
    .map((cut) => [cut.from_bar, cut.to_bar] as [number, number]);
}

export function isBarCut(cuts: CutRow[], bar: number): boolean {
  return cuts.some((cut) => bar >= cut.from_bar && bar <= cut.to_bar);
}

function barDuration(barMap: BarSpan[], bar: number): number {
  for (const span of barMap) {
    if (bar >= span.from_bar && bar <= span.to_bar) return span.bar_ms;
  }
  return 0;
}

export function deriveWork(
  row: WorkRow,
  barMap: BarSpan[],
  letters: { letter: string; bar: number }[],
  cuts: CutRow[],
  parts: PartRow[],
  marksByPart: Map<string, Mark[]>,
  stringCount: Record<SectionKey, number>
): WorkDerived {
  const fullMs = barMap.reduce((sum, span) => sum + (span.to_bar - span.from_bar + 1) * span.bar_ms, 0);
  const removedMs = cuts.reduce(
    (sum, cut) => sum + totalBarMs(barMap, cut.from_bar, cut.to_bar),
    0
  );
  const runningMs = fullMs - removedMs;

  const derivedParts = parts.map((part) => {
    const copies = copiesOf(part, stringCount);
    const cutsToMark = cuts.filter(
      (cut) => cut.from_bar <= part.bars_to && cut.to_bar >= part.bars_from
    );
    const marks = marksByPart.get(part.id) ?? [];
    const markedCuts = new Set(marks.map((mark) => mark.cut_id));
    const toMark = cutsToMark.filter((cut) => !markedCuts.has(cut.id));
    return { part, copies, toMark };
  });

  const copies = sumCopies(derivedParts.map((p) => p.copies));
  const partsToMark = derivedParts.filter((p) => p.toMark.length > 0).length;

  const cutRows = cuts
    .slice()
    .sort((a, b) => a.from_bar - b.from_bar)
    .map((cut) => {
      const savedMs = totalBarMs(barMap, cut.from_bar, cut.to_bar);
      const saved = roundSeconds(savedMs);
      const partsToMarkForCut = derivedParts.filter(
        (p) => p.toMark.some((c) => c.id === cut.id)
      ).length;
      return { cut, savedMs, saved, partsToMark: partsToMarkForCut };
    });

  return {
    row,
    barMap,
    letters: letters
      .slice()
      .sort((a, b) => a.bar - b.bar)
      .map((letter) => ({ ...letter, cut: isBarCut(cuts, letter.bar) })),
    cuts: cuts.slice().sort((a, b) => a.from_bar - b.from_bar),
    parts,
    runningMs,
    copies,
    partsToMark,
    stringCount,
    partsCopies: new Map(derivedParts.map((p) => [p.part.id, p.copies])),
    cutRows,
  };
}

function totalBarMs(barMap: BarSpan[], from: number, to: number): number {
  let total = 0;
  for (let bar = from; bar <= to; bar++) total += barDuration(barMap, bar);
  return total;
}

/** Seating, decided from the stored string count on every request. */
export function isSeated(
  person: PersonRow,
  programme: ProgrammeRow,
  partChairKeys: Set<string>
): boolean {
  if (person.chair_section) {
    const count = stringCountOf(programme)[person.chair_section as SectionKey];
    return person.chair_number !== null && person.chair_number <= count;
  }
  return partChairKeys.has(person.chair_key);
}

export interface ProgrammeData {
  programme: ProgrammeRow;
  performances: Date[];
  works: WorkDerived[];
  marksByPart: Map<string, Mark[]>;
  latestScans: Map<string, { marked: ScanRow; bowing: ScanRow }>;
}

export async function loadProgrammeData(pool: Pool, programmeId: string): Promise<ProgrammeData | null> {
  const programmeResult = await pool.query<ProgrammeRow>(
    "SELECT * FROM programmes WHERE id=$1",
    [programmeId]
  );
  if (programmeResult.rows.length === 0) return null;
  const programme = programmeResult.rows[0];

  const performances = await pool.query<{ at: Date }>(
    "SELECT at FROM performances WHERE programme_id=$1 ORDER BY at",
    [programmeId]
  );

  const works = await pool.query<WorkRow>(
    `SELECT w.*, c.title, c.composer FROM works w
     JOIN catalogue_works c ON c.id = w.catalogue_work_id
     WHERE w.programme_id=$1 ORDER BY w.position`,
    [programmeId]
  );

  const marksByPart = new Map<string, Mark[]>();
  const latestScans = new Map<string, { marked: ScanRow; bowing: ScanRow }>();
  const derived: WorkDerived[] = [];
  const stringCount = stringCountOf(programme);

  for (const work of works.rows) {
    const barMap = (
      await pool.query<{ from_bar: number; to_bar: number; bar_ms: number }>(
        "SELECT from_bar,to_bar,bar_ms FROM bar_map WHERE work_id=$1 ORDER BY from_bar",
        [work.id]
      )
    ).rows;
    const letters = (
      await pool.query<{ letter: string; bar: number }>(
        "SELECT letter,bar FROM rehearsal_letters WHERE work_id=$1",
        [work.id]
      )
    ).rows;
    const cuts = (
      await pool.query<CutRow>("SELECT * FROM cuts WHERE work_id=$1 ORDER BY from_bar", [work.id])
    ).rows;
    const parts = (
      await pool.query<PartRow>(
        "SELECT * FROM parts WHERE work_id=$1 ORDER BY id",
        [work.id]
      )
    ).rows;

    if (parts.length > 0) {
      const partIds = parts.map((p) => p.id);
      const markRows = await pool.query<{
        part_id: string;
        cut_id: string;
        from_bar: number;
        to_bar: number;
        marked_by: string;
        marked_at: Date;
        marker_name: string;
        marker_role: Role;
      }>(
        `SELECT m.part_id, m.cut_id, c.from_bar, c.to_bar, m.marked_by, m.marked_at,
                p.name AS marker_name, p.role AS marker_role
         FROM marks m JOIN cuts c ON c.id=m.cut_id JOIN people p ON p.id=m.marked_by
         WHERE m.part_id = ANY($1) ORDER BY c.from_bar`,
        [partIds]
      );
      for (const row of markRows.rows) {
        const list = marksByPart.get(row.part_id) ?? [];
        list.push({
          cut_id: row.cut_id,
          from_bar: row.from_bar,
          to_bar: row.to_bar,
          marked_by: { id: row.marked_by, name: row.marker_name, role: row.marker_role },
          marked_at: formatTimestamp(row.marked_at.getTime()),
        });
        marksByPart.set(row.part_id, list);
      }

      const scanRows = await pool.query<ScanRow>(
        `SELECT s.*, p.name AS uploaded_by_name FROM scans s JOIN people p ON p.id=s.uploaded_by
         WHERE s.part_id = ANY($1) ORDER BY s.filed_at DESC, s.id`,
        [partIds]
      );
      for (const partId of partIds) {
        latestScans.set(partId, { marked: undefined as never, bowing: undefined as never });
      }
      for (const row of scanRows.rows) {
        const entry = latestScans.get(row.part_id);
        if (!entry) continue;
        if (row.kind === "marked_part" && !entry.marked) entry.marked = row;
        if (row.kind === "bowing_master" && !entry.bowing) entry.bowing = row;
      }
    }

    derived.push(deriveWork(work, barMap, letters, cuts, parts, marksByPart, stringCount));
  }

  return { programme, performances: performances.rows.map((row) => row.at), works: derived, marksByPart, latestScans };
}

/** The publish guards, in order, as one check. */
export function publishBlockers(
  programme: ProgrammeRow,
  firstRehearsal: number,
  workCount: number,
  shortfall: number,
  now: number
): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (programme.status !== "in_preparation") {
    blockers.push({
      error: "illegal_transition",
      message: "Folders can only be published while the programme is in preparation.",
    });
  }
  if (now >= firstRehearsal) {
    blockers.push({
      error: "first_rehearsal_passed",
      message: "Folders can't be published after the first rehearsal has started.",
    });
  }
  if (workCount === 0) {
    blockers.push({ error: "no_works", message: "Add a work before publishing folders." });
  }
  if (shortfall > 0) {
    blockers.push({
      error: "copies_short",
      message: `Folders can't be published while ${shortfall} ${plural(shortfall, "copy is", "copies are")} short.`,
    });
  }
  return blockers;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? singular : pluralForm;
}

export interface SeatedPlayerRow extends PersonRow {
  chair_parts: PartRow[];
}

export async function seatedPlayers(
  pool: Pool,
  programme: ProgrammeRow,
  works: WorkDerived[]
): Promise<SeatedPlayerRow[]> {
  const people = await pool.query<PersonRow>(
    "SELECT * FROM people WHERE role IN ('section_principal','player')"
  );
  const chairKeysWithParts = new Set<string>();
  for (const work of works) {
    for (const part of work.parts) chairKeysWithParts.add(part.chair_key);
  }
  const seated: SeatedPlayerRow[] = [];
  for (const person of people.rows) {
    if (!isSeated(person, programme, chairKeysWithParts)) continue;
    const chairParts: PartRow[] = [];
    for (const work of works) {
      for (const part of work.parts) {
        if (part.chair_key === person.chair_key) chairParts.push(part);
      }
    }
    seated.push({ ...person, chair_parts: chairParts });
  }
  return seated;
}

export function programmeSummaryOf(
  data: ProgrammeData,
  seatedCount: number,
  now: number
): ProgrammeSummary {
  const stringCount = stringCountOf(data.programme);
  const copies = sumCopies(data.works.map((w) => w.copies));
  const partsToMark = data.works.reduce((n, w) => n + w.partsToMark, 0);
  const runningMs = data.works.reduce((sum, w) => sum + w.runningMs, 0);
  const finalPerformance = data.performances.length > 0 ? data.performances[data.performances.length - 1] : null;
  const blockers = publishBlockers(
    data.programme,
    data.programme.first_rehearsal.getTime(),
    data.works.length,
    copies.shortfall,
    now
  );
  return {
    id: data.programme.id,
    number: String(data.programme.number).padStart(2, "0"),
    title: data.programme.title,
    status: data.programme.status,
    first_rehearsal: formatTimestamp(data.programme.first_rehearsal.getTime()),
    performances: data.performances.map((at) => formatTimestamp(at.getTime())).sort((a, b) => instantOf(a) - instantOf(b)),
    final_performance_date: finalPerformance ? londonDateString(finalPerformance.getTime()) : "",
    string_count: stringCount,
    running_time_seconds: roundSeconds(runningMs),
    running_time: formatRunningTime(roundSeconds(runningMs)),
    copies,
    parts_to_mark: partsToMark,
    seated_players: seatedCount,
    publish_blockers: blockers,
  };
}

function instantOf(timestamp: string): number {
  return Date.parse(timestamp);
}

export function workSummaryOf(work: WorkDerived): WorkSummary {
  return {
    id: work.row.id,
    programme_id: work.row.programme_id,
    catalogue_work_id: work.row.catalogue_work_id,
    title: work.row.title,
    composer: work.row.composer,
    bars: work.row.bars,
    running_time_seconds: roundSeconds(work.runningMs),
    running_time: formatRunningTime(roundSeconds(work.runningMs)),
    copies: work.copies,
    parts_to_mark: work.partsToMark,
  };
}

export function scanOf(row: ScanRow, uploaderName: string): Scan {
  return {
    id: row.id,
    part_id: row.part_id,
    kind: row.kind,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes),
    sha256: row.sha256,
    object_key: row.object_key,
    filed_at: formatTimestamp(row.filed_at.getTime()),
    uploaded_by: { id: row.uploaded_by, name: uploaderName },
  };
}

export function partOf(
  part: PartRow,
  work: WorkDerived,
  marks: Mark[],
  latest: { marked?: ScanRow; bowing?: ScanRow },
  latestNames: Map<string, string>
): Part {
  const markedCuts = new Set(marks.map((m) => m.cut_id));
  const cutsToMark = work.cuts
    .filter((cut) => cut.from_bar <= part.bars_to && cut.to_bar >= part.bars_from)
    .filter((cut) => !markedCuts.has(cut.id))
    .map((cut) => cut.id);
  const partCopies = work.partsCopies.get(part.id) ?? copiesOf(part, work.stringCount);
  return {
    id: part.id,
    work_id: part.work_id,
    name: part.name,
    chair_key: part.chair_key,
    bars_from: part.bars_from,
    bars_to: part.bars_to,
    copies: partCopies,
    cuts_to_mark: cutsToMark,
    mark_cut: cutsToMark.length > 0,
    marks,
    latest_marked_scan: latest.marked ? scanOf(latest.marked, latestNames.get(latest.marked.uploaded_by) ?? "") : null,
    latest_bowing_master: latest.bowing ? scanOf(latest.bowing, latestNames.get(latest.bowing.uploaded_by) ?? "") : null,
  };
}

export function workDetailOf(
  work: WorkDerived,
  marksByPart: Map<string, Mark[]>,
  latestScans: Map<string, { marked: ScanRow; bowing: ScanRow }>,
  uploaderNames: Map<string, string>
): WorkDetail {
  return {
    ...workSummaryOf(work),
    full_running_time_seconds: roundSeconds(
      work.barMap.reduce((sum, span) => sum + (span.to_bar - span.from_bar + 1) * span.bar_ms, 0)
    ),
    bar_map: work.barMap,
    rehearsal_letters: work.letters,
    cuts: work.cutRows.map(({ cut, saved, partsToMark: count }) => ({
      id: cut.id,
      work_id: cut.work_id,
      from_bar: cut.from_bar,
      to_bar: cut.to_bar,
      saved_seconds: saved,
      saved: formatRunningTime(saved),
      parts_to_mark: count,
      created_at: formatTimestamp(cut.created_at.getTime()),
    })),
    parts: work.parts.map((part) =>
      partOf(
        part,
        work,
        marksByPart.get(part.id) ?? [],
        latestScans.get(part.id) ?? {},
        uploaderNames
      )
    ),
  };
}

export function cutOf(row: { cut: CutRow; saved: number; partsToMark: number }): Cut {
  return {
    id: row.cut.id,
    work_id: row.cut.work_id,
    from_bar: row.cut.from_bar,
    to_bar: row.cut.to_bar,
    saved_seconds: row.saved,
    saved: formatRunningTime(row.saved),
    parts_to_mark: row.partsToMark,
    created_at: formatTimestamp(row.cut.created_at.getTime()),
  };
}

export async function uploaderNames(pool: Pool): Promise<Map<string, string>> {
  const rows = await pool.query<{ id: string; name: string }>("SELECT id,name FROM people");
  return new Map(rows.rows.map((row) => [row.id, row.name]));
}

export async function noticesOf(pool: Pool, programmeId: string): Promise<Notice[]> {
  const rows = await pool.query<{
    player_id: string;
    name: string;
    email: string;
    chair_label: string;
    status: "sent" | "queued";
    sent_at: Date | null;
  }>(
    `SELECT n.player_id, p.name, p.email, p.chair_label, n.status, n.sent_at
     FROM notices n JOIN people p ON p.id=n.player_id
     WHERE n.programme_id=$1 ORDER BY p.name`,
    [programmeId]
  );
  return rows.rows.map((row) => ({
    player_id: row.player_id,
    name: row.name,
    email: row.email,
    chair_label: row.chair_label,
    status: row.status,
    sent_at: row.sent_at ? formatTimestamp(row.sent_at.getTime()) : null,
  }));
}

/** Rental sets: due date, overdue and reminder date, in the business zone. */
export async function rentalSetOf(
  pool: Pool,
  row: {
    id: string;
    work_id: string;
    publisher: string;
    status: RentalSet["status"];
    returned_at: Date | null;
    reminder_status: "none" | "queued" | "sent";
    reminder_sent_at: Date | null;
  },
  now: number
): Promise<RentalSet> {
  const work = await pool.query<{ id: string; title: string; programme_id: string; bars: number }>(
    `SELECT w.id, c.title, w.programme_id FROM works w
     JOIN catalogue_works c ON c.id=w.catalogue_work_id WHERE w.id=$1`,
    [row.work_id]
  );
  const programme = await pool.query<{ number: number; title: string }>(
    "SELECT number,title FROM programmes WHERE id=$1",
    [work.rows[0].programme_id]
  );
  const performances = await pool.query<{ at: Date }>(
    "SELECT at FROM performances WHERE programme_id=$1 ORDER BY at",
    [work.rows[0].programme_id]
  );
  const finalAt = performances.rows[performances.rows.length - 1].at.getTime();
  const dueDate = addLondonDays(londonDateString(finalAt), 14);
  const dueAt = wallAtLondon(dueDate, 23, 59) ?? finalAt;
  const today = londonDateString(now);
  const overdue =
    today > dueDate && (row.status === "requested" || row.status === "received" || row.status === "in_use");
  const slip = await pool.query<{ part_id: string; part_name: string; copies: number; checked_in: number }>(
    `SELECT s.part_id, p.name AS part_name, s.copies, s.checked_in
     FROM rental_slip s JOIN parts p ON p.id=s.part_id
     WHERE s.rental_set_id=$1 ORDER BY s.position`,
    [row.id]
  );
  const copiesOnSlip = slip.rows.reduce((n, line) => n + line.copies, 0);
  const copiesCheckedIn = slip.rows.reduce((n, line) => n + line.checked_in, 0);
  return {
    id: row.id,
    work_id: row.work_id,
    work_title: work.rows[0].title,
    programme_id: work.rows[0].programme_id,
    programme_number: String(programme.rows[0].number).padStart(2, "0"),
    publisher: row.publisher,
    status: row.status,
    display_status: overdue ? "Overdue" : rentalStatusLabel(row.status),
    overdue,
    final_performance_date: londonDateString(finalAt),
    due_date: dueDate,
    due_at: formatTimestamp(dueAt),
    slip: slip.rows,
    copies_on_slip: copiesOnSlip,
    copies_checked_in: copiesCheckedIn,
    copies_missing: copiesOnSlip - copiesCheckedIn,
    reminder: {
      status: row.reminder_status,
      sent_at: row.reminder_sent_at ? formatTimestamp(row.reminder_sent_at.getTime()) : null,
    },
    returned_at: row.returned_at ? formatTimestamp(row.returned_at.getTime()) : null,
    returned_late: row.returned_at ? row.returned_at.getTime() > dueAt : false,
  };
}

function rentalStatusLabel(status: RentalSet["status"]): string {
  switch (status) {
    case "requested": return "Requested";
    case "received": return "Received";
    case "in_use": return "In use";
    case "returned": return "Returned";
    case "checked_in": return "Checked in";
  }
}

/** The reminder date: the due date minus seven calendar days. */
export function reminderDate(dueDate: string): string {
  return addLondonDays(dueDate, -7);
}

function addLondonDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day + days, 12));
  return londonDateString(at.getTime());
}

/** An instant at a wall-clock hour and minute of a business-zone date. */
function wallAtLondon(date: string, hour: number, minute: number): number | null {
  const [year, month, day] = date.split("-").map(Number);
  const wall = wallToInstant({ year, month, day, hour, minute, second: 0 });
  return wall.kind === "ok" ? wall.instant : null;
}

export function formatBusinessDate(date: string): string {
  return formatDateString(date);
}

export function formatBusinessDateTime(instant: number): string {
  return formatDateTime(instant);
}
