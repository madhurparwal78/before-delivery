// Seed data: idempotent, applied on every start.

import type { Db } from './db.js';
import { one, many } from './db.js';
import { hashPassword, newId } from './passwords.js';
import { totalFramesOf, timecodeOf } from '../shared/domain.js';

export const DEMO_PASSWORD = 'rushes-demo-2026';

interface SeededWorkspace {
  slug: string;
  name: string;
  timeZone: string;
  plan: string;
  group: string;
  position: number;
}

const WORKSPACES: SeededWorkspace[] = [
  { slug: 'northvale', name: 'Northvale', timeZone: 'Europe/London', plan: 'rushes-pro-5', group: 'Halden Group', position: 1 },
  { slug: 'kesto', name: 'Kesto', timeZone: 'America/New_York', plan: 'rushes-pro-10', group: 'Halden Group', position: 2 },
  { slug: 'brisk-tonic', name: 'Brisk Tonic', timeZone: 'Australia/Sydney', plan: 'rushes-pro-5', group: 'Halden Group', position: 3 },
  { slug: 'vartan', name: 'Vartan Studio', timeZone: 'Europe/Berlin', plan: 'rushes-pro-5', group: 'Vartan Studio', position: 1 },
];

interface SeededAccount {
  email: string;
  displayName: string;
  handle: string;
  role: 'ops_lead' | 'designer' | 'follower';
  group: string | null;
  workspace: string | null;
  seat: boolean;
}

const ACCOUNTS: SeededAccount[] = [
  { email: 'mara@halden.example', displayName: 'Mara Quill', handle: 'mara', role: 'ops_lead', group: 'Halden Group', workspace: null, seat: false },
  { email: 'dev@halden.example', displayName: 'Dev Okafor', handle: 'dev', role: 'ops_lead', group: 'Halden Group', workspace: null, seat: false },
  { email: 'juno@northvale.example', displayName: 'Juno Park', handle: 'juno', role: 'designer', group: 'Halden Group', workspace: 'northvale', seat: true },
  { email: 'tomas@northvale.example', displayName: 'Tomas Reyes', handle: 'tomas', role: 'designer', group: 'Halden Group', workspace: 'northvale', seat: true },
  { email: 'ines@northvale.example', displayName: 'Ines Laurent', handle: 'ines', role: 'designer', group: 'Halden Group', workspace: 'northvale', seat: true },
  { email: 'priya@northvale.example', displayName: 'Priya Shah', handle: 'priya', role: 'designer', group: 'Halden Group', workspace: 'northvale', seat: true },
  { email: 'ola@northvale.example', displayName: 'Ola Berg', handle: 'ola', role: 'designer', group: 'Halden Group', workspace: 'northvale', seat: false },
  { email: 'kit@northvale.example', displayName: 'Kit Morrow', handle: 'kit', role: 'designer', group: 'Halden Group', workspace: 'northvale', seat: false },
  { email: 'sam@kesto.example', displayName: 'Sam Ilori', handle: 'sam', role: 'designer', group: 'Halden Group', workspace: 'kesto', seat: true },
  { email: 'remy@kesto.example', displayName: 'Remy Doucet', handle: 'remy', role: 'designer', group: 'Halden Group', workspace: 'kesto', seat: true },
  { email: 'bea@brisktonic.example', displayName: 'Bea Lund', handle: 'bea', role: 'designer', group: 'Halden Group', workspace: 'brisk-tonic', seat: true },
  { email: 'ilse@vartan.example', displayName: 'Ilse Vartan', handle: 'ilse', role: 'designer', group: 'Vartan Studio', workspace: 'vartan', seat: true },
  { email: 'lee@followers.example', displayName: 'Lee Chen', handle: 'lee', role: 'follower', group: null, workspace: null, seat: false },
  { email: 'noor@followers.example', displayName: 'Noor Haddad', handle: 'noor', role: 'follower', group: null, workspace: null, seat: false },
];

const SEED_REFERENCES: Record<string, { title: string; owner: string }[]> = {
  northvale: [
    { title: 'Salt-stained canvas', owner: 'juno' },
    { title: 'Rope coil', owner: 'juno' },
    { title: 'Harbour sodium light', owner: 'juno' },
    { title: 'Oilskin fold', owner: 'juno' },
    { title: "Net mender's hands", owner: 'juno' },
    { title: 'Tide chart', owner: 'juno' },
    { title: 'Rusted cleat', owner: 'tomas' },
    { title: 'Fog over slipway', owner: 'tomas' },
  ],
  kesto: [
    { title: 'Trail grit macro', owner: 'sam' },
    { title: 'Midsole foam cut', owner: 'sam' },
    { title: 'Ridge at dawn', owner: 'remy' },
    { title: 'SS27 lace study', owner: 'sam' },
    { title: 'Scree field', owner: 'remy' },
  ],
  'brisk-tonic': [{ title: 'Citrus peel spiral', owner: 'bea' }],
};

export async function seed(db: Db): Promise<void> {
  const seedMarker = await one<{ n: string }>(db, `select count(*)::text as n from workspaces`);
  if (seedMarker && Number(seedMarker.n) > 0) {
    // Already seeded; only ensure the seat plan state exists for each workspace.
    await ensureSeatStateFromSeeds(db);
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await seedInside(client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
  client.release();
  await ensureSeatStateFromSeeds(db);
}

async function seedInside(q: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }): Promise<void> {
  const db = q as unknown as Db;
  const groupIdByName = new Map<string, string>();
  for (const group of ['Halden Group', 'Vartan Studio']) {
    const id = newId();
    await db.query(`insert into groups (id, name) values ($1, $2)`, [id, group]);
    groupIdByName.set(group, id);
  }

  const wsIdBySlug = new Map<string, string>();
  for (const ws of WORKSPACES) {
    const id = newId();
    await db.query(
      `insert into workspaces (id, group_id, slug, name, time_zone, position) values ($1,$2,$3,$4,$5,$6)`,
      [id, groupIdByName.get(ws.group)!, ws.slug, ws.name, ws.timeZone, ws.position],
    );
    wsIdBySlug.set(ws.slug, id);
  }

  const accountIdByHandle = new Map<string, string>();
  const passwordHash = hashPassword(DEMO_PASSWORD);
  for (const acc of ACCOUNTS) {
    const id = newId();
    await db.query(
      `insert into accounts (id, email, display_name, handle, password_hash, role, group_id, workspace_id, has_seat)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        acc.email,
        acc.displayName,
        acc.handle,
        passwordHash,
        acc.role,
        acc.group ? groupIdByName.get(acc.group)! : null,
        acc.workspace ? wsIdBySlug.get(acc.workspace)! : null,
        acc.seat,
      ],
    );
    accountIdByHandle.set(acc.handle, id);
  }

  // Image references: one per title, plus the Vartan plates and the Northvale clip.
  const refIdByTitle = new Map<string, string>();
  for (const [slug, refs] of Object.entries(SEED_REFERENCES)) {
    for (const ref of refs) {
      const id = newId();
      await db.query(
        `insert into reference_items (id, workspace_id, kind, title, ext, content_type, created_by, created_at)
         values ($1,$2,'image',$3,'png','image/png',$4, now() - (random()* interval '30 days'))`,
        [id, wsIdBySlug.get(slug)!, ref.title, accountIdByHandle.get(ref.owner)!],
      );
      refIdByTitle.set(ref.title, id);
    }
  }
  // Vartan plates
  for (let i = 1; i <= 24; i++) {
    const id = newId();
    await db.query(
      `insert into reference_items (id, workspace_id, kind, title, ext, content_type, created_by, created_at)
       values ($1,$2,'image',$3,'png','image/png',$4, now() - (random()* interval '60 days'))`,
      [id, wsIdBySlug.get('vartan')!, `Field Study ${String(i).padStart(2, '0')} plate`, accountIdByHandle.get('ilse')!],
    );
    refIdByTitle.set(`Field Study ${String(i).padStart(2, '0')} plate`, id);
  }
  // The one clip: Capstan reel, WebM, 25fps, 2000ms => 50 frames.
  const clipId = newId();
  await db.query(
    `insert into reference_items (id, workspace_id, kind, title, ext, content_type, frame_rate, duration_ms, total_frames, created_by, created_at)
     values ($1,$2,'clip',$3,'webm','video/webm',25,2000,50,$4, now() - interval '10 days')`,
    [clipId, wsIdBySlug.get('northvale')!, 'Capstan reel', accountIdByHandle.get('juno')!],
  );

  // Clusters
  const clusterIdByName = new Map<string, string>();
  async function insertCluster(name: string, slug: string, owner: string, opts: {
    status: string;
    publicDescription?: string;
    internalNote?: string;
    liftsAt?: Date | null;
    liftsLocal?: string | null;
    publishedAt?: Date | null;
  }): Promise<string> {
    const id = newId();
    await db.query(
      `insert into clusters (id, workspace_id, title, public_description, internal_note, status, owner_id, lifts_at, lifts_local, published_at, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() - interval '40 days', now() - interval '5 days')`,
      [
        id,
        wsIdBySlug.get(slug)!,
        name,
        opts.publicDescription ?? '',
        opts.internalNote ?? '',
        opts.status,
        accountIdByHandle.get(owner)!,
        opts.liftsAt ?? null,
        opts.liftsLocal ?? null,
        opts.publishedAt ?? null,
      ],
    );
    clusterIdByName.set(name, id);
    return id;
  }

  async function insertEntry(clusterName: string, title: string, addedBy: string, isPrivate: boolean, position: number): Promise<void> {
    await db.query(
      `insert into entries (id, cluster_id, reference_id, position, is_private, added_by)
       values ($1,$2,$3,$4,$5,$6)`,
      [newId(), clusterIdByName.get(clusterName)!, refIdByTitle.get(title)!, position, isPrivate, accountIdByHandle.get(addedBy)!],
    );
  }

  // SS27 Coastal Workwear (draft, 6 items, one private)
  await insertCluster('SS27 Coastal Workwear', 'northvale', 'juno', { status: 'draft', internalNote: 'Do not share before buyer preview on 12 Nov.' });
  await insertEntry('SS27 Coastal Workwear', 'Salt-stained canvas', 'juno', false, 1);
  await insertEntry('SS27 Coastal Workwear', 'Rope coil', 'juno', false, 2);
  await insertEntry('SS27 Coastal Workwear', 'Harbour sodium light', 'juno', false, 3);
  await insertEntry('SS27 Coastal Workwear', 'Oilskin fold', 'juno', false, 4);
  await insertEntry('SS27 Coastal Workwear', "Net mender's hands", 'juno', false, 5);
  await insertEntry('SS27 Coastal Workwear', 'Tide chart', 'juno', true, 6);

  // AW26 Night Shift (public)
  const aw26At = new Date('2026-10-01T08:00:00.000Z');
  await insertCluster('AW26 Night Shift', 'northvale', 'juno', {
    status: 'public',
    internalNote: 'Lighting budget pending.',
    liftsAt: aw26At,
    liftsLocal: '2026-10-01T09:00',
    publishedAt: aw26At,
  });
  await insertEntry('AW26 Night Shift', 'Harbour sodium light', 'juno', false, 1);
  await insertEntry('AW26 Night Shift', 'Fog over slipway', 'tomas', false, 2);
  await insertEntry('AW26 Night Shift', 'Rusted cleat', 'tomas', true, 3);
  await insertEntry('AW26 Night Shift', 'Oilskin fold', 'juno', false, 4);
  await db.query(
    `insert into comments (id, cluster_id, author_name, body, created_at) values ($1,$2,$3,$4, now() - interval '3 days')`,
    [newId(), clusterIdByName.get('AW26 Night Shift')!, 'Tomas Reyes', 'Swap the third frame for the wider crop.'],
  );

  // SS27 Harbour Lights (in review) with one live seeded review link.
  await insertCluster('SS27 Harbour Lights', 'northvale', 'tomas', { status: 'in_review' });
  await insertEntry('SS27 Harbour Lights', 'Harbour sodium light', 'tomas', false, 1);
  await insertEntry('SS27 Harbour Lights', "Net mender's hands", 'tomas', false, 2);
  await db.query(
    `insert into review_links (id, token, cluster_id, workspace_id, email, expires_at, can_comment, state)
     values ($1,$2,$3,$4,$5,$6,true,'live')`,
    [
      newId(),
      'rv-seed-harbour-0001',
      clusterIdByName.get('SS27 Harbour Lights')!,
      wsIdBySlug.get('northvale')!,
      'ren@freelance.example',
      new Date('2099-12-31T23:59:59.000Z'),
    ],
  );

  // Kesto clusters
  await insertCluster('SS27 Trail Runner Direction', 'kesto', 'sam', { status: 'draft' });
  await insertEntry('SS27 Trail Runner Direction', 'Trail grit macro', 'sam', false, 1);
  await insertEntry('SS27 Trail Runner Direction', 'Midsole foam cut', 'sam', false, 2);
  await insertEntry('SS27 Trail Runner Direction', 'SS27 lace study', 'sam', false, 3);

  const kestoAt = new Date('2026-09-20T12:00:00.000Z');
  await insertCluster('Kesto Studio Pulls', 'kesto', 'remy', {
    status: 'public',
    liftsAt: kestoAt,
    liftsLocal: '2026-09-20T08:00',
    publishedAt: kestoAt,
  });
  await insertEntry('Kesto Studio Pulls', 'Ridge at dawn', 'remy', false, 1);
  await insertEntry('Kesto Studio Pulls', 'Scree field', 'remy', false, 2);

  // Brisk Tonic
  await insertCluster('Summer Fizz Palette', 'brisk-tonic', 'bea', { status: 'draft' });
  await insertEntry('Summer Fizz Palette', 'Citrus peel spiral', 'bea', false, 1);

  // Vartan Field Studies 01..24, all public.
  for (let i = 1; i <= 24; i++) {
    const nn = String(i).padStart(2, '0');
    let publishedAt: Date;
    let liftLocalTime: string;
    if (i >= 13 && i <= 16) {
      publishedAt = new Date('2026-09-01T22:00:00.000Z');
      liftLocalTime = '2026-09-02T00:00';
    } else {
      publishedAt = new Date(new Date('2026-09-01T10:00:00.000Z').getTime() + (i - 1) * 3600_000);
      liftLocalTime = '2026-09-01T12:00';
    }
    await insertCluster(`Field Study ${nn}`, 'vartan', 'ilse', {
      status: 'public',
      liftsAt: publishedAt,
      liftsLocal: liftLocalTime,
      publishedAt,
    });
    await insertEntry(`Field Study ${nn}`, `Field Study ${nn} plate`, 'ilse', false, 1);
  }

  // Follows: Lee follows Juno and Ilse; Noor follows Juno.
  await db.query(
    `insert into follows (follower_id, curator_id) values ($1,$2),($3,$4),($5,$6)`,
    [
      accountIdByHandle.get('lee')!, accountIdByHandle.get('juno')!,
      accountIdByHandle.get('lee')!, accountIdByHandle.get('ilse')!,
      accountIdByHandle.get('noor')!, accountIdByHandle.get('juno')!,
    ],
  );

  await ensureSeatStateFromSeeds(db);
}

async function ensureSeatStateFromSeeds(db: Db): Promise<void> {
  const rows = await many<{ slug: string; plan: string }>(
    db,
    `select w.slug, coalesce(s.plan, '') as plan, (s.workspace_id is null) as missing
       from workspaces w left join seat_state s on s.workspace_id = w.id`,
  );
  for (const row of rows) {
    const ws = WORKSPACES.find((w) => w.slug === row.slug);
    if (!ws) continue;
    await db.query(
      `insert into seat_state (workspace_id, plan, seat_cap, updated_at) values ($1,$2,$3, now())
       on conflict (workspace_id) do nothing`,
      [(await one<{ id: string }>(db, `select id from workspaces where slug=$1`, [row.slug]))!.id, ws.plan, Number(ws.plan.split('-')[2])],
    );
  }
}
