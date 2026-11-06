import { db, writeTx } from './db.ts';
import { clubWallClockAfterDays, toIsoSeconds } from './domain/clubTime.ts';
import { householdAccount } from './domain/credit.ts';

interface SeedHousehold {
  code: string;
  name: string;
  email: string;
  carriedForwardCents: number;
  accessCode: string;
}

const HOUSEHOLDS: SeedHousehold[] = [
  { code: 'HH-1001', name: 'Okafor-Lindqvist household', email: 'hh1001@elmstreet.example', carriedForwardCents: 12_000, accessCode: 'HOME-1001' },
  { code: 'HH-1002', name: 'Bellweather household', email: 'hh1002@elmstreet.example', carriedForwardCents: 8_000, accessCode: 'HOME-1002' },
  { code: 'HH-1003', name: 'Tran-Osei household', email: 'hh1003@elmstreet.example', carriedForwardCents: 6_000, accessCode: 'HOME-1003' },
  { code: 'HH-1004', name: 'Kowalczyk household', email: 'hh1004@elmstreet.example', carriedForwardCents: 9_500, accessCode: 'HOME-1004' },
  { code: 'HH-1005', name: 'Ruiz-Abernathy household', email: 'hh1005@elmstreet.example', carriedForwardCents: 1_500, accessCode: 'HOME-1005' },
  { code: 'HH-1006', name: 'Patel-Mercer household', email: 'hh1006@elmstreet.example', carriedForwardCents: 0, accessCode: 'HOME-1006' },
];

const PRODUCTS = [
  { id: 'P-OATS', case_name: 'Rolled oats, 25 lb sack', pack: 25, unit: 'lb', price_cents: 3_850 },
  { id: 'P-TAHINI', case_name: 'Tahini, 12 jars', pack: 12, unit: 'jar', price_cents: 4_700 },
  { id: 'P-OLIVE', case_name: 'Olive oil, 6 bottles', pack: 6, unit: 'bottle', price_cents: 8_999 },
  { id: 'P-LENTIL', case_name: 'Red lentils, 25 lb sack', pack: 25, unit: 'lb', price_cents: 4_125 },
  { id: 'P-PNUT', case_name: 'Peanut butter, 12 jars', pack: 12, unit: 'jar', price_cents: 5_150 },
  { id: 'P-MAPLE', case_name: 'Maple syrup, 6 jugs', pack: 6, unit: 'jug', price_cents: 7_400 },
  { id: 'P-RICE', case_name: 'Brown rice, 50 lb sack', pack: 50, unit: 'lb', price_cents: 6_299 },
  { id: 'P-QUINOA', case_name: 'Quinoa, 10 lb bag', pack: 10, unit: 'lb', price_cents: 3_333 },
];

const SEED_LINES: { productId: string; version: number }[] = [
  { productId: 'P-TAHINI', version: 3 },
  { productId: 'P-OLIVE', version: 2 },
  { productId: 'P-OATS', version: 1 },
  { productId: 'P-MAPLE', version: 2 },
];

const SEED_PLEDGES = [
  { productId: 'P-TAHINI', pledger: 'HH-1002', units: 5 },
  { productId: 'P-TAHINI', pledger: 'HH-1003', units: 4 },
  { productId: 'P-OLIVE', pledger: 'HH-1004', units: 4 },
  { productId: 'P-MAPLE', pledger: 'HH-1001', units: 6 },
];

export function seedIfNeeded(): void {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM club').get() as { count: number };
  if (existing.count > 0) return;
  writeTx(() => {
    const timeZone = 'America/Chicago';
    const now = new Date();
    const createdAt = toIsoSeconds(now);
    db.prepare('INSERT INTO club (id, name, time_zone, distributor, created_at) VALUES (1, ?, ?, ?, ?)').run(
      'Elm Street Basement Co-op',
      timeZone,
      'Prairie Hollow Naturals',
      createdAt,
    );

    const person = db.prepare('INSERT INTO people (id, name, role, access_code, household_code) VALUES (?, ?, ?, ?, ?)');
    person.run('p-coord', 'Marisol Ferreira-Quinn', 'coordinator', 'COORD-2718', null);
    person.run('p-vol', 'Desmond Achterberg', 'volunteer', 'VOL-3141', null);

    const household = db.prepare('INSERT INTO households (code, name, email, position) VALUES (?, ?, ?, ?)');
    HOUSEHOLDS.forEach((entry, index) => {
      household.run(entry.code, entry.name, entry.email, index + 1);
      person.run(`p-${entry.code}`, entry.name, 'member', entry.accessCode, entry.code);
      if (entry.carriedForwardCents === 0) return;
      const info = db
        .prepare('INSERT INTO movements (kind, cycle_id, memo, created_at) VALUES (?, ?, ?, ?)')
        .run('carried_forward', null, 'Carried forward', createdAt);
      const movementId = Number(info.lastInsertRowid);
      const leg = db.prepare('INSERT INTO legs (movement_id, account, amount_cents) VALUES (?, ?, ?)');
      leg.run(movementId, householdAccount(entry.code), entry.carriedForwardCents);
      leg.run(movementId, 'opening:carried-forward', -entry.carriedForwardCents);
    });

    const product = db
      .prepare('INSERT INTO products (id, case_name, pack, unit, price_cents, position) VALUES (?, ?, ?, ?, ?, ?)');
    PRODUCTS.forEach((entry, index) => {
      product.run(entry.id, entry.case_name, entry.pack, entry.unit, entry.price_cents, index + 1);
    });

    const cutoff = clubWallClockAfterDays(now.getTime(), 7, 20, 0, 0, timeZone);
    const pickupStart = clubWallClockAfterDays(now.getTime(), 8, 9, 0, 0, timeZone);
    const pickupEnd = clubWallClockAfterDays(now.getTime(), 8, 12, 0, 0, timeZone);
    db.prepare(
      `INSERT INTO cycles (id, name, status, revision, cutoff_at, pickup_start_at, pickup_end_at, created_at, position)
       VALUES (?, ?, 'open', 2, ?, ?, ?, ?, 1)`,
    ).run('cy-44', 'Cycle 44', toIsoSeconds(cutoff), toIsoSeconds(pickupStart), toIsoSeconds(pickupEnd), createdAt);

    const line = db
      .prepare("INSERT INTO cycle_lines (cycle_id, product_id, position, version, status) VALUES (?, ?, ?, ?, 'filling')");
    SEED_LINES.forEach((entry, index) => {
      line.run('cy-44', entry.productId, index + 1, entry.version);
    });

    const pledge = db
      .prepare('INSERT INTO pledges (cycle_id, product_id, pledger, units, created_at) VALUES (?, ?, ?, ?, ?)');
    const event = db
      .prepare('INSERT INTO pledge_events (cycle_id, product_id, pledger, delta, at) VALUES (?, ?, ?, ?, ?)');
    for (const entry of SEED_PLEDGES) {
      pledge.run('cy-44', entry.productId, entry.pledger, entry.units, createdAt);
      event.run('cy-44', entry.productId, entry.pledger, entry.units, createdAt);
    }
  });
}
