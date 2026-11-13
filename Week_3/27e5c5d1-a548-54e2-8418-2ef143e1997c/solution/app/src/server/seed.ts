import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './passwords.ts';
import { initialsOf } from './people.ts';
import type { Colour, Label, Role } from '../shared/types.ts';

interface SeedPerson {
  name: string;
  email: string;
  password: string;
  phone: string;
  colour: Colour;
}

const PEOPLE: SeedPerson[] = [
  { name: 'Ruth Hale', email: 'ruth@kinfold.test', password: 'Kinfold-ruth-2026', phone: '+1 312 555 0140', colour: 'sage' },
  { name: 'Sam Hale', email: 'sam@kinfold.test', password: 'Kinfold-sam-2026', phone: '+1 312 555 0141', colour: 'clay' },
  { name: 'Priya Hale', email: 'priya@kinfold.test', password: 'Kinfold-priya-2026', phone: '+1 312 555 0142', colour: 'plum' },
  { name: 'Dolores Vance', email: 'dolores@kinfold.test', password: 'Kinfold-dolores-2026', phone: '+1 312 555 0143', colour: 'ochre' },
  { name: 'Theo Marsh', email: 'theo@kinfold.test', password: 'Kinfold-theo-2026', phone: '+1 312 555 0144', colour: 'slate' },
  { name: 'Grace Ng', email: 'grace@kinfold.test', password: 'Kinfold-grace-2026', phone: '+1 206 555 0150', colour: 'rose' },
];

interface SeedCard {
  title: string;
  labels?: Label[];
  owner?: string;
  notes?: string;
  privateTo?: string[];
  checklist?: string[];
}

interface SeedList {
  name: string;
  cards: SeedCard[];
}

const WEEKLY_CARE: SeedList[] = [
  {
    name: 'Inbox',
    cards: [
      { title: 'Refill lisinopril', labels: ['Medication'], owner: 'Ruth Hale', notes: '10 mg once a day. Pharmacy closes at 6 pm on Saturdays.' },
      { title: 'Call about hearing aid batteries', owner: 'Sam Hale' },
      { title: 'Book podiatry follow-up', labels: ['Appointment'] },
    ],
  },
  {
    name: 'Pharmacy',
    cards: [
      { title: 'Pick up eye drops', labels: ['Medication'], owner: 'Priya Hale' },
      { title: 'Ask about a weekly pill organiser', labels: ['Medication'] },
      { title: 'Move metformin to mail order', labels: ['Medication'], notes: 'Member ID is on the insurance card scan.' },
    ],
  },
  {
    name: 'Appointments',
    cards: [
      { title: 'Ride to cardiology on Thursday', labels: ['Appointment'], owner: 'Sam Hale', notes: 'Dr. Feld, second floor. Bring the medication list.' },
      { title: 'Memory clinic results', privateTo: ['Ruth Hale', 'Priya Hale'], notes: 'Discuss results with Mum before telling Sam.' },
      { title: 'Dental cleaning', labels: ['Appointment'] },
    ],
  },
  {
    name: 'Aide visits',
    cards: [
      { title: 'Tuesday visit', labels: ['Visit'], checklist: ['Lunch and fluids', 'Evening pills set out', 'Short walk to the mailbox'] },
      { title: 'Friday visit', labels: ['Visit'], checklist: ['Change bed linen', 'Groceries from the list'] },
    ],
  },
  { name: 'Waiting on others', cards: [] },
];

const MONEY_AND_HOUSE: SeedList[] = [
  {
    name: 'Bills',
    cards: [
      { title: 'Pay Medicare Part B premium', labels: ['Bills'], owner: 'Ruth Hale' },
      { title: 'Renew home insurance', labels: ['Bills'] },
    ],
  },
  {
    name: 'House',
    cards: [
      { title: 'Fix the back step railing', owner: 'Sam Hale' },
      { title: 'Talk to an estate agent', privateTo: ['Ruth Hale', 'Priya Hale'] },
    ],
  },
  { name: 'Documents', cards: [{ title: 'Insurance card scan', labels: ['Paperwork'], notes: 'Attach the front and back.' }] },
];

/** Seeds only a database with no workspaces; the caller holds the schema lock, so concurrent starts agree. */
export async function seed(client: pg.PoolClient): Promise<void> {
  const existing = await client.query('SELECT 1 FROM workspaces LIMIT 1');
  if (existing.rowCount) return;
  await client.query('BEGIN');
  try {
    const ids = new Map<string, string>();
    for (const person of PEOPLE) {
      const id = randomUUID();
      ids.set(person.name, id);
      await client.query(
        'INSERT INTO users (id, email, display_name, phone, password_hash, colour, initials) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, person.email, person.name, person.phone, await hashPassword(person.password), person.colour, initialsOf(person.name)],
      );
    }
    const person = (name: string): string => ids.get(name) as string;

    const hale = randomUUID();
    await client.query('INSERT INTO workspaces (id, name, parent_name, time_zone, last_colour) VALUES ($1,$2,$3,$4,$5)', [
      hale, 'Hale family', 'Margaret Hale', 'America/Chicago', 'slate',
    ]);
    const haleMembers: [string, 'admin' | 'member'][] = [
      ['Ruth Hale', 'admin'], ['Sam Hale', 'member'], ['Priya Hale', 'member'], ['Dolores Vance', 'member'], ['Theo Marsh', 'member'],
    ];
    for (const [name, role] of haleMembers) {
      await client.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)', [hale, person(name), role]);
    }

    const ng = randomUUID();
    await client.query('INSERT INTO workspaces (id, name, parent_name, time_zone, last_colour) VALUES ($1,$2,$3,$4,$5)', [
      ng, 'Ng family', 'Walter Ng', 'America/Los_Angeles', 'rose',
    ]);
    await client.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)', [ng, person('Grace Ng'), 'admin']);

    const board = async (
      workspaceId: string,
      name: string,
      visibility: 'workspace' | 'private',
      members: [string, Role][],
      lists: SeedList[],
    ): Promise<void> => {
      const boardId = randomUUID();
      await client.query('INSERT INTO boards (id, workspace_id, name, visibility) VALUES ($1,$2,$3,$4)', [boardId, workspaceId, name, visibility]);
      for (const [who, role] of members) {
        await client.query('INSERT INTO board_members (board_id, user_id, role) VALUES ($1,$2,$3)', [boardId, person(who), role]);
      }
      for (const [index, list] of lists.entries()) {
        const listId = randomUUID();
        await client.query('INSERT INTO lists (id, board_id, name, position) VALUES ($1,$2,$3,$4)', [listId, boardId, list.name, index + 1]);
        for (const [rank, card] of list.cards.entries()) {
          const cardId = randomUUID();
          await client.query(
            'INSERT INTO cards (id, board_id, list_id, title, notes, labels, owner_user_id, rank) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [cardId, boardId, listId, card.title, card.notes ?? '', card.labels ?? [], card.owner ? person(card.owner) : null, rank + 1],
          );
          for (const who of card.privateTo ?? []) {
            await client.query('INSERT INTO card_private_members (card_id, user_id) VALUES ($1,$2)', [cardId, person(who)]);
          }
          for (const text of card.checklist ?? []) {
            await client.query('INSERT INTO checklist_items (card_id, text) VALUES ($1,$2)', [cardId, text]);
          }
        }
      }
    };

    await board(hale, 'Weekly care', 'workspace',
      [['Ruth Hale', 'admin'], ['Sam Hale', 'member'], ['Priya Hale', 'member'], ['Dolores Vance', 'observer']], WEEKLY_CARE);
    await board(hale, 'Money and house', 'private',
      [['Ruth Hale', 'admin'], ['Sam Hale', 'member'], ['Priya Hale', 'member']], MONEY_AND_HOUSE);
    await board(ng, "Dad's week", 'workspace', [['Grace Ng', 'admin']],
      [{ name: 'To do', cards: [{ title: "Call Dr. Ito's office" }] }]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
