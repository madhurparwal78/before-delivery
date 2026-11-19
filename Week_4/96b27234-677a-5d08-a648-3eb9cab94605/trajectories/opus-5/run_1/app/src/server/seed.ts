import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { one, transact } from './db.js';
import { hashPassword } from './auth.js';
import { inspectGlb } from './domain/glb.js';
import { generateGlb } from './domain/glbgen.js';
import { rankOf } from './domain/ranks.js';
import type { AssetKind, Rank } from './domain/ranks.js';
import { objectKey, putObject, storageUp } from './services/storage.js';
import { valkeyUp } from './services/valkey.js';

const QUILT_LOFT = {
  width: 12,
  height: 12,
  spawn: [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 }
  ],
  walls: [
    { x: 3, y: 3 },
    { x: 8, y: 8 }
  ],
  seats: [{ id: 'seat-1', x: 5, y: 2 }],
  exits: [{ id: 'exit-1', x: 0, y: 6 }]
};

const READING_PORCH = {
  width: 8,
  height: 8,
  spawn: [{ x: 1, y: 1 }],
  walls: [{ x: 4, y: 4 }],
  seats: [{ id: 'seat-1', x: 6, y: 2 }],
  exits: [{ id: 'exit-1', x: 7, y: 6 }]
};

const PEOPLE = [
  {
    displayName: 'Wren Okafor',
    email: 'wren@hearthtile.example',
    password: 'lantern-wren-01',
    timeZone: 'America/New_York',
    siteRole: 'member',
    avatar: 'Paper Fox'
  },
  {
    displayName: 'Tomas Vale',
    email: 'tomas@hearthtile.example',
    password: 'lantern-tomas-02',
    timeZone: 'Europe/London',
    siteRole: 'member',
    avatar: 'Tin Heron'
  },
  {
    displayName: 'Imke Dorn',
    email: 'imke@hearthtile.example',
    password: 'lantern-imke-03',
    timeZone: 'Europe/Berlin',
    siteRole: 'member',
    avatar: 'Moss Walker'
  },
  {
    displayName: 'Priya Nand',
    email: 'priya@hearthtile.example',
    password: 'lantern-priya-04',
    timeZone: 'Asia/Kolkata',
    siteRole: 'moderator',
    avatar: null
  }
];

const ASSETS: Array<{ kind: AssetKind; name: string; rank: Rank; layout: unknown }> = [
  { kind: 'room', name: 'Quilt Loft', rank: 'Feather', layout: QUILT_LOFT },
  { kind: 'room', name: 'Reading Porch', rank: 'Feather', layout: READING_PORCH },
  { kind: 'avatar', name: 'Paper Fox', rank: 'Feather', layout: undefined },
  { kind: 'avatar', name: 'Tin Heron', rank: 'Linen', layout: undefined },
  { kind: 'avatar', name: 'Moss Walker', rank: 'Cedar', layout: undefined }
];

async function storeAsset(
  client: PoolClient,
  ownerId: string,
  entry: (typeof ASSETS)[number],
  now: Date
): Promise<string> {
  const assetId = randomUUID();
  const bytes = generateGlb(entry.kind, entry.rank, entry.name);
  const inspection = inspectGlb(bytes, entry.kind);
  if (!inspection.ok) throw new Error(`seed model for ${entry.name} is not valid`);
  const ranking = rankOf(entry.kind, inspection.measures);
  await putObject(objectKey(assetId, 1), bytes);
  await client.query(
    `insert into assets (id, world_id, kind, name, owner_id, last_version, created_at)
     values ($1, 'default', $2, $3, $4, 1, $5)`,
    [assetId, entry.kind, entry.name, ownerId, now]
  );
  await client.query(
    `insert into asset_versions (asset_id, version, status, rank, worst_measure, measures, layout, created_at)
     values ($1, 1, 'published', $2, $3, $4, $5, $6)`,
    [
      assetId,
      ranking.rank,
      ranking.worstMeasure,
      JSON.stringify(inspection.measures),
      entry.layout === undefined ? null : JSON.stringify(entry.layout),
      now
    ]
  );
  return assetId;
}

export async function applySeed(): Promise<boolean> {
  if (!storageUp() || !valkeyUp()) return false;
  const done = await one('select 1 from app_meta where key = $1', ['seed']);
  if (done !== null) return true;
  await transact(async (client) => {
    await client.query('select pg_advisory_xact_lock(718232)');
    const already = await client.query('select 1 from app_meta where key = $1', ['seed']);
    if (already.rowCount !== null && already.rowCount > 0) return;
    const now = new Date();
    const people = new Map<string, string>();
    for (const person of PEOPLE) {
      const id = randomUUID();
      await client.query(
        `insert into people (id, world_id, email, password_hash, display_name, time_zone, site_role, confirmed)
         values ($1, 'default', $2, $3, $4, $5, $6, true)`,
        [id, person.email, hashPassword(person.password), person.displayName, person.timeZone, person.siteRole]
      );
      people.set(person.displayName, id);
    }
    const wren = people.get('Wren Okafor') ?? '';
    const tomas = people.get('Tomas Vale') ?? '';
    const imke = people.get('Imke Dorn') ?? '';
    const assetIds = new Map<string, string>();
    for (const entry of ASSETS) assetIds.set(entry.name, await storeAsset(client, wren, entry, now));
    for (const person of PEOPLE) {
      if (person.avatar === null) continue;
      await client.query('update people set avatar_asset_id = $2 where id = $1', [
        people.get(person.displayName) ?? '',
        assetIds.get(person.avatar) ?? ''
      ]);
    }
    const [first, second] = [wren, tomas].sort();
    await client.query('insert into friendships (person_a, person_b) values ($1, $2)', [first, second]);

    const communityId = randomUUID();
    await client.query(
      `insert into communities (id, world_id, name, time_zone) values ($1, 'default', $2, $3)`,
      [communityId, 'Thursday Stitchers', 'America/New_York']
    );
    for (const [personId, role] of [
      [wren, 'owner'],
      [tomas, 'steward'],
      [imke, 'member']
    ] as Array<[string, string]>) {
      await client.query(
        'insert into community_members (community_id, person_id, role, joined_at) values ($1, $2, $3, $4)',
        [communityId, personId, role, now]
      );
    }

    const gatheringId = randomUUID();
    await client.query(
      `insert into gatherings (id, community_id, title, starts_local, duration_minutes, recurrence, attend_limit, created_at)
       values ($1, $2, 'Thursday Stitch-In', '2027-03-04T19:00', 90, 'weekly', 30, $3)`,
      [gatheringId, communityId, now]
    );
    for (const personId of [wren, imke]) {
      await client.query('insert into gathering_attendees (gathering_id, person_id) values ($1, $2)', [
        gatheringId,
        personId
      ]);
    }

    const sessionId = randomUUID();
    await client.query(
      `insert into sessions (id, world_id, room_asset_id, host_id, visibility, capacity, community_id, status, created_at)
       values ($1, 'default', $2, $3, 'public', 12, null, 'open', $4)`,
      [sessionId, assetIds.get('Quilt Loft') ?? '', wren, now]
    );
    const placements: Array<[string, number, number, string]> = [
      [wren, 2, 2, 'south'],
      [tomas, 4, 3, 'west'],
      [imke, 6, 5, 'north']
    ];
    let order = 0;
    for (const [personId, x, y, facing] of placements) {
      await client.query(
        `insert into session_members (session_id, person_id, joined_at, room_version, x, y, facing)
         values ($1, $2, $3, 1, $4, $5, $6)`,
        [sessionId, personId, new Date(now.getTime() + order), x, y, facing]
      );
      order += 1;
    }
    await client.query('insert into app_meta (key, value) values ($1, $2)', ['seed', now.toISOString()]);
  });
  return true;
}

export function startSeedAttempts(): void {
  const attempt = async (): Promise<void> => {
    try {
      if (await applySeed()) clearInterval(timer);
    } catch (error) {
      process.stderr.write(`seed failed: ${String(error)}\n`);
    }
  };
  const timer = setInterval(() => void attempt(), 2000);
  timer.unref();
  void attempt();
}
