import { randomUUID } from 'node:crypto';
import { query, transaction, type Tx } from '../db';
import { refuse } from '../domain/errors';
import { publishAlert } from '../services/ntfy';
import type { AlertDto, AlertKind, AlertState } from '../../shared/types';

export interface AlertRow {
  id: string;
  car_id: string;
  kind: AlertKind;
  state: AlertState;
  attempts: number;
  created_at: Date;
  delivered_at: Date | null;
}

const COLUMNS = 'id, car_id, kind, state, attempts, created_at, delivered_at';

export const alertDto = (row: AlertRow): AlertDto => ({
  id: row.id,
  carId: row.car_id,
  kind: row.kind,
  state: row.state,
  attempts: row.attempts,
  createdAt: row.created_at.toISOString(),
  deliveredAt: row.delivered_at === null ? null : row.delivered_at.toISOString(),
});

export const listAlerts = async (): Promise<AlertRow[]> =>
  query<AlertRow>(`SELECT ${COLUMNS} FROM phone_alert ORDER BY created_at DESC, id DESC`);

export const recordAlert = async (tx: Tx, carId: string, kind: AlertKind): Promise<string> => {
  const id = randomUUID();
  await tx.query("INSERT INTO phone_alert (id, car_id, kind, state) VALUES ($1, $2, $3, 'waiting')", [id, carId, kind]);
  return id;
};

const settle = async (id: string, delivered: boolean): Promise<void> => {
  await query(
    delivered
      ? "UPDATE phone_alert SET state = 'delivered', attempts = attempts + 1, delivered_at = now() WHERE id = $1"
      : "UPDATE phone_alert SET state = 'failed', attempts = attempts + 1 WHERE id = $1",
    [id],
  );
};

/** Sends a recorded alert. The claim or offer that raised it has already committed. */
export const sendRecordedAlert = async (id: string, kind: AlertKind): Promise<void> => {
  const delivered = await publishAlert(kind);
  await settle(id, delivered);
};

/**
 * A retry moves the alert from failed to waiting in one step, and only the request
 * that made that move sends, so simultaneous retries make one ntfy send.
 */
export const retryAlert = async (id: string): Promise<AlertRow> => {
  const claimed = await transaction(async (tx) => {
    const row = await tx.queryOne<AlertRow>(
      `UPDATE phone_alert SET state = 'waiting' WHERE id = $1 AND state = 'failed' RETURNING ${COLUMNS}`,
      [id],
    );
    if (row !== null) return row;
    const current = await tx.queryOne<AlertRow>(`SELECT ${COLUMNS} FROM phone_alert WHERE id = $1`, [id]);
    if (current === null) throw refuse(404, 'not_found', 'That alert could not be found');
    if (current.state === 'delivered') {
      throw refuse(409, 'alert_already_delivered', 'This alert is already being sent');
    }
    throw refuse(409, 'alert_retry_in_progress', 'This alert is already being sent');
  });

  const delivered = await publishAlert(claimed.kind);
  await settle(claimed.id, delivered);
  if (!delivered) throw refuse(503, 'alert_undelivered', 'The phone alert could not be delivered');
  const row = await query<AlertRow>(`SELECT ${COLUMNS} FROM phone_alert WHERE id = $1`, [claimed.id]);
  return row[0];
};
