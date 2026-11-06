import { AUTHOR_COLOURS, type BlockStyle, type Role } from '../shared/types.js';
import { blocksOf, type DocState } from '../shared/doc.js';
import { query } from './db.js';
import { loadedDocument, seedBodies } from './livedoc.js';
import { hashPassword } from './sessions.js';
import { StorageError, objectExists, putObject } from './storage.js';

const PASSWORD = 'quillmere-demo-2026';

interface SeedPerson {
  id: string;
  displayName: string;
  email: string;
  colour: string;
  isConsultant: boolean;
}

const PEOPLE: SeedPerson[] = [
  { id: 'ines-calloway', displayName: 'Ines Calloway', email: 'ines@quillmere.test', colour: AUTHOR_COLOURS.spruce, isConsultant: true },
  { id: 'tomas-reyes', displayName: 'Tomas Reyes', email: 'tomas@riverbend-literacy.test', colour: AUTHOR_COLOURS.plum, isConsultant: false },
  { id: 'dana-whitfield', displayName: 'Dana Whitfield', email: 'dana@riverbend-literacy.test', colour: AUTHOR_COLOURS.slate, isConsultant: false },
  { id: 'priya-nandakumar', displayName: 'Priya Nandakumar', email: 'priya@peer-review.test', colour: AUTHOR_COLOURS.ochre, isConsultant: false },
  { id: 'lena-ostrowski', displayName: 'Lena Ostrowski', email: 'lena@harborstreet-pantry.test', colour: AUTHOR_COLOURS.rust, isConsultant: false },
  { id: 'sam-adeyemi', displayName: 'Sam Adeyemi', email: 'sam@peer-review.test', colour: AUTHOR_COLOURS.indigo, isConsultant: false },
  { id: 'jordan-pike', displayName: 'Jordan Pike', email: 'jordan@peer-review.test', colour: AUTHOR_COLOURS.magenta, isConsultant: false },
];

interface SeedDocument {
  id: string;
  title: string;
  client: string;
  blocks: [BlockStyle, string][];
  shares: { id: string; personId: string; role: Role }[];
}

const DOCUMENTS: SeedDocument[] = [
  {
    id: 'riverbend-reading-nights',
    title: 'Family Reading Nights — Foundation Proposal',
    client: 'Riverbend Literacy Project',
    blocks: [
      ['title', 'Family Reading Nights'],
      ['heading1', 'Statement of Need'],
      [
        'paragraph',
        'In the Riverbend school district, 41 percent of third graders read below grade level. Families tell us they want to read with their children but rarely have books at home or a quiet evening space.',
      ],
      ['heading1', 'Program Design'],
      [
        'paragraph',
        'Each month we host four Family Reading Nights at two branch libraries. Every family leaves with two new books and a short guide for reading aloud in English and Spanish.',
      ],
      ['heading1', 'Evaluation Plan'],
      ['paragraph', 'We will track attendance at every session and survey families in October and May.'],
      ['heading1', 'Budget Justification'],
      ['paragraph', 'Books for 240 families cost $9,600 for the year. Facilitator stipends total $7,200.'],
    ],
    shares: [
      { id: 'sh-seed-rrn-tomas', personId: 'tomas-reyes', role: 'editor' },
      { id: 'sh-seed-rrn-dana', personId: 'dana-whitfield', role: 'viewer' },
      { id: 'sh-seed-rrn-priya', personId: 'priya-nandakumar', role: 'commenter' },
    ],
  },
  {
    id: 'riverbend-budget-fy27',
    title: 'Budget Justification FY2027',
    client: 'Riverbend Literacy Project',
    blocks: [
      ['title', 'Budget Justification FY2027'],
      ['heading1', 'Personnel'],
      ['paragraph', 'A part-time program coordinator at 20 hours a week costs $26,000 including benefits.'],
      ['heading1', 'Supplies'],
      ['paragraph', 'Books and reading guides cost $9,600.'],
      ['heading2', 'Notes for the finance office'],
      ['paragraph', 'Coordinator hours match the program calendar. Book costs match the vendor quote.'],
    ],
    shares: [
      { id: 'sh-seed-rbf-tomas', personId: 'tomas-reyes', role: 'editor' },
      { id: 'sh-seed-rbf-dana', personId: 'dana-whitfield', role: 'viewer' },
    ],
  },
  {
    id: 'harbor-cold-storage',
    title: 'Cold Storage Expansion — Federal Application',
    client: 'Harbor Street Food Pantry',
    blocks: [
      ['title', 'Cold Storage Expansion'],
      ['heading1', 'Project Summary'],
      [
        'paragraph',
        'Harbor Street Food Pantry requests $148,000 to install a walk-in cooler and freezer so we can accept fresh produce donations year round.',
      ],
      ['heading1', 'Budget Justification'],
      ['paragraph', 'Equipment and installation total $121,500. Electrical upgrades total $26,500.'],
    ],
    shares: [
      { id: 'sh-seed-hcs-lena', personId: 'lena-ostrowski', role: 'editor' },
      { id: 'sh-seed-hcs-sam', personId: 'sam-adeyemi', role: 'commenter' },
    ],
  },
  {
    id: 'harbor-volunteer-renewal',
    title: 'Volunteer Program Renewal',
    client: 'Harbor Street Food Pantry',
    blocks: [
      ['title', 'Volunteer Program Renewal'],
      ['paragraph', 'Draft outline to follow.'],
    ],
    shares: [],
  },
];

const SEED_SUGGESTION = {
  id: 'sg-seed-1',
  documentId: 'riverbend-reading-nights',
  authorId: 'tomas-reyes',
  insertedAt: 397,
  insertedLength: 23,
};

const SEED_COMMENT = {
  id: 'cm-seed-1',
  documentId: 'riverbend-reading-nights',
  authorId: 'priya-nandakumar',
  anchorAt: 484,
  anchorLength: 34,
  body: 'Could the survey also ask how many books each family already has at home?',
};

function stateOf(document: SeedDocument): DocState {
  return {
    text: document.blocks.map(([, text]) => text).join('\n'),
    blockStyles: document.blocks.map(([style]) => style),
    marks: [],
    suggestions: [],
    comments: [],
  };
}

function bodyOf(document: SeedDocument, state: DocState): string {
  const suggestions =
    document.id === SEED_SUGGESTION.documentId
      ? [
          {
            id: SEED_SUGGESTION.id,
            kind: 'insert',
            authorId: SEED_SUGGESTION.authorId,
            inserted: { at: SEED_SUGGESTION.insertedAt, length: SEED_SUGGESTION.insertedLength },
            deleted: null,
            contentDeleted: false,
            status: 'open',
            createdAt: '2026-01-05T09:00:00Z',
          },
        ]
      : [];
  return JSON.stringify({
    documentId: document.id,
    revision: 1,
    text: state.text,
    blocks: blocksOf(state),
    marks: [],
    suggestions,
  });
}

export async function applySeed(): Promise<void> {
  for (const person of PEOPLE) {
    await query(
      `insert into people (id, display_name, email, password_hash, colour, is_consultant)
       values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
      [person.id, person.displayName, person.email, hashPassword(PASSWORD), person.colour, person.isConsultant],
    );
  }
  for (const document of DOCUMENTS) {
    const state = stateOf(document);
    seedBodies.set(document.id, { revision: 1, state });
    await query(
      `insert into documents (id, title, client, owner_id, revision, origin_revision, saved_revision)
       values ($1, $2, $3, 'ines-calloway', 1, 1, 0) on conflict (id) do nothing`,
      [document.id, document.title, document.client],
    );
    for (const share of document.shares) {
      await query(
        `insert into shares (id, document_id, person_id, email, role, ends_at, status)
         select $1, $2, $3, p.email, $4, null, 'active' from people p where p.id = $3
         on conflict (id) do nothing`,
        [share.id, document.id, share.personId, share.role],
      );
    }
  }
  await query(
    `insert into suggestions (id, document_id, author_id, kind, inserted_at, inserted_length, deleted_at, deleted_length,
       content_deleted, status, created_at)
     values ($1, $2, $3, 'insert', $4, $5, null, null, false, 'open', '2026-01-05T09:00:00Z')
     on conflict (id) do nothing`,
    [SEED_SUGGESTION.id, SEED_SUGGESTION.documentId, SEED_SUGGESTION.authorId, SEED_SUGGESTION.insertedAt, SEED_SUGGESTION.insertedLength],
  );
  await query(
    `insert into comments (id, document_id, parent_id, author_id, body, anchor_at, anchor_length, content_deleted, status, created_at)
     values ($1, $2, null, $3, $4, $5, $6, false, 'open', '2026-01-05T10:00:00Z')
     on conflict (id) do nothing`,
    [SEED_COMMENT.id, SEED_COMMENT.documentId, SEED_COMMENT.authorId, SEED_COMMENT.body, SEED_COMMENT.anchorAt, SEED_COMMENT.anchorLength],
  );
}

/** Writes any missing seed object, retrying while storage is unreachable. */
export function writeSeedObjects(): void {
  const pending = new Set(DOCUMENTS.map((document) => document.id));
  const attempt = async (): Promise<void> => {
    for (const id of [...pending]) {
      const document = DOCUMENTS.find((candidate) => candidate.id === id);
      if (!document) continue;
      if (loadedDocument(id)) {
        pending.delete(id);
        continue;
      }
      try {
        if (!(await objectExists(id))) {
          await putObject(id, bodyOf(document, stateOf(document)));
        }
        const saved = await query<{ revision: number }>('select revision from documents where id = $1', [id]);
        const revision = saved.rows[0]?.revision ?? 1;
        if (revision === 1) {
          await query('update documents set saved_revision = 1, save_failed = false where id = $1', [id]);
        }
        pending.delete(id);
      } catch (error) {
        if (!(error instanceof StorageError)) pending.delete(id);
      }
    }
    if (pending.size > 0) setTimeout(() => void attempt(), 5_000);
  };
  void attempt();
}
