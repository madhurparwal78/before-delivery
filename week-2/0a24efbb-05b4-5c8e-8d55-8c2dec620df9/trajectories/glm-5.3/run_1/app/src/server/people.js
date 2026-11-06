import { query } from '../db/pg.js';
import { foldAddress } from '../domain/text.js';

/** A person row as the HR system of record keeps it, read live. */
export async function getPerson(id) {
  const rows = await query('SELECT * FROM person WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function getPersonByFoldedAddress(address) {
  const rows = await query('SELECT * FROM person');
  const folded = foldAddress(address);
  return rows.find((p) => foldAddress(p.work_address) === folded) || null;
}

export async function currentManagerIds(personId) {
  // The reporting line is read live from the store.
  const rows = await query(
    'SELECT id FROM person WHERE manager_id = $1 AND active = true',
    [personId]
  );
  return rows.map((r) => r.id);
}

export async function directReports(personId) {
  const rows = await query(
    'SELECT id, name, work_address, active FROM person WHERE manager_id = $1',
    [personId]
  );
  return rows;
}
