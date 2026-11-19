import type { TimelineBlock, TimelineRoom } from "../shared/api";
import { addDays, daysBetween, type IsoDate } from "../shared/dates";
import { holdsNights } from "../shared/stayStatus";

export interface Cell { roomId: string; date: IsoDate }

export const WINDOW_NIGHTS = 14;
export const SHIFT_NIGHTS = 7;

/** A stay seen across the blocks it is drawn in. */
interface StaySpan { stayId: string; arrival: IsoDate; departure: IsoDate }

export const blockEnd = (block: TimelineBlock): IsoDate => addDays(block.firstNight, block.nights);

export function spanOf(blocks: readonly TimelineBlock[], stayId: string): StaySpan {
  const own = blocks.filter((block) => block.stayId === stayId);
  return {
    stayId,
    arrival: own.reduce((earliest, block) => (block.firstNight < earliest ? block.firstNight : earliest), own[0]?.firstNight ?? ""),
    departure: own.reduce((latest, block) => (blockEnd(block) > latest ? blockEnd(block) : latest), own[0] ? blockEnd(own[0]) : ""),
  };
}

/** The stay holding a room on a night: cancelled and no-show blocks hold nothing. */
export function stayAt(blocks: readonly TimelineBlock[], cell: Cell): TimelineBlock | undefined {
  return blocks.find(
    (block) =>
      block.roomId === cell.roomId &&
      holdsNights(block.status) &&
      block.firstNight <= cell.date &&
      cell.date < blockEnd(block),
  );
}

export function windowDates(start: IsoDate): IsoDate[] {
  return Array.from({ length: WINDOW_NIGHTS }, (_, index) => addDays(start, index));
}

/** How many window nights a block covers, counted from the window's first night. */
export function visibleSpan(block: TimelineBlock, start: IsoDate): { offset: number; span: number } | null {
  const first = Math.max(0, daysBetween(start, block.firstNight));
  const last = Math.min(WINDOW_NIGHTS, daysBetween(start, blockEnd(block)));
  return last > first ? { offset: first, span: last - first } : null;
}

export function roomIndex(rooms: readonly TimelineRoom[], roomId: string): number {
  return rooms.findIndex((room) => room.id === roomId);
}
