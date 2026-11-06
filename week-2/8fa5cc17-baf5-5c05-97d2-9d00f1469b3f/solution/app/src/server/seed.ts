// The seeded workspace, created once on an empty database.
import { randomUUID } from 'node:crypto';
import { transaction, type Tx } from './db.ts';
import { hashPassword } from './passwords.ts';
import { SCHEMA } from './schema.ts';
import { plainText, textToBody } from '../shared/richtext.ts';

const SEED_LABEL = 'Seed';

async function addType(tx: Tx, name: string, rank: number, fields: [string, string, string[] | null, string | null][]): Promise<string> {
  const id = randomUUID();
  await tx.query('INSERT INTO object_types (id, name, builtin_rank, created_at) VALUES ($1, $2, $3, now())', [id, name, rank]);
  for (const [i, [field, kind, options, target]] of fields.entries()) {
    await tx.query(
      'INSERT INTO fields (id, type_id, position, name, kind, required, options, target_type_id) VALUES ($1, $2, $3, $4, $5, false, $6, $7)',
      [randomUUID(), id, i, field, kind, options ? JSON.stringify(options) : null, target]);
  }
  return id;
}

async function addObject(tx: Tx, typeId: string, title: string, properties: Record<string, unknown>, sharing = 'follow'): Promise<string> {
  const id = randomUUID();
  await tx.query(
    'INSERT INTO objects (id, type_id, title, properties, share_visibility, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())',
    [id, typeId, title, JSON.stringify(properties), sharing]);
  return id;
}

async function addTextBlock(tx: Tx, objectId: string, position: number, text: string): Promise<string> {
  const id = randomUUID();
  const body = textToBody(text);
  await tx.query(
    `INSERT INTO blocks (id, object_id, kind, position, body, plain, version, edited_at) VALUES ($1, $2, 'text', $3, $4, $5, 1, now())`,
    [id, objectId, position, body, plainText(body)]);
  await tx.query(`INSERT INTO revisions (block_id, version, body, ops, edit_kind, label, created_at) VALUES ($1, 1, $2, NULL, 'create', $3, now())`,
    [id, body, SEED_LABEL]);
  return id;
}

async function addQuote(tx: Tx, hostId: string, position: number, originBlockId: string, originObjectId: string): Promise<void> {
  const id = randomUUID();
  await tx.query(`INSERT INTO blocks (id, object_id, kind, position, origin_block_id, edited_at) VALUES ($1, $2, 'quote', $3, $4, now())`,
    [id, hostId, position, originBlockId]);
  await tx.query(`INSERT INTO link_edges (id, from_object_id, to_object_id, kind, quote_block_id, created_at) VALUES ($1, $2, $3, 'quote', $4, now())`,
    [randomUUID(), hostId, originObjectId, id]);
}

async function addRelation(tx: Tx, fromId: string, toId: string, field: string): Promise<void> {
  await tx.query(`INSERT INTO link_edges (id, from_object_id, to_object_id, kind, field_name, created_at) VALUES ($1, $2, $3, 'relation', $4, now())`,
    [randomUUID(), fromId, toId, field]);
}

export async function applySchemaAndSeed(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(18470)');
    await tx.query(SCHEMA);
    const [existing] = await tx.query('SELECT id FROM owner_account');
    if (existing) return;
    await tx.query('INSERT INTO owner_account (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)',
      [randomUUID(), 'tamsin@oakgall.test', 'Tamsin Okoro', await hashPassword('commonplace-1847')]);
    await tx.query(`INSERT INTO workspace_settings (id, home_time_zone, theme) VALUES (1, 'Europe/London', 'paper')`);

    const person = await addType(tx, 'Person', 1, [['Affiliation', 'text', null, null]]);
    const source = await addType(tx, 'Source', 0, [
      ['Author', 'relation', null, person], ['Year', 'number', null, null],
      ['Kind', 'select', ['Book', 'Article', 'Chapter', 'Thesis'], null], ['Link', 'url', null, null],
    ]);
    const conceptType = await addType(tx, 'Concept', 2, [['Definition', 'text', null, null]]);
    await addType(tx, 'Daily note', 3, []);

    const hesper = await addObject(tx, person, 'Hesper Vane', { Affiliation: 'Collegium of Lower Fen' });
    const odile = await addObject(tx, person, 'Odile Marchetti', { Affiliation: 'Saltmarsh Institute' });
    const margin = await addObject(tx, source, 'The Gathered Margin', { Author: hesper, Year: 1987, Kind: 'Book' });
    const lamplight = await addObject(tx, source, 'Reading by Lamplight', { Author: odile, Year: 2011, Kind: 'Article' });
    const florilegium = await addObject(tx, conceptType, 'Florilegium', { Definition: 'A gathering of excerpts arranged for reuse.' });
    const chapter = await addObject(tx, conceptType, 'Chapter three argument', { Definition: null }, 'never');
    await addRelation(tx, margin, hesper, 'Author');
    await addRelation(tx, lamplight, odile, 'Author');

    const marginFirst = await addTextBlock(tx, margin, 1, 'Every reader keeps two books: the one in hand and the one they write in its margins.');
    await addTextBlock(tx, margin, 2, 'A heading is a promise to return.');
    const lamplightBlock = await addTextBlock(tx, lamplight, 1, 'Lamplight narrows the page until only one line can be trusted at a time.');
    await addTextBlock(tx, florilegium, 1, 'Gathered under one heading, borrowed lines start to argue with each other.');
    await addQuote(tx, florilegium, 2, marginFirst, margin);
    await addQuote(tx, florilegium, 3, lamplightBlock, lamplight);
    await addTextBlock(tx, chapter, 1, 'The margin is where the argument starts, not where it ends.');
    await addQuote(tx, chapter, 2, lamplightBlock, lamplight);

    const collection = randomUUID();
    await tx.query(`INSERT INTO collections (id, name, created_at) VALUES ($1, 'Advisor reading — autumn', now())`, [collection]);
    for (const member of [margin, florilegium, chapter]) {
      await tx.query('INSERT INTO collection_members (collection_id, object_id) VALUES ($1, $2)', [collection, member]);
    }
    await tx.query(
      `INSERT INTO saved_queries (id, name, type_id, text, group_by, sort, created_at) VALUES ($1, 'Sources by backlinks', $2, '', NULL, $3, now())`,
      [randomUUID(), source, JSON.stringify([{ key: '@backlinks', dir: 'desc' }])]);
  });
}
