import { createHmac, timingSafeEqual } from 'node:crypto';
import { query, queryOne, type Transaction } from '../db/pool.js';
import { newMovementId } from '../db/ids.js';
import { signingKey } from '../db/secrets.js';
import { validation } from '../http/errors.js';
import { isoTime } from './time.js';

export type MovementKind = 'delivery' | 'purchase';

export interface LedgerEntry {
  account: 'courier' | 'mint' | 'outfitter';
  amount: number;
  ref: string;
}

export interface Movement {
  movement_id: string;
  kind: MovementKind;
  created_at: string;
  entries: LedgerEntry[];
}

const BALANCE_SQL = `select coalesce(sum(e.amount), 0)::int as balance
                     from ledger_entries e
                     join movements m on m.movement_id = e.movement_id
                     where m.courier_id = $1 and e.account = 'courier'`;

export async function balanceOf(courierId: string): Promise<number> {
  const row = await queryOne<{ balance: number }>(BALANCE_SQL, [courierId]);
  return row?.balance ?? 0;
}

export async function balanceIn(tx: Transaction, courierId: string): Promise<number> {
  const row = await tx.one<{ balance: number }>(BALANCE_SQL, [courierId]);
  return row?.balance ?? 0;
}

/** Writes one movement as two paired entries that sum to zero. */
export async function writeMovement(
  tx: Transaction,
  courierId: string,
  kind: MovementKind,
  ref: string,
  courierAmount: number,
  at: Date,
): Promise<string> {
  const movementId = newMovementId();
  const counterAccount = kind === 'delivery' ? 'mint' : 'outfitter';
  await tx.query(
    `insert into movements (movement_id, courier_id, kind, ref, created_at)
     values ($1, $2, $3, $4, $5)`,
    [movementId, courierId, kind, ref, at],
  );
  await tx.query(
    `insert into ledger_entries (movement_id, account, amount, ref, ordinal)
     values ($1, 'courier', $2, $3, 0), ($1, $4, $5, $3, 1)`,
    [movementId, courierAmount, ref, counterAccount, -courierAmount],
  );
  return movementId;
}

interface CursorPoint {
  createdAt: string;
  movementId: string;
}

async function sign(courierId: string, point: CursorPoint): Promise<string> {
  const key = await signingKey('stamp-history-cursor');
  const payload = Buffer.from(
    JSON.stringify({ c: courierId, t: point.createdAt, m: point.movementId }),
    'utf8',
  ).toString('base64url');
  const mac = createHmac('sha256', key).update(payload).digest('base64url').slice(0, 32);
  return `${payload}.${mac}`;
}

async function verify(courierId: string, cursor: string): Promise<CursorPoint> {
  const [payload, mac] = cursor.split('.');
  if (payload === undefined || mac === undefined) throw validation({ before: 'invalid' });
  const key = await signingKey('stamp-history-cursor');
  const expected = createHmac('sha256', key).update(payload).digest('base64url').slice(0, 32);
  const given = Buffer.from(mac, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    throw validation({ before: 'invalid' });
  }
  let decoded: { c?: unknown; t?: unknown; m?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw validation({ before: 'invalid' });
  }
  if (decoded.c !== courierId || typeof decoded.t !== 'string' || typeof decoded.m !== 'string') {
    throw validation({ before: 'invalid' });
  }
  return { createdAt: decoded.t, movementId: decoded.m };
}

interface MovementRow {
  movement_id: string;
  kind: MovementKind;
  created_at: Date;
}

interface EntryRow {
  movement_id: string;
  account: LedgerEntry['account'];
  amount: number;
  ref: string;
}

export interface HistoryPage {
  balance: number;
  movements: Movement[];
  next_cursor: string | null;
}

/** One page of stamp history, newest first, by whole movements. */
export async function historyPage(
  courierId: string,
  limit: number,
  before: string | undefined,
): Promise<HistoryPage> {
  const point = before === undefined ? null : await verify(courierId, before);
  const rows = point
    ? await query<MovementRow>(
        `select movement_id, kind, created_at from movements
         where courier_id = $1 and (created_at, movement_id) < ($2::timestamptz, $3)
         order by created_at desc, movement_id desc limit $4`,
        [courierId, point.createdAt, point.movementId, limit + 1],
      )
    : await query<MovementRow>(
        `select movement_id, kind, created_at from movements
         where courier_id = $1
         order by created_at desc, movement_id desc limit $2`,
        [courierId, limit + 1],
      );
  const page = rows.slice(0, limit);
  const entries = await query<EntryRow>(
    `select movement_id, account, amount, ref from ledger_entries
     where movement_id = any($1::text[]) order by movement_id, ordinal`,
    [page.map((row) => row.movement_id)],
  );
  const grouped = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.movement_id) ?? [];
    list.push({ account: entry.account, amount: entry.amount, ref: entry.ref });
    grouped.set(entry.movement_id, list);
  }
  const last = page.at(-1);
  return {
    balance: await balanceOf(courierId),
    movements: page.map((row) => ({
      movement_id: row.movement_id,
      kind: row.kind,
      created_at: isoTime(row.created_at),
      entries: grouped.get(row.movement_id) ?? [],
    })),
    next_cursor:
      rows.length > limit && last
        ? await sign(courierId, {
            createdAt: isoTime(last.created_at),
            movementId: last.movement_id,
          })
        : null,
  };
}
