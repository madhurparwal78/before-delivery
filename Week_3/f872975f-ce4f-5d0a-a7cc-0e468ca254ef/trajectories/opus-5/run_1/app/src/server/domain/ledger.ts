import { Queryable, rows } from '../db/pool';

export type MovementKind = 'intake' | 'split' | 'whole-sale' | 'trim' | 'adjustment';

export interface MovementEntry {
  account: string;
  volume_mm3: number;
}

export interface MovementInput {
  kind: MovementKind;
  ticketId: string | null;
  byUserId: string | null;
  entries: MovementEntry[];
  at: Date;
}

export const boardAccount = (tag: string): string => `board:${tag}`;
export const soldAccount = (ticketId: string): string => `sold:${ticketId}`;
export const INTAKE_ACCOUNT = 'intake';
export const KERF_ACCOUNT = 'kerf';
export const ADJUSTMENT_ACCOUNT = 'adjustment';

export async function writeMovement(client: Queryable, movement: MovementInput): Promise<string> {
  const total = movement.entries.reduce((sum, entry) => sum + entry.volume_mm3, 0);
  if (total !== 0) throw new Error(`ledger movement does not sum to zero: ${total}`);
  const created = await rows<{ id: string }>(
    client,
    `INSERT INTO movements (kind, created_at, ticket_id, by_user_id) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
    [movement.kind, movement.at, movement.ticketId, movement.byUserId]
  );
  const id = created[0]?.id;
  if (id === undefined) throw new Error('ledger movement was not created');
  for (const entry of movement.entries) {
    await client.query('INSERT INTO movement_entries (movement_id, account, volume_mm3) VALUES ($1, $2, $3)', [
      id,
      entry.account,
      entry.volume_mm3
    ]);
  }
  return id;
}

export async function accountBalance(client: Queryable, account: string): Promise<number> {
  const found = await rows<{ balance: string }>(
    client,
    'SELECT COALESCE(SUM(volume_mm3), 0)::text AS balance FROM movement_entries WHERE account = $1',
    [account]
  );
  return Number(found[0]?.balance ?? '0');
}

export function movementId(raw: string): string {
  return `MV-${raw.padStart(4, '0')}`;
}
