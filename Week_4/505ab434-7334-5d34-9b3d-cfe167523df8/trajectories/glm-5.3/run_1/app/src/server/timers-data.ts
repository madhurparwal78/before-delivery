import type { Tx } from './db';
import type { ApplicationClass, RequestState } from '../shared/domain';

export interface TimerRequestRecord {
  id: string;
  holderId: string;
  deadline: Date | null;
  state: RequestState;
}

export async function loadRequestTx(tx: Tx, id: string): Promise<TimerRequestRecord> {
  const rows = await tx.query<{ id: string; holder_id: string; deadline: Date | null; state: string }>(
    'SELECT id, holder_id, deadline, state FROM requests WHERE id = $1',
    [id],
  );
  const row = rows.rows[0];
  return {
    id: row.id,
    holderId: row.holder_id,
    deadline: row.deadline,
    state: row.state as RequestState,
  };
}

export type { ApplicationClass };
