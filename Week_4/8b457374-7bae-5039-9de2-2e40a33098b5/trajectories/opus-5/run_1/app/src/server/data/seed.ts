import type { CampaignStatus } from '../../shared/types.js';
import { resolveLocalDeadline } from '../domain/timezone.js';
import { generateCoverPng } from '../render/coverPng.js';
import { putObjectConfirmed } from '../services/storage.js';
import { insertSeedPerson } from './people.js';
import { pool, type Db } from './db.js';
import { listFailedSeedMedia, setMediaStatus } from './media.js';

interface SeedTier {
  id: string;
  title: string;
  description: string;
  price: number;
  quantity: number | null;
  shipping: [number, number, number];
}

interface SeedCampaign {
  id: string;
  creator: string;
  title: string;
  story: string;
  status: CampaignStatus;
  goal: number;
  min_run_copies: number;
  stretch: { copies: number; amount: number }[];
  ships_from: string;
  time_zone: string;
  days_ahead: number;
  cover: boolean;
  tiers: SeedTier[];
}

const PEOPLE = [
  {
    id: 'mara-quillfeather',
    name: 'Mara Quillfeather',
    email: 'mara@quillfeather.example',
    key: 'dgk_mara_seed_4f1c0b7a9e2d4c68b3a1',
  },
  {
    id: 'ines-calloway',
    name: 'Ines Calloway',
    email: 'ines@inkshelter.example',
    key: 'dgk_ines_seed_8a2e6d1f0c9b4e37a5d2',
  },
  {
    id: 'tobias-ferrante',
    name: 'Tobias Ferrante',
    email: 'tobias@reader.example',
    key: 'dgk_tobias_seed_2b9c4e7a1d0f5e83c6',
  },
  {
    id: 'wren-adeyemi',
    name: 'Wren Adeyemi',
    email: 'wren@reader.example',
    key: 'dgk_wren_seed_6e3a9c2b8d1f4a70e5b9',
  },
] as const;

const CAMPAIGNS: readonly SeedCampaign[] = [
  {
    id: 'saltmarsh-nocturnes',
    creator: 'mara-quillfeather',
    title: 'Saltmarsh Nocturnes',
    story:
      'Twelve wordless night pieces drawn on the tidal flats east of the harbour, inked with a ' +
      'brush pen on hot-press paper and printed two-colour on an offset press. The printer quotes ' +
      'a 300-copy minimum run for the press setup, so this campaign goes to press only if the run ' +
      'is funded.\n\nEvery copy is saddle-stitched, 32 pages, 210 by 260 millimetres. The signed ' +
      'variant cover is hand-numbered in the margin. The original page tier is the inked board for ' +
      'one of the twelve pieces, posted flat between boards.',
    status: 'live',
    goal: 240_000,
    min_run_copies: 300,
    stretch: [
      { copies: 500, amount: 340_000 },
      { copies: 1_000, amount: 560_000 },
    ],
    ships_from: 'GB',
    time_zone: 'Europe/London',
    days_ahead: 30,
    cover: true,
    tiers: [
      {
        id: 'saltmarsh-reading-copy',
        title: 'Reading copy',
        description:
          'One copy of Saltmarsh Nocturnes, two-colour offset, saddle-stitched, posted in a board-backed envelope.',
        price: 1_200,
        quantity: null,
        shipping: [350, 700, 1_100],
      },
      {
        id: 'saltmarsh-signed-variant',
        title: 'Signed variant cover',
        description:
          'The variant cover edition, signed and hand-numbered in the margin. Two copies exist.',
        price: 2_500,
        quantity: 2,
        shipping: [350, 700, 1_100],
      },
      {
        id: 'saltmarsh-original-page',
        title: 'Original page',
        description:
          'The inked board for one of the twelve night pieces, posted flat between boards, with a reading copy.',
        price: 18_000,
        quantity: 1,
        shipping: [900, 1_800, 3_000],
      },
    ],
  },
  {
    id: 'fold-here',
    creator: 'ines-calloway',
    title: 'Fold Here',
    story:
      'A one-sheet zine about folding: maps, letters, paper boats and the creases that outlive ' +
      'them. Printed on a risograph in two spot colours, then folded by hand into a sixteen-page ' +
      'booklet with no staples.\n\nThe minimum run is 100 copies, which is what the paper order ' +
      'costs to be worth setting up the drum.',
    status: 'live',
    goal: 60_000,
    min_run_copies: 100,
    stretch: [{ copies: 250, amount: 120_000 }],
    ships_from: 'IE',
    time_zone: 'Europe/Dublin',
    days_ahead: 30,
    cover: true,
    tiers: [
      {
        id: 'fold-here-zine',
        title: 'Zine',
        description: 'One hand-folded copy of Fold Here, risograph printed in two spot colours.',
        price: 600,
        quantity: null,
        shipping: [120, 250, 400],
      },
      {
        id: 'fold-here-zine-and-print',
        title: 'Zine and risograph print',
        description:
          'The zine plus an A4 risograph print of the cover drawing, pulled from the same drum. Twenty-five exist.',
        price: 1_500,
        quantity: 25,
        shipping: [200, 450, 750],
      },
    ],
  },
  {
    id: 'wet-ink-almanac',
    creator: 'mara-quillfeather',
    title: 'Wet Ink Almanac',
    story:
      'A year of printing notes: paper weights, ink mixes, press settings and the days the ' +
      'register drifted. Still a draft while the printer quotes the paper.',
    status: 'draft',
    goal: 150_000,
    min_run_copies: 200,
    stretch: [],
    ships_from: 'GB',
    time_zone: 'Europe/London',
    days_ahead: 21,
    cover: false,
    tiers: [
      {
        id: 'wet-ink-almanac-copy',
        title: 'Almanac',
        description: 'One copy of the Wet Ink Almanac, perfect bound, 160 pages.',
        price: 1_800,
        quantity: null,
        shipping: [400, 800, 1_200],
      },
    ],
  },
];

const DAY_MS = 86_400_000;

/** 20:00 local on the date `daysAhead` days after first start, in the campaign's zone. */
function seedDeadline(zone: string, daysAhead: number): { local: string; instant: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = parts.split('-').map(Number);
  const target = new Date(
    Date.UTC(year as number, (month as number) - 1, day as number) + daysAhead * DAY_MS,
  );
  const date = target.toISOString().slice(0, 10);
  return resolveLocalDeadline(`${date}T20:00:00`, zone) as { local: string; instant: Date };
}

async function alreadySeeded(db: Db): Promise<boolean> {
  const result = await db.query<{ count: string }>('select count(*) as count from campaigns');
  return Number(result.rows[0]?.count ?? 0) > 0;
}

/** Inserted only when absent, so several starts against one database seed once. */
export async function seed(): Promise<void> {
  if (await alreadySeeded(pool)) {
    await storeSeedCovers();
    return;
  }

  for (const person of PEOPLE) {
    await insertSeedPerson(pool, person.id, person.name, person.email, person.key);
  }

  for (const campaign of CAMPAIGNS) {
    const deadline = seedDeadline(campaign.time_zone, campaign.days_ahead);
    await pool.query(
      `insert into campaigns (id, creator_id, title, story, status, goal, min_run_copies, stretch,
         ships_from, time_zone, deadline_local, deadline_utc, launched_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
       on conflict (id) do nothing`,
      [
        campaign.id,
        campaign.creator,
        campaign.title,
        campaign.story,
        campaign.status,
        campaign.goal,
        campaign.min_run_copies,
        JSON.stringify(campaign.stretch),
        campaign.ships_from,
        campaign.time_zone,
        deadline.local,
        deadline.instant,
        campaign.status === 'live' ? new Date() : null,
      ],
    );

    for (const [index, tier] of campaign.tiers.entries()) {
      await pool.query(
        `insert into tiers (id, campaign_id, title, description, price, quantity,
           ship_domestic, ship_europe, ship_rest_of_world, position)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (id) do nothing`,
        [
          tier.id,
          campaign.id,
          tier.title,
          tier.description,
          tier.price,
          tier.quantity,
          tier.shipping[0],
          tier.shipping[1],
          tier.shipping[2],
          index,
        ],
      );
    }

    if (!campaign.cover) continue;
    const mediaId = `${campaign.id}-cover`;
    await pool.query(
      `insert into media (id, campaign_id, kind, status, content_type, bytes, object_key, filename, position)
       values ($1, $2, 'cover', 'failed', 'image/png', 0, $3, $4, 0)
       on conflict (id) do nothing`,
      [
        mediaId,
        campaign.id,
        `campaigns/${campaign.id}/media/${mediaId}.png`,
        `${campaign.id}-cover.png`,
      ],
    );
  }

  await storeSeedCovers();
}

/** Seeded covers are stored at first start, or once storage returns. */
export async function storeSeedCovers(): Promise<void> {
  const pending = await listFailedSeedMedia(pool);
  for (const [index, row] of pending.entries()) {
    if (!row.id.endsWith('-cover')) continue;
    const png = generateCoverPng(800, index);
    try {
      if (!(await putObjectConfirmed(row.object_key, png, 'image/png'))) continue;
    } catch {
      return;
    }
    await pool.query('update media set bytes = $2 where id = $1', [row.id, png.length]);
    await setMediaStatus(pool, row.id, 'stored');
  }
}
