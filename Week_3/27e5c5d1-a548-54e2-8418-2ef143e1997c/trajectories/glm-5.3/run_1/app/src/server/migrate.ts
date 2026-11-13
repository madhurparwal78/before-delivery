import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { hashPassword } from './ids.js';
import { SCHEMA_SQL, SEED_IDS, SEED_PEOPLE } from './schema.js';

interface SeedBoard {
  boardId: string;
  name: string;
  visibility: 'workspace' | 'private';
  workspaceId: string;
  members: { userId: string; role: 'observer' | 'member' | 'admin' }[];
  lists: {
    listId: string;
    name: string;
    cards: {
      cardId: string;
      title: string;
      labels?: string[];
      notes?: string;
      ownerUserId?: string;
      privateTo?: string[];
      checklist?: { itemId: string; text: string; done: boolean }[];
    }[];
  }[];
}

function haleBoard(): SeedBoard {
  const u = SEED_IDS.users;
  return {
    boardId: SEED_IDS.boards.weekly,
    name: 'Weekly care',
    visibility: 'workspace',
    workspaceId: SEED_IDS.workspaces.hale,
    members: [
      { userId: u.ruth, role: 'admin' },
      { userId: u.sam, role: 'member' },
      { userId: u.priya, role: 'member' },
      { userId: u.dolores, role: 'observer' },
    ],
    lists: [
      {
        listId: SEED_IDS.lists.inbox,
        name: 'Inbox',
        cards: [
          {
            cardId: SEED_IDS.cards.refill,
            title: 'Refill lisinopril',
            labels: ['Medication'],
            ownerUserId: u.ruth,
            notes: '10 mg once a day. Pharmacy closes at 6 pm on Saturdays.',
          },
          { cardId: SEED_IDS.cards.hearing, title: 'Call about hearing aid batteries', ownerUserId: u.sam },
          { cardId: SEED_IDS.cards.podiatry, title: 'Book podiatry follow-up', labels: ['Appointment'] },
        ],
      },
      {
        listId: SEED_IDS.lists.pharmacy,
        name: 'Pharmacy',
        cards: [
          { cardId: SEED_IDS.cards.eyeDrops, title: 'Pick up eye drops', labels: ['Medication'], ownerUserId: u.priya },
          { cardId: SEED_IDS.cards.organiser, title: 'Ask about a weekly pill organiser', labels: ['Medication'] },
          { cardId: SEED_IDS.cards.metformin, title: 'Move metformin to mail order', labels: ['Medication'], notes: 'Member ID is on the insurance card scan.' },
        ],
      },
      {
        listId: SEED_IDS.lists.appointments,
        name: 'Appointments',
        cards: [
          {
            cardId: SEED_IDS.cards.cardiology,
            title: 'Ride to cardiology on Thursday',
            labels: ['Appointment'],
            ownerUserId: u.sam,
            notes: 'Dr. Feld, second floor. Bring the medication list.',
          },
          {
            cardId: SEED_IDS.cards.memory,
            title: 'Memory clinic results',
            privateTo: [u.ruth, u.priya],
            notes: 'Discuss results with Mum before telling Sam.',
          },
          { cardId: SEED_IDS.cards.dental, title: 'Dental cleaning', labels: ['Appointment'] },
        ],
      },
      {
        listId: SEED_IDS.lists.aideVisits,
        name: 'Aide visits',
        cards: [
          {
            cardId: SEED_IDS.cards.tuesday,
            title: 'Tuesday visit',
            labels: ['Visit'],
            checklist: [
              { itemId: SEED_IDS.checklist.lunch, text: 'Lunch and fluids', done: false },
              { itemId: SEED_IDS.checklist.eveningPills, text: 'Evening pills set out', done: false },
              { itemId: SEED_IDS.checklist.walk, text: 'Short walk to the mailbox', done: false },
            ],
          },
          {
            cardId: SEED_IDS.cards.friday,
            title: 'Friday visit',
            labels: ['Visit'],
            checklist: [
              { itemId: SEED_IDS.checklist.linen, text: 'Change bed linen', done: false },
              { itemId: SEED_IDS.checklist.groceries, text: 'Groceries from the list', done: false },
            ],
          },
        ],
      },
      { listId: SEED_IDS.lists.waiting, name: 'Waiting on others', cards: [] },
    ],
  };
}

function moneyBoard(): SeedBoard {
  const u = SEED_IDS.users;
  return {
    boardId: SEED_IDS.boards.money,
    name: 'Money and house',
    visibility: 'private',
    workspaceId: SEED_IDS.workspaces.hale,
    members: [
      { userId: u.ruth, role: 'admin' },
      { userId: u.sam, role: 'member' },
      { userId: u.priya, role: 'member' },
    ],
    lists: [
      {
        listId: SEED_IDS.lists.bills,
        name: 'Bills',
        cards: [
          { cardId: SEED_IDS.cards.medicare, title: 'Pay Medicare Part B premium', labels: ['Bills'], ownerUserId: u.ruth },
          { cardId: SEED_IDS.cards.insurance, title: 'Renew home insurance', labels: ['Bills'] },
        ],
      },
      {
        listId: SEED_IDS.lists.house,
        name: 'House',
        cards: [
          { cardId: SEED_IDS.cards.railing, title: 'Fix the back step railing', ownerUserId: u.sam },
          { cardId: SEED_IDS.cards.estate, title: 'Talk to an estate agent', privateTo: [u.ruth, u.priya] },
        ],
      },
      {
        listId: SEED_IDS.lists.documents,
        name: 'Documents',
        cards: [
          { cardId: SEED_IDS.cards.scan, title: 'Insurance card scan', labels: ['Paperwork'], notes: 'Attach the front and back.' },
        ],
      },
    ],
  };
}

function ngBoard(): SeedBoard {
  return {
    boardId: SEED_IDS.boards.dad,
    name: "Dad's week",
    visibility: 'workspace',
    workspaceId: SEED_IDS.workspaces.ng,
    members: [{ userId: SEED_IDS.users.grace, role: 'admin' }],
    lists: [
      {
        listId: SEED_IDS.lists.todo,
        name: 'To do',
        cards: [{ cardId: SEED_IDS.cards.ito, title: "Call Dr. Ito's office" }],
      },
    ],
  };
}

async function applySchema(client: PoolClient): Promise<void> {
  await client.query(SCHEMA_SQL);
}

async function seedIfEmpty(pool: Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applySchema(client);
    const existing = await client.query('SELECT count(*)::int AS n FROM kinfold_workspaces');
    if ((existing.rows[0] as { n: number }).n > 0) {
      await client.query('COMMIT');
      return false;
    }
    for (const [index, person] of SEED_PEOPLE.entries()) {
      const passwordHash = await hashPassword(person.password);
      const userId =
        index === 0 ? SEED_IDS.users.ruth :
        index === 1 ? SEED_IDS.users.sam :
        index === 2 ? SEED_IDS.users.priya :
        index === 3 ? SEED_IDS.users.dolores :
        index === 4 ? SEED_IDS.users.theo :
        SEED_IDS.users.grace;
      await client.query(
        `INSERT INTO kinfold_users (user_id, display_name, email, email_lower, password_hash, phone, colour, initials)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id) DO NOTHING`,
        [userId, person.displayName, person.email, person.email.toLowerCase(), passwordHash, person.phone, person.colour, person.initials],
      );
    }
    await client.query(
      `INSERT INTO kinfold_workspaces (workspace_id, name, parent_name, time_zone) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [SEED_IDS.workspaces.hale, 'Hale family', 'Margaret Hale', 'America/Chicago'],
    );
    await client.query(
      `INSERT INTO kinfold_workspaces (workspace_id, name, parent_name, time_zone) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [SEED_IDS.workspaces.ng, 'Ng family', 'Walter Ng', 'America/Los_Angeles'],
    );
    const u = SEED_IDS.users;
    const haleMembers: { id: string; role: 'admin' | 'member' }[] = [
      { id: u.ruth, role: 'admin' },
      { id: u.sam, role: 'member' },
      { id: u.priya, role: 'member' },
      { id: u.dolores, role: 'member' },
      { id: u.theo, role: 'member' },
    ];
    for (const m of haleMembers) {
      await client.query(
        `INSERT INTO kinfold_workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [SEED_IDS.workspaces.hale, m.id, m.role],
      );
    }
    await client.query(
      `INSERT INTO kinfold_workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'admin') ON CONFLICT DO NOTHING`,
      [SEED_IDS.workspaces.ng, u.grace],
    );
    const boards = [haleBoard(), moneyBoard(), ngBoard()];
    for (const board of boards) {
      await client.query(
        `INSERT INTO kinfold_boards (board_id, workspace_id, name, visibility) VALUES ($1,$2,$3,$4) ON CONFLICT (board_id) DO NOTHING`,
        [board.boardId, board.workspaceId, board.name, board.visibility],
      );
      for (const member of board.members) {
        await client.query(
          `INSERT INTO kinfold_board_members (board_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [board.boardId, member.userId, member.role],
        );
      }
      for (const [listIndex, list] of board.lists.entries()) {
        await client.query(
          `INSERT INTO kinfold_lists (list_id, board_id, name, position) VALUES ($1,$2,$3,$4) ON CONFLICT (list_id) DO NOTHING`,
          [list.listId, board.boardId, list.name, listIndex + 1],
        );
        for (const [cardIndex, card] of list.cards.entries()) {
          await client.query(
            `INSERT INTO kinfold_cards
             (card_id, board_id, list_id, title, notes, rank, labels, status, version, owner_user_id, last_versioned_by, last_versioned_change)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'open',1,$8,$9,'created') ON CONFLICT (card_id) DO NOTHING`,
            [
              card.cardId,
              board.boardId,
              list.listId,
              card.title,
              card.notes ?? '',
              cardIndex + 1,
              card.labels ?? [],
              card.ownerUserId ?? null,
              board.members[0]?.userId ?? u.ruth,
            ],
          );
          for (const [checkIndex, item] of (card.checklist ?? []).entries()) {
            await client.query(
              `INSERT INTO kinfold_checklist_items (item_id, card_id, text, done, position) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (item_id) DO NOTHING`,
              [item.itemId, card.cardId, item.text, item.done, checkIndex + 1],
            );
          }
          for (const userId of card.privateTo ?? []) {
            await client.query(
              `INSERT INTO kinfold_card_private_members (card_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
              [card.cardId, userId],
            );
          }
        }
      }
    }
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Apply schema and seed on every serve start; idempotent and safe under concurrent starts. */
export async function migrateAndSeed(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // A session-level advisory lock so two workers booting together serialise their migration.
    await client.query('SELECT pg_advisory_lock(727612345)');
    await pool.query(SCHEMA_SQL);
    await seedIfEmpty(pool);
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(727612345)');
    } catch {
      // connection gone; the lock dies with it
    }
    client.release();
  }
}
