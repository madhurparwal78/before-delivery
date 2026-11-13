import { FIELD_MESSAGES } from '../shared/messages';
import type { Db } from './db';
import type { Validator } from './validate';

/** Names are unique across parts, purchased parts and assemblies, ignoring letter case. Reports whether the name was free. */
export async function reserveName(db: Db, name: string, componentId: string): Promise<boolean> {
  const { rowCount } = await db.query('INSERT INTO component_names (name_key, component_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    name.toLowerCase(),
    componentId,
  ]);
  return rowCount === 1;
}

export async function claimName(db: Db, v: Validator, name: string, field: string, componentId: string): Promise<void> {
  if (!(await reserveName(db, name, componentId))) v.fail(field, FIELD_MESSAGES.nameUsed);
}

export async function releaseName(db: Db, name: string): Promise<void> {
  await db.query('DELETE FROM component_names WHERE name_key = $1', [name.toLowerCase()]);
}
