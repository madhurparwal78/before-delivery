import type {
  Cut,
  Mark,
  Part,
  ProgrammeDetail,
  ProgrammeSummary,
  Scan,
  StringCount,
  WorkDetail,
  WorkSummary,
} from '../../shared/api.js';
import { formatRunningTime } from '../../shared/format.js';
import { businessDateOf, isoWithLondonOffset } from '../../shared/london.js';
import type { CutRow, MarkRow, PartRow, ProgrammeAggregate, RosterChair, ScanRow, WorkAggregate } from '../data/programmes.js';
import { stringCountOf } from '../data/programmes.js';
import { copiesOf, copiesNeededForPart, sumCopies } from '../domain/copies.js';
import { cutsToMark, partPlaysInCut } from '../domain/marking.js';
import { publishBlockers } from '../domain/publish.js';
import { barRangeMs, fullMs, roundToSeconds, uncutMs } from '../domain/running-time.js';
import { isSeated } from '../domain/seating.js';

export interface ViewContext {
  nowMs: number;
  roster: readonly RosterChair[];
}

export function scanView(row: ScanRow): Scan {
  return {
    id: row.id,
    part_id: row.part_id,
    kind: row.kind,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes),
    sha256: row.sha256,
    object_key: row.object_key,
    filed_at: isoWithLondonOffset(row.filed_at.getTime()),
    uploaded_by: { id: row.uploaded_by, name: row.uploaded_by_name },
  };
}

function markView(mark: MarkRow, cut: CutRow): Mark {
  return {
    cut_id: mark.cut_id,
    from_bar: cut.from_bar,
    to_bar: cut.to_bar,
    marked_by: { id: mark.marked_by, name: mark.marked_by_name, role: mark.marked_by_role },
    marked_at: isoWithLondonOffset(mark.marked_at.getTime()),
  };
}

export function partView(work: WorkAggregate, part: PartRow, stringCount: StringCount): Part {
  const marks = work.marksByPart.get(part.id) ?? [];
  const markedCutIds = new Set(marks.map((mark) => mark.cut_id));
  const toMark = cutsToMark(part, work.cuts, markedCutIds);
  const cutsById = new Map(work.cuts.map((cut) => [cut.id, cut]));
  const latest = work.latestScans.get(part.id) ?? {};
  const markedScan = latest.marked_part;
  const bowingMaster = latest.bowing_master;
  return {
    id: part.id,
    work_id: part.programme_work_id,
    name: part.name,
    chair_key: part.chair_key,
    bars_from: part.bars_from,
    bars_to: part.bars_to,
    copies: copiesOf(copiesNeededForPart(part.chair_key, stringCount), part.copies_on_hand),
    cuts_to_mark: toMark,
    mark_cut: toMark.length > 0,
    marks: marks
      .flatMap((mark) => {
        const cut = cutsById.get(mark.cut_id);
        return cut ? [markView(mark, cut)] : [];
      })
      .sort((left, right) => left.from_bar - right.from_bar),
    latest_marked_scan: markedScan ? scanView(markedScan) : null,
    latest_bowing_master: bowingMaster ? scanView(bowingMaster) : null,
  };
}

function partsToMarkInWork(work: WorkAggregate): number {
  return work.parts.filter((part) => {
    const marked = new Set((work.marksByPart.get(part.id) ?? []).map((mark) => mark.cut_id));
    return cutsToMark(part, work.cuts, marked).length > 0;
  }).length;
}

function workCopies(work: WorkAggregate, stringCount: StringCount) {
  return sumCopies(
    work.parts.map((part) => copiesOf(copiesNeededForPart(part.chair_key, stringCount), part.copies_on_hand)),
  );
}

export function workSummaryView(programmeId: string, work: WorkAggregate, stringCount: StringCount): WorkSummary {
  const seconds = roundToSeconds(uncutMs(work.barMap, work.cuts));
  return {
    id: work.row.id,
    programme_id: programmeId,
    catalogue_work_id: work.row.catalogue_work_id,
    title: work.row.title,
    composer: work.row.composer,
    bars: work.row.bars,
    running_time_seconds: seconds,
    running_time: formatRunningTime(seconds),
    copies: workCopies(work, stringCount),
    parts_to_mark: partsToMarkInWork(work),
  };
}

export function cutView(work: WorkAggregate, cut: CutRow): Cut {
  const savedSeconds = roundToSeconds(barRangeMs(work.barMap, cut));
  const partsToMark = work.parts.filter((part) => {
    if (!partPlaysInCut(part, cut)) return false;
    return !(work.marksByPart.get(part.id) ?? []).some((mark) => mark.cut_id === cut.id);
  }).length;
  return {
    id: cut.id,
    work_id: cut.programme_work_id,
    from_bar: cut.from_bar,
    to_bar: cut.to_bar,
    saved_seconds: savedSeconds,
    saved: formatRunningTime(savedSeconds),
    parts_to_mark: partsToMark,
    created_at: isoWithLondonOffset(cut.created_at.getTime()),
  };
}

export function workDetailView(
  programmeId: string,
  work: WorkAggregate,
  stringCount: StringCount,
): WorkDetail {
  return {
    ...workSummaryView(programmeId, work, stringCount),
    full_running_time_seconds: roundToSeconds(fullMs(work.barMap)),
    bar_map: work.barMap.map((span) => ({ ...span })),
    rehearsal_letters: work.letters.map((letter) => ({
      letter: letter.letter,
      bar: letter.bar,
      cut: work.cuts.some((cut) => letter.bar >= cut.from_bar && letter.bar <= cut.to_bar),
    })),
    cuts: work.cuts.map((cut) => cutView(work, cut)),
    parts: work.parts.map((part) => partView(work, part, stringCount)),
  };
}

export function seatedPlayerCount(aggregate: ProgrammeAggregate, roster: readonly RosterChair[]): number {
  const stringCount = stringCountOf(aggregate.row);
  const chairKeys = new Set(aggregate.works.flatMap((work) => work.parts.map((part) => part.chair_key)));
  return roster.filter((chair) =>
    isSeated(
      { key: chair.chair_key, section: '', number: chair.chair_number, label: '' },
      stringCount,
      chairKeys,
    ),
  ).length;
}

export function programmeSummaryView(aggregate: ProgrammeAggregate, context: ViewContext): ProgrammeSummary {
  const stringCount = stringCountOf(aggregate.row);
  const exactMs = aggregate.works.reduce((total, work) => total + uncutMs(work.barMap, work.cuts), 0);
  const runningSeconds = roundToSeconds(exactMs);
  const copies = sumCopies(aggregate.works.map((work) => workCopies(work, stringCount)));
  const performances = [...aggregate.performances].sort((left, right) => left.getTime() - right.getTime());
  const latest = performances[performances.length - 1];
  return {
    id: aggregate.row.id,
    number: String(aggregate.row.number).padStart(2, '0'),
    title: aggregate.row.title,
    status: aggregate.row.status,
    first_rehearsal: isoWithLondonOffset(aggregate.row.first_rehearsal.getTime()),
    performances: performances.map((at) => isoWithLondonOffset(at.getTime())),
    final_performance_date: businessDateOf((latest ?? aggregate.row.first_rehearsal).getTime()),
    string_count: stringCount,
    running_time_seconds: runningSeconds,
    running_time: formatRunningTime(runningSeconds),
    copies,
    parts_to_mark: aggregate.works.reduce((total, work) => total + partsToMarkInWork(work), 0),
    seated_players: seatedPlayerCount(aggregate, context.roster),
    publish_blockers: publishBlockers({
      status: aggregate.row.status,
      firstRehearsalMs: aggregate.row.first_rehearsal.getTime(),
      nowMs: context.nowMs,
      workCount: aggregate.works.length,
      shortfall: copies.shortfall,
    }),
  };
}

export function programmeDetailView(aggregate: ProgrammeAggregate, context: ViewContext): ProgrammeDetail {
  const stringCount = stringCountOf(aggregate.row);
  return {
    ...programmeSummaryView(aggregate, context),
    works: aggregate.works.map((work) => workSummaryView(aggregate.row.id, work, stringCount)),
  };
}
