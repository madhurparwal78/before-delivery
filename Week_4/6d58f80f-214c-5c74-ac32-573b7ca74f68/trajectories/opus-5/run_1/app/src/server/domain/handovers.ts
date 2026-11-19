import { db, newId, withTransaction, type Queryable } from '../db.js';
import { addDays, reached, startOfCompanyDay, today } from './clock.js';
import { writeLedger } from './ledger.js';
import type { HandoverRow } from './rows.js';

/** An offer stays acceptable through all of its lapse date. */
export const handoverHasLapsed = (row: Pick<HandoverRow, 'status' | 'lapse_date'>): boolean =>
  row.status === 'offered' && reached(startOfCompanyDay(addDays(row.lapse_date, 1)));

export const handoverById = async (
  id: string,
  tx: Queryable = db,
): Promise<HandoverRow | null> => {
  const { rows } = await tx.query<HandoverRow>('SELECT * FROM handovers WHERE id = $1', [id]);
  return rows[0] ?? null;
};

export const openHandoverFor = async (
  folderId: string,
  tx: Queryable = db,
): Promise<HandoverRow | null> => {
  const { rows } = await tx.query<HandoverRow>(
    `SELECT * FROM handovers WHERE folder_id = $1 AND status = 'offered'`,
    [folderId],
  );
  const row = rows[0];
  if (row === undefined || handoverHasLapsed(row)) return null;
  return row;
};

export const listHandovers = async (tx: Queryable = db): Promise<HandoverRow[]> => {
  const { rows } = await tx.query<HandoverRow>(
    'SELECT * FROM handovers ORDER BY created_at DESC, id DESC',
  );
  return rows;
};

export const offerHandover = async (
  actorId: string,
  input: {
    folderId: string;
    folderName: string;
    fromId: string;
    toId: string;
    toName: string;
    days: number;
  },
): Promise<HandoverRow> =>
  withTransaction(async (tx) => {
    const offeredDate = today();
    const lapseDate = addDays(offeredDate, input.days);
    const { rows } = await tx.query<HandoverRow>(
      `INSERT INTO handovers (id, folder_id, from_id, to_id, offered_date, lapse_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,'offered') RETURNING *`,
      [newId(), input.folderId, input.fromId, input.toId, offeredDate, lapseDate],
    );
    const handover = rows[0];
    if (handover === undefined) throw new Error('handover insert returned nothing');
    await writeLedger(tx, {
      actorId,
      action: 'handover_offered',
      folderId: input.folderId,
      detail: {
        folderName: input.folderName,
        personName: input.toName,
        endDate: lapseDate,
      },
    });
    return handover;
  });

export const decideHandover = async (
  actorId: string,
  handover: HandoverRow,
  decision: 'accepted' | 'declined',
  context: { folderName: string; actorName: string },
): Promise<HandoverRow> =>
  withTransaction(async (tx) => {
    const { rows } = await tx.query<HandoverRow>(
      'UPDATE handovers SET status = $2 WHERE id = $1 RETURNING *',
      [handover.id, decision],
    );
    const updated = rows[0];
    if (updated === undefined) throw new Error('handover update returned nothing');
    if (decision === 'accepted') {
      await tx.query('UPDATE folders SET owner_id = $2 WHERE id = $1', [
        handover.folder_id,
        handover.to_id,
      ]);
    }
    await writeLedger(tx, {
      actorId,
      action: decision === 'accepted' ? 'handover_accepted' : 'handover_declined',
      folderId: handover.folder_id,
      detail: { folderName: context.folderName, personName: context.actorName },
    });
    return updated;
  });

export const lapseHandover = async (handover: HandoverRow, folderName: string): Promise<void> => {
  await withTransaction(async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE handovers SET status = 'lapsed' WHERE id = $1 AND status = 'offered'`,
      [handover.id],
    );
    if (rowCount === 0) return;
    await writeLedger(tx, {
      actorId: null,
      action: 'handover_lapsed',
      folderId: handover.folder_id,
      detail: { folderName, endDate: handover.lapse_date },
    });
  });
};
