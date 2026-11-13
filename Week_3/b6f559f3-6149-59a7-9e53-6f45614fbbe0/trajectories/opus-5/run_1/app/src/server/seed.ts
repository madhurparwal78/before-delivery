import { createHash, randomUUID } from 'node:crypto';
import { query, transaction } from './db';
import { serverNow } from './clock';
import { hashPassword } from './api-shared';
import { persistDocument } from './repo';
import { createLayer, createScene } from '../shared/scene-doc';
import type { JsonValue, Layer, LayerKind, Scene, SceneDocument } from '../shared/types';
import { writeLayerPath } from '../shared/scene-doc';
import { generatePng, generateSwingGltf } from './seed-files';
import { checkModel } from './assets';
import { putObject, confirmObject, storageKeys } from './storage';
import { publishVersion } from './publish';

interface SeedPerson {
  id: string;
  name: string;
  email: string;
  password: string;
  session: string;
}

interface SeedProjectResult {
  id: string;
  scenes: Record<string, string>;
  layers: Record<string, string>;
  assets: Record<string, string>;
  versions: number[];
}

const PEOPLE: { name: string; email: string; password: string }[] = [
  { name: 'Ines Okafor', email: 'ines@lumenyard.test', password: 'halation-ines-01' },
  { name: 'Mara Lindqvist', email: 'mara@lumenyard.test', password: 'halation-mara-01' },
  { name: 'Tomas Reyes', email: 'tomas@lumenyard.test', password: 'halation-tomas-01' },
  { name: 'Pavel Duarte', email: 'pavel@quarryhall.test', password: 'halation-pavel-01' },
];

function layer(
  scene: Scene,
  kind: LayerKind,
  name: string,
  props: Record<string, JsonValue> = {},
  extra: Partial<Layer> = {},
): Layer {
  const made = createLayer({
    id: randomUUID(),
    kind,
    name,
    parentId: null,
    order: scene.layers.length,
  });
  for (const [path, value] of Object.entries(props)) {
    writeLayerPath(made, path, value);
  }
  Object.assign(made, extra);
  scene.layers.push(made);
  return made;
}

function documentFor(name: string, scenes: Scene[]): SceneDocument {
  return { schemaVersion: 3, name, variables: [], presets: [], scenes };
}

export async function seedAll(): Promise<Record<string, JsonValue>> {
  const now = await serverNow();
  const people: Record<string, SeedPerson> = {};
  for (const entry of PEOPLE) {
    const id = randomUUID();
    const session = randomUUID();
    await query(
      `INSERT INTO people (id, name, email, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [id, entry.name, entry.email, hashPassword(entry.password), now.toISOString()],
    );
    await query(`INSERT INTO sessions (id, person_id, created_at) VALUES ($1,$2,$3)`, [
      session,
      id,
      now.toISOString(),
    ]);
    people[entry.email] = { id, name: entry.name, email: entry.email, password: entry.password, session };
  }

  const lumenYard = randomUUID();
  const quarryHall = randomUUID();
  await query(`INSERT INTO workspaces (id, name, owner_person_id) VALUES ($1,$2,$3)`, [
    lumenYard,
    'Lumen Yard',
    people['ines@lumenyard.test'].id,
  ]);
  await query(`INSERT INTO workspaces (id, name, owner_person_id) VALUES ($1,$2,$3)`, [
    quarryHall,
    'Quarry Hall',
    people['pavel@quarryhall.test'].id,
  ]);

  const results: Record<string, SeedProjectResult> = {};

  const createProject = async (
    workspaceId: string,
    name: string,
    ownerEmail: string,
    scenes: Scene[],
    options: {
      variables?: SceneDocument['variables'];
      presets?: SceneDocument['presets'];
      members?: { email: string; role: 'Editor' | 'Viewer' }[];
    } = {},
  ): Promise<SeedProjectResult> => {
    const projectId = randomUUID();
    const document = documentFor(name, scenes);
    document.variables = options.variables ?? [];
    document.presets = options.presets ?? [];
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, status, imported, created_at)
         VALUES ($1,$2,$3,'active',false,$4)`,
        [projectId, workspaceId, name, now.toISOString()],
      );
      await client.query(`INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,'Owner')`, [
        projectId,
        people[ownerEmail].id,
      ]);
      for (const member of options.members ?? []) {
        await client.query(`INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,$3)`, [
          projectId,
          people[member.email].id,
          member.role,
        ]);
      }
      await persistDocument(client, projectId, document);
    });
    const result: SeedProjectResult = {
      id: projectId,
      scenes: Object.fromEntries(scenes.map((scene) => [scene.name, scene.id])),
      layers: Object.fromEntries(
        scenes.flatMap((scene) => scene.layers.map((item) => [item.name, item.id])),
      ),
      assets: {},
      versions: [],
    };
    results[name] = result;
    return result;
  };

  const lumenMembers: { email: string; role: 'Editor' | 'Viewer' }[] = [
    { email: 'mara@lumenyard.test', role: 'Editor' },
    { email: 'tomas@lumenyard.test', role: 'Viewer' },
  ];

  const swingBytes = generateSwingGltf();
  const grainBytes = generatePng(64, 64);

  const uploadAsset = async (
    projectId: string,
    kind: 'image' | 'model',
    fileName: string,
    data: Buffer,
    contentType: string,
  ): Promise<string> => {
    const assetId = randomUUID();
    let vertices: number | null = null;
    let clips: { name: string; durationS: number }[] = [];
    let parsed: JsonValue = null;
    let width: number | null = null;
    let height: number | null = null;
    if (kind === 'model') {
      const check = checkModel(data, fileName);
      if (check.refusal || !check.model) throw new Error(`Seed model invalid: ${check.refusal}`);
      vertices = check.model.vertexCount;
      clips = check.model.clips.map((clip) => ({ name: clip.name, durationS: clip.durationS }));
      parsed = check.model as unknown as JsonValue;
    } else {
      width = 64;
      height = 64;
    }
    await query(
      `INSERT INTO assets (id, project_id, kind, file_name, content_type, bytes, sha256, status,
         width, height, vertices, clips, parsed, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10,$11,$12,$13)`,
      [
        assetId,
        projectId,
        kind,
        fileName,
        contentType,
        data.byteLength,
        createHash('sha256').update(data).digest('hex'),
        width,
        height,
        vertices,
        JSON.stringify(clips),
        parsed === null ? null : JSON.stringify(parsed),
        now.toISOString(),
      ],
    );
    const key = storageKeys.asset(projectId, assetId);
    await putObject(key, data, contentType);
    const confirmed = await confirmObject(key, data.byteLength);
    if (!confirmed) throw new Error('Seed asset not confirmed');
    await query(`UPDATE assets SET status = 'confirmed' WHERE id = $1`, [assetId]);
    return assetId;
  };

  // Lumen hero
  const lumenHeroScene = createScene(randomUUID(), 'Main');
  const lumenHero = await createProject(lumenYard, 'Lumen hero', 'ines@lumenyard.test', [
    lumenHeroScene,
  ], { members: lumenMembers });
  const swingAssetHero = await uploadAsset(
    lumenHero.id,
    'model',
    'swing.gltf',
    swingBytes,
    'model/gltf+json',
  );
  lumenHero.assets['swing.gltf'] = swingAssetHero;
  {
    const haloCube = layer(lumenHeroScene, 'Primitive', 'Halo cube', {
      primitive: 'Cube',
      'position.x': 1,
      'position.y': 2,
      'position.z': 0,
      'rotation.y': 45,
      'scale.x': 2,
      'scale.y': 1,
      'scale.z': 1,
      'material.kind': 'Matcap',
      'material.matcap': 'Clay',
    });
    haloCube.events.tilt = { enabled: true, maxTilt: 12, sensitivity: 1, momentum: 1 };
    haloCube.events.appear = {
      enabled: true,
      durationMs: 600,
      delayMs: 0,
      easing: 'glide',
      from: { 'material.opacity': 0 },
    };
    haloCube.overrides.tablet['rotation.y'] = 30;
    layer(lumenHeroScene, 'Model', 'Pebble', { preset: 'Pebble', 'position.x': -2 });
    layer(lumenHeroScene, 'Model', 'Swing', {
      modelAssetId: swingAssetHero,
      clips: [{ name: 'Turn', play: true, loop: true, speed: 1, offsetMs: 0 }],
    });
    layer(lumenHeroScene, 'Particles', 'Sparks', {
      seed: 7,
      rate: 60,
      burst: 0,
      lifetime: 2,
      speed: 2,
      gravity: 9.8,
    });
    lumenHero.layers = Object.fromEntries(
      lumenHeroScene.layers.map((item) => [item.name, item.id]),
    );
    await transaction(async (client) => {
      await persistDocument(client, lumenHero.id, documentFor('Lumen hero', [lumenHeroScene]));
    });
  }

  // Orbit study
  const orbitScene = createScene(randomUUID(), 'Main');
  orbitScene.orbit = { enabled: true, startAngle: 0, endAngle: 90 };
  orbitScene.light = { enabled: true, sensitivity: 1, momentum: 1 };
  const probe = layer(orbitScene, 'Primitive', 'Probe', {
    primitive: 'Sphere',
    'position.x': 1,
    'position.y': 2,
  });
  probe.events.tilt = { enabled: true, maxTilt: 12, sensitivity: 1, momentum: 1 };
  layer(orbitScene, 'Model', 'Arch', { preset: 'Arch', 'position.x': -2 });
  await createProject(lumenYard, 'Orbit study', 'ines@lumenyard.test', [orbitScene], {
    members: [{ email: 'tomas@lumenyard.test', role: 'Viewer' }],
  });

  // Logo forge
  const logoScene = createScene(randomUUID(), 'Main');
  const wordmark = layer(logoScene, 'Extrusion', 'Wordmark', {
    source: 'text',
    text: 'HALO',
    letterHeight: 1,
    depth: 0.2,
    bevelSize: 0.02,
    bevelSegments: 1,
  });
  layer(logoScene, 'Particles', 'Swarm', {
    seed: 7,
    burst: 3,
    rate: 30,
    lifetime: 0.5,
    speed: 2,
    gravity: 9.8,
    orbit: 90,
    'attractor.x': 0,
    'attractor.y': 1,
    'attractor.z': 0,
    'attractor.strength': 4,
  });
  layer(logoScene, 'Particles', 'Drift', {
    seed: 7,
    burst: 3,
    rate: 0,
    lifetime: 2,
    speed: 2,
    gravity: 9.8,
    trailLength: 8,
  });
  layer(logoScene, 'Particles', 'Formation', {
    mode: 'form',
    seed: 7,
    'formation.target': wordmark.id,
    'formation.count': 32,
    'formation.durationMs': 1500,
  });
  await createProject(lumenYard, 'Logo forge', 'ines@lumenyard.test', [logoScene], {
    members: lumenMembers,
  });

  // Model bay
  const modelBayScene = createScene(randomUUID(), 'Main');
  const modelBay = await createProject(lumenYard, 'Model bay', 'ines@lumenyard.test', [
    modelBayScene,
  ], { members: lumenMembers });
  const swingAsset = await uploadAsset(
    modelBay.id,
    'model',
    'swing.gltf',
    swingBytes,
    'model/gltf+json',
  );
  const grainAsset = await uploadAsset(
    modelBay.id,
    'image',
    'grain-plate.png',
    grainBytes,
    'image/png',
  );
  modelBay.assets['swing.gltf'] = swingAsset;
  modelBay.assets['grain-plate.png'] = grainAsset;
  layer(modelBayScene, 'Model', 'Swing', {
    modelAssetId: swingAsset,
    clips: [
      { name: 'Turn', play: true, loop: false, speed: 1, offsetMs: 0 },
      { name: 'Hop', play: false, loop: false, speed: 1, offsetMs: 0 },
    ],
  });
  layer(modelBayScene, 'Image', 'Grain plate', {
    assetId: grainAsset,
    width: 64,
    height: 64,
  });
  modelBay.layers = Object.fromEntries(modelBayScene.layers.map((item) => [item.name, item.id]));
  await transaction(async (client) => {
    await persistDocument(client, modelBay.id, documentFor('Model bay', [modelBayScene]));
  });
  const published = await publishVersion(
    modelBay.id,
    'Model bay',
    {
      id: people['ines@lumenyard.test'].id,
      name: people['ines@lumenyard.test'].name,
      email: people['ines@lumenyard.test'].email,
    },
    null,
  );
  modelBay.versions = [published.number];

  // Banner test
  const bannerScene = createScene(randomUUID(), 'Main');
  layer(bannerScene, 'Cloth', 'Banner', {
    columns: 4,
    rows: 4,
    seed: 3,
    pinned: 'Top',
    windStrength: 2,
    windDirection: 0,
  });
  await createProject(lumenYard, 'Banner test', 'ines@lumenyard.test', [bannerScene], {
    members: lumenMembers,
  });

  // Easing lab
  const easingScene = createScene(randomUUID(), 'Main');
  const turner = layer(easingScene, 'Primitive', 'Turner', { primitive: 'Cube' });
  turner.keyframes = [
    { property: 'rotation.y', frame: 0, value: 0, easing: 'ease-out' },
    { property: 'rotation.y', frame: 60, value: 90, easing: 'linear' },
  ];
  layer(easingScene, 'Primitive', 'Blank', { primitive: 'Cube' });
  await createProject(lumenYard, 'Easing lab', 'ines@lumenyard.test', [easingScene], {
    members: lumenMembers,
  });

  // Variable room
  const variableScene = createScene(randomUUID(), 'Main');
  layer(variableScene, 'Primitive', 'Spinner', { primitive: 'Cube' });
  await createProject(lumenYard, 'Variable room', 'ines@lumenyard.test', [variableScene], {
    members: lumenMembers,
    variables: [
      { name: 'spin', type: 'Vector 3', value: { x: 0, y: 45, z: 0 } },
      { name: 'boost', type: 'Number', value: 150 },
      { name: 'tint', type: 'Colour', value: '#B7A4FF' },
    ],
    presets: [
      { name: 'Calm', values: { spin: { x: 0, y: 0, z: 0 } } },
      { name: 'Lively', values: { spin: { x: 0, y: 90, z: 15 }, boost: 2 } },
    ],
  });

  // Backdrop
  const blendScene = createScene(randomUUID(), 'Blend');
  blendScene.background = '#336699';
  layer(blendScene, 'Rectangle', 'Veil', {
    x: 0,
    y: 0,
    width: 720,
    height: 810,
    fill: '#FFFFFF',
    opacity: 50,
  }, { visible: false, maskAbove: false, order: 0 });
  layer(blendScene, 'Rectangle', 'Wash', {
    x: 0,
    y: 0,
    width: 1440,
    height: 810,
    fill: '#CC8844',
    opacity: 60,
  }, { blendMode: 'Normal', order: 1 });
  const rampScene = createScene(randomUUID(), 'Ramp');
  rampScene.background = '#000000';
  layer(rampScene, 'Gradient', 'Spectrum', {
    x: 0,
    y: 0,
    width: 1440,
    height: 810,
    'gradient.type': 'Linear',
    'gradient.angle': 0,
    'gradient.stops': [
      { color: '#FF0000', position: 0 },
      { color: '#FFFF00', position: 40 },
      { color: '#0000FF', position: 100 },
    ],
  });
  const grainScene = createScene(randomUUID(), 'Grain');
  grainScene.background = '#336699';
  layer(grainScene, 'Effect', 'Grain', {
    'effect.kind': 'Grain',
    'effect.grainAmount': 0.15,
    'effect.grainSeed': 7,
  });
  await createProject(lumenYard, 'Backdrop', 'ines@lumenyard.test', [
    blendScene,
    rampScene,
    grainScene,
  ], { members: lumenMembers });

  // Phone kit
  const phoneScene = createScene(randomUUID(), 'Main');
  layer(phoneScene, 'Rectangle', 'Base');
  layer(phoneScene, 'Ellipse', 'Glow');
  layer(phoneScene, 'Polygon', 'Spark');
  layer(phoneScene, 'Text', 'Caption', { text: 'Ship it' });
  await createProject(lumenYard, 'Phone kit', 'ines@lumenyard.test', [phoneScene], {
    members: lumenMembers,
  });

  // Quarry teaser
  const quarryScene = createScene(randomUUID(), 'Main');
  layer(quarryScene, 'Primitive', 'Slab', { primitive: 'Cube' });
  await createProject(quarryHall, 'Quarry teaser', 'pavel@quarryhall.test', [quarryScene]);

  return {
    workspaces: { 'Lumen Yard': lumenYard, 'Quarry Hall': quarryHall },
    people: Object.fromEntries(
      Object.values(people).map((person) => [
        person.email,
        { id: person.id, name: person.name, session: person.session },
      ]),
    ),
    projects: Object.fromEntries(
      Object.entries(results).map(([name, result]) => [
        name,
        {
          id: result.id,
          scenes: result.scenes,
          layers: result.layers,
          assets: result.assets,
          versions: result.versions,
        },
      ]),
    ),
  } as unknown as Record<string, JsonValue>;
}
