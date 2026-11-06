// Seed data (brief: Seed data). Inserted only when absent, under a lock shared by every serve instance.
import { randomBytes } from "node:crypto";
import type { Author, Role, Scope } from "../shared/api-types.js";
import { applyOperation, starterGraph, type Operation, type SceneNode, type Vec3 } from "../shared/graph.js";
import { hashPassword, secretHash } from "./auth.js";
import { config } from "./config.js";
import { one, pool, transaction, withAdvisoryLock } from "./db.js";
import { create, list, quote } from "./services/pocketbase.js";
import type pg from "pg";

const PASSWORD = "orrery-demo-2026";
const TRIAL_MS = 14 * 86_400_000;
const TOKEN_EXPIRY = new Date("2027-12-31T00:00:00Z");

interface SeedWorkspace {
  id: string; name: string; timeZone: string; signingSecret: string;
  members: { id: string; name: string; email: string; role: Role }[];
  tokens: { id: string; name: string; scope: Scope; secret: string; issuedBy: { id: string; name: string } }[];
  scenes: { id: string; name: string; ops: { author: Author; op: Operation }[] }[];
}

const mesh = (id: string, name: string, primitive: SceneNode["primitive"], fields: Partial<SceneNode> = {}): SceneNode => ({
  id, name, kind: "mesh", parentId: "n_root", primitive, assetId: null, position: [0, 0, 0], rotation: [0, 0, 0],
  scale: [1, 1, 1], materialLayers: [], visible: true, ...fields,
});

const jun: Author = { kind: "member", id: "mem_jun", name: "Jun Okafor" };
const sol: Author = { kind: "member", id: "mem_sol", name: "Sol Navarro" };
const poser: Author = { kind: "agent", id: "tok_kestrel_poser", name: "Catalogue poser" };
const lena: Author = { kind: "member", id: "mem_lena", name: "Lena Moss" };
const cup: Vec3 = [0.45, 0.45, 0.2];

const WORKSPACES: SeedWorkspace[] = [
  {
    id: "ws_kestrel", name: "Kestrel Audio", timeZone: "Europe/Berlin", signingSecret: "whsec_kestrel_4c1e9a7b20d35f86",
    members: [
      { id: "mem_mara", name: "Mara Lindqvist", email: "mara@kestrel.test", role: "owner" },
      { id: "mem_theo", name: "Theo Brandt", email: "theo@kestrel.test", role: "admin" },
      { id: "mem_priya", name: "Priya Raman", email: "priya@kestrel.test", role: "billing_manager" },
      { id: "mem_jun", name: "Jun Okafor", email: "jun@kestrel.test", role: "editor" },
      { id: "mem_sol", name: "Sol Navarro", email: "sol@kestrel.test", role: "editor" },
      { id: "mem_ines", name: "Ines Duarte", email: "ines@kestrel.test", role: "viewer" },
    ],
    tokens: [
      { id: "tok_kestrel_poser", name: "Catalogue poser", scope: "edit", secret: "orr_kestrelposer3f9a1c7e5b2d4a6081c9e7f2ab", issuedBy: { id: "mem_theo", name: "Theo Brandt" } },
      { id: "tok_kestrel_qa", name: "Framing QA", scope: "read", secret: "orr_kestrelframingqa8b2e4d6f1a3c5e7092b4cd", issuedBy: { id: "mem_theo", name: "Theo Brandt" } },
    ],
    scenes: [
      {
        id: "sc_arc_one", name: "Arc One headphones",
        ops: [
          { author: jun, op: { type: "node.add", payload: { node: mesh("n_headband", "Headband", "cylinder", { position: [0, 0.8, 0], rotation: [0, 0, 90], scale: [0.1, 1.2, 0.1] }) } } },
          { author: jun, op: { type: "node.add", payload: { node: mesh("n_cup_l", "Left cup", "sphere", { scale: cup }) } } },
          { author: jun, op: { type: "node.add", payload: { node: mesh("n_cup_r", "Right cup", "sphere", { scale: cup }) } } },
          { author: poser, op: { type: "transform.set", payload: { id: "n_cup_l", position: [-0.6, 0, 0] } } },
          { author: poser, op: { type: "transform.set", payload: { id: "n_cup_r", position: [0.6, 0, 0] } } },
          { author: sol, op: { type: "material.layer.add", payload: { id: "n_headband", layer: { id: "l_band_base", type: "base", color: [0.12, 0.12, 0.11], roughness: 0.6, metalness: 0.1 } } } },
          { author: sol, op: { type: "state.add", payload: { state: { id: "st_hover", name: "Hover" } } } },
          { author: sol, op: { type: "state.override.set", payload: { stateId: "st_hover", nodeId: "n_cup_l", field: "rotation", value: [0, 15, 0] } } },
          { author: sol, op: { type: "transition.set", payload: { from: "rest", to: "st_hover", trigger: "hover", durationMs: 420 } } },
        ],
      },
      { id: "sc_arc_case", name: "Arc One case", ops: [] },
    ],
  },
  {
    id: "ws_fernhall", name: "Fernhall Furniture", timeZone: "America/Chicago", signingSecret: "whsec_fernhall_9b2d6e1f73a04c58",
    members: [
      { id: "mem_ezra", name: "Ezra Cole", email: "ezra@fernhall.test", role: "owner" },
      { id: "mem_lena", name: "Lena Moss", email: "lena@fernhall.test", role: "editor" },
      { id: "mem_ravi", name: "Ravi Shah", email: "ravi@fernhall.test", role: "viewer" },
    ],
    tokens: [{ id: "tok_fernhall_poser", name: "Fernhall poser", scope: "edit", secret: "orr_fernhallposer6d1f3b5a7c9e2b4d608a1fde", issuedBy: { id: "mem_ezra", name: "Ezra Cole" } }],
    scenes: [
      { id: "sc_lowback", name: "Lowback lounge chair", ops: [{ author: lena, op: { type: "node.add", payload: { node: mesh("n_seat", "Seat", "box", { scale: [1, 0.3, 1] }) } } }] },
    ],
  },
];

const SEED_COMMENTS = [
  { workspace: "ws_kestrel", scene: "sc_arc_one", commentId: "cmt_kestrel_band", node: "n_headband", body: "Can the band read more matte in Hover?", authorId: "mem_ines", authorName: "Ines Duarte" },
  { workspace: "ws_fernhall", scene: "sc_lowback", commentId: "cmt_fernhall_seat", node: "n_seat", body: "Seat cushion looks too tall.", authorId: "mem_ravi", authorName: "Ravi Shah" },
];

async function seedWorkspace(client: pg.PoolClient, ws: SeedWorkspace, now: Date, passwordHash: string): Promise<void> {
  await client.query("INSERT INTO workspaces (id, name, time_zone, signing_secret, created_at) VALUES ($1, $2, $3, $4, $5)",
    [ws.id, ws.name, ws.timeZone, ws.signingSecret, now]);
  await client.query("INSERT INTO subscriptions (workspace_id, state, plan, period, trial_ends_at) VALUES ($1, 'trial', 'team', 'monthly', $2)",
    [ws.id, new Date(now.getTime() + TRIAL_MS)]);
  for (const m of ws.members) {
    await client.query("INSERT INTO members (id, workspace_id, name, email, password_hash, role, joined_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [m.id, ws.id, m.name, m.email, passwordHash, m.role, now]);
  }
  for (const t of ws.tokens) {
    await client.query(
      `INSERT INTO agent_tokens (id, workspace_id, name, scope, secret_hash, expires_at, issued_by_id, issued_by_name, created_at, warn_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [t.id, ws.id, t.name, t.scope, secretHash(t.secret), TOKEN_EXPIRY, t.issuedBy.id, t.issuedBy.name, now,
        new Date(TOKEN_EXPIRY.getTime() - config.tokenWarningLeadSeconds * 1000)]);
  }
  for (const scene of ws.scenes) {
    const base = starterGraph();
    const graph = structuredClone(base);
    const rowsToInsert = scene.ops.map(({ author, op }, i) => {
      const applied = applyOperation(graph, op);
      if (!applied.ok) throw new Error(`seed operation ${i + 1} of ${scene.id} does not apply: ${applied.message}`);
      return [scene.id, i + 1, `b_seed_${scene.id}_${i + 1}`, op.type, JSON.stringify(op.payload), JSON.stringify(applied.inverse), author.kind, author.id, author.name, now];
    });
    await client.query("INSERT INTO scenes (id, workspace_id, name, base_graph, graph, latest_seq, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
      [scene.id, ws.id, scene.name, JSON.stringify(base), JSON.stringify(graph), scene.ops.length, now]);
    for (const values of rowsToInsert) {
      await client.query(
        "INSERT INTO ops (scene_id, seq, batch_id, type, payload, inverse, author_kind, author_id, author_name, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        values);
    }
  }
}

export async function seed(): Promise<void> {
  await withAdvisoryLock("orrery:seed", async () => {
    if (await one(pool, "SELECT 1 FROM workspaces WHERE id = 'ws_kestrel'")) return;
    const passwordHash = await hashPassword(PASSWORD);
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    await transaction(async (client) => {
      for (const ws of WORKSPACES) await seedWorkspace(client, ws, now, passwordHash);
      await client.query(
        `INSERT INTO invites (id, workspace_id, email, role, token_hash, invited_by_kind, invited_by_id, invited_by_name, created_at, expires_at)
         VALUES ('inv_kestrel_ada', 'ws_kestrel', 'ada.kim@kestrel.test', 'viewer', $1, 'member', 'mem_theo', 'Theo Brandt', $2, $3)`,
        [secretHash(randomBytes(32).toString("base64url")), now, new Date(now.getTime() + 7 * 86_400_000)]);
    });
  });
}

/** The seeded comment threads live in PocketBase; added once it is reachable. */
export async function seedComments(): Promise<void> {
  for (const comment of SEED_COMMENTS) {
    const existing = await list("comments", `commentId=${quote(comment.commentId)}`);
    if (existing.length === 0) await create("comments", { ...comment, mentions: [], resolved: false });
  }
}
