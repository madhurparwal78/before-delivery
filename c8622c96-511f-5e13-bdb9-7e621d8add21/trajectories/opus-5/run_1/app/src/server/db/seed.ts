import type { EssayState } from '../../domain/lifecycle.js';
import { resolveCoopWallTime } from '../../domain/time.js';
import {
  encodeOriginal,
  gridDerivative,
  halftoneRaster,
  previewDerivative,
  storyDerivative,
} from '../images.js';
import { hashPassword } from '../data/people.js';
import { query } from './pool.js';
import { SCHEMA_SQL } from './schema.js';
import { ensureBucket, objectExists, putDerivative, putOriginal } from '../services/storage.js';

const SEED_PASSWORD = 'darkroom-proof-26';
const SEED_CLOCK = '2026-10-28T12:00:00Z';

interface SeedPerson {
  id: string;
  name: string;
  email: string;
  role: string;
  newsroom: string | null;
  handle: string | null;
  payoutAccount: string | null;
}

const NEWSROOMS = [
  { slug: 'harbor-light', name: 'Harbor Light Herald', zone: 'America/New_York' },
  { slug: 'mesa-sentinel', name: 'Mesa Daily Sentinel', zone: 'America/Phoenix' },
  { slug: 'thames-post', name: 'Thames Evening Post', zone: 'Europe/London' },
];

const PEOPLE: SeedPerson[] = [
  {
    id: 'person-ines',
    name: 'Ines Okafor-Lund',
    email: 'ines@saltprint.example',
    role: 'desk_editor',
    newsroom: null,
    handle: null,
    payoutAccount: null,
  },
  {
    id: 'person-bram',
    name: 'Bram Kettleworth',
    email: 'bram@saltprint.example',
    role: 'treasurer',
    newsroom: null,
    handle: null,
    payoutAccount: null,
  },
  {
    id: 'person-ada',
    name: 'Ada Reyes',
    email: 'ada@contributors.saltprint.example',
    role: 'contributor',
    newsroom: null,
    handle: 'ada-reyes',
    payoutAccount: 'Ozark Teachers Credit Union ••4417',
  },
  {
    id: 'person-tomas',
    name: 'Tomas Whitcombe',
    email: 'tomas@contributors.saltprint.example',
    role: 'contributor',
    newsroom: null,
    handle: 'tomas-whitcombe',
    payoutAccount: 'Prairie Mutual Savings ••0932',
  },
  {
    id: 'person-noor',
    name: 'Noor Haddad',
    email: 'noor@contributors.saltprint.example',
    role: 'contributor',
    newsroom: null,
    handle: 'noor-haddad',
    payoutAccount: 'Gulfside Community Bank ••2268',
  },
  {
    id: 'person-priya',
    name: 'Priya Lowell',
    email: 'priya@harbor-light.example',
    role: 'picture_editor',
    newsroom: 'harbor-light',
    handle: null,
    payoutAccount: null,
  },
  {
    id: 'person-dev',
    name: 'Dev Marsh',
    email: 'dev@harbor-light.example',
    role: 'picture_editor',
    newsroom: 'harbor-light',
    handle: null,
    payoutAccount: null,
  },
  {
    id: 'person-june',
    name: 'June Castellanos',
    email: 'june@harbor-light.example',
    role: 'licensing_manager',
    newsroom: 'harbor-light',
    handle: null,
    payoutAccount: null,
  },
  {
    id: 'person-wes',
    name: 'Wes Tallbridge',
    email: 'wes@mesa-sentinel.example',
    role: 'picture_editor',
    newsroom: 'mesa-sentinel',
    handle: null,
    payoutAccount: null,
  },
  {
    id: 'person-carmen',
    name: 'Carmen Oduya',
    email: 'carmen@mesa-sentinel.example',
    role: 'licensing_manager',
    newsroom: 'mesa-sentinel',
    handle: null,
    payoutAccount: null,
  },
  {
    id: 'person-hollis',
    name: 'Hollis Brandt',
    email: 'hollis@thames-post.example',
    role: 'picture_editor',
    newsroom: 'thames-post',
    handle: null,
    payoutAccount: null,
  },
  {
    id: 'person-margot',
    name: 'Margot Fenwick',
    email: 'margot@thames-post.example',
    role: 'licensing_manager',
    newsroom: 'thames-post',
    handle: null,
    payoutAccount: null,
  },
];

interface SeedEssay {
  id: string;
  title: string;
  caption: string;
  credits: Array<[string, number]>;
  state: EssayState;
  liftLocal: string;
  exclusiveDays: number;
  exclusivePriceMinor: number;
  standardDays: number;
  standardPriceMinor: number;
  frames: number;
  deskNote?: string;
}

const ESSAYS: SeedEssay[] = [
  {
    id: 'floodplain-ledger',
    title: 'Floodplain Ledger',
    caption: 'Six months on the levee road after the spring crest.',
    credits: [
      ['ada-reyes', 6000],
      ['noor-haddad', 4000],
    ],
    state: 'live',
    liftLocal: '2026-10-20T09:00',
    exclusiveDays: 3,
    exclusivePriceMinor: 45000,
    standardDays: 7,
    standardPriceMinor: 12000,
    frames: 6,
    deskNote: 'Family on frame 4 gave consent by phone; keep this off newsroom copy.',
  },
  {
    id: 'night-shift-grain',
    title: 'Night Shift at the Grain Elevator',
    caption: 'Harvest crews working the overnight load-out.',
    credits: [['tomas-whitcombe', 10000]],
    state: 'embargoed',
    liftLocal: '2026-11-01T01:30',
    exclusiveDays: 2,
    exclusivePriceMinor: 30000,
    standardDays: 5,
    standardPriceMinor: 9000,
    frames: 4,
  },
  {
    id: 'salt-marsh-census',
    title: 'Salt Marsh Census',
    caption: 'Volunteers counting nesting rails at dawn.',
    credits: [
      ['ada-reyes', 5000],
      ['tomas-whitcombe', 3333],
      ['noor-haddad', 1667],
    ],
    state: 'live',
    liftLocal: '2026-10-12T07:00',
    exclusiveDays: 1,
    exclusivePriceMinor: 25000,
    standardDays: 3,
    standardPriceMinor: 8000,
    frames: 5,
  },
  {
    id: 'border-choir',
    title: 'Border Choir',
    caption: 'A church choir that rehearses on both banks.',
    credits: [['noor-haddad', 10000]],
    state: 'in_review',
    liftLocal: '2026-11-05T07:00',
    exclusiveDays: 2,
    exclusivePriceMinor: 20000,
    standardDays: 7,
    standardPriceMinor: 6000,
    frames: 3,
  },
  {
    id: 'river-series-draft',
    title: 'Untitled river series',
    caption: '',
    credits: [['ada-reyes', 10000]],
    state: 'draft',
    liftLocal: '2026-11-20T08:00',
    exclusiveDays: 3,
    exclusivePriceMinor: 15000,
    standardDays: 7,
    standardPriceMinor: 5000,
    frames: 2,
  },
];

/** Schema and seed data are applied on every serve, so an empty database works. */
export async function applySchemaAndSeed(): Promise<void> {
  await query(SCHEMA_SQL);
  for (const newsroom of NEWSROOMS) {
    await query(
      `insert into newsrooms (slug, name, home_zone) values ($1, $2, $3)
       on conflict (slug) do update set name = excluded.name, home_zone = excluded.home_zone`,
      [newsroom.slug, newsroom.name, newsroom.zone],
    );
  }
  const passwordHash = hashPassword(SEED_PASSWORD);
  for (const person of PEOPLE) {
    await query(
      `insert into people (id, email, name, role, newsroom_slug, contributor_handle, payout_account, password_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do nothing`,
      [
        person.id,
        person.email,
        person.name,
        person.role,
        person.newsroom,
        person.handle,
        person.payoutAccount,
        passwordHash,
      ],
    );
  }
  await query(
    `insert into commission_rates (effective_from, rate_bp) values ('2026-01-01', 3000)
     on conflict (effective_from) do nothing`,
  );
  for (const essay of ESSAYS) {
    const lift = resolveCoopWallTime(essay.liftLocal);
    const inserted = await query<{ id: string }>(
      `insert into essays (id, title, caption, lift_local, lift_at, lift_resolution, exclusive_days,
         standard_days, exclusive_price_minor, standard_price_minor, state, version, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12)
       on conflict (id) do nothing returning id`,
      [
        essay.id,
        essay.title,
        essay.caption,
        essay.liftLocal,
        lift.at,
        lift.resolution,
        essay.exclusiveDays,
        essay.standardDays,
        essay.exclusivePriceMinor,
        essay.standardPriceMinor,
        essay.state,
        essay.state === 'in_review' ? lift.at : null,
      ],
    );
    if (inserted.rows.length === 0) continue;
    for (let index = 0; index < essay.credits.length; index += 1) {
      const credit = essay.credits[index] as [string, number];
      await query(
        'insert into essay_credits (essay_id, position, contributor_handle, split_bp) values ($1, $2, $3, $4)',
        [essay.id, index + 1, credit[0], credit[1]],
      );
    }
    for (let position = 1; position <= essay.frames; position += 1) {
      await query(
        `insert into frames (id, essay_id, position, caption, filename, bytes, content_type, width, height)
         values ($1, $2, $3, $4, $5, $6, 'image/jpeg', 1600, 1200)`,
        [
          `${essay.id}-f${position}`,
          essay.id,
          position,
          `${essay.title}, frame ${position}`,
          `${essay.id}-frame-${position}.jpg`,
          0,
        ],
      );
    }
    if (essay.deskNote) {
      await query('insert into desk_notes (id, essay_id, note, at) values ($1, $2, $3, $4)', [
        `${essay.id}-note-1`,
        essay.id,
        essay.deskNote,
        new Date(SEED_CLOCK),
      ]);
    }
  }
  const clock = await query<{ offset_ms: string }>('select offset_ms from clock_offset');
  if (clock.rows.length === 0) {
    await query('insert into clock_offset (only_row, offset_ms) values (true, $1)', [
      new Date(SEED_CLOCK).getTime() - Date.now(),
    ]);
  }
}

/** Lets the HTTP server run between the stages of a seeded frame's imagery. */
function yieldToRequests(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Generates the procedural halftone originals and derivatives that are still missing. */
export async function seedMedia(): Promise<void> {
  await ensureBucket();
  const frames = await query<{ id: string; essay_id: string }>(
    'select id, essay_id from frames order by essay_id, position',
  );
  for (const frame of frames.rows) {
    const originalKey = `originals/${frame.essay_id}/${frame.id}`;
    if (await objectExists(originalKey)) continue;
    const raster = halftoneRaster(frame.id);
    await yieldToRequests();
    const original = encodeOriginal(raster);
    await putOriginal(frame.essay_id, frame.id, original, 'image/jpeg');
    await yieldToRequests();
    await putDerivative(frame.essay_id, frame.id, 'grid', gridDerivative(raster));
    await yieldToRequests();
    await putDerivative(frame.essay_id, frame.id, 'preview', previewDerivative(raster));
    await yieldToRequests();
    await putDerivative(frame.essay_id, frame.id, 'story', storyDerivative(raster));
    await query('update frames set bytes = $2, width = $3, height = $4 where id = $1', [
      frame.id,
      original.length,
      raster.width,
      raster.height,
    ]);
    await yieldToRequests();
  }
}
