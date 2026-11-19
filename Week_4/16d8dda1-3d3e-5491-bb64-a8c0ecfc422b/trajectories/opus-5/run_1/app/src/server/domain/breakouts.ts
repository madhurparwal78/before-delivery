import { compareSeatIds } from '../../shared/rules.js';
import { ApiError } from '../http.js';

export interface SeatedLearner {
  seatId: string;
  learnerId: string;
}

export interface DealtTable {
  tableId: string;
  learnerIds: string[];
}

/** DP-22: seated learners, in seat-id order, go to T1 to Tk in turn. */
export function dealTables(seated: SeatedLearner[], tableCount: number, roomTables: number): DealtTable[] {
  if (!Number.isInteger(tableCount) || tableCount < 2 || tableCount > roomTables) {
    throw new ApiError(422, `Choose 2 to ${roomTables} tables.`);
  }
  const tables: DealtTable[] = [];
  for (let index = 0; index < tableCount; index += 1) tables.push({ tableId: `T${index + 1}`, learnerIds: [] });
  const ordered = [...seated].sort((a, b) => compareSeatIds(a.seatId, b.seatId));
  ordered.forEach((learner, index) => {
    tables[index % tableCount]?.learnerIds.push(learner.learnerId);
  });
  return tables;
}
