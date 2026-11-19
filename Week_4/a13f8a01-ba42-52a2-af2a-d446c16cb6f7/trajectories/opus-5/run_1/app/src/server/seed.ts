import { starters } from '../shared/starters';
import { findUserByHandle, insertUser, type UserRow } from './auth';
import { appendVersion } from './domain/versions';
import { one, query } from './db';
import { shelf, shelfKey } from './shelf';
import { ensureBucket, objectExists, putObject } from './storage';
import { newId } from './util';

const STARTER_HANDLE = 'coldframe';
const STARTER_EMAIL = 'starters@coldframe.test';

const starterAccount = async (): Promise<UserRow> => {
  const existing = await findUserByHandle(STARTER_HANDLE);
  if (existing) return existing;
  return insertUser({
    handle: STARTER_HANDLE,
    email: STARTER_EMAIL,
    passwordHash: null,
    verified: true,
  });
};

/** The pen rows exist as soon as Postgres answers; their versions wait for storage. */
export const seedRelational = async (): Promise<void> => {
  const account = await starterAccount();
  for (const starter of starters) {
    const existing = await one<{ id: string }>(
      'select id from pens where owner_id = $1 and title = $2',
      [account.id, starter.title],
    );
    if (existing) continue;
    await query(
      `insert into pens (id, owner_id, title, visibility, tags) values ($1, $2, $3, 'public', $4)`,
      [newId(), account.id, starter.title, starter.tags],
    );
  }
};

/** Mirrors the shelf and writes the starter versions; retried until storage answers. */
export const seedStorage = async (): Promise<void> => {
  await ensureBucket();
  for (const library of shelf) {
    const key = shelfKey(library);
    if (!(await objectExists(key))) {
      await putObject(key, library.body, 'text/javascript');
    }
  }

  const account = await findUserByHandle(STARTER_HANDLE);
  if (!account) return;
  for (const starter of starters) {
    const pen = await one<{ id: string; head: number }>(
      'select id, head from pens where owner_id = $1 and title = $2',
      [account.id, starter.title],
    );
    if (!pen || pen.head > 0) continue;
    await appendVersion({
      penId: pen.id,
      baseVersion: 0,
      files: starter.files,
      libraries: starter.libraries,
      restoredFrom: null,
    });
  }
};
