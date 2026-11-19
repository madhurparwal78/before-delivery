import type { Pool } from 'pg';
import { loadConfig, todayFor, type Config } from './config.js';
import { applySchema } from './store.js';
import { hashPassword } from './auth.js';
import { insertBullet, newId } from './store.js';
import type { BulletRow } from '../domain/types.js';
import { extractMentions, extractTags, rewriteDates } from '../domain/text.js';

const config: Config = loadConfig();
const now = Date.now();
const today = todayFor(config, new Date(now));

interface SeedBullet {
  text: string;
  completed?: boolean;
  collapsed?: boolean;
  children?: SeedBullet[];
  copyOf?: string;
}

async function seedAccount(
  pool: Pool,
  email: string,
  name: string,
  password: string,
): Promise<string> {
  const existing = await pool.query('select id from accounts where email = $1', [email]);
  if (existing.rows.length > 0) return String(existing.rows[0]?.id);
  const id = newId();
  await pool.query(
    `insert into accounts (id, email, name, password_hash, confirmed, hide_completed, created_at)
     values ($1,$2,$3,$4,true,false,$5)`,
    [id, email, name, hashPassword(password), Date.now()],
  );
  return id;
}

function bulletRow(
  id: string,
  ownerId: string,
  parentId: string | null,
  position: number,
  text: string,
  extra: { completed?: boolean; collapsed?: boolean; originalId?: string | null } = {},
): BulletRow {
  const { canonicalText, date } = rewriteDates(text, today);
  return {
    id,
    ownerId,
    originalId: extra.originalId ?? null,
    parentId,
    position,
    text: canonicalText,
    completed: extra.completed ?? false,
    collapsed: extra.collapsed ?? false,
    date,
    tags: extractTags(canonicalText),
    mentions: extractMentions(canonicalText),
    revision: 1,
    trashedAt: null,
    purged: false,
    createdAt: Date.now(),
  };
}

async function insertTree(
  pool: Pool,
  ownerId: string,
  parentId: string | null,
  items: SeedBullet[],
  startIndex: number,
): Promise<void> {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as SeedBullet;
    const id = newId();
    await insertBullet(
      pool,
      bulletRow(id, ownerId, parentId, startIndex + i, item.text, {
        completed: item.completed,
        collapsed: item.collapsed,
      }),
    );
    if (item.children && item.children.length > 0) {
      await insertTree(pool, ownerId, id, item.children, 0);
    }
    if (item.copyOf) {
      const original = await pool.query('select id from bullets where id = $1', [item.copyOf]);
      const originalId = original.rows[0]?.id;
      if (originalId) {
        await insertBullet(
          pool,
          bulletRow(id, ownerId, parentId, startIndex + i, '', { originalId }),
        );
      }
    }
  }
}

export async function seed(pool: Pool): Promise<void> {
  const wrenExists = await pool.query(
    'select id from accounts where email = $1',
    ['wren@pellwick.test'],
  );
  if (wrenExists.rows.length > 0) return;
  const wren = await seedAccount(pool, 'wren@pellwick.test', 'Wren Okafor', 'wren-branches-26');
  const jonah = await seedAccount(pool, 'jonah@pellwick.test', 'Jonah Reyes', 'jonah-branches-26');

  const gardenChildren: SeedBullet[] = [
    {
      text: 'Site prep #soil',
      children: [
        { text: 'Clear the lot !(2026-11-07)', completed: true },
        { text: 'Test soil pH #soil @Mira' },
      ],
    },
    {
      text: 'Planting plan',
      children: [
        { text: 'Tomatoes #seedlings' },
        { text: 'Herb spiral @Jonah !(2026-11-12)' },
        { text: 'Native wildflowers #seedlings', completed: true },
      ],
    },
    {
      text: 'Volunteers',
      children: [
        { text: 'Saturday crew @Mira' },
        {
          text: 'Tool library sign-out',
          collapsed: true,
          children: [{ text: 'Borrow the wheelbarrow !(2026-11-08)' }],
        },
      ],
    },
  ];
  const wrenTop: SeedBullet[] = [
    { text: 'Community garden build', children: gardenChildren },
    {
      text: 'Weekly errands',
      children: [
        { text: 'Buy compost bags #soil' },
        { text: 'Return library books', completed: true },
      ],
    },
  ];
  await insertTree(pool, wren, null, wrenTop, 0);

  const jonahTop: SeedBullet[] = [
    {
      text: 'Allotment notes',
      children: [{ text: 'Plant garlic' }, { text: 'Mulch delivery #soil' }],
    },
  ];
  await insertTree(pool, jonah, null, jonahTop, 0);

  await pool.query(
    `insert into outline_seq (owner_id, seq) values ($1, 0), ($2, 0)
     on conflict (owner_id) do nothing`,
    [wren, jonah],
  );

  // place the copy of "Buy compost bags #soil" under Site prep #soil
  const originalRow = await pool.query(
    `select b.id from bullets b join accounts a on a.id = b.owner_id
     where a.email = $1 and b.text = 'Buy compost bags #soil' and b.original_id is null`,
    ['wren@pellwick.test'],
  );
  const originalId = originalRow.rows[0]?.id;
  if (originalId) {
    const sitePrepRow = await pool.query(
      `select b.id, (select count(*) from bullets c where c.parent_id = b.id) as n
       from bullets b join accounts a on a.id = b.owner_id
       where a.email = $1 and b.text = 'Site prep #soil'`,
      ['wren@pellwick.test'],
    );
    const sitePrep = sitePrepRow.rows[0];
    if (sitePrep) {
      await insertBullet(
        pool,
        bulletRow(newId(), wren, String(sitePrep.id), Number(sitePrep.n), '', {
          originalId: String(originalId),
        }),
      );
    }
  }
}

export async function initSchema(pool: Pool): Promise<void> {
  await applySchema(pool);
  await seed(pool);
}

export async function bootstrap(): Promise<{ pool: Pool; config: Config }> {
  const pg = await import('pg');
  const PgPool = pg.Pool ?? (pg.default as unknown as { Pool: typeof pg.Pool }).Pool;
  const pool = new PgPool({ connectionString: config.databaseUrl, max: 10 });
  let attempt = 0;
  for (;;) {
    try {
      await pool.query('select 1');
      break;
    } catch (err) {
      attempt += 1;
      if (attempt > 60) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await initSchema(pool);
  return { pool, config };
}
