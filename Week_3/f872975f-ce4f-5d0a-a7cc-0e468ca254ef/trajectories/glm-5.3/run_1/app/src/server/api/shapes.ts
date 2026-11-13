import type { User, BoardRecord } from '../db/store.js';
import { boardFeetString, priceCents, volumeMm3 } from '../domain/money.js';
import { longestClearRun } from '../domain/geometry.js';
import { PUBLIC_VIEW_STATUSES, RETIRED_STATUSES } from '../domain/constants.js';

export function boardSummary(board: BoardRecord, rate: number | null): Record<string, unknown> {
  const retired = RETIRED_STATUSES.has(board.status);
  const effectiveRate = board.grade === null || retired ? null : rate;
  const price = effectiveRate === null ? null : priceCents(board.thickness_mm, board.width_mm, board.length_mm, effectiveRate);
  return {
    tag: board.tag,
    species: board.species,
    grade: board.grade,
    status: board.status,
    lot: { id: board.lot.id, name: board.lot.name },
    length_mm: board.length_mm,
    width_mm: board.width_mm,
    thickness_mm: board.thickness_mm,
    volume_mm3: volumeMm3(board.length_mm, board.width_mm, board.thickness_mm),
    board_feet: boardFeetString(volumeMm3(board.length_mm, board.width_mm, board.thickness_mm)),
    rate_cents: effectiveRate,
    price_cents: price,
    longest_clear_mm: longestClearRun(board.length_mm, board.defects),
    defects: board.defects.map((d) => ({ kind: d.kind, start_mm: d.start_mm, end_mm: d.end_mm })),
    parent_tag: board.parent_tag,
  };
}

export function photoJson(photo: { id: string; width: number; height: number }): Record<string, unknown> {
  return {
    id: photo.id,
    url: `/api/photos/${photo.id}`,
    thumb_url: `/api/photos/${photo.id}/thumb`,
    width: photo.width,
    height: photo.height,
  };
}

/** Board visibility: public for available/held; staff for everything. */
export function canViewBoard(user: User | null, status: BoardRecord['status']): boolean {
  if (PUBLIC_VIEW_STATUSES.has(status)) return true;
  return user !== null && (user.role === 'owner' || user.role === 'hand');
}

export function isStaff(user: User | null): boolean {
  return user !== null && (user.role === 'owner' || user.role === 'hand');
}
