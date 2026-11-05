import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Cone, ProfileSegment, Role, Stage } from '../../shared/types';
import { SCHEMA_SQL } from './schema';
import { withTransaction } from './pool';

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(digest, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

interface SeedPerson {
  name: string;
  role: Role;
  email: string;
  password: string;
  memberNumber: string | null;
}

const PEOPLE: SeedPerson[] = [
  {
    name: 'Marguerite Okafor-Lind',
    role: 'owner',
    email: 'owner@brickfieldlane.example',
    password: 'kiln-owner-2026',
    memberNumber: null,
  },
  {
    name: 'Tobias Wren',
    role: 'tech',
    email: 'tech@brickfieldlane.example',
    password: 'kiln-tech-2026',
    memberNumber: null,
  },
  {
    name: 'Priya Halvorsen',
    role: 'member',
    email: 'priya@brickfieldlane.example',
    password: 'member-priya-2026',
    memberNumber: 'M104',
  },
  {
    name: 'Dashiell Moreau',
    role: 'member',
    email: 'dash@brickfieldlane.example',
    password: 'member-dash-2026',
    memberNumber: 'M117',
  },
];

const CLAYS: { id: string; name: string; maxCone: Cone }[] = [
  { id: 'buff', name: 'Brickfield Buff Stoneware', maxCone: '10' },
  { id: 'porcelain', name: 'Lane Porcelain', maxCone: '6' },
  { id: 'red', name: 'Clayhouse Red Earthenware', maxCone: '02' },
];

const KILNS = [
  {
    id: 'annie',
    name: 'Big Annie',
    shelfDiameterIn: '23.0',
    layers: 4,
    postHeightIn: '9.0',
    usableCubicInches: 12096,
  },
  {
    id: 'ned',
    name: 'Little Ned',
    shelfDiameterIn: '23.0',
    layers: 3,
    postHeightIn: '6.0',
    usableCubicInches: 6048,
  },
];

const BISQUE_04: ProfileSegment[] = [
  { rate_f_per_hour: 186, target_f: 1000, hold_minutes: 0 },
  { rate_f_per_hour: 315, target_f: 1945, hold_minutes: 10 },
];

const PROFILES: {
  id: string;
  kilnId: string;
  name: string;
  stage: Stage;
  cone: Cone;
  segments: ProfileSegment[];
  coolDownHours: number;
}[] = [
  {
    id: 'annie-bisque-04',
    kilnId: 'annie',
    name: 'Bisque cone 04',
    stage: 'bisque',
    cone: '04',
    segments: BISQUE_04,
    coolDownHours: 12,
  },
  {
    id: 'annie-glaze-6',
    kilnId: 'annie',
    name: 'Glaze cone 6',
    stage: 'glaze',
    cone: '6',
    segments: [
      { rate_f_per_hour: 186, target_f: 1000, hold_minutes: 0 },
      { rate_f_per_hour: 250, target_f: 2000, hold_minutes: 0 },
      { rate_f_per_hour: 116, target_f: 2232, hold_minutes: 15 },
    ],
    coolDownHours: 14,
  },
  {
    id: 'ned-bisque-04',
    kilnId: 'ned',
    name: 'Bisque cone 04',
    stage: 'bisque',
    cone: '04',
    segments: BISQUE_04,
    coolDownHours: 12,
  },
  {
    id: 'ned-glaze-06',
    kilnId: 'ned',
    name: 'Glaze cone 06',
    stage: 'glaze',
    cone: '06',
    segments: [
      { rate_f_per_hour: 186, target_f: 1000, hold_minutes: 0 },
      { rate_f_per_hour: 276, target_f: 1828, hold_minutes: 10 },
    ],
    coolDownHours: 12,
  },
];

const SEED_RATE_SET = {
  bisqueRate: '0.0300',
  glazeRate: '0.0400',
  memberDiscountPercent: 10,
  orderMinimumCents: 300,
  effectiveDate: '2026-01-01',
};

/**
 * Applies the schema and the seeded studio. Several instances may start at
 * once, so the whole run is held behind one advisory lock.
 */
export async function applySchemaAndSeed(): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['shelfmark-schema']);
    await client.query(SCHEMA_SQL);

    for (const [index, person] of PEOPLE.entries()) {
      await client.query(
        `insert into users (name, email, role, member_number, password_hash, sort)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (email) do update
           set name = excluded.name,
               role = excluded.role,
               member_number = excluded.member_number,
               sort = excluded.sort`,
        [
          person.name,
          person.email,
          person.role,
          person.memberNumber,
          hashPassword(person.password),
          index,
        ],
      );
    }

    for (const [index, clay] of CLAYS.entries()) {
      await client.query(
        `insert into clays (id, name, max_cone, sort) values ($1, $2, $3, $4)
         on conflict (id) do update set name = excluded.name, max_cone = excluded.max_cone, sort = excluded.sort`,
        [clay.id, clay.name, clay.maxCone, index],
      );
    }

    for (const [index, kiln] of KILNS.entries()) {
      await client.query(
        `insert into kilns (id, name, shelf_diameter_in, layers, post_height_in, usable_cubic_inches, sort)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update
           set name = excluded.name,
               shelf_diameter_in = excluded.shelf_diameter_in,
               layers = excluded.layers,
               post_height_in = excluded.post_height_in,
               usable_cubic_inches = excluded.usable_cubic_inches,
               sort = excluded.sort`,
        [
          kiln.id,
          kiln.name,
          kiln.shelfDiameterIn,
          kiln.layers,
          kiln.postHeightIn,
          kiln.usableCubicInches,
          index,
        ],
      );
    }

    for (const [index, profile] of PROFILES.entries()) {
      await client.query(
        `insert into kiln_profiles (id, kiln_id, name, stage, cone, segments, cool_down_hours, sort)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         on conflict (id) do nothing`,
        [
          profile.id,
          profile.kilnId,
          profile.name,
          profile.stage,
          profile.cone,
          JSON.stringify(profile.segments),
          profile.coolDownHours,
          index,
        ],
      );
    }

    await client.query(
      `insert into rate_sets
         (bisque_rate, glaze_rate, member_discount_percent, order_minimum_cents, effective_date)
       values ($1, $2, $3, $4, $5)
       on conflict (effective_date) do nothing`,
      [
        SEED_RATE_SET.bisqueRate,
        SEED_RATE_SET.glazeRate,
        SEED_RATE_SET.memberDiscountPercent,
        SEED_RATE_SET.orderMinimumCents,
        SEED_RATE_SET.effectiveDate,
      ],
    );
  });
}
