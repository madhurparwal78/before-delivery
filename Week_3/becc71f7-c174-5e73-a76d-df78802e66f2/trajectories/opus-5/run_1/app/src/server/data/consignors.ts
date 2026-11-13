import { instantOf, maybeInstant, type Queryable } from '../db.js';
import { isoSeconds } from '../../shared/brussels.js';
import { isValidIban } from '../domain/iban.js';
import type { ConsignorStatus } from '../../shared/options.js';
import { UUID_PATTERN } from './pieces.js';

export interface ConsignorRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  iban: string | null;
  status: ConsignorStatus;
  createdAt: number;
  erasedAt: number | null;
}

const CONSIGNOR_COLUMNS = `id, name, email, phone, iban, status, created_at, erased_at`;

function consignorOf(row: Record<string, unknown>): ConsignorRecord {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    email: (row['email'] as string | null) ?? null,
    phone: (row['phone'] as string | null) ?? null,
    iban: (row['iban'] as string | null) ?? null,
    status: row['status'] as ConsignorStatus,
    createdAt: instantOf(row['created_at']),
    erasedAt: maybeInstant(row['erased_at']),
  };
}

export function consignorJson(consignor: ConsignorRecord): unknown {
  return {
    id: consignor.id,
    name: consignor.name,
    email: consignor.email,
    phone: consignor.phone,
    iban: consignor.iban,
    ibanValid: isValidIban(consignor.iban),
    status: consignor.status,
    createdAt: isoSeconds(consignor.createdAt),
  };
}

export async function loadConsignor(
  db: Queryable,
  id: string,
): Promise<ConsignorRecord | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const { rows } = await db.query(`SELECT ${CONSIGNOR_COLUMNS} FROM consignors WHERE id = $1`, [id]);
  const row = rows[0];
  return row === undefined ? null : consignorOf(row);
}

export async function loadConsignors(db: Queryable): Promise<ConsignorRecord[]> {
  const { rows } = await db.query(
    `SELECT ${CONSIGNOR_COLUMNS} FROM consignors ORDER BY name, created_at`,
  );
  return rows.map(consignorOf);
}

export { CONSIGNOR_COLUMNS, consignorOf };
