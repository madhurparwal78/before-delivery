import { randomUUID } from 'node:crypto';
import { withTransaction } from './pool';
import { hashPassword } from '../auth/password';
import { bodyFromPlainText } from '../../shared/richtext';

type FieldSeed = {
  name: string;
  kind: string;
  required: boolean;
  options: string[] | null;
  targetType: string | null;
};

const TYPE_SEEDS: { name: string; fields: FieldSeed[] }[] = [
  {
    name: 'Source',
    fields: [
      { name: 'Author', kind: 'relation', required: false, options: null, targetType: 'Person' },
      { name: 'Year', kind: 'number', required: false, options: null, targetType: null },
      {
        name: 'Kind',
        kind: 'select',
        required: false,
        options: ['Book', 'Article', 'Chapter', 'Thesis'],
        targetType: null,
      },
      { name: 'Link', kind: 'url', required: false, options: null, targetType: null },
    ],
  },
  {
    name: 'Person',
    fields: [{ name: 'Affiliation', kind: 'text', required: false, options: null, targetType: null }],
  },
  {
    name: 'Concept',
    fields: [{ name: 'Definition', kind: 'text', required: false, options: null, targetType: null }],
  },
  { name: 'Daily note', fields: [] },
];

export async function applySeed(): Promise<void> {
  const existing = await withTransaction(async (tx) => {
    const rows = await tx.query<{ count: string }>('select count(*)::text as count from owner_account');
    return Number(rows[0].count);
  });
  if (existing > 0) return;

  await withTransaction(async (tx) => {
    await tx.query('lock table owner_account in exclusive mode');
    const already = await tx.query<{ count: string }>('select count(*)::text as count from owner_account');
    if (Number(already[0].count) > 0) return;

    await tx.query(
      'insert into owner_account (id, email, display_name, password_hash) values ($1, $2, $3, $4)',
      [randomUUID(), 'tamsin@oakgall.test', 'Tamsin Okoro', hashPassword('commonplace-1847')],
    );
    await tx.query(
      'insert into workspace_settings (id, home_time_zone, theme) values (1, $1, $2) on conflict (id) do nothing',
      ['Europe/London', 'paper'],
    );

    const typeIds = new Map<string, string>();
    for (let index = 0; index < TYPE_SEEDS.length; index += 1) {
      const seed = TYPE_SEEDS[index];
      const id = randomUUID();
      typeIds.set(seed.name, id);
      await tx.query(
        'insert into object_type (id, name, builtin, library_rank) values ($1, $2, true, $3)',
        [id, seed.name, index],
      );
    }
    const fieldIds = new Map<string, string>();
    for (const seed of TYPE_SEEDS) {
      const typeId = typeIds.get(seed.name) as string;
      for (let position = 0; position < seed.fields.length; position += 1) {
        const field = seed.fields[position];
        const id = randomUUID();
        fieldIds.set(`${seed.name}.${field.name}`, id);
        await tx.query(
          `insert into type_field (id, type_id, name, kind, required, options, target_type_id, position)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            typeId,
            field.name,
            field.kind,
            field.required,
            field.options === null ? null : JSON.stringify(field.options),
            field.targetType === null ? null : typeIds.get(field.targetType),
            position,
          ],
        );
      }
    }

    const objectIds = new Map<string, string>();
    const makeObject = async (title: string, typeName: string): Promise<string> => {
      const id = randomUUID();
      objectIds.set(title, id);
      await tx.query(
        'insert into object_note (id, type_id, title, share_visibility) values ($1, $2, $3, $4)',
        [id, typeIds.get(typeName), title, title === 'Chapter three argument' ? 'never' : 'follow'],
      );
      return id;
    };
    const setProperty = async (title: string, field: string, value: unknown): Promise<void> => {
      await tx.query(
        'insert into property_value (object_id, field_id, value) values ($1, $2, $3)',
        [objectIds.get(title), fieldIds.get(field), JSON.stringify(value)],
      );
    };
    const blockIds = new Map<string, string>();
    const addTextBlock = async (objectTitle: string, key: string, text: string, position: number): Promise<void> => {
      const id = randomUUID();
      blockIds.set(key, id);
      const body = bodyFromPlainText(text);
      await tx.query(
        `insert into block (id, object_id, kind, position, body, version) values ($1, $2, 'text', $3, $4, 1)`,
        [id, objectIds.get(objectTitle), position, body],
      );
      await tx.query(
        `insert into block_revision (block_id, version, body, ops, change_kind, label)
         values ($1, 1, $2, null, 'create', 'Seed')`,
        [id, body],
      );
    };
    const addQuoteBlock = async (
      objectTitle: string,
      originKey: string,
      originObjectTitle: string,
      position: number,
    ): Promise<void> => {
      const id = randomUUID();
      await tx.query(
        `insert into block (id, object_id, kind, position, origin_block_id) values ($1, $2, 'quote', $3, $4)`,
        [id, objectIds.get(objectTitle), position, blockIds.get(originKey)],
      );
      await tx.query(
        `insert into link_edge (id, from_object_id, to_object_id, kind, block_id) values ($1, $2, $3, 'quote', $4)`,
        [randomUUID(), objectIds.get(objectTitle), objectIds.get(originObjectTitle), id],
      );
      await tx.query('update object_note set backlinks = backlinks + 1 where id = $1', [
        objectIds.get(originObjectTitle),
      ]);
    };
    const addRelationEdge = async (fromTitle: string, toTitle: string, field: string): Promise<void> => {
      await tx.query(
        `insert into link_edge (id, from_object_id, to_object_id, kind, field_id) values ($1, $2, $3, 'relation', $4)`,
        [randomUUID(), objectIds.get(fromTitle), objectIds.get(toTitle), fieldIds.get(field)],
      );
      await tx.query('update object_note set backlinks = backlinks + 1 where id = $1', [objectIds.get(toTitle)]);
    };

    await makeObject('Hesper Vane', 'Person');
    await makeObject('Odile Marchetti', 'Person');
    await makeObject('The Gathered Margin', 'Source');
    await makeObject('Reading by Lamplight', 'Source');
    await makeObject('Florilegium', 'Concept');
    await makeObject('Chapter three argument', 'Concept');

    await setProperty('Hesper Vane', 'Person.Affiliation', 'Collegium of Lower Fen');
    await setProperty('Odile Marchetti', 'Person.Affiliation', 'Saltmarsh Institute');
    await setProperty('The Gathered Margin', 'Source.Author', objectIds.get('Hesper Vane'));
    await setProperty('The Gathered Margin', 'Source.Year', 1987);
    await setProperty('The Gathered Margin', 'Source.Kind', 'Book');
    await setProperty('Reading by Lamplight', 'Source.Author', objectIds.get('Odile Marchetti'));
    await setProperty('Reading by Lamplight', 'Source.Year', 2011);
    await setProperty('Reading by Lamplight', 'Source.Kind', 'Article');
    await setProperty('Florilegium', 'Concept.Definition', 'A gathering of excerpts arranged for reuse.');
    await setProperty('Chapter three argument', 'Concept.Definition', '');

    await addTextBlock(
      'The Gathered Margin',
      'tgm-1',
      'Every reader keeps two books: the one in hand and the one they write in its margins.',
      1,
    );
    await addTextBlock('The Gathered Margin', 'tgm-2', 'A heading is a promise to return.', 2);
    await addTextBlock(
      'Reading by Lamplight',
      'rbl-1',
      'Lamplight narrows the page until only one line can be trusted at a time.',
      1,
    );
    await addTextBlock(
      'Florilegium',
      'flo-1',
      'Gathered under one heading, borrowed lines start to argue with each other.',
      1,
    );
    await addQuoteBlock('Florilegium', 'tgm-1', 'The Gathered Margin', 2);
    await addQuoteBlock('Florilegium', 'rbl-1', 'Reading by Lamplight', 3);
    await addTextBlock(
      'Chapter three argument',
      'cta-1',
      'The margin is where the argument starts, not where it ends.',
      1,
    );
    await addQuoteBlock('Chapter three argument', 'rbl-1', 'Reading by Lamplight', 2);

    await addRelationEdge('The Gathered Margin', 'Hesper Vane', 'Source.Author');
    await addRelationEdge('Reading by Lamplight', 'Odile Marchetti', 'Source.Author');

    const collectionId = randomUUID();
    await tx.query('insert into collection (id, name) values ($1, $2)', [
      collectionId,
      'Advisor reading — autumn',
    ]);
    for (const title of ['The Gathered Margin', 'Florilegium', 'Chapter three argument']) {
      await tx.query('insert into collection_member (collection_id, object_id) values ($1, $2)', [
        collectionId,
        objectIds.get(title),
      ]);
    }

    await tx.query(
      'insert into saved_query (id, name, type_id, text, group_by, sort) values ($1, $2, $3, $4, null, $5)',
      [
        randomUUID(),
        'Sources by backlinks',
        typeIds.get('Source'),
        '',
        JSON.stringify([{ key: '@backlinks', dir: 'desc' }]),
      ],
    );
  });
}
