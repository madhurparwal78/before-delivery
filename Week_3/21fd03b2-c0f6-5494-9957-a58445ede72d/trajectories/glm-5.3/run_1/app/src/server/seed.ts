import { app } from './routes';
import { withClient, withTransaction, pool } from './db';
import { asyncHandler, AppError, errorBody, notFound } from './errors';
import { randomId, hashPassword } from './crypto';
import { templateDocument, type SceneDocument, type SceneObject } from '../bench/scene';
import { documentBytes, computeStateHash } from './scenes';
import type { DbClient } from './db';

// Seed: created only if the seeded accounts are missing. Concurrent instances
// produce exactly one copy through the users unique constraint.

const SEED_USERS = [
  { name: 'Ines Okafor', email: 'ines@okafor-physics.example', password: 'ines-bench-2026' },
  { name: 'Tomas Reyes', email: 'tomas@okafor-physics.example', password: 'tomas-bench-2026' },
  { name: 'Priya Lund', email: 'priya@lund-family.example', password: 'priya-bench-2026' },
  { name: 'Dana Whitcombe', email: 'dana@whitcombe-tutoring.example', password: 'dana-bench-2026' },
];

export async function seed(): Promise<void> {
  const exists = await withClient(async (client) => {
    const row = await client.query('SELECT 1 FROM users WHERE email_folded = $1', ['ines@okafor-physics.example']);
    return row.rows.length > 0;
  });
  if (exists) return;
  const hashes = await Promise.all(SEED_USERS.map((u) => hashPassword(u.password)));
  await withTransaction(async (client) => {
    try {
      await seedInside(client, hashes);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return; // another instance seeded first
      throw e;
    }
  });
}

async function seedInside(client: DbClient, hashes: string[]): Promise<void> {
  const userIds: string[] = [];
  for (let i = 0; i < SEED_USERS.length; i++) {
    const user = SEED_USERS[i]!;
    const id = `seed-user-${i + 1}`;
    await client.query(
      'INSERT INTO users (id, email, email_folded, display_name, password_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email_folded) DO NOTHING',
      [id, user.email, user.email, user.name, hashes[i]!],
    );
    userIds.push(id);
  }
  const okaforId = 'seed-ws-okafor';
  const coopId = 'seed-ws-coop';
  const whitcombeId = 'seed-ws-whitcombe';
  await client.query("INSERT INTO workspaces (id, name) VALUES ($1,'Okafor Physics Bench'), ($2,'Saturday Co-op Lab'), ($3,'Whitcombe Tutoring') ON CONFLICT (id) DO NOTHING", [okaforId, coopId, whitcombeId]);
  await client.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,'owner'), ($1,$3,'editor'), ($1,$4,'viewer'), ($5,$2,'owner'), ($6,$7,'owner') ON CONFLICT DO NOTHING", [
    okaforId, userIds[0]!, userIds[1]!, userIds[2]!, coopId, whitcombeId, userIds[3]!,
  ]);
  // Ines joined Okafor before Saturday Co-op; her last opened workspace is Okafor.
  await client.query("INSERT INTO last_opened (user_id, workspace_id) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING", [userIds[0]!, okaforId]);
  const forcesId = 'seed-prj-forces';
  const notesId = 'seed-prj-notes';
  await client.query("INSERT INTO projects (id, workspace_id, name) VALUES ($1,$2,'Forces and Motion'), ($3,$4,'Private notes') ON CONFLICT (id) DO NOTHING", [forcesId, okaforId, notesId, whitcombeId]);

  const slopeDoc = makeSlopeDoc();
  const pendulumDoc = makePendulumDoc();
  const launcherDoc = makeLauncherDoc();
  await insertScene(client, 'seed-scn-slope', forcesId, 'Slope trial', slopeDoc);
  await insertScene(client, 'seed-scn-pendulum', forcesId, 'Pendulum clock', pendulumDoc);
  await insertScene(client, 'seed-scn-launcher', forcesId, 'Ball launcher', launcherDoc);
  await insertScene(client, 'seed-scn-incline', notesId, 'Incline notes', { gravity: 9.81, name: 'Incline notes', objects: [], solver: { iterations: 4, step: '1/120' } });
}

async function insertScene(client: DbClient, id: string, projectId: string, name: string, doc: SceneDocument): Promise<void> {
  await client.query("INSERT INTO scenes (id, project_id, name, status, revision) VALUES ($1,$2,$3,'draft',1) ON CONFLICT (id) DO NOTHING", [id, projectId, name]);
  await client.query('INSERT INTO scene_revisions (scene_id, revision, document, ops, change_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (scene_id, revision) DO NOTHING', [id, 1, documentBytes(doc), '[]', null]);
}

function obj(id: string, kind: SceneObject['kind'], name: string, params: Record<string, number>, position: [number, number, number], scale: [number, number, number]): SceneObject {
  return { id, kind, name, params, position, rotation: [0, 0, 0, 1], scale, assetId: null };
}

function makeSlopeDoc(): SceneDocument {
  const doc: SceneDocument = {
    gravity: 9.81,
    name: 'Slope trial',
    objects: [
      obj('cart-1', 'crate', 'Cart 1', { mass_kg: 1 }, [-2, 0, 0], [0.4, 0.3, 0.25]),
      obj('crate-1', 'crate', 'Stop block', { mass_kg: 5 }, [4, 0, 0], [0.5, 0.5, 0.5]),
      obj('ramp-1', 'ramp', 'Ramp A', { mass_kg: 2, angle_deg: 30, length_m: 4, friction: 0 }, [0, 0, 0], [1, 1, 1]),
    ],
    solver: { iterations: 4, step: '1/120' },
  };
  return doc;
}

function makePendulumDoc(): SceneDocument {
  return {
    gravity: 9.81,
    name: 'Pendulum clock',
    objects: [obj('pendulum-1', 'pendulum', 'Clock bob', { mass_kg: 0.5, length_m: 1, release_deg: 20 }, [0, 2, 0], [1, 1, 1])],
    solver: { iterations: 4, step: '1/120' },
  };
}

function makeLauncherDoc(): SceneDocument {
  return {
    gravity: 9.81,
    name: 'Ball launcher',
    objects: [obj('launcher-1', 'launcher', 'Launcher', { mass_kg: 0.2, speed_mps: 5, launch_angle_deg: 45, height_m: 1 }, [0, 0, 0], [1, 1, 1])],
    solver: { iterations: 4, step: '1/120' },
  };
}
