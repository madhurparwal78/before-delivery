/** `POST /api/grading/seed`: exactly the brief's seed data, created at server time. */
import { MESSAGES } from '../shared/messages';
import { completeDocument, type DocumentDraft, type LayerDraft, type SceneDraft } from '../shared/document';
import type { JsonObject, Role, Variable } from '../shared/types';
import { uploadAsset } from './assets';
import { now } from './clock';
import { config } from './config';
import { pool, query, transaction } from './db';
import { insertDocument } from './documents';
import { newId, storageDown } from './http';
import { hashPassword } from './passwords';
import { publishVersion } from './versions';
import { createProject, emptyDocument } from './routes/projects';
import { grainPlatePng, swingGltf } from './seedFiles';
import { createSession } from './sessions';

interface Person {
  name: string;
  email: string;
  password: string;
}

const INES: Person = { name: 'Ines Okafor', email: 'ines@lumenyard.test', password: 'halation-ines-01' };
const MARA: Person = { name: 'Mara Lindqvist', email: 'mara@lumenyard.test', password: 'halation-mara-01' };
const TOMAS: Person = { name: 'Tomas Reyes', email: 'tomas@lumenyard.test', password: 'halation-tomas-01' };
const PAVEL: Person = { name: 'Pavel Duarte', email: 'pavel@quarryhall.test', password: 'halation-pavel-01' };

interface ProjectPlan {
  name: string;
  workspace: string;
  owner: Person;
  members: [Person, Exclude<Role, 'Owner'>][];
  files: string[];
  publish: boolean;
  build: (assets: Record<string, string>) => DocumentDraft;
}

const lumenYardMembers = (...except: Person[]): [Person, Exclude<Role, 'Owner'>][] =>
  ([[MARA, 'Editor'], [TOMAS, 'Viewer']] as [Person, Exclude<Role, 'Owner'>][]).filter(([person]) => !except.includes(person));

/** Layers listed bottom to top; `order` is their index. */
function stack(layers: Omit<LayerDraft, 'id' | 'order'>[]): LayerDraft[] {
  return layers.map((layer, order) => ({ ...layer, id: newId('l'), order }));
}

const scene = (name: string, layers: Omit<LayerDraft, 'id' | 'order'>[], extra: Partial<SceneDraft> = {}): SceneDraft => ({
  id: newId('s'),
  name,
  layers: stack(layers),
  ...extra,
});

const cube = (name: string, props: JsonObject = {}, extra: Partial<LayerDraft> = {}): Omit<LayerDraft, 'id' | 'order'> => ({
  name,
  kind: 'Primitive',
  props: { primitive: 'Cube', ...props },
  ...extra,
});

const TILT = { tilt: { enabled: true, maxTilt: 12, sensitivity: 1, momentum: 1 } };
const SWING_CLIPS = (loopTurn: boolean): JsonObject[] => [
  { name: 'Turn', play: true, loop: loopTurn, speed: 1, offsetMs: 0 },
  { name: 'Hop', play: false, loop: false, speed: 1, offsetMs: 0 },
];

const PLANS: ProjectPlan[] = [
  {
    name: 'Lumen hero',
    workspace: 'Lumen Yard',
    owner: INES,
    members: lumenYardMembers(),
    files: ['swing.gltf'],
    publish: false,
    build: (assets) => ({
      name: 'Lumen hero',
      scenes: [
        scene('Main', [
          cube(
            'Halo cube',
            {
              position: { x: 1, y: 2, z: 0 },
              rotation: { x: 0, y: 45, z: 0 },
              scale: { x: 2, y: 1, z: 1 },
              material: { kind: 'Matcap', matcap: 'Clay' },
            },
            {
              events: { ...TILT, appear: { enabled: true, durationMs: 600, delayMs: 0, easing: 'glide', from: { 'material.opacity': 0 } } },
              overrides: { tablet: { 'rotation.y': 30 }, mobile: {} },
            },
          ),
          { name: 'Pebble', kind: 'Model', props: { preset: 'Pebble', position: { x: -2, y: 0, z: 0 } } },
          { name: 'Swing', kind: 'Model', props: { modelAssetId: assets['swing.gltf'] as string, clips: SWING_CLIPS(true) } },
          { name: 'Sparks', kind: 'Particles', props: { seed: 7, rate: 60, burst: 0, lifetime: 2, speed: 2, gravity: 9.8 } },
        ]),
      ],
    }),
  },
  {
    name: 'Orbit study',
    workspace: 'Lumen Yard',
    owner: INES,
    members: lumenYardMembers(MARA),
    files: [],
    publish: false,
    build: () => ({
      name: 'Orbit study',
      scenes: [
        scene(
          'Main',
          [
            cube('Probe', { primitive: 'Sphere', position: { x: 1, y: 2, z: 0 } }, { events: TILT }),
            { name: 'Arch', kind: 'Model', props: { preset: 'Arch', position: { x: -2, y: 0, z: 0 } } },
          ],
          { orbit: { enabled: true, startAngle: 0, endAngle: 90 }, light: { enabled: true, sensitivity: 1, momentum: 1 } },
        ),
      ],
    }),
  },
  {
    name: 'Logo forge',
    workspace: 'Lumen Yard',
    owner: INES,
    members: lumenYardMembers(),
    files: [],
    publish: false,
    build: () => {
      const wordmark = newId('l');
      const layers: LayerDraft[] = [
        {
          id: wordmark,
          order: 0,
          name: 'Wordmark',
          kind: 'Extrusion',
          props: { source: 'text', text: 'HALO', letterHeight: 1, depth: 0.2, bevelSize: 0.02, bevelSegments: 1 },
        },
        {
          id: newId('l'),
          order: 1,
          name: 'Swarm',
          kind: 'Particles',
          props: { seed: 7, burst: 3, rate: 30, speed: 2, gravity: 9.8, lifetime: 0.5, orbit: 90, attractor: { x: 0, y: 1, z: 0, strength: 4 } },
        },
        {
          id: newId('l'),
          order: 2,
          name: 'Drift',
          kind: 'Particles',
          props: { seed: 7, burst: 3, rate: 0, speed: 2, gravity: 9.8, lifetime: 2, trailLength: 8 },
        },
        {
          id: newId('l'),
          order: 3,
          name: 'Formation',
          kind: 'Particles',
          props: { mode: 'form', seed: 7, formation: { target: wordmark, count: 32, durationMs: 1500 } },
        },
      ];
      return { name: 'Logo forge', scenes: [{ id: newId('s'), name: 'Main', layers }] };
    },
  },
  {
    name: 'Model bay',
    workspace: 'Lumen Yard',
    owner: INES,
    members: lumenYardMembers(),
    files: ['swing.gltf', 'grain-plate.png'],
    publish: true,
    build: (assets) => ({
      name: 'Model bay',
      scenes: [
        scene('Main', [
          { name: 'Swing', kind: 'Model', props: { modelAssetId: assets['swing.gltf'] as string, clips: SWING_CLIPS(false) } },
          { name: 'Grain plate', kind: 'Image', props: { assetId: assets['grain-plate.png'] as string, width: 64, height: 64 } },
        ]),
      ],
    }),
  },
  {
    name: 'Banner test',
    workspace: 'Lumen Yard',
    owner: INES,
    members: lumenYardMembers(),
    files: [],
    publish: false,
    build: () => ({
      name: 'Banner test',
      scenes: [
        scene('Main', [{ name: 'Banner', kind: 'Cloth', props: { columns: 4, rows: 4, seed: 3, pinned: 'Top', windStrength: 2, windDirection: 0 } }]),
      ],
    }),
  },
  {
    name: 'Easing lab',
    workspace: 'Lumen Yard',
    owner: INES,
    members: lumenYardMembers(),
    files: [],
    publish: false,
    build: () => ({
      name: 'Easing lab',
      scenes: [
        scene('Main', [
          cube('Turner', {}, {
            keyframes: [
              { property: 'rotation.y', frame: 0, value: 0, easing: 'ease-out' },
              { property: 'rotation.y', frame: 60, value: 90, easing: 'linear' },
            ],
          }),
          cube('Blank'),
        ]),
      ],
    }),
  },
  {
    name: 'Variable room',
    workspace: 'Lumen Yard',
    owner: INES,
    members: lumenYardMembers(),
    files: [],
    publish: false,
    build: () => {
      const variables: Variable[] = [
        { name: 'spin', type: 'Vector 3', value: { x: 0, y: 45, z: 0 } },
        { name: 'boost', type: 'Number', value: 150 },
        { name: 'tint', type: 'Colour', value: '#B7A4FF' },
      ];
      return {
        name: 'Variable room',
        variables,
        presets: [
          { name: 'Calm', values: { spin: { x: 0, y: 0, z: 0 } } },
          { name: 'Lively', values: { spin: { x: 0, y: 90, z: 15 }, boost: 2 } },
        ],
        scenes: [scene('Main', [cube('Spinner')])],
      };
    },
  },
  {
    name: 'Backdrop',
    workspace: 'Lumen Yard',
    owner: INES,
    members: lumenYardMembers(),
    files: [],
    publish: false,
    build: () => ({
      name: 'Backdrop',
      scenes: [
        scene(
          'Blend',
          [
            { name: 'Veil', kind: 'Rectangle', visible: false, props: { x: 0, y: 0, width: 720, height: 810, fill: '#FFFFFF', opacity: 50 } },
            { name: 'Wash', kind: 'Rectangle', props: { x: 0, y: 0, width: 1440, height: 810, fill: '#CC8844', opacity: 60 } },
          ],
          { background: '#336699' },
        ),
        scene(
          'Ramp',
          [
            {
              name: 'Spectrum',
              kind: 'Gradient',
              props: {
                x: 0,
                y: 0,
                width: 1440,
                height: 810,
                gradient: {
                  type: 'Linear',
                  angle: 0,
                  stops: [
                    { color: '#FF0000', position: 0 },
                    { color: '#FFFF00', position: 40 },
                    { color: '#0000FF', position: 100 },
                  ],
                },
              },
            },
          ],
          { background: '#000000' },
        ),
        scene('Grain', [{ name: 'Grain', kind: 'Effect', props: { effect: { kind: 'Grain', enabled: true, grainAmount: 0.15, grainSeed: 7 } } }], {
          background: '#336699',
        }),
      ],
    }),
  },
  {
    name: 'Phone kit',
    workspace: 'Lumen Yard',
    owner: INES,
    members: lumenYardMembers(),
    files: [],
    publish: false,
    build: () => ({
      name: 'Phone kit',
      scenes: [
        scene('Main', [
          { name: 'Base', kind: 'Rectangle', props: {} },
          { name: 'Glow', kind: 'Ellipse', props: {} },
          { name: 'Spark', kind: 'Polygon', props: {} },
          { name: 'Caption', kind: 'Text', props: { text: 'Ship it' } },
        ]),
      ],
    }),
  },
  {
    name: 'Quarry teaser',
    workspace: 'Quarry Hall',
    owner: PAVEL,
    members: [],
    files: [],
    publish: false,
    build: () => ({ name: 'Quarry teaser', scenes: [scene('Main', [cube('Slab')])] }),
  },
];

const FILES: Record<string, { contentType: string; kind: 'model' | 'image'; bytes: () => Buffer }> = {
  'swing.gltf': { contentType: 'model/gltf+json', kind: 'model', bytes: swingGltf },
  'grain-plate.png': { contentType: 'image/png', kind: 'image', bytes: () => grainPlatePng(config.seeds.grain) },
};

interface SeedMap {
  workspaces: Record<string, string>;
  people: Record<string, { id: string; name: string; session: string }>;
  projects: Record<string, { id: string; scenes: Record<string, string>; layers: Record<string, string>; assets: Record<string, string>; versions: number[] }>;
}

/** The seed map as stored: also what a repeated seed call returns. */
async function seedMap(): Promise<SeedMap> {
  const map: SeedMap = { workspaces: {}, people: {}, projects: {} };
  for (const row of await query<{ id: string; name: string }>('SELECT id, name FROM workspaces')) map.workspaces[row.name] = row.id;
  for (const row of await query<{ id: string; name: string; email: string }>('SELECT id, name, email FROM people')) {
    map.people[row.email] = { id: row.id, name: row.name, session: await createSession(row.id) };
  }
  for (const project of await query<{ id: string; name: string }>('SELECT id, name FROM projects ORDER BY created_at, id')) {
    const [scenes, layers, assets, versions] = await Promise.all([
      query<{ id: string; name: string }>('SELECT id, name FROM scenes WHERE project_id = $1 ORDER BY position', [project.id]),
      query<{ id: string; name: string }>('SELECT id, name FROM layers WHERE project_id = $1 ORDER BY idx', [project.id]),
      query<{ id: string; file_name: string }>(`SELECT id, file_name FROM assets WHERE project_id = $1 AND status = 'confirmed'`, [project.id]),
      query<{ number: number }>('SELECT number FROM versions WHERE project_id = $1 ORDER BY number', [project.id]),
    ]);
    map.projects[project.name] = {
      id: project.id,
      scenes: Object.fromEntries(scenes.map((s) => [s.name, s.id])),
      layers: Object.fromEntries(layers.map((l) => [l.name, l.id])),
      assets: Object.fromEntries(assets.map((a) => [a.file_name, a.id])),
      versions: versions.map((v) => v.number),
    };
  }
  return map;
}

async function seedOnce(): Promise<SeedMap> {
  if ((await query('SELECT 1 FROM people WHERE email = $1', [INES.email])).length > 0) return seedMap();

  const people = new Map<string, string>();
  const workspaces = new Map<string, string>();
  const projects = new Map<string, string>();
  const hashes = new Map<string, string>();
  for (const person of [INES, MARA, TOMAS, PAVEL]) hashes.set(person.email, await hashPassword(person.password));

  await transaction(async (client) => {
    const at = await now(client);
    for (const person of [INES, MARA, TOMAS, PAVEL]) {
      const id = newId('u');
      people.set(person.email, id);
      await client.query('INSERT INTO people (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)', [id, person.name, person.email, hashes.get(person.email), at]);
    }
    for (const [name, owner] of [['Lumen Yard', INES], ['Quarry Hall', PAVEL]] as const) {
      const id = newId('w');
      workspaces.set(name, id);
      await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [id, name]);
      await client.query(`INSERT INTO workspace_members (workspace_id, person_id, role) VALUES ($1, $2, 'Owner')`, [id, people.get(owner.email)]);
    }
    for (const [index, plan] of PLANS.entries()) {
      const id = await createProject(client, {
        workspaceId: workspaces.get(plan.workspace) as string,
        name: plan.name,
        ownerId: people.get(plan.owner.email) as string,
        document: emptyDocument(plan.name),
        imported: false,
        at: new Date(at.getTime() + index),
      });
      projects.set(plan.name, id);
      for (const [member, role] of plan.members) {
        await client.query('INSERT INTO members (project_id, person_id, role, added_at) VALUES ($1, $2, $3, $4)', [id, people.get(member.email), role, at]);
      }
    }
  });

  for (const plan of PLANS) {
    const projectId = projects.get(plan.name) as string;
    const assets: Record<string, string> = {};
    for (const fileName of plan.files) {
      const file = FILES[fileName] as (typeof FILES)[string];
      const result = await uploadAsset({ projectId, kind: file.kind, fileName, contentType: file.contentType, bytes: file.bytes() });
      if (!('asset' in result)) return storageDown(MESSAGES.storageUploads);
      assets[fileName] = result.asset.id;
    }
    const document = completeDocument(plan.build(assets), config.seeds);
    await transaction(async (client) => {
      await client.query('DELETE FROM scenes WHERE project_id = $1', [projectId]);
      await insertDocument(client, projectId, document);
    });
    if (plan.publish) await publishVersion({ projectId, publishedBy: people.get(plan.owner.email) as string });
  }
  return seedMap();
}

const SEED_LOCK = 727002;

/** Seeds the store once; concurrent calls queue on an advisory lock and the later ones return the stored map. */
export async function seed(): Promise<SeedMap> {
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [SEED_LOCK]);
    return await seedOnce();
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK]).catch(() => undefined);
    lock.release();
  }
}
