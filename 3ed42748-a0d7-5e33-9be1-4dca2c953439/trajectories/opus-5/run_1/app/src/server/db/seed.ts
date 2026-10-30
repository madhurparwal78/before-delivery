import { withTransaction, type Transaction } from './pool.js';
import { newCourierId, newModerationRef, newMovementId } from './ids.js';

export const BRAMBLE_RADIUS_M = 60;
export const DEPOT = { lat: 0, lon: 0 };
export const STARTING_SATCHEL_ID = 'canvas';

interface SeedResident {
  resident_id: string;
  name: string;
  home: string;
  door: { lat: number; lon: number };
}

export const RESIDENTS: SeedResident[] = [
  { resident_id: 'ottoline', name: 'Ottoline Fennick', home: 'Lantern Mill', door: { lat: 30, lon: 45 } },
  { resident_id: 'barnaby', name: 'Barnaby Sorrel', home: 'Gourd House', door: { lat: -20, lon: 110 } },
  { resident_id: 'pim', name: 'Pim Halloway', home: 'Tide Observatory', door: { lat: 60, lon: -80 } },
  { resident_id: 'juniper', name: 'Juniper Okafor', home: 'Mossy Arch', door: { lat: -45, lon: -150 } },
];

const SATCHELS = [
  { satchel_id: 'canvas', name: 'Canvas Satchel', price: 0 },
  { satchel_id: 'riso-pink', name: 'Riso Pink Satchel', price: 12 },
  { satchel_id: 'sunpatch', name: 'Sunpatch Satchel', price: 20 },
  { satchel_id: 'night-ink', name: 'Night Ink Satchel', price: 35 },
  { satchel_id: 'tidewater', name: 'Tidewater Satchel', price: 50 },
];

interface SeedMission {
  mission_id: string;
  title: string;
  resident_id: string;
  reward_stamps: number;
  kind: 'standard' | 'rush';
  rush_slots: number | null;
  status: 'draft' | 'live';
  offer: string[];
  thanks: string[];
}

const MISSIONS: SeedMission[] = [
  {
    mission_id: 'lantern-oil',
    title: 'Lantern oil for the mill',
    resident_id: 'ottoline',
    reward_stamps: 5,
    kind: 'standard',
    rush_slots: null,
    status: 'live',
    offer: [
      'The mill lamps are sputtering again.',
      'Bring me a tin of lantern oil from the depot, would you?',
    ],
    thanks: ['Bright as noon. Here, take these stamps.'],
  },
  {
    mission_id: 'seed-packets',
    title: 'Seed packets for the gourds',
    resident_id: 'barnaby',
    reward_stamps: 4,
    kind: 'standard',
    rush_slots: null,
    status: 'live',
    offer: ['My gourds want company.', 'Fetch the seed packets with the blue string.'],
    thanks: ["They'll be climbing the fence by spring."],
  },
  {
    mission_id: 'star-chart',
    title: 'A rolled star chart',
    resident_id: 'pim',
    reward_stamps: 8,
    kind: 'standard',
    rush_slots: null,
    status: 'live',
    offer: [
      'The tide charts are fine, but the star charts are late.',
      "Mind the tube — it's older than the observatory.",
    ],
    thanks: ['Perfect. Tonight we count comets.'],
  },
  {
    mission_id: 'moonmelon-express',
    title: 'Moonmelon Express',
    resident_id: 'juniper',
    reward_stamps: 15,
    kind: 'rush',
    rush_slots: 1,
    status: 'live',
    offer: ['A moonmelon is only sweet for an hour.', 'Run it to Mossy Arch before it sulks!'],
    thanks: ["Still cold! You're the fastest on Bramble."],
  },
  {
    mission_id: 'kite-string',
    title: 'Kite string for the mill',
    resident_id: 'ottoline',
    reward_stamps: 6,
    kind: 'standard',
    rush_slots: null,
    status: 'draft',
    offer: ['The wind finally turned.', 'I need the long spool of kite string.'],
    thanks: ['Up she goes. Thank you, courier.'],
  },
];

interface SeedCourier {
  email: string;
  display_name: string;
  role: 'founder' | 'helper' | 'courier';
  deliveries: Array<{ mission_id: string; reward: number; offsetSeconds: number }>;
}

const COURIERS: SeedCourier[] = [
  { email: 'wren@kitefold.example', display_name: 'Wren', role: 'founder', deliveries: [] },
  { email: 'odile@kitefold.example', display_name: 'Odile', role: 'helper', deliveries: [] },
  {
    email: 'tamsin@example.com',
    display_name: 'Tamsin',
    role: 'courier',
    deliveries: [
      { mission_id: 'star-chart', reward: 8, offsetSeconds: 0 },
      { mission_id: 'moonmelon-express', reward: 15, offsetSeconds: 1 },
    ],
  },
  { email: 'ravi@example.com', display_name: 'Ravi', role: 'courier', deliveries: [] },
];

export const DEFAULT_STUDIO_TIME_ZONE = 'America/Vancouver';

async function seedCourier(tx: Transaction, person: SeedCourier, base: Date): Promise<void> {
  const courierId = newCourierId();
  await tx.query(
    `insert into couriers (courier_id, email, display_name, role, worn_satchel_id, moderation_ref)
     values ($1, $2, $3, $4, $5, $6)`,
    [courierId, person.email, person.display_name, person.role, STARTING_SATCHEL_ID, newModerationRef()],
  );
  await tx.query('insert into satchels_owned (courier_id, satchel_id) values ($1, $2)', [
    courierId,
    STARTING_SATCHEL_ID,
  ]);
  for (const delivery of person.deliveries) {
    const movementId = newMovementId();
    const at = new Date(base.getTime() + delivery.offsetSeconds * 1000);
    await tx.query(
      `insert into movements (movement_id, courier_id, kind, ref, created_at)
       values ($1, $2, 'delivery', $3, $4)`,
      [movementId, courierId, delivery.mission_id, at],
    );
    await tx.query(
      `insert into ledger_entries (movement_id, account, amount, ref, ordinal)
       values ($1, 'courier', $2, $3, 0), ($1, 'mint', $4, $3, 1)`,
      [movementId, delivery.reward, delivery.mission_id, -delivery.reward],
    );
  }
}

/** Applied once, against an empty database; it never overwrites later changes. */
export async function applySeed(): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.lock('seed');
    const already = await tx.one<{ exists: boolean }>(
      'select exists (select 1 from couriers) as exists',
    );
    if (already?.exists) return;

    for (const [ordinal, resident] of RESIDENTS.entries()) {
      await tx.query(
        `insert into residents (resident_id, name, home, door_lat, door_lon, ordinal)
         values ($1, $2, $3, $4, $5, $6)`,
        [resident.resident_id, resident.name, resident.home, resident.door.lat, resident.door.lon, ordinal],
      );
    }
    for (const [ordinal, satchel] of SATCHELS.entries()) {
      await tx.query(
        `insert into satchels (satchel_id, name, price, colour, ordinal)
         values ($1, $2, $3, $1, $4)`,
        [satchel.satchel_id, satchel.name, satchel.price, ordinal],
      );
    }
    for (const mission of MISSIONS) {
      await tx.query(
        `insert into missions (mission_id, kind, status, version, revision, rush_slots, live_at)
         values ($1, $2, $3, 1, 1, $4, $5)`,
        [
          mission.mission_id,
          mission.kind,
          mission.status,
          mission.rush_slots,
          mission.status === 'live' ? new Date() : null,
        ],
      );
      await tx.query(
        `insert into mission_versions
           (mission_id, version, title, resident_id, reward_stamps, rush_slots, dialogue)
         values ($1, 1, $2, $3, $4, $5, $6)`,
        [
          mission.mission_id,
          mission.title,
          mission.resident_id,
          mission.reward_stamps,
          mission.rush_slots,
          JSON.stringify({ offer: mission.offer, thanks: mission.thanks }),
        ],
      );
    }
    const base = new Date(Date.now() - 3600_000);
    for (const person of COURIERS) {
      await seedCourier(tx, person, base);
    }
    await tx.query('insert into studio (only_row, time_zone) values (1, $1)', [
      DEFAULT_STUDIO_TIME_ZONE,
    ]);
  });
}
