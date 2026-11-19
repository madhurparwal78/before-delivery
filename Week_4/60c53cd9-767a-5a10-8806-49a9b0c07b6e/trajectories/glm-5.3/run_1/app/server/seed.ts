// The seed data (Seed data section) and the idempotent first-start seeding.
// Prices, bearings, facings, areas and views are all derived here from the
// published tables, and the count 288 is asserted.
import { createHash } from 'node:crypto';
import type { AppClock } from './clock.js';
import type { Store } from './store/store.js';
import { hashPassword } from './store/store.js';
import { BAND_IDS, STACKS, STACK_BEARINGS, STACK_META, areaSqft, bandForFloor, facingForBearing, priceFor, unitCode, viewFor, type BandId, type Stack } from './domain/shared.js';

export const SEED_ACCOUNTS: Array<{ id: string; name: string; email: string; password: string; role: 'buyer' | 'coordinator' }> = [
  { id: 'acct-mira', name: 'Mira Castell', email: 'mira.castell@orrinvale.example', password: 'Highwater-Console-26', role: 'coordinator' },
  { id: 'acct-ana', name: 'Ana Ferreira', email: 'ana.ferreira@example.com', password: 'Window-Seat-2026', role: 'buyer' },
  { id: 'acct-tom', name: 'Tom Okafor', email: 'tom.okafor@example.com', password: 'Harbour-Line-2026', role: 'buyer' },
];

export async function seed(store: Store, clock: AppClock): Promise<void> {
  const now = clock.nowIso();

  // Units: floors 3 to 38, stacks A to H.
  const values: unknown[][] = [];
  for (let floor = 3; floor <= 38; floor++) {
    for (const stack of STACKS) {
      const meta = STACK_META[stack];
      const code = unitCode(floor, stack);
      const band = bandForFloor(floor);
      const bearing = STACK_BEARINGS[stack];
      const facing = facingForBearing(bearing);
      const viewTag = viewFor(floor, stack);
      const price = priceFor(floor, stack);
      const sqft = areaSqft(meta.areaM2);
      const released = band !== '36-38';
      values.push([
        code, floor, stack, band, meta.bedrooms, meta.areaM2, sqft, bearing, facing, viewTag,
        released, false, released ? 'available' : 'unreleased', price, 1,
      ]);
    }
  }
  if (values.length !== 288) throw new Error(`seed unit count ${values.length} != 288`);

  await store.transaction(async (tx) => {
    const chunkSize = 96;
    for (let start = 0; start < values.length; start += chunkSize) {
      const chunk = values.slice(start, start + chunkSize);
      if (chunk.length === 0) continue;
      const params: unknown[] = [];
      const tuples = chunk.map((row) => {
        const placeholders = row.map((value) => `$${params.push(value)}`);
        return `(${placeholders.join(',')})`;
      });
      await tx.query(
        `INSERT INTO units (code, floor, stack, band, bedrooms, area_m2, area_sqft, bearing, facing, view_tag, released, withdrawn, status, price, price_version)
         VALUES ${tuples.join(',')}
         ON CONFLICT (code) DO NOTHING`,
        params,
      );
    }

    // Accounts.
    for (const account of SEED_ACCOUNTS) {
      await tx.query(
        `INSERT INTO accounts (id, email, name, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO NOTHING`,
        [account.id, account.email, account.name, hashPassword(account.password), account.role, now],
      );
    }

    // Every unit's price version 1, set by the coordinator at seeding time.
    const versions = await tx.query(`SELECT count(*)::int AS c FROM price_versions`);
    if (Number(versions.rows[0].c) === 0) {
      const all = await tx.query(`SELECT code, price FROM units`);
      for (const row of all.rows) {
        await tx.query(
          `INSERT INTO price_versions (unit_code, version, price, set_by, set_at) VALUES ($1, 1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [String(row.code), String(row.price), 'Mira Castell', now],
        );
      }
    }

    // Seed state: 5D withdrawn, 12C reserved through Ana's converted hold, 31F held by Tom.
    await tx.query(`UPDATE units SET withdrawn = true, status = 'withdrawn' WHERE code = '5D' AND withdrawn = false`);
    await tx.query(`UPDATE units SET status = 'reserved' WHERE code = '12C' AND status = 'available'`);
    await tx.query(`UPDATE units SET status = 'held' WHERE code = '31F' AND status = 'available'`);

    // Ana's converted hold on 12C. Conversion starts no cooldown.
    const ana = await tx.query(`SELECT id FROM accounts WHERE email = $1`, ['ana.ferreira@example.com']);
    const anaId = ana.rows.length > 0 ? String(ana.rows[0].id) : null;
    const tom = await tx.query(`SELECT id FROM accounts WHERE email = $1`, ['tom.okafor@example.com']);
    const tomId = tom.rows.length > 0 ? String(tom.rows[0].id) : null;
    const unit12C = await tx.query(`SELECT price FROM units WHERE code = '12C'`);
    const unit31F = await tx.query(`SELECT price FROM units WHERE code = '31F'`);

    if (anaId && unit12C.rows.length > 0) {
      const seedTime = '2026-01-01T00:00:00Z';
      await tx.query(
        `INSERT INTO holds (id, unit_code, account_id, status, ended_by, quoted_price, price_version, created_at, ends_at, ended_at)
         VALUES ($1, '12C', $2, 'converted', 'conversion', $3, 1, $4, $5, $5) ON CONFLICT (id) DO NOTHING`,
        [deterministicUuid('hold-12c-converted'), anaId, String(unit12C.rows[0].price), seedTime, seedTime],
      );
    }
    if (tomId && unit31F.rows.length > 0) {
      const endsAt = new Date(new Date(now).getTime() + holdSeconds() * 1000).toISOString();
      await tx.query(
        `INSERT INTO holds (id, unit_code, account_id, status, ended_by, quoted_price, price_version, created_at, ends_at, ended_at)
         VALUES ($1, '31F', $2, 'active', NULL, $3, 1, $4, $5, NULL) ON CONFLICT (id) DO NOTHING`,
        [deterministicUuid('hold-31f-active'), tomId, String(unit31F.rows[0].price), now, endsAt],
      );
    }
  });
}

function deterministicUuid(seedText: string): string {
  const hash = createHash('sha256').update(seedText).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function holdSeconds(): number {
  return Number(process.env.HOLD_SECONDS ?? 259200);
}
