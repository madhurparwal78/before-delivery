import { createHash, randomBytes, scryptSync } from 'node:crypto';
import type { Queryable } from './db.js';
import { SCHEMA_SQL } from './schema.js';
import type { DayEntry } from './domain/hours.js';

const UUID_NAMESPACE = 'd2a7f4ec-9c65-4f1f-9f7e-5b0a6c1d8e30';

/** A stable UUID (version 5) so every app copy seeds the same rows. */
function stableUuid(name: string): string {
  const hash = createHash('sha1');
  hash.update(Buffer.from(UUID_NAMESPACE.replace(/-/g, ''), 'hex'));
  hash.update(Buffer.from(name, 'utf8'));
  const bytes = hash.digest().subarray(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, saltHex, expected] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !expected) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 32).toString('hex');
  return derived.length === expected.length && timingSafeEqualHex(derived, expected);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  let different = 0;
  for (let index = 0; index < a.length; index += 1) {
    different |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return different === 0;
}

const DAILY: DayEntry[] = Array.from({ length: 7 }, (_unused, index) => ({
  weekday: index + 1,
  open: true,
  opens: '08:00',
  closes: '20:00',
}));

const STANDARD: DayEntry[] = Array.from({ length: 7 }, (_unused, index) => {
  const weekday = index + 1;
  if (weekday <= 5) return { weekday, open: true, opens: '09:00', closes: '19:00' };
  if (weekday === 6) return { weekday, open: true, opens: '09:00', closes: '13:00' };
  return { weekday, open: false, opens: null, closes: null };
});

const OPERATORS = [
  { id: 'atlantico', name: 'Grupo Atlântico Ferragens', prefix: 'AT' },
  { id: 'casalusa', name: 'Casa Lusa Ferragens', prefix: 'CL' },
];

type SeedPerson = {
  email: string;
  name: string;
  role: 'lead' | 'manager' | 'care' | 'shopper';
  operator: string;
  stores: string[];
};

const PEOPLE: SeedPerson[] = [
  { email: 'lead.atlantico@tramela.example', name: 'Inês Carvalho', role: 'lead', operator: 'atlantico', stores: [] },
  { email: 'gerente.faro@tramela.example', name: 'Tiago Mendes', role: 'manager', operator: 'atlantico', stores: ['AT05', 'AT06'] },
  { email: 'gerente.lisboa@tramela.example', name: 'Rui Antunes', role: 'manager', operator: 'atlantico', stores: ['AT01'] },
  { email: 'gerente.pdelgada@tramela.example', name: 'Sofia Medeiros', role: 'manager', operator: 'atlantico', stores: ['AT11'] },
  { email: 'apoio.atlantico@tramela.example', name: 'Joana Pires', role: 'care', operator: 'atlantico', stores: [] },
  { email: 'cliente.ana@tramela.example', name: 'Ana Ribeiro', role: 'shopper', operator: 'atlantico', stores: [] },
  { email: 'cliente.bruno@tramela.example', name: 'Bruno Faria', role: 'shopper', operator: 'atlantico', stores: [] },
  { email: 'cliente.eva@tramela.example', name: 'Eva Couto', role: 'shopper', operator: 'atlantico', stores: [] },
  { email: 'cliente.filipe@tramela.example', name: 'Filipe Rocha', role: 'shopper', operator: 'atlantico', stores: [] },
  { email: 'cliente.gil@tramela.example', name: 'Gil Moreira', role: 'shopper', operator: 'atlantico', stores: [] },
  { email: 'cliente.helena@tramela.example', name: 'Helena Duarte', role: 'shopper', operator: 'atlantico', stores: [] },
  { email: 'lead.casalusa@tramela.example', name: 'Marta Lopes', role: 'lead', operator: 'casalusa', stores: [] },
  { email: 'gerente.braga@tramela.example', name: 'Hugo Sá', role: 'manager', operator: 'casalusa', stores: ['CL03'] },
  { email: 'apoio.casalusa@tramela.example', name: 'Carla Nunes', role: 'care', operator: 'casalusa', stores: [] },
  { email: 'cliente.diogo@tramela.example', name: 'Diogo Teixeira', role: 'shopper', operator: 'casalusa', stores: [] },
];

type SeedStore = {
  id: string;
  operator: string;
  name: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
  hours: 'daily' | 'standard';
  suspensionReason: string | null;
};

const STORES: SeedStore[] = [
  { id: 'AT01', operator: 'atlantico', name: 'Loja Lisboa Baixa', city: 'Lisboa', region: 'centro', lat: 38.711, lon: -9.1366, timezone: 'Europe/Lisbon', hours: 'daily', suspensionReason: null },
  { id: 'AT02', operator: 'atlantico', name: 'Loja Lisboa Alvalade', city: 'Lisboa', region: 'centro', lat: 38.753, lon: -9.144, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'AT03', operator: 'atlantico', name: 'Loja Almada', city: 'Almada', region: 'centro', lat: 38.679, lon: -9.1569, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'AT04', operator: 'atlantico', name: 'Loja Setúbal', city: 'Setúbal', region: 'centro', lat: 38.5244, lon: -8.8882, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'AT05', operator: 'atlantico', name: 'Loja Faro Centro', city: 'Faro', region: 'sul', lat: 37.0194, lon: -7.9304, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'AT06', operator: 'atlantico', name: 'Loja Olhão', city: 'Olhão', region: 'sul', lat: 37.026, lon: -7.8411, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'AT07', operator: 'atlantico', name: 'Loja Portimão', city: 'Portimão', region: 'sul', lat: 37.1386, lon: -8.537, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: 'Flood repairs' },
  { id: 'AT08', operator: 'atlantico', name: 'Loja Porto Bolhão', city: 'Porto', region: 'norte', lat: 41.1496, lon: -8.6067, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'AT09', operator: 'atlantico', name: 'Loja Matosinhos', city: 'Matosinhos', region: 'norte', lat: 41.1844, lon: -8.6963, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'AT10', operator: 'atlantico', name: 'Loja Braga Sé', city: 'Braga', region: 'norte', lat: 41.5503, lon: -8.427, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'AT11', operator: 'atlantico', name: 'Loja Ponta Delgada', city: 'Ponta Delgada', region: 'sao_miguel', lat: 37.7412, lon: -25.6756, timezone: 'Atlantic/Azores', hours: 'daily', suspensionReason: null },
  { id: 'AT12', operator: 'atlantico', name: 'Loja Angra do Heroísmo', city: 'Angra do Heroísmo', region: 'terceira', lat: 38.655, lon: -27.221, timezone: 'Atlantic/Azores', hours: 'standard', suspensionReason: null },
  { id: 'CL01', operator: 'casalusa', name: 'Casa Lusa Porto Boavista', city: 'Porto', region: 'norte', lat: 41.1612, lon: -8.644, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'CL02', operator: 'casalusa', name: 'Casa Lusa Gaia', city: 'Vila Nova de Gaia', region: 'norte', lat: 41.1239, lon: -8.6118, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'CL03', operator: 'casalusa', name: 'Casa Lusa Braga', city: 'Braga', region: 'norte', lat: 41.5454, lon: -8.4265, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'CL04', operator: 'casalusa', name: 'Casa Lusa Coimbra', city: 'Coimbra', region: 'centro', lat: 40.2033, lon: -8.4103, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'CL05', operator: 'casalusa', name: 'Casa Lusa Aveiro', city: 'Aveiro', region: 'centro', lat: 40.6405, lon: -8.6538, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'CL06', operator: 'casalusa', name: 'Casa Lusa Lisboa Benfica', city: 'Lisboa', region: 'centro', lat: 38.751, lon: -9.201, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'CL07', operator: 'casalusa', name: 'Casa Lusa Cascais', city: 'Cascais', region: 'centro', lat: 38.6979, lon: -9.4215, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'CL08', operator: 'casalusa', name: 'Casa Lusa Faro', city: 'Faro', region: 'sul', lat: 37.017, lon: -7.935, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: null },
  { id: 'CL09', operator: 'casalusa', name: 'Casa Lusa Lagos', city: 'Lagos', region: 'sul', lat: 37.1028, lon: -8.673, timezone: 'Europe/Lisbon', hours: 'standard', suspensionReason: 'Stocktake' },
  { id: 'CL10', operator: 'casalusa', name: 'Casa Lusa Ribeira Grande', city: 'Ribeira Grande', region: 'sao_miguel', lat: 37.821, lon: -25.515, timezone: 'Atlantic/Azores', hours: 'standard', suspensionReason: null },
];

const PRODUCTS = [
  { operator: 'atlantico', sku: 'VM-750', name: 'Verniz marítimo 750 ml', price: 24900 },
  { operator: 'atlantico', sku: 'TE-BR-4L', name: 'Tinta esmalte branca 4 L', price: 38500 },
  { operator: 'atlantico', sku: 'FITA-48', name: 'Fita-cola de pintor 48 mm', price: 4995 },
  { operator: 'atlantico', sku: 'PRF-440', name: 'Parafuso inox A2 4x40 mm (unidade)', price: 35 },
  { operator: 'atlantico', sku: 'MANG-25', name: 'Mangueira de jardim 25 m', price: 29990 },
  { operator: 'atlantico', sku: 'TES-POD', name: 'Tesoura de poda', price: 12490 },
  { operator: 'atlantico', sku: 'CAD-40', name: 'Cadeado latão 40 mm', price: 9990 },
  { operator: 'atlantico', sku: 'REL-1KG', name: 'Semente de relva 1 kg', price: 7450 },
  { operator: 'casalusa', sku: 'CL-VM-750', name: 'Verniz marítimo 750 ml', price: 26500 },
  { operator: 'casalusa', sku: 'CL-TP-5L', name: 'Tinta plástica branca 5 L', price: 31900 },
  { operator: 'casalusa', sku: 'CL-PRG-50', name: 'Prego aço 50 mm (unidade)', price: 20 },
  { operator: 'casalusa', sku: 'CL-REG-10', name: 'Regador 10 L', price: 8750 },
  { operator: 'casalusa', sku: 'CL-LUV', name: 'Luvas de jardim', price: 3990 },
];

const STOCK_OVERRIDES: Record<string, number> = {
  'AT01|PRF-440': 500,
  'AT01|FITA-48': 60,
  'AT05|VM-750': 1,
  'AT05|TES-POD': 2,
  'AT06|VM-750': 1,
  'AT11|VM-750': 2,
  'AT11|MANG-25': 0,
  'AT12|VM-750': 3,
  'CL08|CL-VM-750': 1,
};

export const AREAS = [
  { name: 'Lisboa', lat: 38.7223, lon: -9.1393 },
  { name: 'Porto', lat: 41.1579, lon: -8.6291 },
  { name: 'Faro', lat: 37.0194, lon: -7.9304 },
  { name: 'Coimbra', lat: 40.2033, lon: -8.4103 },
  { name: 'Braga', lat: 41.5454, lon: -8.4265 },
  { name: 'Ponta Delgada', lat: 37.7412, lon: -25.6756 },
  { name: 'Angra do Heroísmo', lat: 38.655, lon: -27.221 },
];

const SEED_PASSWORD = 'estate-demo-2026';
const SEED_EFFECTIVE_FROM = '2020-01-01';

export async function applySchemaAndSeed(tx: Queryable): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(7312094461201)');
  await tx.query(SCHEMA_SQL);

  for (const operator of OPERATORS) {
    await tx.query(
      `INSERT INTO operators (id, name, order_prefix) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [operator.id, operator.name, operator.prefix],
    );
    await tx.query(
      `INSERT INTO order_numbers (operator_id, next_number) VALUES ($1, 1)
       ON CONFLICT (operator_id) DO NOTHING`,
      [operator.id],
    );
  }

  for (const store of STORES) {
    await tx.query(
      `INSERT INTO stores (id, operator_id, name, city, region, lat, lon, timezone, vat_rate, suspended, suspension_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [
        store.id,
        store.operator,
        store.name,
        store.city,
        store.region,
        store.lat,
        store.lon,
        store.timezone,
        store.timezone === 'Atlantic/Azores' ? 16 : 23,
        store.suspensionReason !== null,
        store.suspensionReason,
      ],
    );
    await tx.query(
      `INSERT INTO hours_plans (store_id, effective_from, days) VALUES ($1, $2, $3)
       ON CONFLICT (store_id, effective_from) DO NOTHING`,
      [store.id, SEED_EFFECTIVE_FROM, JSON.stringify(store.hours === 'daily' ? DAILY : STANDARD)],
    );
  }

  const existingEmails = new Set(
    (await tx.query(`SELECT email FROM users`)).rows.map((row) => row['email'] as string),
  );

  for (const person of PEOPLE) {
    const id = stableUuid(person.email);
    if (!existingEmails.has(person.email)) {
      await tx.query(
        `INSERT INTO users (id, operator_id, email, name, role, password_hash)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO NOTHING`,
        [id, person.operator, person.email, person.name, person.role, hashPassword(SEED_PASSWORD)],
      );
    }
    for (const storeId of person.stores) {
      await tx.query(
        `INSERT INTO user_stores (user_id, store_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, storeId],
      );
    }
    if (person.role === 'shopper') {
      await tx.query(`INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
    }
  }

  for (const product of PRODUCTS) {
    await tx.query(
      `INSERT INTO products (operator_id, sku, name, unit_price_milli) VALUES ($1,$2,$3,$4)
       ON CONFLICT (operator_id, sku) DO NOTHING`,
      [product.operator, product.sku, product.name, product.price],
    );
  }

  for (const store of STORES) {
    for (const product of PRODUCTS) {
      if (product.operator !== store.operator) continue;
      const onHand = STOCK_OVERRIDES[`${store.id}|${product.sku}`] ?? 20;
      await tx.query(
        `INSERT INTO stock (store_id, sku, on_hand, held) VALUES ($1,$2,$3,0)
         ON CONFLICT (store_id, sku) DO NOTHING`,
        [store.id, product.sku, onHand],
      );
    }
  }
}
