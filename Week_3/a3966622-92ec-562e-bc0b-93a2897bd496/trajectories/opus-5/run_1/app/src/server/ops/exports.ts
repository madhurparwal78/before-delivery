import { MOVES_EXPORT_HEADER, csvDocument, csvIntegerCell, csvTextCell } from '../../domain/csv.ts';
import type { App } from '../app.ts';
import { moveBoardingInstant, revisionLabelForMove, totalCentsForMove } from '../derive.ts';
import { forbidden } from '../errors.ts';
import type { MoveRecord, StoreState, UserRecord } from '../store/types.ts';
import { canReadMove } from '../views.ts';

/** Moves the reader may see, in rising boarding instant with ties by rising ref. */
export function visibleMovesInBoardingOrder(state: StoreState, viewer: UserRecord): MoveRecord[] {
  return state.moves
    .filter((move) => canReadMove(viewer, move))
    .sort((left, right) => {
      const difference = moveBoardingInstant(left) - moveBoardingInstant(right);
      return difference !== 0 ? difference : left.ref.localeCompare(right.ref);
    });
}

export function movesExportCsv(app: App, user: UserRecord): string {
  if (user.role === 'pilot') throw forbidden();
  const state = app.store.read();
  const rows: string[][] = [[...MOVES_EXPORT_HEADER]];
  for (const move of visibleMovesInBoardingOrder(state, user)) {
    const vessel = state.vessels.find((entry) => entry.id === move.vessel_id);
    rows.push([
      csvTextCell(move.ref),
      csvTextCell(vessel?.name ?? move.vessel_id),
      csvTextCell(move.agency_code),
      csvTextCell(move.status),
      csvTextCell(move.boarding_at),
      csvTextCell(move.committed?.pinch_waypoint ?? ''),
      move.committed === null ? '' : csvIntegerCell(move.committed.margin_mm),
      csvTextCell(revisionLabelForMove(state, move)),
      csvIntegerCell(totalCentsForMove(state, move)),
    ]);
  }
  return csvDocument(rows);
}
