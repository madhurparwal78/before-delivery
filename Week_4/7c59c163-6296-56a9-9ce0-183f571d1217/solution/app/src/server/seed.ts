import { randomUUID } from "node:crypto";
import { ROLES, type Role } from "../shared/rules.js";
import { subscribe } from "./billing.js";
import { one, pool, rows, tx } from "./db.js";
import { venueGroup } from "./identity.js";
import * as keycloak from "./keycloak.js";
import { chargeDeposit } from "./routes/deposits.js";
import { Changes, publishLater } from "./stream.js";
import { placeOrder, type OrderInput } from "./trading.js";
import { withSharedLock } from "./valkey.js";
import { marketById, memberById, venueById, type VenueRow } from "./views.js";

// Invented seed data from the brief, applied once per database, step by step under a lock.

const SEED_PASSWORD = "plumtide-demo-26";

const VENUES = [
  { slug: "harbor", name: "Harbor Lantern Club", timeZone: "America/New_York", taker: 125, maker: 0, flagship: "RAIN" },
  { slug: "copper", name: "Copperfield Pool", timeZone: "Europe/London", taker: 50, maker: 10, flagship: "FROST" },
];

const MARKETS = [
  { venue: "harbor", symbol: "RAIN", kind: "event", title: "Will Harbor Point log more than 4 inches of rain this month?", status: "trading", closeDays: 30, last: null },
  { venue: "harbor", symbol: "FERRY", kind: "event", title: "Will the winter ferry run every day this week?", status: "trading", closeDays: 30, last: null },
  { venue: "harbor", symbol: "GALA", kind: "event", title: "Will the lantern gala sell out?", status: "listed", closeDays: 60, last: null },
  { venue: "harbor", symbol: "LANT", kind: "pair", title: "Brass Lantern shares", status: "trading", closeDays: null, last: 2500 },
  { venue: "copper", symbol: "FROST", kind: "event", title: "Will Copperfield see frost before the solstice?", status: "trading", closeDays: 30, last: null },
  { venue: "copper", symbol: "CU", kind: "pair", title: "Copper bar units", status: "trading", closeDays: null, last: 800 },
] as const;

const PEOPLE: { username: string; name: string; email: string; venue: string | null; roles: Role[] }[] = [
  { username: "hl-owner", name: "Mara Quill", email: "mara.quill@harbor.example", venue: "harbor", roles: ["org_owner"] },
  { username: "hl-admin", name: "Teo Brandt", email: "teo.brandt@harbor.example", venue: "harbor", roles: ["market_admin"] },
  { username: "hl-ana", name: "Ana Pike", email: "ana.pike@harbor.example", venue: "harbor", roles: ["trader"] },
  { username: "hl-bo", name: "Bo Lindqvist", email: "bo.lindqvist@harbor.example", venue: "harbor", roles: ["trader"] },
  { username: "hl-ines", name: "Ines Okafor", email: "ines.okafor@harbor.example", venue: "harbor", roles: ["builder"] },
  { username: "cp-owner", name: "Wren Ashdown", email: "wren.ashdown@copper.example", venue: "copper", roles: ["org_owner"] },
  { username: "cp-admin", name: "Juno Hale", email: "juno.hale@copper.example", venue: "copper", roles: ["market_admin"] },
  { username: "cp-pell", name: "Pell Varga", email: "pell.varga@copper.example", venue: "copper", roles: ["trader"] },
  { username: "cp-odile", name: "Odile Marsh", email: "odile.marsh@copper.example", venue: "copper", roles: ["builder"] },
  { username: "plumtide-founder", name: "Sol Rennick", email: "sol.rennick@plumtide.example", venue: null, roles: ["founder_operator"] },
];

const DEPOSITS: [username: string, cents: number][] = [
  ["hl-ana", 100_000],
  ["hl-bo", 100_000],
  ["hl-ines", 200_000],
  ["cp-pell", 50_000],
  ["cp-odile", 50_000],
];

const ORDERS: [username: string, symbol: string, input: OrderInput][] = [
  ["hl-bo", "RAIN", { mode: null, side: "buy", outcome: "no", price: 63, quantity: 200 }],
  ["hl-bo", "RAIN", { mode: null, side: "buy", outcome: "no", price: 60, quantity: 100 }],
  ["hl-ana", "RAIN", { mode: null, side: "buy", outcome: "yes", price: 34, quantity: 150 }],
  ["hl-ana", "RAIN", { mode: null, side: "buy", outcome: "yes", price: 30, quantity: 80 }],
  ["hl-ana", "LANT", { mode: "spot", side: "buy", outcome: null, price: 2400, quantity: 10 }],
  ["hl-bo", "LANT", { mode: "spot", side: "sell", outcome: null, price: 2600, quantity: 20 }],
  ["cp-pell", "FROST", { mode: null, side: "buy", outcome: "yes", price: 45, quantity: 100 }],
];

/** Creates any missing realm roles and one group per venue, through the app client's service account. */
export async function bootstrapKeycloak(): Promise<void> {
  for (const role of ROLES) await keycloak.ensureRole(role);
  const venues = await rows<{ slug: string }>(pool, "SELECT slug FROM venues");
  for (const venue of venues) await keycloak.ensureGroup(venueGroup(venue.slug));
}

async function memberId(username: string): Promise<string> {
  const row = await one<{ id: string }>(pool, "SELECT id FROM members WHERE username = $1", [username]);
  if (!row) throw new Error(`seed member ${username} missing`);
  return row.id;
}

async function venueBySlug(slug: string): Promise<VenueRow> {
  const row = await one<{ id: string }>(pool, "SELECT id FROM venues WHERE slug = $1", [slug]);
  return venueById(pool, row?.id ?? "");
}

const STEPS: { name: string; run: () => Promise<void> }[] = [
  {
    name: "venues",
    run: async () => {
      await tx(async (client) => {
        for (const v of VENUES) {
          await client.query(
            "INSERT INTO venues (id, slug, name, time_zone, taker_fee_bps, maker_fee_bps, flagship_symbol) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (slug) DO NOTHING",
            [randomUUID(), v.slug, v.name, v.timeZone, v.taker, v.maker, v.flagship],
          );
        }
        for (const m of MARKETS) {
          await client.query(
            `INSERT INTO markets (id, venue_id, kind, symbol, title, status, closes_at, last_price)
             SELECT $1, id, $3, $4, $5, $6, CASE WHEN $7::int IS NULL THEN NULL ELSE now() + make_interval(days => $7::int) END, $8
               FROM venues WHERE slug = $2 ON CONFLICT DO NOTHING`,
            [randomUUID(), m.venue, m.kind, m.symbol, m.title, m.status, m.closeDays, m.last],
          );
        }
      });
    },
  },
  {
    name: "people",
    run: () => withSharedLock("keycloak-people", async () => {
      await bootstrapKeycloak();
      for (const person of PEOPLE) {
        const existing = await keycloak.userByUsername(person.username);
        const [firstName = person.name, ...rest] = person.name.split(" ");
        let id = existing?.id;
        if (!id) {
          id = (await keycloak.createUser({ username: person.username, email: person.email, firstName, lastName: rest.join(" "), password: SEED_PASSWORD })) ?? undefined;
          if (!id) throw new Error(`could not create ${person.username}`);
          await keycloak.grantRealmRoles(id, person.roles);
          if (person.venue) await keycloak.joinGroup(id, await keycloak.ensureGroup(venueGroup(person.venue)));
        }
        const venue = person.venue ? await venueBySlug(person.venue) : null;
        await pool.query(
          `INSERT INTO members (id, venue_id, username, email, display_name, roles) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET venue_id = EXCLUDED.venue_id, roles = EXCLUDED.roles`,
          [id, venue?.id ?? null, person.username, person.email, person.name, person.roles],
        );
      }
    }),
  },
  {
    name: "funding",
    run: async () => {
      for (const [username, cents] of DEPOSITS) {
        const member = await memberById(pool, await memberId(username));
        await chargeDeposit(member, await venueById(pool, member.venue_id ?? ""), cents, "4242");
      }
      const ines = await memberById(pool, await memberId("hl-ines"));
      await subscribe(ines, await venueBySlug("harbor"), "builder");
      const lant = await one<{ id: string }>(pool, "SELECT m.id FROM markets m JOIN venues v ON v.id = m.venue_id WHERE v.slug = 'harbor' AND m.symbol = 'LANT'");
      await pool.query("INSERT INTO spot_holdings (member_id, market_id, quantity) VALUES ($1, $2, 50) ON CONFLICT DO NOTHING", [await memberId("hl-bo"), lant?.id]);
    },
  },
  {
    name: "orders",
    run: async () => {
      for (const [username, symbol, input] of ORDERS) {
        const member = await memberById(pool, await memberId(username));
        const row = await one<{ id: string }>(pool, "SELECT id FROM markets WHERE venue_id = $1 AND symbol = $2", [member.venue_id, symbol]);
        const changes = new Changes();
        await tx(async (client) => placeOrder(client, await marketById(client, row?.id ?? "", member.venue_id, true), member.id, input, changes));
        publishLater(changes);
      }
    },
  },
];

/** Applies every seed step not yet applied; throws when a step's provider is unavailable. */
export async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(4173002)");
    for (const step of STEPS) {
      if (await one(client, "SELECT 1 FROM seed_steps WHERE step = $1", [step.name])) continue;
      await step.run();
      await client.query("INSERT INTO seed_steps (step) VALUES ($1) ON CONFLICT DO NOTHING", [step.name]);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(4173002)").catch(() => undefined);
    client.release();
  }
}
