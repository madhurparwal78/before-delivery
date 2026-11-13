import { transaction, type Tx } from './pool';
import { SCHEMA_SQL } from './schema';
import { hashPassword, newId } from '../lib/crypto';
import type { Label, MoverColour, Visibility, WorkspaceRole } from '../../shared/types';

interface SeedPerson {
  displayName: string;
  email: string;
  password: string;
  phone: string;
  colour: MoverColour;
  initials: string;
}

const PEOPLE: SeedPerson[] = [
  {
    displayName: 'Ruth Hale',
    email: 'ruth@kinfold.test',
    password: 'Kinfold-ruth-2026',
    phone: '+1 312 555 0140',
    colour: 'sage',
    initials: 'RH',
  },
  {
    displayName: 'Sam Hale',
    email: 'sam@kinfold.test',
    password: 'Kinfold-sam-2026',
    phone: '+1 312 555 0141',
    colour: 'clay',
    initials: 'SH',
  },
  {
    displayName: 'Priya Hale',
    email: 'priya@kinfold.test',
    password: 'Kinfold-priya-2026',
    phone: '+1 312 555 0142',
    colour: 'plum',
    initials: 'PH',
  },
  {
    displayName: 'Dolores Vance',
    email: 'dolores@kinfold.test',
    password: 'Kinfold-dolores-2026',
    phone: '+1 312 555 0143',
    colour: 'ochre',
    initials: 'DV',
  },
  {
    displayName: 'Theo Marsh',
    email: 'theo@kinfold.test',
    password: 'Kinfold-theo-2026',
    phone: '+1 312 555 0144',
    colour: 'slate',
    initials: 'TM',
  },
  {
    displayName: 'Grace Ng',
    email: 'grace@kinfold.test',
    password: 'Kinfold-grace-2026',
    phone: '+1 206 555 0150',
    colour: 'rose',
    initials: 'GN',
  },
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

interface SeedBoard {
  name: string;
  visibility: Visibility;
  members: Record<string, 'observer' | 'member' | 'admin'>;
  lists: SeedList[];
}

interface SeedWorkspace {
  name: string;
  parentName: string;
  timeZone: string;
  members: { email: string; role: WorkspaceRole }[];
  boards: SeedBoard[];
}

const WORKSPACES: SeedWorkspace[] = [
  {
    name: 'Hale family',
    parentName: 'Margaret Hale',
    timeZone: 'America/Chicago',
    members: [
      { email: 'ruth@kinfold.test', role: 'admin' },
      { email: 'sam@kinfold.test', role: 'member' },
      { email: 'priya@kinfold.test', role: 'member' },
      { email: 'dolores@kinfold.test', role: 'member' },
      { email: 'theo@kinfold.test', role: 'member' },
    ],
    boards: [
      {
        name: 'Weekly care',
        visibility: 'workspace',
        members: {
          'ruth@kinfold.test': 'admin',
          'sam@kinfold.test': 'member',
          'priya@kinfold.test': 'member',
          'dolores@kinfold.test': 'observer',
        },
        lists: [
          {
            name: 'Inbox',
            cards: [
              {
                title: 'Refill lisinopril',
                labels: ['Medication'],
                owner: 'ruth@kinfold.test',
                notes: '10 mg once a day. Pharmacy closes at 6 pm on Saturdays.',
              },
              { title: 'Call about hearing aid batteries', owner: 'sam@kinfold.test' },
              { title: 'Book podiatry follow-up', labels: ['Appointment'] },
            ],
          },
          {
            name: 'Pharmacy',
            cards: [
              { title: 'Pick up eye drops', labels: ['Medication'], owner: 'priya@kinfold.test' },
              { title: 'Ask about a weekly pill organiser', labels: ['Medication'] },
              {
                title: 'Move metformin to mail order',
                labels: ['Medication'],
                notes: 'Member ID is on the insurance card scan.',
              },
            ],
          },
          {
            name: 'Appointments',
            cards: [
              {
                title: 'Ride to cardiology on Thursday',
                labels: ['Appointment'],
                owner: 'sam@kinfold.test',
                notes: 'Dr. Feld, second floor. Bring the medication list.',
              },
              {
                title: 'Memory clinic results',
                privateTo: ['ruth@kinfold.test', 'priya@kinfold.test'],
                notes: 'Discuss results with Mum before telling Sam.',
              },
              { title: 'Dental cleaning', labels: ['Appointment'] },
            ],
          },
          {
            name: 'Aide visits',
            cards: [
              {
                title: 'Tuesday visit',
                labels: ['Visit'],
                checklist: ['Lunch and fluids', 'Evening pills set out', 'Short walk to the mailbox'],
              },
              {
                title: 'Friday visit',
                labels: ['Visit'],
                checklist: ['Change bed linen', 'Groceries from the list'],
              },
            ],
          },
          { name: 'Waiting on others', cards: [] },
        ],
      },
      {
        name: 'Money and house',
        visibility: 'private',
        members: {
          'ruth@kinfold.test': 'admin',
          'sam@kinfold.test': 'member',
          'priya@kinfold.test': 'member',
        },
        lists: [
          {
            name: 'Bills',
            cards: [
              { title: 'Pay Medicare Part B premium', labels: ['Bills'], owner: 'ruth@kinfold.test' },
              { title: 'Renew home insurance', labels: ['Bills'] },
            ],
          },
          {
            name: 'House',
            cards: [
              { title: 'Fix the back step railing', owner: 'sam@kinfold.test' },
              { title: 'Talk to an estate agent', privateTo: ['ruth@kinfold.test', 'priya@kinfold.test'] },
            ],
          },
          {
            name: 'Documents',
            cards: [{ title: 'Insurance card scan', labels: ['Paperwork'], notes: 'Attach the front and back.' }],
          },
        ],
      },
    ],
  },
  {
    name: 'Ng family',
    parentName: 'Walter Ng',
    timeZone: 'America/Los_Angeles',
    members: [{ email: 'grace@kinfold.test', role: 'admin' }],
    boards: [
      {
        name: "Dad's week",
        visibility: 'workspace',
        members: { 'grace@kinfold.test': 'admin' },
        lists: [{ name: 'To do', cards: [{ title: "Call Dr. Ito's office" }] }],
      },
    ],
  },
];

async function seedInto(tx: Tx): Promise<void> {
  const userIds = new Map<string, string>();
  for (const person of PEOPLE) {
    const id = newId();
    userIds.set(person.email, id);
    await tx.query(
      `insert into users (id, display_name, email, password_hash, phone, colour, initials)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        person.displayName,
        person.email,
        await hashPassword(person.password),
        person.phone,
        person.colour,
        person.initials,
      ],
    );
  }

  for (const workspace of WORKSPACES) {
    const workspaceId = newId();
    await tx.query(`insert into workspaces (id, name, parent_name, time_zone) values ($1, $2, $3, $4)`, [
      workspaceId,
      workspace.name,
      workspace.parentName,
      workspace.timeZone,
    ]);
    for (const member of workspace.members) {
      await tx.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)`, [
        workspaceId,
        userIds.get(member.email),
        member.role,
      ]);
    }
    for (const board of workspace.boards) {
      const boardId = newId();
      await tx.query(`insert into boards (id, workspace_id, name, visibility) values ($1, $2, $3, $4)`, [
        boardId,
        workspaceId,
        board.name,
        board.visibility,
      ]);
      for (const [email, state] of Object.entries(board.members)) {
        await tx.query(`insert into board_members (board_id, user_id, state) values ($1, $2, $3)`, [
          boardId,
          userIds.get(email),
          state,
        ]);
      }
      let listPosition = 0;
      for (const list of board.lists) {
        listPosition += 1;
        const listId = newId();
        await tx.query(`insert into lists (id, board_id, name, position) values ($1, $2, $3, $4)`, [
          listId,
          boardId,
          list.name,
          listPosition,
        ]);
        let cardPosition = 0;
        for (const card of list.cards) {
          cardPosition += 1;
          const cardId = newId();
          await tx.query(
            `insert into cards (id, board_id, list_id, title, notes, labels, owner_user_id, position)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              cardId,
              boardId,
              listId,
              card.title,
              card.notes ?? '',
              card.labels ?? [],
              card.owner ? userIds.get(card.owner) : null,
              cardPosition,
            ],
          );
          for (const email of card.privateTo ?? []) {
            await tx.query(`insert into card_private_members (card_id, user_id) values ($1, $2)`, [
              cardId,
              userIds.get(email),
            ]);
          }
          let itemPosition = 0;
          for (const text of card.checklist ?? []) {
            itemPosition += 1;
            await tx.query(`insert into checklist_items (id, card_id, text, position) values ($1, $2, $3, $4)`, [
              newId(),
              cardId,
              text,
              itemPosition,
            ]);
          }
        }
      }
    }
  }
}

export async function applySchemaAndSeed(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query(`select pg_advisory_xact_lock(hashtextextended('kinfold-schema', 0))`);
    await tx.query(SCHEMA_SQL);
    const existing = await tx.queryOne<{ count: string }>(`select count(*)::text as count from workspaces`);
    if (existing && existing.count === '0') {
      await seedInto(tx);
    }
  });
}
