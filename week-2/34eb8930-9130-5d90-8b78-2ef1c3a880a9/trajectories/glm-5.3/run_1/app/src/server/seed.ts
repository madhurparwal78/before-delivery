import type { Pool, PoolClient } from 'pg';
import { hashPassword, newId } from './config.js';
import type { BlockStyle, DomainRole } from '../domain/types.js';
export type { BlockStyle };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  person_id text PRIMARY KEY,
  display_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  colour text NOT NULL,
  is_consultant boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  title text NOT NULL,
  client text NOT NULL,
  owner_id text NOT NULL REFERENCES people(person_id),
  revision integer NOT NULL DEFAULT 0,
  saved_revision integer NOT NULL DEFAULT 0,
  save_failed boolean NOT NULL DEFAULT false,
  object_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS revisions (
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  author_id text NOT NULL,
  mode text NOT NULL,
  delta jsonb NOT NULL,
  PRIMARY KEY (document_id, revision)
);
CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  role text NOT NULL,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, person_id)
);
CREATE TABLE IF NOT EXISTS modes (
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  mode text NOT NULL,
  PRIMARY KEY (document_id, person_id)
);
CREATE TABLE IF NOT EXISTS recent (
  person_id text NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, document_id)
);
CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  kind text NOT NULL,
  document_id text NOT NULL,
  document_title text NOT NULL,
  actor_id text NOT NULL,
  role text,
  comment_id text,
  text text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author_id text NOT NULL,
  body text NOT NULL,
  mentions jsonb NOT NULL DEFAULT '[]',
  anchor jsonb,
  content_deleted boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  parent_id text
);
CREATE TABLE IF NOT EXISTS comment_replies (
  id text PRIMARY KEY,
  comment_id text NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  author_id text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

export type PersonRow = {
  person_id: string;
  display_name: string;
  email: string;
  colour: string;
  is_consultant: boolean;
};

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
}

export async function seedPeople(pool: Pool): Promise<PersonRow[]> {
  const password = hashPassword('quillmere-demo-2026');
  const people: { id: string; name: string; email: string; colour: string; consultant: boolean }[] = [
    { id: 'p-ines-calloway', name: 'Ines Calloway', email: 'ines@quillmere.test', colour: '#2f5d50', consultant: true },
    { id: 'p-tomas-reyes', name: 'Tomas Reyes', email: 'tomas@riverbend-literacy.test', colour: '#6d4a6e', consultant: false },
    { id: 'p-dana-whitfield', name: 'Dana Whitfield', email: 'dana@riverbend-literacy.test', colour: '#4f6382', consultant: false },
    { id: 'p-priya-nandakumar', name: 'Priya Nandakumar', email: 'priya@peer-review.test', colour: '#a4702c', consultant: false },
    { id: 'p-lena-ostrowski', name: 'Lena Ostrowski', email: 'lena@harborstreet-pantry.test', colour: '#9a4f2c', consultant: false },
    { id: 'p-sam-adeyemi', name: 'Sam Adeyemi', email: 'sam@peer-review.test', colour: '#3f4a8c', consultant: false },
    { id: 'p-jordan-pike', name: 'Jordan Pike', email: 'jordan@peer-review.test', colour: '#8c3f7a', consultant: false },
  ];
  for (const p of people) {
    await pool.query(
      `INSERT INTO people (person_id, display_name, email, password_hash, colour, is_consultant)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (person_id) DO NOTHING`,
      [p.id, p.name, p.email, password, p.colour, p.consultant],
    );
  }
  return people.map((p) => ({ person_id: p.id, display_name: p.name, email: p.email, colour: p.colour, is_consultant: p.consultant }));
}

type SeedBlock = { style: BlockStyle; text: string };

export type SeedDoc = {
  id: string;
  title: string;
  client: string;
  blocks: SeedBlock[];
  shares: { personId: string; role: DomainRole }[];
};

const readingNightsBlocks: SeedBlock[] = [
  { style: 'title', text: 'Family Reading Nights' },
  { style: 'heading1', text: 'Statement of Need' },
  { style: 'paragraph', text: 'In the Riverbend school district, 41 percent of third graders read below grade level. Families tell us they want to read with their children but rarely have books at home or a quiet evening space.' },
  { style: 'heading1', text: 'Program Design' },
  { style: 'paragraph', text: 'Each month we host four Family Reading Nights at two branch libraries. Every family leaves with two new books and a short guide for reading aloud in English and Spanish.' },
  { style: 'heading1', text: 'Evaluation Plan' },
  { style: 'paragraph', text: 'We will track attendance at every session and survey families in October and May.' },
  { style: 'heading1', text: 'Budget Justification' },
  { style: 'paragraph', text: 'Books for 240 families cost $9,600 for the year. Facilitator stipends total $7,200.' },
];

export const SEED_DOCS: SeedDoc[] = [
  {
    id: 'riverbend-reading-nights',
    title: 'Family Reading Nights — Foundation Proposal',
    client: 'Riverbend Literacy Project',
    blocks: readingNightsBlocks,
    shares: [
      { personId: 'p-tomas-reyes', role: 'editor' },
      { personId: 'p-dana-whitfield', role: 'viewer' },
      { personId: 'p-priya-nandakumar', role: 'commenter' },
    ],
  },
  {
    id: 'riverbend-budget-fy27',
    title: 'Budget Justification FY2027',
    client: 'Riverbend Literacy Project',
    blocks: [
      { style: 'title', text: 'Budget Justification FY2027' },
      { style: 'heading1', text: 'Personnel' },
      { style: 'paragraph', text: 'A part-time program coordinator at 20 hours a week costs $26,000 including benefits.' },
      { style: 'heading1', text: 'Supplies' },
      { style: 'paragraph', text: 'Books and reading guides cost $9,600.' },
      { style: 'heading2', text: 'Notes for the finance office' },
      { style: 'paragraph', text: 'Coordinator hours match the program calendar. Book costs match the vendor quote.' },
    ],
    shares: [
      { personId: 'p-tomas-reyes', role: 'editor' },
      { personId: 'p-dana-whitfield', role: 'viewer' },
    ],
  },
  {
    id: 'harbor-cold-storage',
    title: 'Cold Storage Expansion — Federal Application',
    client: 'Harbor Street Food Pantry',
    blocks: [
      { style: 'title', text: 'Cold Storage Expansion' },
      { style: 'heading1', text: 'Project Summary' },
      { style: 'paragraph', text: 'Harbor Street Food Pantry requests $148,000 to install a walk-in cooler and freezer so we can accept fresh produce donations year round.' },
      { style: 'heading1', text: 'Budget Justification' },
      { style: 'paragraph', text: 'Equipment and installation total $121,500. Electrical upgrades total $26,500.' },
    ],
    shares: [
      { personId: 'p-lena-ostrowski', role: 'editor' },
      { personId: 'p-sam-adeyemi', role: 'commenter' },
    ],
  },
  {
    id: 'harbor-volunteer-renewal',
    title: 'Volunteer Program Renewal',
    client: 'Harbor Street Food Pantry',
    blocks: [
      { style: 'title', text: 'Volunteer Program Renewal' },
      { style: 'paragraph', text: 'Draft outline to follow.' },
    ],
    shares: [],
  },
];

/** Builds the revision-1 delta for a seed proposal: the seeded blocks as one insert plus per-line styles. */
export function seedDeltaFor(doc: SeedDoc): { text: string; delta: unknown } {
  const text = doc.blocks.map((b) => b.text).join('\n');
  const styleOps: { style: BlockStyle; at: number }[] = [];
  let at = 0;
  for (const block of doc.blocks) {
    styleOps.push({ style: block.style, at });
    at += block.text.length + 1;
  }
  const delta = {
    revision: 1,
    authorId: 'p-ines-calloway',
    mode: 'editing',
    textOps: [{ ins: text, at: 0 }, ...styleOps],
    suggestionOps: [],
  };
  return { text, delta };
}

export async function seedDocuments(pool: Pool | PoolClient): Promise<void> {
  for (const doc of SEED_DOCS) {
    const exists = await pool.query(`SELECT id FROM documents WHERE id = $1`, [doc.id]);
    if (exists.rowCount && exists.rowCount > 0) continue;
    const { delta } = seedDeltaFor(doc);
    await pool.query(
      `INSERT INTO documents (id, title, client, owner_id, revision, saved_revision, object_required)
       VALUES ($1,$2,$3,$4,1,0,true)`,
      [doc.id, doc.title, doc.client, 'p-ines-calloway'],
    );
    await pool.query(
      `INSERT INTO revisions (document_id, revision, author_id, mode, delta) VALUES ($1,1,$2,'editing',$3)`,
      [doc.id, 'p-ines-calloway', JSON.stringify(delta)],
    );
    for (const share of doc.shares) {
      await pool.query(
        `INSERT INTO shares (id, document_id, person_id, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [newId(), doc.id, share.personId, share.role],
      );
    }
  }
  // the seeded open comment on the reading nights proposal, anchored on "survey families in October and May"
  const cm = await pool.query(`SELECT id FROM comments WHERE id = 'cm-seed-1'`);
  if (!cm.rowCount) {
    await pool.query(
      `INSERT INTO comments (id, document_id, author_id, body, mentions, anchor, content_deleted, status, created_at)
       VALUES ('cm-seed-1', 'riverbend-reading-nights', 'p-priya-nandakumar', $1, '[]', $2, false, 'open', now())`,
      [
        'Could the survey also ask how many books each family already has at home?',
        JSON.stringify({ at: 484, length: 34 }),
      ],
    );
  }
}
