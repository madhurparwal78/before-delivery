import {
  SOLVER,
  canonicalDocument,
  makeObject,
  type SceneDocument,
  type SceneObject,
} from '../shared/scene.js';
import { stepZeroHash } from '../shared/sim.js';
import { foldEmail, hashPassword } from './auth.js';
import { query, transaction } from './db.js';
import { newId } from './ids.js';

interface SeedAccount {
  key: string;
  displayName: string;
  email: string;
  password: string;
}

const ACCOUNTS: readonly SeedAccount[] = [
  {
    key: 'ines',
    displayName: 'Ines Okafor',
    email: 'ines@okafor-physics.example',
    password: 'ines-bench-2026',
  },
  {
    key: 'tomas',
    displayName: 'Tomas Reyes',
    email: 'tomas@okafor-physics.example',
    password: 'tomas-bench-2026',
  },
  {
    key: 'priya',
    displayName: 'Priya Lund',
    email: 'priya@lund-family.example',
    password: 'priya-bench-2026',
  },
  {
    key: 'dana',
    displayName: 'Dana Whitcombe',
    email: 'dana@whitcombe-tutoring.example',
    password: 'dana-bench-2026',
  },
];

function document(name: string, objects: SceneObject[]): SceneDocument {
  return { gravity: 9.81, name, objects, solver: SOLVER };
}

function seedScenes(): { name: string; document: SceneDocument }[] {
  return [
    {
      name: 'Slope trial',
      document: document('Slope trial', [
        makeObject('ramp-1', 'ramp', 'Ramp A', {
          params: { mass_kg: 2, angle_deg: 30, length_m: 4, friction: 0 },
        }),
        makeObject('crate-1', 'crate', 'Stop block', {
          params: { mass_kg: 5 },
          position: [4, 0, 0],
          scale: [0.5, 0.5, 0.5],
        }),
        makeObject('cart-1', 'crate', 'Cart 1', {
          params: { mass_kg: 1 },
          position: [-2, 0, 0],
          scale: [0.4, 0.3, 0.25],
        }),
      ]),
    },
    {
      name: 'Pendulum clock',
      document: document('Pendulum clock', [
        makeObject('pendulum-1', 'pendulum', 'Clock bob', {
          params: { mass_kg: 0.5, length_m: 1, release_deg: 20 },
          position: [0, 2, 0],
        }),
      ]),
    },
    {
      name: 'Ball launcher',
      document: document('Ball launcher', [
        makeObject('launcher-1', 'launcher', 'Launcher', {
          params: { mass_kg: 0.2, speed_mps: 5, launch_angle_deg: 45, height_m: 1 },
        }),
      ]),
    },
  ];
}

async function insertScene(projectId: string, name: string, scene: SceneDocument): Promise<void> {
  const text = canonicalDocument(scene);
  const stateHash = stepZeroHash(scene);
  const id = newId();
  await query(
    `insert into scenes (id, project_id, name, status, revision, state_hash, document)
     values ($1,$2,$3,'draft',1,$4,$5)`,
    [id, projectId, name, stateHash, text],
  );
  await query(
    `insert into revisions (scene_id, revision, document, ops, changed_keys, state_hash)
     values ($1,1,$2,$3,$4,$5)`,
    [id, text, JSON.stringify([]), [], stateHash],
  );
}

/** Creates the seed records once, however many instances start at the same time. */
export async function seed(): Promise<void> {
  const claimed = await transaction(async (run) => {
    await run('select pg_advisory_xact_lock(7723461)');
    const marker = await run<{ id: string }>('select id from seed_marker where id = $1', ['v1']);
    if (marker.length > 0) return false;
    const existing = await run<{ id: string }>('select id from accounts where email_folded = $1', [
      foldEmail(ACCOUNTS[0].email),
    ]);
    if (existing.length > 0) {
      await run('insert into seed_marker (id) values ($1) on conflict do nothing', ['v1']);
      return false;
    }
    await run('insert into seed_marker (id) values ($1)', ['v1']);
    return true;
  });
  if (!claimed) return;

  const ids = new Map<string, string>();
  for (const account of ACCOUNTS) {
    const id = newId();
    ids.set(account.key, id);
    await query(
      'insert into accounts (id, email, email_folded, display_name, password_hash) values ($1,$2,$3,$4,$5)',
      [
        id,
        account.email,
        foldEmail(account.email),
        account.displayName,
        await hashPassword(account.password),
      ],
    );
  }

  const ines = ids.get('ines') as string;
  const okafor = newId();
  await query('insert into workspaces (id, name, owner_id) values ($1,$2,$3)', [
    okafor,
    'Okafor Physics Bench',
    ines,
  ]);
  const now = Date.now();
  const joined = (offsetSeconds: number): string => new Date(now + offsetSeconds * 1000).toISOString();
  await query(
    'insert into memberships (workspace_id, user_id, role, joined_at) values ($1,$2,$3,$4)',
    [okafor, ines, 'owner', joined(0)],
  );
  await query(
    'insert into memberships (workspace_id, user_id, role, joined_at) values ($1,$2,$3,$4)',
    [okafor, ids.get('tomas'), 'editor', joined(1)],
  );
  await query(
    'insert into memberships (workspace_id, user_id, role, joined_at) values ($1,$2,$3,$4)',
    [okafor, ids.get('priya'), 'viewer', joined(2)],
  );

  const saturday = newId();
  await query('insert into workspaces (id, name, owner_id) values ($1,$2,$3)', [
    saturday,
    'Saturday Co-op Lab',
    ines,
  ]);
  await query(
    'insert into memberships (workspace_id, user_id, role, joined_at) values ($1,$2,$3,$4)',
    [saturday, ines, 'owner', joined(10)],
  );

  const whitcombe = newId();
  const dana = ids.get('dana') as string;
  await query('insert into workspaces (id, name, owner_id) values ($1,$2,$3)', [
    whitcombe,
    'Whitcombe Tutoring',
    dana,
  ]);
  await query(
    'insert into memberships (workspace_id, user_id, role, joined_at) values ($1,$2,$3,$4)',
    [whitcombe, dana, 'owner', joined(0)],
  );

  const forces = newId();
  await query('insert into projects (id, workspace_id, name) values ($1,$2,$3)', [
    forces,
    okafor,
    'Forces and Motion',
  ]);
  for (const scene of seedScenes()) await insertScene(forces, scene.name, scene.document);

  const notes = newId();
  await query('insert into projects (id, workspace_id, name) values ($1,$2,$3)', [
    notes,
    whitcombe,
    'Private notes',
  ]);
  await insertScene(notes, 'Incline notes', document('Incline notes', []));

  await query('update accounts set last_workspace_id = $1 where id = $2', [okafor, ines]);
}
