// The starter workspace, created on the device at first open and only then.
import type { Block, Column, Connector, DocumentMeta, Note, Row, TableMeta } from '../../shared/domain';

const T0 = Date.now();

export const SEED_FOLDER = 'Plans';

export function seedDocuments(): DocumentMeta[] {
  const docs: [string, string, string | null, string[], boolean][] = [
    ['seed-welcome', 'Welcome to Oddment', null, ['guide'], true],
    ['seed-lisbon', 'Trip to Lisbon', 'Plans', ['travel'], true],
    ['seed-shelf', 'Kitchen shelf ideas', 'Plans', ['home'], false],
    ['seed-overview', 'Household overview', null, ['home'], false],
    ['seed-note-05', 'Library books to return', null, ['reading'], false],
    ['seed-note-06', 'Birthday list', null, ['family'], false],
    ['seed-note-07', 'Garden jobs', null, ['home'], false],
    ['seed-note-08', 'Recipes to try', null, ['home'], false],
    ['seed-note-09', 'Car notes', null, ['home'], false],
    ['seed-note-10', 'Books I lent', null, ['reading'], false],
    ['seed-note-11', 'Packing list', 'Plans', ['travel'], false],
    ['seed-note-12', 'Questions for the dentist', null, ['family'], false],
  ];
  return docs.map(([id, title, folder, tags, starred]) => ({
    id,
    title,
    folder,
    tags,
    starred,
    trashed: false,
    createdAt: T0,
    updatedAt: T0,
  }));
}

function block(documentId: string, n: number, type: Block['type'], text: string, extra: Partial<Block> = {}): Block {
  return {
    id: `${documentId}-${n}`,
    documentId,
    type,
    text,
    indent: 0,
    checked: false,
    order: n - 1,
    ...extra,
  };
}

export function seedBlocks(): Block[] {
  const blocks: Block[] = [];
  // seed-welcome
  blocks.push(
    block('seed-welcome', 1, 'heading1', 'Everything here lives on this device', { card: { x: 0, y: 0 } }),
    block('seed-welcome', 2, 'paragraph', 'Write first and worry later. Each change is saved here before anything else happens.', { card: { x: 0, y: 140 } }),
    block('seed-welcome', 3, 'heading2', 'Try these', { card: { x: 320, y: 0 } }),
    block('seed-welcome', 4, 'todo', 'Switch this page to the canvas', { card: { x: 320, y: 140 } }),
    block('seed-welcome', 5, 'todo', 'Open this document', { checked: true, card: { x: 320, y: 280 } }),
    block('seed-welcome', 6, 'quote', 'The table stays put. The blocks move.', { card: { x: 640, y: 0 } }),
    block('seed-welcome', 7, 'divider', '', { card: { x: 640, y: 180 } }),
    block('seed-welcome', 8, 'paragraph', 'Sign in only if you want a second device.', { card: { x: 640, y: 320 } })
  );
  // seed-lisbon
  blocks.push(
    block('seed-lisbon', 1, 'heading1', 'Three days in Lisbon'),
    block('seed-lisbon', 2, 'bulleted', 'Tram 28 before nine'),
    block('seed-lisbon', 3, 'bulleted', 'Walk down through Alfama'),
    block('seed-lisbon', 4, 'bulleted', 'Stop at the viewpoint', { indent: 1 }),
    block('seed-lisbon', 5, 'heading2', 'Still to book'),
    block('seed-lisbon', 6, 'todo', 'Ferry to Cacilhas'),
    block('seed-lisbon', 7, 'todo', 'Room near the river', { checked: true }),
    block('seed-lisbon', 8, 'quote', 'Bring shoes with grip.')
  );
  // seed-shelf
  blocks.push(
    block('seed-shelf', 1, 'paragraph', 'Measure the alcove twice.', { card: { x: 0, y: 0 } }),
    block('seed-shelf', 2, 'heading2', 'Options', { card: { x: 300, y: 100 } }),
    block('seed-shelf', 3, 'numbered', 'Oak board on brackets'),
    block('seed-shelf', 4, 'numbered', 'Steel rail with hooks')
  );
  // seed-overview
  blocks.push(
    block('seed-overview', 1, 'paragraph', 'Bills for the month, pulled from the table.'),
    block('seed-overview', 2, 'table', '', { tableId: 'seed-bills' })
  );
  const noteTexts: Record<string, string> = {
    'seed-note-05': 'Two books are due back on Saturday.',
    'seed-note-06': 'Ask what size the new gloves should be.',
    'seed-note-07': 'Cut back the lavender before the first frost.',
    'seed-note-08': 'Lentil soup with lemon, and the plum cake.',
    'seed-note-09': 'Tyres were last rotated in the spring.',
    'seed-note-10': 'The atlas is with the neighbours at number 12.',
    'seed-note-11': 'Adapters, rain jacket, and the blue notebook.',
    'seed-note-12': 'Ask about the crown on the upper left.',
  };
  for (const id of Object.keys(noteTexts)) {
    blocks.push(block(id, 1, 'paragraph', noteTexts[id]));
  }
  return blocks;
}

export function seedNotes(): Note[] {
  return [
    {
      id: 'seed-welcome-note',
      documentId: 'seed-welcome',
      text: 'This note is only on the canvas.',
      card: { x: 0, y: 320 },
      order: 0,
      createdAt: 0,
    },
  ];
}

export function seedConnectors(): Connector[] {
  return [
    {
      id: 'seed-welcome-link',
      documentId: 'seed-welcome',
      fromId: 'seed-welcome-2',
      toId: 'seed-welcome-4',
    },
  ];
}

export const SEED_TABLE_ID = 'seed-bills';

export function seedTables(): TableMeta[] {
  return [{ id: SEED_TABLE_ID, name: 'Household bills', createdAt: T0, updatedAt: T0 }];
}

export function seedColumns(): Column[] {
  const cols: [string, Column['type'], string[]][] = [
    ['name', 'text', []],
    ['amount', 'number', []],
    ['due', 'date', []],
    ['paid', 'checkbox', []],
    ['category', 'select', ['Home', 'Travel', 'Leisure']],
  ];
  return cols.map(([id, type, options], i) => ({
    id,
    tableId: SEED_TABLE_ID,
    name: id === 'name' ? 'Name' : id === 'amount' ? 'Amount' : id === 'due' ? 'Due' : id === 'paid' ? 'Paid' : 'Category',
    type,
    options,
    order: i,
  }));
}

export function seedRows(): Row[] {
  const data: [string, number, string, boolean, string][] = [
    ['Electricity', 64.2, '2026-11-03', false, 'Home'],
    ['Water', 31.75, '2026-11-05', true, 'Home'],
    ['Broadband', 39.0, '2026-11-07', false, 'Home'],
    ['Library fine', 2.4, '2026-11-09', true, 'Leisure'],
    ['Train pass', 88.0, '2026-11-12', false, 'Travel'],
    ['Gym', 27.5, '2026-11-15', false, 'Leisure'],
    ['Ferry tickets', 46.1, '2026-11-21', false, 'Travel'],
    ['Boiler service', 95.0, '2026-11-28', false, 'Home'],
  ];
  return data.map(([name, amount, due, paid, category], i) => ({
    id: `seed-bills-row-${i + 1}`,
    tableId: SEED_TABLE_ID,
    values: { name, amount, due, paid, category },
    createdAt: i,
  }));
}

export const SEED_SAVED_FILTERS: { id: string; name: string; search: string; folder: string | null; tag: string | null; starredOnly: boolean }[] = [
  { id: 'all', name: 'All documents', search: '', folder: null, tag: null, starredOnly: false },
  { id: 'starred', name: 'Starred', search: '', folder: null, tag: null, starredOnly: true },
];

// Templates, in gallery order.
export interface TemplateDef {
  id: string;
  name: string;
  category: 'Journal' | 'Planning' | 'Reading';
  description: string;
  blocks: { type: Block['type']; text: string; checked?: boolean }[];
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'daily-note',
    name: 'Daily note',
    category: 'Journal',
    description: 'A short note for one day.',
    blocks: [
      { type: 'heading2', text: 'Today' },
      { type: 'todo', text: 'One thing to finish' },
      { type: 'heading2', text: 'Notes' },
      { type: 'paragraph', text: '' },
    ],
  },
  {
    id: 'weekly-review',
    name: 'Weekly review',
    category: 'Journal',
    description: 'Look back at the week in ten minutes.',
    blocks: [
      { type: 'heading2', text: 'What went well' },
      { type: 'paragraph', text: '' },
      { type: 'heading2', text: 'What to change' },
      { type: 'todo', text: 'Pick one change for next week' },
    ],
  },
  {
    id: 'meeting-notes',
    name: 'Meeting notes',
    category: 'Planning',
    description: 'Who came, what was decided, what is next.',
    blocks: [
      { type: 'heading2', text: 'Who was there' },
      { type: 'bulleted', text: 'Name' },
      { type: 'heading2', text: 'Decisions' },
      { type: 'todo', text: 'Next step' },
    ],
  },
  {
    id: 'trip-plan',
    name: 'Trip plan',
    category: 'Planning',
    description: 'Travel, beds and bookings on one page.',
    blocks: [
      { type: 'heading2', text: 'Getting there' },
      { type: 'heading2', text: 'Where to stay' },
      { type: 'todo', text: 'Book the first night' },
    ],
  },
  {
    id: 'book-notes',
    name: 'Book notes',
    category: 'Reading',
    description: 'Keep the lines and thoughts from a book.',
    blocks: [
      { type: 'heading2', text: 'Why I picked it up' },
      { type: 'quote', text: 'A line worth keeping' },
      { type: 'heading2', text: 'What stays with me' },
    ],
  },
  {
    id: 'reading-list',
    name: 'Reading list',
    category: 'Reading',
    description: 'Books to read next, ticked off as you go.',
    blocks: [
      { type: 'todo', text: 'First book on the list' },
      { type: 'todo', text: 'Second book on the list' },
    ],
  },
];

export function dailyNoteTemplate(): TemplateDef {
  return TEMPLATES[0];
}
