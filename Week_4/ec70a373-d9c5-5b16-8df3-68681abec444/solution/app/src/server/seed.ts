// The brief's seed data, inserted once when the database holds no tenants.
import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { hashPassword } from "./passwords.ts";
import { addDays, elapsedQuarters, localToUtc, parseWall, type IsoDate } from "../shared/time.ts";
import { LOT_VALID_DAYS, occupiedUntil, type StationKind } from "../shared/rules.ts";
import type { Role, Service } from "../shared/api.ts";
import { drawLots, writeMovement } from "./ledger.ts";
import { config, type SeedSet } from "./config.ts";
import { now } from "./clock.ts";

const PASSWORD = "pilot-light-demo";
const RATES_FROM: IsoDate = "2026-01-01";

interface SeedSite {
  name: string;
  timeZone: string;
  address: string;
  stations: [string, StationKind][];
  rate: [number, string];
}

interface SeedMember {
  business: string;
  openingQuarters: number;
  validThrough: [IsoDate, IsoDate, IsoDate];
  truck?: [string, string];
}

interface SeedUser {
  name: string;
  email: string;
  role: Role;
  site?: string;
  member?: SeedMember;
}

interface SeedVisit {
  arrived: [IsoDate, string];
  departed: [IsoDate, string];
  services: Service[];
}

interface SeedTenant {
  name: string;
  legalName: string;
  sites: SeedSite[];
  packs: [string, number, number][];
  users: SeedUser[];
  visits: { truck: string; site: string; manager: string; signature: string; list: SeedVisit[] }[];
}

const TENANTS: SeedTenant[] = [
  {
    name: "Copperline Kitchen Collective",
    legalName: "Copperline Kitchen Collective, Inc.",
    sites: [
      {
        name: "Copperline Eastside",
        timeZone: "America/New_York",
        address: "410 Foundry Row, Port Avery",
        stations: [
          ["Deck Oven 1", "oven"],
          ["Convection Oven 2", "oven"],
          ["Spiral Mixer 60 qt", "mixer"],
          ["Blast Chiller", "blast_chiller"],
          ["Prep Table A", "prep_table"],
        ],
        rate: [4250, "8.875"],
      },
      {
        name: "Copperline Highline",
        timeZone: "America/Denver",
        address: "88 Mesa Spur, Highline Junction",
        stations: [
          ["Rack Oven", "oven"],
          ["Planetary Mixer 40 qt", "mixer"],
          ["Blast Chiller H1", "blast_chiller"],
          ["Prep Table H", "prep_table"],
        ],
        rate: [3800, "7.65"],
      },
    ],
    packs: [
      ["Starter 10", 10, 25000],
      ["Production 30", 30, 66000],
    ],
    users: [
      { name: "Dana Okafor", email: "dana@copperline.example", role: "kitchen_manager", site: "Copperline Eastside" },
      { name: "Luis Arrieta", email: "luis@copperline.example", role: "kitchen_manager", site: "Copperline Highline" },
      { name: "Priya Raman", email: "priya@copperline.example", role: "finance_lead" },
      {
        name: "Rosa Lindqvist",
        email: "rosa@lindqvist.example",
        role: "member",
        site: "Copperline Eastside",
        member: { business: "Lindqvist Hearth Bakery", openingQuarters: 48, validThrough: ["2027-06-30", "2027-08-31", "2027-12-31"] },
      },
      {
        name: "Ade Okonjo",
        email: "ade@okonjo.example",
        role: "member",
        site: "Copperline Eastside",
        member: { business: "Okonjo Small Batch", openingQuarters: 40, validThrough: ["2027-05-31", "2027-05-31", "2027-12-31"] },
      },
      {
        name: "Theo Mbeki",
        email: "theo@mbekismoke.example",
        role: "member",
        site: "Copperline Eastside",
        member: {
          business: "Mbeki Smoke Truck",
          openingQuarters: 24,
          validThrough: ["2027-04-30", "2027-04-30", "2027-12-31"],
          truck: ["Smoke Signal", "MFU-2291"],
        },
      },
      {
        name: "Hana Sato",
        email: "hana@satopatisserie.example",
        role: "member",
        site: "Copperline Highline",
        member: { business: "Sato Patisserie", openingQuarters: 32, validThrough: ["2026-09-30", "2027-03-31", "2027-12-31"] },
      },
    ],
    visits: [
      {
        truck: "Smoke Signal",
        site: "Copperline Eastside",
        manager: "Dana Okafor",
        signature: "Theo Mbeki",
        list: [
          { arrived: ["2026-10-20", "19:30"], departed: ["2026-10-20", "22:00"], services: ["potable_water", "grey_water", "cleaning"] },
          { arrived: ["2026-10-21", "20:00"], departed: ["2026-10-21", "21:30"], services: ["grey_water", "restock"] },
          { arrived: ["2026-10-23", "06:00"], departed: ["2026-10-23", "07:00"], services: ["potable_water", "food_storage"] },
        ],
      },
    ],
  },
  {
    name: "Fernhollow Food Works",
    legalName: "Fernhollow Food Works Cooperative",
    sites: [
      {
        name: "Fernhollow Commissary",
        timeZone: "America/Los_Angeles",
        address: "7 Cedar Siding, Fernhollow",
        stations: [
          ["Hearth Oven F1", "oven"],
          ["Mixer F2", "mixer"],
          ["Blast Chiller F3", "blast_chiller"],
          ["Prep Table F4", "prep_table"],
        ],
        rate: [4500, "9.25"],
      },
    ],
    packs: [["Bake 20", 20, 46000]],
    users: [
      { name: "Ines Calder", email: "ines@fernhollow.example", role: "kitchen_manager", site: "Fernhollow Commissary" },
      { name: "Marco Vitale", email: "marco@fernhollow.example", role: "finance_lead" },
      {
        name: "Rosalind Park",
        email: "rosalind@parkstreetpies.example",
        role: "member",
        site: "Fernhollow Commissary",
        member: { business: "Park Street Pies", openingQuarters: 36, validThrough: ["2027-06-30", "2027-06-30", "2027-12-31"] },
      },
      {
        name: "Rory Delacroix",
        email: "rory@delacroix.example",
        role: "member",
        site: "Fernhollow Commissary",
        member: {
          business: "Delacroix Dumpling Truck",
          openingQuarters: 20,
          validThrough: ["2027-06-30", "2027-06-30", "2027-12-31"],
          truck: ["Steam Engine", "MFU-8820"],
        },
      },
    ],
    visits: [
      {
        truck: "Steam Engine",
        site: "Fernhollow Commissary",
        manager: "Ines Calder",
        signature: "Rory Delacroix",
        list: [{ arrived: ["2026-10-22", "08:00"], departed: ["2026-10-22", "09:15"], services: ["potable_water", "grey_water"] }],
      },
    ],
  },
];

function wall(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export async function seedIfEmpty(db: Db): Promise<void> {
  const existing = await db.query("SELECT 1 FROM tenants LIMIT 1");
  if (existing.rowCount) return;
  await db.query("BEGIN");
  try {
    const openingAt = config.seedSet === null ? now() : Date.parse(SEED_SETS[config.seedSet].openingAt);
    for (const tenant of TENANTS) await seedTenant(db, tenant, openingAt);
    if (config.seedSet !== null) await seedSet(db, SEED_SETS[config.seedSet]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

async function seedTenant(db: Db, tenant: SeedTenant, openingAt: number): Promise<void> {
  const tenantId = randomUUID();
  const created = new Date(openingAt);
  await db.query("INSERT INTO tenants (id, name, legal_name) VALUES ($1, $2, $3)", [tenantId, tenant.name, tenant.legalName]);
  const sites = new Map<string, { id: string; timeZone: string }>();
  for (const [position, site] of tenant.sites.entries()) {
    const id = randomUUID();
    sites.set(site.name, { id, timeZone: site.timeZone });
    await db.query("INSERT INTO sites (id, tenant_id, name, time_zone, address, position) VALUES ($1, $2, $3, $4, $5, $6)", [
      id,
      tenantId,
      site.name,
      site.timeZone,
      site.address,
      position,
    ]);
    for (const [stationPosition, [name, kind]] of site.stations.entries()) {
      await db.query("INSERT INTO stations (id, site_id, name, kind, position) VALUES ($1, $2, $3, $4, $5)", [
        randomUUID(),
        id,
        name,
        kind,
        stationPosition,
      ]);
    }
    await db.query(
      "INSERT INTO rates (id, site_id, effective_from, hourly_rate_cents, tax_rate_percent, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [randomUUID(), id, RATES_FROM, site.rate[0], site.rate[1], created],
    );
  }
  for (const [position, [name, hours, cents]] of tenant.packs.entries()) {
    await db.query("INSERT INTO packs (id, tenant_id, name, quarters, price_cents, position) VALUES ($1, $2, $3, $4, $5, $6)", [
      randomUUID(),
      tenantId,
      name,
      hours * 4,
      cents,
      position,
    ]);
  }
  const trucks = new Map<string, string>();
  for (const user of tenant.users) {
    const userId = randomUUID();
    const siteId = user.site === undefined ? null : (sites.get(user.site)?.id ?? null);
    await db.query(
      "INSERT INTO users (id, tenant_id, email, name, role, password_hash, site_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [userId, tenantId, user.email, user.name, user.role, await hashPassword(PASSWORD), siteId],
    );
    if (!user.member) continue;
    const memberId = randomUUID();
    const [insurance, foodHandler, licence] = user.member.validThrough;
    await db.query(
      `INSERT INTO members (id, user_id, tenant_id, business_name, home_site_id,
         seeded_certificate_of_insurance, seeded_food_handler_certificate, seeded_business_licence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [memberId, userId, tenantId, user.member.business, siteId, insurance, foodHandler, licence],
    );
    const lotId = randomUUID();
    await db.query("INSERT INTO lots (id, member_id, purchase_id, pack_name, valid_through) VALUES ($1, $2, NULL, 'Opening balance', NULL)", [
      lotId,
      memberId,
    ]);
    await writeMovement(db, {
      memberId,
      kind: "opening_balance",
      quarters: user.member.openingQuarters,
      actor: null,
      at: created.getTime(),
      lots: [{ lotId, quarters: user.member.openingQuarters }],
    });
    if (user.member.truck) {
      const truckId = randomUUID();
      trucks.set(user.member.truck[0], truckId);
      await db.query("INSERT INTO trucks (id, member_id, name, permit_number) VALUES ($1, $2, $3, $4)", [
        truckId,
        memberId,
        user.member.truck[0],
        user.member.truck[1],
      ]);
    }
  }
  for (const log of tenant.visits) {
    const site = sites.get(log.site);
    const truckId = trucks.get(log.truck);
    if (!site || !truckId) throw new Error(`seed visit log for ${log.truck} is incomplete`);
    for (const visit of log.list) {
      await db.query(
        `INSERT INTO visits (id, truck_id, site_id, arrived_at, departed_at, services, operator_signature, arrived_by_name, departed_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          randomUUID(),
          truckId,
          site.id,
          new Date(localToUtc(visit.arrived[0], wall(visit.arrived[1]), site.timeZone)),
          new Date(localToUtc(visit.departed[0], wall(visit.departed[1]), site.timeZone)),
          visit.services,
          log.signature,
          log.manager,
        ],
      );
    }
  }
}

interface SeedBooking {
  reference: string;
  member: string;
  site: string;
  station: string;
  date: IsoDate;
  window: [string, string];
  createdAt: string;
  checkedIn?: { at: string; by: string };
}

interface SeedSetRecords {
  /** Opening balances predate every record of the set, so the ledger reads in time order. */
  openingAt: string;
  rates: { site: string; effectiveFrom: IsoDate; hourlyRateCents: number; taxRatePercent: string; createdAt: string }[];
  insurance: { member: string; validThrough: IsoDate }[];
  purchases: { member: string; pack: string; at: string; homeDate: IsoDate }[];
  bookings: SeedBooking[];
}

const SITE_DAY_CREATED = "2026-11-05T14:00:00Z";
const PACK_EXPIRY_CREATED = "2026-11-01T14:00:00Z";
const EASTSIDE = "Copperline Eastside";

function seedBooking(reference: string, member: string, site: string, station: string, date: IsoDate, window: [string, string], createdAt: string, checkedIn?: SeedBooking["checkedIn"]): SeedBooking {
  return { reference, member, site, station, date, window, createdAt, checkedIn };
}

const SEED_SETS: Record<SeedSet, SeedSetRecords> = {
  "site-day": {
    openingAt: "2026-11-01T00:00:00Z",
    rates: [
      { site: EASTSIDE, effectiveFrom: "2026-11-09", hourlyRateCents: 5000, taxRatePercent: "10", createdAt: "2026-11-07T15:00:00Z" },
      { site: EASTSIDE, effectiveFrom: "2026-11-11", hourlyRateCents: 6000, taxRatePercent: "12", createdAt: "2026-11-07T15:05:00Z" },
    ],
    insurance: [],
    purchases: [],
    bookings: [
      seedBooking("PL-SD0001", "Rosa Lindqvist", EASTSIDE, "Deck Oven 1", "2026-11-10", ["09:00", "11:00"], SITE_DAY_CREATED),
      seedBooking("PL-SD0002", "Ade Okonjo", EASTSIDE, "Spiral Mixer 60 qt", "2026-11-10", ["08:15", "09:15"], SITE_DAY_CREATED),
      seedBooking("PL-SD0003", "Ade Okonjo", EASTSIDE, "Prep Table A", "2026-11-10", ["06:00", "07:00"], SITE_DAY_CREATED),
      seedBooking("PL-SD0004", "Theo Mbeki", EASTSIDE, "Blast Chiller", "2026-11-10", ["06:00", "07:30"], SITE_DAY_CREATED, { at: "2026-11-10T10:50:00Z", by: "Dana Okafor" }),
      seedBooking("PL-SD0005", "Theo Mbeki", EASTSIDE, "Prep Table A", "2026-11-12", ["10:00", "14:30"], SITE_DAY_CREATED),
      seedBooking("PL-SD0006", "Rosa Lindqvist", EASTSIDE, "Convection Oven 2", "2026-11-08", ["21:00", "22:00"], SITE_DAY_CREATED, { at: "2026-11-09T01:50:00Z", by: "Dana Okafor" }),
      seedBooking("PL-SD0007", "Hana Sato", "Copperline Highline", "Rack Oven", "2026-11-10", ["07:00", "09:00"], SITE_DAY_CREATED),
      seedBooking("PL-SD0008", "Rosa Lindqvist", EASTSIDE, "Deck Oven 1", "2026-11-13", ["08:45", "10:30"], SITE_DAY_CREATED),
      seedBooking("PL-SD0009", "Ade Okonjo", EASTSIDE, "Blast Chiller", "2026-11-12", ["08:45", "10:30"], SITE_DAY_CREATED),
    ],
  },
  "pack-expiry": {
    openingAt: "2026-09-01T00:00:00Z",
    rates: [],
    insurance: [{ member: "Ade Okonjo", validThrough: "2026-11-10" }],
    purchases: [{ member: "Rosa Lindqvist", pack: "Starter 10", at: "2026-09-11T16:00:00Z", homeDate: "2026-09-11" }],
    bookings: [
      seedBooking("PL-PE0001", "Rosa Lindqvist", EASTSIDE, "Prep Table A", "2026-11-20", ["09:00", "11:00"], PACK_EXPIRY_CREATED),
      seedBooking("PL-PE0002", "Ade Okonjo", EASTSIDE, "Spiral Mixer 60 qt", "2026-11-11", ["00:00", "01:00"], PACK_EXPIRY_CREATED),
      seedBooking("PL-PE0003", "Ade Okonjo", EASTSIDE, "Prep Table A", "2026-11-11", ["00:00", "01:00"], PACK_EXPIRY_CREATED),
    ],
  },
};

interface SeededPerson {
  user_id: string;
  member_id: string;
  tenant_id: string;
}

async function person(db: Db, name: string): Promise<SeededPerson> {
  const found = await db.query<SeededPerson>(
    "SELECT u.id AS user_id, m.id AS member_id, u.tenant_id FROM users u JOIN members m ON m.user_id = u.id WHERE u.name = $1",
    [name],
  );
  const row = found.rows[0];
  if (!row) throw new Error(`seed set names unknown member ${name}`);
  return row;
}

async function seedSet(db: Db, set: SeedSetRecords): Promise<void> {
  for (const rate of set.rates) {
    await db.query(
      `INSERT INTO rates (id, site_id, effective_from, hourly_rate_cents, tax_rate_percent, created_at)
       SELECT $1, id, $2, $3, $4, $5 FROM sites WHERE name = $6`,
      [randomUUID(), rate.effectiveFrom, rate.hourlyRateCents, rate.taxRatePercent, new Date(rate.createdAt), rate.site],
    );
  }
  for (const change of set.insurance) {
    await db.query("UPDATE members SET seeded_certificate_of_insurance = $1 WHERE id = $2", [change.validThrough, (await person(db, change.member)).member_id]);
  }
  for (const purchase of set.purchases) {
    const member = await person(db, purchase.member);
    const pack = (await db.query<{ id: string; name: string; quarters: number; price_cents: number }>(
      "SELECT id, name, quarters, price_cents FROM packs WHERE name = $1 AND tenant_id = $2",
      [purchase.pack, member.tenant_id],
    )).rows[0];
    if (!pack) throw new Error(`seed set names unknown pack ${purchase.pack}`);
    const purchaseId = randomUUID();
    const lotId = randomUUID();
    const validThrough = addDays(purchase.homeDate, LOT_VALID_DAYS);
    await db.query(
      `INSERT INTO purchases (id, member_id, pack_id, pack_name, quarters, price_cents, valid_through, killbill_payment_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
      [purchaseId, member.member_id, pack.id, pack.name, pack.quarters, pack.price_cents, validThrough, new Date(purchase.at)],
    );
    await db.query("INSERT INTO lots (id, member_id, purchase_id, pack_name, valid_through) VALUES ($1, $2, $3, $4, $5)", [
      lotId,
      member.member_id,
      purchaseId,
      pack.name,
      validThrough,
    ]);
    await writeMovement(db, {
      memberId: member.member_id,
      kind: "pack_purchase",
      quarters: pack.quarters,
      actor: { userId: member.user_id, name: purchase.member, role: "member" },
      at: Date.parse(purchase.at),
      purchaseId,
      lots: [{ lotId, quarters: pack.quarters }],
    });
  }
  for (const booking of set.bookings) await insertSeedBooking(db, booking);
}

async function insertSeedBooking(db: Db, b: SeedBooking): Promise<void> {
  const member = await person(db, b.member);
  const station = (await db.query<{ id: string; site_id: string; kind: StationKind; time_zone: string }>(
    `SELECT st.id, st.site_id, st.kind, s.time_zone FROM stations st JOIN sites s ON s.id = st.site_id WHERE st.name = $1 AND s.name = $2`,
    [b.station, b.site],
  )).rows[0];
  if (!station) throw new Error(`seed set names unknown station ${b.station}`);
  const start = parseWall(b.window[0]) ?? 0;
  const end = parseWall(b.window[1]) ?? 0;
  const startAt = localToUtc(b.date, start, station.time_zone);
  const endAt = localToUtc(b.date, end, station.time_zone);
  const quarters = elapsedQuarters(b.date, start, end, station.time_zone);
  const manager = b.checkedIn ? (await db.query<{ id: string }>("SELECT id FROM users WHERE name = $1", [b.checkedIn.by])).rows[0] : undefined;
  const id = randomUUID();
  await db.query(
    `INSERT INTO bookings (id, tenant_id, reference, site_id, station_id, member_id, date, start_minutes, end_minutes, start_at, end_at, occupied_until,
       quarters, status, created_at, checked_in_at, checked_in_by_id, checked_in_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      id,
      member.tenant_id,
      b.reference,
      station.site_id,
      station.id,
      member.member_id,
      b.date,
      start,
      end,
      new Date(startAt),
      new Date(endAt),
      new Date(occupiedUntil(endAt, station.kind)),
      quarters,
      b.checkedIn ? "checked_in" : "confirmed",
      new Date(b.createdAt),
      b.checkedIn ? new Date(b.checkedIn.at) : null,
      manager?.id ?? null,
      b.checkedIn?.by ?? null,
    ],
  );
  await writeMovement(db, {
    memberId: member.member_id,
    kind: "booking_debit",
    quarters,
    actor: { userId: member.user_id, name: b.member, role: "member" },
    at: Date.parse(b.createdAt),
    bookingId: id,
    lots: await drawLots(db, member.member_id, quarters),
  });
}
