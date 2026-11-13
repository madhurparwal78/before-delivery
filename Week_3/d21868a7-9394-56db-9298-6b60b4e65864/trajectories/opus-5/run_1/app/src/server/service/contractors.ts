import { ApiError } from '../../domain/errors.ts';
import { pool, transaction } from '../db.ts';
import { handOverOpenCardsOf } from './cards.ts';

/** Contractor erasure: the name, phone and email go, the operator code stays. */

interface ContractorRow {
  code: string;
  name: string | null;
  phone: string | null;
  erased: boolean;
}

export async function contractorList(): Promise<Record<string, unknown>[]> {
  const found = await pool.query<ContractorRow>(
    `select operator_code as code, name, phone, erased from users
      where operator_kind = 'contractor' order by operator_code`,
  );
  return found.rows.map((row) => ({ code: row.code, name: row.name, phone: row.phone, erased: row.erased }));
}

export async function eraseContractor(operatorCode: string): Promise<Record<string, unknown>> {
  const existing = await pool.query<{ id: number; erased: boolean }>(
    "select id, erased from users where operator_code = $1 and operator_kind = 'contractor'",
    [operatorCode],
  );
  if (existing.rows[0] === undefined) throw new ApiError('not_found');

  const handedOver = await transaction(async (client) => {
    const locked = await client.query<{ id: number; erased: boolean }>(
      'select id, erased from users where operator_code = $1 for update',
      [operatorCode],
    );
    const user = locked.rows[0] as { id: number; erased: boolean };
    if (user.erased) throw new ApiError('already_erased');

    const moved = await handOverOpenCardsOf(client, operatorCode);
    await client.query(
      'update users set name = null, email = null, phone = null, password_hash = null, erased = true where id = $1',
      [user.id],
    );
    await client.query('delete from sessions where user_id = $1', [user.id]);
    return moved;
  });

  return {
    contractor: { code: operatorCode, name: null, phone: null, erased: true },
    handed_over: handedOver,
  };
}
