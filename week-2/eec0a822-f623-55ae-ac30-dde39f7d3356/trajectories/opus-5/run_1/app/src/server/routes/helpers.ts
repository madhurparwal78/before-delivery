import { queryOne } from '../db.js';
import type { Reply } from '../http/router.js';
import { splitToday } from '../../shared/zone.js';
import type { ExchangeTableRow } from '../domain/pricing.js';

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({
  status,
  json: body,
  headers,
});

export const noContent = (): Reply => ({ status: 204 });

export function today(now: Date): string {
  return splitToday(now);
}


export async function exchangeTableInForce(
  workspaceId: string,
  date: string,
): Promise<ExchangeTableRow | null> {
  return queryOne<ExchangeTableRow>(
    `SELECT id, effective_date, rate_gbp, rate_usd FROM exchange_tables
      WHERE workspace_id = $1 AND effective_date <= $2
      ORDER BY effective_date DESC LIMIT 1`,
    [workspaceId, date],
  );
}

