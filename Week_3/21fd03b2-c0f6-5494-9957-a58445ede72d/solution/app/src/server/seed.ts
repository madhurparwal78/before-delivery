import { SOLVER, canonicalDocument, newObject, type SceneDocument, type SceneObject } from "../shared/doc";
import { GRAVITY_DEF } from "../shared/params";
import { initialHash } from "../shared/sim";
import { hashPassword } from "./auth";
import { tx } from "./db";
import { newId } from "./ids";

const ACCOUNTS = [
  { key: "ines", name: "Ines Okafor", email: "ines@okafor-physics.example", password: "ines-bench-2026" },
  { key: "tomas", name: "Tomas Reyes", email: "tomas@okafor-physics.example", password: "tomas-bench-2026" },
  { key: "priya", name: "Priya Lund", email: "priya@lund-family.example", password: "priya-bench-2026" },
  { key: "dana", name: "Dana Whitcombe", email: "dana@whitcombe-tutoring.example", password: "dana-bench-2026" },
] as const;

function rig(kind: "ramp" | "pendulum" | "launcher" | "crate", id: string, name: string, params: Record<string, number>, position: [number, number, number], scale: [number, number, number] = [1, 1, 1]): SceneObject {
  return { ...newObject(kind, id, name, position), params, scale };
}

const scene = (name: string, objects: SceneObject[]): SceneDocument => ({ gravity: GRAVITY_DEF.default, name, objects, solver: { ...SOLVER } });

const FORCES_SCENES: SceneDocument[] = [
  scene("Slope trial", [
    rig("ramp", "ramp-1", "Ramp A", { mass_kg: 2, angle_deg: 30, length_m: 4, friction: 0 }, [0, 0, 0]),
    rig("crate", "crate-1", "Stop block", { mass_kg: 5 }, [4, 0, 0], [0.5, 0.5, 0.5]),
    rig("crate", "cart-1", "Cart 1", { mass_kg: 1 }, [-2, 0, 0], [0.4, 0.3, 0.25]),
  ]),
  scene("Pendulum clock", [rig("pendulum", "pendulum-1", "Clock bob", { mass_kg: 0.5, length_m: 1, release_deg: 20 }, [0, 2, 0])]),
  scene("Ball launcher", [rig("launcher", "launcher-1", "Launcher", { mass_kg: 0.2, speed_mps: 5, launch_angle_deg: 45, height_m: 1 }, [0, 0, 0])]),
];

const SEED_LOCK = 7351002;

/** Creates the seeded records only when the seeded accounts are missing; parallel instances produce one copy. */
export async function seed(): Promise<void> {
  const hashes = await Promise.all(ACCOUNTS.map((a) => hashPassword(a.password)));
  await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [SEED_LOCK]);
    const existing = await db.query("SELECT 1 FROM users WHERE email_key = $1", [ACCOUNTS[0].email]);
    if (existing.rowCount) return;
    const t0 = Date.now() - 3600_000;
    const at = (seconds: number): Date => new Date(t0 + seconds * 1000);
    const users: Record<string, string> = {};
    for (const [i, account] of ACCOUNTS.entries()) {
      users[account.key] = newId();
      await db.query("INSERT INTO users (id, email, email_key, display_name, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6)", [users[account.key], account.email, account.email, account.name, hashes[i], at(0)]);
    }
    const workspace = async (name: string, owner: string, joined: number): Promise<string> => {
      const id = newId();
      await db.query("INSERT INTO workspaces (id, name, owner_id, created_at) VALUES ($1,$2,$3,$4)", [id, name, owner, at(joined)]);
      await db.query("INSERT INTO memberships (workspace_id, user_id, role, joined_at) VALUES ($1,$2,'owner',$3)", [id, owner, at(joined)]);
      return id;
    };
    const okafor = await workspace("Okafor Physics Bench", users.ines, 1);
    const coop = await workspace("Saturday Co-op Lab", users.ines, 2);
    const whitcombe = await workspace("Whitcombe Tutoring", users.dana, 1);
    await db.query("INSERT INTO memberships (workspace_id, user_id, role, joined_at) VALUES ($1,$2,'editor',$3), ($1,$4,'viewer',$3)", [okafor, users.tomas, at(3), users.priya]);
    await db.query("UPDATE users SET last_workspace_id = $2 WHERE id = $1", [users.ines, okafor]);
    void coop;
    const project = async (workspaceId: string, name: string, scenes: SceneDocument[]): Promise<void> => {
      const projectId = newId();
      await db.query("INSERT INTO projects (id, workspace_id, name, created_at, updated_at) VALUES ($1,$2,$3,$4,$4)", [projectId, workspaceId, name, at(10)]);
      for (const [i, doc] of scenes.entries()) {
        const sceneId = newId();
        const stateHash = initialHash(doc);
        await db.query("INSERT INTO scenes (id, project_id, workspace_id, name, status, revision, state_hash, created_at) VALUES ($1,$2,$3,$4,'draft',1,$5,$6)", [sceneId, projectId, workspaceId, doc.name, stateHash, at(11 + i)]);
        await db.query("INSERT INTO scene_revisions (scene_id, revision, document, ops, state_hash, kind, created_at) VALUES ($1,1,$2,'[]',$3,'create',$4)", [sceneId, canonicalDocument(doc), stateHash, at(11 + i)]);
      }
    };
    await project(okafor, "Forces and Motion", FORCES_SCENES);
    await project(whitcombe, "Private notes", [scene("Incline notes", [])]);
  });
}
