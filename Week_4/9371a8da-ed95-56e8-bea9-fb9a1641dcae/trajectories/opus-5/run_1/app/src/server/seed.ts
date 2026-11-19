import { Tx, transaction } from './db.js';
import {
  createProjectFromTemplate,
  createTextFile,
  liveFiles,
  saveTextFile,
  Actor,
} from './domain/files.js';
import { hashPassword, newId } from './domain/ids.js';
import { GRANT_MAIN, GRANT_REFS } from './domain/templates.js';
import { SCHEMA_SQL } from './schema.js';

interface SeedPerson {
  displayName: string;
  email: string;
  password: string;
  handle: string;
}

const PEOPLE: SeedPerson[] = [
  {
    displayName: 'Ilse Varga',
    email: 'ilse.varga@varga-lab.test',
    password: 'quill-owner-2026',
    handle: 'ilsevarga',
  },
  {
    displayName: 'Noor Haddad',
    email: 'noor.haddad@varga-lab.test',
    password: 'quill-student-2026',
    handle: 'noorhaddad',
  },
  {
    displayName: 'Kenji Arai',
    email: 'kenji.arai@partner-uni.test',
    password: 'quill-review-2026',
    handle: 'kenjiarai',
  },
  {
    displayName: 'Marta Osei',
    email: 'marta.osei@varga-lab.test',
    password: 'quill-viewer-2026',
    handle: 'martaosei',
  },
  {
    displayName: 'Sune Lindqvist',
    email: 'sune.lindqvist@lindqvist-lab.test',
    password: 'quill-other-2026',
    handle: 'sunelindqvist',
  },
  {
    displayName: 'Ada Moreau',
    email: 'ada.moreau@lindqvist-lab.test',
    password: 'quill-neighbour-2026',
    handle: 'adamoreau',
  },
];

function actorOf(id: string, person: SeedPerson): Actor {
  return { id, displayName: person.displayName, handle: person.handle };
}

async function seedSuggestion(
  tx: Tx,
  input: {
    projectId: string;
    fileId: string;
    content: string;
    phrase: string;
    inserted: string;
    authorId: string;
  },
): Promise<void> {
  const from = input.content.indexOf(input.phrase);
  await tx.query(
    `insert into suggestions
       (id, project_id, file_id, from_pos, to_pos, deleted_text, inserted, status, author_id)
     values ($1, $2, $3, $4, $5, $6, $7, 'open', $8)`,
    [
      newId('s'),
      input.projectId,
      input.fileId,
      from,
      from + input.phrase.length,
      input.phrase,
      input.inserted,
      input.authorId,
    ],
  );
}

async function seedThread(
  tx: Tx,
  input: {
    projectId: string;
    fileId: string;
    content: string;
    phrase: string;
    body: string;
    authorId: string;
  },
): Promise<void> {
  const from = input.content.indexOf(input.phrase);
  const threadId = newId('t');
  await tx.query(
    `insert into threads (id, project_id, file_id, from_pos, to_pos, quote, status)
     values ($1, $2, $3, $4, $5, $6, 'open')`,
    [threadId, input.projectId, input.fileId, from, from + input.phrase.length, input.phrase],
  );
  await tx.query(
    `insert into comments (id, thread_id, author_id, body) values ($1, $2, $3, $4)`,
    [newId('c'), threadId, input.authorId, input.body],
  );
}

async function writeSeed(tx: Tx): Promise<void> {
  const ids = new Map<string, string>();
  for (const person of PEOPLE) {
    const id = newId('u');
    ids.set(person.handle, id);
    await tx.query(
      `insert into users (id, email, email_lower, display_name, handle, password_hash)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        person.email,
        person.email.toLowerCase(),
        person.displayName,
        person.handle,
        hashPassword(person.password),
      ],
    );
  }

  const vargaLab = newId('w');
  const lindqvistLab = newId('w');
  await tx.query(`insert into workspaces (id, name) values ($1, $2), ($3, $4)`, [
    vargaLab,
    'Varga Lab',
    lindqvistLab,
    'Lindqvist Lab',
  ]);
  const workspaceRoles: [string, string, string][] = [
    [vargaLab, 'ilsevarga', 'owner'],
    [vargaLab, 'noorhaddad', 'member'],
    [lindqvistLab, 'sunelindqvist', 'owner'],
    [lindqvistLab, 'adamoreau', 'member'],
  ];
  for (const [workspaceId, handle, role] of workspaceRoles) {
    await tx.query(
      `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)`,
      [workspaceId, ids.get(handle), role],
    );
  }

  const ilse = actorOf(ids.get('ilsevarga') as string, PEOPLE[0]);
  const sune = actorOf(ids.get('sunelindqvist') as string, PEOPLE[4]);

  const thesisId = await createProjectFromTemplate(tx, {
    workspaceId: vargaLab,
    title: 'Annotation Practice in Multilingual Labs',
    templateId: 'thesis-numbered',
    actor: ilse,
  });
  for (const [handle, role] of [
    ['noorhaddad', 'editor'],
    ['kenjiarai', 'reviewer'],
    ['martaosei', 'viewer'],
  ] as [string, string][]) {
    await tx.query(`insert into memberships (project_id, user_id, role) values ($1, $2, $3)`, [
      thesisId,
      ids.get(handle),
      role,
    ]);
  }

  const thesisFiles = await liveFiles(tx, thesisId);
  const method = thesisFiles.find((file) => file.path === 'chapters/03-method.tex');
  const introduction = thesisFiles.find((file) => file.path === 'chapters/01-introduction.tex');
  if (method === undefined || introduction === undefined) throw new Error('template mismatch');

  await seedSuggestion(tx, {
    projectId: thesisId,
    fileId: method.id,
    content: method.content ?? '',
    phrase: 'another lab',
    inserted: 'an independent lab',
    authorId: ids.get('kenjiarai') as string,
  });
  await seedSuggestion(tx, {
    projectId: thesisId,
    fileId: method.id,
    content: method.content ?? '',
    phrase: 'repeat it',
    inserted: 'reproduce it',
    authorId: ilse.id,
  });
  await seedThread(tx, {
    projectId: thesisId,
    fileId: introduction.id,
    content: introduction.content ?? '',
    phrase: 'State the research question here.',
    body: 'Lead with the question, then the gap. @noorhaddad',
    authorId: ilse.id,
  });

  const grantId = await createProjectFromTemplate(tx, {
    workspaceId: vargaLab,
    title: 'Grant Proposal: Shared Margins',
    templateId: 'article-single',
    actor: ilse,
  });
  await tx.query(`insert into memberships (project_id, user_id, role) values ($1, $2, 'editor')`, [
    grantId,
    ids.get('noorhaddad'),
  ]);
  await createTextFile(tx, {
    projectId: grantId,
    path: 'refs.bib',
    content: GRANT_REFS,
    actor: ilse,
  });
  const grantFiles = await liveFiles(tx, grantId);
  const grantMain = grantFiles.find((file) => file.path === 'main.tex');
  if (grantMain === undefined) throw new Error('template mismatch');
  await saveTextFile(tx, { file: grantMain, content: GRANT_MAIN, actor: ilse });

  const sedimentId = await createProjectFromTemplate(tx, {
    workspaceId: lindqvistLab,
    title: 'Sediment Transport in Braided Rivers',
    templateId: 'thesis-numbered',
    actor: sune,
  });
  await tx.query(`insert into memberships (project_id, user_id, role) values ($1, $2, 'editor')`, [
    sedimentId,
    ids.get('adamoreau'),
  ]);
}

/** Applies the schema and, into an empty database only, the seed data. */
export async function applySchemaAndSeed(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['marginalia:schema']);
    await tx.query(SCHEMA_SQL);
    const existing = await tx.one<{ count: string }>('select count(*)::text as count from users');
    if (existing !== null && existing.count === '0') await writeSeed(tx);
  });
}
