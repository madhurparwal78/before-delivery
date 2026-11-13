import type { PoolClient } from 'pg';
import type { Contract, ContractRate } from '../../shared/api.js';
import { query } from '../db/pool.js';
import type { ContractTerms } from '../domain/billing.js';

export interface ContractRecord extends ContractTerms {
  id: string;
  orgId: string;
  orgName: string;
  rates: ContractRate[];
}

interface ContractRow {
  id: string;
  org_id: string;
  org_name: string;
  minimum_minutes: number;
  increment_minutes: number;
  rotation_interval_minutes: number;
  rates: ContractRate[] | null;
}

const CONTRACT_SELECT = `
  SELECT c.id, c.org_id, o.name AS org_name, c.minimum_minutes, c.increment_minutes,
         c.rotation_interval_minutes,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'effective_from', r.effective_from,
              'hourly_rate_cents', r.hourly_rate_cents,
              'team_surcharge_bp', r.team_surcharge_bp,
              'mileage_cents_per_mile', r.mileage_cents_per_mile) ORDER BY r.effective_from)
            FROM contract_rates r WHERE r.contract_id = c.id),
           '[]'::json
         ) AS rates
  FROM contracts c JOIN orgs o ON o.id = c.org_id
`;

function toRecord(row: ContractRow): ContractRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    orgName: row.org_name,
    minimumMinutes: row.minimum_minutes,
    incrementMinutes: row.increment_minutes,
    rotationIntervalMinutes: row.rotation_interval_minutes,
    rates: row.rates ?? [],
  };
}

export function toContractResponse(record: ContractRecord): Contract {
  return {
    id: record.id,
    org_id: record.orgId,
    org_name: record.orgName,
    minimum_minutes: record.minimumMinutes,
    increment_minutes: record.incrementMinutes,
    rotation_interval_minutes: record.rotationIntervalMinutes,
    rates: record.rates,
  };
}

export async function allContracts(): Promise<ContractRecord[]> {
  const rows = await query<ContractRow>(`${CONTRACT_SELECT} ORDER BY o.name`);
  return rows.map(toRecord);
}

export async function contractById(id: string): Promise<ContractRecord | null> {
  const rows = await query<ContractRow>(`${CONTRACT_SELECT} WHERE c.id = $1`, [id]);
  const row = rows[0];
  return row ? toRecord(row) : null;
}

export async function contractForOrg(
  orgId: string,
  client?: PoolClient,
): Promise<ContractRecord> {
  const sql = `${CONTRACT_SELECT} WHERE c.org_id = $1`;
  const rows = client
    ? (await client.query<ContractRow>(sql, [orgId])).rows
    : await query<ContractRow>(sql, [orgId]);
  const row = rows[0];
  if (!row) throw new Error(`No contract for organisation ${orgId}`);
  return toRecord(row);
}

export async function orgName(orgId: string): Promise<string | null> {
  const rows = await query<{ name: string }>('SELECT name FROM orgs WHERE id = $1', [orgId]);
  return rows[0]?.name ?? null;
}
