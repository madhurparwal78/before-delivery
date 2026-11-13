import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { serialiseStrokeFile } from '../shared/strokes.js';
import type { ObjectKind, Optics, SkyPoint, StrokeFile } from '../shared/types.js';
import { hashPassword } from './password.js';

const CATALOGUE: ReadonlyArray<[string, string, string, ObjectKind]> = [
  ['m2', 'M2', 'Globular cluster in Aquarius', 'globular'],
  ['m3', 'M3', 'Globular cluster in Canes Venatici', 'globular'],
  ['m5', 'M5', 'Globular cluster in Serpens', 'globular'],
  ['m8', 'M8', 'Lagoon Nebula', 'nebula'],
  ['m11', 'M11', 'Wild Duck Cluster', 'open_cluster'],
  ['m13', 'M13', 'Great Globular Cluster in Hercules', 'globular'],
  ['m15', 'M15', 'Globular cluster in Pegasus', 'globular'],
  ['m27', 'M27', 'Dumbbell Nebula', 'planetary_nebula'],
  ['m31', 'M31', 'Andromeda Galaxy', 'galaxy'],
  ['m42', 'M42', 'Orion Nebula', 'nebula'],
  ['m45', 'M45', 'Pleiades', 'open_cluster'],
  ['m51', 'M51', 'Whirlpool Galaxy', 'galaxy'],
  ['m57', 'M57', 'Ring Nebula', 'planetary_nebula'],
  ['m81', 'M81', "Bode's Galaxy", 'galaxy'],
  ['m82', 'M82', 'Cigar Galaxy', 'galaxy'],
  ['m92', 'M92', 'Globular cluster in Hercules', 'globular'],
  ['albireo', 'Albireo', 'Beta Cygni', 'double_star'],
];

interface SeedProgram {
  id: string;
  name: string;
  required_count: number;
  coordinator_name: string;
  coordinator_email: string;
  objects: string[];
  editions: ReadonlyArray<{
    edition: number;
    effective_from: string;
    min_description: number;
    sketch_required: boolean;
    concentration_required: boolean;
    pair_required: boolean;
  }>;
}

const PROGRAMS: readonly SeedProgram[] = [
  {
    id: 'globulars-by-hand',
    name: 'Globular Clusters by Hand',
    required_count: 5,
    coordinator_name: 'Odile Marsh',
    coordinator_email: 'globulars@coordinators.lowlamp.test',
    objects: ['m13', 'm92', 'm3', 'm5', 'm15', 'm2'],
    editions: [
      {
        edition: 1,
        effective_from: '2000-01-01',
        min_description: 60,
        sketch_required: true,
        concentration_required: false,
        pair_required: false,
      },
      {
        edition: 2,
        effective_from: '2026-09-01',
        min_description: 80,
        sketch_required: true,
        concentration_required: true,
        pair_required: false,
      },
    ],
  },
  {
    id: 'twelve-showpieces',
    name: 'Twelve Showpieces',
    required_count: 10,
    coordinator_name: 'Bram Ellery',
    coordinator_email: 'showpieces@coordinators.lowlamp.test',
    objects: ['m13', 'albireo', 'm51', 'm57', 'm27', 'm31', 'm42', 'm45', 'm81', 'm82', 'm8', 'm11'],
    editions: [
      {
        edition: 1,
        effective_from: '2000-01-01',
        min_description: 40,
        sketch_required: false,
        concentration_required: false,
        pair_required: false,
      },
      {
        edition: 2,
        effective_from: '2026-10-01',
        min_description: 40,
        sketch_required: false,
        concentration_required: false,
        pair_required: true,
      },
    ],
  },
];

const ROWAN = '11111111-1111-4111-8111-111111111111';
const INES = '22222222-2222-4222-8222-222222222222';

const id = (prefix: string, n: number): string =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

const R_SCOPE = {
  dob10: id('a1000000', 1),
  refractor80: id('a1000000', 2),
  ep25: id('a2000000', 1),
  ep10: id('a2000000', 2),
  ep6: id('a2000000', 3),
  barlow2: id('a3000000', 1),
  hollowField: id('a4000000', 1),
  backGarden: id('a4000000', 2),
  session1: id('a5000000', 1),
  session2: id('a5000000', 2),
  session3: id('a5000000', 3),
};

const I_SCOPE = {
  dob8: id('b1000000', 1),
  ep20: id('b2000000', 1),
  ridgeLot: id('b4000000', 1),
  session: id('b5000000', 1),
  observation: id('b6000000', 1),
  packet: id('b7000000', 1),
};

function optics(telescope: string, eyepiece: string): Optics {
  return { telescope_id: telescope, eyepiece_id: eyepiece, barlow_id: null, train: 'straight' };
}

/** A deterministic seeded sketch: one stroke and at least three stars. */
function sketch(stars: ReadonlyArray<[SkyPoint, 1 | 2 | 3 | 4 | 5]>, radius: number): StrokeFile {
  const points: SkyPoint[] = [];
  for (let step = 0; step <= 8; step += 1) {
    const angle = (step / 8) * Math.PI * 1.5;
    points.push([
      Math.round(Math.cos(angle) * radius * 0.4 * 100) / 100,
      Math.round(Math.sin(angle) * radius * 0.4 * 100) / 100,
    ]);
  }
  return {
    format: 'lowlamp-strokes/1',
    strokes: [{ width: 'medium', points }],
    stars: stars.map(([at, brightness]) => ({ at, brightness })),
  };
}

interface SeedObservation {
  id: string;
  session_id: string;
  object_id: string;
  observed_at: string;
  seeing: number | null;
  transparency_nelm: number | null;
  concentration_class: string | null;
  description: string;
  optics: Optics | null;
  sketch: StrokeFile | null;
}

const M13_2026_SKETCH: StrokeFile = sketch(
  [
    [[0, 10], 5],
    [[-6, -4], 3],
    [[7, 2], 2],
    [[-2, -11], 4],
  ],
  17,
);

const ROWAN_OBSERVATIONS: readonly SeedObservation[] = [
  {
    id: id('a6000000', 1),
    session_id: R_SCOPE.session1,
    object_id: 'm13',
    observed_at: '2025-06-22T04:10:00Z',
    seeing: 6,
    transparency_nelm: 6.2,
    concentration_class: null,
    description:
      'Bright, large and grainy; resolved to the core with averted vision, three dark lanes forming the propeller.',
    optics: null,
    sketch: sketch(
      [
        [[3, 6], 4],
        [[-8, 1], 3],
        [[1, -7], 2],
      ],
      17,
    ),
  },
  {
    id: id('a6000000', 2),
    session_id: R_SCOPE.session1,
    object_id: 'm92',
    observed_at: '2025-06-22T04:45:00Z',
    seeing: 6,
    transparency_nelm: 6.2,
    concentration_class: null,
    description:
      'Smaller and more concentrated than M13; outer stars resolved, core a tight bright knot at 120x.',
    optics: null,
    sketch: sketch(
      [
        [[-4, 9], 3],
        [[5, -2], 4],
        [[-1, -6], 2],
      ],
      17,
    ),
  },
  {
    id: id('a6000000', 3),
    session_id: R_SCOPE.session2,
    object_id: 'm13',
    observed_at: '2026-07-18T03:20:00Z',
    seeing: 8,
    transparency_nelm: 6.5,
    concentration_class: null,
    description:
      'Steadier night than last year. Core fully resolved at 120x with chains of stars spilling to the northwest.',
    optics: null,
    sketch: M13_2026_SKETCH,
  },
  {
    id: id('a6000000', 4),
    session_id: R_SCOPE.session2,
    object_id: 'm3',
    observed_at: '2026-07-18T03:55:00Z',
    seeing: 7,
    transparency_nelm: 6.5,
    concentration_class: null,
    description: 'Round glow with a bright broad centre; edges resolved under averted vision.',
    optics: null,
    sketch: sketch(
      [
        [[2, 8], 3],
        [[-7, -3], 4],
        [[6, -5], 2],
      ],
      17,
    ),
  },
  {
    id: id('a6000000', 5),
    session_id: R_SCOPE.session2,
    object_id: 'm5',
    observed_at: '2026-07-18T04:30:00Z',
    seeing: 7,
    transparency_nelm: 6.5,
    concentration_class: null,
    description:
      'Slightly oval with a very bright core; outer halo well resolved and a noticeable double star nearby.',
    optics: optics(R_SCOPE.dob10, R_SCOPE.ep25),
    sketch: sketch(
      [
        [[12, 20], 4],
        [[-18, -9], 3],
        [[5, -24], 2],
      ],
      42,
    ),
  },
  {
    id: id('a6000000', 6),
    session_id: R_SCOPE.session2,
    object_id: 'm15',
    observed_at: '2026-07-18T08:05:00Z',
    seeing: 7,
    transparency_nelm: 6.5,
    concentration_class: null,
    description:
      'Small, intensely bright core like a star; halo partly resolved, low in the east after midnight.',
    optics: null,
    sketch: sketch(
      [
        [[-3, 7], 2],
        [[8, 4], 3],
        [[0, -9], 4],
      ],
      17,
    ),
  },
  {
    id: id('a6000000', 7),
    session_id: R_SCOPE.session2,
    object_id: 'm2',
    observed_at: '2026-07-18T08:40:00Z',
    seeing: null,
    transparency_nelm: 6.5,
    concentration_class: null,
    description: 'Faint, round, grainy.',
    optics: null,
    sketch: null,
  },
  {
    id: id('a6000000', 8),
    session_id: R_SCOPE.session3,
    object_id: 'm15',
    observed_at: '2026-11-01T07:20:00Z',
    seeing: 7,
    transparency_nelm: 6.3,
    concentration_class: 'IV',
    description:
      'Tiny blazing core like a bright star; halo resolved into many faint stars at 200x, very steady.',
    optics: null,
    sketch: sketch(
      [
        [[-2, 5], 3],
        [[4, 1], 4],
        [[0, -4], 2],
      ],
      9,
    ),
  },
  {
    id: id('a6000000', 9),
    session_id: R_SCOPE.session3,
    object_id: 'm27',
    observed_at: '2026-11-01T07:25:00Z',
    seeing: 7,
    transparency_nelm: 6.3,
    concentration_class: null,
    description: 'Dumbbell shape, bright.',
    optics: null,
    sketch: sketch(
      [
        [[1, 4], 2],
        [[-3, -2], 3],
        [[5, -1], 4],
      ],
      9,
    ),
  },
  {
    id: id('a6000000', 10),
    session_id: R_SCOPE.session3,
    object_id: 'm2',
    observed_at: '2026-11-01T08:20:00Z',
    seeing: 7,
    transparency_nelm: 6.3,
    concentration_class: null,
    description: 'Bright round glow with a grainy halo; core unresolved at 200x tonight.',
    optics: null,
    sketch: sketch(
      [
        [[2, 6], 4],
        [[-5, 0], 2],
        [[1, -5], 3],
      ],
      9,
    ),
  },
  {
    id: id('a6000000', 11),
    session_id: R_SCOPE.session3,
    object_id: 'm27',
    observed_at: '2026-11-01T08:25:00Z',
    seeing: 7,
    transparency_nelm: 6.3,
    concentration_class: null,
    description: 'Dumbbell shape, bright.',
    optics: null,
    sketch: sketch(
      [
        [[-1, 3], 3],
        [[4, -3], 2],
        [[-4, -5], 4],
      ],
      9,
    ),
  },
];

const INES_OBSERVATION: SeedObservation = {
  id: I_SCOPE.observation,
  session_id: I_SCOPE.session,
  object_id: 'm13',
  observed_at: '2026-08-09T20:05:00Z',
  seeing: 6,
  transparency_nelm: 5.9,
  concentration_class: null,
  description:
    'Large bright ball, resolved at the edges, core grainy with averted vision.',
  optics: null,
  sketch: sketch(
    [
      [[6, 14], 3],
      [[-11, -5], 4],
      [[2, -16], 2],
    ],
    34,
  ),
};

async function seedCatalogue(client: PoolClient): Promise<void> {
  for (const [objectId, designation, name, kind] of CATALOGUE) {
    const position = CATALOGUE.findIndex((entry) => entry[0] === objectId);
    await client.query(
      `INSERT INTO catalogue_objects (id, designation, name, kind, position)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET designation=$2, name=$3, kind=$4, position=$5`,
      [objectId, designation, name, kind, position],
    );
  }
}

async function seedPrograms(client: PoolClient): Promise<void> {
  for (const [position, program] of PROGRAMS.entries()) {
    await client.query(
      `INSERT INTO programs (id, name, required_count, coordinator_name, coordinator_email, position)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET name=$2, required_count=$3, coordinator_name=$4,
         coordinator_email=$5, position=$6`,
      [
        program.id,
        program.name,
        program.required_count,
        program.coordinator_name,
        program.coordinator_email,
        position,
      ],
    );
    for (const edition of program.editions) {
      await client.query(
        `INSERT INTO program_editions (program_id, edition, effective_from, min_description,
           sketch_required, concentration_required, pair_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (program_id, edition) DO UPDATE SET effective_from=$3, min_description=$4,
           sketch_required=$5, concentration_required=$6, pair_required=$7`,
        [
          program.id,
          edition.edition,
          edition.effective_from,
          edition.min_description,
          edition.sketch_required,
          edition.concentration_required,
          edition.pair_required,
        ],
      );
    }
    for (const [objectPosition, objectId] of program.objects.entries()) {
      await client.query(
        `INSERT INTO program_objects (program_id, object_id, position)
         VALUES ($1,$2,$3)
         ON CONFLICT (program_id, object_id) DO UPDATE SET position=$3`,
        [program.id, objectId, objectPosition],
      );
    }
  }
}

async function seedObservation(
  client: PoolClient,
  accountId: string,
  observation: SeedObservation,
  sessionOptics: Optics,
): Promise<void> {
  const own = observation.optics ?? sessionOptics;
  let strokesSha: string | null = null;
  let strokesSize: number | null = null;
  let body: string | null = null;
  if (observation.sketch) {
    body = serialiseStrokeFile(observation.sketch);
    strokesSha = createHash('sha256').update(body).digest('hex');
    strokesSize = Buffer.byteLength(body);
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO observations (id, account_id, session_id, object_id, observed_at, seeing,
        transparency_nelm, concentration_class, pair, description, optics, strokes_sha256,
        strokes_size, strokes_has_marks, raster_sha256, version, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,$11,$12,$13,NULL,1,$5)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      observation.id,
      accountId,
      observation.session_id,
      observation.object_id,
      observation.observed_at,
      observation.seeing,
      observation.transparency_nelm,
      observation.concentration_class,
      observation.description,
      JSON.stringify(own),
      strokesSha,
      strokesSize,
      observation.sketch !== null,
    ],
  );
  if (inserted.rowCount === 0) return;
  const fields = [
    'observed_at',
    'seeing',
    'transparency_nelm',
    'concentration_class',
    'description',
    'optics',
    'sketch',
  ];
  for (const field of fields) {
    await client.query(
      `INSERT INTO observation_field_edits (observation_id, field, edited_at, device, set_at_version)
       VALUES ($1,$2,$3,'seed',1) ON CONFLICT DO NOTHING`,
      [observation.id, field, observation.observed_at],
    );
  }
  if (body && strokesSha) {
    await client.query(
      `INSERT INTO seeded_strokes (observation_id, account_id, sha256, body)
       VALUES ($1,$2,$3,$4) ON CONFLICT (observation_id) DO NOTHING`,
      [observation.id, accountId, strokesSha, body],
    );
  }
}

async function accountExists(client: PoolClient, accountId: string): Promise<boolean> {
  const found = await client.query('SELECT 1 FROM accounts WHERE id = $1', [accountId]);
  return found.rowCount === 1;
}

async function seedRowan(client: PoolClient): Promise<void> {
  if (await accountExists(client, ROWAN)) return;
  await client.query(
    `INSERT INTO accounts (id, email, password_hash, display_name)
     VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING`,
    [ROWAN, 'rowan@lowlamp.test', await hashPassword('dark-adapted-01'), 'Rowan Pell'],
  );
  if (!(await accountExists(client, ROWAN))) return;

  for (const [itemId, name, aperture, focal] of [
    [R_SCOPE.dob10, '10-inch Dobsonian', 254, 1200],
    [R_SCOPE.refractor80, '80 mm refractor', 80, 480],
  ] as const) {
    await client.query(
      `INSERT INTO telescopes (id, account_id, name, aperture_mm, focal_length_mm)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [itemId, ROWAN, name, aperture, focal],
    );
  }
  for (const [itemId, name, focal, field] of [
    [R_SCOPE.ep25, '25 mm wide', 25, 67],
    [R_SCOPE.ep10, '10 mm wide', 10, 67],
    [R_SCOPE.ep6, '6 mm', 6, 60],
  ] as const) {
    await client.query(
      `INSERT INTO eyepieces (id, account_id, name, focal_length_mm, apparent_field_deg)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [itemId, ROWAN, name, focal, field],
    );
  }
  await client.query(
    `INSERT INTO barlows (id, account_id, name, factor) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO NOTHING`,
    [R_SCOPE.barlow2, ROWAN, '2× Barlow', 2.0],
  );
  for (const [siteId, name, latitude, longitude] of [
    [R_SCOPE.hollowField, 'Hollow Field', 38.95, -105.4],
    [R_SCOPE.backGarden, 'Back garden', 39.74, -104.99],
  ] as const) {
    await client.query(
      `INSERT INTO sites (id, account_id, name, latitude, longitude, time_zone)
       VALUES ($1,$2,$3,$4,$5,'America/Denver') ON CONFLICT (id) DO NOTHING`,
      [siteId, ROWAN, name, latitude, longitude],
    );
  }

  const sessions: ReadonlyArray<[string, string, string, Optics]> = [
    [R_SCOPE.session1, R_SCOPE.hollowField, '2025-06-22T03:30:00Z', optics(R_SCOPE.dob10, R_SCOPE.ep10)],
    [R_SCOPE.session2, R_SCOPE.hollowField, '2026-07-18T02:45:00Z', optics(R_SCOPE.dob10, R_SCOPE.ep10)],
    [R_SCOPE.session3, R_SCOPE.backGarden, '2026-11-01T01:30:00Z', optics(R_SCOPE.dob10, R_SCOPE.ep6)],
  ];
  for (const [sessionId, siteId, startedAt, sessionOptics] of sessions) {
    await client.query(
      `INSERT INTO observing_sessions (id, account_id, site_id, started_at, optics)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [sessionId, ROWAN, siteId, startedAt, JSON.stringify(sessionOptics)],
    );
  }
  const sessionOpticsById = new Map(sessions.map(([sessionId, , , o]) => [sessionId, o]));
  for (const observation of ROWAN_OBSERVATIONS) {
    const sessionOptics = sessionOpticsById.get(observation.session_id);
    if (!sessionOptics) throw new Error('seeded observation without its session');
    await seedObservation(client, ROWAN, observation, sessionOptics);
  }
  await client.query(
    `INSERT INTO program_follows (account_id, program_id) VALUES ($1,'globulars-by-hand')
     ON CONFLICT DO NOTHING`,
    [ROWAN],
  );
  await client.query(
    `INSERT INTO packet_counters (account_id, next_number) VALUES ($1,1)
     ON CONFLICT (account_id) DO NOTHING`,
    [ROWAN],
  );
}

async function seedInes(client: PoolClient): Promise<void> {
  if (await accountExists(client, INES)) return;
  await client.query(
    `INSERT INTO accounts (id, email, password_hash, display_name)
     VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING`,
    [INES, 'ines@lowlamp.test', await hashPassword('dark-adapted-02'), 'Ines Varga'],
  );
  if (!(await accountExists(client, INES))) return;
  await client.query(
    `INSERT INTO telescopes (id, account_id, name, aperture_mm, focal_length_mm)
     VALUES ($1,$2,'8-inch Dobsonian',203.2,1200) ON CONFLICT (id) DO NOTHING`,
    [I_SCOPE.dob8, INES],
  );
  await client.query(
    `INSERT INTO eyepieces (id, account_id, name, focal_length_mm, apparent_field_deg)
     VALUES ($1,$2,'20 mm',20,68) ON CONFLICT (id) DO NOTHING`,
    [I_SCOPE.ep20, INES],
  );
  await client.query(
    `INSERT INTO sites (id, account_id, name, latitude, longitude, time_zone)
     VALUES ($1,$2,'Ridge Lot',47.50,19.04,'Europe/Budapest') ON CONFLICT (id) DO NOTHING`,
    [I_SCOPE.ridgeLot, INES],
  );
  const inesOptics = optics(I_SCOPE.dob8, I_SCOPE.ep20);
  await client.query(
    `INSERT INTO observing_sessions (id, account_id, site_id, started_at, optics)
     VALUES ($1,$2,$3,'2026-08-09T19:30:00Z',$4) ON CONFLICT (id) DO NOTHING`,
    [I_SCOPE.session, INES, I_SCOPE.ridgeLot, JSON.stringify(inesOptics)],
  );
  await seedObservation(client, INES, INES_OBSERVATION, inesOptics);
  await client.query(
    `INSERT INTO packet_counters (account_id, next_number) VALUES ($1,2)
     ON CONFLICT (account_id) DO NOTHING`,
    [INES],
  );
  await client.query(
    `INSERT INTO packets (id, account_id, number, program_id, state, revision, returned_to_draft,
        created_at)
     VALUES ($1,$2,1,'twelve-showpieces','draft',1,false,'2026-08-10T08:00:00Z')
     ON CONFLICT (id) DO NOTHING`,
    [I_SCOPE.packet, INES],
  );
  await client.query(
    `INSERT INTO packet_order (packet_id, position, observation_id) VALUES ($1,0,$2)
     ON CONFLICT DO NOTHING`,
    [I_SCOPE.packet, I_SCOPE.observation],
  );
}

export async function seedDatabase(client: PoolClient): Promise<void> {
  await seedCatalogue(client);
  await seedPrograms(client);
  await seedRowan(client);
  await seedInes(client);
}
