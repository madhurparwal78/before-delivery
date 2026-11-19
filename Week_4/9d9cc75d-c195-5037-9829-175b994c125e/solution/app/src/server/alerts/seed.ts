// The alerts part of `POST /api/grading/seed`: each record subscribes its user the way the route does.
import type { App } from '../http/app.ts';
import { notFound } from '../http/errors.ts';
import { seedList, userIdOf } from '../grading/seed.ts';
import { openSheet } from '../sheets/store.ts';
import { alertBody, subscribe } from './alerts.ts';

/** A workbook sheet by the seed's names for it, or by workbook name or id and sheet name. */
async function sheetIdOf(app: App, ids: Record<string, string>, workbook: unknown, sheet: unknown): Promise<string> {
  const known = ids[`${String(workbook)}/${String(sheet)}`];
  if (known) return known;
  const row = await app.db.row<{ id: string }>(
    `SELECT s.id FROM sheets s JOIN workbooks w ON w.id = s.workbook_id
      WHERE s.owner_id IS NULL AND s.name = $2 AND (w.id = $1 OR w.name = $1) ORDER BY w.seq DESC LIMIT 1`,
    [String(workbook), String(sheet)],
  );
  if (!row) throw notFound();
  return row.id;
}

export function registerAlertSeed(app: App): void {
  app.seedStep({
    order: 70,
    run: async (app, body, ids) => {
      for (const record of seedList(body, 'alerts')) {
        const user = { id: await userIdOf(app, ids, record.username), username: String(record.username).toLowerCase() };
        const access = await openSheet(app, user, await sheetIdOf(app, ids.sheets, record.workbook, record.sheet));
        const alert = await subscribe(app, user, access, alertBody(record));
        ids.alerts[alert.name] = alert.id;
      }
    },
  });
}
