import { foldWorkAddress } from '../shared/text.js';
import { pool } from './db.js';

const PERSON_COLUMNS = 'id, employer_id, name, work_address, role, manager_id, active, phone, private_note';

/** Role, reporting line and active flag are read from the person rows on every call. */
export async function personById(id, client = pool) {
  const result = await client.query(`SELECT ${PERSON_COLUMNS} FROM person WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function personByFoldedAddress(workAddress, client = pool) {
  const result = await client.query(`SELECT ${PERSON_COLUMNS} FROM person WHERE lower(work_address) = $1`, [
    foldWorkAddress(workAddress),
  ]);
  return result.rows[0] ?? null;
}

export async function directReportIds(managerId, client = pool) {
  const result = await client.query('SELECT id FROM person WHERE manager_id = $1 ORDER BY id', [managerId]);
  return result.rows.map((row) => row.id);
}

/** The people whose requests a caller may read: the one entitlement check for the queue. */
export async function requestScopeIds(caller, client = pool) {
  if (caller.role === 'admin') {
    const result = await client.query('SELECT id FROM person WHERE employer_id = $1 ORDER BY id', [caller.employer_id]);
    return result.rows.map((row) => row.id);
  }
  if (caller.role === 'manager') {
    return [caller.id, ...(await directReportIds(caller.id, client))];
  }
  return [caller.id];
}

/** The people a calendar read covers: a manager's current reports, or everyone. */
export async function calendarScopeIds(caller, client = pool) {
  if (caller.role === 'admin') {
    const result = await client.query('SELECT id FROM person WHERE employer_id = $1 ORDER BY id', [caller.employer_id]);
    return result.rows.map((row) => row.id);
  }
  return directReportIds(caller.id, client);
}

/**
 * The people a caller may mint a shared month for: a manager's current active direct
 * reports, people operations' every active person.
 */
export function personIsInMintScope(minter, person) {
  if (!minter || !minter.active || !person || !person.active) return false;
  if (minter.role === 'admin') return true;
  if (minter.role === 'manager') return person.manager_id === minter.id;
  return false;
}

export async function peopleByIds(ids, client = pool) {
  if (ids.length === 0) return [];
  const result = await client.query(
    `SELECT ${PERSON_COLUMNS} FROM person WHERE id = ANY ($1::int[]) ORDER BY name, id`,
    [ids],
  );
  return result.rows;
}

export async function namesByIds(ids, client = pool) {
  const byId = new Map();
  for (const row of await peopleByIds(ids, client)) byId.set(row.id, row.name);
  return byId;
}

/** The id of the person a `person` filter names, matched in its folded form. */
export function matchScopeByAddress(people, value) {
  const folded = foldWorkAddress(value);
  const found = people.find((person) => foldWorkAddress(person.work_address) === folded);
  return found ? found.id : null;
}

export async function employer(client = pool) {
  const result = await client.query('SELECT id, name, time_zone, seeded_on FROM employer WHERE id = 1');
  return result.rows[0] ?? null;
}
