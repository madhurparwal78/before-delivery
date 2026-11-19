import type { Pool } from 'pg';
import { allSeatIds, seatFacts } from './hall';

export type Db = Pool;

export async function applySchema(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS performances (
      id text PRIMARY KEY,
      title text NOT NULL,
      starts_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tiers (
      performance_id text NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
      id text NOT NULL,
      name text NOT NULL,
      face_cents integer NOT NULL,
      PRIMARY KEY (performance_id, id)
    );
    CREATE TABLE IF NOT EXISTS seats (
      performance_id text NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
      seat_id text NOT NULL,
      tier_id text,
      state text NOT NULL DEFAULT 'on_sale' CHECK (state IN ('on_sale','held','sold','offered','not_on_sale')),
      hold_token text,
      PRIMARY KEY (performance_id, seat_id)
    );
    CREATE INDEX IF NOT EXISTS seats_state_idx ON seats (performance_id, state);
    CREATE INDEX IF NOT EXISTS seats_tier_idx ON seats (performance_id, tier_id, state);
    CREATE INDEX IF NOT EXISTS seats_hold_token_idx ON seats (hold_token);
    CREATE TABLE IF NOT EXISTS holds (
      performance_id text NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
      buyer_id text NOT NULL,
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (performance_id, buyer_id)
    );
    CREATE INDEX IF NOT EXISTS holds_expiry_idx ON holds (expires_at);
    CREATE TABLE IF NOT EXISTS orders (
      id text PRIMARY KEY,
      performance_id text NOT NULL REFERENCES performances(id),
      buyer_id text NOT NULL,
      name text NOT NULL,
      email text NOT NULL,
      email_lower text NOT NULL,
      status text NOT NULL,
      face_cents integer NOT NULL,
      seat_fees_cents integer NOT NULL,
      order_fee_cents integer NOT NULL,
      total_cents integer NOT NULL,
      net_paid_cents integer NOT NULL DEFAULT 0,
      receipt text,
      exchange_count integer NOT NULL DEFAULT 0,
      killbill_account_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      cancelled_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS orders_buyer_idx ON orders (buyer_id, created_at);
    CREATE TABLE IF NOT EXISTS tickets (
      id text PRIMARY KEY,
      order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      performance_id text NOT NULL,
      seat_id text NOT NULL,
      tier_id text,
      tier_name text NOT NULL,
      face_cents integer NOT NULL,
      seat_fee_cents integer NOT NULL,
      status text NOT NULL CHECK (status IN ('payment_pending','issued','exchange_pending','refund_pending','refunded')),
      offered_seat_id text
    );
    CREATE INDEX IF NOT EXISTS tickets_order_idx ON tickets (order_id);
    CREATE INDEX IF NOT EXISTS tickets_buyer_idx ON tickets (order_id, status);
    CREATE TABLE IF NOT EXISTS waitlist_entries (
      id text PRIMARY KEY,
      performance_id text NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
      tier_id text NOT NULL,
      buyer_id text NOT NULL,
      name text NOT NULL,
      email text NOT NULL,
      email_lower text NOT NULL,
      status text NOT NULL CHECK (status IN ('waiting','offered','accepted','declined','expired')),
      joined_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS waitlist_tier_idx ON waitlist_entries (performance_id, tier_id, status);
    CREATE TABLE IF NOT EXISTS waitlist_positions (
      performance_id text NOT NULL,
      tier_id text NOT NULL,
      next_seq bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (performance_id, tier_id)
    );
    CREATE TABLE IF NOT EXISTS offers (
      token text PRIMARY KEY,
      performance_id text NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
      tier_id text NOT NULL,
      entry_id text NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
      seat_id text NOT NULL,
      status text NOT NULL CHECK (status IN ('open','accepted','declined','expired')),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS offers_entry_idx ON offers (entry_id, created_at);
    CREATE TABLE IF NOT EXISTS idempotency_records (
      buyer_id text NOT NULL,
      key text NOT NULL,
      method text NOT NULL,
      path text NOT NULL,
      body_sha256 text NOT NULL,
      status integer NOT NULL,
      response_body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (buyer_id, key)
    );
    CREATE TABLE IF NOT EXISTS idempotency_running (
      key text PRIMARY KEY,
      buyer_id text NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id bigserial PRIMARY KEY,
      to_address text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('receipt','offer','exchange','refund')),
      subject text NOT NULL,
      body text NOT NULL,
      status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent')),
      attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz,
      last_attempt_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox (status, id);
    CREATE TABLE IF NOT EXISTS streams (
      channel text PRIMARY KEY,
      version bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS seats_geo (
      seat_id text PRIMARY KEY,
      off_centre_deg integer NOT NULL,
      stage_distance_m numeric(4,1) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS killbill_payment_records (
      id bigserial PRIMARY KEY,
      order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      payment_id text NOT NULL,
      payment_external_key text NOT NULL,
      direction text NOT NULL CHECK (direction IN ('purchase','refund')),
      amount_cents integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS killbill_records_order_idx ON killbill_payment_records (order_id, created_at);
    CREATE TABLE IF NOT EXISTS owner_settings (
      passcode_hash text NOT NULL,
      salt text NOT NULL
    );
  `);
}

export async function seedData(db: Db): Promise<void> {
  await db.query('BEGIN');
  try {
    await db.query(`
      INSERT INTO owner_settings (passcode_hash, salt)
      SELECT encode(sha256(('brass-rail-1897:' || 'seatwise-salt'::text)::bytea), 'hex'), 'seatwise-salt'
      WHERE NOT EXISTS (SELECT 1 FROM owner_settings)
    `);

    const geoCount = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM seats_geo');
    if (geoCount.rows[0].count === 0) {
      const ids = allSeatIds();
      const values: unknown[] = [];
      const chunks: string[] = [];
      ids.forEach((id, index) => {
        const facts = seatFacts(id);
        chunks.push(`($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`);
        values.push(id, facts.offCentreDeg, facts.stageDistanceM);
      });
      await db.query(
        `INSERT INTO seats_geo (seat_id, off_centre_deg, stage_distance_m) VALUES ${chunks.join(', ')}`,
        values,
      );
    }

    const seedPerformances = [
      {
        id: 'lantern-and-tide',
        title: 'Lantern & Tide',
        startsAt: '2027-02-13T02:00:00Z',
        tiers: [
          { id: 'a-reserve', name: 'A Reserve', faceCents: 6800, rows: ['ST-A', 'ST-B', 'ST-C', 'ST-D', 'ST-E', 'ST-F', 'ST-G', 'ST-H'] },
          { id: 'b-reserve', name: 'B Reserve', faceCents: 4500, rows: ['ST-I', 'ST-J', 'ST-K', 'ST-L', 'ST-M', 'ST-N', 'ST-O', 'ST-P', 'CI-A', 'CI-B', 'CI-C', 'CI-D'] },
          { id: 'c-reserve', name: 'C Reserve', faceCents: 2900, rows: ['CI-E', 'CI-F', 'CI-G', 'CI-H', 'BA-A', 'BA-B', 'BA-C', 'BA-D', 'BA-E', 'BA-F'] },
        ],
      },
      {
        id: 'ostrava-strings',
        title: 'Ostrava Strings',
        startsAt: '2027-03-15T00:30:00Z',
        tiers: [
          { id: 'a-reserve', name: 'A Reserve', faceCents: 6800, rows: ['ST-A', 'ST-B', 'ST-C', 'ST-D', 'ST-E', 'ST-F', 'ST-G', 'ST-H'] },
          { id: 'b-reserve', name: 'B Reserve', faceCents: 4500, rows: ['ST-I', 'ST-J', 'ST-K', 'ST-L', 'ST-M', 'ST-N', 'ST-O', 'ST-P', 'CI-A', 'CI-B', 'CI-C', 'CI-D'] },
          { id: 'c-reserve', name: 'C Reserve', faceCents: 2900, rows: ['CI-E', 'CI-F', 'CI-G', 'CI-H', 'BA-A', 'BA-B', 'BA-C', 'BA-D', 'BA-E', 'BA-F'] },
        ],
      },
      {
        id: 'fen-and-lark',
        title: 'Fen & Lark',
        startsAt: '2027-05-22T02:00:00Z',
        tiers: [
          { id: 'front-pair', name: 'Front Pair', faceCents: 9500, seats: ['ST-A-15', 'ST-A-16'] },
          { id: 'stalls', name: 'Stalls', faceCents: 4500, rows: ['ST-B', 'ST-C', 'ST-D', 'ST-E', 'ST-F', 'ST-G', 'ST-H', 'ST-I', 'ST-J', 'ST-K', 'ST-L', 'ST-M', 'ST-N', 'ST-O', 'ST-P'] },
        ],
      },
      {
        id: 'marrow-quartet-late-set',
        title: 'Marrow Quartet: The Late Set',
        startsAt: '2027-11-07T06:30:00Z',
        tiers: [
          { id: 'a-reserve', name: 'A Reserve', faceCents: 6800, rows: ['ST-A', 'ST-B', 'ST-C', 'ST-D', 'ST-E', 'ST-F', 'ST-G', 'ST-H'] },
          { id: 'b-reserve', name: 'B Reserve', faceCents: 4500, rows: ['ST-I', 'ST-J', 'ST-K', 'ST-L', 'ST-M', 'ST-N', 'ST-O', 'ST-P', 'CI-A', 'CI-B', 'CI-C', 'CI-D'] },
          { id: 'c-reserve', name: 'C Reserve', faceCents: 2900, rows: ['CI-E', 'CI-F', 'CI-G', 'CI-H', 'BA-A', 'BA-B', 'BA-C', 'BA-D', 'BA-E', 'BA-F'] },
        ],
      },
    ];

    for (const performance of seedPerformances) {
      const existing = await db.query('SELECT id FROM performances WHERE id = $1', [performance.id]);
      if ((existing.rowCount ?? 0) > 0) continue;
      await db.query('INSERT INTO performances (id, title, starts_at) VALUES ($1, $2, $3)', [
        performance.id,
        performance.title,
        performance.startsAt,
      ]);
      const covered = new Set<string>();
      for (const tier of performance.tiers) {
        await db.query('INSERT INTO tiers (performance_id, id, name, face_cents) VALUES ($1, $2, $3, $4)', [
          performance.id,
          tier.id,
          tier.name,
          tier.faceCents,
        ]);
        const seatIds: string[] = [];
        if ('rows' in tier && tier.rows) {
          for (const rowId of tier.rows) {
            for (let number = 1; number <= 30; number += 1) {
              seatIds.push(`${rowId}-${number}`);
            }
          }
        } else if ('seats' in tier && tier.seats) {
          seatIds.push(...tier.seats);
        }
        for (const seatId of seatIds) {
          covered.add(seatId);
          await db.query(
            'INSERT INTO seats (performance_id, seat_id, tier_id, state) VALUES ($1, $2, $3, $4)',
            [performance.id, seatId, tier.id, 'on_sale'],
          );
        }
      }
      for (const seatId of allSeatIds()) {
        if (covered.has(seatId)) continue;
        await db.query(
          'INSERT INTO seats (performance_id, seat_id, tier_id, state) VALUES ($1, $2, NULL, $3)',
          [performance.id, seatId, 'not_on_sale'],
        );
      }
    }

    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
