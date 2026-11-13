import { randomUUID } from 'node:crypto';
import type { LandingFrame } from '../shared/types';
import { inTransaction, pool } from './db';
import { hashPassword } from './session';

const DEMO_EMAIL = 'demo@pinsheet.test';
const DEMO_NAME = 'Wren Demo';
const DEMO_PASSWORD = 'pinsheet-demo-1';
const DEMO_BOARD = 'Field day';

const DEMO_POSTS: Array<{ section: string; title: string; file: string | null }> = [
  { section: 'Plans', title: 'Packing list', file: 'packing-list.pdf' },
  { section: 'Plans', title: 'Bus times', file: 'bus-times.txt' },
  { section: 'Plans', title: 'Rain plan', file: null },
  { section: 'Plans', title: 'Campfire rota', file: null },
  { section: 'Photos', title: 'Ridge at dawn', file: null },
  { section: 'Photos', title: 'Canoe launch', file: null },
  { section: 'Photos', title: 'Fern gully', file: null },
  { section: 'Photos', title: 'Group photo', file: null },
  { section: 'Photos', title: 'Lake at dusk', file: null },
  { section: 'Notes', title: 'Map of the loop', file: null },
  { section: 'Notes', title: 'Lunch spot vote', file: null },
  { section: 'Notes', title: 'Kit check', file: 'kit-check.txt' },
];

export const seedDemoData = async (): Promise<void> => {
  await inTransaction(async (client) => {
    const existingUser = await client.query<{ id: string }>('select id from users where email = $1', [DEMO_EMAIL]);
    const userId = existingUser.rows[0]?.id ?? randomUUID();
    if ((existingUser.rowCount ?? 0) === 0) {
      await client.query(
        'insert into users (id, display_name, email, password_hash, verified) values ($1, $2, $3, $4, true)',
        [userId, DEMO_NAME, DEMO_EMAIL, hashPassword(DEMO_PASSWORD)],
      );
    }
    const existingBoard = await client.query('select id from boards where owner_id = $1 and title = $2', [
      userId,
      DEMO_BOARD,
    ]);
    if ((existingBoard.rowCount ?? 0) > 0) return;

    const boardId = randomUUID();
    await client.query(
      `insert into boards (id, owner_id, title, layout, sort, grouping, privacy, approval, link_access)
       values ($1, $2, $3, 'columns', 'by_hand', 'section', 'public', false, 'off')`,
      [boardId, userId, DEMO_BOARD],
    );
    const sectionIds: Record<string, string> = {};
    for (const [index, title] of ['Plans', 'Photos', 'Notes'].entries()) {
      const sectionId = randomUUID();
      sectionIds[title] = sectionId;
      await client.query('insert into sections (id, board_id, title, ord) values ($1, $2, $3, $4)', [
        sectionId,
        boardId,
        title,
        index,
      ]);
    }
    const positions: Record<string, number> = {};
    for (const post of DEMO_POSTS) {
      const sectionId = sectionIds[post.section];
      positions[sectionId] = (positions[sectionId] ?? 0) + 1;
      await client.query(
        `insert into posts (id, board_id, section_id, author_id, title, body, state, position, last_actor_id)
         values ($1, $2, $3, $4, $5, '', 'published', $6, $4)`,
        [randomUUID(), boardId, sectionId, userId, post.title, positions[sectionId]],
      );
    }
  });
};

/** The landing strip reads the demo board's published posts in board order. */
export const landingFrames = async (): Promise<LandingFrame[]> => {
  const result = await pool.query<{ id: string; title: string }>(
    `select p.id, p.title from posts p
       join boards b on b.id = p.board_id
       join users u on u.id = b.owner_id
       join sections s on s.id = p.section_id
     where u.email = $1 and b.title = $2 and p.state = 'published'
     order by s.ord, p.position`,
    [DEMO_EMAIL, DEMO_BOARD],
  );
  return result.rows.map((row) => {
    const demo = DEMO_POSTS.find((post) => post.title === row.title);
    const file = demo?.file ?? null;
    return { id: row.id, title: row.title, kind: file === null ? 'field' : 'file', file_name: file };
  });
};
