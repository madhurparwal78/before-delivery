import { PoolClient } from 'pg';
import { Graph } from '../../shared/graph';
import { RawOp, applyOp } from '../../shared/ops';
import { SEED_TRIAL_SECONDS } from '../config';
import { addSeconds, tokenWarningAt } from '../domain/time';
import { startingGraph } from '../http/routes/scenes';
import { hashPassword, sha256Hex, urlSafeToken } from '../util/crypto';
import { transaction } from './pool';

const SEED_PASSWORD = 'orrery-demo-2026';

interface SeedMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'billing_manager' | 'editor' | 'viewer';
}

interface SeedOp {
  authorKind: 'member' | 'agent';
  authorId: string;
  authorName: string;
  op: RawOp;
}

const KESTREL_MEMBERS: SeedMember[] = [
  { id: 'mem_mara', name: 'Mara Lindqvist', email: 'mara@kestrel.test', role: 'owner' },
  { id: 'mem_theo', name: 'Theo Brandt', email: 'theo@kestrel.test', role: 'admin' },
  { id: 'mem_priya', name: 'Priya Raman', email: 'priya@kestrel.test', role: 'billing_manager' },
  { id: 'mem_jun', name: 'Jun Okafor', email: 'jun@kestrel.test', role: 'editor' },
  { id: 'mem_sol', name: 'Sol Navarro', email: 'sol@kestrel.test', role: 'editor' },
  { id: 'mem_ines', name: 'Ines Duarte', email: 'ines@kestrel.test', role: 'viewer' },
];

const FERNHALL_MEMBERS: SeedMember[] = [
  { id: 'mem_ezra', name: 'Ezra Cole', email: 'ezra@fernhall.test', role: 'owner' },
  { id: 'mem_lena', name: 'Lena Moss', email: 'lena@fernhall.test', role: 'editor' },
  { id: 'mem_ravi', name: 'Ravi Shah', email: 'ravi@fernhall.test', role: 'viewer' },
];

function arcOneOps(): SeedOp[] {
  const jun = { authorKind: 'member' as const, authorId: 'mem_jun', authorName: 'Jun Okafor' };
  const sol = { authorKind: 'member' as const, authorId: 'mem_sol', authorName: 'Sol Navarro' };
  const poser = {
    authorKind: 'agent' as const,
    authorId: 'tok_kestrel_poser',
    authorName: 'Catalogue poser',
  };
  return [
    {
      ...jun,
      op: {
        type: 'node.add',
        payload: {
          node: {
            id: 'n_headband',
            name: 'Headband',
            kind: 'mesh',
            parentId: 'n_root',
            primitive: 'cylinder',
            assetId: null,
            position: [0, 0.8, 0],
            rotation: [0, 0, 90],
            scale: [0.1, 1.2, 0.1],
            materialLayers: [],
            visible: true,
          },
        },
      },
    },
    {
      ...jun,
      op: {
        type: 'node.add',
        payload: {
          node: {
            id: 'n_cup_l',
            name: 'Left cup',
            kind: 'mesh',
            parentId: 'n_root',
            primitive: 'sphere',
            assetId: null,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [0.45, 0.45, 0.2],
            materialLayers: [],
            visible: true,
          },
        },
      },
    },
    {
      ...jun,
      op: {
        type: 'node.add',
        payload: {
          node: {
            id: 'n_cup_r',
            name: 'Right cup',
            kind: 'mesh',
            parentId: 'n_root',
            primitive: 'sphere',
            assetId: null,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [0.45, 0.45, 0.2],
            materialLayers: [],
            visible: true,
          },
        },
      },
    },
    { ...poser, op: { type: 'transform.set', payload: { id: 'n_cup_l', position: [-0.6, 0, 0] } } },
    { ...poser, op: { type: 'transform.set', payload: { id: 'n_cup_r', position: [0.6, 0, 0] } } },
    {
      ...sol,
      op: {
        type: 'material.layer.add',
        payload: {
          id: 'n_headband',
          layer: {
            id: 'l_band_base',
            type: 'base',
            color: [0.12, 0.12, 0.11],
            roughness: 0.6,
            metalness: 0.1,
          },
        },
      },
    },
    { ...sol, op: { type: 'state.add', payload: { state: { id: 'st_hover', name: 'Hover' } } } },
    {
      ...sol,
      op: {
        type: 'state.override.set',
        payload: { stateId: 'st_hover', nodeId: 'n_cup_l', field: 'rotation', value: [0, 15, 0] },
      },
    },
    {
      ...sol,
      op: {
        type: 'transition.set',
        payload: { from: 'rest', to: 'st_hover', trigger: 'hover', durationMs: 420 },
      },
    },
  ];
}

function lowbackOps(): SeedOp[] {
  return [
    {
      authorKind: 'member',
      authorId: 'mem_lena',
      authorName: 'Lena Moss',
      op: {
        type: 'node.add',
        payload: {
          node: {
            id: 'n_seat',
            name: 'Seat',
            kind: 'mesh',
            parentId: 'n_root',
            primitive: 'box',
            assetId: null,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 0.3, 1],
            materialLayers: [],
            visible: true,
          },
        },
      },
    },
  ];
}

async function seedWorkspace(
  client: PoolClient,
  workspace: {
    id: string;
    name: string;
    timeZone: string;
    signingSecret: string;
    members: SeedMember[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO workspaces (id, name, time_zone, review_links_enabled, signing_secret)
     VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (id) DO NOTHING`,
    [workspace.id, workspace.name, workspace.timeZone, workspace.signingSecret],
  );
  const passwordHash = hashPassword(SEED_PASSWORD);
  for (const member of workspace.members) {
    await client.query(
      `INSERT INTO members (id, workspace_id, name, email, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [member.id, workspace.id, member.name, member.email, member.role, passwordHash],
    );
  }
  await client.query(
    `INSERT INTO subscriptions (workspace_id, state, plan, period, extra_seats, trial_ends_at)
     VALUES ($1, 'trial', 'team', 'monthly', 0, $2)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [workspace.id, addSeconds(new Date(), SEED_TRIAL_SECONDS)],
  );
}

async function seedScene(
  client: PoolClient,
  scene: { id: string; workspaceId: string; name: string; ops: SeedOp[] },
): Promise<void> {
  const existing = await client.query<{ id: string }>(`SELECT id FROM scenes WHERE id = $1`, [
    scene.id,
  ]);
  if (existing.rows.length > 0) return;
  const base = startingGraph();
  await client.query(
    `INSERT INTO scenes (id, workspace_id, name, base_graph, latest_seq)
     VALUES ($1, $2, $3, $4::jsonb, 0)`,
    [scene.id, scene.workspaceId, scene.name, JSON.stringify(base)],
  );
  const graph: Graph = base;
  let seq = 0;
  for (const entry of scene.ops) {
    const inverse = applyOp(graph, entry.op, `ops[${seq}]`, { modelAssetIds: new Set() });
    seq += 1;
    await client.query(
      `INSERT INTO ops (scene_id, seq, batch_id, type, payload, inverse, author_kind, author_id, author_name)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)`,
      [
        scene.id,
        seq,
        `batch_seed_${scene.id}_${seq}`,
        entry.op.type,
        JSON.stringify(entry.op.payload),
        JSON.stringify(inverse),
        entry.authorKind,
        entry.authorId,
        entry.authorName,
      ],
    );
  }
  await client.query(`UPDATE scenes SET latest_seq = $2 WHERE id = $1`, [scene.id, seq]);
}

export async function applySeed(): Promise<void> {
  await transaction(async (client) => {
    await seedWorkspace(client, {
      id: 'ws_kestrel',
      name: 'Kestrel Audio',
      timeZone: 'Europe/Berlin',
      signingSecret: 'whsec_kestrel_4c1e9a7b20d35f86',
      members: KESTREL_MEMBERS,
    });
    await seedWorkspace(client, {
      id: 'ws_fernhall',
      name: 'Fernhall Furniture',
      timeZone: 'America/Chicago',
      signingSecret: 'whsec_fernhall_9b2d6e1f73a04c58',
      members: FERNHALL_MEMBERS,
    });

    await client.query(
      `INSERT INTO invitations (id, workspace_id, email, role, token_sha256, invited_by_id, invited_by_name, expires_at)
       VALUES ($1, 'ws_kestrel', 'ada.kim@kestrel.test', 'viewer', $2, 'mem_theo', 'Theo Brandt', $3)
       ON CONFLICT (id) DO NOTHING`,
      [
        'inv_kestrel_ada',
        sha256Hex(`seed-invite-${urlSafeToken(16)}`),
        addSeconds(new Date(), 7 * 86_400),
      ],
    );

    const tokens = [
      {
        id: 'tok_kestrel_poser',
        workspaceId: 'ws_kestrel',
        name: 'Catalogue poser',
        scope: 'edit',
        secret: 'orr_kestrelposer3f9a1c7e5b2d4a6081c9e7f2ab',
        issuedById: 'mem_theo',
        issuedByName: 'Theo Brandt',
      },
      {
        id: 'tok_kestrel_qa',
        workspaceId: 'ws_kestrel',
        name: 'Framing QA',
        scope: 'read',
        secret: 'orr_kestrelframingqa8b2e4d6f1a3c5e7092b4cd',
        issuedById: 'mem_theo',
        issuedByName: 'Theo Brandt',
      },
      {
        id: 'tok_fernhall_poser',
        workspaceId: 'ws_fernhall',
        name: 'Fernhall poser',
        scope: 'edit',
        secret: 'orr_fernhallposer6d1f3b5a7c9e2b4d608a1fde',
        issuedById: 'mem_ezra',
        issuedByName: 'Ezra Cole',
      },
    ];
    for (const token of tokens) {
      await client.query(
        `INSERT INTO agent_tokens (id, workspace_id, name, scope, secret_sha256, expires_at,
                                   warn_at, issued_by_id, issued_by_name)
         VALUES ($1, $2, $3, $4, $5, '2027-12-31T00:00:00Z', $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          token.id,
          token.workspaceId,
          token.name,
          token.scope,
          sha256Hex(token.secret),
          tokenWarningAt(new Date('2027-12-31T00:00:00Z')),
          token.issuedById,
          token.issuedByName,
        ],
      );
    }

    await seedScene(client, {
      id: 'sc_arc_one',
      workspaceId: 'ws_kestrel',
      name: 'Arc One headphones',
      ops: arcOneOps(),
    });
    await seedScene(client, {
      id: 'sc_arc_case',
      workspaceId: 'ws_kestrel',
      name: 'Arc One case',
      ops: [],
    });
    await seedScene(client, {
      id: 'sc_lowback',
      workspaceId: 'ws_fernhall',
      name: 'Lowback lounge chair',
      ops: lowbackOps(),
    });

    await client.query(
      `INSERT INTO comments (id, workspace_id, scene_id, node_id, body, author_kind, author_id, author_name, mentions, resolved)
       VALUES ('cmt_kestrel_band', 'ws_kestrel', 'sc_arc_one', 'n_headband',
               'Can the band read more matte in Hover?', 'member', 'mem_ines', 'Ines Duarte', '[]'::jsonb, false)
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO comments (id, workspace_id, scene_id, node_id, body, author_kind, author_id, author_name, mentions, resolved)
       VALUES ('cmt_fernhall_seat', 'ws_fernhall', 'sc_lowback', 'n_seat',
               'Seat cushion looks too tall.', 'member', 'mem_ravi', 'Ravi Shah', '[]'::jsonb, false)
       ON CONFLICT (id) DO NOTHING`,
    );
  });
}
