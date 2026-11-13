import type { CellType } from '../shared/types.js';
import { query, queryOne, withTransaction } from './db.js';
import { hashPassword, newId, newToken } from './ids.js';
import { loadCells, notebookFileOf, syncSearchDocument } from './notebookstore.js';
import { putObject, storageKeys } from './storage.js';

interface SeedPerson {
  email: string;
  displayName: string;
  password: string;
}

const ADA: SeedPerson = {
  email: 'ada@wrenmoor.test',
  displayName: 'Ada Thornquist',
  password: 'tidewater-2026',
};
const BRAM: SeedPerson = {
  email: 'bram@wrenmoor.test',
  displayName: 'Bram Okonkwo-Lisle',
  password: 'saltmarsh-2026',
};
const CLEO: SeedPerson = {
  email: 'cleo@wrenmoor.test',
  displayName: 'Cleo Varga',
  password: 'larchgate-2026',
};

const TIDE_GAUGE_CELLS: { cell_type: CellType; source: string }[] = [
  {
    cell_type: 'markdown',
    source: '# Tide gauge warm-up\n\nHourly heights from an invented gauge.',
  },
  {
    cell_type: 'code',
    source: 'const heights = [1.2, 1.9, 2.6, 2.1, 1.4, 0.8];\nheights.length',
  },
  { cell_type: 'markdown', source: '## Range' },
  { cell_type: 'code', source: 'Math.max(...heights) - Math.min(...heights)' },
];

async function ensurePerson(person: SeedPerson): Promise<string> {
  const existing = await queryOne<{ id: string }>(`select id from users where email_lower = $1`, [
    person.email,
  ]);
  if (existing) return existing.id;
  const id = newId();
  await query(
    `insert into users (id, email, email_lower, display_name, password_hash, verified)
     values ($1, $2, $3, $4, $5, true)`,
    [id, person.email, person.email, person.displayName, hashPassword(person.password)],
  );
  return id;
}

/** Creates the invented records the app starts with, if they are absent. */
export async function applySeedData(): Promise<void> {
  const adaId = await ensurePerson(ADA);
  const bramId = await ensurePerson(BRAM);
  const cleoId = await ensurePerson(CLEO);

  const existing = await queryOne<{ id: string }>(
    `select id from notebooks where owner_id = $1 and title = $2`,
    [adaId, 'Tide gauge warm-up'],
  );
  if (existing) {
    await syncSearchDocument(existing.id);
    return;
  }

  const notebookId = newId();
  await withTransaction(async (client) => {
    await client.query(`insert into notebooks (id, owner_id, title) values ($1, $2, $3)`, [
      notebookId,
      adaId,
      'Tide gauge warm-up',
    ]);
    for (let index = 0; index < TIDE_GAUGE_CELLS.length; index += 1) {
      await client.query(
        `insert into cells (notebook_id, id, position, cell_type, source) values ($1, $2, $3, $4, $5)`,
        [notebookId, newId(), index, TIDE_GAUGE_CELLS[index].cell_type, TIDE_GAUGE_CELLS[index].source],
      );
    }
    for (const [userId, person, role] of [
      [bramId, BRAM, 'editor'],
      [cleoId, CLEO, 'viewer'],
    ] as [string, SeedPerson, 'editor' | 'viewer'][]) {
      await client.query(
        `insert into shares (id, notebook_id, email, email_lower, role, status, user_id, token)
         values ($1, $2, $3, $4, $5, 'active', $6, $7)`,
        [newId(), notebookId, person.email, person.email, role, userId, newToken()],
      );
    }
    const cells = await loadCells(notebookId, client);
    await putObject(
      storageKeys.working(notebookId),
      Buffer.from(notebookFileOf(cells), 'utf8'),
      'application/json',
    );
  });
  await syncSearchDocument(notebookId);
}
