import { Queryable, big, db } from '../db';

export type Account = 'funding' | 'available' | 'reserved' | 'settled';
export type MovementKind = 'opening_grant' | 'top_up' | 'reserve' | 'settle' | 'release';

export interface Balances {
  grantedMicro: bigint;
  availableMicro: bigint;
  reservedMicro: bigint;
  settledMicro: bigint;
}

export interface MovementInput {
  teamId: string;
  kind: MovementKind;
  minus: Account;
  plus: Account;
  amountMicro: bigint;
  jobId?: string | null;
  topupId?: string | null;
  kbInvoiceId?: string | null;
}

/** Writes one movement of two entries that sum to zero. */
export async function recordMovement(client: Queryable, input: MovementInput): Promise<string> {
  const { rows } = await client.query<{ value: string }>(`SELECT nextval('movement_seq')::text AS value`);
  const num = rows[0]!.value;
  const id = `mv_${num}`;
  await client.query(
    'INSERT INTO movements (id, num, team_id, kind, created_at, job_id, topup_id, kb_invoice_id) VALUES ($1, $2, $3, $4, now(), $5, $6, $7)',
    [id, num, input.teamId, input.kind, input.jobId ?? null, input.topupId ?? null, input.kbInvoiceId ?? null],
  );
  await client.query(
    `INSERT INTO entries (movement_id, position, team_id, account, amount_micro)
     VALUES ($1, 1, $2, $3, $4), ($1, 2, $2, $5, $6)`,
    [
      id,
      input.teamId,
      input.minus,
      (-input.amountMicro).toString(),
      input.plus,
      input.amountMicro.toString(),
    ],
  );
  return id;
}

export async function balancesOf(client: Queryable, teamId: string): Promise<Balances> {
  const { rows } = await client.query<{ account: string; total: string }>(
    'SELECT account, COALESCE(SUM(amount_micro), 0)::text AS total FROM entries WHERE team_id = $1 GROUP BY account',
    [teamId],
  );
  const totals = new Map<string, bigint>();
  for (const row of rows) totals.set(row.account, big(row.total));
  return {
    grantedMicro: -(totals.get('funding') ?? 0n),
    availableMicro: totals.get('available') ?? 0n,
    reservedMicro: totals.get('reserved') ?? 0n,
    settledMicro: totals.get('settled') ?? 0n,
  };
}

export interface MovementView {
  id: string;
  kind: MovementKind;
  created_at: string;
  job_id: string | null;
  topup_id: string | null;
  kb_invoice_id: string | null;
  entries: { account: Account; amount_micro: number }[];
}

export async function movementsOf(teamId: string): Promise<MovementView[]> {
  const { rows } = await db.query<{
    id: string;
    kind: string;
    created_at: Date;
    job_id: string | null;
    topup_id: string | null;
    kb_invoice_id: string | null;
    account: string;
    amount_micro: string;
    position: number;
    num: string;
  }>(
    `SELECT m.id, m.kind, m.created_at, m.job_id, m.topup_id, m.kb_invoice_id, m.num, e.account, e.amount_micro, e.position
       FROM movements m JOIN entries e ON e.movement_id = m.id
      WHERE m.team_id = $1
      ORDER BY m.num, e.position`,
    [teamId],
  );
  const views = new Map<string, MovementView>();
  const order: string[] = [];
  for (const row of rows) {
    let view = views.get(row.id);
    if (!view) {
      view = {
        id: row.id,
        kind: row.kind as MovementKind,
        created_at: row.created_at.toISOString(),
        job_id: row.job_id,
        topup_id: row.topup_id,
        kb_invoice_id: row.kb_invoice_id,
        entries: [],
      };
      views.set(row.id, view);
      order.push(row.id);
    }
    view.entries.push({ account: row.account as Account, amount_micro: Number(row.amount_micro) });
  }
  return order.map((id) => views.get(id)!);
}

export async function releasedMicroOf(client: Queryable, jobId: string): Promise<bigint> {
  const { rows } = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(e.amount_micro), 0)::text AS total
       FROM movements m JOIN entries e ON e.movement_id = m.id
      WHERE m.job_id = $1 AND m.kind = 'release' AND e.account = 'available'`,
    [jobId],
  );
  return big(rows[0]?.total ?? '0');
}
