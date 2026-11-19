import { randomUUID } from "node:crypto";
import { nicknameKey } from "../shared/rules";
import type { CircuitComponent, DesignObject, Snapshot, Snapshot3d, SnapshotBlocks, SnapshotCircuit } from "../shared/types";
import { hashPassword } from "./auth";
import { forgetClassroomStates } from "./classroom-events";
import { serverNow, setServerTime } from "./clock";
import { pool, withTransaction } from "./db";
import { ensureBucket, deleteObjects, listObjects, putObject, StorageError } from "./s3";
import { APP_TABLES } from "./schema";
import { snapshotKey } from "./projects-store";
import { endAllStreams } from "./stream-hub";
import { instantToLocalWire } from "./zone";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const ZONE = "America/Chicago";
const GREEN = "#35b558";
const PURPLE = "#7a3fd1";
const SLATE = "#646e80";

interface Person {
  id: string;
  email: string;
  password: string;
  displayName: string;
}

const object = (fields: Pick<DesignObject, "id" | "kind"> & Partial<DesignObject>): DesignObject => ({
  mode: "solid", x: 0, y: 0, z: 10, w: 20, d: 20, h: 20, rotationZ: 0, color: GREEN, children: [], ...fields,
});

function gearBox(): Snapshot3d {
  const members = [
    object({ id: "gear-box", kind: "box", w: 40, d: 40 }),
    object({ id: "gear-hole", kind: "cylinder", mode: "hole", w: 16, d: 16, color: SLATE }),
  ];
  return {
    kind: "3d",
    objects: [object({ id: "gear", kind: "group", w: 40, d: 40, children: members })],
    workplane: { origin: [0, 0, 0], normal: [0, 0, 1] },
  };
}

function nightLight(): SnapshotCircuit {
  const components: CircuitComponent[] = [
    { label: "BAT-1", type: "battery", volts: 9 },
    { label: "R-1", type: "resistor", ohms: 330 },
    { label: "LED-1", type: "led", broken: false },
  ];
  return {
    kind: "circuit",
    components,
    wires: [{ from: "BAT-1+", to: "R-1+" }, { from: "R-1-", to: "LED-1+" }, { from: "LED-1-", to: "BAT-1-" }],
  };
}

function sphereTower(): SnapshotBlocks {
  return {
    kind: "blocks",
    program: [{ block: "repeat", count: 3, body: [{ block: "addSphere" }, { block: "moveZ", mm: 10 }] }],
    objects: [0, 1, 2].map((i) => object({ id: `sphere-${i}`, kind: "sphere", z: i * 10, color: PURPLE })),
  };
}

const PROJECTS: readonly { name: string; snapshot: Snapshot; savedMinutesAgo: number }[] = [
  { name: "Gear Box", snapshot: gearBox(), savedMinutesAgo: 5 },
  { name: "Night Light", snapshot: nightLight(), savedMinutesAgo: 20 },
  { name: "Sphere Tower", snapshot: sphereTower(), savedMinutesAgo: 30 },
];

const person = (email: string, password: string, displayName: string): Person => ({ id: randomUUID(), email, password, displayName });
const student = (nickname: string) => ({ id: randomUUID(), nickname });

/** Empties the bucket, then writes `files`; false when storage could not be reached. */
async function resetStorage(files: readonly { key: string; body: Buffer }[]): Promise<boolean> {
  try {
    await ensureBucket();
    await deleteObjects(await listObjects());
    await Promise.all(files.map((file) => putObject(file.key, file.body, "application/json")));
    return true;
  } catch (error) {
    if (error instanceof StorageError) return false;
    throw error;
  }
}

/** Replaces every app record and stored object with the grading seed data and answers with its description. */
export async function seed() {
  await pool.query(`TRUNCATE TABLE ${APP_TABLES.join(", ")}`);
  setServerTime(null);
  forgetClassroomStates();
  endAllStreams();

  const now = Math.floor(serverNow().getTime() / MINUTE_MS) * MINUTE_MS;
  const dana = person("dana@hollowbrook.test", "kiln-maple-2026", "Dana Whitlock");
  const sam = person("sam@hollowbrook.test", "brass-tack-2026", "Sam Ortega");
  const priya = person("priya@makers.test", "orbit-glue-2026", "Priya Natarajan");
  const students = [student("Tiny Turtle"), student("Blue Fox")];
  const classroom = {
    id: randomUUID(), name: "Robotics Lab", joinCode: "ROBO42", timeZone: ZONE,
    joinOpensAt: new Date(now - DAY_MS), joinClosesAt: new Date(now + 7 * DAY_MS), handInAt: new Date(now + 14 * DAY_MS),
  };
  const projects = [dana, ...students].flatMap((owner) => PROJECTS.map((project) => ({
    id: randomUUID(), ownerId: owner.id, classroomId: owner === dana ? null : classroom.id, kind: project.snapshot.kind,
    name: project.name, revision: 3, snapshot: project.snapshot, savedAt: new Date(now - project.savedMinutesAgo * MINUTE_MS),
  })));

  await withTransaction(async (client) => {
    for (const owner of [dana, sam, priya]) {
      await client.query(
        `INSERT INTO accounts (id, kind, display_name, email, password_hash, email_verified, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [owner.id, owner === dana || owner === sam ? "educator" : "personal", owner.displayName, owner.email,
          await hashPassword(owner.password), owner !== priya, new Date(now)]);
    }
    const local = (instant: Date) => instantToLocalWire(instant, ZONE);
    await client.query(
      `INSERT INTO classrooms (id, owner_id, name, time_zone, join_code, join_opens_local, join_closes_local, hand_in_local,
         join_opens_at, join_closes_at, hand_in_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [classroom.id, dana.id, classroom.name, ZONE, classroom.joinCode, local(classroom.joinOpensAt), local(classroom.joinClosesAt),
        local(classroom.handInAt), classroom.joinOpensAt, classroom.joinClosesAt, classroom.handInAt, new Date(now)]);
    await client.query("INSERT INTO classroom_educators (classroom_id, educator_id, added_at) VALUES ($1, $2, $3)", [classroom.id, sam.id, new Date(now)]);
    for (const [i, member] of students.entries()) {
      await client.query(
        `INSERT INTO accounts (id, kind, display_name, email_verified, classroom_id, nickname, nickname_key, created_at)
         VALUES ($1, 'student', $2, true, $3, $2, $4, $5)`,
        [member.id, member.nickname, classroom.id, nicknameKey(member.nickname), new Date(now + i)]);
    }
    for (const project of projects) {
      await client.query(
        `INSERT INTO projects (id, owner_id, classroom_id, kind, name, revision, saved_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [project.id, project.ownerId, project.classroomId, project.kind, project.name, project.revision, project.savedAt]);
      for (let revision = 1; revision <= project.revision; revision++) {
        await client.query("INSERT INTO revisions (project_id, revision, object_key, saved_at) VALUES ($1, $2, $3, $4)",
          [project.id, revision, snapshotKey(project.id, revision), new Date(project.savedAt.getTime() - (project.revision - revision) * MINUTE_MS)]);
      }
    }
  });

  const files = projects.flatMap((project) => Array.from({ length: project.revision }, (_, i) =>
    ({ key: snapshotKey(project.id, i + 1), body: Buffer.from(JSON.stringify(project.snapshot)) })));
  const storageSeeded = await resetStorage(files);

  return {
    educator: dana, assistant: sam, personal: priya,
    classroom: { ...classroom, joinOpensAt: classroom.joinOpensAt.toISOString(), joinClosesAt: classroom.joinClosesAt.toISOString(), handInAt: classroom.handInAt.toISOString() },
    students,
    projects: projects.map(({ id, ownerId, kind, name, revision }) => ({ id, ownerId, kind, name, revision })),
    storageSeeded,
  };
}
