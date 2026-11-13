/** Team names: a captain renames only their own team. */

import { checkText, LIMITS, normaliseText } from '../shared/text.js';
import { isUniqueViolation, one, type Db } from './db.js';
import { conflict, invalidFields, notFound } from './errors.js';

export async function teamExists(db: Db, id: number): Promise<boolean> {
  const result = await db.query<{ id: number }>('select id from teams where id = $1', [id]);
  return result.rows.length > 0;
}

export async function renameTeam(db: Db, id: number, name: unknown): Promise<{ id: number; name: string }> {
  if (!Number.isInteger(id)) throw notFound();
  if (typeof name !== 'string') {
    throw invalidFields({ name: name === undefined || name === null ? 'required' : 'invalid' });
  }
  const wanted = normaliseText(name);
  const taken = await db.query<{ id: number }>(
    'select id from teams where lower(name) = lower($1) and id <> $2',
    [wanted, id],
  );
  if (taken.rows.length > 0) throw conflict('name_taken');
  const verdict = checkText(name, LIMITS.teamName);
  if (verdict !== 'ok') throw invalidFields({ name: verdict });
  try {
    const renamed = await db.query<{ id: number; name: string }>(
      'update teams set name = $2 where id = $1 returning id, name',
      [id, wanted],
    );
    return one(renamed);
  } catch (failure) {
    if (isUniqueViolation(failure, 'teams_name_folded')) throw conflict('name_taken');
    throw failure;
  }
}
