import { FLAVOURS, PROVINCES } from '../../shared/catalogue.js';
import {
  createAddress,
  createUser,
  ensureCollections,
  findUserByEmail,
  listAddresses,
  type UserRole,
} from '../services/pocketbase.js';
import { execute, query } from './pool.js';

interface SeedAccount {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  address?: {
    line1: string;
    city: string;
    province: string;
    postalCode: string;
  };
}

const SEED_ACCOUNTS: readonly SeedAccount[] = [
  {
    email: 'owner@ceibo.test',
    password: 'Ceibo-owner-2026',
    name: 'Marisol Ferreyra',
    role: 'owner',
  },
  { email: 'pack@ceibo.test', password: 'Ceibo-pack-2026', name: 'Tomas Leclerc', role: 'fulfilment' },
  { email: 'help@ceibo.test', password: 'Ceibo-help-2026', name: 'Priya Anand', role: 'support' },
  {
    email: 'camille@example.test',
    password: 'Shopper-2026-qc',
    name: 'Camille Roy',
    role: 'customer',
    address: {
      line1: '48 rue des Ceibos',
      city: 'Montreal',
      province: 'QC',
      postalCode: 'H2X 1Y4',
    },
  },
  {
    email: 'jordan@example.test',
    password: 'Shopper-2026-on',
    name: 'Jordan Mensah',
    role: 'customer',
    address: {
      line1: '77 Canopy Lane',
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M5V 2T6',
    },
  },
];

/** Creates each seed record when it is missing, on every start. */
export async function seedStore(): Promise<void> {
  for (const province of PROVINCES) {
    await execute(
      `insert into provinces (code, shipping_cents, free_shipping_threshold_cents)
       values ($1, $2, $3) on conflict (code) do nothing`,
      [province.code, province.shippingCents, province.freeShippingThresholdCents],
    );
  }
  for (const flavour of FLAVOURS) {
    await execute(
      `insert into flavours (slug, can_price_cents, released)
       values ($1, $2, $3) on conflict (slug) do nothing`,
      [flavour.slug, flavour.canPriceCents, flavour.released],
    );
    const received = await query<{ total: string }>(
      "select coalesce(sum(quantity), 0)::text as total from stock_events where flavour = $1 and kind = 'received'",
      [flavour.slug],
    );
    if (Number(received[0]?.total ?? '0') === 0) {
      await execute(
        "insert into stock_events (flavour, kind, quantity) values ($1, 'received', $2)",
        [flavour.slug, flavour.received],
      );
    }
  }
}

export async function seedAccounts(): Promise<void> {
  await ensureCollections();
  for (const account of SEED_ACCOUNTS) {
    let user = await findUserByEmail(account.email);
    if (user === null) {
      user = await createUser({
        email: account.email,
        password: account.password,
        name: account.name,
        role: account.role,
      });
    }
    if (account.address === undefined) continue;
    if ((await listAddresses(user.id)).length > 0) continue;
    await createAddress({
      user: user.id,
      name: account.name,
      line1: account.address.line1,
      line2: '',
      city: account.address.city,
      province: account.address.province,
      postal_code: account.address.postalCode,
      is_default: true,
    });
  }
}
