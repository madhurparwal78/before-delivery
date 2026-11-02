import { pool, withClient } from './db.js';
import { databaseName, env } from './env.js';
import * as pb from './services/pocketbase.js';
import * as kb from './services/killbill.js';
import { FLAVOUR_ORDER, pushStockLevels } from './domain/catalogue.js';

const FLAVOURS = [
  { slug: 'guava-lime', name: 'Guava & Lime', can_price_cents: 333, limited: false, subscribable: true, received: 600, released: null as number | null },
  { slug: 'yuzu-ginger', name: 'Yuzu Ginger', can_price_cents: 333, limited: false, subscribable: true, received: 600, released: null },
  { slug: 'passionfruit-basil', name: 'Passionfruit Basil', can_price_cents: 333, limited: false, subscribable: true, received: 600, released: null },
  { slug: 'cacao-orange', name: 'Cacao Orange', can_price_cents: 375, limited: true, subscribable: false, received: 120, released: 48 },
];

const PROVINCES = [
  { code: 'AB', name: 'Alberta', shipping_cents: 1495, threshold: 4500, deposit: 10, taxes: [{ name: 'GST', rate_milli: 5000 }], postal: ['T'] },
  { code: 'BC', name: 'British Columbia', shipping_cents: 1495, threshold: 4500, deposit: 10, taxes: [{ name: 'GST', rate_milli: 5000 }, { name: 'PST', rate_milli: 7000 }], postal: ['V'] },
  { code: 'NS', name: 'Nova Scotia', shipping_cents: 1695, threshold: 5000, deposit: 10, taxes: [{ name: 'HST', rate_milli: 14000 }], postal: ['B'] },
  { code: 'ON', name: 'Ontario', shipping_cents: 1295, threshold: 3500, deposit: 0, taxes: [{ name: 'HST', rate_milli: 13000 }], postal: ['K', 'L', 'M', 'N', 'P'] },
  { code: 'QC', name: 'Quebec', shipping_cents: 1295, threshold: 3500, deposit: 10, taxes: [{ name: 'GST', rate_milli: 5000 }, { name: 'QST', rate_milli: 9975 }], postal: ['G', 'H', 'J'] },
];

const USERS = [
  { email: 'owner@ceibo.test', password: 'Ceibo-owner-2026', name: 'Marisol Ferreyra', role: 'owner' },
  { email: 'pack@ceibo.test', password: 'Ceibo-pack-2026', name: 'Tomas Leclerc', role: 'fulfilment' },
  { email: 'help@ceibo.test', password: 'Ceibo-help-2026', name: 'Priya Anand', role: 'support' },
  { email: 'camille@example.test', password: 'Shopper-2026-qc', name: 'Camille Roy', role: 'customer' },
  { email: 'jordan@example.test', password: 'Shopper-2026-on', name: 'Jordan Mensah', role: 'customer' },
];

export const PLANS = [
  'ceibo-guava-lime-monthly',
  'ceibo-guava-lime-bimonthly',
  'ceibo-yuzu-ginger-monthly',
  'ceibo-yuzu-ginger-bimonthly',
  'ceibo-passionfruit-basil-monthly',
  'ceibo-passionfruit-basil-bimonthly',
  'ceibo-discovery-monthly',
  'ceibo-discovery-bimonthly',
];

export async function seed(): Promise<void> {
  await withClient(async (client) => {
    for (const f of FLAVOURS) {
      await client.query(
        `insert into flavours (slug, name, can_price_cents, limited, subscribable, received, released)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (slug) do nothing`,
        [f.slug, f.name, f.can_price_cents, f.limited, f.subscribable, f.received, f.released]
      );
      const existing = await client.query<{ n: number }>(
        "select count(*)::int as n from stock_ledger where flavour = $1 and kind = 'received'",
        [f.slug]
      );
      if (existing.rows[0].n === 0) {
        await client.query(
          "insert into stock_ledger (flavour, kind, qty) values ($1, 'received', $2)",
          [f.slug, f.received]
        );
      }
    }
    for (const p of PROVINCES) {
      await client.query(
        `insert into provinces (code, name, shipping_cents, free_shipping_threshold_cents, deposit_cents_per_can)
         values ($1,$2,$3,$4,$5) on conflict (code) do nothing`,
        [p.code, p.name, p.shipping_cents, p.threshold, p.deposit]
      );
      for (let i = 0; i < p.taxes.length; i++) {
        await client.query(
          `insert into province_taxes (code, name, rate_milli, sort) values ($1,$2,$3,$4)
           on conflict (code, name) do nothing`,
          [p.code, p.taxes[i].name, p.taxes[i].rate_milli, i]
        );
      }
    }
  });
  await pushStockLevels().catch(() => {});
}

export async function seedAccounts(): Promise<void> {
  for (const user of USERS) {
    try {
      const existing = await pb.findUserByEmail(user.email);
      if (existing) continue;
      await pb.createUser(user.email, user.password, user.name, user.role);
    } catch {
      // PocketBase may be down at boot; retried on the next start.
      return;
    }
  }
  const camille = await pb.findUserByEmail('camille@example.test').catch(() => null);
  const jordan = await pb.findUserByEmail('jordan@example.test').catch(() => null);
  if (camille) {
    const addresses = await pb.listAddresses(camille.id).catch(() => []);
    if (addresses.length === 0) {
      await pb.createAddress({
        user: camille.id,
        name: 'Camille Roy',
        line1: '48 rue des Ceibos',
        line2: '',
        city: 'Montreal',
        province: 'QC',
        postal_code: 'H2X 1Y4',
        is_default: true,
        id: '',
        created: '',
      } as unknown as pb.PbAddress).catch(() => {});
    }
  }
  if (jordan) {
    const addresses = await pb.listAddresses(jordan.id).catch(() => []);
    if (addresses.length === 0) {
      await pb.createAddress({
        user: jordan.id,
        name: 'Jordan Mensah',
        line1: '77 Canopy Lane',
        line2: '',
        city: 'Toronto',
        province: 'ON',
        postal_code: 'M5V 2T6',
        is_default: true,
        id: '',
        created: '',
      } as unknown as pb.PbAddress).catch(() => {});
    }
  }
}

export async function seedCatalog(): Promise<void> {
  try {
    const names = await kb.catalogPlanNames();
    const missing = PLANS.filter((p) => !names.includes(p));
    if (missing.length > 0) {
      await kb.uploadSimplePlans(
        PLANS.map((planId) => ({
          planId,
          productName: 'ceibo-box',
          billingPeriod: planId.endsWith('bimonthly') ? 'BIMESTRIAL' : 'MONTHLY',
          amount: 35.96,
        }))
      );
    }
  } catch (e) {
    if (e instanceof kb.KillBillUnavailable) {
      console.error('[seed] Kill Bill unreachable; catalog upload will be retried on next start');
      return;
    }
    throw e;
  }
}

export async function seedStockLevels(): Promise<void> {
  try {
    await pushStockLevels();
  } catch {
    // PocketBase down; the stock feed will catch up later.
  }
}

export function postalLetters(code: string): string[] {
  return PROVINCES.find((p) => p.code === code)?.postal ?? [];
}

export { FLAVOUR_ORDER, env, databaseName, pool };
