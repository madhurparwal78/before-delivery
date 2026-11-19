import type { App } from '../http/app.ts';
import { invalid, notFound } from '../http/errors.ts';
import type { JsonObject } from '../http/validate.ts';
import { isObject } from '../http/validate.ts';
import { findUser } from '../auth/accounts.ts';

/** The ids `POST /api/grading/seed` answers with, by the names the request used. */
export interface SeedIds {
  users: Record<string, string>;
  projects: Record<string, string>;
  sources: Record<string, string>;
  workbooks: Record<string, string>;
  /** keyed `<workbook>/<sheet>` */
  sheets: Record<string, string>;
  /** keyed `<workbook>/<dashboard>` */
  dashboards: Record<string, string>;
  parameters: Record<string, string>;
  sets: Record<string, string>;
  alerts: Record<string, string>;
}

/**
 * One part of the seed request. Steps run in ascending `order`, each reading its own key of `body` and filling `ids`.
 * Orders: users 10, projects 20, sources 30, entitlements 40, schedules 50, parameters 60, sets 62, workbooks 65,
 * alerts 70, extracts 80.
 */
export interface SeedStep {
  order: number;
  run(app: App, body: JsonObject, ids: SeedIds): Promise<void>;
}

export function emptyIds(): SeedIds {
  return { users: {}, projects: {}, sources: {}, workbooks: {}, sheets: {}, dashboards: {}, parameters: {}, sets: {}, alerts: {} };
}

/** The records under `key`: absent is none, anything but a list of objects is a 422. */
export function seedList(body: JsonObject, key: string): JsonObject[] {
  const value = body[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isObject)) throw invalid({ [key]: 'invalid' });
  return value;
}

/** Records refer to each other by name; the call adds to what exists, so earlier seeds' records resolve too. */
export async function userIdOf(app: App, ids: SeedIds, username: unknown): Promise<string> {
  const known = typeof username === 'string' ? ids.users[username] : undefined;
  if (known) return known;
  const user = typeof username === 'string' ? await findUser(app, username) : null;
  if (!user) throw notFound();
  return user.id;
}

export async function projectIdOf(app: App, ids: SeedIds, name: unknown): Promise<string> {
  const known = typeof name === 'string' ? ids.projects[name] : undefined;
  if (known) return known;
  const row = await app.db.row<{ id: string }>(
    `SELECT id FROM projects WHERE id = $1 OR name = $1 ORDER BY (id = $1) DESC, created_at DESC LIMIT 1`,
    [String(name)],
  );
  if (!row) throw notFound();
  return row.id;
}

/** A source by the seed's name for it, its id, or its name (the newest of that name). */
export async function sourceIdOf(app: App, ids: SeedIds, ref: unknown): Promise<string> {
  const known = typeof ref === 'string' ? ids.sources[ref] : undefined;
  if (known) return known;
  const row = await app.db.row<{ id: string }>(
    `SELECT id FROM sources WHERE id = $1 OR name = $1 ORDER BY (id = $1) DESC, created_at DESC LIMIT 1`,
    [String(ref)],
  );
  if (!row) throw notFound();
  return row.id;
}
