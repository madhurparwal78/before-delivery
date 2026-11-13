import type { Db } from './db.js';
import bcrypt from 'bcryptjs';

const DEMO_EMAIL = 'demo@pinsheet.test';

export interface SeedStorage {
  put(key: string, bytes: Buffer, contentType: string): Promise<boolean>;
}

const PLANS = ['Packing list', 'Bus times', 'Rain plan', 'Campfire rota'];
const PHOTOS = ['Ridge at dawn', 'Canoe launch', 'Fern gully', 'Group photo', 'Lake at dusk'];
const NOTES = ['Map of the loop', 'Lunch spot vote', 'Kit check'];
const FILE_CARDS = new Set(['Packing list', 'Bus times', 'Kit check']);

export async function seedDemoData(db: Db, storage?: SeedStorage): Promise<void> {
  const existing = await db.query('SELECT id FROM users WHERE email = $1', [DEMO_EMAIL]);
  if (existing.rows.length > 0) return;
  const hash = await bcrypt.hash('pinsheet-demo-1', 10);
  const userId = 'usr_seed_demo';
  await db.query('INSERT INTO users (id, display_name, email, password_hash, confirmed) VALUES ($1, $2, $3, $4, true)', [
    userId,
    'Wren Demo',
    DEMO_EMAIL,
    hash,
  ]);
  const boardId = 'brd_seed_field_day';
  await db.query(
    `INSERT INTO boards (id, title, layout, sort, "group", privacy, approval, link_access, link_token, owner_id)
     VALUES ($1, $2, 'columns', 'by_hand', 'section', 'public', false, 'off', null, $3)`,
    [boardId, 'Field day', userId],
  );
  await db.query('INSERT INTO memberships (board_id, user_id, role) VALUES ($1, $2, $3)', [boardId, userId, 'owner']);
  const sectionIds: Record<string, string> = {};
  for (const [index, title] of ['Plans', 'Photos', 'Notes'].entries()) {
    const sectionId = `sec_seed_${title.toLowerCase().replace(/\s+/g, '_')}`;
    sectionIds[title] = sectionId;
    await db.query('INSERT INTO sections (id, board_id, title, position) VALUES ($1, $2, $3, $4)', [
      sectionId,
      boardId,
      title,
      index + 1,
    ]);
  }
  const ordered = [
    { section: 'Plans', titles: PLANS },
    { section: 'Photos', titles: PHOTOS },
    { section: 'Notes', titles: NOTES },
  ];
  let counter = 0;
  for (const { section, titles } of ordered) {
    for (const [index, title] of titles.entries()) {
      counter += 1;
      await db.query(
        `INSERT INTO posts (id, board_id, section_id, author_id, position, title, body, state, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', now() - ($8 || ' minutes')::interval)`,
        [`pst_seed_${counter}`, boardId, sectionIds[section]!, userId, index + 1, title, '', String(counter)],
      );
    }
  }
  if (storage) {
    counter = 0;
    for (const { titles } of ordered) {
      for (const title of titles) {
        counter += 1;
        if (!FILE_CARDS.has(title)) continue;
        const attachmentId = `att_seed_${counter}`;
        const fileName = `${title.toLowerCase().replace(/\s+/g, '-')}.txt`;
        const content = Buffer.from(`${title} checklist\n`, 'utf8');
        const key = `boards/${boardId}/posts/pst_seed_${counter}/${attachmentId}`;
        const putOk = await storage.put(key, content, 'text/plain; charset=utf-8');
        if (!putOk) continue;
        await db.query(
          'INSERT INTO attachments (id, post_id, board_id, file_name, content_type, size) VALUES ($1, $2, $3, $4, $5, $6)',
          [attachmentId, `pst_seed_${counter}`, boardId, fileName, 'text/plain; charset=utf-8', content.length],
        );
      }
    }
  }
}
