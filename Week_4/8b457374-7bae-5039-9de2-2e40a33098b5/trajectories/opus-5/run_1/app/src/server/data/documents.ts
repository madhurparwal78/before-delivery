import type { Db } from './db.js';

export interface DocumentRow {
  status: 'pending' | 'ready';
  object_key: string;
}

export interface StatementRow extends DocumentRow {
  pledge_id: string;
}

export interface SettlementRow extends DocumentRow {
  campaign_id: string;
}

/** A captured pledge's statement starts pending and becomes ready once stored. */
export async function recordPendingStatement(
  db: Db,
  pledgeId: string,
  objectKey: string,
): Promise<void> {
  await db.query(
    `insert into statements (pledge_id, status, object_key) values ($1, 'pending', $2)
     on conflict (pledge_id) do nothing`,
    [pledgeId, objectKey],
  );
}

export async function markStatementReady(db: Db, pledgeId: string): Promise<void> {
  await db.query(
    `update statements set status = 'ready', stored_at = now() where pledge_id = $1`,
    [pledgeId],
  );
}

export async function findStatement(db: Db, pledgeId: string): Promise<StatementRow | null> {
  const result = await db.query<StatementRow>(
    'select pledge_id, status, object_key from statements where pledge_id = $1',
    [pledgeId],
  );
  return result.rows[0] ?? null;
}

export async function statementStatuses(
  db: Db,
  pledgeIds: readonly string[],
): Promise<Map<string, 'pending' | 'ready'>> {
  if (pledgeIds.length === 0) return new Map();
  const result = await db.query<{ pledge_id: string; status: 'pending' | 'ready' }>(
    'select pledge_id, status from statements where pledge_id = any($1::text[])',
    [[...pledgeIds]],
  );
  return new Map(result.rows.map((row) => [row.pledge_id, row.status]));
}

export async function listPendingStatements(db: Db): Promise<StatementRow[]> {
  const result = await db.query<StatementRow>(
    `select pledge_id, status, object_key from statements where status = 'pending'`,
  );
  return result.rows;
}

export async function recordPendingSettlement(
  db: Db,
  campaignId: string,
  objectKey: string,
): Promise<void> {
  await db.query(
    `insert into settlements (campaign_id, status, object_key) values ($1, 'pending', $2)
     on conflict (campaign_id) do nothing`,
    [campaignId, objectKey],
  );
}

export async function markSettlementReady(db: Db, campaignId: string): Promise<void> {
  await db.query(
    `update settlements set status = 'ready', stored_at = now() where campaign_id = $1`,
    [campaignId],
  );
}

export async function findSettlement(db: Db, campaignId: string): Promise<SettlementRow | null> {
  const result = await db.query<SettlementRow>(
    'select campaign_id, status, object_key from settlements where campaign_id = $1',
    [campaignId],
  );
  return result.rows[0] ?? null;
}

export async function listPendingSettlements(db: Db): Promise<SettlementRow[]> {
  const result = await db.query<SettlementRow>(
    `select campaign_id, status, object_key from settlements where status = 'pending'`,
  );
  return result.rows;
}
