// The platform's parts of `POST /api/grading/seed`: users, projects, sources, entitlements, schedules, extracts.
import type { Role } from '../../shared/model.ts';
import { createUser, findUser } from '../auth/accounts.ts';
import { saveSchedule } from '../extracts/schedule.ts';
import { publishExtract } from '../extracts/state.ts';
import type { App } from '../http/app.ts';
import { invalid } from '../http/errors.ts';
import { isObject, isString, nonBlank } from '../http/validate.ts';
import { isRole } from '../projects/access.ts';
import { NAME_REQUIRED } from '../projects/routes.ts';
import { createProject } from '../projects/store.ts';
import { generatedCsv, loadSample } from '../sample/index.ts';
import { setEntitlements, setRelation } from '../sources/edits.ts';
import { addTable, createSource } from '../sources/ingest.ts';
import { projectIdOf, seedList, sourceIdOf, userIdOf } from './seed.ts';

const name = (value: unknown, key: string): string => {
  const text = nonBlank(value);
  if (text === null) throw invalid({ [key]: NAME_REQUIRED });
  return text;
};

const time = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) throw invalid({ extracts: 'invalid' });
  return new Date(ms);
};

export function registerPlatformSeed(app: App): void {
  app.seedStep({
    order: 10,
    run: async (app, body, ids) => {
      for (const record of seedList(body, 'users')) {
        const created = await createUser(app, record.username, record.password);
        const user = created ?? (await findUser(app, name(record.username, 'username')));
        if (user) ids.users[name(record.username, 'username')] = user.id;
      }
    },
  });

  app.seedStep({
    order: 20,
    run: async (app, body, ids) => {
      for (const record of seedList(body, 'projects')) {
        const title = name(record.name, 'name');
        const members: [string, Role][] = [];
        for (const [username, role] of Object.entries(isObject(record.members) ? record.members : {})) {
          if (!isRole(role)) throw invalid({ role: 'Role must be viewer, explorer or creator.' });
          members.push([await userIdOf(app, ids, username), role]);
        }
        const explorers = record.explorers_schedule === true;
        ids.projects[title] = await app.db.transaction((tx) => createProject(tx, title, members, explorers));
      }
    },
  });

  app.seedStep({
    order: 30,
    run: async (app, body, ids) => {
      for (const record of seedList(body, 'sources')) {
        const title = name(record.name, 'name');
        const projectId = await projectIdOf(app, ids, record.project);
        ids.sources[title] = await seedSource(app, projectId, title, record);
      }
    },
  });

  app.seedStep({
    order: 40,
    run: async (app, body, ids) => {
      for (const record of seedList(body, 'entitlements')) {
        const sourceId = await sourceIdOf(app, ids, record.source);
        await setEntitlements(app, sourceId, { field: record.field ?? null, users: record.users });
      }
    },
  });

  app.seedStep({
    order: 50,
    run: async (app, body, ids) => {
      for (const record of seedList(body, 'schedules')) {
        await saveSchedule(app, await sourceIdOf(app, ids, record.source), record);
      }
    },
  });

  app.seedStep({
    order: 80,
    run: async (app, body, ids) => {
      for (const record of seedList(body, 'extracts')) {
        const sourceId = await sourceIdOf(app, ids, record.source);
        const state = record.state === 'refresh_failed' ? 'refresh_failed' : 'live';
        await app.db.exec(
          `UPDATE extracts SET state = $2, last_success_at = COALESCE($3, last_success_at), last_failure_at = $4
            WHERE source_id = $1`,
          [sourceId, state, time(record.last_success_at), time(record.last_failure_at)],
        );
        await publishExtract(app, sourceId);
      }
    },
  });
}

async function seedSource(app: App, projectId: string, title: string, record: Record<string, unknown>) {
  if (record.sample !== undefined) {
    if (record.sample !== 'fernhollow') throw invalid({ sample: 'invalid' });
    return loadSample(app, projectId, title);
  }
  if (record.rows !== undefined) {
    const rows = record.rows;
    if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1) throw invalid({ rows: 'invalid' });
    return createSource(app, projectId, title, 'data', Buffer.from(generatedCsv(rows)));
  }
  const tables = Array.isArray(record.tables) ? record.tables.filter(isObject) : [];
  const [first, ...rest] = tables;
  if (!first || !isString(first.csv)) throw invalid({ tables: 'invalid' });
  const id = await createSource(app, projectId, title, name(first.name, 'table'), Buffer.from(first.csv));
  for (const table of rest) {
    if (!isString(table.csv)) throw invalid({ tables: 'invalid' });
    await addTable(app, id, name(table.name, 'table'), Buffer.from(table.csv));
  }
  if (isObject(record.relation)) await setRelation(app, id, record.relation);
  return id;
}
