import type { AppConfig } from './config.js';
import type { Pool, PoolClient } from './db.js';
import { KeycloakClient } from './keycloak.js';
import type { KillBillClient } from './killbill.js';
import { holdForOrder, type Outcome } from './domain.js';
import { memberAccount, postJournalEntry, venueAccount } from './ledger.js';

export interface SeedVenue {
  slug: string;
  name: string;
  timeZone: string;
  takerFeeBps: number;
  makerFeeBps: number;
  flagship: string;
}

export interface SeedPerson {
  username: string;
  displayName: string;
  email: string;
  venueSlug: string | null;
  roles: string[];
}

export const SEED_VENUES: SeedVenue[] = [
  { slug: 'harbor', name: 'Harbor Lantern Club', timeZone: 'America/New_York', takerFeeBps: 125, makerFeeBps: 0, flagship: 'RAIN' },
  { slug: 'copper', name: 'Copperfield Pool', timeZone: 'Europe/London', takerFeeBps: 50, makerFeeBps: 10, flagship: 'FROST' },
];

export const SEED_PEOPLE: SeedPerson[] = [
  { username: 'hl-owner', displayName: 'Mara Quill', email: 'mara.quill@harbor.example', venueSlug: 'harbor', roles: ['org_owner'] },
  { username: 'hl-admin', displayName: 'Teo Brandt', email: 'teo.brandt@harbor.example', venueSlug: 'harbor', roles: ['market_admin'] },
  { username: 'hl-ana', displayName: 'Ana Pike', email: 'ana.pike@harbor.example', venueSlug: 'harbor', roles: ['trader'] },
  { username: 'hl-bo', displayName: 'Bo Lindqvist', email: 'bo.lindqvist@harbor.example', venueSlug: 'harbor', roles: ['trader'] },
  { username: 'hl-ines', displayName: 'Ines Okafor', email: 'ines.okafor@harbor.example', venueSlug: 'harbor', roles: ['builder'] },
  { username: 'cp-owner', displayName: 'Wren Ashdown', email: 'wren.ashdown@copper.example', venueSlug: 'copper', roles: ['org_owner'] },
  { username: 'cp-admin', displayName: 'Juno Hale', email: 'juno.hale@copper.example', venueSlug: 'copper', roles: ['market_admin'] },
  { username: 'cp-pell', displayName: 'Pell Varga', email: 'pell.varga@copper.example', venueSlug: 'copper', roles: ['trader'] },
  { username: 'cp-odile', displayName: 'Odile Marsh', email: 'odile.marsh@copper.example', venueSlug: 'copper', roles: ['builder'] },
  { username: 'plumtide-founder', displayName: 'Sol Rennick', email: 'sol.rennick@plumtide.example', venueSlug: null, roles: ['founder_operator'] },
];

export const SEED_PASSWORD = 'plumtide-demo-26';

export async function applySeed(
  pool: Pool,
  config: AppConfig,
  keycloak: KeycloakClient,
  killbill: KillBillClient,
  seedCardDeposits: boolean
): Promise<void> {
  const client = await pool.connect();
  try {
    // Single-flight lock across instances via advisory lock.
    await client.query(`SELECT pg_advisory_lock(918273645)`);
    const already = await client.query(`SELECT 1 FROM seed_state WHERE id = 1`);
    if ((already.rowCount ?? 0) > 0) {
      await client.query(`SELECT pg_advisory_unlock(918273645)`);
      return;
    }

    await client.query('BEGIN');

    const venueIds = new Map<string, string>();
    for (const venue of SEED_VENUES) {
      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO venues (id, slug, name, time_zone, taker_fee_bps, maker_fee_bps) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, venue.slug, venue.name, venue.timeZone, venue.takerFeeBps, venue.makerFeeBps]
      );
      venueIds.set(venue.slug, id);
    }

    const memberIds = new Map<string, string>();
    for (const person of SEED_PEOPLE) {
      const id = crypto.randomUUID();
      const venueId = person.venueSlug ? venueIds.get(person.venueSlug) ?? null : null;
      await client.query(
        `INSERT INTO members (id, venue_id, username, display_name, email, roles) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, venueId, person.username, person.displayName, person.email, person.roles]
      );
      memberIds.set(person.username, id);
    }

    const now = Date.now();
    const marketIds = new Map<string, string>();
    const markets: { venue: string; symbol: string; kind: 'pair' | 'event'; title: string; status: string; closesInDays: number | null; seedLast: number | null }[] = [
      { venue: 'harbor', symbol: 'RAIN', kind: 'event', title: 'Will Harbor Point log more than 4 inches of rain this month?', status: 'trading', closesInDays: 30, seedLast: null },
      { venue: 'harbor', symbol: 'FERRY', kind: 'event', title: 'Will the winter ferry run every day this week?', status: 'trading', closesInDays: 30, seedLast: null },
      { venue: 'harbor', symbol: 'GALA', kind: 'event', title: 'Will the lantern gala sell out?', status: 'listed', closesInDays: 60, seedLast: null },
      { venue: 'harbor', symbol: 'LANT', kind: 'pair', title: 'Brass Lantern shares', status: 'trading', closesInDays: null, seedLast: 2500 },
      { venue: 'copper', symbol: 'FROST', kind: 'event', title: 'Will Copperfield see frost before the solstice?', status: 'trading', closesInDays: 30, seedLast: null },
      { venue: 'copper', symbol: 'CU', kind: 'pair', title: 'Copper bar units', status: 'trading', closesInDays: null, seedLast: 800 },
    ];
    for (const market of markets) {
      const id = crypto.randomUUID();
      const venueId = venueIds.get(market.venue)!;
      const closesAt = market.closesInDays ? new Date(now + market.closesInDays * 24 * 3600 * 1000) : null;
      await client.query(
        `INSERT INTO markets (id, venue_id, kind, symbol, title, status, closes_at, seed_last_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, venueId, market.kind, market.symbol, market.title, market.status, closesAt, market.seedLast]
      );
      marketIds.set(`${market.venue}:${market.symbol}`, id);
    }
    for (const venue of SEED_VENUES) {
      const flagshipId = marketIds.get(`${venue.slug}:${venue.flagship}`) ?? null;
      await client.query(`UPDATE venues SET flagship_market_id = $2 WHERE id = $1`, [venueIds.get(venue.slug), flagshipId]);
    }

    await client.query(`INSERT INTO seed_state (id) VALUES (1)`);
    await client.query('COMMIT');
    await client.query(`SELECT pg_advisory_unlock(918273645)`);

    // Provider-dependent seeding happens outside the transaction.
    await ensureKeycloakPeople(config, keycloak, pool, memberIds, venueIds);
    if (seedCardDeposits) {
      await seedFundedRecords(pool, killbill, memberIds, venueIds, marketIds);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query(`SELECT pg_advisory_unlock(918273645)`).catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  void config;
}

async function ensureKeycloakPeople(
  config: AppConfig,
  keycloak: KeycloakClient,
  pool: Pool,
  memberIds: Map<string, string>,
  venueIds: Map<string, string>
): Promise<void> {
  // Each person is created and linked independently so one failure does not
  // stop the rest; the startup loop retries the whole pass until every user
  // resolves, and createUser itself leaves an existing user untouched.
  const missing: string[] = [];
  for (const person of SEED_PEOPLE) {
    const existing = await keycloak.findUserByUsername(person.username).catch(() => null);
    if (!existing) {
      try {
        await keycloak.createUser({
          username: person.username,
          email: person.email,
          firstName: person.displayName.split(' ')[0] || person.displayName,
          lastName: person.displayName.split(' ').slice(1).join(' ') || undefined,
          password: SEED_PASSWORD,
          roles: person.roles,
          groupName: person.venueSlug ? `venue-${person.venueSlug}` : undefined,
        });
      } catch (err) {
        missing.push(person.username);
        console.error(`seed: could not create ${person.username}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  for (const person of SEED_PEOPLE) {
    const user = await keycloak.findUserByUsername(person.username).catch(() => null);
    if (!user) continue;
    await pool.query(`UPDATE members SET keycloak_id = $2 WHERE id = $1`, [memberIds.get(person.username), user.id]);
    if (person.venueSlug) {
      await keycloak.ensureUserGroup(user.id, `venue-${person.venueSlug}`).catch((err: unknown) => {
        console.error(`seed: could not group ${person.username}:`, err instanceof Error ? err.message : err);
      });
    }
    await keycloak.ensureRealmRoles(user.id, person.roles).catch((err: unknown) => {
      console.error(`seed: could not assign roles to ${person.username}:`, err instanceof Error ? err.message : err);
    });
  }
  if (missing.length > 0) {
    throw new Error(`seed: keycloak users still missing: ${missing.join(', ')}`);
  }
  void venueIds;
}

const SEED_DEPOSITS: { username: string; amountCents: number }[] = [
  { username: 'hl-ana', amountCents: 100000 },
  { username: 'hl-bo', amountCents: 100000 },
  { username: 'hl-ines', amountCents: 200000 },
  { username: 'cp-pell', amountCents: 50000 },
  { username: 'cp-odile', amountCents: 50000 },
];

async function seedFundedRecords(
  pool: Pool,
  killbill: KillBillClient,
  memberIds: Map<string, string>,
  venueIds: Map<string, string>,
  marketIds: Map<string, string>
): Promise<void> {
  for (const deposit of SEED_DEPOSITS) {
    const memberId = memberIds.get(deposit.username)!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const member = (await client.query(`SELECT * FROM members WHERE id = $1`, [memberId])).rows[0] as { id: string; venue_id: string; display_name: string; email: string; killbill_account_id: string | null };
      const slugRes = await client.query(`SELECT slug FROM venues WHERE id = $1`, [member.venue_id]);
      const slug = (slugRes.rows[0] as { slug: string }).slug;
      let accountId = member.killbill_account_id;
      if (!accountId) {
        const account = await killbill.ensureAccount(`${slug}:${memberId}`, member.display_name, member.email);
        accountId = account.accountId;
        await client.query(`UPDATE members SET killbill_account_id = $2 WHERE id = $1`, [memberId, accountId]);
      }
      const depositId = crypto.randomUUID();
      try {
        const payment = await killbill.createPurchase(accountId, `deposit-${depositId}`, `deposit-${depositId}`, (deposit.amountCents / 100).toFixed(2), '4242');
        const ok = payment.transactions.some((t) => t.status === 'SUCCESS' && t.transactionType === 'PURCHASE');
        if (!ok) {
          await client.query('ROLLBACK');
          continue;
        }
        await client.query(
          `INSERT INTO deposits (id, venue_id, member_id, amount_cents, status, card_last4, killbill_payment_id, created_at)
           VALUES ($1,$2,$3,$4,'succeeded','4242',$5, now() - interval '2 days')`,
          [depositId, member.venue_id, memberId, deposit.amountCents, payment.paymentId]
        );
        await postJournalEntry(client, member.venue_id, {
          kind: 'deposit', referenceId: depositId,
          legs: [
            { account: memberAccount(memberId, 'available'), amountCents: deposit.amountCents },
            { account: venueAccount('card_clearing'), amountCents: -deposit.amountCents },
          ],
        });
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK').catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  // Seed holdings and resting orders after deposits exist.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedBooksAndHoldings(client, memberIds, marketIds);
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
  } finally {
    client.release();
  }
  // Ines starts on the Builder plan through a paid Kill Bill subscription.
  try {
    const inesId = memberIds.get('hl-ines');
    if (inesId) {
      const res = await pool.query(`SELECT killbill_account_id FROM members WHERE id = $1`, [inesId]);
      const accountId = res.rows[0] as { killbill_account_id: string | null };
      if (accountId.killbill_account_id) {
        const bundle = await killbill.bundleByExternalKey(`plan-${inesId}`).catch(() => null);
        const onThisAccount = bundle?.some(
          (b) => b.accountId === accountId.killbill_account_id && (b.subscriptions?.length ?? 0) > 0,
        );
        if (!onThisAccount) {
          await killbill.createSubscription(accountId.killbill_account_id, `plan-${inesId}`, 'builder-monthly');
        }
      }
      await pool.query(
        `INSERT INTO builder_billing (member_id, plan, state, updated_at) VALUES ($1, 'builder', 'active', now())
         ON CONFLICT (member_id) DO NOTHING`,
        [inesId],
      );
    }
  } catch (err) {
    console.error('seed: could not seed Ines plan subscription:', err instanceof Error ? err.message : err);
  }
  void venueIds;
}

async function seedBooksAndHoldings(
  client: PoolClient,
  memberIds: Map<string, string>,
  marketIds: Map<string, string>
): Promise<void> {
  const ana = memberIds.get('hl-ana')!;
  const bo = memberIds.get('hl-bo')!;
  const ines = memberIds.get('hl-ines')!;
  const pell = memberIds.get('cp-pell')!;
  const rain = marketIds.get('harbor:RAIN')!;
  const lant = marketIds.get('harbor:LANT')!;
  const frost = marketIds.get('copper:FROST')!;
  const harborVenue = await venueOf(client, rain);
  const copperVenue = await venueOf(client, frost);

  // Bo holds 50 LANT spot units (seeded from lending inventory when he sold? — here simply granted by venue for demo).
  await client.query(
    `INSERT INTO spot_holdings (member_id, market_id, quantity, reserved) VALUES ($1,$2,50,0)`,
    [bo, lant]
  );

  interface Resting { memberId: string; venueId: string; marketId: string; kind: 'pair' | 'event'; mode: 'spot' | 'margin' | null; side: 'buy' | 'sell'; outcome: Outcome | null; price: number; quantity: number; taker: number; maker: number; }
  const resting: Resting[] = [
    { memberId: bo, venueId: harborVenue, marketId: rain, kind: 'event', mode: null, side: 'buy', outcome: 'no', price: 63, quantity: 200, taker: 125, maker: 0 },
    { memberId: bo, venueId: harborVenue, marketId: rain, kind: 'event', mode: null, side: 'buy', outcome: 'no', price: 60, quantity: 100, taker: 125, maker: 0 },
    { memberId: ana, venueId: harborVenue, marketId: rain, kind: 'event', mode: null, side: 'buy', outcome: 'yes', price: 34, quantity: 150, taker: 125, maker: 0 },
    { memberId: ana, venueId: harborVenue, marketId: rain, kind: 'event', mode: null, side: 'buy', outcome: 'yes', price: 30, quantity: 80, taker: 125, maker: 0 },
    { memberId: ana, venueId: harborVenue, marketId: lant, kind: 'pair', mode: 'spot', side: 'buy', outcome: null, price: 2400, quantity: 10, taker: 125, maker: 0 },
    { memberId: bo, venueId: harborVenue, marketId: lant, kind: 'pair', mode: 'spot', side: 'sell', outcome: null, price: 2600, quantity: 20, taker: 125, maker: 0 },
    { memberId: pell, venueId: copperVenue, marketId: frost, kind: 'event', mode: null, side: 'buy', outcome: 'yes', price: 45, quantity: 100, taker: 50, maker: 10 },
  ];

  let seq = 0;
  for (const order of resting) {
    seq += 1;
    const id = crypto.randomUUID();
    const hold = holdForOrder({
      price: order.price, quantity: order.quantity, takerFeeBps: order.taker,
      kind: order.kind, mode: order.mode, side: order.side, reducesPosition: false,
    });
    const balances = await memberAvailable(client, order.memberId);
    if (balances < hold) continue;
    await client.query(
      `INSERT INTO orders (id, venue_id, market_id, member_id, mode, side, outcome, price, quantity, filled_quantity, status, hold_cents, reserved_units, taker_fee_bps, maker_fee_bps, sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'resting',$10,$11,$12,$13,$14)`,
      [id, order.venueId, order.marketId, order.memberId, order.mode, order.side, order.outcome,
       order.price, order.quantity, hold, order.side === 'sell' && order.kind === 'pair' && order.mode === 'spot' ? order.quantity : 0,
       order.taker, order.maker, seq]
    );
    if (hold > 0) {
      await postJournalEntry(client, order.venueId, {
        kind: 'hold', referenceId: id,
        legs: [
          { account: memberAccount(order.memberId, 'available'), amountCents: -hold },
          { account: memberAccount(order.memberId, 'held'), amountCents: hold },
        ],
      });
    }
    if (order.side === 'sell' && order.kind === 'pair' && order.mode === 'spot') {
      await client.query(
        `UPDATE spot_holdings SET reserved = reserved + $3 WHERE member_id = $1 AND market_id = $2`,
        [order.memberId, order.marketId, order.quantity]
      );
    }
  }
  void ines;
}

async function venueOf(client: PoolClient, marketId: string): Promise<string> {
  const res = await client.query(`SELECT venue_id FROM markets WHERE id = $1`, [marketId]);
  return (res.rows[0] as { venue_id: string }).venue_id;
}

async function memberAvailable(client: PoolClient, memberId: string): Promise<number> {
  const res = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM journal_legs WHERE account = $1`,
    [`member:${memberId}:available`]
  );
  return Number((res.rows[0] as { total: string }).total);
}
