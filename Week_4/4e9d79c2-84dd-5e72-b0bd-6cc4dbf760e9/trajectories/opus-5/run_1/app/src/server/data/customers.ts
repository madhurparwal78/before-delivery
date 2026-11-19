import { config } from '../config.js';
import { makeId, one, query } from '../db.js';
import { Language } from '../../domain/strings.js';
import { foldEmail, foldTelephone } from '../../domain/text.js';

export type CustomerState = 'active' | 'closed' | 'erasing';

export type Customer = {
  id: string;
  name: string;
  email: string;
  telephone: string;
  language: Language;
  notes: string;
  state: CustomerState;
  closedAt: number | null;
  eraseAt: number | null;
  erased: boolean;
};

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  telephone: string;
  language: Language;
  notes: string;
  state: CustomerState;
  closed_at: string | null;
  erase_at: string | null;
  erased: boolean;
};

const COLUMNS = 'id, name, email, telephone, language, notes, state, closed_at, erase_at, erased';

function fromRow(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    telephone: row.telephone,
    language: row.language,
    notes: row.notes,
    state: row.state,
    closedAt: row.closed_at === null ? null : Number(row.closed_at),
    eraseAt: row.erase_at === null ? null : Number(row.erase_at),
    erased: row.erased,
  };
}

export async function listCustomers(
  deskId: string,
  filters: { q?: string | null; state?: string | null },
): Promise<Customer[]> {
  const values: unknown[] = [deskId];
  const where = ['desk_id = $1', 'removed = false', 'erased = false'];
  const state = filters.state ?? 'active';
  if (state === 'closed') {
    where.push("state in ('closed', 'erasing')");
  } else if (state === 'all') {
    where.push("state in ('active', 'closed', 'erasing')");
  } else {
    where.push("state = 'active'");
  }
  if (filters.q && filters.q.trim() !== '') {
    values.push(`%${filters.q.trim().toLowerCase()}%`);
    where.push(`(lower(name) like $${values.length} or lower(email) like $${values.length})`);
  }
  const rows = await query<CustomerRow>(
    `select ${COLUMNS} from customers where ${where.join(' and ')} order by created_at, id`,
    values,
  );
  return rows.map(fromRow);
}

export async function customerById(deskId: string, id: string): Promise<Customer | null> {
  const row = await one<CustomerRow>(
    `select ${COLUMNS} from customers where desk_id = $1 and id = $2 and removed = false and erased = false`,
    [deskId, id],
  );
  return row ? fromRow(row) : null;
}

export async function addCustomer(
  deskId: string,
  person: { name: string; email: string; telephone: string; language: Language; notes?: string },
): Promise<Customer> {
  const id = makeId('CU');
  await query(
    `insert into customers (desk_id, id, name, email, email_folded, telephone, telephone_folded, language, notes, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      deskId,
      id,
      person.name,
      person.email,
      foldEmail(person.email),
      person.telephone,
      foldTelephone(person.telephone),
      person.language,
      person.notes ?? '',
      Date.now(),
    ],
  );
  return (await customerById(deskId, id)) as Customer;
}

export async function renameCustomer(deskId: string, id: string, name: string): Promise<void> {
  await query('update customers set name = $3 where desk_id = $1 and id = $2', [deskId, id, name]);
}

export async function customerHasHire(deskId: string, id: string): Promise<boolean> {
  const row = await one<{ id: string }>('select id from enquiries where desk_id = $1 and customer_id = $2 limit 1', [
    deskId,
    id,
  ]);
  return row !== null;
}

export async function removeCustomer(deskId: string, id: string): Promise<void> {
  await query('update customers set removed = true where desk_id = $1 and id = $2', [deskId, id]);
}

export async function closeCustomer(deskId: string, id: string): Promise<Customer> {
  const now = Date.now();
  await query("update customers set state = 'closed', closed_at = $3, erase_at = $4 where desk_id = $1 and id = $2", [
    deskId,
    id,
    now,
    now + config.closureWaitSeconds * 1000,
  ]);
  return (await customerById(deskId, id)) as Customer;
}

export async function bringBackCustomer(deskId: string, id: string): Promise<Customer> {
  await query(
    "update customers set state = 'active', closed_at = null, erase_at = null where desk_id = $1 and id = $2",
    [deskId, id],
  );
  return (await customerById(deskId, id)) as Customer;
}

/** After the wait a closed customer reads Erasing. Decided at each read. */
export async function markErasingCustomers(deskId: string, now: number): Promise<void> {
  await query(
    "update customers set state = 'erasing' where desk_id = $1 and state = 'closed' and erase_at is not null and erase_at <= $2",
    [deskId, now],
  );
}

export async function customersToErase(now: number): Promise<{ deskId: string; id: string }[]> {
  const rows = await query<{ desk_id: string; id: string }>(
    `select desk_id, id from customers
     where erased = false and erase_at is not null and erase_at <= $1 and state in ('closed','erasing')`,
    [now],
  );
  return rows.map((row) => ({ deskId: row.desk_id, id: row.id }));
}

export async function matchesForSheetRow(
  deskId: string,
  email: string,
  telephone: string,
): Promise<Customer[]> {
  const rows = await query<CustomerRow>(
    `select ${COLUMNS} from customers where desk_id = $1 and removed = false and erased = false
       and (($2 <> '' and email_folded = $2) or ($3 <> '' and telephone_folded = $3))
     order by created_at, id`,
    [deskId, foldEmail(email), foldTelephone(telephone)],
  );
  return rows.map(fromRow);
}

export async function fillEmptyFields(
  deskId: string,
  id: string,
  values: { email: string; telephone: string; notes: string },
): Promise<void> {
  await query(
    `update customers set
       email = case when email = '' then $3 else email end,
       email_folded = case when email = '' then $4 else email_folded end,
       telephone = case when telephone = '' then $5 else telephone end,
       telephone_folded = case when telephone = '' then $6 else telephone_folded end,
       notes = case when notes = '' then $7 else notes end
     where desk_id = $1 and id = $2`,
    [deskId, id, values.email, foldEmail(values.email), values.telephone, foldTelephone(values.telephone), values.notes],
  );
}

export async function addReviewRow(deskId: string, row: number, message: string): Promise<void> {
  await query('insert into review_list (desk_id, id, row, message, created_at) values ($1,$2,$3,$4,$5)', [
    deskId,
    makeId('RV'),
    row,
    message,
    Date.now(),
  ]);
}

export async function reviewList(deskId: string): Promise<{ row: number; message: string }[]> {
  const rows = await query<{ row: number; message: string }>(
    'select row, message from review_list where desk_id = $1 order by row',
    [deskId],
  );
  return rows.map((row) => ({ row: Number(row.row), message: row.message }));
}

export async function sheetSeen(deskId: string, hash: string): Promise<boolean> {
  const row = await one<{ hash: string }>('select hash from sheet_imports where desk_id = $1 and hash = $2', [
    deskId,
    hash,
  ]);
  return row !== null;
}

export async function markSheetSeen(deskId: string, hash: string): Promise<void> {
  await query('insert into sheet_imports (desk_id, hash) values ($1, $2) on conflict do nothing', [deskId, hash]);
}

export function customerJson(customer: Customer): Record<string, unknown> {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    telephone: customer.telephone,
    language: customer.language,
    notes: customer.notes,
    state: customer.state,
    closedAt: customer.closedAt === null ? null : new Date(customer.closedAt).toISOString().slice(0, 19) + 'Z',
    eraseAt: customer.eraseAt === null ? null : new Date(customer.eraseAt).toISOString().slice(0, 19) + 'Z',
  };
}
