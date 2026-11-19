import { randomUUID } from 'node:crypto';
import { LOCK_SEED, inTransaction, pool } from './db/pool.js';
import { newEffects, placeOrder } from './domain/engine.js';
import { CARD_CLEARING, memberAccount, postEntry } from './domain/ledger.js';
import { killbillAccountKey, planBundleKey } from './billing.js';
import * as killbill from './providers/killbill.js';
import { ensureRealmRoles, ensureUser } from './providers/keycloak.js';
import { venueBySlug } from './auth.js';
import type {
  MarketKind,
  MarketRow,
  OrderMode,
  OrderSide,
  Outcome,
  Role,
  Venue,
} from './domain/types.js';

const SEED_PASSWORD = 'plumtide-demo-26';
const SEED_CARD_LAST4 = '4242';

interface VenueSeed {
  slug: string;
  name: string;
  timeZone: string;
  takerFeeBps: number;
  makerFeeBps: number;
  flagship: string;
}

const VENUES: VenueSeed[] = [
  {
    slug: 'harbor',
    name: 'Harbor Lantern Club',
    timeZone: 'America/New_York',
    takerFeeBps: 125,
    makerFeeBps: 0,
    flagship: 'RAIN',
  },
  {
    slug: 'copper',
    name: 'Copperfield Pool',
    timeZone: 'Europe/London',
    takerFeeBps: 50,
    makerFeeBps: 10,
    flagship: 'FROST',
  },
];

interface PersonSeed {
  username: string;
  displayName: string;
  email: string;
  venueSlug: string | null;
  roles: Role[];
}

const PEOPLE: PersonSeed[] = [
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

interface MarketSeed {
  venueSlug: string;
  symbol: string;
  kind: MarketKind;
  title: string;
  status: 'listed' | 'trading';
  closesInDays: number | null;
  lastPrice: number | null;
}

const MARKETS: MarketSeed[] = [
  {
    venueSlug: 'harbor',
    symbol: 'RAIN',
    kind: 'event',
    title: 'Will Harbor Point log more than 4 inches of rain this month?',
    status: 'trading',
    closesInDays: 30,
    lastPrice: null,
  },
  {
    venueSlug: 'harbor',
    symbol: 'FERRY',
    kind: 'event',
    title: 'Will the winter ferry run every day this week?',
    status: 'trading',
    closesInDays: 30,
    lastPrice: null,
  },
  {
    venueSlug: 'harbor',
    symbol: 'GALA',
    kind: 'event',
    title: 'Will the lantern gala sell out?',
    status: 'listed',
    closesInDays: 60,
    lastPrice: null,
  },
  {
    venueSlug: 'harbor',
    symbol: 'LANT',
    kind: 'pair',
    title: 'Brass Lantern shares',
    status: 'trading',
    closesInDays: null,
    lastPrice: 2500,
  },
  {
    venueSlug: 'copper',
    symbol: 'FROST',
    kind: 'event',
    title: 'Will Copperfield see frost before the solstice?',
    status: 'trading',
    closesInDays: 30,
    lastPrice: null,
  },
  {
    venueSlug: 'copper',
    symbol: 'CU',
    kind: 'pair',
    title: 'Copper bar units',
    status: 'trading',
    closesInDays: null,
    lastPrice: 800,
  },
];

const DEPOSITS: { username: string; amountCents: number }[] = [
  { username: 'hl-ana', amountCents: 100_000 },
  { username: 'hl-bo', amountCents: 100_000 },
  { username: 'hl-ines', amountCents: 200_000 },
  { username: 'cp-pell', amountCents: 50_000 },
  { username: 'cp-odile', amountCents: 50_000 },
];

interface OrderSeed {
  username: string;
  symbol: string;
  mode: OrderMode | null;
  side: OrderSide;
  outcome: Outcome | null;
  price: number;
  quantity: number;
}

const ORDERS: OrderSeed[] = [
  { username: 'hl-bo', symbol: 'RAIN', mode: null, side: 'buy', outcome: 'no', price: 63, quantity: 200 },
  { username: 'hl-bo', symbol: 'RAIN', mode: null, side: 'buy', outcome: 'no', price: 60, quantity: 100 },
  { username: 'hl-ana', symbol: 'RAIN', mode: null, side: 'buy', outcome: 'yes', price: 34, quantity: 150 },
  { username: 'hl-ana', symbol: 'RAIN', mode: null, side: 'buy', outcome: 'yes', price: 30, quantity: 80 },
  { username: 'hl-ana', symbol: 'LANT', mode: 'spot', side: 'buy', outcome: null, price: 2400, quantity: 10 },
  { username: 'hl-bo', symbol: 'LANT', mode: 'spot', side: 'sell', outcome: null, price: 2600, quantity: 20 },
  { username: 'cp-pell', symbol: 'FROST', mode: null, side: 'buy', outcome: 'yes', price: 45, quantity: 100 },
];

const MARKET_COLUMNS =
  'id, venue_id, kind, symbol, title, status, closes_at, outcome, last_price, book_sequence, resolved_at, settled_at';

async function seedVenues(): Promise<Map<string, Venue>> {
  const venues = new Map<string, Venue>();
  for (const seed of VENUES) {
    await pool.query(
      `insert into venues (id, slug, name, time_zone, taker_fee_bps, maker_fee_bps, flagship_symbol)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (slug) do nothing`,
      [
        randomUUID(),
        seed.slug,
        seed.name,
        seed.timeZone,
        seed.takerFeeBps,
        seed.makerFeeBps,
        seed.flagship,
      ],
    );
    const venue = await venueBySlug(pool, seed.slug);
    if (venue !== null) venues.set(seed.slug, venue);
  }
  return venues;
}

async function seedPeople(venues: Map<string, Venue>): Promise<Map<string, string>> {
  const members = new Map<string, string>();
  for (const person of PEOPLE) {
    const user = await ensureUser({
      username: person.username,
      email: person.email,
      displayName: person.displayName,
      roles: person.roles,
      venueSlug: person.venueSlug,
      password: SEED_PASSWORD,
    });
    const venue = person.venueSlug === null ? null : (venues.get(person.venueSlug) ?? null);
    const id = randomUUID();
    await pool.query(
      `insert into members (id, venue_id, keycloak_user_id, username, display_name, email, roles)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (keycloak_user_id) do update set venue_id = excluded.venue_id, roles = excluded.roles`,
      [id, venue?.id ?? null, user.id, person.username, person.displayName, person.email, person.roles],
    );
    const stored = await pool.query<{ id: string }>(
      'select id from members where keycloak_user_id = $1',
      [user.id],
    );
    const memberId = stored.rows[0]?.id as string;
    await pool.query('insert into member_balances (member_id) values ($1) on conflict do nothing', [
      memberId,
    ]);
    members.set(person.username, memberId);
  }
  return members;
}

async function seedMarkets(venues: Map<string, Venue>): Promise<Map<string, MarketRow>> {
  const markets = new Map<string, MarketRow>();
  for (const seed of MARKETS) {
    const venue = venues.get(seed.venueSlug);
    if (venue === undefined) continue;
    const closesAt =
      seed.closesInDays === null
        ? null
        : new Date(Date.now() + seed.closesInDays * 24 * 60 * 60 * 1000);
    await pool.query(
      `insert into markets (id, venue_id, kind, symbol, title, status, closes_at, last_price)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (venue_id, symbol) do nothing`,
      [randomUUID(), venue.id, seed.kind, seed.symbol, seed.title, seed.status, closesAt, seed.lastPrice],
    );
    const stored = await pool.query<MarketRow>(
      `select ${MARKET_COLUMNS} from markets where venue_id = $1 and symbol = $2`,
      [venue.id, seed.symbol],
    );
    const market = stored.rows[0];
    if (market !== undefined) markets.set(`${seed.venueSlug}:${seed.symbol}`, market);
  }
  return markets;
}

/** Seed deposits are real Kill Bill purchases, made the same way as a member's own deposit. */
async function seedDeposits(
  venues: Map<string, Venue>,
  members: Map<string, string>,
): Promise<void> {
  for (const seed of DEPOSITS) {
    const person = PEOPLE.find((item) => item.username === seed.username) as PersonSeed;
    const venue = venues.get(person.venueSlug as string) as Venue;
    const memberId = members.get(seed.username) as string;
    const existing = await pool.query('select 1 from deposits where member_id = $1', [memberId]);
    if (existing.rowCount !== 0) continue;

    const depositId = randomUUID();
    const accountId = await killbill.ensureAccount(
      killbillAccountKey(venue.slug, memberId),
      person.displayName,
      person.email,
      SEED_CARD_LAST4,
    );
    const purchase = await killbill.purchase(
      accountId,
      `deposit-${depositId}`,
      seed.amountCents,
      SEED_CARD_LAST4,
    );
    if (!purchase.succeeded) throw new Error(`seed deposit for ${seed.username} was not successful`);

    await inTransaction(async (client) => {
      await client.query(
        `insert into deposits (id, venue_id, member_id, amount_cents, status, card_last4, killbill_payment_id)
         values ($1,$2,$3,$4,'succeeded',$5,$6)`,
        [depositId, venue.id, memberId, seed.amountCents, SEED_CARD_LAST4, purchase.paymentId],
      );
      await postEntry(client, venue.id, 'deposit', depositId, [
        { account: CARD_CLEARING, amount_cents: -seed.amountCents },
        { account: memberAccount(memberId, 'available'), amount_cents: seed.amountCents },
      ]);
    });
  }
}

/** The seeded plan is paid, so the seeded builder starts on a clear Kill Bill account. */
async function settleInvoices(accountId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const unpaid = (await killbill.invoices(accountId)).filter((invoice) => invoice.balance_cents > 0);
    if (unpaid.length === 0) return;
    await killbill.payOutstanding(accountId);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('seeded plan invoices are still unpaid');
}

async function seedHoldingsAndPlans(
  venues: Map<string, Venue>,
  members: Map<string, string>,
  markets: Map<string, MarketRow>,
): Promise<void> {
  const bo = members.get('hl-bo') as string;
  const lant = markets.get('harbor:LANT') as MarketRow;
  await pool.query(
    `insert into spot_holdings (member_id, market_id, quantity, reserved) values ($1,$2,50,0)
     on conflict (member_id, market_id) do nothing`,
    [bo, lant.id],
  );

  const ines = members.get('hl-ines') as string;
  const harbor = venues.get('harbor') as Venue;
  await pool.query(
    `insert into builder_billing (member_id, venue_id, plan, state, overdue_state)
     values ($1,$2,'builder','active',$3) on conflict (member_id) do nothing`,
    [ines, harbor.id, killbill.CLEAR_OVERDUE_STATE],
  );
  const accountId = await killbill.ensureAccount(
    killbillAccountKey(harbor.slug, ines),
    'Ines Okafor',
    'ines.okafor@harbor.example',
    SEED_CARD_LAST4,
  );
  const bundleKey = planBundleKey(ines);
  let subscription = await killbill.activeSubscription(accountId, bundleKey);
  if (subscription === null) {
    subscription = await killbill.createSubscription(accountId, bundleKey, 'builder');
  }
  await pool.query('update builder_billing set subscription_id = $2 where member_id = $1', [
    ines,
    subscription.subscriptionId,
  ]);
  await settleInvoices(accountId);

  const odile = members.get('cp-odile') as string;
  const copper = venues.get('copper') as Venue;
  await pool.query(
    `insert into builder_billing (member_id, venue_id, plan, state, overdue_state)
     values ($1,$2,'sandbox','active',$3) on conflict (member_id) do nothing`,
    [odile, copper.id, killbill.CLEAR_OVERDUE_STATE],
  );
}

async function seedOrders(
  venues: Map<string, Venue>,
  members: Map<string, string>,
  markets: Map<string, MarketRow>,
): Promise<void> {
  const existing = await pool.query('select 1 from orders limit 1');
  if (existing.rowCount !== 0) return;

  for (const seed of ORDERS) {
    const person = PEOPLE.find((item) => item.username === seed.username) as PersonSeed;
    const venue = venues.get(person.venueSlug as string) as Venue;
    const market = markets.get(`${person.venueSlug}:${seed.symbol}`) as MarketRow;
    const effects = newEffects();
    await inTransaction(async (client) => {
      await placeOrder(
        client,
        {
          market,
          venue,
          memberId: members.get(seed.username) as string,
          mode: seed.mode,
          side: seed.side,
          outcome: seed.outcome,
          price: seed.price,
          quantity: seed.quantity,
        },
        effects,
      );
    });
  }
}

/** Applied once per database, under a lock. */
export async function applySeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_SEED]);
    await ensureRealmRoles();
    const venues = await seedVenues();
    const members = await seedPeople(venues);
    const markets = await seedMarkets(venues);
    await seedDeposits(venues, members);
    await seedHoldingsAndPlans(venues, members, markets);
    await seedOrders(venues, members, markets);
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_SEED]);
    client.release();
  }
}
