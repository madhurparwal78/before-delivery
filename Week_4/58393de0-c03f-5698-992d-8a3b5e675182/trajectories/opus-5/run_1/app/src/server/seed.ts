import { randomUUID } from 'node:crypto';
import type { ProjectKind, Snapshot } from '../shared/types.js';
import { SHAPE_COLORS } from '../shared/palette.js';
import { query } from './db.js';
import { serverNow, setGradingClock } from './clock.js';
import { createAccount } from './accounts.js';
import { insertClassroom } from './classrooms.js';
import { deleteObject, listObjectKeys, putObject, snapshotKey } from './storage.js';
import { utcToLocal } from './zones.js';

const ZONE = 'America/Chicago';

const gearBox = (): Snapshot => ({
  kind: '3d',
  objects: [
    {
      id: 'grp-1',
      kind: 'group',
      mode: 'solid',
      x: 0,
      y: 0,
      z: 10,
      w: 40,
      d: 40,
      h: 20,
      rotationZ: 0,
      color: SHAPE_COLORS[0],
      children: [
        {
          id: 'box-1',
          kind: 'box',
          mode: 'solid',
          x: 0,
          y: 0,
          z: 10,
          w: 40,
          d: 40,
          h: 20,
          rotationZ: 0,
          color: SHAPE_COLORS[0],
          children: [],
        },
        {
          id: 'cyl-1',
          kind: 'cylinder',
          mode: 'hole',
          x: 0,
          y: 0,
          z: 10,
          w: 16,
          d: 16,
          h: 20,
          rotationZ: 0,
          color: SHAPE_COLORS[1],
          children: [],
        },
      ],
    },
  ],
  workplane: { origin: [0, 0, 0], normal: [0, 0, 1] },
});

const nightLight = (): Snapshot => ({
  kind: 'circuit',
  components: [
    { label: 'BAT-1', type: 'battery', volts: 9 },
    { label: 'R-1', type: 'resistor', ohms: 330 },
    { label: 'LED-1', type: 'led', broken: false },
  ],
  wires: [
    { from: 'BAT-1+', to: 'R-1+' },
    { from: 'R-1-', to: 'LED-1+' },
    { from: 'LED-1-', to: 'BAT-1-' },
  ],
});

const sphereTower = (): Snapshot => ({
  kind: 'blocks',
  program: [
    {
      block: 'repeat',
      count: 3,
      body: [{ block: 'addSphere' }, { block: 'moveZ', mm: 10 }],
    },
  ],
  objects: [0, 10, 20].map((z, index) => ({
    id: `sph-${index + 1}`,
    kind: 'sphere' as const,
    mode: 'solid' as const,
    x: 0,
    y: 0,
    z,
    w: 20,
    d: 20,
    h: 20,
    rotationZ: 0,
    color: SHAPE_COLORS[index % SHAPE_COLORS.length],
    children: [],
  })),
});

interface SeededProject {
  id: string;
  ownerId: string;
  kind: ProjectKind;
  name: string;
  revision: number;
}

const emptyBucket = async (): Promise<boolean> => {
  try {
    const keys = [...(await listObjectKeys('projects/')), ...(await listObjectKeys('exports/'))];
    for (const key of keys) await deleteObject(key);
    return true;
  } catch {
    return false;
  }
};

const seedProject = async (
  ownerId: string,
  classroomId: string | null,
  kind: ProjectKind,
  name: string,
  snapshot: Snapshot,
  savedAt: Date,
  storageUp: boolean,
): Promise<SeededProject> => {
  const id = randomUUID();
  await query(
    `insert into projects (id, owner_id, classroom_id, kind, name, revision, saved_at, created_at)
     values ($1,$2,$3,$4,$5,3,$6,$6)`,
    [id, ownerId, classroomId, kind, name, savedAt],
  );
  const body = Buffer.from(JSON.stringify(snapshot), 'utf8');
  for (const revision of [1, 2, 3]) {
    const key = snapshotKey(id, revision);
    await query('insert into project_revisions (project_id, revision, object_key) values ($1,$2,$3)', [
      id,
      revision,
      key,
    ]);
    if (storageUp) {
      try {
        await putObject(key, body, 'application/json');
      } catch {
        return { id, ownerId, kind, name, revision: 3 };
      }
    }
  }
  return { id, ownerId, kind, name, revision: 3 };
};

export const runSeed = async (): Promise<Record<string, unknown>> => {
  setGradingClock(null);
  const storageUp = await emptyBucket();
  await query(
    `truncate table accounts, classrooms, classroom_educators, verification_tokens, sessions,
       projects, project_revisions, exports, idempotency_keys, join_attempts, orphan_objects`,
  );

  const nowMs = Math.floor(serverNow().getTime() / 60_000) * 60_000;
  const minute = 60_000;
  const day = 86_400_000;

  const dana = await createAccount({
    email: 'dana@hollowbrook.test',
    password: 'kiln-maple-2026',
    displayName: 'Dana Whitlock',
    kind: 'educator',
    verified: true,
  });
  const sam = await createAccount({
    email: 'sam@hollowbrook.test',
    password: 'brass-tack-2026',
    displayName: 'Sam Ortega',
    kind: 'educator',
    verified: true,
  });
  const priya = await createAccount({
    email: 'priya@makers.test',
    password: 'orbit-glue-2026',
    displayName: 'Priya Natarajan',
    kind: 'personal',
    verified: false,
  });

  const joinOpensAt = new Date(nowMs - day);
  const joinClosesAt = new Date(nowMs + 7 * day);
  const handInAt = new Date(nowMs + 14 * day);
  const classroom = await insertClassroom({
    name: 'Robotics Lab',
    zone: ZONE,
    joinCode: 'ROBO42',
    ownerId: dana.id,
    times: {
      joinOpensLocal: utcToLocal(ZONE, joinOpensAt.getTime()),
      joinClosesLocal: utcToLocal(ZONE, joinClosesAt.getTime()),
      handInLocal: utcToLocal(ZONE, handInAt.getTime()),
      joinOpensAt,
      joinClosesAt,
      handInAt,
    },
  });
  await query("insert into classroom_educators (classroom_id, educator_id, role) values ($1,$2,'assistant')", [
    classroom.id,
    sam.id,
  ]);

  const students: { id: string; nickname: string }[] = [];
  for (const nickname of ['Tiny Turtle', 'Blue Fox']) {
    const id = randomUUID();
    await query(
      `insert into accounts (id, kind, display_name, classroom_id, nickname, nickname_key, email_verified, created_at)
       values ($1, 'student', $2, $3, $2, $4, true, now())`,
      [id, nickname, classroom.id, nickname.toLowerCase()],
    );
    students.push({ id, nickname });
  }

  const projects: SeededProject[] = [];
  const owners: { id: string; classroomId: string | null }[] = [
    { id: students[0].id, classroomId: classroom.id },
    { id: students[1].id, classroomId: classroom.id },
    { id: dana.id, classroomId: null },
  ];
  for (const owner of owners) {
    projects.push(
      await seedProject(owner.id, owner.classroomId, 'blocks', 'Sphere Tower', sphereTower(), new Date(nowMs - 30 * minute), storageUp),
    );
    projects.push(
      await seedProject(owner.id, owner.classroomId, 'circuit', 'Night Light', nightLight(), new Date(nowMs - 20 * minute), storageUp),
    );
    projects.push(
      await seedProject(owner.id, owner.classroomId, '3d', 'Gear Box', gearBox(), new Date(nowMs - 5 * minute), storageUp),
    );
  }

  return {
    educator: {
      id: dana.id,
      email: 'dana@hollowbrook.test',
      password: 'kiln-maple-2026',
      displayName: 'Dana Whitlock',
    },
    assistant: {
      id: sam.id,
      email: 'sam@hollowbrook.test',
      password: 'brass-tack-2026',
      displayName: 'Sam Ortega',
    },
    personal: {
      id: priya.id,
      email: 'priya@makers.test',
      password: 'orbit-glue-2026',
      displayName: 'Priya Natarajan',
    },
    classroom: {
      id: classroom.id,
      name: 'Robotics Lab',
      joinCode: 'ROBO42',
      timeZone: ZONE,
      joinOpensAt: joinOpensAt.toISOString(),
      joinClosesAt: joinClosesAt.toISOString(),
      handInAt: handInAt.toISOString(),
    },
    students,
    projects,
    storageSeeded: storageUp,
  };
};
