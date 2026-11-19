import { randomUUID } from 'node:crypto';
import { hashPassword, userByEmail } from './accounts.js';
import { pool } from './db.js';
import { buildOutline, type OutlineNode } from './setup.js';

const WREN: OutlineNode[] = [
  {
    text: 'Community garden build',
    children: [
      {
        text: 'Site prep #soil',
        children: [
          { text: 'Clear the lot', date: '2026-11-07', completed: true },
          { text: 'Test soil pH #soil @Mira' },
          { mirrorOf: 'compost' }
        ]
      },
      {
        text: 'Planting plan',
        children: [
          { text: 'Tomatoes #seedlings' },
          { text: 'Herb spiral @Jonah', date: '2026-11-12' },
          { text: 'Native wildflowers #seedlings', completed: true }
        ]
      },
      {
        text: 'Volunteers',
        children: [
          { text: 'Saturday crew @Mira' },
          {
            text: 'Tool library sign-out',
            collapsed: true,
            children: [{ text: 'Borrow the wheelbarrow', date: '2026-11-08' }]
          }
        ]
      }
    ]
  },
  {
    text: 'Weekly errands',
    children: [
      { ref: 'compost', text: 'Buy compost bags #soil' },
      { text: 'Return library books', completed: true }
    ]
  }
];

const JONAH: OutlineNode[] = [
  {
    text: 'Allotment notes',
    children: [{ text: 'Plant garlic' }, { text: 'Mulch delivery #soil' }]
  }
];

async function seedPerson(
  email: string,
  name: string,
  password: string,
  outline: OutlineNode[]
): Promise<void> {
  if ((await userByEmail(email)) !== null) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const id = randomUUID();
    await client.query(
      `insert into users (id, email, name, password_hash, confirmed) values ($1,$2,$3,$4,true)`,
      [id, email, name, await hashPassword(password)]
    );
    await buildOutline(client, id, outline, new Map());
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Puts the published seed outlines in place when their accounts are absent. */
export async function seed(): Promise<void> {
  await seedPerson('wren@pellwick.test', 'Wren Okafor', 'wren-branches-26', WREN);
  await seedPerson('jonah@pellwick.test', 'Jonah Reyes', 'jonah-branches-26', JONAH);
}
