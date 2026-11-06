import { fixedOpId } from './ops.ts';
import { DAILY_NOTE } from './templates.ts';
import type { BlockType, CellValue, Column, EntityKind, Indent, Op, WorldPosition } from './types.ts';

const SEED_FOLDER = 'Plans';
const BILLS_TABLE_ID = 'seed-bills';

const BILLS_COLUMNS: Column[] = [
  { id: 'seed-bills-name', name: 'Name', type: 'text' },
  { id: 'seed-bills-amount', name: 'Amount', type: 'number' },
  { id: 'seed-bills-due', name: 'Due', type: 'date' },
  { id: 'seed-bills-paid', name: 'Paid', type: 'checkbox' },
  { id: 'seed-bills-category', name: 'Category', type: 'select', options: ['Home', 'Travel', 'Leisure'] },
];

const BILLS_ROWS: [string, number, string, boolean, string][] = [
  ['Electricity', 64.2, '2026-11-03', false, 'Home'],
  ['Water', 31.75, '2026-11-05', true, 'Home'],
  ['Broadband', 39.0, '2026-11-07', false, 'Home'],
  ['Library fine', 2.4, '2026-11-09', true, 'Leisure'],
  ['Train pass', 88.0, '2026-11-12', false, 'Travel'],
  ['Gym', 27.5, '2026-11-15', false, 'Leisure'],
  ['Ferry tickets', 46.1, '2026-11-21', false, 'Travel'],
  ['Boiler service', 95.0, '2026-11-28', false, 'Home'],
];

type SeedDocument = {
  id: string;
  title: string;
  folder: string | null;
  tags: string[];
  starred: boolean;
  blocks: SeedBlock[];
};

type SeedBlock = {
  type: BlockType;
  text?: string;
  checked?: boolean;
  indent?: Indent;
  position?: WorldPosition;
  tableId?: string;
};

const SEED_DOCUMENTS: SeedDocument[] = [
  {
    id: 'seed-welcome',
    title: 'Welcome to Oddment',
    folder: null,
    tags: ['guide'],
    starred: true,
    blocks: [
      { type: 'heading1', text: 'Everything here lives on this device', position: { x: 0, y: 0 } },
      {
        type: 'paragraph',
        text: 'Write first and worry later. Each change is saved here before anything else happens.',
        position: { x: 0, y: 140 },
      },
      { type: 'heading2', text: 'Try these', position: { x: 320, y: 0 } },
      { type: 'todo', text: 'Switch this page to the canvas', checked: false, position: { x: 320, y: 140 } },
      { type: 'todo', text: 'Open this document', checked: true, position: { x: 320, y: 280 } },
      { type: 'quote', text: 'The table stays put. The blocks move.', position: { x: 640, y: 0 } },
      { type: 'divider', position: { x: 640, y: 180 } },
      { type: 'paragraph', text: 'Sign in only if you want a second device.', position: { x: 640, y: 320 } },
    ],
  },
  {
    id: 'seed-lisbon',
    title: 'Trip to Lisbon',
    folder: SEED_FOLDER,
    tags: ['travel'],
    starred: true,
    blocks: [
      { type: 'heading1', text: 'Three days in Lisbon' },
      { type: 'bulleted', text: 'Tram 28 before nine', indent: 0 },
      { type: 'bulleted', text: 'Walk down through Alfama', indent: 0 },
      { type: 'bulleted', text: 'Stop at the viewpoint', indent: 1 },
      { type: 'heading2', text: 'Still to book' },
      { type: 'todo', text: 'Ferry to Cacilhas', checked: false },
      { type: 'todo', text: 'Room near the river', checked: true },
      { type: 'quote', text: 'Bring shoes with grip.' },
    ],
  },
  {
    id: 'seed-shelf',
    title: 'Kitchen shelf ideas',
    folder: SEED_FOLDER,
    tags: ['home'],
    starred: false,
    blocks: [
      { type: 'paragraph', text: 'Measure the alcove twice.', position: { x: 0, y: 0 } },
      { type: 'heading2', text: 'Options', position: { x: 300, y: 100 } },
      { type: 'numbered', text: 'Oak board on brackets' },
      { type: 'numbered', text: 'Steel rail with hooks' },
    ],
  },
  {
    id: 'seed-overview',
    title: 'Household overview',
    folder: null,
    tags: ['home'],
    starred: false,
    blocks: [
      { type: 'paragraph', text: 'Bills for the month, pulled from the table.' },
      { type: 'table', tableId: BILLS_TABLE_ID },
    ],
  },
  {
    id: 'seed-note-05',
    title: 'Library books to return',
    folder: null,
    tags: ['reading'],
    starred: false,
    blocks: [{ type: 'paragraph', text: 'Two books are due back on Saturday.' }],
  },
  {
    id: 'seed-note-06',
    title: 'Birthday list',
    folder: null,
    tags: ['family'],
    starred: false,
    blocks: [{ type: 'paragraph', text: 'Ask what size the new gloves should be.' }],
  },
  {
    id: 'seed-note-07',
    title: 'Garden jobs',
    folder: null,
    tags: ['home'],
    starred: false,
    blocks: [{ type: 'paragraph', text: 'Cut back the lavender before the first frost.' }],
  },
  {
    id: 'seed-note-08',
    title: 'Recipes to try',
    folder: null,
    tags: ['home'],
    starred: false,
    blocks: [{ type: 'paragraph', text: 'Lentil soup with lemon, and the plum cake.' }],
  },
  {
    id: 'seed-note-09',
    title: 'Car notes',
    folder: null,
    tags: ['home'],
    starred: false,
    blocks: [{ type: 'paragraph', text: 'Tyres were last rotated in the spring.' }],
  },
  {
    id: 'seed-note-10',
    title: 'Books I lent',
    folder: null,
    tags: ['reading'],
    starred: false,
    blocks: [{ type: 'paragraph', text: 'The atlas is with the neighbours at number 12.' }],
  },
  {
    id: 'seed-note-11',
    title: 'Packing list',
    folder: SEED_FOLDER,
    tags: ['travel'],
    starred: false,
    blocks: [{ type: 'paragraph', text: 'Adapters, rain jacket, and the blue notebook.' }],
  },
  {
    id: 'seed-note-12',
    title: 'Questions for the dentist',
    folder: null,
    tags: ['family'],
    starred: false,
    blocks: [{ type: 'paragraph', text: 'Ask about the crown on the upper left.' }],
  },
];

type Fixed = (entity: EntityKind, entityId: string, field: string, value: unknown, extra?: Partial<Op>) => Op;

function fixedOps(at: string): Fixed {
  return (entity, entityId, field, value, extra = {}) => ({
    id: fixedOpId(entity, entityId, field),
    deviceId: 'seed',
    entity,
    entityId,
    field,
    value,
    at,
    seed: true,
    ...extra,
  });
}

/** Blocks of a journal note or a template copy, with ids the caller decides. */
export function templateOps(
  documentId: string,
  blockId: (index: number) => string,
  blocks: { type: BlockType; text: string; checked?: boolean; indent?: Indent }[],
  options: { seed?: boolean; at: string; deviceId?: string },
): Op[] {
  const ops: Op[] = [];
  blocks.forEach((block, index) => {
    const id = blockId(index);
    const base = {
      entity: 'block' as EntityKind,
      entityId: id,
      documentId,
      deviceId: options.deviceId ?? 'seed',
      at: options.at,
      seed: options.seed,
    };
    ops.push({
      ...base,
      id: fixedOpId('block', id, 'create'),
      field: 'create',
      value: {
        documentId,
        type: block.type,
        order: index + 1,
        indent: block.indent ?? 0,
        checked: block.checked ?? false,
      },
      content: true,
    });
    ops.push({ ...base, id: fixedOpId('block', id, 'text'), field: 'text', value: block.text, content: true });
  });
  return ops;
}

export function journalNoteOps(date: string, at: string, deviceId: string, seed: boolean): Op[] {
  const documentId = journalDocumentId(date);
  const ops: Op[] = [
    {
      id: fixedOpId('document', documentId, 'create'),
      deviceId,
      entity: 'document',
      entityId: documentId,
      documentId,
      field: 'create',
      value: { kind: 'journal', journalDate: date, seedOrder: 0 },
      at,
      content: true,
      seed: seed || undefined,
    },
  ];
  ops.push(
    ...templateOps(documentId, (index) => `${documentId}-t${index + 1}`, DAILY_NOTE.blocks, {
      at,
      deviceId,
      seed: seed || undefined,
    }),
  );
  return ops;
}

export function journalDocumentId(date: string): string {
  return `journal-${date}`;
}

/** The workspace is created on the device at first open and only then. */
export function seedOps(today: string, at: string): Op[] {
  const fixed = fixedOps(at);
  const ops: Op[] = [];

  SEED_DOCUMENTS.forEach((document, index) => {
    const owned = { documentId: document.id };
    ops.push(
      fixed('document', document.id, 'create', { kind: 'document', journalDate: null, seedOrder: index }, {
        content: true,
        ...owned,
      }),
    );
    ops.push(fixed('document', document.id, 'title', document.title, { content: true, ...owned }));
    if (document.folder) ops.push(fixed('document', document.id, 'folder', document.folder, owned));
    if (document.tags.length) ops.push(fixed('document', document.id, 'tags', document.tags, owned));
    if (document.starred) ops.push(fixed('document', document.id, 'starred', true, owned));
    document.blocks.forEach((block, blockIndex) => {
      const blockId = `${document.id}-${blockIndex + 1}`;
      ops.push(
        fixed(
          'block',
          blockId,
          'create',
          {
            documentId: document.id,
            type: block.type,
            order: blockIndex + 1,
            indent: block.indent ?? 0,
            checked: block.checked ?? false,
            position: block.position ?? null,
            tableId: block.tableId ?? null,
          },
          { content: true, ...owned },
        ),
      );
      if (block.text !== undefined) {
        ops.push(fixed('block', blockId, 'text', block.text, { content: true, ...owned }));
      }
    });
  });

  ops.push(
    fixed(
      'note',
      'seed-welcome-note',
      'create',
      { documentId: 'seed-welcome', position: { x: 0, y: 320 } },
      { documentId: 'seed-welcome' },
    ),
  );
  ops.push(
    fixed('note', 'seed-welcome-note', 'text', 'This note is only on the canvas.', {
      documentId: 'seed-welcome',
    }),
  );
  ops.push(
    fixed(
      'connector',
      'seed-welcome-link',
      'create',
      { documentId: 'seed-welcome', from: 'seed-welcome-2', to: 'seed-welcome-4' },
      { documentId: 'seed-welcome' },
    ),
  );

  ops.push(fixed('table', BILLS_TABLE_ID, 'create', { name: 'Household bills', columns: BILLS_COLUMNS }));
  BILLS_ROWS.forEach((row, index) => {
    const rowId = `${BILLS_TABLE_ID}-r${index + 1}`;
    ops.push(fixed('row', rowId, 'create', { tableId: BILLS_TABLE_ID, order: index + 1 }, { content: true }));
    const cells: CellValue[] = [row[0], row[1], row[2], row[3], row[4]];
    BILLS_COLUMNS.forEach((column, columnIndex) => {
      ops.push(fixed('row', rowId, `cell:${column.id}`, cells[columnIndex], { content: true }));
    });
  });

  ops.push(...journalNoteOps(today, at, 'seed', true));

  return ops;
}
