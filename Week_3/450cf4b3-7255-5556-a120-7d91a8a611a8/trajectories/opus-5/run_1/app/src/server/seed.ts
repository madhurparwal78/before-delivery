import { randomUUID } from 'node:crypto';
import { pool, query, queryOne, transactionNow, withTransaction, type Db } from './db';
import { hashPassword } from './passwords';
import { kitchenDate } from './kitchen-time';
import { SEED_STATIONS, STATION_CLEANUP_MINUTES } from './domain/stations';
import { addDays } from '../shared/format';
import { MINIMUM_PER_OCCURRENCE_LIMIT } from '../shared/copy';
import type { DocumentKind } from '../shared/types';

const SEED_VERSION = 'stationhouse-seed-v1';

interface SeedTenant {
  businessName: string;
  contactName: string;
  email: string;
  baseStatus: 'applied' | 'documents_pending' | 'approved';
  insuranceOffsetDays: number | null;
  foodHandlerOffsetDays: number | null;
}

const SEED_TENANTS: ReadonlyArray<SeedTenant> = [
  {
    businessName: 'Bright Fork Catering',
    contactName: 'Dana Okafor',
    email: 'dana@brightfork.test',
    baseStatus: 'approved',
    insuranceOffsetDays: 200,
    foodHandlerOffsetDays: 200,
  },
  {
    businessName: "T\u00edo Lalo's Tacos",
    contactName: 'Lalo Medina',
    email: 'lalo@tiolalo.test',
    baseStatus: 'approved',
    insuranceOffsetDays: 200,
    foodHandlerOffsetDays: 200,
  },
  {
    businessName: 'Crumb & Kettle Bakery',
    contactName: 'Pearl Asante',
    email: 'pearl@crumbkettle.test',
    baseStatus: 'approved',
    insuranceOffsetDays: 2,
    foodHandlerOffsetDays: 200,
  },
  {
    businessName: 'Saltbox Provisions',
    contactName: 'June Harrow',
    email: 'june@saltbox.test',
    baseStatus: 'approved',
    insuranceOffsetDays: 0,
    foodHandlerOffsetDays: 200,
  },
  {
    businessName: 'Night Market Dumplings',
    contactName: 'Wei Lindqvist',
    email: 'wei@nightmarket.test',
    baseStatus: 'approved',
    insuranceOffsetDays: -1,
    foodHandlerOffsetDays: 200,
  },
  {
    businessName: 'Copper Pot Jams',
    contactName: 'Sam Whitlock',
    email: 'sam@copperpot.test',
    baseStatus: 'documents_pending',
    insuranceOffsetDays: 200,
    foodHandlerOffsetDays: 200,
  },
  {
    businessName: 'Fennel & Fig',
    contactName: 'Ari Castellanos',
    email: 'ari@fennelfig.test',
    baseStatus: 'applied',
    insuranceOffsetDays: null,
    foodHandlerOffsetDays: null,
  },
];

async function insertDocument(
  client: Db,
  tenantId: string,
  kind: DocumentKind,
  expiresOn: string,
  uploadedAt: Date,
): Promise<void> {
  await query(
    client,
    `insert into documents (id, tenant_id, kind, expires_on, per_occurrence_limit, additional_insured,
       content_type, size_bytes, sha256, has_file, object_key, uploaded_at)
     values ($1,$2,$3,$4,$5,$6,null,null,null,false,null,$7)`,
    [
      randomUUID(),
      tenantId,
      kind,
      expiresOn,
      kind === 'insurance_certificate' ? MINIMUM_PER_OCCURRENCE_LIMIT : null,
      kind === 'insurance_certificate' ? true : null,
      uploadedAt,
    ],
  );
}

async function seedStations(client: Db): Promise<void> {
  for (const [index, station] of SEED_STATIONS.entries()) {
    await query(
      client,
      `insert into stations (id, name, kind, cleanup_minutes, col, row_index, seed_order)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do nothing`,
      [station.id, station.name, station.kind, STATION_CLEANUP_MINUTES, station.col, station.row, index],
    );
  }
}

async function seedPeople(client: Db): Promise<void> {
  const now = await transactionNow(client);
  const today = kitchenDate(now);

  const ownerHash = await hashPassword('owner-pass-2026');
  const leadHash = await hashPassword('lead-pass-2026');
  const tenantHash = await hashPassword('tenant-pass-2026');

  await query(
    client,
    `insert into users (id, role, email, password_hash, display_name, tenant_id)
     values ($1,'owner',$2,$3,$4,null) on conflict (email) do nothing`,
    [randomUUID(), 'owner@stationhouse.test', ownerHash, 'Imani Ferro'],
  );
  await query(
    client,
    `insert into users (id, role, email, password_hash, display_name, tenant_id)
     values ($1,'shift_lead',$2,$3,$4,null) on conflict (email) do nothing`,
    [randomUUID(), 'lead@stationhouse.test', leadHash, 'Theo Park'],
  );

  for (const seed of SEED_TENANTS) {
    const tenantId = randomUUID();
    await query(
      client,
      `insert into tenants (id, business_name, contact_name, email, base_status)
       values ($1,$2,$3,$4,$5)`,
      [tenantId, seed.businessName, seed.contactName, seed.email, seed.baseStatus],
    );
    await query(
      client,
      `insert into users (id, role, email, password_hash, display_name, tenant_id)
       values ($1,'tenant',$2,$3,$4,$5)`,
      [randomUUID(), seed.email, tenantHash, seed.contactName, tenantId],
    );
    if (seed.insuranceOffsetDays !== null) {
      await insertDocument(
        client,
        tenantId,
        'insurance_certificate',
        addDays(today, seed.insuranceOffsetDays),
        now,
      );
    }
    if (seed.foodHandlerOffsetDays !== null) {
      await insertDocument(
        client,
        tenantId,
        'food_handler_card',
        addDays(today, seed.foodHandlerOffsetDays),
        now,
      );
    }
  }
}

/** Applies seed data once per database, however many processes start at once. */
export async function applySeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [SEED_VERSION]);
    try {
      await withTransaction(async (tx) => {
        await seedStations(tx);
        const done = await queryOne<{ key: string }>(tx, 'select key from seed_state where key = $1', [
          SEED_VERSION,
        ]);
        if (done !== null) return;
        await seedPeople(tx);
        await query(tx, 'insert into seed_state (key, value) values ($1, $2)', [SEED_VERSION, 'applied']);
      });
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [SEED_VERSION]);
    }
  } finally {
    client.release();
  }
}
