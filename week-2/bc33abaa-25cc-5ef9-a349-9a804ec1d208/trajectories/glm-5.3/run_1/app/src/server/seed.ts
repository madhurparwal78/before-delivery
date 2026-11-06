import { query, pool } from "./db";
import { hashPassword, hashToken } from "./auth";
import type { Graph, Node } from "../shared/graph-types";
import { applyOp, type OpIn } from "./ops";
import { cloneGraph } from "../shared/graph";

const SEED_PASSWORD = "orrery-demo-2026";

interface SeedOp {
  authorId: string;
  authorName: string;
  authorKind: "member" | "agent";
  createdAt: Date;
  op: OpIn;
}

function baseNode(id: string, name: string, kind: Node["kind"], parentId: string | null, extra: Partial<Node> = {}): Node {
  return {
    id,
    name,
    kind,
    parentId,
    primitive: null,
    assetId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    materialLayers: [],
    visible: true,
    ...extra,
  };
}

function starterGraph(): Graph {
  const root = baseNode("n_root", "Scene", "group", null);
  const camera = baseNode("n_cam", "Main camera", "camera", "n_root", { position: [0, 1.2, 4], rotation: [-15, 0, 0] });
  const light = baseNode("n_key", "Key light", "light", "n_root", { position: [2, 3, 2] });
  return { nodes: [root, camera, light], states: [{ id: "rest", name: "Rest", overrides: [] }], transitions: [], cameraViews: [] };
}

const kestrelOps: SeedOp[] = [
  {
    authorId: "mem_jun", authorName: "Jun Okafor", authorKind: "member", createdAt: new Date(Date.now() - 8 * 3600 * 1000),
    op: {
      type: "node.add",
      payload: {
        node: baseNode("n_headband", "Headband", "mesh", "n_root", { primitive: "cylinder", position: [0, 0.8, 0], rotation: [0, 0, 90], scale: [0.1, 1.2, 0.1] }),
      },
    },
  },
  {
    authorId: "mem_jun", authorName: "Jun Okafor", authorKind: "member", createdAt: new Date(Date.now() - 8 * 3600 * 1000 + 40_000),
    op: { type: "node.add", payload: { node: baseNode("n_cup_l", "Left cup", "mesh", "n_root", { primitive: "sphere", scale: [0.45, 0.45, 0.2] }) } },
  },
  {
    authorId: "mem_jun", authorName: "Jun Okafor", authorKind: "member", createdAt: new Date(Date.now() - 8 * 3600 * 1000 + 80_000),
    op: { type: "node.add", payload: { node: baseNode("n_cup_r", "Right cup", "mesh", "n_root", { primitive: "sphere", scale: [0.45, 0.45, 0.2] }) } },
  },
  {
    authorId: "tok_kestrel_poser", authorName: "Catalogue poser", authorKind: "agent", createdAt: new Date(Date.now() - 8 * 3600 * 1000 + 120_000),
    op: { type: "transform.set", payload: { id: "n_cup_l", position: [-0.6, 0, 0] } },
  },
  {
    authorId: "tok_kestrel_poser", authorName: "Catalogue poser", authorKind: "agent", createdAt: new Date(Date.now() - 8 * 3600 * 1000 + 160_000),
    op: { type: "transform.set", payload: { id: "n_cup_r", position: [0.6, 0, 0] } },
  },
  {
    authorId: "mem_sol", authorName: "Sol Navarro", authorKind: "member", createdAt: new Date(Date.now() - 8 * 3600 * 1000 + 200_000),
    op: {
      type: "material.layer.add",
      payload: {
        id: "n_headband",
        layer: { id: "l_band_base", type: "base", color: [0.12, 0.12, 0.11], roughness: 0.6, metalness: 0.1 },
      },
    },
  },
  {
    authorId: "mem_sol", authorName: "Sol Navarro", authorKind: "member", createdAt: new Date(Date.now() - 8 * 3600 * 1000 + 240_000),
    op: { type: "state.add", payload: { state: { id: "st_hover", name: "Hover" } } },
  },
  {
    authorId: "mem_sol", authorName: "Sol Navarro", authorKind: "member", createdAt: new Date(Date.now() - 8 * 3600 * 1000 + 280_000),
    op: { type: "state.override.set", payload: { stateId: "st_hover", nodeId: "n_cup_l", field: "rotation", value: [0, 15, 0] } },
  },
  {
    authorId: "mem_sol", authorName: "Sol Navarro", authorKind: "member", createdAt: new Date(Date.now() - 8 * 3600 * 1000 + 320_000),
    op: { type: "transition.set", payload: { from: "rest", to: "st_hover", trigger: "hover", durationMs: 420 } },
  },
];

const fernhallOps: SeedOp[] = [
  {
    authorId: "mem_lena", authorName: "Lena Moss", authorKind: "member", createdAt: new Date(Date.now() - 5 * 3600 * 1000),
    op: { type: "node.add", payload: { node: baseNode("n_seat", "Seat", "mesh", "n_root", { primitive: "box", scale: [1, 0.3, 1] }) } },
  },
];

async function insertSceneWithOps(sceneId: string, workspaceId: string, name: string, ops: SeedOp[]): Promise<void> {
  const graph = starterGraph();
  const assetIds = new Set<string>();
  const prepared: { seq: number; batchId: string; op: OpIn; inverse: { type: string; payload: Record<string, unknown> }; author: SeedOp }[] = [];
  for (let i = 0; i < ops.length; i++) {
    const seedOp = ops[i]!;
    const result = applyOp(cloneGraph(graph), seedOp.op, assetIds);
    if (!result.ok) throw new Error(`Seed op ${i} for ${sceneId} failed: ${result.message}`);
    applyOp(graph, seedOp.op, assetIds);
    prepared.push({ seq: i + 1, batchId: `batch_seed_${sceneId}_${i}`, op: seedOp.op, inverse: result.inverse, author: seedOp });
  }
  await query("INSERT INTO scenes (id, workspace_id, name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING", [sceneId, workspaceId, name]);
  await query("INSERT INTO scene_bases (scene_id, graph) VALUES ($1,$2) ON CONFLICT (scene_id) DO NOTHING", [sceneId, JSON.stringify(graph)]);
  for (const p of prepared) {
    await query(
      `INSERT INTO ops (seq, batch_id, scene_id, type, payload, inverse, author_kind, author_id, author_name, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (scene_id, seq) DO NOTHING`,
      [p.seq, p.batchId, sceneId, p.op.type, JSON.stringify(p.op.payload), JSON.stringify(p.inverse), p.author.authorKind, p.author.authorId, p.author.authorName, p.author.createdAt],
    );
    if (p.author.authorKind !== "agent") {
      await query(
        "INSERT INTO author_batches (scene_id, author_key, batch_id, first_seq) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [sceneId, `member:${p.author.authorId}`, p.batchId, p.seq],
      );
    } else {
      await query(
        "INSERT INTO author_batches (scene_id, author_key, batch_id, first_seq) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [sceneId, `agent:${p.author.authorId}`, p.batchId, p.seq],
      );
    }
  }
}

export async function applySeed(): Promise<void> {
  const existing = await query("SELECT id FROM workspaces WHERE id = 'ws_kestrel'");
  if (existing.rows.length > 0) {
    // Refresh the trial window so a re-seeded environment still behaves, without duplicating rows.
    return;
  }
  const seededAt = new Date();
  const trialEnds = new Date(seededAt.getTime() + 14 * 24 * 3600 * 1000);
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Kestrel Audio
    await client.query("INSERT INTO workspaces (id, name, time_zone, gateway_secret, seeded_at) VALUES ('ws_kestrel','Kestrel Audio','Europe/Berlin','whsec_kestrel_4c1e9a7b20d35f86',$1)", [seededAt]);
    const kestrelMembers: [string, string, string, string][] = [
      ["mem_mara", "Mara Lindqvist", "mara@kestrel.test", "owner"],
      ["mem_theo", "Theo Brandt", "theo@kestrel.test", "admin"],
      ["mem_priya", "Priya Raman", "priya@kestrel.test", "billing_manager"],
      ["mem_jun", "Jun Okafor", "jun@kestrel.test", "editor"],
      ["mem_sol", "Sol Navarro", "sol@kestrel.test", "editor"],
      ["mem_ines", "Ines Duarte", "ines@kestrel.test", "viewer"],
    ];
    for (const [id, name, email, role] of kestrelMembers) {
      await client.query("INSERT INTO members (id, workspace_id, name, email, password_hash, role, joined_at) VALUES ($1,'ws_kestrel',$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING", [id, name, email, passwordHash, role, seededAt]);
    }
    await client.query(
      "INSERT INTO subscriptions (workspace_id, state, plan, period, seats_purchased, extra_seats, trial_ends_at) VALUES ('ws_kestrel','trial','team','monthly',8,0,$1)",
      [trialEnds],
    );
    await client.query(
      "INSERT INTO invites (id, workspace_id, email, role, token_hash, expires_at, invited_by) VALUES ('inv_kestrel_ada','ws_kestrel','ada.kim@kestrel.test','viewer',$1,$2,'mem_theo')",
      [hashToken("inv_seed_ada_kim_7c3d9e"), new Date(seededAt.getTime() + 7 * 24 * 3600 * 1000)],
    );
    const tokenExpiry = new Date("2027-12-31T00:00:00Z");
    await client.query(
      "INSERT INTO agent_tokens (id, workspace_id, name, scope, secret_hash, expires_at, issued_by, issued_at) VALUES ('tok_kestrel_poser','ws_kestrel','Catalogue poser','edit',$1,$2,'mem_theo',$3) ON CONFLICT (id) DO NOTHING",
      [hashToken("orr_kestrelposer3f9a1c7e5b2d4a6081c9e7f2ab"), tokenExpiry, seededAt],
    );
    await client.query(
      "INSERT INTO agent_tokens (id, workspace_id, name, scope, secret_hash, expires_at, issued_by, issued_at) VALUES ('tok_kestrel_qa','ws_kestrel','Framing QA','read',$1,$2,'mem_theo',$3) ON CONFLICT (id) DO NOTHING",
      [hashToken("orr_kestrelframingqa8b2e4d6f1a3c5e7092b4cd"), tokenExpiry, seededAt],
    );

    // Fernhall Furniture
    await client.query("INSERT INTO workspaces (id, name, time_zone, gateway_secret, seeded_at) VALUES ('ws_fernhall','Fernhall Furniture','America/Chicago','whsec_fernhall_9b2d6e1f73a04c58',$1)", [seededAt]);
    const fernhallMembers: [string, string, string, string][] = [
      ["mem_ezra", "Ezra Cole", "ezra@fernhall.test", "owner"],
      ["mem_lena", "Lena Moss", "lena@fernhall.test", "editor"],
      ["mem_ravi", "Ravi Shah", "ravi@fernhall.test", "viewer"],
    ];
    for (const [id, name, email, role] of fernhallMembers) {
      await client.query("INSERT INTO members (id, workspace_id, name, email, password_hash, role, joined_at) VALUES ($1,'ws_fernhall',$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING", [id, name, email, passwordHash, role, seededAt]);
    }
    await client.query(
      "INSERT INTO subscriptions (workspace_id, state, plan, period, seats_purchased, extra_seats, trial_ends_at) VALUES ('ws_fernhall','trial','team','monthly',8,0,$1)",
      [trialEnds],
    );
    await client.query(
      "INSERT INTO agent_tokens (id, workspace_id, name, scope, secret_hash, expires_at, issued_by, issued_at) VALUES ('tok_fernhall_poser','ws_fernhall','Fernhall poser','edit',$1,$2,'mem_ezra',$3) ON CONFLICT (id) DO NOTHING",
      [hashToken("orr_fernhallposer6d1f3b5a7c9e2b4d608a1fde"), tokenExpiry, seededAt],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  await insertSceneWithOps("sc_arc_one", "ws_kestrel", "Arc One headphones", kestrelOps);
  await insertSceneWithOps("sc_arc_case", "ws_kestrel", "Arc One case", []);
  await insertSceneWithOps("sc_lowback", "ws_fernhall", "Lowback lounge chair", fernhallOps);

  await query(
    "INSERT INTO comments (id, scene_id, node_id, body, author_id, author_kind, author_name, mentions, resolved) VALUES ('cmt_kestrel_band','sc_arc_one','n_headband','Can the band read more matte in Hover?','mem_ines','member','Ines Duarte','[]',FALSE) ON CONFLICT (id) DO NOTHING",
  );
  await query(
    "INSERT INTO comments (id, scene_id, node_id, body, author_id, author_kind, author_name, mentions, resolved) VALUES ('cmt_fernhall_seat','sc_lowback','n_seat','Seat cushion looks too tall.','mem_ravi','member','Ravi Shah','[]',FALSE) ON CONFLICT (id) DO NOTHING",
  );
}
