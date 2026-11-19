import type pg from 'pg';
import { LOCK_NAMESPACE, lockKey, transaction } from './pool.js';
import { upsertUser } from '../auth/identity.js';
import { grantCredits } from '../domain/ledger.js';
import { allocateSaleSplit, PLATFORM_HOLDER_NAME } from '../domain/split.js';
import { priceWithVat } from '../domain/vat.js';
import { objectKeys, putObject } from '../providers/storage.js';
import type { ResolvedAccount } from '../auth/keycloakAdmin.js';
import {
  LANTERN_STATIC,
  NIGHT_LOOM,
  SALT_HALO,
  TIDEWIRE_BLOOM,
} from './seedShaders.js';

const EXPORT_BYTES = Buffer.from('YWJj', 'base64');
const EXPORT_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

interface SeedUniform {
  name: string;
  label: string;
  min: number;
  max: number;
  value: number;
}

function uniforms(hue: number, film: number, drift: number): SeedUniform[] {
  return [
    { name: 'uHue', label: 'Hue', min: 0, max: 1, value: hue },
    { name: 'uFilm', label: 'Film thickness', min: 0, max: 1, value: film },
    { name: 'uDrift', label: 'Drift', min: 0, max: 2, value: drift },
  ];
}

const EMPTY_TIMELINE = { duration_s: 10, tracks: [], audio_asset_id: null };

const NIGHT_LOOM_TIMELINE = {
  duration_s: 10,
  tracks: [
    {
      uniform: 'uHue',
      keyframes: [
        { time_s: 0, value: 0.12, easing: 'ease-in-out' },
        { time_s: 5, value: 0.4, easing: 'ease-in-out' },
      ],
    },
  ],
  audio_asset_id: null,
};

interface SeedPiece {
  slug: string;
  title: string;
  creatorUsername: string;
  state: 'draft' | 'published';
  fragmentSource: string;
  uniforms: SeedUniform[];
  timeline: unknown;
  editionCount: number | null;
  priceCents: number | null;
  remixOfSlug: string | null;
  featured: boolean;
  publishedAt: string | null;
}

const SEED_PIECES: readonly SeedPiece[] = [
  {
    slug: 'tidewire-bloom',
    title: 'Tidewire Bloom',
    creatorUsername: 'ilse.marrow',
    state: 'published',
    fragmentSource: TIDEWIRE_BLOOM,
    uniforms: uniforms(0.58, 0.44, 0.8),
    timeline: EMPTY_TIMELINE,
    editionCount: 40,
    priceCents: 2400,
    remixOfSlug: null,
    featured: true,
    publishedAt: '2026-09-28T10:00:00Z',
  },
  {
    slug: 'salt-halo',
    title: 'Salt Halo',
    creatorUsername: 'ilse.marrow',
    state: 'published',
    fragmentSource: SALT_HALO,
    uniforms: uniforms(0.52, 0.36, 1.1),
    timeline: EMPTY_TIMELINE,
    editionCount: 12,
    priceCents: 999,
    remixOfSlug: null,
    featured: false,
    publishedAt: '2026-09-30T10:00:00Z',
  },
  {
    slug: 'lantern-static',
    title: 'Lantern Static',
    creatorUsername: 'tobi.ansel',
    state: 'published',
    fragmentSource: LANTERN_STATIC,
    uniforms: uniforms(0.1, 0.5, 0.7),
    timeline: EMPTY_TIMELINE,
    editionCount: 3,
    priceCents: 1200,
    remixOfSlug: null,
    featured: false,
    publishedAt: '2026-10-01T10:00:00Z',
  },
  {
    slug: 'halo-undertow',
    title: 'Halo Undertow',
    creatorUsername: 'tobi.ansel',
    state: 'published',
    fragmentSource: SALT_HALO,
    uniforms: uniforms(0.78, 0.62, 1.4),
    timeline: EMPTY_TIMELINE,
    editionCount: 25,
    priceCents: 1999,
    remixOfSlug: 'salt-halo',
    featured: false,
    publishedAt: '2026-10-02T10:00:00Z',
  },
  {
    slug: 'night-loom',
    title: 'Night Loom',
    creatorUsername: 'ilse.marrow',
    state: 'draft',
    fragmentSource: NIGHT_LOOM,
    uniforms: uniforms(0.12, 0.7, 0.5),
    timeline: NIGHT_LOOM_TIMELINE,
    editionCount: null,
    priceCents: null,
    remixOfSlug: null,
    featured: false,
    publishedAt: null,
  },
];

interface SeedOrder {
  invoiceNumber: string;
  paidOn: string;
  pieceSlug: string;
  edition: number;
  buyerUsername: string;
  billingCountry: string;
}

const SEED_ORDERS: readonly SeedOrder[] = [
  {
    invoiceNumber: 'PY-2026-000001',
    paidOn: '2026-10-02',
    pieceSlug: 'tidewire-bloom',
    edition: 1,
    buyerUsername: 'june.halloway',
    billingCountry: 'US',
  },
  {
    invoiceNumber: 'PY-2026-000002',
    paidOn: '2026-10-02',
    pieceSlug: 'lantern-static',
    edition: 1,
    buyerUsername: 'pax.ferreira',
    billingCountry: 'FR',
  },
  {
    invoiceNumber: 'PY-2026-000003',
    paidOn: '2026-10-03',
    pieceSlug: 'halo-undertow',
    edition: 4,
    buyerUsername: 'june.halloway',
    billingCountry: 'DE',
  },
  {
    invoiceNumber: 'PY-2026-000004',
    paidOn: '2026-10-04',
    pieceSlug: 'lantern-static',
    edition: 2,
    buyerUsername: 'june.halloway',
    billingCountry: 'US',
  },
  {
    invoiceNumber: 'PY-2026-000005',
    paidOn: '2026-10-05',
    pieceSlug: 'tidewire-bloom',
    edition: 5,
    buyerUsername: 'pax.ferreira',
    billingCountry: 'FR',
  },
];

const SEED_GRANTS: Readonly<Record<string, number>> = {
  'ilse.marrow': 600,
  'tobi.ansel': 40,
};

async function seedUsers(
  client: pg.PoolClient,
  accounts: readonly ResolvedAccount[],
): Promise<Map<string, string>> {
  const idByUsername = new Map<string, string>();
  for (const account of accounts) {
    const principal = await upsertUser(client, {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      email: account.email,
      roles: account.roles,
    });
    await client.query('UPDATE app_users SET seller_address = $2 WHERE id = $1', [
      principal.id,
      account.sellerAddress,
    ]);
    idByUsername.set(account.username, principal.id);
  }
  return idByUsername;
}

async function seedGrants(
  client: pg.PoolClient,
  idByUsername: ReadonlyMap<string, string>,
): Promise<void> {
  for (const [username, credits] of Object.entries(SEED_GRANTS)) {
    const userId = idByUsername.get(username);
    if (!userId) continue;
    const existing = await client.query(
      "SELECT 1 FROM credit_entries WHERE user_id = $1 AND kind = 'grant' LIMIT 1",
      [userId],
    );
    if (existing.rowCount === 0) {
      await grantCredits(client, 'grant', userId, credits);
    }
  }
}

async function seedPieces(
  client: pg.PoolClient,
  idByUsername: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const pieceIdBySlug = new Map<string, string>();

  for (const piece of SEED_PIECES) {
    const creatorId = idByUsername.get(piece.creatorUsername);
    if (!creatorId) throw new Error(`Seed piece ${piece.slug} has no creator`);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pieces (slug, title, creator_id, state, version, fragment_source, uniforms,
                           timeline, edition_count, price_cents, featured, published_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [
        piece.slug,
        piece.title,
        creatorId,
        piece.state,
        piece.fragmentSource,
        JSON.stringify(piece.uniforms),
        JSON.stringify(piece.timeline),
        piece.editionCount,
        piece.priceCents,
        piece.featured,
        piece.publishedAt,
      ],
    );
    const existing =
      inserted.rows[0]?.id ??
      (await client.query<{ id: string }>('SELECT id FROM pieces WHERE slug = $1', [piece.slug]))
        .rows[0]?.id;
    if (!existing) throw new Error(`Seed piece ${piece.slug} was not stored`);
    pieceIdBySlug.set(piece.slug, existing);
  }

  for (const piece of SEED_PIECES) {
    if (!piece.remixOfSlug) continue;
    await client.query('UPDATE pieces SET remix_of_id = $2 WHERE slug = $1 AND remix_of_id IS NULL', [
      piece.slug,
      pieceIdBySlug.get(piece.remixOfSlug),
    ]);
  }

  return pieceIdBySlug;
}

/** One ready 1080p, 16:9, 10-second MP4 export per published piece. */
async function seedExports(
  client: pg.PoolClient,
  pieceIdBySlug: ReadonlyMap<string, string>,
  idByUsername: ReadonlyMap<string, string>,
): Promise<string[]> {
  const objectKeysToStore: string[] = [];

  for (const piece of SEED_PIECES) {
    if (piece.state !== 'published') continue;
    const pieceId = pieceIdBySlug.get(piece.slug);
    const creatorId = idByUsername.get(piece.creatorUsername);
    if (!pieceId || !creatorId) continue;

    const current = await client.query<{ export_render_id: string | null }>(
      'SELECT export_render_id FROM pieces WHERE id = $1',
      [pieceId],
    );
    if (current.rows[0]?.export_render_id) continue;

    const history = [
      { state: 'accepted', at: piece.publishedAt },
      { state: 'queued', at: piece.publishedAt },
      { state: 'rendering', at: piece.publishedAt },
      { state: 'stored', at: piece.publishedAt },
      { state: 'ready', at: piece.publishedAt },
    ];
    const render = await client.query<{ id: string }>(
      `INSERT INTO render_jobs (piece_id, creator_id, state, cost_credits, attempts, format,
                                resolution, duration_s, aspect, sha256, history, credits_settled, created_at)
       VALUES ($1, $2, 'ready', 20, 1, 'mp4', '1080p', 10, '16:9', $3, $4, true, $5)
       RETURNING id`,
      [pieceId, creatorId, EXPORT_SHA256, JSON.stringify(history), piece.publishedAt],
    );
    const renderId = render.rows[0]?.id;
    if (!renderId) continue;

    const key = objectKeys.renderExport(renderId, 'mp4');
    await client.query('UPDATE render_jobs SET object_key = $2 WHERE id = $1', [renderId, key]);
    await client.query('UPDATE pieces SET export_render_id = $2 WHERE id = $1', [pieceId, renderId]);
    objectKeysToStore.push(key);
  }

  return objectKeysToStore;
}

/**
 * The five receipted seed orders. They start with receipt_status sent and
 * invoice_status pending, so the invoice retry renders their PDFs.
 */
async function seedOrders(
  client: pg.PoolClient,
  pieceIdBySlug: ReadonlyMap<string, string>,
  idByUsername: ReadonlyMap<string, string>,
): Promise<void> {
  for (const order of SEED_ORDERS) {
    const existing = await client.query('SELECT 1 FROM edition_orders WHERE invoice_number = $1', [
      order.invoiceNumber,
    ]);
    if (existing.rowCount && existing.rowCount > 0) continue;

    const piece = SEED_PIECES.find((candidate) => candidate.slug === order.pieceSlug);
    const pieceId = pieceIdBySlug.get(order.pieceSlug);
    const collectorId = idByUsername.get(order.buyerUsername);
    if (!piece || !pieceId || !collectorId || piece.priceCents === null || piece.editionCount === null) {
      continue;
    }

    const buyer = await client.query<{ display_name: string; email: string }>(
      'SELECT display_name, email FROM app_users WHERE id = $1',
      [collectorId],
    );
    const buyerRow = buyer.rows[0];
    if (!buyerRow) continue;

    const priced = priceWithVat(piece.priceCents, order.billingCountry);
    const paidAt = `${order.paidOn}T12:00:00Z`;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO edition_orders (piece_id, collector_id, edition_number, edition_count, state,
                                   billing_name, email, billing_country, net_cents, vat_rate_percent,
                                   vat_cents, gross_cents, invoice_number, invoice_status,
                                   receipt_status, paid_at, created_at)
       VALUES ($1, $2, $3, $4, 'receipted', $5, $6, $7, $8, $9, $10, $11, $12, 'pending', 'sent', $13, $13)
       RETURNING id`,
      [
        pieceId,
        collectorId,
        order.edition,
        piece.editionCount,
        buyerRow.display_name,
        buyerRow.email,
        order.billingCountry,
        priced.netCents,
        priced.vatRatePercent,
        priced.vatCents,
        priced.grossCents,
        order.invoiceNumber,
        paidAt,
      ],
    );
    const orderId = inserted.rows[0]?.id;
    if (!orderId) continue;

    const isRemix = piece.remixOfSlug !== null;
    const sourcePiece = isRemix
      ? SEED_PIECES.find((candidate) => candidate.slug === piece.remixOfSlug)
      : undefined;
    const originalCreatorUsername = sourcePiece?.creatorUsername ?? piece.creatorUsername;

    const holders: Readonly<Record<string, { id: string | null; name: string }>> = {
      creator: {
        id: idByUsername.get(originalCreatorUsername) ?? null,
        name: originalCreatorUsername,
      },
      remixer: { id: idByUsername.get(piece.creatorUsername) ?? null, name: piece.creatorUsername },
      platform: { id: null, name: PLATFORM_HOLDER_NAME },
    };

    for (const share of allocateSaleSplit(priced.netCents, isRemix)) {
      const holder = holders[share.party];
      if (!holder) continue;
      let holderName = holder.name;
      if (holder.id) {
        const named = await client.query<{ display_name: string }>(
          'SELECT display_name FROM app_users WHERE id = $1',
          [holder.id],
        );
        holderName = named.rows[0]?.display_name ?? holder.name;
      }
      await client.query(
        `INSERT INTO split_rows (order_id, party, holder_user_id, holder_name, kind, amount_cents, occurred_at)
         VALUES ($1, $2, $3, $4, 'sale', $5, $6)`,
        [orderId, share.party, holder.id, holderName, share.amountCents, paidAt],
      );
    }
  }
}

/** The seeded invoice numbers belong to 2026; the next number continues that run. */
async function seedSequences(client: pg.PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO number_sequences (kind, year, last_value) VALUES ('invoice', 2026, $1)
     ON CONFLICT (kind, year) DO NOTHING`,
    [SEED_ORDERS.length],
  );
  await client.query(
    `INSERT INTO number_sequences (kind, year, last_value) VALUES ('credit_note', 2026, 0)
     ON CONFLICT (kind, year) DO NOTHING`,
  );
}

/**
 * Applies the seed to an empty database, producing exactly the documented state.
 * Idempotent and safe to run on every instance at every boot.
 */
export async function applySeed(accounts: readonly ResolvedAccount[]): Promise<void> {
  const exportKeys = await transaction(async (client) => {
    await lockKey(client, LOCK_NAMESPACE.seed, 'phosphene-yard-seed');
    const idByUsername = await seedUsers(client, accounts);
    await seedGrants(client, idByUsername);
    const pieceIdBySlug = await seedPieces(client, idByUsername);
    const keys = await seedExports(client, pieceIdBySlug, idByUsername);
    await seedOrders(client, pieceIdBySlug, idByUsername);
    await seedSequences(client);
    return keys;
  });

  for (const key of exportKeys) {
    await putObject(key, EXPORT_BYTES, 'video/mp4').catch(() => undefined);
  }
}
