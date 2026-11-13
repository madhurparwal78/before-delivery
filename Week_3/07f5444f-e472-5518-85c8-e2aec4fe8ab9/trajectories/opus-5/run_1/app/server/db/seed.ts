import type { ProgrammeStatus } from '../../shared/api.js';
import { businessDateOf, addDaysToBusinessDate, wallClockToInstantMs } from '../../shared/london.js';
import { isSeated } from '../domain/seating.js';
import { chairLabelFor, stringSectionByChairKey } from '../domain/sections.js';
import type { Queryable } from './pool.js';

const PASSCODE = 'stand-desk-26';

const PART_NAMES: Record<string, string> = {
  vn1: 'Violin I',
  vn2: 'Violin II',
  va: 'Viola',
  vc: 'Cello',
  cb: 'Bass',
  fl1: 'Flute 1',
  fl2: 'Flute 2',
  ob1: 'Oboe 1',
  ob2: 'Oboe 2',
  cl1: 'Clarinet 1',
  cl2: 'Clarinet 2',
  bn1: 'Bassoon 1',
  bn2: 'Bassoon 2',
  hn1: 'Horn 1',
  hn2: 'Horn 2',
  tp1: 'Trumpet 1',
  timp: 'Timpani',
  hp: 'Harp',
};

const STRING_ROSTER: { chairKey: string; names: string[] }[] = [
  {
    chairKey: 'vn1',
    names: [
      'Hester Quayle',
      'Anouk Brennan',
      'Felix Ottaway',
      'Mireille Sato',
      'Joachim Varley',
      'Dagny Moss',
      'Kwame Ashdown',
      'Lior Pennick',
      'Saoirse Thalberg',
      'Bram Ellery',
    ],
  },
  {
    chairKey: 'vn2',
    names: [
      'Odile Farrant',
      'Casimir Rook',
      'Yusra Penhaligon',
      'Ewan Strickland',
      'Noor Castellane',
      'Pip Hadley',
      'Ilse Marchetti',
      'Tobiah Crane',
    ],
  },
  {
    chairKey: 'va',
    names: ['Ruairi Delacourt', 'Maren Okafor', 'Silas Wren', 'Agathe Lowry', 'Dev Kingsmill', 'Juno Halvorsen'],
  },
  {
    chairKey: 'vc',
    names: ['Clemency Arkwright', 'Matthias Obi', 'Wren Takahashi', 'Esther Galloway', 'Leopold Ince'],
  },
  { chairKey: 'cb', names: ['Ottilie Brace', 'Rafferty Nakamura', 'Gwen Abernethy', 'Idris Fairweather'] },
];

const SINGLE_CHAIRS: { chairKey: string; name: string }[] = [
  { chairKey: 'fl1', name: 'Sunniva Pike' },
  { chairKey: 'fl2', name: 'Hollis Drummond' },
  { chairKey: 'ob1', name: 'Marguerite Esk' },
  { chairKey: 'ob2', name: 'Cyrus Bellamy' },
  { chairKey: 'cl1', name: 'Tamsin Vey' },
  { chairKey: 'cl2', name: 'Arlo Mendes' },
  { chairKey: 'bn1', name: 'Philippa Groat' },
  { chairKey: 'bn2', name: 'Emeric Shaw' },
  { chairKey: 'hn1', name: 'Bettany Lusk' },
  { chairKey: 'hn2', name: 'Ansel Morrow' },
  { chairKey: 'tp1', name: 'Kit Ravensworth' },
  { chairKey: 'timp', name: 'Delphine Oakes' },
  { chairKey: 'hp', name: 'Isolde Fenn' },
];

interface CataloguePartSeed {
  chairKey: string;
  barsFrom?: number;
  barsTo?: number;
}

interface CatalogueWorkSeed {
  id: string;
  title: string;
  composer: string;
  bars: number;
  barMap: { from: number; to: number; ms: number }[];
  letters: { letter: string; bar: number }[];
  parts: CataloguePartSeed[];
}

const FIVE_STRINGS: CataloguePartSeed[] = [
  { chairKey: 'vn1' },
  { chairKey: 'vn2' },
  { chairKey: 'va' },
  { chairKey: 'vc' },
  { chairKey: 'cb' },
];

const CATALOGUE: CatalogueWorkSeed[] = [
  {
    id: 'cw-the-weir',
    title: 'The Weir',
    composer: 'Edith Marrow',
    bars: 300,
    barMap: [
      { from: 1, to: 119, ms: 2400 },
      { from: 120, to: 184, ms: 4123 },
      { from: 185, to: 300, ms: 2500 },
    ],
    letters: [
      { letter: 'A', bar: 25 },
      { letter: 'B', bar: 61 },
      { letter: 'C', bar: 97 },
      { letter: 'D', bar: 133 },
      { letter: 'E', bar: 169 },
      { letter: 'F', bar: 205 },
      { letter: 'G', bar: 241 },
      { letter: 'H', bar: 277 },
    ],
    parts: [
      ...FIVE_STRINGS,
      { chairKey: 'fl1' },
      { chairKey: 'fl2' },
      { chairKey: 'ob1' },
      { chairKey: 'ob2' },
      { chairKey: 'cl1' },
      { chairKey: 'cl2' },
      { chairKey: 'bn1' },
      { chairKey: 'bn2' },
      { chairKey: 'hn1' },
      { chairKey: 'timp', barsFrom: 1, barsTo: 110 },
      { chairKey: 'hp', barsFrom: 185, barsTo: 300 },
    ],
  },
  {
    id: 'cw-fen-country-dances',
    title: 'Fen Country Dances',
    composer: 'Tobias Fenwick',
    bars: 410,
    barMap: [{ from: 1, to: 410, ms: 3600 }],
    letters: [
      { letter: 'A', bar: 41 },
      { letter: 'B', bar: 81 },
      { letter: 'C', bar: 121 },
      { letter: 'D', bar: 161 },
      { letter: 'E', bar: 201 },
      { letter: 'F', bar: 241 },
      { letter: 'G', bar: 281 },
      { letter: 'H', bar: 321 },
      { letter: 'J', bar: 361 },
    ],
    parts: [
      ...FIVE_STRINGS,
      { chairKey: 'fl1' },
      { chairKey: 'fl2' },
      { chairKey: 'ob1' },
      { chairKey: 'ob2' },
      { chairKey: 'cl1' },
      { chairKey: 'cl2' },
      { chairKey: 'bn1' },
      { chairKey: 'bn2' },
      { chairKey: 'hn1' },
      { chairKey: 'hn2' },
      { chairKey: 'tp1' },
      { chairKey: 'timp' },
    ],
  },
  {
    id: 'cw-lantern-procession',
    title: 'Lantern Procession',
    composer: 'Ines Halloran',
    bars: 240,
    barMap: [{ from: 1, to: 240, ms: 2750 }],
    letters: [
      { letter: 'A', bar: 33 },
      { letter: 'B', bar: 65 },
      { letter: 'C', bar: 97 },
      { letter: 'D', bar: 129 },
      { letter: 'E', bar: 161 },
      { letter: 'F', bar: 193 },
      { letter: 'G', bar: 225 },
    ],
    parts: [
      ...FIVE_STRINGS,
      { chairKey: 'fl1' },
      { chairKey: 'ob1' },
      { chairKey: 'cl1' },
      { chairKey: 'bn1' },
      { chairKey: 'hn1' },
      { chairKey: 'hn2' },
      { chairKey: 'tp1' },
      { chairKey: 'timp' },
    ],
  },
  {
    id: 'cw-ferry-at-dusk',
    title: 'Ferry at Dusk',
    composer: 'Edith Marrow',
    bars: 180,
    barMap: [{ from: 1, to: 180, ms: 2000 }],
    letters: [
      { letter: 'A', bar: 31 },
      { letter: 'B', bar: 61 },
      { letter: 'C', bar: 91 },
      { letter: 'D', bar: 121 },
      { letter: 'E', bar: 151 },
    ],
    parts: [
      ...FIVE_STRINGS,
      { chairKey: 'fl1' },
      { chairKey: 'fl2' },
      { chairKey: 'ob1' },
      { chairKey: 'cl1' },
      { chairKey: 'bn1' },
      { chairKey: 'hn1' },
    ],
  },
  {
    id: 'cw-orchard-serenade',
    title: 'Orchard Serenade',
    composer: 'Ines Halloran',
    bars: 200,
    barMap: [{ from: 1, to: 200, ms: 3000 }],
    letters: [
      { letter: 'A', bar: 41 },
      { letter: 'B', bar: 81 },
      { letter: 'C', bar: 121 },
      { letter: 'D', bar: 161 },
    ],
    parts: [...FIVE_STRINGS],
  },
];

interface ProgrammeSeed {
  id: string;
  number: number;
  title: string;
  status: ProgrammeStatus;
  firstRehearsal: [number, string];
  performances: [number, string][];
  stringCount: [number, number, number, number, number];
  works: string[];
  holdings: Record<string, number>;
  defaultHolding: number;
}

const STRING_HOLDINGS_8754 = { vn1: 5, vn2: 4, va: 3, vc: 3, cb: 2 };

const PROGRAMMES: ProgrammeSeed[] = [
  {
    id: 'p01',
    number: 1,
    title: 'Rivers and Weirs',
    status: 'in_preparation',
    firstRehearsal: [21, '10:00'],
    performances: [
      [25, '19:30'],
      [26, '19:30'],
    ],
    stringCount: [8, 7, 6, 5, 4],
    works: ['cw-the-weir', 'cw-fen-country-dances'],
    holdings: STRING_HOLDINGS_8754,
    defaultHolding: 1,
  },
  {
    id: 'p02',
    number: 2,
    title: 'Winter Lanterns',
    status: 'published',
    firstRehearsal: [5, '10:00'],
    performances: [
      [8, '19:30'],
      [9, '14:30'],
    ],
    stringCount: [10, 8, 6, 5, 4],
    works: ['cw-lantern-procession'],
    holdings: { vn1: 6, vn2: 5, va: 3, vc: 3, cb: 2 },
    defaultHolding: 1,
  },
  {
    id: 'p03',
    number: 3,
    title: 'Spring Overtures',
    status: 'draft',
    firstRehearsal: [60, '10:00'],
    performances: [[64, '19:30']],
    stringCount: [8, 7, 6, 5, 4],
    works: ['cw-ferry-at-dusk'],
    holdings: {},
    defaultHolding: 0,
  },
  {
    id: 'p04',
    number: 4,
    title: 'Harvest Serenades',
    status: 'closed',
    firstRehearsal: [-24, '10:00'],
    performances: [
      [-20, '19:30'],
      [-16, '19:30'],
    ],
    stringCount: [8, 7, 6, 5, 4],
    works: ['cw-orchard-serenade'],
    holdings: STRING_HOLDINGS_8754,
    defaultHolding: 1,
  },
];

function seedDate(offsetDays: number, time: string): Date {
  const date = addDaysToBusinessDate(businessDateOf(Date.now()), offsetDays);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const instant = wallClockToInstantMs({ year, month, day, hour, minute });
  if (instant === null) throw new Error(`seed time ${date} ${time} does not exist in London`);
  return new Date(instant);
}

function programmeWorkId(programmeId: string, catalogueWorkId: string): string {
  return `${programmeId}-${catalogueWorkId.replace(/^cw-/, '')}`;
}

async function seedPeople(db: Queryable): Promise<void> {
  const staff: { id: string; name: string; email: string; role: string }[] = [
    { id: 'u-rowan', name: 'Rowan Achterberg', email: 'rowan@quirewell.test', role: 'principal_librarian' },
    { id: 'u-priya', name: 'Priya Lindqvist', email: 'priya@quirewell.test', role: 'assistant_librarian' },
    { id: 'u-tomasz', name: 'Tomasz Ebdon', email: 'tomasz@quirewell.test', role: 'assistant_librarian' },
  ];
  for (const person of staff) {
    await db.query(`INSERT INTO people (id, name, email, passcode, role) VALUES ($1, $2, $3, $4, $5)`, [
      person.id,
      person.name,
      person.email,
      PASSCODE,
      person.role,
    ]);
  }

  for (const section of STRING_ROSTER) {
    const sectionName = stringSectionByChairKey(section.chairKey)?.name ?? section.chairKey;
    for (const [index, name] of section.names.entries()) {
      const number = index + 1;
      const chairNumber = String(number).padStart(2, '0');
      await db.query(
        `INSERT INTO people (id, name, email, passcode, role, chair_key, chair_section, chair_number, chair_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          `u-${section.chairKey}-${chairNumber}`,
          name,
          `${section.chairKey}-${chairNumber}@players.quirewell.test`,
          PASSCODE,
          number === 1 ? 'section_principal' : 'player',
          section.chairKey,
          sectionName,
          number,
          chairLabelFor(section.chairKey, number, sectionName),
        ],
      );
    }
  }

  for (const chair of SINGLE_CHAIRS) {
    const partName = PART_NAMES[chair.chairKey] ?? chair.chairKey;
    await db.query(
      `INSERT INTO people (id, name, email, passcode, role, chair_key, chair_section, chair_number, chair_label)
       VALUES ($1, $2, $3, $4, 'player', $5, $6, 1, $7)`,
      [
        `u-${chair.chairKey}`,
        chair.name,
        `${chair.chairKey}@players.quirewell.test`,
        PASSCODE,
        chair.chairKey,
        partName,
        partName,
      ],
    );
  }
}

async function seedCatalogue(db: Queryable): Promise<void> {
  for (const [index, work] of CATALOGUE.entries()) {
    await db.query(`INSERT INTO catalogue_works (id, title, composer, bars, ord) VALUES ($1, $2, $3, $4, $5)`, [
      work.id,
      work.title,
      work.composer,
      work.bars,
      index + 1,
    ]);
    for (const span of work.barMap) {
      await db.query(
        `INSERT INTO catalogue_bar_spans (catalogue_work_id, from_bar, to_bar, bar_ms) VALUES ($1, $2, $3, $4)`,
        [work.id, span.from, span.to, span.ms],
      );
    }
    for (const letter of work.letters) {
      await db.query(`INSERT INTO catalogue_letters (catalogue_work_id, letter, bar) VALUES ($1, $2, $3)`, [
        work.id,
        letter.letter,
        letter.bar,
      ]);
    }
    for (const [partIndex, part] of work.parts.entries()) {
      await db.query(
        `INSERT INTO catalogue_parts (catalogue_work_id, chair_key, name, bars_from, bars_to, ord)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          work.id,
          part.chairKey,
          PART_NAMES[part.chairKey] ?? part.chairKey,
          part.barsFrom ?? 1,
          part.barsTo ?? work.bars,
          partIndex + 1,
        ],
      );
    }
  }
}

async function seedProgrammes(db: Queryable): Promise<void> {
  for (const programme of PROGRAMMES) {
    await db.query(
      `INSERT INTO programmes (id, number, title, status, first_rehearsal, violin_1, violin_2, viola, cello, bass)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        programme.id,
        programme.number,
        programme.title,
        programme.status,
        seedDate(programme.firstRehearsal[0], programme.firstRehearsal[1]),
        ...programme.stringCount,
      ],
    );
    for (const performance of programme.performances) {
      await db.query(`INSERT INTO performances (programme_id, at) VALUES ($1, $2)`, [
        programme.id,
        seedDate(performance[0], performance[1]),
      ]);
    }
    for (const [workIndex, catalogueWorkId] of programme.works.entries()) {
      const workId = programmeWorkId(programme.id, catalogueWorkId);
      await db.query(
        `INSERT INTO programme_works (id, programme_id, catalogue_work_id, ord) VALUES ($1, $2, $3, $4)`,
        [workId, programme.id, catalogueWorkId, workIndex + 1],
      );
      const catalogueWork = CATALOGUE.find((work) => work.id === catalogueWorkId);
      if (!catalogueWork) throw new Error(`unknown catalogue work: ${catalogueWorkId}`);
      for (const [partIndex, part] of catalogueWork.parts.entries()) {
        await db.query(
          `INSERT INTO parts (id, programme_work_id, chair_key, name, bars_from, bars_to, ord, copies_on_hand)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            `${workId}-${part.chairKey}`,
            workId,
            part.chairKey,
            PART_NAMES[part.chairKey] ?? part.chairKey,
            part.barsFrom ?? 1,
            part.barsTo ?? catalogueWork.bars,
            partIndex + 1,
            programme.holdings[part.chairKey] ?? programme.defaultHolding,
          ],
        );
      }
    }
  }
}

async function seedCutsAndMarks(db: Queryable): Promise<void> {
  const workId = programmeWorkId('p02', 'cw-lantern-procession');
  await db.query(
    `INSERT INTO cuts (id, programme_work_id, from_bar, to_bar, created_at) VALUES ($1, $2, 97, 128, $3)`,
    ['ct-lantern-97-128', workId, seedDate(-4, '10:00')],
  );
  await db.query(
    `INSERT INTO marks (part_id, cut_id, marked_by, marked_at)
     SELECT id, $2, 'u-priya', $3 FROM parts WHERE programme_work_id = $1`,
    [workId, 'ct-lantern-97-128', seedDate(-3, '10:00')],
  );
}

async function seedNotices(db: Queryable): Promise<void> {
  const programme = PROGRAMMES.find((entry) => entry.id === 'p02');
  if (!programme) throw new Error('programme 02 is missing from the seed');
  const stringCount = {
    violin_1: programme.stringCount[0],
    violin_2: programme.stringCount[1],
    viola: programme.stringCount[2],
    cello: programme.stringCount[3],
    bass: programme.stringCount[4],
  };
  const chairKeys = new Set(
    programme.works.flatMap((catalogueWorkId) => {
      const work = CATALOGUE.find((entry) => entry.id === catalogueWorkId);
      return work ? work.parts.map((part) => part.chairKey) : [];
    }),
  );
  const people = await db.query<{ id: string; chair_key: string; chair_number: number; chair_label: string }>(
    `SELECT id, chair_key, chair_number, chair_label FROM people WHERE chair_key IS NOT NULL`,
  );
  for (const person of people.rows) {
    const seated = isSeated(
      { key: person.chair_key, section: '', number: person.chair_number, label: person.chair_label },
      stringCount,
      chairKeys,
    );
    if (!seated) continue;
    await db.query(
      `INSERT INTO notices (programme_id, player_id, chair_label, status, sent_at)
       VALUES ('p02', $1, $2, 'sent', now())`,
      [person.id, person.chair_label],
    );
  }
}

async function seedRentalSets(db: Queryable): Promise<void> {
  const lanternWork = programmeWorkId('p02', 'cw-lantern-procession');
  await db.query(
    `INSERT INTO rental_sets (id, programme_work_id, publisher, status) VALUES ($1, $2, $3, 'in_use')`,
    ['rs-lantern', lanternWork, 'Hartwell & Rye Music Hire'],
  );
  const lanternSlip: Record<string, number> = { vn1: 6, vn2: 5, va: 3, vc: 3, cb: 2 };
  const lanternParts = await db.query<{ id: string; chair_key: string; ord: number }>(
    `SELECT id, chair_key, ord FROM parts WHERE programme_work_id = $1 ORDER BY ord`,
    [lanternWork],
  );
  for (const part of lanternParts.rows) {
    await db.query(
      `INSERT INTO rental_slip_lines (rental_set_id, part_id, copies, checked_in, ord) VALUES ($1, $2, $3, 0, $4)`,
      ['rs-lantern', part.id, lanternSlip[part.chair_key] ?? 1, part.ord],
    );
  }

  const orchardWork = programmeWorkId('p04', 'cw-orchard-serenade');
  await db.query(
    `INSERT INTO rental_sets (id, programme_work_id, publisher, status) VALUES ($1, $2, $3, 'in_use')`,
    ['rs-orchard', orchardWork, 'Calder Press Hire Library'],
  );
  const orchardSlip: Record<string, { copies: number; checkedIn: number }> = {
    vn1: { copies: 5, checkedIn: 5 },
    vn2: { copies: 4, checkedIn: 4 },
    va: { copies: 3, checkedIn: 3 },
    vc: { copies: 3, checkedIn: 2 },
    cb: { copies: 2, checkedIn: 2 },
  };
  const orchardParts = await db.query<{ id: string; chair_key: string; ord: number }>(
    `SELECT id, chair_key, ord FROM parts WHERE programme_work_id = $1 ORDER BY ord`,
    [orchardWork],
  );
  for (const part of orchardParts.rows) {
    const line = orchardSlip[part.chair_key];
    if (!line) continue;
    await db.query(
      `INSERT INTO rental_slip_lines (rental_set_id, part_id, copies, checked_in, ord) VALUES ($1, $2, $3, $4, $5)`,
      ['rs-orchard', part.id, line.copies, line.checkedIn, part.ord],
    );
  }
  await db.query(
    `INSERT INTO rental_reminders (rental_set_id, person_id, status, sent_at)
     SELECT 'rs-orchard', id, 'sent', now() FROM people WHERE role = 'assistant_librarian'`,
  );
}

/** Seeds the records in the brief, and only while the database is empty. */
export async function seedIfEmpty(db: Queryable): Promise<void> {
  const existing = await db.query<{ total: number }>(`SELECT count(*)::int AS total FROM people`);
  if ((existing.rows[0]?.total ?? 0) > 0) return;
  await seedPeople(db);
  await seedCatalogue(db);
  await seedProgrammes(db);
  await seedCutsAndMarks(db);
  await seedNotices(db);
  await seedRentalSets(db);
}
