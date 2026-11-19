import type { Db } from './db';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { buildReferenceContent, buildReferenceContentWithTt1 } from './referenceLayout';
import { canonicalHash } from '../shared/canonical';
import type { LayoutContent, StandardsProfile } from '../shared/domain';
import { buildSessionState } from './sessionEngine';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1];
  const hash = parts[2];
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const DEFAULT_PROFILE: StandardsProfile = {
  endplate_single_mm: 610,
  endplate_double_mm: 660,
  double_track_offset_mm: 25,
  end_straight_mm: 152,
  min_radius_mm: 1067,
  max_grade_tenths_percent: 20,
  min_frog_number: 6,
  reverse_curve_straight_mm: 305,
  elevation_step_hundredths_mm: 1905,
  display_units: 'in',
};

interface SeedUser {
  id: string;
  email: string;
  display_name: string;
  walkthrough_done: boolean;
}

const SEED_USERS: SeedUser[] = [
  { id: 'u-founder', email: 'founder@fishplate.example', display_name: 'Founder Fishplate', walkthrough_done: true },
  { id: 'u-tarn-manager', email: 'manager@tarnvalley.example', display_name: 'Morgan Tarn', walkthrough_done: true },
  { id: 'u-tarn-member', email: 'member@tarnvalley.example', display_name: 'Robin Tarn', walkthrough_done: true },
  { id: 'u-tarn-member2', email: 'member2@tarnvalley.example', display_name: 'Sam Tarn', walkthrough_done: true },
  { id: 'u-tarn-operator', email: 'operator@tarnvalley.example', display_name: 'Alex Tarn', walkthrough_done: true },
  { id: 'u-tarn-operator2', email: 'operator2@tarnvalley.example', display_name: 'Jo Tarn', walkthrough_done: true },
  { id: 'u-tarn-newmember', email: 'newmember@tarnvalley.example', display_name: 'Riley Tarn', walkthrough_done: false },
  { id: 'u-salt-manager', email: 'manager@saltmarsh.example', display_name: 'Casey Marsh', walkthrough_done: true },
  { id: 'u-salt-operator', email: 'operator@saltmarsh.example', display_name: 'Dale Marsh', walkthrough_done: true },
];

const SCHEMA_SQL = `SCHEMA_PLACEHOLDER`;

export async function applySchema(db: Db): Promise<void> {
    await db.query(SCHEMA_SQL);
  }

/**
 * Idempotent seed. Safe when several instances start together: each insert is
 * keyed and conflicting inserts are ignored, then the seed is re-checked.
 */
export async function seed(db: Db): Promise<void> {
  const password = hashPassword('gandyboard-demo-1');

  for (const u of SEED_USERS) {
    await db.query(
      `INSERT INTO app_users (id, email, display_name, password_hash, walkthrough_done)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.email, u.display_name, password, u.walkthrough_done],
    );
  }

  for (const ws of [
    { id: 'tarn-valley', name: 'Tarn Valley Model Railway Club' },
    { id: 'saltmarsh', name: 'Saltmarsh Modular Group' },
  ]) {
    await db.query(
      `INSERT INTO workspaces (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
      [ws.id, ws.name],
    );
    await db.query(
      `INSERT INTO standards (workspace_id, profile, revision) VALUES ($1,$2,1) ON CONFLICT (workspace_id) DO NOTHING`,
      [ws.id, JSON.stringify(DEFAULT_PROFILE)],
    );
  }

  const memberships: [string, string, string][] = [
    ['tarn-valley', 'u-founder', 'founder'],
    ['saltmarsh', 'u-founder', 'founder'],
    ['tarn-valley', 'u-tarn-manager', 'manager'],
    ['tarn-valley', 'u-tarn-member', 'member'],
    ['tarn-valley', 'u-tarn-member2', 'member'],
    ['tarn-valley', 'u-tarn-operator', 'operator'],
    ['tarn-valley', 'u-tarn-operator2', 'operator'],
    ['tarn-valley', 'u-tarn-newmember', 'member'],
    ['saltmarsh', 'u-salt-manager', 'manager'],
    ['saltmarsh', 'u-salt-operator', 'operator'],
  ];
  for (const [ws, user, role] of memberships) {
    await db.query(
      `INSERT INTO memberships (workspace_id, user_id, role, revision) VALUES ($1,$2,$3,1)
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [ws, user, role],
    );
  }

  await seedWorkspaceLayout(db, 'tarn-valley', 'tarn-main', 'Tarn Valley Main Line', 12);
  await seedWorkspaceLayout(db, 'saltmarsh', 'saltmarsh-branch', 'Saltmarsh Branch', 1);

  await seedSessions(db);
}

async function seedWorkspaceLayout(db: Db, workspaceId: string, layoutId: string, layoutName: string, versionCount: number): Promise<void> {
  const existing = await db.query('SELECT id FROM layouts WHERE id = $1', [layoutId]);
  if (existing.rowCount && existing.rowCount > 0) return;

  let newestContent: LayoutContent | null = null;
  for (let n = 1; n <= versionCount; n++) {
    const content = n === versionCount ? buildReferenceContent() : buildReferenceContentWithTt1(n * 60);
    content.timetable.version = n;
    newestContent = content;
  }
  if (!newestContent) throw new Error('no content');

  // The layout row exists first so version rows can reference it.
  await db.query(
    `INSERT INTO layouts (id, workspace_id, name, revision, working_hash, content)
     VALUES ($1,$2,$3,1,$4,$5) ON CONFLICT (id) DO NOTHING`,
    [layoutId, workspaceId, layoutName, canonicalHash(newestContent), JSON.stringify(newestContent)],
  );

  for (let n = 1; n <= versionCount; n++) {
    const content = n === versionCount ? buildReferenceContent() : buildReferenceContentWithTt1(n * 60);
    content.timetable.version = n;
    const hash = canonicalHash(content);
    const id = `ver-${layoutId}-${n}`;
    await db.query(
      `INSERT INTO layout_versions (id, layout_id, number, state, label, canonical_hash, content, saved_by, saved_at, restored_from, revision, timetable_version)
       VALUES ($1,$2,$3,'Published',$4,$5,$6,'u-founder',now(),NULL,1,$7)
       ON CONFLICT (id) DO NOTHING`,
      [id, layoutId, n, `Issue ${n}`, hash, JSON.stringify(content), n],
    );
  }
}

async function seedSessions(db: Db): Promise<void> {
  const seeds: { id: string; workspace: string; layout: string; name: string; version: number; status: string; ratio: number }[] = [
    { id: 'thursday-running', workspace: 'tarn-valley', layout: 'tarn-main', name: 'Thursday Running', version: 12, status: 'Scheduled', ratio: 6 },
    { id: 'tarn-shakedown', workspace: 'tarn-valley', layout: 'tarn-main', name: 'Tarn Shakedown', version: 12, status: 'Running', ratio: 6 },
    { id: 'saltmarsh-rehearsal', workspace: 'saltmarsh', layout: 'saltmarsh-branch', name: 'Saltmarsh Rehearsal', version: 1, status: 'Running', ratio: 6 },
  ];
  for (const s of seeds) {
    const existing = await db.query('SELECT id FROM run_sessions WHERE id = $1', [s.id]);
    if (existing.rowCount && existing.rowCount > 0) continue;
    const ver = await db.query('SELECT id, content, timetable_version FROM layout_versions WHERE layout_id = $1 AND number = $2', [s.layout, s.version]);
    const row = ver.rows[0];
    if (!row) continue;
    const content = row.content as LayoutContent;
    const state = buildSessionState(s.id, row.id as string, s.version, row.timetable_version as number, content, s.ratio);
    await db.query(
      `INSERT INTO run_sessions (id, workspace_id, name, status, hold_reason, ratio, revision, control_revision, session_version, tick, fast_clock_seconds, layout_version_id, layout_version_number, timetable_version, state, last_tick_at)
       VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,1,$8,$9,$10,$11,$12,$13,now())
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.workspace, s.name, s.status, s.ratio, 0, 0, 0, 0, row.id, s.version, row.timetable_version, JSON.stringify(state)],
    );
  }
}
